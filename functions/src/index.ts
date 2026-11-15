import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { EarthdataCatalogResponse, EarthdataExecuteResponse, EarthdataQuerySpec, InterpretEarthdataResponse } from '../../shared/types';
import type { AttachSessionAnalysisResponse, ChatSessionResponse, GetAnalysisResponse, GetSessionResponse, GiovanniCatalogResponse, GiovanniExecuteResponse, GiovanniQuerySpec, InterpretGiovanniResponse, InterpretMeteomaticsResponse, QueryExecuteResponse, InterpretQueryResponse, ListSessionsResponse, MeteomaticsAvailabilityResponse, MeteomaticsCatalogResponse, MeteomaticsExecuteResponse, SearchLocationsResponse } from '../../shared/types';
import { METEOMATICS_CATALOG_SOURCE, METEOMATICS_CATALOG_VERSION, METEOMATICS_PARAMETER_CATALOG } from '../../shared/meteomatics-catalog.constant';
import { CONFIG } from './config.constant';
import { FirestoreCache } from './cache';
import { AnalysisRepository } from './repository';
import { SessionRepository } from './sessions';
import { AnalysisService } from './analysis';
import { MeteomaticsProvider } from './providers/meteomatics';
import { MeteomaticsQueryProvider } from './providers/meteomatics-query';
import { GiovanniProvider } from './providers/giovanni';
import { GiovanniQueryProvider } from './providers/giovanni-query';
import { resolveGiovanniChart } from './giovanni-chart.resolver';
import { GIOVANNI_CATALOG_SOURCE, GIOVANNI_CATALOG_VERSION, GIOVANNI_VARIABLES } from '../../shared/giovanni-catalog.constant';
import { LocationSearch } from './providers/locations';
import { explainResults, interpretEarthdataQuery, interpretGiovanniQuery, interpretMeteomaticsQuery, parseIntent, resolveInterpretation } from './ai';
import { meteomaticsSourceIssue } from './meteomatics-source.resolver';
import { resolveMeteomaticsChart } from './meteomatics-chart.resolver';
import { generateMeteomaticsSuggestions } from './meteomatics-suggestions';
import { consumeQuota } from './quota';
import { HttpsError, SourceError } from './http';
import { logger } from './logger';
import { onCall } from './auth';
import { AnalysisWorker } from './analysis-worker';
import type { CallableRequest } from './backend.types';
import { getIngest as getBalamIngest, getRepository as getBalamRepository, runBalamBackfill } from './balam/balam.functions';
import { INGEST_TARGETS } from './ingest/targets.constant';
import { EarthdataQueryProvider, EarthdataRequestError } from './providers/earthdata-query';
import { resolveEarthdataChart } from './earthdata-chart.resolver';
import { earthdataExecuteSchema, interpretEarthdataSchema } from './validation';
import { attachSessionAnalysisSchema, chatSessionSchema, createAnalysisSchema, getAnalysisSchema, giovanniExecuteSchema, interpretGiovanniSchema, interpretMeteomaticsSchema, interpretQuerySchema, saveQuerySessionSchema, meteomaticsAvailabilitySchema, meteomaticsExecuteSchema, parseInput, renameSessionSchema, searchLocationsSchema, sessionRequestSchema } from './validation';

if (!getApps().length) initializeApp({ projectId: CONFIG.projectId });
const db = getFirestore();
const cache = new FirestoreCache(db);
const repository = new AnalysisRepository(db);
const sessions = new SessionRepository(db);
const locations = new LocationSearch(cache);
const analysisService = new AnalysisService(new MeteomaticsProvider(cache), cache, { giovanni: new GiovanniProvider(cache) });
const meteomaticsQueries = new MeteomaticsQueryProvider(cache);
const giovanniQueries = new GiovanniQueryProvider(cache);
// The Earthdata workflow reads the Balam store. Only running a query can ask NASA for missing data.
const earthdataQueries = new EarthdataQueryProvider(getBalamRepository, INGEST_TARGETS, variableIds => getBalamIngest().plan({ variableIds, backfill: true }));

function requireOwner(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  if (request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Sign in with Google to continue.');
  return request.auth.uid;
}

export const interpretQuery = onCall(async (request): Promise<InterpretQueryResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(interpretQuerySchema, request.data);
  await consumeQuota(db, ownerId, 'interpretQuery');
  try { return await resolveInterpretation(await parseIntent(input.query), locations); }
  catch (error) {
    logger.warn('interpretQuery unavailable', { kind: error instanceof SourceError ? error.provider : 'AI' });
    throw new HttpsError('unavailable', 'Interpretation is unavailable. Try again or configure the analysis manually.');
  }
});

