import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnalysisService, summarizeSeries } from '../src/analysis';
import { location, makeMonthly, makeSeries, MemoryCache, spec } from './fixtures.types';

test('minimum 10 complete years and 80% coverage are enforced independently', () => {
  const input = { ...spec, startYear: 2000, endYear: 2009 };
  const nine = summarizeSeries(location, input, input, makeSeries(makeMonthly(2000, 2008)));
  assert.equal(nine.outcome, 'insufficient_data');
  assert.equal(nine.trend, null);
  const sufficient = summarizeSeries(location, input, input, makeSeries(makeMonthly(2000, 2009)));
  assert.equal(sufficient.outcome, 'sufficient_data');
  const lowCoverage = summarizeSeries(location, spec, spec, makeSeries(makeMonthly(1991, 2013)));
  assert.equal(lowCoverage.trend, null);
  const boundary = summarizeSeries(location, spec, spec, makeSeries(makeMonthly(1991, 2014)));
  assert.equal(boundary.quality.coverage, 0.8);
  assert.ok(boundary.trend);
});

test('short ordered period has descriptive data but no inference', async () => {
  const service = new AnalysisService({ getMonthly: async () => makeSeries(makeMonthly(1991, 2020)) }, new MemoryCache());
  const result = await service.run({ ...spec, startYear: 2019, endYear: 2020 });
  assert.equal(result.outcome, 'insufficient_data');
  assert.equal(result.locations[0]!.annual.length, 2);
  assert.equal(result.locations[0]!.trend, null);
  assert.match(result.narrative, /insuficientes/);
});

test('baseline uses exactly 1991–2020, withholds incomplete baseline and normalizes public monthly precipitation', () => {
  const monthly = makeMonthly(1990, 2021).map(p => ({ ...p, value: p.year === 1990 || p.year === 2021 ? 100 : 20 }));
  const result = summarizeSeries(location, spec, spec, makeSeries(monthly));
  assert.equal(result.baseline.mean, 20);
  assert.equal(result.annual[0]!.anomaly, 0);
  const partial = summarizeSeries(location, spec, spec, makeSeries(monthly.filter(p => !(p.year === 2000 && p.month === 1))));
  assert.equal(partial.baseline.mean, null);
  assert.ok(partial.annual.every(p => p.anomaly === null));
  const rainSpec = { ...spec, metric: 'precipitation' as const };
  const rain = summarizeSeries(location, rainSpec, rainSpec, makeSeries(makeMonthly(1991, 2020, 2)));
  assert.equal(rain.monthly.find(p => p.year === 2020 && p.month === 2)!.value, 58);
  assert.equal(rain.annual.find(p => p.year === 2020)!.value, 732);
});

test('location comparison uses only complete common calendar years for both trends', async () => {
  const second = { ...location, id: '2', name: 'Second', latitude: 15 };
  const service = new AnalysisService({ getMonthly: async row => makeSeries(makeMonthly(row.id === '1' ? 1991 : 1993, row.id === '1' ? 2018 : 2020)) }, new MemoryCache());
  const result = await service.run({ ...spec, locations: [location, second], comparisonMode: 'locations' });
  assert.deepEqual(result.commonYears, Array.from({ length: 26 }, (_, i) => 1993 + i));
  assert.deepEqual(result.locations[0]!.annual.map(p => p.year), result.locations[1]!.annual.map(p => p.year));
  assert.equal(result.locations[0]!.trend!.sampleSize, 26);
});

test('two periods retain their own calendar years and descriptive mean difference', async () => {
  const monthly = makeMonthly(1981, 2020).map(p => ({ ...p, value: p.year < 2001 ? 10 : 12 }));
  const service = new AnalysisService({ getMonthly: async () => makeSeries(monthly) }, new MemoryCache());
  const result = await service.run({ ...spec, startYear: 1981, endYear: 2000, comparisonMode: 'periods', secondPeriod: { startYear: 2001, endYear: 2020 } });
  assert.equal(result.locations.length, 2);
  assert.equal(result.locations[0]!.annual[0]!.year, 1981);
  assert.equal(result.locations[1]!.annual[0]!.year, 2001);
  assert.equal(result.comparison!.meanDifference, 2);
  assert.equal(result.comparison!.mode, 'periods');
});

test('source failure is a scientific outcome with no invented series, slope or p-value', async () => {
  const service = new AnalysisService({ getMonthly: async () => { throw new Error('offline'); } }, new MemoryCache());
  const result = await service.run(spec);
  assert.equal(result.outcome, 'source_unavailable');
  assert.equal(result.locations[0]!.trend, null);
  assert.equal(result.locations[0]!.provenance, null);
  assert.deepEqual(result.locations[0]!.monthly, []);
});
