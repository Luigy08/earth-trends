import type { EarthdataVariable, EarthdataZone } from './earthdata.types';

/**
 * Series label in the Meteomatics envelope: "<variable> · <place> (<area mean|pixel>):<unit>".
 * The unit stays after the last colon, as every consumer of the envelope expects.
 */
export function earthdataSeriesLabel(variable: Pick<EarthdataVariable, 'description' | 'unit'>, zone: Pick<EarthdataZone, 'name' | 'kind'>): string {
  return `${variable.description} · ${zone.name} (${zone.kind === 'area' ? 'area mean' : 'pixel'}):${variable.unit}`.replace(/:(?=.*:)/g, ' ');
}
