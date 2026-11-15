import { MIN_COVERAGE, MIN_YEARS } from '../config.constant';
import { daysInMonth } from '../statistics';
import type { AnnualMean, ClimatologyMonth, MonthlyMean, TrendOptions, TrendSummary } from './ingest.types';

/** Same operational thresholds as the on-demand analysis: complete years only, and enough of them. */
export const DEFAULT_TREND_OPTIONS: Required<TrendOptions> = { minMonthsPerYear: 12, minYears: MIN_YEARS, minCoverage: MIN_COVERAGE };

const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Ordinary least squares slope of y on x. */
export function olsSlope(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  return sxy / sxx;
}

/** Theil–Sen estimator: median of the slopes between every pair of points. */
export function senSlope(x: number[], y: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < x.length; i++) {
    for (let j = i + 1; j < x.length; j++) {
      if (x[j] !== x[i]) slopes.push((y[j]! - y[i]!) / (x[j]! - x[i]!));
    }
  }
  return median(slopes);
}

/** Complementary error function (Numerical Recipes erfcc, fractional error below 1.2e-7). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/**
 * Mann–Kendall test for a monotonic trend on a series ordered in time.
 * The variance carries the correction for tied values and Z the usual continuity correction;
 * p is two-sided from the normal approximation.
 */
export function mannKendall(values: number[]): { s: number; variance: number; z: number; p: number } {
  const n = values.length;
  let s = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) s += Math.sign(values[j]! - values[i]!);
  }
  const ties = new Map<number, number>();
  for (const v of values) ties.set(v, (ties.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of ties.values()) if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = variance <= 0 || s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance);
  const p = Math.min(1, erfc(Math.abs(z) / Math.SQRT2));
  return { s, variance, z, p };
}

/**
 * Descriptive series and trend statistics for one variable in one zone.
 * - monthly: mean of the valid observations in each calendar month.
 * - annual: calendar-day-weighted mean of the monthly means, only for years with enough valid months.
 * - climatology: mean of the monthly means per month of the year.
 * - slopes and Mann–Kendall on the complete annual means; null when the thresholds are not met,
 *   so missing data is never reported as "no trend".
 * Returns null when there is no valid observation at all.
 */
export function computeTrend(points: { date: string; value: number | null }[], options: TrendOptions = {}): TrendSummary | null {
  const { minMonthsPerYear, minYears, minCoverage } = { ...DEFAULT_TREND_OPTIONS, ...options };
  const valid = points
    .filter((p): p is { date: string; value: number } => p.value !== null && Number.isFinite(p.value) && /^\d{4}-\d{2}-\d{2}/.test(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (!first || !last) return null;

  const byMonth = new Map<string, number[]>();
  for (const p of valid) {
    const key = p.date.slice(0, 7);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(p.value);
    else byMonth.set(key, [p.value]);
  }
  const monthly: MonthlyMean[] = [...byMonth].map(([month, values]) => ({ month, mean: mean(values), count: values.length }));

  const byYear = new Map<number, MonthlyMean[]>();
  const byCalendarMonth = new Map<number, number[]>();
  for (const m of monthly) {
    const year = Number(m.month.slice(0, 4));
    const month = Number(m.month.slice(5, 7));
    byYear.set(year, [...(byYear.get(year) ?? []), m]);
    byCalendarMonth.set(month, [...(byCalendarMonth.get(month) ?? []), m.mean]);
  }
  const annual: AnnualMean[] = [...byYear].map(([year, months]) => {
    const count = months.reduce((a, m) => a + m.count, 0);
    if (months.length < minMonthsPerYear) return { year, mean: null, count, months: months.length };
    let total = 0;
    let days = 0;
    for (const m of months) {
      const d = daysInMonth(year, Number(m.month.slice(5, 7)));
      total += m.mean * d;
      days += d;
    }
    return { year, mean: total / days, count, months: months.length };
  });
  const climatology: ClimatologyMonth[] = [...byCalendarMonth]
    .sort(([a], [b]) => a - b)
    .map(([month, values]) => ({ month, mean: mean(values), count: values.length }));

  const summary: TrendSummary = {
    firstDate: first.date.slice(0, 10),
    lastDate: last.date.slice(0, 10),
    n: valid.length,
    annual,
    monthly,
    climatology,
    olsSlopePerDecade: null,
    senSlopePerDecade: null,
    mannKendallZ: null,
    mannKendallP: null,
  };

  const complete = annual.filter((a): a is AnnualMean & { mean: number } => a.mean !== null);
  const span = annual.length ? annual[annual.length - 1]!.year - annual[0]!.year + 1 : 0;
  if (complete.length < Math.max(3, minYears) || complete.length / span < minCoverage) return summary;

  const years = complete.map((a) => a.year);
  const means = complete.map((a) => a.mean);
  const test = mannKendall(means);
  return {
    ...summary,
    olsSlopePerDecade: olsSlope(years, means) * 10,
    senSlopePerDecade: senSlope(years, means) * 10,
    mannKendallZ: test.z,
    mannKendallP: test.p,
  };
}
