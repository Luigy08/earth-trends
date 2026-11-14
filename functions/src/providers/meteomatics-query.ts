import type { MeteomaticsAvailabilityResponse, MeteomaticsExecuteResponse, MeteomaticsQuerySpec } from '../../../shared/types';
import type { CacheStore } from '../backend.types';
import { resolveMeteomaticsChart } from '../meteomatics-chart.resolver';
import { CONFIG } from '../config.constant';
import { SourceError } from '../http';
import { meteomaticsHeaders } from './meteomatics';

const API = 'https://api.meteomatics.com';
const trajectoryAPI = 'https://wx.meteomatics.com';

function headers(): Record<string, string> {
  const value = meteomaticsHeaders();
  if (!value) throw new SourceError('Meteomatics credentials are not configured.');
  return value;
}

async function requestText(url: string, init: RequestInit): Promise<string> {
  try {
    const response = await fetch(url, { ...init, headers: { ...headers(), ...init.headers }, signal: AbortSignal.timeout(60_000) });
    const body = await response.text();
    if (!response.ok) throw new Error(body.slice(0, 500) || `Meteomatics returned HTTP ${response.status}.`);
    if (body.length > 8_000_000) throw new Error('The Meteomatics response exceeded the 8 MB limit.');
    return body;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new Error(error instanceof Error ? error.message : 'Meteomatics request failed.');
  }
}

function locationPath(spec: MeteomaticsQuerySpec): string {
  switch (spec.mode) {
    case 'point': return `${spec.point!.latitude},${spec.point!.longitude}`;
    case 'grid': return `${spec.grid!.north},${spec.grid!.west}_${spec.grid!.south},${spec.grid!.east}:${spec.grid!.resolution}`;
    case 'station': return spec.stationIds!.join('+');
    case 'route': return spec.route!.map(({ latitude, longitude }) => `${latitude},${longitude}`).join('+');
    case 'polygon': return `${spec.polygon!.coordinates.map(({ latitude, longitude }) => `${latitude},${longitude}`).join('_')}:${spec.polygon!.aggregate}`;
    case 'trajectory': return '';
  }
}

function requestPath(spec: MeteomaticsQuerySpec): string {
  const location = locationPath(spec);
  const sourceOption = new URLSearchParams({ source: spec.source, ...Object.fromEntries(Object.entries(spec.options ?? {}).map(([key, value]) => [key, String(value)])) }).toString();
  if (spec.mode === 'trajectory') return `${trajectoryAPI}/trajectory-${spec.trajectory!.some(point => point.altitude !== undefined) ? '4d' : '3d'}/${spec.parameters.join(',')}/${spec.format}?${sourceOption}`;
  const path = `${API}/${encodeURIComponent(spec.validDates.replace(/(Z|[+-]\d{2}:?\d{2})\/(?=\d{4}-\d{2}-\d{2}T)/g, '$1--'))}/${spec.parameters.join(',')}/${encodeURIComponent(location)}/${spec.format}?${sourceOption}`;
  if (spec.mode === 'route') return `${path}&route=true`;
  return path;
}

function trajectoryBody(spec: MeteomaticsQuerySpec): string {
  const hasAltitude = spec.trajectory!.some(point => point.altitude !== undefined);
  const header = hasAltitude ? 'date;lat;lon;altitude' : 'date;lat;lon';
  return [header, ...spec.trajectory!.map(point => [point.date, point.latitude, point.longitude, ...(hasAltitude ? [point.altitude] : [])].join(';'))].join('\n');
}

function requestBounds(spec: MeteomaticsQuerySpec): [string, string] | null {
  if (spec.mode === 'trajectory') {
    const dates = spec.trajectory!.map(point => point.date).sort();
    return [dates[0]!, dates[dates.length - 1]!];
  }
  const dates = [...spec.validDates.matchAll(/\d{4}-\d{2}-\d{2}T\d{2}(?::\d{2})?(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})/g)].map(match => match[0]).sort();
  return dates.length ? [dates[0]!, dates[dates.length - 1]!] : null;
}

function rangeContains(start: string, end: string, min: string, max: string): boolean {
  const requested = Date.parse(start);
  const requestedEnd = Date.parse(end);
  const minimum = Date.parse(min);
  const maximum = Date.parse(max);
  return Number.isFinite(requested) && Number.isFinite(requestedEnd) && Number.isFinite(minimum) && Number.isFinite(maximum)
    && requested >= minimum && requestedEnd <= maximum;
}

export class MeteomaticsQueryProvider {
  constructor(private readonly cache: CacheStore) {}

  async checkAvailability(spec: MeteomaticsQuerySpec): Promise<MeteomaticsAvailabilityResponse> {
    const params = new URLSearchParams({ source: spec.source, parameters: spec.parameters.join(',') });
    const text = await requestText(`${API}/get_time_range?${params.toString()}`, { method: 'GET' });
    const rows = text.trim().split(/\r?\n/).slice(1).map(row => row.split(';'));
    const bounds = requestBounds(spec);
    const ranges = spec.parameters.map(parameter => {
      const row = rows.find(values => values[0] === parameter);
      const minDate = row?.[1] ?? '';
      const maxDate = row?.[2] ?? '';
      const requestedWithinRange = Boolean(row && bounds && rangeContains(bounds[0], bounds[1], minDate, maxDate));
      return { parameter, minDate, maxDate, requestedWithinRange };
    });
    return { available: ranges.length === spec.parameters.length && ranges.every(range => range.requestedWithinRange), ranges,
      ...ranges.some(range => !range.minDate) ? { message: 'The selected source did not report a time range for one or more parameters. The account may not include those data.' } : {},
    };
  }

  async execute(spec: MeteomaticsQuerySpec): Promise<MeteomaticsExecuteResponse> {
    const url = requestPath(spec);
    const usePost = url.length > 1000 || spec.mode === 'trajectory';
    const endpoint = usePost ? (url.split('?')[0] ?? url) : url;
    const body = spec.mode === 'trajectory' ? trajectoryBody(spec)
      : usePost ? `${spec.parameters.join(',')}/${encodeURIComponent(locationPath(spec))}/${spec.format}?${url.split('?')[1] ?? ''}` : undefined;
    const cacheKey = `meteomatics-query-v3:${url}:${body ?? ''}`;
    const cached = await this.cache.get<MeteomaticsExecuteResponse>(cacheKey);
    if (cached) return cached;
    const resultText = await requestText(endpoint, { method: usePost ? 'POST' : 'GET', ...(body ? { body, headers: { 'Content-Type': 'text/plain' } } : {}) });
    let result: unknown;
    try { result = JSON.parse(resultText) as unknown; } catch { result = resultText; }
    const requestedAt = new Date().toISOString();
    const output: MeteomaticsExecuteResponse = {
      provider: 'Meteomatics', source: spec.source, requestedAt, request: spec, responseFormat: spec.format, result, chartTrends: resolveMeteomaticsChart(result, spec),
      provenance: { provider: 'Meteomatics', dataset: `Meteomatics Weather API (${spec.source})`, parameters: spec.parameters,
        sourceUrl: `${API}/`, retrievedAt: requestedAt, temporalResolution: 'request-defined',
        isHistorical: Boolean(requestBounds(spec) && requestBounds(spec)![1].slice(0, 16) < requestedAt.slice(0, 16)),
        attribution: 'Meteomatics Weather API. Query availability and historical depth depend on the account entitlement and selected source.',
      },
    };
    await this.cache.set(cacheKey, output, Math.min(CONFIG.cacheTtlSeconds, 3600));
    return output;
  }
}
