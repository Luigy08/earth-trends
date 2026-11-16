import type { BalamQuery, Location, TimeRange } from '../datasources/datasources.types';
import { parseParameter } from '../datasources/param-string';
import type { DataSourceRegistry } from '../datasources/registry';
import type {
  IngestRepository, IngestTarget, IngestionJobRecord, PlacePlanRequest, PlanRequest, PlanSummary, ProcessSummary, TrendOptions, ZoneRecord,
} from './ingest.types';
import { addDays, daysBetween, fromDateString, sourceOf, splitRangeByMonths, toDateString, toObservationRows, trailingWindow } from './ingest.resolver';
import { DEFAULT_CHUNK_YEARS, ERROR_RECHECK_HOURS, INGEST_TARGETS, RECHECK_HOURS } from './targets.constant';
import { computeTrend } from './trends';

export interface IngestOptions {
  targets?: readonly IngestTarget[];
  now?: () => Date;
  trend?: TrendOptions;
  recheckHours?: number;
  errorRecheckHours?: number;
}

interface Window {
  start: string;
  end: string;
  time: TimeRange;
}

/**
 * Keeps PostgreSQL in step with the sources. Every entry point is short and idempotent:
 * `plan` and `planPlaces` only submit requests and `process` only collects the ones that already
 * finished, so a run never waits for an asynchronous source.
 */
export class IngestService {
  private readonly targets: readonly IngestTarget[];
  private readonly now: () => Date;
  private readonly recheckMs: number;
  private readonly errorRecheckMs: number;

  constructor(
    private readonly repo: IngestRepository,
    private readonly registry: DataSourceRegistry,
    private readonly options: IngestOptions = {},
  ) {
    this.targets = options.targets ?? INGEST_TARGETS;
    this.now = options.now ?? (() => new Date());
    this.recheckMs = (options.recheckHours ?? RECHECK_HOURS) * 3_600_000;
    this.errorRecheckMs = (options.errorRecheckHours ?? ERROR_RECHECK_HOURS) * 3_600_000;
  }

  /** Scheduled targets: submits the next missing range of each one for all zones of its level. */
  async plan(request: PlanRequest = {}): Promise<PlanSummary> {
    const summary: PlanSummary = { created: [], skipped: [], rows: 0 };
    const zonesByLevel = new Map<string, ZoneRecord[]>();
    const selected = request.variableIds ? this.targets.filter((t) => request.variableIds!.includes(t.variableId)) : this.targets;

    for (const target of selected) {
      let zones = zonesByLevel.get(target.zoneLevel);
      try {
        if (!zones) {
          zones = await this.repo.listZones(target.zoneLevel);
          zonesByLevel.set(target.zoneLevel, zones);
        }
      } catch (error) {
        summary.skipped.push({ variableId: target.variableId, source: sourceOf(target.parameter), reason: error instanceof Error ? error.message : 'Planning failed' });
        continue;
      }
      if (!zones.length) {
        summary.skipped.push({ variableId: target.variableId, source: sourceOf(target.parameter), reason: `No ${target.zoneLevel} zones are loaded` });
        continue;
      }
      await this.planTarget(target, zones, request, summary, { chunked: true });
    }
    return summary;
  }

  /**
   * On-demand places: requests the whole missing series of each range target for the given zones, one zone
   * at a time. A place is a single pixel series, so it goes out as one request instead of yearly blocks.
   */
  async planPlaces(request: PlacePlanRequest): Promise<PlanSummary> {
    const summary: PlanSummary = { created: [], skipped: [], rows: 0 };
    const zones = await this.repo.getZones(request.zoneIds);
    const selected = this.targets.filter((t) => t.mode === 'range' && (!request.variableIds || request.variableIds.includes(t.variableId)));
    for (const zone of zones) {
      for (const target of selected) await this.planTarget(target, [zone], { backfill: true, force: request.force }, summary, { chunked: false });
    }
    return summary;
  }

