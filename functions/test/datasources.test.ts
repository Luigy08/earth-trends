import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AppeearsSource, CANONICAL_VARIABLES, DataSourceRegistry, MeteomaticsSource, converter, formatTime, normalizeAppeearsCatalog,
  normalizeUnit, parseCsv, parseQueryPath, type BalamQuery, type CatalogEntry,
} from '../src/datasources';
import { aidIndex } from '../src/datasources/sources/appeears';
import { ZONE_REFS, json, mockFetch } from './balam-fixtures.types';

const SOURCES = ['meteomatics', 'appeears'];
const login = () => json({ token: 'T', expiration: new Date(Date.now() + 864e5).toISOString() });
const STATISTICS_HEADER = 'File Name,Dataset,aid,Date,Count,Minimum,Maximum,Range,Mean,Standard Deviation,Variance,Upper Quartile,Upper 1.5 IQR,Median,Lower 1.5 IQR,Lower Quartile\n';

/* ---------- Ported from the reference package ---------- */

test('parses Meteomatics-style paths with a source prefix', () => {
  const q = parseQueryPath('/2024-01-01T00:00:00Z--2024-12-31T00:00:00Z:P1D/t_2m:C,appeears/MOD11A1.061/LST_Day_1km:K/14.07,-87.19/json', SOURCES);
  assert.equal(q.parameters.length, 2);
  assert.deepEqual(q.parameters[0], { raw: 't_2m:C', source: 'meteomatics', name: 't_2m', unit: 'C' });
  assert.equal(q.parameters[1]!.source, 'appeears');
  assert.equal(q.parameters[1]!.name, 'MOD11A1.061/LST_Day_1km');
  assert.equal(q.time.step, 'P1D');
  assert.deepEqual(q.location, { kind: 'point', lat: 14.07, lon: -87.19 });
  assert.equal(formatTime(q.time), '2024-01-01T00:00:00Z--2024-12-31T00:00:00Z:P1D');
});

test('parses start + duration, bbox and point lists', () => {
  const a = parseQueryPath('/2026-11-12T00:00:00ZP5D:PT1H/t_2m:C/16,-89.4_13,-83.1:0.1,0.1', SOURCES);
  assert.equal(a.time.end.toISOString(), '2026-11-17T00:00:00.000Z');
  assert.deepEqual(a.location, { kind: 'bbox', latMax: 16, lonMin: -89.4, latMin: 13, lonMax: -83.1, resLat: 0.1, resLon: 0.1 });
  const b = parseQueryPath('/2026-11-12T00:00:00Z/t_2m:C/14,-87+15,-88', SOURCES);
  assert.equal(b.location.kind, 'points');
  assert.throws(() => parseQueryPath('/2026-11-12T00:00:00Z/t_2m:C/14,north', SOURCES), /Invalid location/);
});

test('normalizes and converts units', () => {
  assert.equal(normalizeUnit('Kelvin'), 'K');
  assert.equal(normalizeUnit('degrees C'), 'C');
  assert.equal(normalizeUnit('°C'), 'C');
  assert.equal(normalizeUnit('kg/m^2/8day'), 'kgm2_8d');
  assert.equal(normalizeUnit('kgC/m^2/8day'), 'kgCm2_8d');
  assert.equal(normalizeUnit('m^3/m^3'), 'm3m3');
  assert.equal(normalizeUnit('parameter, no units'), 'idx');
  assert.equal(normalizeUnit('Ratio'), 'frac');
  assert.equal(converter('K', 'C')(300), 300 - 273.15);
  assert.equal(converter('kgm2s', 'mm')(1 / 86400), 1);
});

test('parses CSV with quoted fields', () => {
  assert.deepEqual(parseCsv('a,b\n1,"x, y"\n2,"z ""q"""\n'), [{ a: '1', b: 'x, y' }, { a: '2', b: 'z "q"' }]);
});

test('normalizes the AppEEARS catalog', () => {
  const cat = normalizeAppeearsCatalog(
    [{
      Product: 'MOD11A1', Version: '061', ProductAndVersion: 'MOD11A1.061', Platform: 'Terra MODIS',
      Description: 'Land Surface Temperature & Emissivity (LST&E)', RasterType: 'Tile', Resolution: '1000m',
      TemporalGranularity: 'Daily', Available: true, Deleted: false, Source: 'LP DAAC',
      TemporalExtentStart: '2000-02-24', TemporalExtentEnd: 'Present',
    }],
    { 'MOD11A1.061': { LST_Day_1km: { Layer: 'LST_Day_1km', Units: 'Kelvin', ScaleFactor: 0.02, FillValue: 0, ValidMin: 150, ValidMax: 1310.7, IsQA: false, QualityLayers: "['QC_Day']" } } },
  );
  assert.equal(cat[0]!.parameter, 'appeears/MOD11A1.061/LST_Day_1km:K');
  assert.equal(cat[0]!.temporalEnd, null);
  assert.equal(cat[0]!.resolutionMeters, 1000);
  assert.deepEqual(cat[0]!.qualityLayers, ['QC_Day']);
});

