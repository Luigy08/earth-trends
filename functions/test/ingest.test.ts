import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CANONICAL_VARIABLES } from '../src/datasources/catalog/canonical-variables.constant';
import type { BalamQuery, DateValue, ParameterSeries } from '../src/datasources/datasources.types';
import { DataSourceRegistry } from '../src/datasources/registry';
import type { IngestTarget } from '../src/ingest/ingest.types';
import { splitRange, toObservationRows, trailingWindow } from '../src/ingest/ingest.resolver';
import { IngestService } from '../src/ingest/service';
import { INGEST_TARGETS } from '../src/ingest/targets.constant';
import { MemoryBalamRepository, ScriptedSource } from './balam-fixtures.types';

const NDVI: IngestTarget = { variableId: 'ndvi', parameter: 'appeears/MOD13Q1.061/_250m_16_days_NDVI:idx', mode: 'range', zoneLevel: 'ADM1', since: '2000-02-18', chunkYears: 5, cadenceDays: 16 };
const AIR: IngestTarget = { variableId: 'air_temperature_2m', parameter: 'meteomatics/t_2m:C', mode: 'trailing', zoneLevel: 'ADM1', trailingHours: 24, step: 'PT1H', utcOffsetHours: -6, minSamplesPerDay: 18 };

/** One value on the 15th of every month in the requested range: 0.4 + 0.01 per year since 2000. */
function monthlyNdvi(_zoneId: string, query: BalamQuery): DateValue[] {
  const dates: DateValue[] = [];
  const cursor = new Date(Date.UTC(query.time.start.getUTCFullYear(), query.time.start.getUTCMonth(), 15));
  for (; cursor <= query.time.end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    if (cursor < query.time.start) continue;
    const mean = 0.4 + 0.01 * (cursor.getUTCFullYear() - 2000);
    dates.push({ date: cursor.toISOString().replace('.000Z', 'Z'), value: mean, stats: { mean, min: 0.1, max: 0.9, median: mean, std: 0.05, count: 1000 } });
  }
  return dates;
}

function hourlyTemperature(zoneId: string, query: BalamQuery): DateValue[] {
  const base = zoneId === 'HN-CR' ? 26 : 20;
  const dates: DateValue[] = [];
  for (let t = query.time.start.getTime(), i = 0; t <= query.time.end.getTime(); t += 3_600_000, i++) {
    dates.push({ date: new Date(t).toISOString().replace('.000Z', 'Z'), value: base + (i % 2 ? 1 : -1) });
  }
  return dates;
}

function setup(targets: IngestTarget[], nowIso: string) {
  let now = new Date(nowIso);
  const repo = new MemoryBalamRepository();
  repo.clock = () => now;
  const appeears = new ScriptedSource('appeears', false, monthlyNdvi);
  const meteomatics = new ScriptedSource('meteomatics', true, hourlyTemperature);
  const registry = new DataSourceRegistry().register(meteomatics).register(appeears);
  const service = new IngestService(repo, registry, { targets, now: () => now });
  return { repo, appeears, meteomatics, service, setNow: (iso: string) => { now = new Date(iso); } };
}

test('every ingestion target uses a binding of its canonical variable', () => {
  assert.deepEqual(INGEST_TARGETS.map((t) => t.variableId),
    ['land_surface_temperature_day', 'ndvi', 'evapotranspiration', 'soil_moisture_surface', 'air_temperature_2m']);
  for (const target of INGEST_TARGETS) {
    const variable = CANONICAL_VARIABLES.find((v) => v.id === target.variableId);
    assert.ok(variable?.bindings.some((b) => b.parameter === target.parameter), `${target.parameter} is not a binding of ${target.variableId}`);
  }
});

test('splitRange produces contiguous blocks that cover the range exactly', () => {
  const chunks = splitRange('2000-02-18', '2026-11-15', 5);
  assert.deepEqual(chunks[0], { start: '2000-02-18', end: '2005-02-17' });
  assert.deepEqual(chunks[chunks.length - 1], { start: '2025-02-18', end: '2026-11-15' });
  assert.equal(chunks.length, 6);
  for (let i = 1; i < chunks.length; i++) {
    assert.equal(new Date(`${chunks[i]!.start}T00:00:00Z`).getTime() - new Date(`${chunks[i - 1]!.end}T00:00:00Z`).getTime(), 86_400_000);
  }
  assert.deepEqual(splitRange('2024-03-01', '2024-03-01', 5), [{ start: '2024-03-01', end: '2024-03-01' }]);
  assert.deepEqual(splitRange('2024-03-02', '2024-03-01', 5), []);
});

