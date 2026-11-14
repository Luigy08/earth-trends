import type { AnalysisSpec, MonthlyObservation } from '../../shared/types';
import type { CacheStore, ClimateSeries } from '../src/backend.types';

export class MemoryCache implements CacheStore {
  private readonly values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | null> { return (this.values.get(key) as T | undefined) ?? null; }
  async set<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

export const location = { id: '1', name: 'Tegucigalpa', latitude: 14.08, longitude: -87.21, country: 'Honduras' };
export const spec: AnalysisSpec = { metric: 'temperature', locations: [location], startYear: 1991, endYear: 2020, comparisonMode: 'none' };

export function makeMonthly(startYear: number, endYear: number, value = 20): MonthlyObservation[] {
  return Array.from({ length: endYear - startYear + 1 }, (_, i) => Array.from({ length: 12 }, (_, month) => ({ year: startYear + i, month: month + 1, value }))).flat();
}

export function makeSeries(monthly: MonthlyObservation[]): ClimateSeries {
  return { monthly, provenance: { provider: 'Meteomatics', dataset: 'fixture', parameters: ['t_mean_2m_24h:C'],
    sourceUrl: 'https://api.meteomatics.com/', retrievedAt: '2026-01-01T00:00:00Z', temporalResolution: 'monthly',
    isHistorical: true, attribution: 'Meteomatics' } };
}
