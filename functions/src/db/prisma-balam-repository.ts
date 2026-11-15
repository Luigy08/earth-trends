import type { BalamReadRepository, SeriesFilter, StoredCoverage, StoredTrend, ZoneSummary } from '../balam/balam.types';
import type { JobStatus } from '../datasources/datasources.types';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type {
  AnnualMean, ClimatologyMonth, IngestRepository, IngestionJobRecord, MonthlyMean, NewIngestionJob, ObservationRow, TrendRecord, ZoneRecord,
} from '../ingest/ingest.types';
import { fromDateString, toDateString } from '../ingest/ingest.resolver';

const ACTIVE: JobStatus[] = ['pending', 'processing'];
const BATCH_SIZE = 500;

type JobRow = { id: string; variableId: string; source: string; parameter: string; zoneIds: string[]; start: Date; end: Date;
  status: string; queryJobId: string | null; error: string | null; createdAt: Date };

const toJob = (row: JobRow): IngestionJobRecord => ({ ...row, start: toDateString(row.start), end: toDateString(row.end), status: row.status as JobStatus });
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** PostgreSQL implementation of both sides of the Balam store: ingestion writes and API reads. */
export class PrismaBalamRepository implements IngestRepository, BalamReadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /* ---------- Ingestion ---------- */

  async listZones(level: string): Promise<ZoneRecord[]> {
    const rows = await this.prisma.zone.findMany({ where: { level }, orderBy: { id: 'asc' } });
    return rows.map((row) => ({ ...row, geometry: row.geometry as unknown as ZoneRecord['geometry'] }));
  }

  async lastObservationDate(variableId: string, source: string): Promise<string | null> {
    const result = await this.prisma.observation.aggregate({ where: { variableId, source }, _max: { date: true } });
    return result._max.date ? toDateString(result._max.date) : null;
  }

  async hasActiveJob(variableId: string, source: string): Promise<boolean> {
    return (await this.prisma.ingestionJob.count({ where: { variableId, source, status: { in: ACTIVE } } })) > 0;
  }

  async latestJobStartingAt(variableId: string, source: string, start: string): Promise<IngestionJobRecord | null> {
    const row = await this.prisma.ingestionJob.findFirst({ where: { variableId, source, start: fromDateString(start) }, orderBy: { createdAt: 'desc' } });
    return row ? toJob(row) : null;
  }

  async createJob(job: NewIngestionJob): Promise<IngestionJobRecord> {
    return toJob(await this.prisma.ingestionJob.create({ data: { ...job, start: fromDateString(job.start), end: fromDateString(job.end) } }));
  }

  async updateJob(id: string, patch: Partial<Pick<IngestionJobRecord, 'status' | 'error'>>): Promise<void> {
    await this.prisma.ingestionJob.update({ where: { id }, data: patch });
  }

  async listActiveJobs(): Promise<IngestionJobRecord[]> {
    const rows = await this.prisma.ingestionJob.findMany({ where: { status: { in: ACTIVE } }, orderBy: { createdAt: 'asc' } });
    return rows.map(toJob);
  }

  async upsertObservations(rows: ObservationRow[]): Promise<number> {
    // One statement cannot touch the same key twice, so duplicates collapse to the last value first.
    const unique = [...new Map(rows.map((r) => [`${r.variableId}|${r.source}|${r.zoneId}|${r.date}`, r])).values()];
    let written = 0;
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const values = unique.slice(i, i + BATCH_SIZE).map((r) => Prisma.sql`(${r.variableId}, ${r.source}, ${r.parameter}, ${r.zoneId}, ${r.date}::date,
        ${r.value}::double precision, ${r.min}::double precision, ${r.max}::double precision, ${r.median}::double precision, ${r.std}::double precision, ${r.count}::integer)`);
      written += await this.prisma.$executeRaw`
        INSERT INTO "Observation" ("variableId", "source", "parameter", "zoneId", "date", "value", "min", "max", "median", "std", "count")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("variableId", "source", "zoneId", "date") DO UPDATE SET
          "parameter" = EXCLUDED."parameter", "value" = EXCLUDED."value", "min" = EXCLUDED."min", "max" = EXCLUDED."max",
          "median" = EXCLUDED."median", "std" = EXCLUDED."std", "count" = EXCLUDED."count", "ingestedAt" = now()`;
    }
    return written;
  }

  async loadSeries(variableId: string, source: string, zoneId: string): Promise<{ date: string; value: number | null }[]> {
    const rows = await this.prisma.observation.findMany({ where: { variableId, source, zoneId }, select: { date: true, value: true }, orderBy: { date: 'asc' } });
    return rows.map((row) => ({ date: toDateString(row.date), value: row.value }));
  }

  async upsertTrend(trend: TrendRecord): Promise<void> {
    const { variableId, source, zoneId, firstDate, lastDate, annual, monthly, climatology, ...stats } = trend;
    const data = { ...stats, firstDate: fromDateString(firstDate), lastDate: fromDateString(lastDate), annual: json(annual), monthly: json(monthly), climatology: json(climatology) };
    await this.prisma.trend.upsert({
      where: { variableId_source_zoneId: { variableId, source, zoneId } },
      create: { variableId, source, zoneId, ...data },
      update: data,
    });
  }

  async deleteQueryJob(queryJobId: string): Promise<void> {
    await this.prisma.queryJob.deleteMany({ where: { id: queryJobId } });
  }

  /* ---------- API reads ---------- */

  async zones(withGeometry: boolean): Promise<ZoneSummary[]> {
    const rows = await this.prisma.zone.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, name: true, level: true, country: true, centroidLat: true, centroidLon: true, geometry: withGeometry },
    });
    return rows.map(({ geometry, ...zone }) => (withGeometry ? { ...zone, geometry: geometry as unknown as ZoneRecord['geometry'] } : zone));
  }

  async series(filter: SeriesFilter): Promise<ObservationRow[]> {
    const rows = await this.prisma.observation.findMany({
      where: {
        variableId: filter.variableId,
        zoneId: { in: filter.zoneIds },
        ...(filter.source ? { source: filter.source } : {}),
        ...(filter.from || filter.to
          ? { date: { ...(filter.from ? { gte: fromDateString(filter.from) } : {}), ...(filter.to ? { lte: fromDateString(filter.to) } : {}) } }
          : {}),
      },
      orderBy: [{ source: 'asc' }, { zoneId: 'asc' }, { date: 'asc' }],
    });
    return rows.map(({ ingestedAt: _ingestedAt, date, ...row }) => ({ ...row, date: toDateString(date) }));
  }

  async trends(filter: { variableId: string; zoneIds?: string[]; source?: string }): Promise<StoredTrend[]> {
    const rows = await this.prisma.trend.findMany({
      where: { variableId: filter.variableId, ...(filter.zoneIds ? { zoneId: { in: filter.zoneIds } } : {}), ...(filter.source ? { source: filter.source } : {}) },
      orderBy: [{ source: 'asc' }, { zoneId: 'asc' }],
    });
    return rows.map((row) => ({
      ...row,
      firstDate: toDateString(row.firstDate),
      lastDate: toDateString(row.lastDate),
      annual: row.annual as unknown as AnnualMean[],
      monthly: row.monthly as unknown as MonthlyMean[],
      climatology: row.climatology as unknown as ClimatologyMonth[],
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async coverage(): Promise<StoredCoverage[]> {
    const groups = await this.prisma.trend.groupBy({ by: ['variableId', 'source'], _min: { firstDate: true }, _max: { lastDate: true }, _count: { zoneId: true } });
    return groups.flatMap((group) => (group._min.firstDate && group._max.lastDate
      ? [{ variableId: group.variableId, source: group.source, firstDate: toDateString(group._min.firstDate), lastDate: toDateString(group._max.lastDate), zones: group._count.zoneId }]
      : []));
  }
}