test('plan requests only the next block and never duplicates a request in flight', async () => {
  const { repo, appeears, service } = setup([NDVI], '2026-11-15T06:15:00Z');
  const first = await service.plan();
  assert.deepEqual(first.created.map((j) => [j.variableId, j.source, j.start, j.end, j.status]), [['ndvi', 'appeears', '2000-02-18', '2005-02-17', 'pending']]);
  assert.equal(appeears.submitted.length, 1);
  const query = appeears.submitted[0]!;
  assert.equal(query.location.kind, 'zones');
  assert.deepEqual(query.location.kind === 'zones' && query.location.zones.map((z) => z.id), ['HN-CR', 'HN-FM']);
  assert.equal(query.time.start.toISOString(), '2000-02-18T00:00:00.000Z');
  assert.deepEqual(repo.jobs[0]!.zoneIds, ['HN-CR', 'HN-FM']);

  const second = await service.plan();
  assert.equal(second.created.length, 0);
  assert.match(second.skipped[0]!.reason, /already in progress/);
  assert.equal(appeears.submitted.length, 1);
});

test('process never waits: unfinished jobs stay pending, finished ones are stored once', async () => {
  const { repo, appeears, service, setNow } = setup([NDVI], '2026-11-15T06:15:00Z');
  await service.plan();

  const waiting = await service.process();
  assert.deepEqual([waiting.done.length, waiting.waiting.length, waiting.failed.length], [0, 1, 0]);
  assert.equal(repo.jobs[0]!.status, 'processing');
  assert.equal(repo.observations.size, 0);

  appeears.ready = true;
  const stored = await service.process();
  assert.equal(stored.done.length, 1);
  assert.equal(repo.jobs[0]!.status, 'done');
  // 2000-03 … 2005-02 on the 15th: 60 dates × 2 zones.
  assert.equal(stored.done[0]!.rows, 120);
  assert.equal(repo.observations.size, 120);
  const row = repo.observations.get('ndvi|appeears|HN-FM|2003-06-15')!;
  assert.deepEqual([row.parameter, row.min, row.max, row.std, row.count], [NDVI.parameter, 0.1, 0.9, 0.05, 1000]);
  assert.ok(Math.abs(row.value! - 0.43) < 1e-12);
  assert.equal(repo.deletedQueryJobs.length, 1);

  // Four complete years cannot support inference: descriptive data only.
  const trend = repo.trendRecords.get('ndvi|appeears|HN-FM')!;
  assert.equal(trend.unit, 'idx');
  assert.deepEqual([trend.firstDate, trend.lastDate, trend.n], ['2000-03-15', '2005-02-15', 60]);
  assert.equal(trend.mannKendallP, null);

  const again = await service.process();
  assert.deepEqual([again.done.length, again.waiting.length], [0, 0]);
  assert.equal(repo.observations.size, 120);

  // The next run continues right after the last stored date.
  setNow('2026-11-16T06:15:00Z');
  const next = await service.plan();
  assert.deepEqual(next.created.map((j) => [j.start, j.end]), [['2005-02-16', '2010-02-15']]);
});

test('backfill requests every missing block at once and the trend becomes available', async () => {
  const { repo, appeears, service } = setup([NDVI], '2026-11-15T06:15:00Z');
  const plan = await service.plan({ backfill: true });
  assert.equal(plan.created.length, 6);
  assert.equal(plan.created[5]!.end, '2026-11-15');
  appeears.ready = true;
  const processed = await service.process();
  assert.equal(processed.done.length, 6);
  const trend = repo.trendRecords.get('ndvi|appeears|HN-CR')!;
  assert.ok(Math.abs(trend.olsSlopePerDecade! - 0.1) < 1e-9);
  assert.ok(trend.mannKendallP! < 0.001);
  assert.equal(trend.annual.find((a) => a.year === 2000)!.mean, null); // 2000 starts in March
});

test('a product is not requested again before its cadence has passed', async () => {
  const { repo, appeears, service } = setup([NDVI], '2026-11-15T06:15:00Z');
  await repo.upsertObservations([{ variableId: 'ndvi', source: 'appeears', parameter: NDVI.parameter, zoneId: 'HN-FM', date: '2026-11-01', value: 0.6, min: null, max: null, median: null, std: null, count: null }]);
  const plan = await service.plan();
  assert.equal(plan.created.length, 0);
  assert.match(plan.skipped[0]!.reason, /cadence/);
  assert.equal(appeears.submitted.length, 0);
});