test('AppEEARS point: task, status, bundle and normalized CSV', async () => {
  let submitted: { task_type: string; params: { dates: unknown; layers: unknown } } | undefined;
  const calls = mockFetch({
    '/login': login,
    '/task': (init) => {
      submitted = JSON.parse(String(init?.body));
      return json({ task_id: 'abc', status: 'pending' }, 202);
    },
    '/task/abc': () => json({ status: 'done' }),
    '/bundle/abc': () => json({ files: [{ file_id: 'f1', file_name: 'balam-MOD11A1-061-results.csv', file_type: 'csv' }] }),
    '/bundle/abc/f1': () => new Response(null, { status: 302, headers: { location: 'https://s3.example/f1' } }),
    'https://s3.example/f1': () => new Response(
      'ID,Category,Latitude,Longitude,Date,MOD11A1_061_LST_Day_1km,MOD11A1_061_QC_Day\n'
        + 'p0,,14.07,-87.19,2024-01-02,300.5,0\np0,,14.07,-87.19,2024-01-01,0,2\n'),
  });
  const src = new AppeearsSource({ username: 'u', password: 'p', catalog: [{ dataset: 'MOD11A1.061', variable: 'LST_Day_1km', unit: 'K', fillValue: 0, scaleFactor: 0.02 } as CatalogEntry] });
  const reg = new DataSourceRegistry().register(src);
  const job = await reg.submit(reg.parse('/2024-01-01T00:00:00Z--2024-01-02T00:00:00Z/appeears/MOD11A1.061/LST_Day_1km:C/14.07,-87.19'));
  assert.equal(submitted?.task_type, 'point');
  assert.deepEqual(submitted?.params.dates, [{ startDate: '01-01-2024', endDate: '01-02-2024' }]);
  assert.deepEqual(submitted?.params.layers, [{ product: 'MOD11A1.061', layer: 'LST_Day_1km' }]);

  const r = await reg.poll(job.id);
  assert.equal(r.done, true);
  assert.equal(r.response.status, 'OK');
  const s = r.response.data[0]!;
  assert.equal(s.parameter, 'appeears/MOD11A1.061/LST_Day_1km:C');
  assert.equal(s.coordinates[0]!.dates[0]!.date, '2024-01-01T00:00:00Z');
  assert.equal(s.coordinates[0]!.dates[0]!.value, null); // fill value
  assert.ok(Math.abs(s.coordinates[0]!.dates[1]!.value! - 27.35) < 1e-9);
  assert.ok(calls.includes('GET https://s3.example/f1')); // the S3 download carries no token
});

test('AppEEARS bbox: per-date statistics', async () => {
  let submitted: { task_type: string; params: { geo: { features: { geometry: { coordinates: number[][][] } }[] } } } | undefined;
  mockFetch({
    '/login': login,
    '/task': (init) => {
      submitted = JSON.parse(String(init?.body));
      return json({ task_id: 'area1', status: 'pending' }, 202);
    },
    '/task/area1': () => json({ status: 'done' }),
    '/bundle/area1': () => json({ files: [{ file_id: 's', file_name: 'balam-MOD13Q1-061-Statistics.csv', file_type: 'csv' }] }),
    '/bundle/area1/s': () => new Response(null, { status: 302, headers: { location: 'https://s3.example/s' } }),
    'https://s3.example/s': () => new Response(`${STATISTICS_HEADER}MOD13Q1.061__250m_16_days_NDVI_doy2024001_aid0001,_250m_16_days_NDVI,aid0001,2024-01-01,100,0.1,0.9,0.8,0.62,0.1,0.01,0.7,0.9,0.63,0.3,0.5\n`),
  });
  const reg = new DataSourceRegistry().register(new AppeearsSource({ username: 'u', password: 'p' }));
  const job = await reg.submit(reg.parse('/2024-01-01T00:00:00Z--2024-01-31T00:00:00Z/appeears/MOD13Q1.061/_250m_16_days_NDVI:idx/16,-89.4_13,-83.1'));
  assert.equal(submitted?.task_type, 'area');
  assert.equal(submitted?.params.geo.features[0]!.geometry.coordinates[0]!.length, 5);
  const r = await reg.poll(job.id);
  const coordinate = r.response.data[0]!.coordinates[0]!;
  assert.equal(coordinate.id, 'bbox');
  assert.equal(coordinate.dates[0]!.value, 0.62);
  assert.equal(coordinate.dates[0]!.stats?.median, 0.63);
});

