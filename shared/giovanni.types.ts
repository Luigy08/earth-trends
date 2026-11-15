import type { ClimateMetric } from './types';

/** A Giovanni data ID (<collection shortname>_<version>_<variable>) offered by this app. */
export interface GiovanniVariable {
  id: string;
  description: string;
  domain: string;
  /** Unit as documented by GES DISC; values are always labeled with the unit Giovanni reports. */
  unit: string;
  temporalResolution: 'monthly' | 'daily';
  /** First calendar year of the product. */
  firstYear: number;
  dataset: string;
  documentationUrl: string;
  /** Set only for variables used by trend analysis: the metric and the Meteomatics parameter whose meaning it shares. */
  metric?: ClimateMetric;
  meteomaticsParameter?: 't_mean_2m_24h:C' | 'precip_24h:mm';
}
/** Linear conversion from a Giovanni-reported unit to the internal unit (°C, or mm/day for precipitation). */
export interface GiovanniUnitConversion { pattern: RegExp; factor: number; offset: number }
export interface GiovanniCsv { headers: Record<string, string>; rows: Array<{ timestamp: string; value: number | null }> }
