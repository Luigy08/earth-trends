import type { BalamReadRepository, SeriesFilter, StoredCoverage, StoredTrend, ZoneSummary } from '../src/balam/balam.types';
import type { BalamQuery, DataSource, DateValue, ParameterSeries, SourceJob, ZoneRef } from '../src/datasources/datasources.types';
import type { IngestRepository, IngestionJobRecord, NewIngestionJob, ObservationRow, TrendRecord, ZoneRecord } from '../src/ingest/ingest.types';

/* ---------- Simulated fetch ---------- */

export function mockFetch(routes: Record<string, (init?: RequestInit) => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const key = Object.keys(routes).find((k) => url.endsWith(k) || url === k);
    const route = key ? routes[key] : undefined;
    return route ? route(init) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return calls;
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/* ---------- Zones ---------- */

const square = (lon: number, lat: number): ZoneRecord['geometry'] => ({
  type: 'Polygon',
  coordinates: [[[lon, lat], [lon + 1, lat], [lon + 1, lat + 1], [lon, lat + 1], [lon, lat]]],
});

export const ZONES: ZoneRecord[] = [
  { id: 'HN-CR', name: 'Cortés', level: 'ADM1', country: 'HN', centroidLat: 15.5, centroidLon: -88, geometry: square(-88.5, 15) },
  { id: 'HN-FM', name: 'Francisco Morazán', level: 'ADM1', country: 'HN', centroidLat: 14.2, centroidLon: -87.2, geometry: square(-87.7, 13.7) },
];

export const ZONE_REFS: ZoneRef[] = ZONES.map((z) => ({ id: z.id, geometry: z.geometry, centroid: { lat: z.centroidLat, lon: z.centroidLon } }));

/* ---------- In-memory store ---------- */

const observationKey = (r: Pick<ObservationRow, 'variableId' | 'source' | 'zoneId' | 'date'>) => `${r.variableId}|${r.source}|${r.zoneId}|${r.date}`;

export class MemoryBalamRepository implements IngestRepository, BalamReadRepository {
  readonly observations = new Map<string, ObservationRow>();
  readonly jobs: IngestionJobRecord[] = [];
  readonly trendRecords = new Map<string, TrendRecord>();
  readonly deletedQueryJobs: string[] = [];
  clock: () => Date = () => new Date();

  constructor(public zoneRecords: ZoneRecord[] = ZONES) {}

  async listZones(level: string) { return this.zoneRecords.filter((z) => z.level === level); }
  async lastObservationDate(variableId: string, source: string) {
    const dates = [...this.observations.values()].filter((o) => o.variableId === variableId && o.source === source).map((o) => o.date).sort();
    return dates[dates.length - 1] ?? null;
  }
  async hasActiveJob(variableId: string, source: string) {
    return this.jobs.some((j) => j.variableId === variableId && j.source === source && (j.status === 'pending' || j.status === 'processing'));
  }
  async latestJobStartingAt(variableId: string, source: string, start: string) {
    return [...this.jobs].reverse().find((j) => j.variableId === variableId && j.source === source && j.start === start) ?? null;
  }
  async createJob(job: NewIngestionJob) {
    const record: IngestionJobRecord = { ...job, id: `job-${this.jobs.length + 1}`, createdAt: this.clock() };
    this.jobs.push(record);
    return { ...record };
  }
  async updateJob(id: string, patch: Partial<Pick<IngestionJobRecord, 'status' | 'error'>>) {
    Object.assign(this.jobs.find((j) => j.id === id)!, patch);
  }
  async listActiveJobs() { return this.jobs.filter((j) => j.status === 'pending' || j.status === 'processing').map((j) => ({ ...j })); }
  async upsertObservations(rows: ObservationRow[]) {
    for (const row of rows) this.observations.set(observationKey(row), row);
    return rows.length;
  }
  async loadSeries(variableId: string, source: string, zoneId: string) {
    return [...this.observations.values()].filter((o) => o.variableId === variableId && o.source === source && o.zoneId === zoneId)
      .sort((a, b) => a.date.localeCompare(b.date)).map(({ date, value }) => ({ date, value }));
  }
  async upsertTrend(trend: TrendRecord) { this.trendRecords.set(`${trend.variableId}|${trend.source}|${trend.zoneId}`, trend); }
  async deleteQueryJob(queryJobId: string) { this.deletedQueryJobs.push(queryJobId); }

  async zones(withGeometry: boolean): Promise<ZoneSummary[]> {
    return this.zoneRecords.map(({ geometry, ...zone }) => (withGeometry ? { ...zone, geometry } : zone));
  }
  async series(filter: SeriesFilter) {
    return [...this.observations.values()]
      .filter((o) => o.variableId === filter.variableId && filter.zoneIds.includes(o.zoneId) && (!filter.source || o.source === filter.source)
        && (!filter.from || o.date >= filter.from) && (!filter.to || o.date <= filter.to))
      .sort((a, b) => a.source.localeCompare(b.source) || a.zoneId.localeCompare(b.zoneId) || a.date.localeCompare(b.date));
  }
  async trends(filter: { variableId: string; zoneIds?: string[]; source?: string }): Promise<StoredTrend[]> {
    return [...this.trendRecords.values()]
      .filter((t) => t.variableId === filter.variableId && (!filter.zoneIds || filter.zoneIds.includes(t.zoneId)) && (!filter.source || t.source === filter.source))
      .map((t) => ({ ...t, updatedAt: '2026-11-15T00:00:00.000Z' }));
  }
  async activeIngestions() {
    return this.jobs.filter((j) => j.status === 'pending' || j.status === 'processing').map(({ variableId, source }) => ({ variableId, source }));
  }
  async coverage(): Promise<StoredCoverage[]> {
    const groups = new Map<string, StoredCoverage>();
    for (const t of this.trendRecords.values()) {
      const key = `${t.variableId}|${t.source}`;
      const g = groups.get(key) ?? { variableId: t.variableId, source: t.source, firstDate: t.firstDate, lastDate: t.lastDate, zones: 0 };
      groups.set(key, { ...g, firstDate: g.firstDate < t.firstDate ? g.firstDate : t.firstDate, lastDate: g.lastDate > t.lastDate ? g.lastDate : t.lastDate, zones: g.zones + 1 });
    }
    return [...groups.values()];
  }
}

/* ---------- Scripted data sources ---------- */

/** Answers each zone of the query with the samples `build` returns for it. */
export class ScriptedSource implements DataSource {
  readonly submitted: BalamQuery[] = [];
  /** Asynchronous sources stay "processing" until this is set. */
  ready = false;
  failure: string | undefined;

  constructor(readonly id: string, readonly synchronous: boolean, private readonly build: (zoneId: string, query: BalamQuery) => DateValue[]) {}

  private result(query: BalamQuery): ParameterSeries[] {
    const zones = query.location.kind === 'zones' ? query.location.zones : [];
    return query.parameters.map((p) => ({
      parameter: p.raw, source: this.id, unit: p.unit,
      coordinates: zones.map((z) => ({ lat: z.centroid.lat, lon: z.centroid.lon, id: z.id, dates: this.build(z.id, query) })),
    }));
  }

  async submit(query: BalamQuery): Promise<SourceJob> {
    this.submitted.push(query);
    const externalId = `task-${this.submitted.length}`;
    if (this.failure) return { source: this.id, externalId, status: 'error', context: {}, error: this.failure };
    if (this.synchronous) return { source: this.id, externalId, status: 'done', progress: 100, context: {}, result: this.result(query) };
    return { source: this.id, externalId, status: 'pending', context: { index: this.submitted.length - 1 } };
  }

  async refresh(job: SourceJob): Promise<SourceJob> {
    if (job.status === 'done' || job.status === 'error') return job;
    if (!this.ready) return { ...job, status: 'processing', progress: 50 };
    return { ...job, status: 'done', progress: 100, result: this.result(this.submitted[job.context.index as number]!) };
  }
}
