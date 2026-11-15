import type { ClimateMetric, Location } from '../../../shared/types';
import { EARTHDATA_TOKEN_URL, GIOVANNI_ATTRIBUTION, GIOVANNI_DEFAULT_VARIABLE, GIOVANNI_TIME_SERIES_URL, GIOVANNI_UNIT_CONVERSIONS, GIOVANNI_VARIABLES } from '../../../shared/giovanni-catalog.constant';
import { parseGiovanniCsv, resolveGiovanniConversion, resolveGiovanniMonthly } from '../../../shared/giovanni.resolver';
import type { CacheStore, ClimateProvider, ClimateSeries } from '../backend.types';
import { CONFIG } from '../config.constant';
import { SourceError } from '../http';

const PROVIDER = 'NASA Giovanni';
let cachedToken: { value: string; expiresAt: number } | null = null;

/** Earthdata Login bearer token. EARTHDATA_TOKEN may be used directly instead of username/password. */
async function earthdataToken(): Promise<string> {
  if (process.env.EARTHDATA_TOKEN?.trim()) return process.env.EARTHDATA_TOKEN.trim();
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const username = process.env.EARTHDATA_USERNAME;
  const password = process.env.EARTHDATA_PASSWORD;
  if (!username || !password) throw new SourceError(PROVIDER);
  try {
    const response = await fetch(EARTHDATA_TOKEN_URL, { method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } });
    const body = await response.json() as { access_token?: unknown; expiration_date?: unknown };
    if (!response.ok || typeof body.access_token !== 'string') throw new SourceError(PROVIDER, response.status >= 500);
    const expires = typeof body.expiration_date === 'string' ? Date.parse(body.expiration_date) : NaN;
    // Refresh a day early; EDL tokens last up to 60 days.
    cachedToken = { value: body.access_token, expiresAt: Number.isFinite(expires) ? expires - 86_400_000 : Date.now() + 3_600_000 };
    return cachedToken.value;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(PROVIDER, true);
  }
}

/** Authenticated GET against the Giovanni time series service; failures are SourceError (source unavailable). */
export async function fetchGiovanniCsv(url: string): Promise<string> {
  const token = await earthdataToken();
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
    if (response.status === 401 || response.status === 403) cachedToken = null;
    if (!response.ok) throw new SourceError(PROVIDER, response.status === 429 || response.status >= 500);
    const body = await response.text();
    if (body.length > 8_000_000) throw new SourceError(PROVIDER);
    return body;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(PROVIDER, true);
  }
}

/**
 * Historical trend provider backed by NASA Giovanni point time series (MERRA-2 monthly means by default).
 * Returns the same ClimateSeries contract as MeteomaticsProvider: °C, and precipitation as monthly mean mm/day.
 */
export class GiovanniProvider implements ClimateProvider {
  constructor(private readonly cache: CacheStore) {}
  async getMonthly(location: Location, metric: ClimateMetric, startYear: number, endYear: number): Promise<ClimateSeries> {
    const variable = GIOVANNI_VARIABLES.find(item => item.id === GIOVANNI_DEFAULT_VARIABLE[metric]);
    if (!variable) throw new SourceError(PROVIDER);
    const key = `giovanni-v1:${variable.id}:${location.latitude}:${location.longitude}:${startYear}:${endYear}`;
    const cached = await this.cache.get<ClimateSeries>(key);
    if (cached) return cached;
    // Months before the product starts stay null; requesting them would only fail the whole call.
    const requestStart = Math.max(startYear, variable.firstYear);
    if (requestStart > endYear) throw new SourceError(PROVIDER);
    const params = new URLSearchParams({ data: variable.id, location: `[${location.latitude},${location.longitude}]`,
      time: `${requestStart}-01-01T00:00:00/${endYear}-12-31T23:59:59` });
    const csv = parseGiovanniCsv(await fetchGiovanniCsv(`${GIOVANNI_TIME_SERIES_URL}?${params}`));
    const convert = resolveGiovanniConversion(GIOVANNI_UNIT_CONVERSIONS, metric, csv.headers.unit);
    // An empty response or an unverified unit is a source problem, never "no trend".
    if (!csv.rows.length || !convert) throw new SourceError(PROVIDER);
    const cell = csv.headers.lat && csv.headers.lon ? ` Grid cell ${csv.headers.lat}, ${csv.headers.lon}.` : '';
    const result: ClimateSeries = {
      monthly: resolveGiovanniMonthly(csv, convert, startYear, endYear),
      provenance: { provider: PROVIDER, dataset: `${variable.dataset}; complete monthly values derived in the app`,
        parameters: [variable.id], sourceUrl: variable.documentationUrl, retrievedAt: new Date().toISOString(), temporalResolution: 'monthly',
        isHistorical: true, attribution: `${GIOVANNI_ATTRIBUTION}${cell} Source unit "${csv.headers.unit}" converted to ${metric === 'temperature' ? '°C' : 'mm/day'}.` },
    };
    await this.cache.set(key, result, CONFIG.cacheTtlSeconds);
    return result;
  }
}
