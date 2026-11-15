import { z } from 'zod';
import type { Location } from '../../../shared/types';
import type { CacheStore, PlaceCandidate, PlaceResolution } from '../backend.types';
import { fetchJson, SourceError } from '../http';
import { resolvePlace } from '../location.resolver';

const responseSchema = z.object({ results: z.array(z.object({
  id: z.number(), name: z.string(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  country: z.string().optional(), country_code: z.string().regex(/^[A-Z]{2}$/).optional(), admin1: z.string().optional(), feature_code: z.string().optional(),
  population: z.number().nonnegative().optional(),
})).optional() });

export class LocationSearch {
  constructor(private readonly cache: CacheStore) {}

  async search(query: string, limit: number): Promise<Location[]> {
    return (await this.candidates(query)).slice(0, limit).map(candidate => candidate.location);
  }

  /** Resolves a typed place to one location when the choice is clear; otherwise returns candidates to ask about. */
  async resolve(query: string): Promise<PlaceResolution> {
    return resolvePlace(query, await this.candidates(query));
  }

  private async candidates(query: string): Promise<PlaceCandidate[]> {
    const key = `geocode-v4:${query.trim().toLocaleLowerCase('en')}`;
    const cached = await this.cache.get<PlaceCandidate[]>(key);
    if (cached) return cached;
    const [city, ...qualifiers] = query.split(',').map(part => part.trim()).filter(Boolean);
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.search = new URLSearchParams({ name: city ?? query.trim(), count: String(qualifiers.length ? 100 : 20), language: 'en', format: 'json' }).toString();
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
    const result: PlaceCandidate[] = filtered.slice(0, 20).map(row => ({
      placeName: row.name, population: row.population ?? 0,
      location: { id: String(row.id), name: [row.name, row.admin1].filter(Boolean).join(', '), latitude: row.latitude, longitude: row.longitude,
        ...(row.country ? { country: row.country } : {}) },
    }));
    await this.cache.set(key, result, 604800);
    return result;
  }
}
