import { randomUUID } from 'node:crypto';
import type { BalamQuery, BalamResponse, DataSource, SourceId, SourceJob } from './datasources.types';
import { parseQueryPath } from './param-string';

/** Trabajo compuesto: una consulta de Balam puede tocar varias fuentes. */
export interface BalamJob {
  id: string;
  createdAt: string;
  /** Usuario que pidió la consulta bajo demanda (la API solo se la devuelve a él). */
  ownerId?: string;
  parts: SourceJob[];
}

/** Persistencia de trabajos. Cambia la implementación en memoria por Postgres/Redis en producción. */
export interface JobStore {
  get(id: string): Promise<BalamJob | undefined>;
  save(job: BalamJob): Promise<void>;
}

export class MemoryJobStore implements JobStore {
  private readonly m = new Map<string, BalamJob>();
  async get(id: string) {
    return this.m.get(id);
  }
  async save(job: BalamJob) {
    this.m.set(job.id, job);
  }
}

export class DataSourceRegistry {
  private readonly sources = new Map<SourceId, DataSource>();

  constructor(private readonly store: JobStore = new MemoryJobStore()) {}

  register(source: DataSource): this {
    this.sources.set(source.id, source);
    return this;
  }

  get sourceIds(): string[] {
    return [...this.sources.keys()];
  }

  /** "/2020-01-01T00:00:00Z--2020-12-31T00:00:00Z:P1D/t_2m:C,appeears/MOD11A1.061/LST_Day_1km:K/14.07,-87.19/json" */
  parse(path: string): BalamQuery {
    return parseQueryPath(path, this.sourceIds);
  }

  /** Divide la consulta por fuente y envía cada parte. */
  async submit(q: BalamQuery, meta: { ownerId?: string } = {}): Promise<BalamJob> {
    const bySource = new Map<SourceId, BalamQuery>();
    for (const p of q.parameters) {
      if (!this.sources.has(p.source)) throw new Error(`Unregistered source: ${p.source}`);
      const sub = bySource.get(p.source) ?? { ...q, parameters: [] };
      sub.parameters.push(p);
      bySource.set(p.source, sub);
    }
    const parts = await Promise.all(
      [...bySource].map(([id, sub]) =>
        this.sources
          .get(id)!
          .submit(sub)
          .catch((e: Error): SourceJob => ({ source: id, externalId: '', status: 'error', context: {}, error: e.message })),
      ),
    );
    const job: BalamJob = { id: randomUUID(), createdAt: new Date().toISOString(), ...(meta.ownerId ? { ownerId: meta.ownerId } : {}), parts };
    await this.store.save(job);
    return job;
  }

  /** Actualiza las partes pendientes y devuelve el estado/resultado combinado. */
  async poll(jobId: string): Promise<{ job: BalamJob; done: boolean; progress: number; response: BalamResponse }> {
    const job = await this.store.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    job.parts = await Promise.all(
      job.parts.map((p) =>
        this.sources
          .get(p.source)!
          .refresh(p)
          .catch((e: Error): SourceJob => ({ ...p, status: 'error', error: e.message })),
      ),
    );
    await this.store.save(job);
    const done = job.parts.every((p) => p.status === 'done' || p.status === 'error');
    const progress = Math.round(
      job.parts.reduce((a, p) => a + (p.status === 'done' || p.status === 'error' ? 100 : (p.progress ?? 0)), 0) / job.parts.length,
    );
    return { job, done, progress, response: this.merge(job) };
  }

  /** Envía y espera hasta terminar (útil en scripts / tareas programadas, no en una request HTTP). */
  async run(q: BalamQuery, opts: { pollMs?: number; timeoutMs?: number } = {}): Promise<BalamResponse> {
    const { pollMs = 15_000, timeoutMs = 60 * 60_000 } = opts;
    const job = await this.submit(q);
    const t0 = Date.now();
    for (;;) {
      const r = await this.poll(job.id);
      if (r.done) return r.response;
      if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for job ${job.id}`);
      await new Promise((ok) => setTimeout(ok, pollMs));
    }
  }

  private merge(job: BalamJob): BalamResponse {
    const data = job.parts.flatMap((p) => p.result ?? []);
    const errors = job.parts
      .filter((p) => p.status === 'error' || p.error)
      .map((p) => ({ source: p.source, message: p.error ?? 'Error' }));
    const status = errors.length === 0 ? 'OK' : data.length ? 'PARTIAL' : 'ERROR';
    return {
      version: 'balam-1.0',
      dateGenerated: new Date().toISOString(),
      status,
      data,
      ...(errors.length ? { errors } : {}),
    };
  }
}
