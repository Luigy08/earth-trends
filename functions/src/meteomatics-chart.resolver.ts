import type { AnnualObservation, MeteomaticsChartTrend, MeteomaticsQuerySpec } from '../../shared/types';
import { calculateTrend } from './statistics';

/** Annual averages of complete daily samples, with inference only above the POC coverage threshold. */
export function resolveMeteomaticsChart(result: unknown, spec: MeteomaticsQuerySpec): MeteomaticsChartTrend[] {
  if (spec.mode !== 'point' || spec.format !== 'json' || !/(:P1D)$/.test(spec.validDates)) return [];
  const dates = spec.validDates.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g);
  if (!dates || dates.length !== 2) return [];
  const start = Number(dates[0]!.slice(0, 4));
  const end = Number(dates[1]!.slice(0, 4));
  if (end < start || end - start > 150) return [];
  const root = result as { data?: Array<{ parameter?: string; coordinates?: Array<{ lat?: number; lon?: number; dates?: Array<{ date?: string; value?: number | null }> }> }> } | null;
  if (!Array.isArray(root?.data)) return [];
  const output: MeteomaticsChartTrend[] = [];
  for (const item of root.data) for (const coordinate of item.coordinates ?? []) {
    if (!item.parameter || !Array.isArray(coordinate.dates) || typeof coordinate.lat !== 'number' || typeof coordinate.lon !== 'number') continue;
    const byYear = new Map<number, Map<string, number>>();
    const samples = new Map<number, number>();
    for (const entry of coordinate.dates) {
      if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(entry.date) || typeof entry.value !== 'number' || !Number.isFinite(entry.value) || [-999, -888, -777, -666].includes(entry.value)) continue;
      const timestamp = Date.parse(entry.date);
      if (!Number.isFinite(timestamp)) continue;
      samples.set(timestamp, entry.value);
      const year = Number(entry.date.slice(0, 4));
      const days = byYear.get(year) ?? new Map<string, number>();
      days.set(entry.date.slice(0, 10), entry.value); byYear.set(year, days);
    }
    const annual: AnnualObservation[] = [];
    for (let year = start; year <= end; year++) {
      const days = byYear.get(year); const expected = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
      if (days?.size === expected) annual.push({ year, value: [...days.values()].reduce((a, b) => a + b, 0) / expected, anomaly: null });
    }
    const requestedYears = end - start + 1;
    const points = [...samples].sort(([a], [b]) => a - b);
    const origin = points[0]?.[0] ?? 0;
    const mean = points.length ? points.reduce((sum, [, value]) => sum + value, 0) / points.length : 0;
    const meanX = points.length ? points.reduce((sum, [time]) => sum + (time - origin) / 31556952000, 0) / points.length : 0;
    const sxx = points.reduce((sum, [time]) => sum + ((time - origin) / 31556952000 - meanX) ** 2, 0);
    const slopePerYear = sxx ? points.reduce((sum, [time, value]) => sum + ((time - origin) / 31556952000 - meanX) * (value - mean), 0) / sxx : 0;
    const intercept = mean - slopePerYear * meanX;
    const sst = points.reduce((sum, [, value]) => sum + (value - mean) ** 2, 0);
    const sse = points.reduce((sum, [time, value]) => sum + (value - intercept - slopePerYear * (time - origin) / 31556952000) ** 2, 0);
    const dailyFit = points.length > 1 && sxx > 0 ? { origin, slopePerYear, intercept, mean, maximum: points.reduce((max, [, value]) => Math.max(max, value), -Infinity), rSquared: sst ? Math.max(0, Math.min(1, 1 - sse / sst)) : null, count: points.length } : null;
    output.push({ parameter: item.parameter, latitude: coordinate.lat, longitude: coordinate.lon, annual, requestedYears,
      trend: annual.length >= 10 && annual.length / requestedYears >= 0.8 ? calculateTrend(annual) : null, dailyFit });
  }
  return output;
}
