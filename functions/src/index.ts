import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import type { AttachSessionAnalysisResponse, ChatSessionResponse, GetAnalysisResponse, GetSessionResponse, InterpretQueryResponse, ListSessionsResponse, SearchLocationsResponse } from '../../shared/types';
import { CONFIG } from './config.constant';
import { FirestoreCache } from './cache';
import { AnalysisRepository } from './repository';
import { SessionRepository } from './sessions';
import { AnalysisService } from './analysis';
import { NasaPowerProvider } from './providers/nasa';
import { MeteomaticsProvider, processingSecrets } from './providers/meteomatics';
import { LocationSearch } from './providers/locations';
import { explainResults, parseIntent, resolveInterpretation } from './ai';
import { consumeQuota } from './quota';
import { SourceError } from './http';
import { attachSessionAnalysisSchema, chatSessionSchema, createAnalysisSchema, getAnalysisSchema, interpretQuerySchema, parseInput, renameSessionSchema, searchLocationsSchema, sessionRequestSchema } from './validation';

if (!getApps().length) initializeApp({ projectId: CONFIG.projectId });
setGlobalOptions({ region: CONFIG.region, maxInstances: CONFIG.maxInstances });
const db = getFirestore();
const cache = new FirestoreCache(db);
const repository = new AnalysisRepository(db);
const sessions = new SessionRepository(db);
const locations = new LocationSearch(cache);
const analysisService = new AnalysisService(new NasaPowerProvider(cache), cache, new MeteomaticsProvider(cache));
const callableOptions = { enforceAppCheck: CONFIG.enforceAppCheck, timeoutSeconds: 120, memory: '512MiB' as const };

function requireOwner(request: CallableRequest<unknown>): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  return request.auth.uid;
}

export const interpretQuery = onCall(callableOptions, async (request): Promise<InterpretQueryResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(interpretQuerySchema, request.data);
  await consumeQuota(db, ownerId, 'interpretQuery');
  try { return await resolveInterpretation(await parseIntent(input.query), locations); }
  catch (error) {
    logger.warn('interpretQuery unavailable', { kind: error instanceof SourceError ? error.provider : 'AI' });
    throw new HttpsError('unavailable', 'Interpretation is unavailable. Try again or configure the analysis manually.');
  }
});

export const createSession = onCall(callableOptions, async request => {
  const ownerId = requireOwner(request);
  await consumeQuota(db, ownerId, 'createSession');
  return sessions.create(ownerId);
});
export const listSessions = onCall(callableOptions, async (request): Promise<ListSessionsResponse> => ({ sessions: await sessions.list(requireOwner(request)) }));
export const getSession = onCall(callableOptions, async (request): Promise<GetSessionResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(sessionRequestSchema, request.data);
  return sessions.get(ownerId, input.sessionId);
});
export const renameSession = onCall(callableOptions, async request => {
  const ownerId = requireOwner(request);
  const input = parseInput(renameSessionSchema, request.data);
  return { session: await sessions.rename(ownerId, input.sessionId, input.title) };
});
export const deleteSession = onCall(callableOptions, async request => {
  const ownerId = requireOwner(request);
  const input = parseInput(sessionRequestSchema, request.data);
  await sessions.delete(ownerId, input.sessionId);
  return { deleted: true as const };
});
export const attachSessionAnalysis = onCall(callableOptions, async (request): Promise<AttachSessionAnalysisResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(attachSessionAnalysisSchema, request.data);
  const analysis = await repository.get(ownerId, input.analysisId);
  const message = await sessions.attachAnalysis(ownerId, input.sessionId, analysis);
  return { attached: true, message };
});

export const chatSession = onCall(callableOptions, async (request): Promise<ChatSessionResponse> => {
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

export const searchLocations = onCall(callableOptions, async (request): Promise<SearchLocationsResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(searchLocationsSchema, request.data);
  await consumeQuota(db, ownerId, 'searchLocations');
  try { return { locations: await locations.search(input.query, input.limit) }; }
  catch { throw new HttpsError('unavailable', 'Location search is unavailable. Please try again later.'); }
});

export const createAnalysis = onCall(callableOptions, async request => {
  const ownerId = requireOwner(request);
  const input = parseInput(createAnalysisSchema, request.data);
  return repository.create(ownerId, input.spec, input.requestId);
});

export const getAnalysis = onCall(callableOptions, async (request): Promise<GetAnalysisResponse> => {
  const ownerId = requireOwner(request);
  const input = parseInput(getAnalysisSchema, request.data);
  await consumeQuota(db, ownerId, 'getAnalysis');
  return { analysis: await repository.get(ownerId, input.analysisId) };
});

export const processAnalysis = onDocumentCreated({
  document: 'analysisJobs/{analysisId}', retry: true, timeoutSeconds: 540,
  memory: '1GiB', concurrency: 2, secrets: processingSecrets,
}, async event => {
  const analysisId = event.params.analysisId;
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
    throw new Error('Analysis processing failed; it will be retried if attempts remain.');
  }
});
