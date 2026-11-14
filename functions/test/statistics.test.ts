import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annualize, calculateTrend } from '../src/statistics';
import { makeMonthly } from './fixtures.types';

test('temperature is weighted by calendar days, including leap February', () => {
  const monthly = makeMonthly(2020, 2020, 0).map(p => ({ ...p, value: p.month === 2 ? 10 : 0 }));
  assert.equal(annualize(monthly, 'temperature')[0]!.value, 290 / 366);
});

test('precipitation rate becomes accumulated annual mm, including leap days', () => {
  const annual = annualize(makeMonthly(2019, 2020, 2), 'precipitation');
  assert.deepEqual(annual.map(p => p.value), [730, 732]);
});

test('eleven months, duplicates, null and negative precipitation cannot fabricate a complete year', () => {
  const monthly = makeMonthly(2000, 2003, 2);
  monthly.splice(monthly.findIndex(p => p.year === 2000 && p.month === 12), 1);
  monthly.push({ year: 2001, month: 1, value: 2 });
  monthly.find(p => p.year === 2002 && p.month === 1)!.value = null;
  monthly.find(p => p.year === 2003 && p.month === 1)!.value = -1;
  assert.equal(annualize(monthly, 'precipitation').length, 0);
});

test('known linear trend has the correct direction, decade scale, intercept and deterministic output', () => {
  const annual = Array.from({ length: 30 }, (_, i) => ({ year: 1991 + i, value: 10 + i * 0.25, anomaly: null }));
  const result = calculateTrend(annual);
  assert.equal(result.slopePerDecade, 2.5);
  assert.equal(result.intercept, 10 - 1991 * 0.25);
  assert.equal(result.pValue, 0);
  assert.deepEqual(result.confidenceInterval95PerDecade, [2.5, 2.5]);
  assert.deepEqual(result, calculateTrend([...annual].reverse()));
});

test('constant series has zero slope and no significance, with finite interval', () => {
  const result = calculateTrend(Array.from({ length: 20 }, (_, i) => ({ year: 2000 + i, value: 3, anomaly: null })));
  assert.equal(result.slopePerDecade, 0);
  assert.equal(result.pValue, 1);
  assert.equal(result.significant, false);
  assert.deepEqual(result.confidenceInterval95PerDecade, [0, 0]);
});

test('Newey-West confidence interval and p-value match a fixed autocorrelated reference', () => {
  const annual = Array.from({ length: 30 }, (_, i) => ({ year: 1990 + i, value: 10 + 0.12 * i + Math.sin(i / 3) * 0.8, anomaly: null }));
  const result = calculateTrend(annual);
  assert.equal(result.lag, 3);
  assert.ok(Math.abs(result.slopePerDecade - 1.1816072955363595) < 1e-12);
  assert.ok(Math.abs(result.confidenceInterval95PerDecade[0] - 0.8673556291177991) < 1e-12);
  assert.ok(Math.abs(result.confidenceInterval95PerDecade[1] - 1.49585896195492) < 1e-12);
  assert.ok(Math.abs(result.pValue - 2.168917627366169e-8) < 1e-18);
  // Positive serial correlation in this fixture makes the robust interval wider than IID OLS.
  assert.ok(result.confidenceInterval95PerDecade[1] - result.slopePerDecade > 0.2);
});

test('calendar gaps are not treated as adjacent lags and duplicate years are rejected', () => {
  const points = Array.from({ length: 15 }, (_, i) => ({ year: 1981 + 3 * i, value: 2 * i + Math.sin(i), anomaly: null }));
  const regular = points.map((p, i) => ({ ...p, year: 1981 + i }));
  const gap = calculateTrend(points), dense = calculateTrend(regular);
  assert.ok(Math.abs(gap.slopePerDecade * 3 - dense.slopePerDecade) < 1e-12);
  assert.notEqual(gap.confidenceInterval95PerDecade[1] * 3, dense.confidenceInterval95PerDecade[1]);
  assert.throws(() => calculateTrend([points[0]!, points[0]!, points[1]!]));
});