export const createSession = onCall(async request => {
  const ownerId = requireOwner(request);
  await consumeQuota(db, ownerId, 'createSession');
  return { session: await sessions.create(ownerId) };
});
export const getMeteomaticsSession = onCall(async request => {
  const ownerId = requireOwner(request);
  const input = parseInput(sessionRequestSchema, request.data);
  await sessions.get(ownerId, input.sessionId);
  const snapshot = await db.collection('sessions').doc(input.sessionId).collection('meteoState').orderBy('index').get();
  if (snapshot.empty) return { state: null };
  const state = JSON.parse(snapshot.docs.map(doc => doc.get('data')).join('')) as import('../../shared/types').MeteomaticsSessionState | import('../../shared/types').GiovanniSessionState | import('../../shared/types').EarthdataSessionState;
  // Session state holds Meteomatics, Giovanni or Earthdata results; chart trends are recomputed on read.
  if (Array.isArray(state.results)) state.results = (state.results as QueryExecuteResponse[]).map(result => result.provider === 'NASA Giovanni'
    ? { ...result, chartTrends: resolveGiovanniChart(result.result, result.request) }
    : result.provider === 'NASA AppEEARS' ? { ...result, chartTrends: resolveEarthdataChart(result.result, result.request) }
    : { ...result, chartTrends: resolveMeteomaticsChart(result.result, result.request) }) as typeof state.results;
  return { state };
});
export const saveMeteomaticsSession = onCall(async request => {
  const ownerId = requireOwner(request);
  const sessionId = request.data?.sessionId;
  const state = request.data?.state;
  const input = parseInput(saveQuerySessionSchema, { sessionId, workflow: request.data?.workflow });
  const session = await sessions.get(ownerId, input.sessionId);
  if (!state || !Array.isArray(state.messages)) throw new HttpsError('invalid-argument', 'Invalid session data.');
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized, 'utf8') > 8000000) throw new HttpsError('resource-exhausted', 'Session data is too large to save.');
  const chunks = serialized.match(/[\s\S]{1,100000}/g) ?? [];
  const ref = db.collection('sessions').doc(input.sessionId);
  const old = await ref.collection('meteoState').get();
  const batch = db.batch();
  old.docs.forEach(doc => batch.delete(doc.ref));
  chunks.forEach((data, index) => batch.set(ref.collection('meteoState').doc(String(index).padStart(5, '0')), { index, data }));
  const first = state.messages.find((message: { role?: string; content?: string }) => message.role === 'user' && typeof message.content === 'string');
  const title = session.session.title === 'New climate question' && first ? first.content.slice(0, 64).trim() : session.session.title;
  const updated = { ...session.session, title, workflow: input.workflow, updatedAt: new Date().toISOString() };
  batch.update(ref, { title, workflow: updated.workflow, updatedAt: updated.updatedAt });
  await batch.commit();
  return { session: updated };
});
export const listSessions = onCall(async (request): Promise<ListSessionsResponse> => ({ sessions: await sessions.list(requireOwner(request)) }));
export const getSession = onCall(async (request): Promise<GetSessionResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(sessionRequestSchema, request.data);
  return sessions.get(ownerId, input.sessionId);
});
export const renameSession = onCall(async request => {
  const ownerId = requireOwner(request);
  const input = parseInput(renameSessionSchema, request.data);
  return { session: await sessions.rename(ownerId, input.sessionId, input.title) };
});
export const deleteSession = onCall(async request => {
  const ownerId = requireOwner(request);
  const input = parseInput(sessionRequestSchema, request.data);
  await sessions.delete(ownerId, input.sessionId);
  return { deleted: true as const };
});
export const attachSessionAnalysis = onCall(async (request): Promise<AttachSessionAnalysisResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(attachSessionAnalysisSchema, request.data);
  const analysis = await repository.get(ownerId, input.analysisId);
  const message = await sessions.attachAnalysis(ownerId, input.sessionId, analysis);
  return { attached: true, message };
});

