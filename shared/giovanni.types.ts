import type { ClimateMetric } from './types';

/** A Giovanni data ID mapped to the Meteomatics parameter whose meaning it shares in this project. */
export interface GiovanniVariable {
  id: string;
  metric: ClimateMetric;
  meteomaticsParameter: 't_mean_2m_24h:C' | 'precip_24h:mm';
  dataset: string;
  documentationUrl: string;
  /** First calendar year of the product; earlier months are kept as null, never back-filled. */
  firstYear: number;
}
/** Linear conversion from a Giovanni-reported unit to the internal unit (°C, or mm/day for precipitation). */
export interface GiovanniUnitConversion { pattern: RegExp; factor: number; offset: number }
export interface GiovanniCsv { headers: Record<string, string>; rows: Array<{ timestamp: string; value: number | null }> }
