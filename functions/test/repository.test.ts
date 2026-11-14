import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { AnalysisRepository } from '../src/repository';
import { consumeQuota } from '../src/quota';
import { assembleResult, summarizeSeries } from '../src/analysis';
import { LEASE_MS } from '../src/config.constant';
import { hash } from '../src/cache';
import { MemoryFirestore } from './firestore-fixture.types';
import { location, makeMonthly, makeSeries, spec } from './fixtures.types';

test('repeated creation is idempotent, charges once and rejects requestId reuse with a changed spec', async () => {
  const db = new MemoryFirestore();
  const repo = new AnalysisRepository(db.asFirestore());
  const responses = await Promise.all(Array.from({ length: 5 }, () => repo.create('owner', spec, 'request-123')));
  assert.ok(responses.every(response => response.analysisId === responses[0]!.analysisId));
  assert.equal([...db.documents.keys()].filter(key => key.startsWith('analyses/')).length, 1);
  const global = db.documents.get(`quotas/global_${new Date().toISOString().slice(0, 10)}`)!;
  assert.equal(global.createAnalysis, 1);
  await assert.rejects(() => repo.create('owner', { ...spec, endYear: 2019 }, 'request-123'), /requestId/);
});

test('ownership is isolated and another user cannot retrieve an analysis', async () => {
  const db = new MemoryFirestore();
  const repo = new AnalysisRepository(db.asFirestore());
  const { analysisId } = await repo.create('owner', spec, 'request-123');
  assert.equal((await repo.get('owner', analysisId)).ownerId, 'owner');
  await assert.rejects(() => repo.get('other', analysisId), /No se encontró/);
  const other = await repo.create('other', spec, 'request-123');
  assert.notEqual(other.analysisId, analysisId);
});

test('creation quota is per UTC hour and is separate from daily search and interpretation budgets', async () => {
  const db = new MemoryFirestore();
  for (let i = 0; i < 10; i++) await consumeQuota(db.asFirestore(), 'owner', 'createAnalysis');
  await assert.rejects(() => consumeQuota(db.asFirestore(), 'owner', 'createAnalysis'), /por hora/);
  await consumeQuota(db.asFirestore(), 'owner', 'searchLocations');
  await consumeQuota(db.asFirestore(), 'owner', 'interpretQuery');
  const now = new Date().toISOString();
  const hourly = db.documents.get(`quotas/${hash('owner')}_${now.slice(0, 13)}`)!;
  assert.equal(hourly.createAnalysis, 10);
  const global = db.documents.get(`quotas/global_${now.slice(0, 10)}`)!;
  assert.equal(global.createAnalysis, 10);
  assert.equal(global.searchLocations, 1);
  assert.equal(global.interpretQuery, 1);
});

test('global creation budget cannot be exhausted by search, and creation cannot consume the search budget', async () => {
  const db = new MemoryFirestore();
  const day = new Date().toISOString().slice(0, 10);
  db.documents.set(`quotas/global_${day}`, { createAnalysis: 100, searchLocations: 1999, interpretQuery: 0 });
  await consumeQuota(db.asFirestore(), 'owner', 'searchLocations');
  await consumeQuota(db.asFirestore(), 'owner', 'interpretQuery');
  await assert.rejects(() => consumeQuota(db.asFirestore(), 'owner', 'createAnalysis'), /capacidad diaria/);
  await assert.rejects(() => consumeQuota(db.asFirestore(), 'another-owner', 'searchLocations'), /capacidad diaria/);
  assert.equal(db.documents.get(`quotas/global_${day}`)!.createAnalysis, 100);
});

test('leases reject duplicate active delivery and stale workers cannot overwrite the new worker', async () => {
  const db = new MemoryFirestore();
  const repo = new AnalysisRepository(db.asFirestore());
  const { analysisId } = await repo.create('owner', spec, 'request-123');
  const first = (await repo.claim(analysisId))!;
  await assert.rejects(() => repo.claim(analysisId), /Lease activa/);
  const now = Date.now();
  const clock = mock.method(Date, 'now', () => now + LEASE_MS + 1);
  let second;
  try { second = (await repo.claim(analysisId))!; } finally { clock.mock.restore(); }
  const result = assembleResult(spec, [summarizeSeries(location, spec, spec, makeSeries(makeMonthly(1991, 2020)))], []);
  await repo.finish(analysisId, first.token, result);
  assert.equal((await repo.get('owner', analysisId)).status, 'processing');
  await repo.finish(analysisId, second.token, result);
  assert.equal((await repo.get('owner', analysisId)).status, 'completed');
  assert.equal(await repo.claim(analysisId), null);
});

test('unexpected failure retries terminate after three attempts', async () => {
  const db = new MemoryFirestore();
  const repo = new AnalysisRepository(db.asFirestore());
  const { analysisId } = await repo.create('owner', spec, 'request-123');
  for (let i = 0; i < 3; i++) {
    const claim = (await repo.claim(analysisId))!;
    assert.equal(claim.job.attempts, i + 1);
    await repo.release(analysisId, claim.token);
  }
  assert.equal(await repo.claim(analysisId), null);
  assert.equal((await repo.get('owner', analysisId)).status, 'failed');
});
