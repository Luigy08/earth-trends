import type { GiovanniExecuteResponse, GiovanniQuerySpec } from '../../../shared/types';
import { GIOVANNI_ATTRIBUTION, GIOVANNI_TIME_SERIES_URL, GIOVANNI_VARIABLES } from '../../../shared/giovanni-catalog.constant';
import { parseGiovanniCsv } from '../../../shared/giovanni.resolver';
import type { CacheStore } from '../backend.types';
import { CONFIG } from '../config.constant';
import { SourceError } from '../http';
import { resolveGiovanniChart } from '../giovanni-chart.resolver';
import { fetchGiovanniCsv } from './giovanni';

function isoTimestamp(value: string): string | null {
  const iso = value.trim().replace(' ', 'T');
  const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('.000Z', 'Z') : null;
}

/** Raw Giovanni point time series in the Meteomatics JSON envelope, so the chat renders them like Meteomatics results. */
export class GiovanniQueryProvider {
  constructor(private readonly cache: CacheStore) {}

  async execute(spec: GiovanniQuerySpec): Promise<GiovanniExecuteResponse> {
    const cacheKey = `giovanni-query-v1:${JSON.stringify(spec)}`;
    const cached = await this.cache.get<GiovanniExecuteResponse>(cacheKey);
    if (cached) return cached;
    const time = `${spec.startDate}T00:00:00/${spec.endDate}T23:59:59`;
    const location = `[${spec.point.latitude},${spec.point.longitude}]`;
    const series = await Promise.all(spec.variables.map(async id => {
      const csv = parseGiovanniCsv(await fetchGiovanniCsv(`${GIOVANNI_TIME_SERIES_URL}?${new URLSearchParams({ data: id, location, time })}`));
      if (!csv.rows.length) throw new SourceError('NASA Giovanni');
      const fillValue = csv.headers.fill_value !== undefined ? Number(csv.headers.fill_value) : undefined;
      const lat = Number(csv.headers.lat);
      const lon = Number(csv.headers.lon);
      return {
        // Unit after the colon, as Meteomatics parameters carry it; values stay raw except fill values, which become null.
        parameter: `${id}:${csv.headers.unit || GIOVANNI_VARIABLES.find(item => item.id === id)?.unit || 'unknown unit'}`,
        coordinates: [{ lat: Number.isFinite(lat) ? lat : spec.point.latitude, lon: Number.isFinite(lon) ? lon : spec.point.longitude,
          dates: csv.rows.flatMap(row => {
            const date = isoTimestamp(row.timestamp);
            return date ? [{ date, value: row.value === null || row.value === fillValue || Math.abs(row.value) >= 1e14 ? null : row.value }] : [];
          }) }],
      };
    }));
    const requestedAt = new Date().toISOString();
    const result = { version: '3.0', status: 'OK', dateGenerated: requestedAt, data: series };
    const datasets = spec.variables.map(id => GIOVANNI_VARIABLES.find(item => item.id === id)?.dataset ?? id);
    const output: GiovanniExecuteResponse = {
      provider: 'NASA Giovanni', source: 'giovanni', requestedAt, request: spec, responseFormat: 'json', result, chartTrends: resolveGiovanniChart(result, spec),
      provenance: { provider: 'NASA Giovanni', dataset: datasets.join('; '), parameters: spec.variables, sourceUrl: GIOVANNI_TIME_SERIES_URL,
        retrievedAt: requestedAt, temporalResolution: 'request-defined', isHistorical: true,
        attribution: `${GIOVANNI_ATTRIBUTION} Raw provider values in the units Giovanni reports; fill values are shown as missing.` },
    };
    await this.cache.set(cacheKey, output, Math.min(CONFIG.cacheTtlSeconds, 86400));
    return output;
  }
}
