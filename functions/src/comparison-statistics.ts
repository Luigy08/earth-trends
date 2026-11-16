import { jStat } from 'jstat';
import type { AnnualObservation, ComparableSeries, ComparisonStatistics, CorrelationEstimate, MonthlyObservation, TrendStatistics } from '../../shared/types';
import { MAX_COMPARISON_LAG_MONTHS, MIN_COMMON_MONTHS, MIN_YEARS } from './config.constant';
import { calculateTrend } from './statistics';

export interface AlignedMonth { year: number; month: number; a: number; b: number }

const monthIndex = (year: number, month: number) => year * 12 + month - 1;
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** Months where both series have a valid value. Nothing is imputed. */
export function alignMonthly(a: MonthlyObservation[], b: MonthlyObservation[]): AlignedMonth[] {
  const other = new Map(b.filter(point => valid(point.value)).map(point => [monthIndex(point.year, point.month), point.value as number]));
  return a.flatMap(point => {
    const match = other.get(monthIndex(point.year, point.month));
    return valid(point.value) && match !== undefined ? [{ year: point.year, month: point.month, a: point.value, b: match }] : [];
  }).sort((x, y) => monthIndex(x.year, x.month) - monthIndex(y.year, y.month));
}

export function alignAnnual(a: AnnualObservation[], b: AnnualObservation[]): Array<{ year: number; a: number; b: number }> {
  const other = new Map(b.map(point => [point.year, point.value]));
  return a.flatMap(point => other.has(point.year) ? [{ year: point.year, a: point.value, b: other.get(point.year)! }] : []).sort((x, y) => x.year - y.year);
}

function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || xs.length !== ys.length) return null;
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < xs.length; i++) { const dx = xs[i]! - mx; const dy = ys[i]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx === 0 || syy === 0 ? null : Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
}

function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
  const output = new Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]!.value === order[start]!.value) end++;
    for (let k = start; k <= end; k++) output[order[k]!.index] = (start + end) / 2 + 1;
    start = end + 1;
  }
  return output;
}

/** Lag-1 autocorrelation over consecutive time steps only; gaps break the pairs. */
function lag1(points: Array<{ t: number; value: number }>): number {
  const pairs = points.flatMap((point, index) => index > 0 && point.t - points[index - 1]!.t === 1 ? [[points[index - 1]!.value, point.value] as const] : []);
  const r = pearson(pairs.map(pair => pair[0]), pairs.map(pair => pair[1]));
  return r === null ? 0 : r;
}

/** Pearson inference on an autocorrelation-adjusted sample size: n_eff = n(1 − r₁ᵃr₁ᵇ)/(1 + r₁ᵃr₁ᵇ) (Bretherton et al. 1999). */
function estimate(r: number, n: number, lagA: number, lagB: number): CorrelationEstimate {
  const product = Math.max(0, lagA * lagB);
  const effective = Math.max(4, Math.min(n, n * (1 - product) / (1 + product)));
  const df = effective - 2;
  const pValue = Math.abs(r) >= 1 ? 0 : Math.max(0, Math.min(1, 2 * jStat.studentt.cdf(-Math.abs(r) * Math.sqrt(df / (1 - r * r)), df)));
  const z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, r)));
  const margin = 1.959964 / Math.sqrt(effective - 3);
  return { r, sampleSize: n, effectiveSampleSize: effective, pValue, confidenceInterval95: [Math.tanh(z - margin), Math.tanh(z + margin)], significant: pValue < 0.05 };
}

function direction(trend: TrendStatistics | null): 'increase' | 'decrease' | 'flat' | 'unknown' {
  return !trend ? 'unknown' : trend.slopePerYear > 0 ? 'increase' : trend.slopePerYear < 0 ? 'decrease' : 'flat';
}

function detrendedResiduals(points: AnnualObservation[]): number[] {
  const trend = calculateTrend(points);
  return points.map(point => point.value - trend.intercept - trend.slopePerYear * point.year);
}

/**
 * Correlation between two monthly series. The headline is the correlation of deseasonalized anomalies
 * (each series minus its own calendar-month mean over the common months), because a shared annual cycle
 * makes raw monthly values correlate regardless of any real relationship. Returns null below the POC threshold.
 */
