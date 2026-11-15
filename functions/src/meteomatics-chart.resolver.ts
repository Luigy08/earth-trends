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
    const aggregation = item.parameter === 'precip_24h:mm' ? 'sum' : item.parameter === 't_mean_2m_24h:C' || /^volumetric_soil_water_-\d+cm:m3m3$/.test(item.parameter) ? 'mean' : null;
    if (!aggregation) continue;
    const byYear = new Map<number, Map<string, number>>();
    const samples = new Map<number, number>();
    for (const entry of coordinate.dates) {
      if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(entry.date) || typeof entry.value !== 'number' || !Number.isFinite(entry.value) || [-999, -888, -777, -666].includes(entry.value)) continue;
      if (aggregation === 'sum' && entry.value < 0) continue;
      const timestamp = Date.parse(entry.date);
      if (!Number.isFinite(timestamp)) continue;
      samples.set(timestamp, entry.value);
      const year = Number(entry.date.slice(0, 4));
      const days = byYear.get(year) ?? new Map<string, number>();
      days.set(entry.date.slice(0, 10), entry.value); byYear.set(year, days);
    }
    const annual: AnnualObservation[] = [];
    const monthly: import('../../shared/types').MonthlyObservation[] = [];
    for (let year = start; year <= end; year++) {
      const days = byYear.get(year); const expected = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000;
      for (let month = 1; month <= 12; month++) {
        const prefix = `${year}-${String(month).padStart(2, '0')}-`;
        const values = [...(days ?? new Map<string, number>())].filter(([date]) => date.startsWith(prefix)).map(([, value]) => value);
        const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const total = values.reduce((sum, value) => sum + value, 0);
        monthly.push({ year, month, value: values.length === count ? aggregation === 'sum' ? total : total / count : null });
      }
      if (days?.size === expected) {
        const total = [...days.values()].reduce((a, b) => a + b, 0);
        annual.push({ year, value: aggregation === 'sum' ? total : total / expected, anomaly: null });
      }
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
    const baseline = annual.filter(point => point.year >= 1991 && point.year <= 2020);
    if (baseline.length === 30) {
      const baselineMean = baseline.reduce((sum, point) => sum + point.value, 0) / 30;
      annual.forEach(point => { point.anomaly = point.value - baselineMean; });
    }
    output.push({ parameter: item.parameter, latitude: coordinate.lat, longitude: coordinate.lon, annual, requestedYears, aggregation, monthly,
      excludedYears: Array.from({ length: requestedYears }, (_, index) => start + index).filter(year => !annual.some(point => point.year === year)),
      trend: annual.length >= 10 && annual.length / requestedYears >= 0.8 ? calculateTrend(annual) : null, dailyFit });
  }
  return output;
}
