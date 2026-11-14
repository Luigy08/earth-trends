import { z } from 'zod';
import type { Location } from '../../../shared/types';
import type { CacheStore } from '../backend.types';
import { fetchJson, SourceError } from '../http';

const responseSchema = z.object({ results: z.array(z.object({
  id: z.number(), name: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  country: z.string().optional(), country_code: z.string().regex(/^[A-Z]{2}$/).optional(), admin1: z.string().optional(), feature_code: z.string().optional(),
})).optional() });

export class LocationSearch {
  constructor(private readonly cache: CacheStore) {}
  async search(query: string, limit: number): Promise<Location[]> {
    const key = `geocode-v3:${query.trim().toLocaleLowerCase('en')}:${limit}`;
    const cached = await this.cache.get<Location[]>(key);
    if (cached) return cached;
    const [city, ...qualifiers] = query.split(',').map(part => part.trim()).filter(Boolean);
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: city ?? query.trim(), count: String(qualifiers.length ? 100 : limit), language: 'en', format: 'json' }).toString();
    const parsed = responseSchema.safeParse(await fetchJson(url.toString(), 'Open-Meteo'));
    if (!parsed.success) throw new SourceError('Open-Meteo');
    const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('en').trim();
    const countryNames = [new Intl.DisplayNames(['es'], { type: 'region' }), new Intl.DisplayNames(['en'], { type: 'region' })];
    const filtered = (parsed.data.results ?? []).filter(row => {
      // This app resolves cities: fuzzy airport matches are not competing city candidates.
      if (row.feature_code && !row.feature_code.startsWith('PPL')) return false;
      const names = [row.country, row.admin1, row.country_code,
        ...countryNames.map(display => row.country_code ? display.of(row.country_code) : undefined),
      ].filter((value): value is string => Boolean(value)).map(normalize);
      return qualifiers.every(qualifier => names.includes(normalize(qualifier)));
    });
    const result = filtered.slice(0, limit).map(row => ({ id: String(row.id),
      name: [row.name, row.admin1].filter(Boolean).join(', '), latitude: row.latitude, longitude: row.longitude,
      ...(row.country ? { country: row.country } : {}),
    }));
    await this.cache.set(key, result, 604800);
    return result;
  }
}
