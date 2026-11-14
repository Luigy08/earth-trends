import { z } from 'zod';
import type { ClimateMetric, Location } from '../../../shared/types';
import type { CacheStore, ClimateProvider, ClimateSeries } from '../backend.types';
import { CONFIG } from '../config.constant';
import { fetchJson, SourceError } from '../http';

const responseSchema = z.object({
  properties: z.object({ parameter: z.record(z.record(z.number().nullable())) }),
  header: z.object({ fill_value: z.number().optional() }).passthrough().optional(),
  parameters: z.record(z.object({ units: z.string() })),
});

export class NasaPowerProvider implements ClimateProvider {
  constructor(private readonly cache: CacheStore) {}
  async getMonthly(location: Location, metric: ClimateMetric, startYear: number, endYear: number): Promise<ClimateSeries> {
    const parameter = metric === 'temperature' ? 'T2M' : 'PRECTOTCORR';
    const url = new URL('https://power.larc.nasa.gov/api/temporal/monthly/point');
    url.search = new URLSearchParams({ parameters: parameter, community: 'AG', latitude: String(location.latitude),
      longitude: String(location.longitude), start: String(startYear), end: String(endYear), format: 'JSON' }).toString();
    const key = `nasa-v1:${url}`;
    const cached = await this.cache.get<ClimateSeries>(key);
    if (cached) return cached;
    const parsed = responseSchema.safeParse(await fetchJson(url.toString(), 'NASA POWER'));
    if (!parsed.success || !parsed.data.properties.parameter[parameter]) throw new SourceError('NASA POWER');
    const expectedUnit = metric === 'temperature' ? 'C' : 'mm/day';
    if (parsed.data.parameters[parameter]?.units !== expectedUnit) throw new SourceError('NASA POWER');
    const values = parsed.data.properties.parameter[parameter]!;
    const fill = parsed.data.header?.fill_value ?? -999;
    const monthly: ClimateSeries['monthly'] = [];
    for (let year = startYear; year <= endYear; year++) {
      for (let month = 1; month <= 12; month++) {
        const value = values[`${year}${String(month).padStart(2, '0')}`];
        monthly.push({ year, month, value: value === undefined || value === null || !Number.isFinite(value) || value === fill || value === -999
          || (metric === 'precipitation' && value < 0) ? null : value });
      }
    }
    const result: ClimateSeries = { monthly, provenance: {
      provider: 'NASA POWER', dataset: 'MERRA-2 / NASA POWER monthly point', parameters: [parameter],
      sourceUrl: url.toString(), retrievedAt: new Date().toISOString(), temporalResolution: 'monthly', isHistorical: true,
      attribution: 'NASA POWER Project, NASA Langley Research Center; MERRA-2. Gridded estimates, not station observations.',
    } };
    await this.cache.set(key, result, CONFIG.cacheTtlSeconds);
    return result;
  }
}