test('registry splits by source and merges with Meteomatics', async () => {
  mockFetch({
    '/14.07,-87.19/json': () => json({ status: 'OK', data: [{ parameter: 't_2m:C', coordinates: [{ lat: 14.07, lon: -87.19, dates: [{ date: '2024-01-01T00:00:00Z', value: 21.4 }] }] }] }),
  });
  const reg = new DataSourceRegistry().register(new MeteomaticsSource({ username: 'u', password: 'p' }));
  const job = await reg.submit(reg.parse('/2024-01-01T00:00:00Z--2024-01-02T00:00:00Z:P1D/t_2m:C/14.07,-87.19'));
  const r = await reg.poll(job.id);
  assert.equal(r.response.data[0]!.parameter, 'meteomatics/t_2m:C');
  assert.equal(r.response.data[0]!.coordinates[0]!.dates[0]!.value, 21.4);
});

test('every canonical variable parameter parses', () => {
  for (const v of CANONICAL_VARIABLES) {
    for (const b of v.bindings) {
      const q = parseQueryPath(`/2024-01-01T00:00:00Z/${b.parameter}/0,0`, SOURCES);
      assert.equal(q.parameters[0]!.source, b.parameter.split('/')[0], b.parameter);
    }
  }
});

/* ---------- Zones ---------- */

function zonesQuery(parameter: string, registry: DataSourceRegistry, start = '2024-01-01', end = '2024-01-31'): BalamQuery {
  const parsed = registry.parse(`/${start}T00:00:00Z--${end}T00:00:00Z/${parameter}/0,0`);
  return { ...parsed, location: { kind: 'zones', zones: ZONE_REFS } };
}

test('aid maps to the one-based feature index', () => {
  assert.equal(aidIndex('aid0001'), 0);
  assert.equal(aidIndex('aid0018'), 17);
  assert.equal(aidIndex('aid0000'), undefined);
  assert.equal(aidIndex(''), undefined);
  assert.equal(aidIndex(undefined), undefined);
});

test('AppEEARS zones: one area task, one feature per zone, one series per zone by aid', async () => {
  let submitted: { task_type: string; params: { geo: { features: { properties: { id: string }; geometry: unknown }[] } } } | undefined;
  mockFetch({
    '/login': login,
    '/task': (init) => {
      submitted = JSON.parse(String(init?.body));
      return json({ task_id: 'z1', status: 'pending' }, 202);
    },
    '/task/z1': () => json({ status: 'done' }),
    '/bundle/z1': () => json({ files: [{ file_id: 's', file_name: 'balam-MOD11A1-061-Statistics.csv', file_type: 'csv' }] }),
    '/bundle/z1/s': () => new Response(null, { status: 302, headers: { location: 'https://s3.example/z' } }),
    // Rows arrive out of order and include a feature that was never requested.
    'https://s3.example/z': () => new Response(STATISTICS_HEADER
      + 'MOD11A1.061_LST_Day_1km_doy2024002_aid0002,LST_Day_1km,aid0002,2024-01-02,50,290,310,20,301.15,2,4,305,310,300.15,290,295\n'
      + 'MOD11A1.061_LST_Day_1km_doy2024001_aid0001,LST_Day_1km,aid0001,2024-01-01,80,280,300,20,293.15,1.5,2.25,296,300,294.15,280,290\n'
      + 'MOD11A1.061_LST_Day_1km_doy2024001_aid0002,LST_Day_1km,aid0002,2024-01-01,50,290,310,20,303.15,2,4,305,310,302.15,290,295\n'
      + 'MOD11A1.061_LST_Day_1km_doy2024001_aid0009,LST_Day_1km,aid0009,2024-01-01,50,290,310,20,999,2,4,305,310,302.15,290,295\n'),
  });
  const src = new AppeearsSource({ username: 'u', password: 'p', catalog: [{ dataset: 'MOD11A1.061', variable: 'LST_Day_1km', unit: 'K', fillValue: 0, scaleFactor: 0.02 } as CatalogEntry] });
  const reg = new DataSourceRegistry().register(src);
  const job = await reg.submit(zonesQuery('appeears/MOD11A1.061/LST_Day_1km:C', reg));

  assert.equal(submitted?.task_type, 'area');
  assert.deepEqual(submitted?.params.geo.features.map((f) => f.properties.id), ['HN-CR', 'HN-FM']);
  assert.deepEqual(submitted?.params.geo.features[1]!.geometry, ZONE_REFS[1]!.geometry);
  // Only ids and centroids are persisted with the job, never the polygons.
  assert.deepEqual(job.parts[0]!.context.areas, [{ id: 'HN-CR', lat: 15.5, lon: -88 }, { id: 'HN-FM', lat: 14.2, lon: -87.2 }]);

  const series = (await reg.poll(job.id)).response.data[0]!;
  assert.deepEqual(series.coordinates.map((c) => [c.id, c.lat, c.lon]), [['HN-CR', 15.5, -88], ['HN-FM', 14.2, -87.2]]);
  const [cortes, morazan] = series.coordinates;
  assert.equal(cortes!.dates.length, 1);
  assert.ok(Math.abs(cortes!.dates[0]!.value! - 20) < 1e-9);
  assert.ok(Math.abs(cortes!.dates[0]!.stats!.min! - 6.85) < 1e-9);
  assert.equal(cortes!.dates[0]!.stats!.count, 80);
  // A standard deviation is a spread: Kelvin → Celsius must not subtract 273.15 from it.
  assert.ok(Math.abs(cortes!.dates[0]!.stats!.std! - 1.5) < 1e-9);
  assert.deepEqual(morazan!.dates.map((d) => d.date), ['2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z']);
  assert.ok(Math.abs(morazan!.dates[1]!.value! - 28) < 1e-9);
});

