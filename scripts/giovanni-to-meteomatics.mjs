#!/usr/bin/env node
/**
 * Fetches a point time series from NASA Giovanni ("Giovanni in the Cloud: Time Series" service)
 * and maps it to the shapes this project already uses for Meteomatics data:
 *
 *   --format series       ClimateSeries ({ monthly: MonthlyObservation[], provenance }) exactly as
 *                         MeteomaticsProvider.getMonthly returns it: monthly °C for temperature and
 *                         monthly mean mm/day for precipitation (analysis.ts converts to mm/month).
 *   --format meteomatics  Meteomatics JSON response envelope ({ data: [{ parameter, coordinates: [{ lat, lon, dates }] }] })
 *                         as consumed by meteomatics-chart.resolver.ts, keyed by the equivalent Meteomatics parameter.
 *   --format table        Human-readable table (default when stdout is a terminal).
 *
 * Values are never imputed: fill values, non-finite values and incomplete months stay null.
 * Units are converted from the unit Giovanni reports in the response header; unknown units abort.
 *
 * The backend uses the same mapping when an analysis is created with `dataSource: 'giovanni'`.
 *
 * Auth: an Earthdata Login (https://urs.earthdata.nasa.gov) bearer token. Provide EARTHDATA_TOKEN, or
 * EARTHDATA_USERNAME + EARTHDATA_PASSWORD (a token is then requested from Earthdata Login). Variables are also
 * read from the ignored functions/.env.local. Your EDL account needs the "NASA GES DISC DATA ARCHIVE" app approved.
 *
 * Usage:
 *   node scripts/giovanni-to-meteomatics.mjs --metric temperature --lat 40.4168 --lon -3.7038 --start 2000 --end 2024
 *   node scripts/giovanni-to-meteomatics.mjs --metric precipitation --lat 19.43 --lon -99.13 --start 2001 --end 2024 --format series > series.json
 *   node scripts/giovanni-to-meteomatics.mjs --variable GPM_3IMERGM_07_precipitation --metric precipitation --lat 0 --lon 0 --start 2001 --end 2002
 *   node scripts/giovanni-to-meteomatics.mjs --input saved-giovanni.csv --metric temperature   # parse a CSV saved from Giovanni
 *   node scripts/giovanni-to-meteomatics.mjs --list
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
// Same mapping and transforms as the backend GiovanniProvider (Node 22 strips the TypeScript types).
import { EARTHDATA_TOKEN_URL, GIOVANNI_DEFAULT_VARIABLE, GIOVANNI_TIME_SERIES_URL, GIOVANNI_UNIT_CONVERSIONS, GIOVANNI_VARIABLES } from '../shared/giovanni-catalog.constant.ts';
import { parseGiovanniCsv, resolveGiovanniConversion, resolveGiovanniMonthly } from '../shared/giovanni.resolver.ts';

function fail(message, code = 1) {
  console.error(`Error: ${message}`);
  process.exit(code);
}

function loadLocalEnv() {
  const file = new URL('../functions/.env.local', import.meta.url);
  if (existsSync(file)) process.loadEnvFile(file);
}

async function earthdataToken() {
  if (process.env.EARTHDATA_TOKEN?.trim()) return process.env.EARTHDATA_TOKEN.trim();
  const username = process.env.EARTHDATA_USERNAME?.trim();
  const password = process.env.EARTHDATA_PASSWORD;
  if (!username || !password) {
    fail('source_unavailable: Earthdata Login credentials are not configured. Set EARTHDATA_TOKEN, or EARTHDATA_USERNAME and EARTHDATA_PASSWORD (env or functions/.env.local).', 2);
  }
  const response = await fetch(EARTHDATA_TOKEN_URL, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) fail(`source_unavailable: Earthdata Login did not issue a token (HTTP ${response.status}).`, 2);
  return body.access_token;
}

async function fetchGiovanniCsv({ variable, lat, lon, start, end }) {
  const token = await earthdataToken();
  const params = new URLSearchParams({ data: variable, location: `[${lat},${lon}]`, time: `${start}-01-01T00:00:00/${end}-12-31T23:59:59` });
  const url = `${GIOVANNI_TIME_SERIES_URL}?${params}`;
  let response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    fail(`source_unavailable: Giovanni request failed (${error instanceof Error ? error.message : 'network error'}).`, 2);
  }
  const text = await response.text();
  if (!response.ok) fail(`source_unavailable: Giovanni returned HTTP ${response.status}: ${text.slice(0, 300)}`, 2);
  return { text, url };
}

function printTable(series, meta) {
  const unit = meta.metric === 'temperature' ? '°C' : 'mm/day (monthly mean)';
  console.log(`Giovanni ${meta.variable} → Meteomatics ${meta.meteomaticsParameter}`);
  console.log(`Point requested ${meta.lat},${meta.lon}; grid cell ${meta.headers.lat ?? '?'},${meta.headers.lon ?? '?'}; source unit "${meta.headers.unit ?? '?'}" → ${unit}`);
  console.log('year  ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => m.padStart(8)).join(''));
  for (let year = meta.start; year <= meta.end; year++) {
    const values = series.monthly.filter(p => p.year === year).map(p => (p.value === null ? '—' : p.value.toFixed(2)).padStart(8));
    console.log(`${year}  ${values.join('')}`);
  }
  const valid = series.monthly.filter(p => p.value !== null).length;
  console.log(`\n${valid}/${series.monthly.length} months valid. Missing months are left empty, never imputed.`);
}

async function main() {
  // Let negative coordinates follow a flag ("--lon -3.7") by joining them as "--lon=-3.7".
  const argv = process.argv.slice(2).reduce((out, arg, i, all) => {
    if (/^-\d/.test(arg) && /^--(lat|lon)$/.test(all[i - 1] ?? '')) out[out.length - 1] += `=${arg}`;
    else out.push(arg);
    return out;
  }, []);
  const { values: args } = parseArgs({ args: argv, options: {
    metric: { type: 'string' }, variable: { type: 'string' }, lat: { type: 'string' }, lon: { type: 'string' },
    start: { type: 'string', default: '2000' }, end: { type: 'string', default: String(new Date().getUTCFullYear() - 1) },
    format: { type: 'string' }, input: { type: 'string' }, list: { type: 'boolean', default: false },
  } });

  if (args.list) {
    for (const entry of GIOVANNI_VARIABLES) console.log(`${entry.id}\n  metric: ${entry.metric} → ${entry.meteomaticsParameter} (from ${entry.firstYear})\n  ${entry.dataset}\n  ${entry.documentationUrl}`);
    return;
  }

  const variable = args.variable ?? GIOVANNI_DEFAULT_VARIABLE[args.metric];
  const mapping = GIOVANNI_VARIABLES.find(entry => entry.id === variable);
  const metric = args.metric ?? mapping?.metric;
  if (metric !== 'temperature' && metric !== 'precipitation') fail('Use --metric temperature|precipitation (or --variable with a mapped Giovanni ID; see --list).');
  if (mapping && mapping.metric !== metric) fail(`${variable} is a ${mapping.metric} variable, not ${metric}.`);
  const meteomaticsParameter = mapping?.meteomaticsParameter ?? (metric === 'temperature' ? 't_mean_2m_24h:C' : 'precip_24h:mm');
  const start = Number(args.start);
  const end = Number(args.end);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) fail('--start and --end must be years with start <= end.');

  let csv;
  let sourceUrl = GIOVANNI_TIME_SERIES_URL;
  let lat = args.lat === undefined ? undefined : Number(args.lat);
  let lon = args.lon === undefined ? undefined : Number(args.lon);
  if (args.input) {
    csv = readFileSync(args.input, 'utf8');
  } else {
    if (!variable) fail('Pass --metric or --variable.');
    if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) fail('--lat must be in [-90, 90] and --lon in [-180, 180].');
    loadLocalEnv();
    const fetched = await fetchGiovanniCsv({ variable, lat, lon, start, end });
    csv = fetched.text;
    sourceUrl = fetched.url;
  }

  const parsed = parseGiovanniCsv(csv);
  const { headers } = parsed;
  if (!parsed.rows.length) fail('source_unavailable: Giovanni returned no data rows. Check that the point is inside the dataset extent and that the variable is served by the time series service.', 2);
  lat ??= Number(headers.lat);
  lon ??= Number(headers.lon);
  const convert = resolveGiovanniConversion(GIOVANNI_UNIT_CONVERSIONS, metric, headers.unit);
  if (!convert) fail(`Unsupported unit "${headers.unit ?? ''}" for ${metric}. Add an explicit, verified conversion in shared/giovanni-catalog.constant.ts.`);
  const monthly = resolveGiovanniMonthly(parsed, convert, start, end);
  const retrievedAt = new Date().toISOString();
  const idLabel = variable ?? headers.param_name ?? 'unknown variable';

  /** shared/types.ts DataProvenance, as GiovanniProvider writes it. */
  const provenance = {
    provider: 'NASA Giovanni',
    dataset: `${mapping?.dataset ?? idLabel}; complete monthly values derived in the app`,
    parameters: [idLabel],
    sourceUrl,
    retrievedAt,
    temporalResolution: 'monthly',
    isHistorical: true,
    attribution: `NASA GES DISC Giovanni time series service, grid cell ${headers.lat ?? '?'},${headers.lon ?? '?'} (requested ${lat},${lon}). Mapped to the meaning of Meteomatics ${meteomaticsParameter}; not a Meteomatics product.`,
  };
  const series = { monthly, provenance };

  const format = args.format ?? (process.stdout.isTTY ? 'table' : 'series');
  if (format === 'table') return printTable(series, { variable: idLabel, meteomaticsParameter, metric, lat, lon, start, end, headers });
  if (format === 'series') return console.log(JSON.stringify(series, null, 2));
  if (format === 'meteomatics') {
    // Meteomatics JSON envelope. Dates are month starts; precipitation stays mm/day so it matches the series contract.
    const envelope = {
      version: '3.0', user: 'giovanni-mapping', dateGenerated: retrievedAt, status: 'OK',
      source: `giovanni:${idLabel}`, units: metric === 'temperature' ? '°C' : 'mm/day (monthly mean)',
      data: [{ parameter: meteomaticsParameter, coordinates: [{ lat, lon, dates: monthly.map(p => ({
        date: `${p.year}-${String(p.month).padStart(2, '0')}-01T00:00:00Z`, value: p.value,
      })) }] }],
      provenance,
    };
    return console.log(JSON.stringify(envelope, null, 2));
  }
  fail('--format must be table, series or meteomatics.');
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)));
