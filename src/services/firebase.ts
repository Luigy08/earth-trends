import { FirebaseError, initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import type { AttachSessionAnalysisRequest, AttachSessionAnalysisResponse, ChatSessionRequest, ChatSessionResponse, ConversationSession, CreateAnalysisRequest, CreateAnalysisResponse, CreateSessionResponse, DeleteSessionResponse, GetAnalysisRequest, GetAnalysisResponse, GetSessionResponse, InterpretMeteomaticsRequest, InterpretMeteomaticsResponse, InterpretQueryRequest, InterpretQueryResponse, ListSessionsResponse, MeteomaticsAvailabilityRequest, MeteomaticsAvailabilityResponse, MeteomaticsCatalogResponse, MeteomaticsExecuteRequest, MeteomaticsExecuteResponse, RenameSessionRequest, SearchLocationsRequest, SearchLocationsResponse, SessionRequest } from '../../shared/types';
import { ENV_KEYS } from '../app.constant';

const env = import.meta.env;
export const missingConfig = ENV_KEYS.filter(key => !env[key]);
export const isConfigured = missingConfig.length === 0;
let firebaseApp: FirebaseApp | undefined;
let functions: ReturnType<typeof getFunctions> | undefined;

function initialize() {
  if (!isConfigured) throw new Error('Configure Firebase to query live data.');
  if (!firebaseApp || !functions) {
    firebaseApp = getApps()[0] ?? initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
    const auth = getAuth(firebaseApp);
    functions = getFunctions(firebaseApp, env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1');
    if (env.VITE_USE_FIREBASE_EMULATORS === 'true') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
  }
  return { auth: getAuth(firebaseApp), functions };
}

async function connect() {
  const { auth, functions: client } = initialize();
  await auth.authStateReady();
  if (!auth.currentUser || auth.currentUser.isAnonymous) throw new Error('Sign in with Google to continue.');
  return client;
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

async function call<Request, Response>(name: string, data: Request): Promise<Response> {
  const client = await connect();
  return (await httpsCallable<Request, Response>(client, name, { timeout: 120000 })(data)).data;
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

export const getMeteomaticsSession = (sessionId: string) => call<{ sessionId: string }, { state: import('../../shared/types').MeteomaticsSessionState | null }>('getMeteomaticsSession', { sessionId });
export const saveMeteomaticsSession = (sessionId: string, state: import('../../shared/types').MeteomaticsSessionState) => call<{ sessionId: string; state: import('../../shared/types').MeteomaticsSessionState }, { session: ConversationSession }>('saveMeteomaticsSession', { sessionId, state });

export const getMeteomaticsSuggestions = (refresh = false) => {
  if (refresh) suggestionsCache = undefined;
  return suggestionsCache ??= call<Record<string, never>, import('../../shared/types').MeteomaticsSuggestionsResponse>('getMeteomaticsSuggestions', {}).catch(error => { suggestionsCache = undefined; throw error; });
};
