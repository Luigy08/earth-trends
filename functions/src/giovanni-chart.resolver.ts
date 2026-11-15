import type { GiovanniQuerySpec, MeteomaticsChartTrend } from '../../shared/types';
import { resolveGiovanniMonthly } from '../../shared/giovanni.resolver';
import { BASELINE, MIN_COVERAGE, MIN_YEARS } from './config.constant';
import { annualize, calculateTrend } from './statistics';

type Envelope = { data?: Array<{ parameter?: string; coordinates?: Array<{ lat?: number; lon?: number; dates?: Array<{ date?: string; value?: number | null }> }> }> } | null;

/**
 * Monthly and annual means of Giovanni series (monthly or complete-daily products). Giovanni variables are means or
 * rates, so years are calendar-day-weighted means of 12 valid months. Inference uses the POC coverage threshold.
 */
export function resolveGiovanniChart(result: unknown, spec: GiovanniQuerySpec): MeteomaticsChartTrend[] {
  const root = result as Envelope;
  if (!Array.isArray(root?.data)) return [];
  const startYear = Number(spec.startDate.slice(0, 4));
  const endYear = Number(spec.endDate.slice(0, 4));
  const requestedYears = endYear - startYear + 1;
  const output: MeteomaticsChartTrend[] = [];
  for (const item of root.data) for (const coordinate of item.coordinates ?? []) {
    if (!item.parameter || !Array.isArray(coordinate.dates) || typeof coordinate.lat !== 'number' || typeof coordinate.lon !== 'number') continue;
    const rows = coordinate.dates.flatMap(entry => typeof entry.date === 'string'
      ? [{ timestamp: entry.date, value: typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : null }] : []);
    const monthly = resolveGiovanniMonthly({ headers: {}, rows }, value => value, startYear, endYear);
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
