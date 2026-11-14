import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { getCurrentWeather } from '../src/providers/current-weather';
import { LocationSearch } from '../src/providers/locations';
import { location, MemoryCache } from './fixtures.types';

test('qualified geocoding searches city alone and filters Spanish, English or ISO country qualifiers', async () => {
  const fetch = mock.method(globalThis, 'fetch', async (url: string) => {
    const request = new URL(url);
    assert.equal(request.searchParams.get('name'), 'Tegucigalpa');
    assert.equal(request.searchParams.get('count'), '100');
    return new Response(JSON.stringify({ results: [
      { id: 1, name: 'Tegucigalpa', latitude: 14.08, longitude: -87.21, country: 'Honduras', country_code: 'HN', admin1: 'Francisco Morazán' },
      { id: 2, name: 'Tegucigalpa', latitude: 15, longitude: -86, country: 'Otro', country_code: 'MX', admin1: 'Otro' },
    ] }));
  });
  try {
    const search = new LocationSearch(new MemoryCache());
    for (const query of ['Tegucigalpa, Honduras', 'Tegucigalpa, HN', 'Tegucigalpa, Francisco Morazan, Honduras']) {
      const result = await search.search(query, 3);
      assert.equal(result.length, 1);
      assert.equal(result[0]!.id, '1');
    }
  } finally { fetch.mock.restore(); }
});

test('Reykjavik city is not made ambiguous by a fuzzy airport match', async () => {
  const fetch = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ results: [
    { id: 1, name: 'Reikiavik', latitude: 64.14, longitude: -21.94, country: 'Islandia', country_code: 'IS', feature_code: 'PPLC' },
    { id: 2, name: 'Reykjavik Airport', latitude: 64.13, longitude: -21.94, country: 'Islandia', country_code: 'IS', feature_code: 'AIRP' },
  ] })));
  try {
    const result = await new LocationSearch(new MemoryCache()).search('Reykjavik', 3);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, 'Reikiavik');
  } finally { fetch.mock.restore(); }
});

test('current weather is unavailable without credentials and never falls back to another provider', async () => {
  const username = process.env.METEOMATICS_USERNAME, password = process.env.METEOMATICS_PASSWORD;
  delete process.env.METEOMATICS_USERNAME;
  delete process.env.METEOMATICS_PASSWORD;
  const fetch = mock.method(globalThis, 'fetch', async () => { throw new Error('Must not call any weather provider'); });
  try {
    const result = await getCurrentWeather(location, new MemoryCache());
    assert.equal(result.status, 'source_unavailable');
    assert.equal(result.provenance, null);
    assert.equal(result.temperatureC, null);
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    if (username !== undefined) process.env.METEOMATICS_USERNAME = username;
    if (password !== undefined) process.env.METEOMATICS_PASSWORD = password;
    fetch.mock.restore();
  }
});

test('current weather uses Meteomatics credentials only in Authorization and current data cannot enter climate statistics', async () => {
  const username = process.env.METEOMATICS_USERNAME, password = process.env.METEOMATICS_PASSWORD;
  process.env.METEOMATICS_USERNAME = 'test-user';
  process.env.METEOMATICS_PASSWORD = 'test-password';
  const fetch = mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.match(url, /^https:\/\/api\.meteomatics\.com\/now\//);
    assert.ok(!url.includes('test-password'));
    assert.equal((options.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('test-user:test-password').toString('base64')}`);
    return new Response(JSON.stringify({ data: ['t_2m:C', 'precip_1h:mm'].map((parameter, i) => ({ parameter,
      coordinates: [{ dates: [{ date: '2026-11-14T12:00:00Z', value: i === 0 ? 25 : 1.5 }] }],
    })) }));
  });
  try {
    const result = await getCurrentWeather(location, new MemoryCache());
    assert.equal(result.status, 'available');
    assert.equal(result.temperatureC, 25);
    assert.equal(result.precipitationMm, 1.5);
    assert.equal(result.provenance!.provider, 'Meteomatics');
    assert.equal(result.provenance!.isHistorical, false);
    assert.match(result.notice, /no demuestra/);
    assert.equal(fetch.mock.callCount(), 1);
  } finally {
    if (username !== undefined) process.env.METEOMATICS_USERNAME = username; else delete process.env.METEOMATICS_USERNAME;
    if (password !== undefined) process.env.METEOMATICS_PASSWORD = password; else delete process.env.METEOMATICS_PASSWORD;
    fetch.mock.restore();
  }
});
