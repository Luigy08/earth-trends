import { initializeApp, getApps } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import type { AttachSessionAnalysisRequest, AttachSessionAnalysisResponse, ChatSessionRequest, ChatSessionResponse, ConversationSession, CreateAnalysisRequest, CreateAnalysisResponse, CreateSessionResponse, DeleteSessionResponse, GetAnalysisRequest, GetAnalysisResponse, GetSessionResponse, InterpretMeteomaticsRequest, InterpretMeteomaticsResponse, InterpretQueryRequest, InterpretQueryResponse, ListSessionsResponse, MeteomaticsAvailabilityRequest, MeteomaticsAvailabilityResponse, MeteomaticsCatalogResponse, MeteomaticsExecuteRequest, MeteomaticsExecuteResponse, RenameSessionRequest, SearchLocationsRequest, SearchLocationsResponse, SessionRequest } from '../../shared/types';
import { ENV_KEYS } from '../app.constant';

const env = import.meta.env;
export const missingConfig = ENV_KEYS.filter(key => !env[key] && !(key === 'VITE_FIREBASE_APPCHECK_SITE_KEY' && env.VITE_USE_FIREBASE_EMULATORS === 'true'));
export const isConfigured = missingConfig.length === 0;
let authentication: Promise<unknown> | undefined;
let functions: ReturnType<typeof getFunctions> | undefined;

async function connect() {
  if (!isConfigured) throw new Error('Configure Firebase to query live data.');
  if (!functions) {
    const app = getApps()[0] ?? initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
    if (env.VITE_USE_FIREBASE_EMULATORS !== 'true') {
      if (import.meta.env.DEV && window.location.hostname === 'localhost') {
        (self as typeof self & { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
      }
      initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_FIREBASE_APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
    }
    const auth = getAuth(app);
    functions = getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1');
    if (env.VITE_USE_FIREBASE_EMULATORS === 'true') {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    }
    authentication = auth.authStateReady().then(async () => { if (!auth.currentUser) await signInAnonymously(auth); }).catch(error => { authentication = undefined; throw error; });
  }
  if (!authentication) {
    const auth = getAuth();
    authentication = signInAnonymously(auth).catch(error => { authentication = undefined; throw error; });
  }
  await authentication;
  return functions;
}

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
export const getMeteomaticsCatalog = () => call<Record<string, never>, MeteomaticsCatalogResponse>('getMeteomaticsCatalog', {});
export const interpretMeteomatics = (data: InterpretMeteomaticsRequest) => call<InterpretMeteomaticsRequest, InterpretMeteomaticsResponse>('interpretMeteomatics', data);
export const checkMeteomaticsAvailability = (data: MeteomaticsAvailabilityRequest) => call<MeteomaticsAvailabilityRequest, MeteomaticsAvailabilityResponse>('checkMeteomaticsAvailability', data);
export const executeMeteomaticsQuery = (data: MeteomaticsExecuteRequest) => call<MeteomaticsExecuteRequest, MeteomaticsExecuteResponse>('executeMeteomaticsQuery', data);
