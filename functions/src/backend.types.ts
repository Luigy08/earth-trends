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
export type QuotaAction = 'interpretQuery' | 'searchLocations' | 'createAnalysis' | 'getAnalysis' | 'createSession';
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
