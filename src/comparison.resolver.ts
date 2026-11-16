import type { AnnualObservation, ComparableSeries, MonthlyObservation, SessionComparison } from '../shared/types';
import type { ComparisonChartRow, ComparisonView } from './comparison.types';

type Point = { time: number; value: number };

const monthlyPoints = (monthly: MonthlyObservation[]): Point[] =>
  monthly.flatMap(point => point.value === null || !Number.isFinite(point.value) ? [] : [{ time: Date.UTC(point.year, point.month - 1, 1), value: point.value }]);
const annualPoints = (annual: AnnualObservation[]): Point[] => annual.map(point => ({ time: Date.UTC(point.year, 0, 1), value: point.value }));

function standardize(points: Point[]): Point[] {
  if (points.length < 2) return points;
  const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
  const sd = Math.sqrt(points.reduce((sum, point) => sum + (point.value - mean) ** 2, 0) / (points.length - 1));
  return sd === 0 ? points.map(point => ({ ...point, value: 0 })) : points.map(point => ({ ...point, value: (point.value - mean) / sd }));
}

function trendLine(series: ComparableSeries, rows: Map<number, ComparisonChartRow>, field: 'aTrend' | 'bTrend') {
  if (!series.trend || !series.annual.length) return;
  for (const year of [series.annual[0]!.year, series.annual.at(-1)!.year]) {
    const time = Date.UTC(year, 0, 1);
    const row = rows.get(time) ?? { time, a: null, b: null };
    row[field] = series.trend.intercept + series.trend.slopePerYear * year;
    rows.set(time, row);
  }
}

/** Both series on one time axis. Missing months stay null so lines break instead of interpolating. */
export function resolveComparisonRows(comparison: SessionComparison, view: ComparisonView, standardized: boolean, showTrend: boolean): ComparisonChartRow[] {
  const pick = (series: ComparableSeries) => {
    const points = view === 'monthly' ? monthlyPoints(series.monthly) : annualPoints(series.annual);
    return standardized ? standardize(points) : points;
  };
  const rows = new Map<number, ComparisonChartRow>();
  for (const point of pick(comparison.a)) rows.set(point.time, { time: point.time, a: point.value, b: null });
  for (const point of pick(comparison.b)) { const row = rows.get(point.time) ?? { time: point.time, a: null, b: null }; row.b = point.value; rows.set(point.time, row); }
  if (view === 'annual' && !standardized && showTrend) { trendLine(comparison.a, rows, 'aTrend'); trendLine(comparison.b, rows, 'bTrend'); }
  return [...rows.values()].sort((x, y) => x.time - y.time);
}

/** Monthly values of both series, including months where only one has data. */
export function downloadComparisonCsv(comparison: SessionComparison): void {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows = new Map<string, { a: number | null; b: number | null }>();
  for (const point of comparison.a.monthly) rows.set(`${point.year},${point.month}`, { a: point.value, b: null });
  for (const point of comparison.b.monthly) { const key = `${point.year},${point.month}`; rows.set(key, { a: rows.get(key)?.a ?? null, b: point.value }); }
  const ordered = [...rows].sort(([x], [y]) => { const [xy, xm] = x.split(',').map(Number); const [yy, ym] = y.split(',').map(Number); return xy! - yy! || xm! - ym!; });
  const header = `year,month,${quote(`A: ${comparison.a.label} (${comparison.a.unit})`)},${quote(`B: ${comparison.b.label} (${comparison.b.unit})`)}`;
  const csv = [header, ...ordered.map(([key, value]) => `${key},${value.a ?? ''},${value.b ?? ''}`)].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = 'session-comparison-monthly.csv'; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
