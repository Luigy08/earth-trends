import type { DecodedIdToken } from 'firebase-admin/auth';
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
/** Error codes shared with the frontend, which reads them as `functions/<code>`. */
export type FunctionsErrorCode = 'invalid-argument' | 'failed-precondition' | 'not-found' | 'already-exists' | 'permission-denied'
  | 'unauthenticated' | 'resource-exhausted' | 'unavailable' | 'internal';
/** What a callable handler receives: the request payload and, when a valid ID token was sent, the verified caller. */
export interface CallableRequest<T = unknown> {
  data: T;
  auth?: { uid: string; token: DecodedIdToken };
}
export interface CallableHandler<Result = unknown> {
  callable: true;
  // Payloads are untrusted until a handler validates them with `parseInput`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(request: CallableRequest<any>): Promise<Result>;
}
export type QuotaAction = 'interpretQuery' | 'meteomaticsSuggestions' | 'searchLocations' | 'createAnalysis' | 'getAnalysis' | 'createSession' | 'meteomaticsAvailability' | 'meteomaticsExecute' | 'giovanniExecute' | 'earthdataExecute';
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