test('synchronous sources are stored in the same run as a daily mean of the trailing 24 hours', async () => {
  // 00:15 in Tegucigalpa (UTC−6).
  const { repo, meteomatics, service } = setup([AIR], '2026-11-15T06:15:00Z');
  const plan = await service.plan();
  assert.deepEqual(plan.created.map((j) => [j.start, j.end, j.status]), [['2026-11-14', '2026-11-14', 'done']]);
  assert.equal(plan.rows, 2);
  const query = meteomatics.submitted[0]!;
  assert.deepEqual([query.time.start.toISOString(), query.time.end.toISOString(), query.time.step], ['2026-11-14T07:00:00.000Z', '2026-11-15T06:00:00.000Z', 'PT1H']);
  const row = repo.observations.get('air_temperature_2m|meteomatics|HN-CR|2026-11-14')!;
  assert.deepEqual([row.value, row.min, row.max, row.median, row.std, row.count], [26, 25, 27, null, null, 24]);
  assert.equal(repo.observations.get('air_temperature_2m|meteomatics|HN-FM|2026-11-14')!.value, 20);
  assert.equal(repo.jobs[0]!.status, 'done');

  const again = await service.plan();
  assert.equal(again.created.length, 0);
  assert.equal(again.skipped[0]!.reason, 'Up to date');
  assert.equal(meteomatics.submitted.length, 1);
});

test('a source failure is recorded as an error, stores nothing and is not retried immediately', async () => {
  const { repo, meteomatics, service, setNow } = setup([AIR], '2026-11-15T06:15:00Z');
  meteomatics.failure = '403 Forbidden';
  const plan = await service.plan();
  assert.deepEqual(plan.created.map((j) => j.status), ['error']);
  assert.equal(repo.jobs[0]!.error, '403 Forbidden');
  assert.equal(repo.observations.size, 0);
  assert.equal(repo.trendRecords.size, 0);

  setNow('2026-11-15T06:45:00Z');
  const retry = await service.plan();
  assert.equal(retry.created.length, 0);
  assert.match(retry.skipped[0]!.reason, /requested recently/);
  assert.equal(meteomatics.submitted.length, 1);

  meteomatics.failure = undefined;
  setNow('2026-11-16T06:15:00Z');
  assert.deepEqual((await service.plan()).created.map((j) => [j.start, j.status]), [['2026-11-15', 'done']]);
});

test('plan reports missing zones instead of requesting an empty area', async () => {
  const { repo, appeears, service } = setup([NDVI], '2026-11-15T06:15:00Z');
  repo.zoneRecords = [];
  const plan = await service.plan();
  assert.equal(plan.created.length, 0);
  assert.match(plan.skipped[0]!.reason, /No ADM1 zones/);
  assert.equal(appeears.submitted.length, 0);
});

test('trailingWindow labels the window with the local date it starts on', () => {
  const window = trailingWindow(new Date('2026-11-15T06:15:00Z'), 24, -6);
  assert.equal(window.time.start.toISOString(), '2026-11-14T07:00:00.000Z');
  assert.equal(window.time.end.toISOString(), '2026-11-15T06:00:00.000Z');
  assert.equal(window.label, '2026-11-14');
});

test('toObservationRows keeps area statistics, averages sub-daily samples and never imputes', () => {
  const series: ParameterSeries = {
    parameter: 'appeears/SPL4SMGP.008/Geophysical_Data_sm_surface:m3m3', source: 'appeears', unit: 'm3m3',
    coordinates: [
      { lat: 14.2, lon: -87.2, id: 'HN-FM', dates: [
        { date: '2024-01-01T01:30:00Z', value: 0.2, stats: { min: 0.1, max: 0.3 } },
        { date: '2024-01-01T04:30:00Z', value: 0.4, stats: { min: 0.2, max: 0.5 } },
        { date: '2024-01-01T07:30:00Z', value: null },
        { date: '2024-01-02T01:30:00Z', value: 0.3, stats: { min: 0.25, max: 0.35, median: 0.31, std: 0.02, count: 80 } },
        { date: '2024-01-03T01:30:00Z', value: null },
      ] },
      { lat: 0, lon: 0, id: 'HN-XX', dates: [{ date: '2024-01-01T00:00:00Z', value: 1 }] },
      { lat: 0, lon: 0, dates: [{ date: '2024-01-01T00:00:00Z', value: 1 }] },
    ],
  };
  const rows = toObservationRows(series, { variableId: 'soil_moisture_surface', zoneIds: new Set(['HN-FM']) });
  assert.equal(rows.length, 3); // unknown and unidentified zones are dropped
  const [first, second, third] = rows;
  assert.ok(Math.abs(first!.value! - 0.3) < 1e-12);
  assert.deepEqual([first!.date, first!.min, first!.max, first!.median, first!.std, first!.count], ['2024-01-01', 0.1, 0.5, null, null, 2]);
  assert.deepEqual([second!.value, second!.min, second!.max, second!.median, second!.std, second!.count], [0.3, 0.25, 0.35, 0.31, 0.02, 80]);
  assert.deepEqual([third!.date, third!.value, third!.count], ['2024-01-03', null, null]);

  const strict = toObservationRows(series, { variableId: 'soil_moisture_surface', zoneIds: new Set(['HN-FM']), minSamples: 3 });
  assert.deepEqual(strict.map((r) => [r.date, r.value, r.count]), [['2024-01-01', null, 2], ['2024-01-02', null, 1], ['2024-01-03', null, 0]]);
});
