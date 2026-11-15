import type { BalamJob, JobStore } from '../datasources/registry';
import type { Prisma, PrismaClient } from '../generated/prisma/client';

/** Persists registry jobs in the QueryJob table (replaces MemoryJobStore in production). */
export class PrismaJobStore implements JobStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(id: string): Promise<BalamJob | undefined> {
    const row = await this.prisma.queryJob.findUnique({ where: { id } });
    return row ? (row.payload as unknown as BalamJob) : undefined;
  }

  async save(job: BalamJob): Promise<void> {
    // The JSON round trip drops `undefined` fields, which Prisma rejects in Json columns.
    const payload = JSON.parse(JSON.stringify(job)) as Prisma.InputJsonValue;
    await this.prisma.queryJob.upsert({ where: { id: job.id }, create: { id: job.id, payload }, update: { payload } });
  }
}