  /** Polls requests in flight and stores the ones that finished. `filter` narrows the run to some jobs. */
  async process(options: { deadlineMs?: number; filter?: (job: IngestionJobRecord) => boolean } = {}): Promise<ProcessSummary> {
    const summary: ProcessSummary = { done: [], waiting: [], failed: [], deferred: 0 };
    const stopAt = options.deadlineMs ? Date.now() + options.deadlineMs : Infinity;
    for (const job of await this.repo.listActiveJobs()) {
      if (options.filter && !options.filter(job)) continue;
      if (Date.now() >= stopAt) {
        summary.deferred++;
        continue;
      }
      try {
        const outcome = await this.advance(job);
        if (outcome.status === 'done') summary.done.push({ id: job.id, variableId: job.variableId, rows: outcome.rows });
        else if (outcome.status === 'error') summary.failed.push({ id: job.id, variableId: job.variableId, error: outcome.error });
        else summary.waiting.push(job.id);
      } catch (error) {
        // Left untouched on purpose: storing is idempotent, so the next run retries it.
        summary.failed.push({ id: job.id, variableId: job.variableId, error: error instanceof Error ? error.message : 'Processing failed' });
      }
    }
    return summary;
  }

  /* ---------- Planning ---------- */

  private async planTarget(target: IngestTarget, zones: ZoneRecord[], request: PlanRequest, summary: PlanSummary, mode: { chunked: boolean }): Promise<void> {
    const source = sourceOf(target.parameter);
    const zoneIds = zones.map((z) => z.id);
    const skip = (reason: string) => summary.skipped.push({ variableId: target.variableId, source, reason });
    try {
      if (await this.repo.hasActiveJob(target.variableId, source, zoneIds)) {
        skip('A request is already in progress');
        return;
      }
      const windows = await this.windowsFor(target, source, zoneIds, request, mode.chunked);
      if (typeof windows === 'string') {
        skip(windows);
        return;
      }
      for (const window of windows) await this.submit(target, source, zones, window, request.force === true, summary);
    } catch (error) {
      skip(error instanceof Error ? error.message : 'Planning failed');
    }
  }

  private async windowsFor(target: IngestTarget, source: string, zoneIds: string[], request: PlanRequest, chunked: boolean): Promise<Window[] | string> {
    const last = await this.repo.lastObservationDate(target.variableId, source, zoneIds);
    if (target.mode === 'trailing') {
      const { time, label } = trailingWindow(this.now(), target.trailingHours ?? 24, target.utcOffsetHours ?? 0);
      if (last && last >= label) return 'Up to date';
      return [{ start: label, end: label, time: { ...time, step: target.step } }];
    }
    const today = toDateString(this.now());
    const start = request.from ?? (last ? addDays(last, 1) : target.since);
    const end = request.to ?? today;
    if (!start) return 'The target has no start date';
    if (start > end) return 'Up to date';
    if (!request.from && last && daysBetween(last, end) < (target.cadenceDays ?? 1)) return 'Up to date for the product cadence';
    const chunks = chunked ? splitRangeByMonths(start, end, target.chunkMonths ?? (target.chunkYears ?? DEFAULT_CHUNK_YEARS) * 12) : [{ start, end }];
    return (request.backfill ? chunks : chunks.slice(0, 1)).map((chunk) => ({
      ...chunk,
      time: { start: fromDateString(chunk.start), end: fromDateString(chunk.end), step: target.step },
    }));
  }

