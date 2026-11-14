import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explainResults, resolveInterpretation } from '../src/ai';
import { AnalysisService } from '../src/analysis';
import { LocationSearch } from '../src/providers/locations';
import { location, makeMonthly, makeSeries, MemoryCache, spec } from './fixtures.types';

async function resultFixture() {
  return new AnalysisService({ getMonthly: async () => makeSeries(makeMonthly(1991, 2020)) }, new MemoryCache()).run(spec);
}

test('explanation receives calculated categories only, without numerical values or location names', async () => {
  const result = await resultFixture();
  const original = JSON.stringify(result);
  const explanation = await explainResults(result, async input => {
    assert.equal(input.entries[0]!.direction, 'flat');
    assert.equal(input.entries[0]!.significant, false);
    assert.ok(!JSON.stringify(input).includes(location.name));
    assert.ok(!JSON.stringify(input).includes('slope'));
    return 'La evidencia disponible no permite afirmar una tendencia distinta de cero.';
  });
  assert.match(explanation!, /evidencia/);
  assert.equal(JSON.stringify(result), original);
});

test('numerical model output and model errors fall back to the unchanged deterministic report', async () => {
  const result = await resultFixture();
  const original = result.narrative;
  assert.equal(await explainResults(result, async () => 'La temperatura cambió 3 grados.'), null);
  assert.equal(await explainResults(result, async () => { throw new Error('model unavailable'); }), null);
  assert.equal(result.narrative, original);
});

test('missing interpretation fields return clarification and do not fabricate a spec', async () => {
  const response = await resolveInterpretation({ status: 'needs_clarification', locationQueries: [], comparisonMode: 'none',
    summary: 'Solicitud incompleta', clarificationQuestions: [] }, new LocationSearch(new MemoryCache()));
  assert.equal(response.status, 'needs_clarification');
  assert.equal(response.spec, undefined);
  assert.ok(response.clarificationQuestions.length > 0);
});