export const chatSession = onCall(async (request): Promise<ChatSessionResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(chatSessionSchema, request.data);
  await consumeQuota(db, ownerId, 'interpretQuery');
  try {
    const { messages } = await sessions.get(ownerId, input.sessionId);
    const intent = await parseIntent(input.message, messages.slice(-12).map(({ role, content }) => ({ role, content })));
    const interpretation = await resolveInterpretation(intent, locations);
    const status = interpretation.status;
    const reply = status === 'ready'
      ? `${interpretation.summary} I have enough information to prepare this analysis. Review the request below, then confirm when you are ready.`
      : interpretation.clarificationQuestions.join(' ');
    const appended = await sessions.append(ownerId, input.sessionId, input.message, reply, interpretation.spec);
    return { ...appended, status, ...(interpretation.spec ? { spec: interpretation.spec } : {}) };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.warn('chatSession unavailable', { kind: error instanceof SourceError ? error.provider : 'AI' });
    throw new HttpsError('unavailable', 'The assistant is unavailable. Please try again.');
  }
});

export const searchLocations = onCall(async (request): Promise<SearchLocationsResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(searchLocationsSchema, request.data);
  await consumeQuota(db, ownerId, 'searchLocations');
  try { return { locations: await locations.search(input.query, input.limit) }; }
  catch { throw new HttpsError('unavailable', 'Location search is unavailable. Please try again later.'); }
});

export const getMeteomaticsSuggestions = onCall(async request => {
  requireOwner(request);
  try {
    const suggestions = await generateMeteomaticsSuggestions();
    return { suggestions };
  } catch (error) {
    logger.warn('Meteomatics suggestions unavailable', { kind: error instanceof Error ? error.name : 'unknown' });
    throw new HttpsError('unavailable', 'Search suggestions are temporarily unavailable.');
  }
});

export const getMeteomaticsCatalog = onCall(async (request): Promise<MeteomaticsCatalogResponse> => {
  requireOwner(request);
  return { version: METEOMATICS_CATALOG_VERSION, sourceUrl: METEOMATICS_CATALOG_SOURCE, parameters: [...METEOMATICS_PARAMETER_CATALOG] };
});

export const interpretMeteomatics = onCall(async (request): Promise<InterpretMeteomaticsResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(interpretMeteomaticsSchema, request.data);
  await consumeQuota(db, ownerId, 'interpretQuery');
  try { return await interpretMeteomaticsQuery(input.query, locations); }
  catch (error) {
    logger.warn('Meteomatics request interpretation failed', { kind: error instanceof Error ? error.name : 'unknown' });
    throw new HttpsError('unavailable', 'The Meteomatics assistant is unavailable. Try again or prepare the request manually.');
  }
});

export const checkMeteomaticsAvailability = onCall(async (request): Promise<MeteomaticsAvailabilityResponse> => {
  const ownerId = requireOwner(request);
  const sourceIssue = meteomaticsSourceIssue(request.data?.spec?.source);
  if (sourceIssue) throw new HttpsError('invalid-argument', sourceIssue);
  const input = parseInput(meteomaticsAvailabilitySchema, request.data);
  await consumeQuota(db, ownerId, 'meteomaticsAvailability');
  try { return await meteomaticsQueries.checkAvailability(input.spec); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Meteomatics is unavailable. Check credentials and account access.';
    logger.warn('Meteomatics availability check failed', { message });
    throw new HttpsError('unavailable', message.slice(0, 500));
  }
});

export const executeMeteomaticsQuery = onCall(async (request): Promise<MeteomaticsExecuteResponse> => {
  const ownerId = requireOwner(request);
  const sourceIssue = meteomaticsSourceIssue(request.data?.spec?.source);
  if (sourceIssue) throw new HttpsError('invalid-argument', sourceIssue);
  const input = parseInput(meteomaticsExecuteSchema, request.data);
  await consumeQuota(db, ownerId, 'meteomaticsExecute');
  try { return await meteomaticsQueries.execute(input.spec); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Meteomatics query failed.';
    logger.warn('Meteomatics query failed', { message });
    throw new HttpsError('unavailable', message.slice(0, 500));
  }
});

export const getGiovanniCatalog = onCall(async (request): Promise<GiovanniCatalogResponse> => {
  requireOwner(request);
  return { version: GIOVANNI_CATALOG_VERSION, sourceUrl: GIOVANNI_CATALOG_SOURCE, variables: [...GIOVANNI_VARIABLES] };
});