  private async submit(target: IngestTarget, source: string, zones: ZoneRecord[], window: Window, force: boolean, summary: PlanSummary): Promise<void> {
    const zoneIds = zones.map((z) => z.id);
    const previous = await this.repo.latestJobStartingAt(target.variableId, source, window.start, zoneIds);
    // A request the source rejected may be retried soon; one it accepted is given time to produce data.
    const wait = previous?.status === 'error' ? this.errorRecheckMs : this.recheckMs;
    if (!force && previous && this.now().getTime() - previous.createdAt.getTime() < wait) {
      summary.skipped.push({ variableId: target.variableId, source, reason: `The range starting ${window.start} was requested recently` });
      return;
    }
    const query: BalamQuery = {
      parameters: [parseParameter(target.parameter, this.registry.sourceIds)],
      time: window.time,
      location: toLocation(zones),
    };
    const submitted = await this.registry.submit(query);
    const failed = submitted.parts.every((p) => p.status === 'error');
    const job = await this.repo.createJob({
      variableId: target.variableId,
      source,
      parameter: target.parameter,
      zoneIds,
      start: window.start,
      end: window.end,
      status: failed ? 'error' : 'pending',
      queryJobId: submitted.id,
      error: failed ? submitted.parts.map((p) => p.error).filter(Boolean).join('; ') || 'The source rejected the request' : null,
    });
    summary.created.push({ id: job.id, variableId: job.variableId, source, start: job.start, end: job.end, status: job.status });
    // Synchronous sources answer on submit, so their data is stored in this same run.
    if (!failed && submitted.parts.every((p) => p.status === 'done')) {
      const outcome = await this.advance(job);
      if (outcome.status === 'done') summary.rows += outcome.rows;
      const created = summary.created[summary.created.length - 1];
      if (created && outcome.status !== 'waiting') created.status = outcome.status;
    }
  }

  /* ---------- Processing ---------- */

  private async advance(job: IngestionJobRecord): Promise<{ status: 'done'; rows: number } | { status: 'error'; error: string } | { status: 'waiting' }> {
    const fail = async (error: string) => {
      await this.repo.updateJob(job.id, { status: 'error', error });
      return { status: 'error' as const, error };
    };
    if (!job.queryJobId) return fail('The job has no source request');

    let polled: Awaited<ReturnType<DataSourceRegistry['poll']>>;
    try {
      polled = await this.registry.poll(job.queryJobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Polling failed';
      if (message.startsWith('Job not found')) return fail(message);
      throw error;
    }
    if (!polled.done) {
      if (job.status !== 'processing' && polled.job.parts.some((p) => p.status === 'processing')) {
        await this.repo.updateJob(job.id, { status: 'processing' });
      }
      return { status: 'waiting' };
    }

    const sourceError = polled.response.errors?.map((e) => e.message).join('; ') || null;
    const series = polled.response.data.find((d) => d.parameter === job.parameter);
    // A source failure is recorded as such; it is never stored as an empty series.
    if (!series) return fail(sourceError ?? 'The source returned no series for this parameter');

    const target = this.targets.find((t) => t.variableId === job.variableId && sourceOf(t.parameter) === job.source);
    const rows = toObservationRows(series, {
      variableId: job.variableId,
      zoneIds: new Set(job.zoneIds),
      minSamples: target?.minSamplesPerDay,
      label: target?.mode === 'trailing' ? job.start : undefined,
    });
    const written = await this.repo.upsertObservations(rows);
    for (const zoneId of new Set(rows.map((r) => r.zoneId))) {
      await this.recomputeTrend(job.variableId, job.source, zoneId, series.unit);
    }
    await this.repo.updateJob(job.id, { status: 'done', error: sourceError });
    await this.repo.deleteQueryJob(job.queryJobId);
    return { status: 'done', rows: written };
  }

  private async recomputeTrend(variableId: string, source: string, zoneId: string, unit: string): Promise<void> {
    const trend = computeTrend(await this.repo.loadSeries(variableId, source, zoneId), this.options.trend);
    if (trend) await this.repo.upsertTrend({ ...trend, variableId, source, zoneId, unit });
  }
}

/** Polygons are requested as areas (zonal statistics); point zones as point samples. A request holds one kind. */
function toLocation(zones: ZoneRecord[]): Location {
  if (zones.every((zone) => zone.geometry.type === 'Point')) {
    return { kind: 'points', points: zones.map((zone) => ({ lat: zone.centroidLat, lon: zone.centroidLon, id: zone.id })) };
  }
  return {
    kind: 'zones',
    zones: zones.flatMap((zone) => (zone.geometry.type === 'Point' ? []
      : [{ id: zone.id, geometry: zone.geometry, centroid: { lat: zone.centroidLat, lon: zone.centroidLon } }])),
  };
}
