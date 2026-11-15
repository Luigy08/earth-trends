import { z } from 'zod';
import type { ClimateMetric, Location } from '../../../shared/types';
import type { CacheStore, ClimateProvider, ClimateSeries } from '../backend.types';
import { CONFIG } from '../config.constant';
import { fetchJson, SourceError } from '../http';
import { daysInMonth } from '../statistics';

/** Credentials come from the server environment only (Render secrets or the ignored local env file). */
export function meteomaticsHeaders(): Record<string, string> | null {
  const username = process.env.METEOMATICS_USERNAME;
  const password = process.env.METEOMATICS_PASSWORD;
  return username && password ? { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` } : null;
}

export const meteomaticsResponseSchema = z.object({ data: z.array(z.object({ parameter: z.string(),
  coordinates: z.array(z.object({ dates: z.array(z.object({ date: z.string(), value: z.number().nullable() })) })),
})) });

const RESERVED_VALUES = new Set([-999, -888, -777, -666]);

/** Historical trend provider. Each analysis uses a single Meteomatics series without source splicing. */
export class MeteomaticsProvider implements ClimateProvider {
  constructor(private readonly cache: CacheStore) {}
  async getMonthly(location: Location, metric: ClimateMetric, startYear: number, endYear: number): Promise<ClimateSeries> {
    const headers = meteomaticsHeaders();
    if (!headers) throw new SourceError('Meteomatics');
    const parameter = metric === 'temperature' ? 't_mean_2m_24h:C' : 'precip_24h:mm';
    const key = `meteomatics-v1:${location.latitude}:${location.longitude}:${metric}:${startYear}:${endYear}`;
    const cached = await this.cache.get<ClimateSeries>(key);
    if (cached) return cached;
    const monthly: ClimateSeries['monthly'] = [];
    // Daily aggregates end at 00Z the next day. One request per year keeps payloads bounded.
    for (let year = startYear; year <= endYear; year++) {
      const interval = `${year}-01-02T00:00:00Z--${year + 1}-01-01T00:00:00Z:P1D`;
      const url = `https://api.meteomatics.com/${interval}/${parameter}/${location.latitude},${location.longitude}/json`;
      const parsed = meteomaticsResponseSchema.safeParse(await fetchJson(url, 'Meteomatics', headers));
      if (!parsed.success) throw new SourceError('Meteomatics');
      const dates = parsed.data.data.find(d => d.parameter === parameter)?.coordinates[0]?.dates;
      if (!dates) throw new SourceError('Meteomatics');
      const months = new Map<number, Map<number, number>>();
      for (const item of dates) {
        const date = new Date(Date.parse(item.date) - 86400000);
        if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year || item.value === null || RESERVED_VALUES.has(item.value) || !Number.isFinite(item.value)
          || (metric === 'precipitation' && item.value < 0)) continue;
        const month = date.getUTCMonth() + 1;
        const days = months.get(month) ?? new Map<number, number>();
        days.set(date.getUTCDate(), item.value);
        months.set(month, days);
      }
      for (let month = 1; month <= 12; month++) {
        const days = months.get(month);
        const count = daysInMonth(year, month);
        monthly.push({ year, month, value: days?.size === count ? [...days.values()].reduce((a, b) => a + b, 0) / count : null });
      }
    }
    const result: ClimateSeries = { monthly, provenance: { provider: 'Meteomatics', dataset: 'Meteomatics historical daily aggregates; complete monthly values derived in the app',
      parameters: [parameter], sourceUrl: 'https://api.meteomatics.com/', retrievedAt: new Date().toISOString(), temporalResolution: 'monthly',
      isHistorical: true, attribution: 'Meteomatics Weather API; historical coverage requires an eligible subscription and depends on the selected account.',
    } };
    await this.cache.set(key, result, CONFIG.cacheTtlSeconds);
    return result;
  }
}
