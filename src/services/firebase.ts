import { FirebaseError, initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import type { AttachSessionAnalysisRequest, AttachSessionAnalysisResponse, ChatSessionRequest, ChatSessionResponse, ConversationSession, CreateAnalysisRequest, CreateAnalysisResponse, CreateSessionResponse, DeleteSessionResponse, GetAnalysisRequest, GetAnalysisResponse, GetSessionResponse, GiovanniCatalogResponse, GiovanniExecuteRequest, GiovanniExecuteResponse, GiovanniSessionState, InterpretGiovanniRequest, InterpretGiovanniResponse, QuerySessionWorkflow, InterpretMeteomaticsRequest, InterpretMeteomaticsResponse, InterpretQueryRequest, InterpretQueryResponse, ListSessionsResponse, MeteomaticsAvailabilityRequest, MeteomaticsAvailabilityResponse, MeteomaticsCatalogResponse, MeteomaticsExecuteRequest, MeteomaticsExecuteResponse, RenameSessionRequest, SearchLocationsRequest, SearchLocationsResponse, SessionRequest } from '../../shared/types';
import type { EarthdataCatalogResponse, EarthdataExecuteRequest, EarthdataExecuteResponse, EarthdataSessionState, InterpretEarthdataRequest, InterpretEarthdataResponse } from '../../shared/types';
import { API_TIMEOUT_MS, ENV_KEYS } from '../app.constant';

const env = import.meta.env;
export const missingConfig = ENV_KEYS.filter(key => !env[key]);
export const isConfigured = missingConfig.length === 0;
let firebaseApp: FirebaseApp | undefined;

function initialize() {
  if (!isConfigured) throw new Error('Configure Firebase to query live data.');
  if (!firebaseApp) {
    firebaseApp = getApps()[0] ?? initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
    if (env.VITE_USE_FIREBASE_EMULATORS === 'true') connectAuthEmulator(getAuth(firebaseApp), 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  return { auth: getAuth(firebaseApp) };
}

async function connect(): Promise<User> {
  const { auth } = initialize();
  await auth.authStateReady();
  if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Sign in with Google to continue.');
  return auth.currentUser;
}

export const watchAuthUser = (onChange: (user: User | null) => void) => onAuthStateChanged(initialize().auth, user => onChange(user && !user.isAnonymous ? user : null));

export async function signInWithGoogle() {
  const { auth } = initialize();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try { await signInWithPopup(auth, provider); }
  catch (error) {
    if (error instanceof FirebaseError && error.code === 'auth/popup-blocked') await signInWithRedirect(auth, provider);
    else throw error;
  }
}

export const signOutUser = () => signOut(initialize().auth);

/** Calls `POST /api/<name>` on the backend. Failures keep the `functions/<code>` codes the views already read. */
async function call<Request, Response>(name: string, data: Request): Promise<Response> {
  const user = await connect();
  let response: globalThis.Response;
  try {
    response = await fetch(`${String(env.VITE_API_BASE_URL).replace(/\/+$/, '')}/api/${name}`, {
      method: 'POST', signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ data }),
    });
  } catch {
    throw new FirebaseError('functions/unavailable', 'The service is unavailable. Please try again.');
  }
  const body = await response.json().catch(() => null) as { result?: Response; error?: { code?: string; message?: string } } | null;
  if (!response.ok || !body || body.error) {
    throw new FirebaseError(`functions/${body?.error?.code ?? 'internal'}`, body?.error?.message ?? 'The request could not be completed.');
  }
  return body.result as Response;
}

export const interpretQuery = (data: InterpretQueryRequest) => call<InterpretQueryRequest, InterpretQueryResponse>('interpretQuery', data);
export const searchLocations = (data: SearchLocationsRequest) => call<SearchLocationsRequest, SearchLocationsResponse>('searchLocations', data);
export const createAnalysis = (data: CreateAnalysisRequest) => call<CreateAnalysisRequest, CreateAnalysisResponse>('createAnalysis', data);
export const getAnalysis = (data: GetAnalysisRequest) => call<GetAnalysisRequest, GetAnalysisResponse>('getAnalysis', data);
export const createSession = () => call<Record<string, never>, CreateSessionResponse>('createSession', {});
export const listSessions = () => call<Record<string, never>, ListSessionsResponse>('listSessions', {});
export const getSession = (data: SessionRequest) => call<SessionRequest, GetSessionResponse>('getSession', data);
export const renameSession = (data: RenameSessionRequest) => call<RenameSessionRequest, { session: ConversationSession }>('renameSession', data);
export const deleteSession = (data: SessionRequest) => call<SessionRequest, DeleteSessionResponse>('deleteSession', data);
export const chatSession = (data: ChatSessionRequest) => call<ChatSessionRequest, ChatSessionResponse>('chatSession', data);
export const attachSessionAnalysis = (data: AttachSessionAnalysisRequest) => call<AttachSessionAnalysisRequest, AttachSessionAnalysisResponse>('attachSessionAnalysis', data);
let catalogCache: Promise<MeteomaticsCatalogResponse> | undefined;
let suggestionsCache: Promise<import('../../shared/types').MeteomaticsSuggestionsResponse> | undefined;
export const getMeteomaticsCatalog = () => catalogCache ??= call<Record<string, never>, MeteomaticsCatalogResponse>('getMeteomaticsCatalog', {}).catch(error => { catalogCache = undefined; throw error; });
export const interpretMeteomatics = (data: InterpretMeteomaticsRequest) => call<InterpretMeteomaticsRequest, InterpretMeteomaticsResponse>('interpretMeteomatics', data);
export const checkMeteomaticsAvailability = (data: MeteomaticsAvailabilityRequest) => call<MeteomaticsAvailabilityRequest, MeteomaticsAvailabilityResponse>('checkMeteomaticsAvailability', data);
export const executeMeteomaticsQuery = (data: MeteomaticsExecuteRequest) => call<MeteomaticsExecuteRequest, MeteomaticsExecuteResponse>('executeMeteomaticsQuery', data);

type QuerySessionState = import('../../shared/types').MeteomaticsSessionState | GiovanniSessionState | EarthdataSessionState;
/** Query-chat session state (Meteomatics, Giovanni or Earthdata) shares one storage; `workflow` tags the session. */
export const getMeteomaticsSession = (sessionId: string) => call<{ sessionId: string }, { state: QuerySessionState | null }>('getMeteomaticsSession', { sessionId });
export const saveMeteomaticsSession = (sessionId: string, state: QuerySessionState, workflow: QuerySessionWorkflow = 'meteomatics') => call<{ sessionId: string; state: QuerySessionState; workflow: QuerySessionWorkflow }, { session: ConversationSession }>('saveMeteomaticsSession', { sessionId, state, workflow });

let giovanniCatalogCache: Promise<GiovanniCatalogResponse> | undefined;
export const getGiovanniCatalog = () => giovanniCatalogCache ??= call<Record<string, never>, GiovanniCatalogResponse>('getGiovanniCatalog', {}).catch(error => { giovanniCatalogCache = undefined; throw error; });
export const interpretGiovanni = (data: InterpretGiovanniRequest) => call<InterpretGiovanniRequest, InterpretGiovanniResponse>('interpretGiovanni', data);
export const executeGiovanniQuery = (data: GiovanniExecuteRequest) => call<GiovanniExecuteRequest, GiovanniExecuteResponse>('executeGiovanniQuery', data);

// The catalog carries the stored coverage, which changes with every ingestion, so it is fetched per workspace rather than cached.
export const getEarthdataCatalog = () => call<Record<string, never>, EarthdataCatalogResponse>('getEarthdataCatalog', {});
export const interpretEarthdata = (data: InterpretEarthdataRequest) => call<InterpretEarthdataRequest, InterpretEarthdataResponse>('interpretEarthdata', data);
export const executeEarthdataQuery = (data: EarthdataExecuteRequest) => call<EarthdataExecuteRequest, EarthdataExecuteResponse>('executeEarthdataQuery', data);

export const getMeteomaticsSuggestions = (refresh = false) => {
  if (refresh) suggestionsCache = undefined;
  return suggestionsCache ??= call<Record<string, never>, import('../../shared/types').MeteomaticsSuggestionsResponse>('getMeteomaticsSuggestions', {}).catch(error => { suggestionsCache = undefined; throw error; });
};
