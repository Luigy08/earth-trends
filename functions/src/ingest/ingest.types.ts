import type { MultiPolygon, Polygon } from 'geojson';
import type { JobStatus } from '../datasources/datasources.types';

/** What the scheduled ingestion preloads for every zone of `zoneLevel`. */
export interface IngestTarget {
  /** Canonical variable id; `parameter` must be one of its bindings. */
  variableId: string;
  /** Full Balam parameter string, e.g. "appeears/MOD11A1.061/LST_Day_1km:C". */
  parameter: string;
  /**
   * range: historical series from `since` up to today, requested in chunks.
   * trailing: the last `trailingHours` hours, for sources with a short history window.
   */
  mode: 'range' | 'trailing';
  zoneLevel: string;
  /** First date of the product (range mode), YYYY-MM-DD. */
  since?: string;
  /** Maximum length of one request (range mode). */
  chunkYears?: number;
  /** Product cadence: no new request until at least this many days are missing. */
  cadenceDays?: number;
  trailingHours?: number;
  /** Sampling step for sources that take one (ISO-8601). */
  step?: string;
  /** Offset used to label a trailing window with a local calendar date. */
  utcOffsetHours?: number;
  /** Valid sub-daily samples needed for a daily value; fewer yields a null value. */
  minSamplesPerDay?: number;
}

export interface ZoneRecord {
  id: string;
  name: string;
  level: string;
  country: string;
  centroidLat: number;
  centroidLon: number;
  geometry: Polygon | MultiPolygon;
}

/** One daily value per variable, source and zone. `date` is YYYY-MM-DD. */
export interface ObservationRow {
  variableId: string;
  source: string;
  parameter: string;
  zoneId: string;
  date: string;
  value: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  std: number | null;
  count: number | null;
}

export interface IngestionJobRecord {
  id: string;
  variableId: string;
  source: string;
  parameter: string;
  zoneIds: string[];
  start: string;
  end: string;
  status: JobStatus;
  queryJobId: string | null;
  error: string | null;
  createdAt: Date;
}

export type NewIngestionJob = Omit<IngestionJobRecord, 'id' | 'createdAt'>;

export interface AnnualMean {
  year: number;
  /** null when the year has fewer valid months than the configured threshold. */
  mean: number | null;
  count: number;
  months: number;
}

export interface MonthlyMean {
  /** "2024-01" */
  month: string;
  mean: number;
  count: number;
}

export interface ClimatologyMonth {
  /** 1–12 */
  month: number;
  mean: number;
  /** Number of years that contributed a monthly mean. */
  count: number;
}

export interface TrendSummary {
  firstDate: string;
  lastDate: string;
  n: number;
  annual: AnnualMean[];
  monthly: MonthlyMean[];
  climatology: ClimatologyMonth[];
  /** Slopes and test statistics are null when the series cannot support inference. */
  olsSlopePerDecade: number | null;
  senSlopePerDecade: number | null;
  mannKendallZ: number | null;
  mannKendallP: number | null;
}

export interface TrendRecord extends TrendSummary {
  variableId: string;
  source: string;
  zoneId: string;
  unit: string;
}

export interface TrendOptions {
  /** A year needs this many distinct valid months to produce an annual mean. */
  minMonthsPerYear?: number;
  /** Complete years needed before any slope or test is reported. */
  minYears?: number;
  /** Share of the years between the first and last observation that must be complete. */
  minCoverage?: number;
}

/** Persistence used by the ingestion service. Implemented with Prisma in production and in memory in tests. */
export interface IngestRepository {
  listZones(level: string): Promise<ZoneRecord[]>;
  lastObservationDate(variableId: string, source: string): Promise<string | null>;
  hasActiveJob(variableId: string, source: string): Promise<boolean>;
  latestJobStartingAt(variableId: string, source: string, start: string): Promise<IngestionJobRecord | null>;
  createJob(job: NewIngestionJob): Promise<IngestionJobRecord>;
  updateJob(id: string, patch: Partial<Pick<IngestionJobRecord, 'status' | 'error'>>): Promise<void>;
  listActiveJobs(): Promise<IngestionJobRecord[]>;
  /** Inserts or overwrites by (variableId, source, zoneId, date). Returns the number of rows written. */
  upsertObservations(rows: ObservationRow[]): Promise<number>;
  loadSeries(variableId: string, source: string, zoneId: string): Promise<{ date: string; value: number | null }[]>;
  upsertTrend(trend: TrendRecord): Promise<void>;
  /** Drops the stored registry job once its data lives in Observation. */
  deleteQueryJob(queryJobId: string): Promise<void>;
}

export interface PlanRequest {
  /** Restrict to these canonical variables; all targets when omitted. */
  variableIds?: string[];
  /** Request every missing chunk at once instead of only the next one. */
  backfill?: boolean;
  /** Override the computed range (range mode), YYYY-MM-DD. */
  from?: string;
  to?: string;
  /** Request again even when the same range was requested recently. */
  force?: boolean;
}

export interface PlanSummary {
  created: { id: string; variableId: string; source: string; start: string; end: string; status: JobStatus }[];
  skipped: { variableId: string; source: string; reason: string }[];
  /** Rows written during this run by synchronous sources. */
  rows: number;
}

export interface ProcessSummary {
  done: { id: string; variableId: string; rows: number }[];
  waiting: string[];
  failed: { id: string; variableId: string; error: string }[];
  /** Jobs left for the next run because the time budget ran out. */
  deferred: number;
}
