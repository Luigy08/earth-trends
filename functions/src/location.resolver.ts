import type { PlaceCandidate, PlaceResolution } from './backend.types';
import { PLACE_DOMINANCE_RATIO } from './config.constant';

const normalizePlace = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('en').trim();

/**
 * Chooses the place a user meant. The geocoder also returns prefix matches (Madrid → Madridejos),
 * so an exact name match wins over them; among same-named places, the most populous one is chosen
 * only when it clearly dominates (e.g. Madrid, Spain over Madrid, Colombia). Otherwise the user is asked.
 */
export function resolvePlace(query: string, candidates: PlaceCandidate[]): PlaceResolution {
  const city = normalizePlace(query.split(',')[0] ?? query);
  const exact = candidates.filter(candidate => normalizePlace(candidate.placeName) === city);
  const pool = exact.length ? exact : candidates;
  const [first, second] = [...pool].sort((a, b) => b.population - a.population);
  const list = pool.slice(0, 3).map(candidate => candidate.location);
  if (!first) return { candidates: [] };
  if (!second || (exact.length && first.population > 0 && first.population >= second.population * PLACE_DOMINANCE_RATIO)) {
    return { match: first.location, candidates: list };
  }
  return { candidates: list };
}
