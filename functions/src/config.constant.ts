import type { FunctionsErrorCode } from './backend.types';

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(value);
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (value !== 'true' && value !== 'false') throw new Error(`${name} must be true or false`);
  return value === 'true';
}

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'earth-trend-detective';

/** Browsers may only call the server from the frontend. CORS is not access control: every endpoint also verifies the caller. */
function corsOrigins(): string[] {
  const configured = (process.env.CORS_ORIGINS ?? process.env.BALAM_CORS_ORIGINS ?? '').split(',').map(origin => origin.trim()).filter(Boolean);
  if (configured.length) return configured;
  const hosting = [`https://${PROJECT_ID}.web.app`, `https://${PROJECT_ID}.firebaseapp.com`];
  return process.env.NODE_ENV === 'production' ? hosting : [...hosting, 'http://localhost:5173', 'http://localhost:5000'];
}

export const CONFIG = {
  port: positiveInteger('PORT', 8787),
  corsOrigins: corsOrigins(),
  projectId: PROJECT_ID,
  vertexLocation: process.env.VERTEX_LOCATION || 'global',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  enforceAppCheck: booleanEnv('ENFORCE_APP_CHECK', false),
  globalDailyQuota: positiveInteger('QUOTA_GLOBAL_DAILY', 100),
  globalInterpretDailyQuota: positiveInteger('QUOTA_GLOBAL_INTERPRET_DAILY', 1000),
  globalSearchDailyQuota: positiveInteger('QUOTA_GLOBAL_SEARCH_DAILY', 2000),
  cacheTtlSeconds: positiveInteger('CACHE_TTL_SECONDS', 86400),
  currentWeather: booleanEnv('CURRENT_WEATHER_ENABLED', true),
  quota: {
    interpretQuery: positiveInteger('QUOTA_INTERPRET_QUERY', 100),
    meteomaticsSuggestions: positiveInteger('QUOTA_METEOMATICS_SUGGESTIONS', 10),
    searchLocations: positiveInteger('QUOTA_SEARCH_LOCATIONS', 100),
    createAnalysis: positiveInteger('QUOTA_CREATE_ANALYSIS', 10),
    getAnalysis: positiveInteger('QUOTA_GET_ANALYSIS', 1000),
    createSession: positiveInteger('QUOTA_CREATE_SESSION', 50),
    meteomaticsAvailability: positiveInteger('QUOTA_METEOMATICS_AVAILABILITY', 30),
    meteomaticsExecute: positiveInteger('QUOTA_METEOMATICS_EXECUTE', 20),
    giovanniExecute: positiveInteger('QUOTA_GIOVANNI_EXECUTE', 20),
    earthdataExecute: positiveInteger('QUOTA_EARTHDATA_EXECUTE', 60),
  },
} as const;

export const BASELINE = { startYear: 1991, endYear: 2020 } as const;
export const MIN_YEARS = 10;
export const MIN_COVERAGE = 0.8;
export const METHODOLOGY_VERSION = '1.0.0-nw-calendar-lags';
export const LEASE_MS = 600_000;
export const MAX_ATTEMPTS = 3;
/** Analyses processed at once by the in-process worker. The service runs as a single instance. */
export const WORKER_CONCURRENCY = 2;
/** How often the worker looks for queued analyses and expired leases, which is also the retry delay. */
export const JOB_SWEEP_MS = 30_000;
/** Largest request body. Saved chat sessions are the big ones; every other input is capped at 20 KB by `parseInput`. */
export const MAX_BODY_BYTES = 10_000_000;
export const HTTP_STATUS: Record<FunctionsErrorCode, number> = {
  'invalid-argument': 400, 'failed-precondition': 400, unauthenticated: 401, 'permission-denied': 403, 'not-found': 404,
  'already-exists': 409, 'resource-exhausted': 429, internal: 500, unavailable: 503,
};
