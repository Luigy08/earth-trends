import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisSpecSchema, createAnalysisSchema, parseInput } from '../src/validation';
import { spec } from './fixtures.types';

test('short periods are accepted but inverted, future and pre-1981 ranges are rejected', () => {
  assert.ok(analysisSpecSchema.safeParse({ ...spec, startYear: 2020, endYear: 2020 }).success);
  assert.ok(!analysisSpecSchema.safeParse({ ...spec, startYear: 2020, endYear: 2019 }).success);
  assert.ok(!analysisSpecSchema.safeParse({ ...spec, startYear: 1980 }).success);
  assert.ok(!analysisSpecSchema.safeParse({ ...spec, endYear: new Date().getUTCFullYear() }).success);
});

test('comparison shape cannot invent a second location or an unordered second period', () => {
  assert.ok(!analysisSpecSchema.safeParse({ ...spec, comparisonMode: 'locations' }).success);
  assert.ok(!analysisSpecSchema.safeParse({ ...spec, comparisonMode: 'periods' }).success);
  assert.ok(!analysisSpecSchema.safeParse({ ...spec, comparisonMode: 'periods', secondPeriod: { startYear: 2000, endYear: 1999 } }).success);
  assert.ok(analysisSpecSchema.safeParse({ ...spec, comparisonMode: 'periods', secondPeriod: { startYear: 2020, endYear: 2020 } }).success);
});

test('owner injection and oversized array payloads are rejected before schema parsing', () => {
  assert.throws(() => parseInput(createAnalysisSchema, { spec, requestId: 'request-123', ownerId: 'victim' }));
  assert.throws(() => parseInput(createAnalysisSchema, { spec, requestId: 'request-123', extra: Array.from({ length: 10000 }, () => '💥') }), /20 KB/);
});
