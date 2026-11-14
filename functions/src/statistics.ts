import { jStat } from 'jstat';
import type { AnnualObservation, ClimateMetric, MonthlyObservation, TrendStatistics } from '../../shared/types';

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Only twelve unique, finite months produce an annual value. Precipitation inputs are mm/day. */
export function annualize(monthly: MonthlyObservation[], metric: ClimateMetric): AnnualObservation[] {
  const grouped = new Map<number, Map<number, number>>();
  const invalidYears = new Set<number>();
  for (const observation of monthly) {
    const { year, month, value } = observation;
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) continue;
    if (value === null || !Number.isFinite(value) || (metric === 'precipitation' && value < 0)) continue;
    const months = grouped.get(year) ?? new Map<number, number>();
    if (months.has(month)) invalidYears.add(year);
    months.set(month, value);
    grouped.set(year, months);
  }
  return [...grouped].sort(([a], [b]) => a - b).flatMap(([year, months]) => {
    if (months.size !== 12 || invalidYears.has(year)) return [];
    let total = 0;
    let days = 0;
    for (const [month, value] of months) {
      const count = daysInMonth(year, month);
      total += value * count;
      days += count;
    }
    return [{ year, value: metric === 'temperature' ? total / days : total, anomaly: null }];
  });
}

/** OLS slope, Bartlett Newey-West HAC with calendar-year lags and n/(n-2) correction.
 * Student-t(n-2) critical values are a finite-sample approximation, not an exact HAC law. */
export function calculateTrend(annual: AnnualObservation[]): TrendStatistics {
  const points = [...annual].sort((a, b) => a.year - b.year);
  const n = points.length;
  if (n < 3 || new Set(points.map(p => p.year)).size !== n || points.some(p => !Number.isFinite(p.value))) {
    throw new Error('Trend requires at least three finite observations with unique years');
  }
  const meanX = points.reduce((s, p) => s + p.year, 0) / n;
  const meanY = points.reduce((s, p) => s + p.value, 0) / n;
  const x = points.map(p => p.year - meanX);
  const sxx = x.reduce((s, v) => s + v * v, 0);
  const slope = points.reduce((s, p, i) => s + x[i]! * (p.value - meanY), 0) / sxx;
  const residuals = points.map((p, i) => p.value - meanY - slope * x[i]!);
  const sse = residuals.reduce((s, v) => s + v * v, 0);
  const sst = points.reduce((s, p) => s + (p.value - meanY) ** 2, 0);
  const lag = Math.min(n - 1, Math.floor(4 * (n / 100) ** (2 / 9)));
  const scores = residuals.map((e, i) => e * x[i]!);
  let meat = scores.reduce((s, v) => s + v * v, 0);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const distance = points[j]!.year - points[i]!.year;
      if (distance > lag) break;
      meat += 2 * (1 - distance / (lag + 1)) * scores[i]! * scores[j]!;
    }
  }
  const standardError = Math.sqrt(Math.max(0, meat * n / (n - 2) / sxx ** 2));
  const critical = jStat.studentt.inv(0.975, n - 2);
  const margin = critical * standardError;
  // Evaluating the lower tail avoids catastrophic cancellation for strong trends.
  const pValue = standardError === 0 ? (slope === 0 ? 1 : 0)
    : Math.max(0, Math.min(1, 2 * jStat.studentt.cdf(-Math.abs(slope / standardError), n - 2)));
  return {
    method: 'OLS-Newey-West', slopePerYear: slope, slopePerDecade: slope * 10,
    intercept: meanY - slope * meanX,
    confidenceInterval95PerDecade: [(slope - margin) * 10, (slope + margin) * 10],
    pValue, significant: pValue < 0.05, sampleSize: n, lag,
    rSquared: sst === 0 ? 1 : Math.max(0, Math.min(1, 1 - sse / sst)),
  };
}