test('AppEEARS zones: statistics without aid cannot be attributed to several zones', async () => {
  mockFetch({
    '/login': login,
    '/task': () => json({ task_id: 'z2', status: 'pending' }, 202),
    '/task/z2': () => json({ status: 'done' }),
    '/bundle/z2': () => json({ files: [{ file_id: 's', file_name: 'x-Statistics.csv', file_type: 'csv' }] }),
    '/bundle/z2/s': () => new Response('File Name,Dataset,Date,Count,Minimum,Maximum,Mean,Standard Deviation,Median\nMOD13Q1.061__250m_16_days_NDVI_doy2024001,_250m_16_days_NDVI,2024-01-01,10,0.1,0.9,0.5,0.1,0.5\n'),
  });
  const reg = new DataSourceRegistry().register(new AppeearsSource({ username: 'u', password: 'p' }));
  const job = await reg.submit(zonesQuery('appeears/MOD13Q1.061/_250m_16_days_NDVI:idx', reg));
  const r = await reg.poll(job.id);
  assert.equal(r.response.status, 'ERROR');
  assert.match(r.response.errors![0]!.message, /aid/);
});

test('AppEEARS without credentials reports the source as unavailable', async () => {
  mockFetch({});
  const reg = new DataSourceRegistry().register(new AppeearsSource({ username: '', password: '' }));
  const job = await reg.submit(zonesQuery('appeears/MOD13Q1.061/_250m_16_days_NDVI:idx', reg));
  assert.equal(job.parts[0]!.status, 'error');
  assert.match(job.parts[0]!.error!, /credentials are not configured/);
});

test('Meteomatics zones: centroids as a point list, one series per zone, reserved values as null', async () => {
  const calls = mockFetch({
    '/15.5,-88+14.2,-87.2/json': () => json({ status: 'OK', data: [{ parameter: 't_2m:C', coordinates: [
      { lat: 15.5, lon: -88, dates: [{ date: '2024-01-01T00:00:00Z', value: 24.5 }, { date: '2024-01-01T01:00:00Z', value: -999 }] },
      { lat: 14.2, lon: -87.2, dates: [{ date: '2024-01-01T00:00:00Z', value: 19 }] },
    ] }] }),
  });
  const reg = new DataSourceRegistry().register(new MeteomaticsSource({ username: 'u', password: 'p' }));
  const query = zonesQuery('t_2m:C', reg, '2024-01-01', '2024-01-02');
  const job = await reg.submit({ ...query, time: { ...query.time, step: 'PT1H' } });
  assert.match(calls[0]!, /\/2024-01-01T00:00:00Z--2024-01-02T00:00:00Z:PT1H\/t_2m:C\/15\.5,-88\+14\.2,-87\.2\/json$/);
  const series = (await reg.poll(job.id)).response.data[0]!;
  assert.deepEqual(series.coordinates.map((c) => c.id), ['HN-CR', 'HN-FM']);
  assert.deepEqual(series.coordinates[0]!.dates.map((d) => d.value), [24.5, null]);
  assert.equal(series.coordinates[1]!.dates[0]!.value, 19);
});

test('Meteomatics without credentials never calls the provider', async () => {
  const calls = mockFetch({});
  const reg = new DataSourceRegistry().register(new MeteomaticsSource({ username: '', password: '' }));
  const job = await reg.submit(reg.parse('/2024-01-01T00:00:00Z/t_2m:C/14,-87'));
  assert.equal(job.parts[0]!.status, 'error');
  assert.equal(calls.length, 0);
});
