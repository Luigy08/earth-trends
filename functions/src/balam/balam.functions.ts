import type { Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { verifyAppCheck, verifyIdToken } from '../auth';
import type { CallableRequest } from '../backend.types';
import { loadAppeearsCatalog } from '../datasources/catalog/appeears-catalog';
import { DataSourceRegistry } from '../datasources/registry';
import { AppeearsSource } from '../datasources/sources/appeears';
import { MeteomaticsSource } from '../datasources/sources/meteomatics';
import { getPrisma } from '../db/client';
import { PrismaBalamRepository } from '../db/prisma-balam-repository';
import { PrismaJobStore } from '../db/prisma-job-store';
import type { PlanSummary } from '../ingest/ingest.types';
import { IngestService } from '../ingest/service';
import { INGEST_TARGETS } from '../ingest/targets.constant';
import { HttpsError } from '../http';
import { logger } from '../logger';
import { consumeQuota } from '../quota';
import { parseInput } from '../validation';
import { ApiError, handleBalamRequest } from './balam-api';
import { BALAM, databaseUrl, earthdataCredentials, meteomaticsCredentials } from './balam.constant';
import { backfillSchema } from './balam.validation';

/* ---------- Per-process wiring, created on first use so a process that never touches PostgreSQL starts without it ---------- */

let repository: PrismaBalamRepository | undefined;
let registry: DataSourceRegistry | undefined;
let ingest: IngestService | undefined;

export function getRepository(): PrismaBalamRepository {
  repository ??= new PrismaBalamRepository(getPrisma(databaseUrl(), BALAM.poolMax));
  return repository;
}

function getRegistry(): DataSourceRegistry {
  // Both sources are always registered; one without credentials reports itself unavailable on use.
  registry ??= new DataSourceRegistry(new PrismaJobStore(getPrisma(databaseUrl(), BALAM.poolMax)))
    .register(new MeteomaticsSource(meteomaticsCredentials()))
    .register(new AppeearsSource({ ...earthdataCredentials(), catalog: loadAppeearsCatalog() }));
  return registry;
}

export function getIngest(): IngestService {
  ingest ??= new IngestService(getRepository(), getRegistry());
  return ingest;
}

/* ---------- balamIngest (hourly cron job, see scripts/run-ingest.ts) ---------- */

export async function runBalamIngest(): Promise<void> {
  const service = getIngest();
  const processed = await service.process({ deadlineMs: BALAM.processBudgetMs });
  const planned = await service.plan();
  logger.info('balamIngest finished', {
    stored: processed.done, waiting: processed.waiting.length, failed: processed.failed, deferred: processed.deferred,
    requested: planned.created, skipped: planned.skipped, rows: planned.rows,
  });
}

/* ---------- balamApi (HTTP) ---------- */

async function authenticate(request: Request): Promise<string> {
  try {
    await verifyAppCheck(request.get('x-firebase-appcheck'));
    const decoded = await verifyIdToken(request.get('authorization'));
    if (!decoded) throw new HttpsError('unauthenticated', 'Sign in to continue.');
    if (decoded.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Sign in with Google to continue.');
    return decoded.uid;
  } catch (error) {
    if (error instanceof HttpsError) throw new ApiError(401, 'unauthenticated', error.message);
    throw error;
  }
}

async function consumeQueryQuota(ownerId: string): Promise<void> {
  try {
    // On-demand provider queries share the existing per-user and global Meteomatics execution budget.
    await consumeQuota(getFirestore(), ownerId, 'meteomaticsExecute');
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'resource-exhausted') throw new ApiError(429, 'resource_exhausted', error.message);
    throw error;
  }
}

export async function handleBalamApi(request: Request, response: Response): Promise<void> {
  try {
    const result = await handleBalamRequest(
      { method: request.method, path: request.path, query: request.query as Record<string, unknown>, body: request.body as unknown },
      { repository: getRepository(), registry: getRegistry, targets: INGEST_TARGETS, authenticate: () => authenticate(request), consumeQueryQuota },
    );
    response.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof ApiError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message, ...error.details } });
      return;
    }
    const message = error instanceof Error ? error.message : 'unknown';
    logger.error('balamApi failed', { path: request.path, message: message.slice(0, 500) });
    // A missing or unreachable database is reported as unavailable, never as an empty result.
    const unavailable = message.includes('DATABASE_URL');
    response.status(unavailable ? 503 : 500).json({ error: unavailable
      ? { code: 'store_unavailable', message: 'The data store is not available.' }
      : { code: 'internal', message: 'The request could not be completed.' } });
  }
}

/* ---------- balamBackfill (admin callable) ---------- */

export async function runBalamBackfill(request: CallableRequest<unknown>): Promise<PlanSummary> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  if (request.auth.token.admin !== true) throw new HttpsError('permission-denied', 'Administrator access is required.');
  const input = parseInput(backfillSchema, request.data ?? {});
  if (input.variableId && !INGEST_TARGETS.some((target) => target.variableId === input.variableId)) {
    throw new HttpsError('not-found', `"${input.variableId}" is not a preloaded variable.`);
  }
  const summary = await getIngest().plan({
    backfill: true, variableIds: input.variableId ? [input.variableId] : undefined, from: input.from, to: input.to, force: input.force,
  });
  logger.info('balamBackfill requested', { by: request.auth.uid, requested: summary.created.length, skipped: summary.skipped.length });
  return summary;
}