export const interpretGiovanni = onCall(async (request): Promise<InterpretGiovanniResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(interpretGiovanniSchema, request.data);
  await consumeQuota(db, ownerId, 'interpretQuery');
  try { return await interpretGiovanniQuery(input.query, locations); }
  catch (error) {
    logger.warn('Giovanni request interpretation failed', { kind: error instanceof Error ? error.name : 'unknown' });
    throw new HttpsError('unavailable', 'The Giovanni assistant is unavailable. Try again later.');
  }
});

export const executeGiovanniQuery = onCall(async (request): Promise<GiovanniExecuteResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(giovanniExecuteSchema, request.data);
  await consumeQuota(db, ownerId, 'giovanniExecute');
  try { return await giovanniQueries.execute(input.spec as GiovanniQuerySpec); }
  catch (error) {
    logger.warn('Giovanni query failed', { kind: error instanceof SourceError ? error.provider : error instanceof Error ? error.name : 'unknown' });
    throw new HttpsError('unavailable', 'NASA Giovanni is unavailable or did not return data for this variable, place and period. Check the Earthdata credentials and try again.');
  }
});

function earthdataError(error: unknown, context: string): HttpsError {
  if (error instanceof EarthdataRequestError) return new HttpsError(error.code, error.message);
  logger.warn(context, { kind: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message.slice(0, 300) : '' });
  return new HttpsError('unavailable', 'The NASA Earthdata store is unavailable. Please try again later.');
}

export const getEarthdataCatalog = onCall(async (request): Promise<EarthdataCatalogResponse> => {
  requireOwner(request);
  try { return await earthdataQueries.catalog(); }
  catch (error) { throw earthdataError(error, 'Earthdata catalog failed'); }
});

export const interpretEarthdata = onCall(async (request): Promise<InterpretEarthdataResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(interpretEarthdataSchema, request.data);
  await consumeQuota(db, ownerId, 'interpretQuery');
  try { return await interpretEarthdataQuery(input.query, locations, await earthdataQueries.catalog(), (latitude, longitude) => earthdataQueries.zoneAt(latitude, longitude)); }
  catch (error) {
    logger.warn('Earthdata request interpretation failed', { kind: error instanceof Error ? error.name : 'unknown' });
    throw new HttpsError('unavailable', 'The NASA Earthdata assistant is unavailable. Try again later.');
  }
});

export const executeEarthdataQuery = onCall(async (request): Promise<EarthdataExecuteResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(earthdataExecuteSchema, request.data);
  await consumeQuota(db, ownerId, 'earthdataExecute');
  try { return await earthdataQueries.execute(input.spec as EarthdataQuerySpec); }
  catch (error) { throw earthdataError(error, 'Earthdata query failed'); }
});

export const createAnalysis = onCall(async request => {
  const ownerId = requireOwner(request);
  const input = parseInput(createAnalysisSchema, request.data);
  const created = await repository.create(ownerId, input.spec, input.requestId);
  // Start right away; the worker's sweep picks it up anyway if this process restarts first.
  if (created.status === 'queued') analysisWorker.enqueue(created.analysisId);
  return created;
});

export const getAnalysis = onCall(async (request): Promise<GetAnalysisResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(getAnalysisSchema, request.data);
  await consumeQuota(db, ownerId, 'getAnalysis');
  return { analysis: await repository.get(ownerId, input.analysisId) };
});

/** One processing attempt. A failed attempt goes back to the queue and the worker retries it while attempts remain. */
async function processAnalysis(analysisId: string): Promise<void> {
  const claim = await repository.claim(analysisId);
  if (!claim) return;
  try {
    const result = await analysisService.run(claim.job.spec);
    const explanation = await explainResults(result);
    if (explanation) result.narrative += `\n\n${explanation}`;
    await repository.finish(analysisId, claim.token, result);
  } catch {
    logger.error('Analysis processing failed', { analysisId, attempt: claim.job.attempts });
    await repository.release(analysisId, claim.token);
  }
}

export const analysisWorker = new AnalysisWorker(() => repository.pending(), processAnalysis);

// Balam: multi-source data (Meteomatics + NASA AppEEARS) preloaded into PostgreSQL. The HTTP API is mounted by the server
// and the hourly ingestion runs as a separate cron job (scripts/run-ingest.ts).
export const balamBackfill = onCall(runBalamBackfill);
