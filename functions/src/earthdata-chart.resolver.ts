import type { EarthdataQuerySpec, MeteomaticsChartTrend, MonthlyObservation } from '../../shared/types';
import { BASELINE, MIN_COVERAGE, MIN_YEARS } from './config.constant';
import { annualize, calculateTrend } from './statistics';

type Envelope = { data?: Array<{ parameter?: string; coordinates?: Array<{ lat?: number; lon?: number; dates?: Array<{ date?: string; value?: number | null }> }> }> } | null;

/**
 * Monthly and annual means of stored AppEEARS zonal series. Satellite products have gaps (clouds, 8- or 16-day
 * composites), so a month is the mean of whatever valid observations it has, and null when it has none.
 * Every variable is a mean or a rate: years are calendar-day-weighted means of 12 valid months, and inference
 * uses the same thresholds and method (OLS, Newey–West) as the other query workflows.
 */
export function resolveEarthdataChart(result: unknown, spec: EarthdataQuerySpec): MeteomaticsChartTrend[] {
  const root = result as Envelope;
  if (!Array.isArray(root?.data)) return [];
  const startYear = Number(spec.startDate.slice(0, 4));
  const endYear = Number(spec.endDate.slice(0, 4));
  const requestedYears = endYear - startYear + 1;
  const output: MeteomaticsChartTrend[] = [];
  for (const item of root.data) for (const coordinate of item.coordinates ?? []) {
    if (!item.parameter || !Array.isArray(coordinate.dates) || typeof coordinate.lat !== 'number' || typeof coordinate.lon !== 'number') continue;
    const sums = new Map<string, { total: number; count: number }>();
    for (const entry of coordinate.dates) {
      if (typeof entry.date !== 'string' || typeof entry.value !== 'number' || !Number.isFinite(entry.value)) continue;
      const key = entry.date.slice(0, 7);
      const bucket = sums.get(key) ?? { total: 0, count: 0 };
      bucket.total += entry.value;
      bucket.count += 1;
      sums.set(key, bucket);
    }
    const monthly: MonthlyObservation[] = [];
    for (let year = startYear; year <= endYear; year++) for (let month = 1; month <= 12; month++) {
      const bucket = sums.get(`${year}-${String(month).padStart(2, '0')}`);
      monthly.push({ year, month, value: bucket ? bucket.total / bucket.count : null });
    }
    // 'temperature' selects annualize's day-weighted mean, which is correct for any mean or rate variable.
    const annual = annualize(monthly, 'temperature');
    const baseline = annual.filter(point => point.year >= BASELINE.startYear && point.year <= BASELINE.endYear);
    const baselineMean = baseline.length === 30 ? baseline.reduce((sum, point) => sum + point.value, 0) / 30 : null;
    annual.forEach(point => { point.anomaly = baselineMean === null ? null : point.value - baselineMean; });
    output.push({ parameter: item.parameter, latitude: coordinate.lat, longitude: coordinate.lon, annual, requestedYears, aggregation: 'mean', monthly,
      excludedYears: Array.from({ length: requestedYears }, (_, index) => startYear + index).filter(year => !annual.some(point => point.year === year)),
      trend: annual.length >= MIN_YEARS && annual.length / requestedYears >= MIN_COVERAGE ? calculateTrend(annual) : null, dailyFit: null });
  }
  return output;
}
