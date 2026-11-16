import type { Analysis, AnalysisSpec, ClimateMetric, DataProvenance, Location, MonthlyObservation } from '../../shared/types';

export interface ClimateSeries {
  monthly: MonthlyObservation[];
  provenance: DataProvenance;
}
export interface ClimateProvider {
  getMonthly(location: Location, metric: ClimateMetric, startYear: number, endYear: number): Promise<ClimateSeries>;
}
export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
}
export interface AnalysisJob {
  analysisId: string;
  ownerId: string;
  spec: AnalysisSpec;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  attempts: number;
  leaseToken?: string;
  leaseUntil?: number;
}
export interface StoredAnalysis extends Analysis { specHash: string }
export type QuotaAction = 'interpretQuery' | 'meteomaticsSuggestions' | 'searchLocations' | 'createAnalysis' | 'getAnalysis' | 'createSession' | 'meteomaticsAvailability' | 'meteomaticsExecute' | 'giovanniExecute' | 'earthdataExecute' | 'compareSessions';
export interface ParsedIntent {
  status: 'ready' | 'needs_clarification';
  metric?: ClimateMetric;
  locationQueries: string[];
  startYear?: number;
  endYear?: number;
  comparisonMode: 'none' | 'locations' | 'periods';
  secondPeriod?: { startYear: number; endYear: number };
  summary: string;
  clarificationQuestions: string[];
}

/** A geocoder match plus the fields used to choose between same-named places. */
export interface PlaceCandidate { location: Location; placeName: string; population: number }
/** Outcome of resolving a typed place: one chosen location, or the candidates to ask about. */
export interface PlaceResolution { match?: Location; candidates: Location[] }