export function compareSeries(a: ComparableSeries, b: ComparableSeries): { aligned: AlignedMonth[]; commonYears: number; statistics: ComparisonStatistics | null; warnings: string[] } {
  const aligned = alignMonthly(a.monthly, b.monthly);
  const annual = alignAnnual(a.annual, b.annual);
  const warnings: string[] = [];
  if (aligned.length < MIN_COMMON_MONTHS) {
    warnings.push(`Only ${aligned.length} months have valid values in both series; at least ${MIN_COMMON_MONTHS} are required to estimate a correlation (operational threshold of this POC).`);
    return { aligned, commonYears: annual.length, statistics: null, warnings };
  }
  const climatology = (pick: (row: AlignedMonth) => number) => {
    const sums = new Map<number, number[]>();
    for (const row of aligned) sums.set(row.month, [...(sums.get(row.month) ?? []), pick(row)]);
    return new Map([...sums].map(([month, values]) => [month, mean(values)]));
  };
  const climateA = climatology(row => row.a); const climateB = climatology(row => row.b);
  const anomalies = aligned.map(row => ({ t: monthIndex(row.year, row.month), a: row.a - climateA.get(row.month)!, b: row.b - climateB.get(row.month)! }));
  const anomalyA = anomalies.map(row => row.a); const anomalyB = anomalies.map(row => row.b);
  const rawR = pearson(aligned.map(row => row.a), aligned.map(row => row.b));
  const anomalyR = pearson(anomalyA, anomalyB);
  if (rawR === null || anomalyR === null) {
    warnings.push('One of the series does not vary over the common months, so a correlation is undefined.');
    return { aligned, commonYears: annual.length, statistics: null, warnings };
  }
  const lagA = lag1(anomalies.map(row => ({ t: row.t, value: row.a })));
  const lagB = lag1(anomalies.map(row => ({ t: row.t, value: row.b })));
  const byTime = new Map(anomalies.map(row => [row.t, row]));
  let bestLag = { months: 0, r: anomalyR };
  for (let lag = -MAX_COMPARISON_LAG_MONTHS; lag <= MAX_COMPARISON_LAG_MONTHS; lag++) {
    if (lag === 0) continue;
    const pairs = anomalies.flatMap(row => { const later = byTime.get(row.t + lag); return later ? [[row.a, later.b] as const] : []; });
    if (pairs.length < MIN_COMMON_MONTHS) continue;
    const r = pearson(pairs.map(pair => pair[0]), pairs.map(pair => pair[1]));
    if (r !== null && Math.abs(r) > Math.abs(bestLag.r)) bestLag = { months: lag, r };
  }
  const varianceA = anomalyA.reduce((sum, value) => sum + value * value, 0);
  const slope = varianceA === 0 ? 0 : anomalies.reduce((sum, row) => sum + row.a * row.b, 0) / varianceA;

  let annualEstimate: CorrelationEstimate | null = null;
  let annualDetrendedR: number | null = null;
  if (annual.length >= MIN_YEARS) {
    const r = pearson(annual.map(row => row.a), annual.map(row => row.b));
    if (r !== null) {
      annualEstimate = estimate(r, annual.length,
        lag1(annual.map(row => ({ t: row.year, value: row.a }))), lag1(annual.map(row => ({ t: row.year, value: row.b }))));
      annualDetrendedR = pearson(detrendedResiduals(annual.map(row => ({ year: row.year, value: row.a, anomaly: null }))),
        detrendedResiduals(annual.map(row => ({ year: row.year, value: row.b, anomaly: null }))));
    }
  } else warnings.push(`Annual correlation needs at least ${MIN_YEARS} complete years in both series; ${annual.length} are available.`);

  const directions = { a: direction(a.trend), b: direction(b.trend) };
  const known = directions.a !== 'unknown' && directions.b !== 'unknown';
  return {
    aligned, commonYears: annual.length, warnings,
    statistics: {
      commonMonths: aligned.length, commonYears: annual.length, monthlyRawR: rawR,
      monthlyAnomaly: estimate(anomalyR, aligned.length, lagA, lagB),
      monthlyAnomalySpearman: pearson(ranks(anomalyA), ranks(anomalyB)) ?? 0,
      lag1AutocorrelationA: lagA, lag1AutocorrelationB: lagB, bestLag, anomalySlopeBOnA: slope,
      annual: annualEstimate, annualDetrendedR,
      trendDirections: { ...directions, agree: known ? directions.a === directions.b : null },
    },
  };
}
