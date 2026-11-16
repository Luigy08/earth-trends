import type { DataSourceRegistry } from '../datasources/registry';
import type { IngestTarget, ObservationRow, TrendRecord, ZoneRecord } from '../ingest/ingest.types';

export type ZoneSummary = Omit<ZoneRecord, 'geometry'> & Partial<Pick<ZoneRecord, 'geometry'>>;

export interface SeriesFilter {
  variableId: string;
  zoneIds: string[];
  source?: string;
  from?: string;
  to?: string;
}

export interface StoredTrend extends TrendRecord {
  updatedAt: string;
}

/** What is actually stored for one variable and source, across zones. */
export interface StoredCoverage {
  variableId: string;
  source: string;
  firstDate: string;
  lastDate: string;
  zones: number;
}

/** Read side of the Balam store, used by the HTTP API. */
export interface BalamReadRepository {
  /** All zones (capped), or only the ones named in `ids`. */
  zones(withGeometry: boolean, ids?: string[]): Promise<ZoneSummary[]>;
  series(filter: SeriesFilter): Promise<ObservationRow[]>;
  trends(filter: { variableId: string; zoneIds?: string[]; source?: string }): Promise<StoredTrend[]>;
  coverage(): Promise<StoredCoverage[]>;
  /** First and last stored date of each variable in each zone. */
  seriesCoverage(variableIds: string[], zoneIds: string[], source: string): Promise<{ variableId: string; zoneId: string; firstDate: string; lastDate: string }[]>;
  /** Variables and sources with a request still being processed by the provider. */
  activeIngestions(): Promise<{ variableId: string; source: string }[]>;
}

export interface ApiRequest {
  method: string;
  /** Path inside the function, e.g. "/series". */
  path: string;
  query: Record<string, unknown>;
  body: unknown;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface ApiDependencies {
  repository: BalamReadRepository;
  /** Built on demand: only /query needs provider credentials. */
  registry: () => DataSourceRegistry;
  targets: readonly IngestTarget[];
  /** Verifies the caller and returns the user id; rejects with ApiError otherwise. */
  authenticate: () => Promise<string>;
  /** Reserves one on-demand provider query for the user; rejects with ApiError when exhausted. */
  consumeQueryQuota: (ownerId: string) => Promise<void>;
}
