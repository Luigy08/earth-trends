import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, handleBalamRequest } from '../src/balam/balam-api';
import type { ApiDependencies, ApiRequest } from '../src/balam/balam.types';
import { DataSourceRegistry } from '../src/datasources/registry';
import { INGEST_TARGETS } from '../src/ingest/targets.constant';
import { computeTrend } from '../src/ingest/trends';
import { MemoryBalamRepository, ScriptedSource } from './balam-fixtures.types';

const NDVI = 'appeears/MOD13Q1.061/_250m_16_days_NDVI:idx';

async function setup(user: string | null = 'user-1') {
  const repository = new MemoryBalamRepository();
  const points = Array.from({ length: 20 * 12 }, (_, i) => ({
    date: `${2001 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`, value: 0.4 + 0.01 * Math.floor(i / 12),
  }));
  await repository.upsertObservations(points.map((p) => ({ variableId: 'ndvi', source: 'appeears', parameter: NDVI, zoneId: 'HN-FM', ...p, min: 0.1, max: 0.9, median: null, std: null, count: 500 })));
  await repository.upsertObservations([{ variableId: 'ndvi', source: 'appeears', parameter: NDVI, zoneId: 'HN-CR', date: '2020-01-01', value: null, min: null, max: null, median: null, std: null, count: null }]);
  await repository.upsertTrend({ ...computeTrend(points)!, variableId: 'ndvi', source: 'appeears', zoneId: 'HN-FM', unit: 'idx' });
  await repository.upsertTrend({ ...computeTrend(points.slice(0, 24))!, variableId: 'ndvi', source: 'appeears', zoneId: 'HN-CR', unit: 'idx' });

  const meteomatics = new ScriptedSource('meteomatics', true, () => []);
  const registry = new DataSourceRegistry().register(meteomatics).register(new ScriptedSource('appeears', false, () => []));
  const quota: string[] = [];
  const deps: ApiDependencies = {
    repository, registry: () => registry, targets: INGEST_TARGETS,
    authenticate: async () => { if (!user) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.'); return user; },
    consumeQueryQuota: async (ownerId) => { quota.push(ownerId); },
  };
  const call = (method: string, path: string, query: Record<string, unknown> = {}, body?: unknown, as: ApiDependencies = deps) =>
    handleBalamRequest({ method, path, query, body } satisfies ApiRequest, as);
  return { call, deps, quota, repository, meteomatics };
}

const rejects = (promise: Promise<unknown>, status: number, code: string) =>
  assert.rejects(promise, (error: unknown) => error instanceof ApiError && error.status === status && error.code === code);

test('GET /variables lists canonical variables with their preloaded coverage', async () => {
  const { call } = await setup();
  const { status, body } = await call('GET', '/variables');
  assert.equal(status, 200);
  const { storeAvailable, variables } = body as { storeAvailable: boolean; variables: { id: string; bindings: unknown[]; preloaded: { source: string; stored: unknown }[] }[] };
  assert.equal(storeAvailable, true);
  const ndvi = variables.find((v) => v.id === 'ndvi')!;
  assert.ok(ndvi.bindings.length >= 2);
  assert.deepEqual(ndvi.preloaded, [{ parameter: NDVI, source: 'appeears', since: '2000-02-18', stored: { firstDate: '2001-01-01', lastDate: '2020-12-01', zones: 2 } }]);
  assert.equal(variables.find((v) => v.id === 'air_temperature_2m')!.preloaded[0]!.stored, null);
  assert.deepEqual(variables.find((v) => v.id === 'elevation')!.preloaded, []);
});

test('GET /zones omits geometry unless asked', async () => {
  const { call } = await setup();
  const plain = (await call('GET', '/zones')).body as { zones: Record<string, unknown>[] };
  assert.deepEqual(plain.zones.map((z) => z.id), ['HN-CR', 'HN-FM']);
  assert.equal('geometry' in plain.zones[0]!, false);
  const full = (await call('GET', '/zones', { geometry: '1' })).body as { zones: { geometry: { type: string } }[] };
  assert.equal(full.zones[0]!.geometry.type, 'Polygon');
  await rejects(call('GET', '/zones', { geometry: 'yes' }), 400, 'invalid_argument');
});

test('GET /series answers in the Meteomatics JSON shape and keeps missing values null', async () => {
  const { call } = await setup();
  const { body } = await call('GET', '/series', { variable: 'ndvi', zone: 'HN-FM,HN-CR', from: '2020-01-01', to: '2020-03-31' });
  const response = body as { status: string; version: string; data: { parameter: string; source: string; unit: string; coordinates: { id: string; lat: number; lon: number; dates: { date: string; value: number | null; stats?: unknown }[] }[] }[] };
  assert.equal(response.status, 'OK');
  assert.equal(response.data.length, 1);
  assert.deepEqual([response.data[0]!.parameter, response.data[0]!.source, response.data[0]!.unit], [NDVI, 'appeears', 'idx']);
  const [cortes, morazan] = response.data[0]!.coordinates;
  assert.deepEqual([cortes!.id, cortes!.lat, cortes!.lon], ['HN-CR', 15.5, -88]);
  assert.deepEqual(cortes!.dates, [{ date: '2020-01-01T00:00:00Z', value: null }]);
  assert.deepEqual(morazan!.dates.map((d) => d.date), ['2020-01-01T00:00:00Z', '2020-02-01T00:00:00Z', '2020-03-01T00:00:00Z']);
  assert.deepEqual(morazan!.dates[0]!.stats, { min: 0.1, max: 0.9, count: 500 });

  const empty = (await call('GET', '/series', { variable: 'ndvi', zone: 'HN-FM', source: 'meteomatics' })).body as { data: unknown[] };
  assert.deepEqual(empty.data, []);
});

test('GET /series validates its parameters with clear errors', async () => {
  const { call } = await setup();
  await rejects(call('GET', '/series', { zone: 'HN-FM' }), 400, 'invalid_argument');
  await rejects(call('GET', '/series', { variable: 'ndvi', zone: 'HN-FM', from: '2020-13-01' }), 400, 'invalid_argument');
  await rejects(call('GET', '/series', { variable: 'ndvi', zone: 'HN-FM', from: '2021-01-01', to: '2020-01-01' }), 400, 'invalid_argument');
  await rejects(call('GET', '/series', { variable: 'ndvi', zone: ['HN-FM', 'HN-CR'] }), 400, 'invalid_argument');
  await rejects(call('GET', '/series', { variable: 'rainbows', zone: 'HN-FM' }), 404, 'unknown_variable');
  await rejects(call('GET', '/series', { variable: 'ndvi', zone: 'HN-FM,HN-ZZ' }), 404, 'unknown_zone');
  await assert.rejects(call('GET', '/series', { zone: 'HN-FM' }), (error: unknown) => error instanceof ApiError
    && JSON.stringify(error.details) === JSON.stringify({ fields: [{ field: 'variable', message: 'Required' }] }));
});

test('GET /trends separates a significant trend from an unsupported inference', async () => {
  const { call } = await setup();
  const { body } = await call('GET', '/trends', { variable: 'ndvi' });
  const { trends } = body as { trends: { zoneId: string; inferenceSupported: boolean; significant: boolean | null; olsSlopePerDecade: number | null; annual: unknown[] }[] };
  const morazan = trends.find((t) => t.zoneId === 'HN-FM')!;
  assert.deepEqual([morazan.inferenceSupported, morazan.significant], [true, true]);
  assert.ok(Math.abs(morazan.olsSlopePerDecade! - 0.1) < 1e-9);
  const cortes = trends.find((t) => t.zoneId === 'HN-CR')!;
  assert.deepEqual([cortes.inferenceSupported, cortes.significant, cortes.olsSlopePerDecade], [false, null, null]);
  assert.equal(cortes.annual.length, 2);
  const one = (await call('GET', '/trends', { variable: 'ndvi', zone: 'HN-CR' })).body as { trends: unknown[] };
  assert.equal(one.trends.length, 1);
});

test('POST /query requires sign-in, consumes quota and answers synchronous sources at once', async () => {
  const anonymous = await setup(null);
  await rejects(anonymous.call('POST', '/query', {}, { path: '/2024-01-01T00:00:00Z/t_2m:C/14,-87' }), 401, 'unauthenticated');
  assert.equal(anonymous.meteomatics.submitted.length, 0);

  const { call, quota, meteomatics } = await setup();
  const { status, body } = await call('POST', '/query', {}, { path: '/2024-01-01T00:00:00Z--2024-01-02T00:00:00Z:PT1H/t_2m:C/14,-87' });
  assert.equal(status, 200);
  const result = body as { id: string; done: boolean; response: { status: string } };
  assert.deepEqual([result.done, result.response.status], [true, 'OK']);
  assert.deepEqual(quota, ['user-1']);
  assert.equal(meteomatics.submitted.length, 1);

  const polled = await call('GET', `/query/${result.id}`);
  assert.equal((polled.body as { done: boolean }).done, true);
});

test('asynchronous queries answer 202 and are only visible to their owner', async () => {
  const { call, deps } = await setup();
  const { status, body } = await call('POST', '/query', {}, { path: '/2024-01-01T00:00:00Z--2024-02-01T00:00:00Z/appeears/MOD13Q1.061/_250m_16_days_NDVI:idx/14,-87' });
  assert.equal(status, 202);
  const { id, done } = body as { id: string; done: boolean };
  assert.equal(done, false);
  const stranger: ApiDependencies = { ...deps, authenticate: async () => 'user-2' };
  await rejects(call('GET', `/query/${id}`, {}, undefined, stranger), 404, 'not_found');
  await rejects(call('GET', '/query/00000000-0000-4000-8000-000000000000'), 404, 'not_found');
  await rejects(call('GET', '/query/not-an-id'), 404, 'not_found');
});

test('POST /query rejects malformed or oversized requests before spending quota', async () => {
  const { call, quota, meteomatics } = await setup();
  await rejects(call('POST', '/query', {}, {}), 400, 'invalid_argument');
  await rejects(call('POST', '/query', {}, { path: '/not-a-date/t_2m:C/14,-87' }), 400, 'invalid_query');
  await rejects(call('POST', '/query', {}, { path: '/2024-01-01T00:00:00Z/t_2m/14,-87' }), 400, 'invalid_query');
  await rejects(call('POST', '/query', {}, { path: '/2024-01-01T00:00:00Z/t_2m:C/95,-87' }), 400, 'invalid_query');
  await rejects(call('POST', '/query', {}, { path: '/2024-01-01T00:00:00Z/t_2m:C/20,-90_10,-80' }), 400, 'invalid_query');
  await rejects(call('POST', '/query', {}, { path: `/2024-01-01T00:00:00Z/t_2m:C/${Array.from({ length: 11 }, (_, i) => `14,-${80 + i}`).join('+')}` }), 400, 'invalid_query');
  assert.deepEqual(quota, []);
  assert.equal(meteomatics.submitted.length, 0);
});

test('unknown routes and wrong methods are rejected', async () => {
  const { call } = await setup();
  await rejects(call('GET', '/nothing'), 404, 'not_found');
  await rejects(call('POST', '/series'), 405, 'method_not_allowed');
  await rejects(call('GET', '/query'), 405, 'method_not_allowed');
  assert.equal((await call('GET', '/zones/')).status, 200);
});
