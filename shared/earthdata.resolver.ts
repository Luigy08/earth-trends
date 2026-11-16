import { EARTHDATA_REGION } from './earthdata-catalog.constant';
import type { EarthdataVariable, EarthdataZone } from './earthdata.types';

const normalizeCountry = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('en');

/** True when a place belongs to the region the Earthdata workflow serves (see EARTHDATA_REGION). */
export function inEarthdataRegion(place: { latitude: number; longitude: number; country?: string | null }): boolean {
  const { south, north, west, east } = EARTHDATA_REGION.bounds;
  if (!(place.latitude >= south && place.latitude <= north && place.longitude >= west && place.longitude <= east)) return false;
  const country = normalizeCountry(place.country ?? '');
  if (!country) return true;
  return EARTHDATA_REGION.countries.some(name => normalizeCountry(name) === country) || EARTHDATA_REGION.countryCodes.some(code => code.toLocaleLowerCase('en') === country);
}

/**
 * Series label in the Meteomatics envelope: "<variable> · <place> (<area mean|pixel>):<unit>".
 * The unit stays after the last colon, as every consumer of the envelope expects.
 */
export function earthdataSeriesLabel(variable: Pick<EarthdataVariable, 'description' | 'unit'>, zone: Pick<EarthdataZone, 'name' | 'kind'>): string {
  return `${variable.description} · ${zone.name} (${zone.kind === 'area' ? 'area mean' : 'pixel'}):${variable.unit}`.replace(/:(?=.*:)/g, ' ');
}
