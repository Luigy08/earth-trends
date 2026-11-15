import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeTrend, mannKendall, olsSlope, senSlope } from '../src/ingest/trends';

const close = (actual: number | null, expected: number, tolerance = 1e-9) =>
  assert.ok(actual !== null && Math.abs(actual - expected) < tolerance, `${actual} is not within ${tolerance} of ${expected}`);

/** One observation per month; `value` receives the year and the month (1–12). */
function monthlySeries(startYear: number, endYear: number, value: (year: number, month: number) => number | null) {
  const points: { date: string; value: number | null }[] = [];
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) points.push({ date: `${year}-${String(month).padStart(2, '0')}-15`, value: value(year, month) });
  }
  return points;
}

test('a synthetic series with a known slope returns that slope per decade', () => {
  const trend = computeTrend(monthlySeries(2001, 2020, (year) => 10 + 0.05 * (year - 2001)))!;
  close(trend.olsSlopePerDecade, 0.5);
  close(trend.senSlopePerDecade, 0.5);
  close(trend.mannKendallZ, 189 / Math.sqrt(950)); // S = 190, Var = 20·19·45/18
  assert.ok(trend.mannKendallP! < 1e-8);
  assert.equal(trend.n, 240);
  assert.equal(trend.firstDate, '2001-01-15');
  assert.equal(trend.lastDate, '2020-12-15');
  assert.equal(trend.annual.length, 20);
  close(trend.annual[0]!.mean, 10);
  assert.equal(trend.monthly.length, 240);
});

test('a seasonal cycle does not hide the trend and shapes the climatology', () => {
  const season = (month: number) => 5 * Math.sin(((month - 1) / 12) * 2 * Math.PI);
  const trend = computeTrend(monthlySeries(2001, 2020, (year, month) => 20 - 0.1 * (year - 2001) + season(month)))!;
  close(trend.olsSlopePerDecade, -1, 0.01); // leap years shift the day-weighted annual mean slightly
  close(trend.senSlopePerDecade, -1, 0.01);
  assert.ok(trend.mannKendallZ! < -5);
  assert.equal(trend.climatology.length, 12);
  assert.deepEqual(trend.climatology.map((c) => c.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  close(trend.climatology[3]!.mean - trend.climatology[0]!.mean, season(4) - season(1));
  assert.equal(trend.climatology[0]!.count, 20);
});

test('daily observations become monthly means and a calendar-day-weighted annual mean', () => {
  const points: { date: string; value: number | null }[] = [];
  for (let day = 0; day < 366; day++) {
    const date = new Date(Date.UTC(2020, 0, 1 + day)).toISOString().slice(0, 10);
    points.push({ date, value: date.startsWith('2020-02') ? 10 : 0 });
  }
  const trend = computeTrend(points)!;
  assert.deepEqual(trend.monthly[1], { month: '2020-02', mean: 10, count: 29 });
  close(trend.annual[0]!.mean, 290 / 366);
  assert.equal(trend.annual[0]!.count, 366);
});

test('Sen slope resists an outlier that distorts OLS', () => {
  const years = Array.from({ length: 20 }, (_, i) => 2001 + i);
  const values = years.map((year, i) => (i === 10 ? 100 : 2 + 0.3 * (year - 2001)));
  close(senSlope(years, values), 0.3);
  assert.ok(Math.abs(olsSlope(years, values) - 0.3) > 0.05);
});

test('Mann–Kendall corrects the variance for ties', () => {
  const tied = mannKendall([1, 1, 2, 2, 3]);
  assert.equal(tied.s, 8);
  close(tied.variance, (5 * 4 * 15 - 2 * (2 * 1 * 9)) / 18);
  close(tied.z, 7 / Math.sqrt(264 / 18));
  assert.ok(tied.p > 0.067 && tied.p < 0.068);
  const untied = mannKendall([1, 2, 3, 4, 5]);
  close(untied.variance, (5 * 4 * 15) / 18);
});

test('Mann–Kendall finds no trend in a constant or alternating series', () => {
  assert.deepEqual(mannKendall([4, 4, 4, 4, 4, 4]), { s: 0, variance: 0, z: 0, p: 1 });
  const alternating = mannKendall(Array.from({ length: 20 }, (_, i) => (i % 2 ? 1 : -1)));
  assert.ok(Math.abs(alternating.z) < 1);
  assert.ok(alternating.p > 0.05);
});

test('years with too few months are ignored and the threshold is configurable', () => {
  // 2010 only has six valid months: it would bias the annual mean toward the first half of the year.
  const points = monthlySeries(2001, 2020, (year, month) => (year === 2010 && month > 6 ? null : year === 2010 ? 500 : 10 + 0.05 * (year - 2001)));
  const strict = computeTrend(points)!;
  assert.deepEqual(strict.annual.find((a) => a.year === 2010), { year: 2010, mean: null, count: 6, months: 6 });
  close(strict.olsSlopePerDecade, 0.5);
  const lenient = computeTrend(points, { minMonthsPerYear: 6 })!;
  close(lenient.annual.find((a) => a.year === 2010)!.mean, 500);
  assert.ok(Math.abs(lenient.olsSlopePerDecade! - 0.5) > 0.1); // the biased year now distorts the slope
});

test('too few complete years keep the descriptive series but report no statistics', () => {
  const trend = computeTrend(monthlySeries(2015, 2020, (year) => year))!;
  assert.equal(trend.annual.length, 6);
  assert.equal(trend.monthly.length, 72);
  assert.deepEqual([trend.olsSlopePerDecade, trend.senSlopePerDecade, trend.mannKendallZ, trend.mannKendallP], [null, null, null, null]);
  close(computeTrend(monthlySeries(2015, 2020, (year) => year), { minYears: 5 })!.olsSlopePerDecade, 10);
});

test('low coverage of the observed period blocks inference', () => {
  // 12 complete years spread over 2001–2020: 60 % coverage, below the 80 % threshold.
  const points = monthlySeries(2001, 2020, (year) => ((year - 2001) % 5 < 3 ? year : null));
  const trend = computeTrend(points)!;
  assert.equal(trend.annual.filter((a) => a.mean !== null).length, 12);
  assert.equal(trend.mannKendallP, null);
  assert.ok(computeTrend(points, { minCoverage: 0.5 })!.mannKendallP !== null);
});

test('missing and non-finite values are never counted, and an empty series has no trend', () => {
  const trend = computeTrend([{ date: '2020-01-01', value: null }, { date: '2020-01-02', value: Number.NaN }, { date: '2020-01-03', value: 7 }])!;
  assert.equal(trend.n, 1);
  assert.deepEqual(trend.monthly, [{ month: '2020-01', mean: 7, count: 1 }]);
  assert.equal(computeTrend([{ date: '2020-01-01', value: null }]), null);
  assert.equal(computeTrend([]), null);
});
