import type { EarthdataVariable, EarthdataZone } from './earthdata.types';

/**
 * Series label in the Meteomatics envelope: "<variable> · <zone>:<unit>".
 * The unit stays after the last colon, as every consumer of the envelope expects.
 */
export function earthdataSeriesLabel(variable: Pick<EarthdataVariable, 'description' | 'unit'>, zone: Pick<EarthdataZone, 'name'>): string {
  return `${variable.description} · ${zone.name}:${variable.unit}`.replace(/:(?=.*:)/g, ' ');
}
