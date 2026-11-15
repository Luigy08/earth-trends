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

export const CONFIG = {
  region: process.env.FUNCTIONS_REGION || 'us-central1',
  projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'earth-trend-detective',
  vertexLocation: process.env.VERTEX_LOCATION || 'global',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  // Production defaults to enforcement; only the local emulator defaults off.
  enforceAppCheck: booleanEnv('ENFORCE_APP_CHECK', false),
  maxInstances: positiveInteger('MAX_INSTANCES', 1),
  globalDailyQuota: positiveInteger('QUOTA_GLOBAL_DAILY', 100),
  globalInterpretDailyQuota: positiveInteger('QUOTA_GLOBAL_INTERPRET_DAILY', 1000),
  globalSearchDailyQuota: positiveInteger('QUOTA_GLOBAL_SEARCH_DAILY', 2000),
  cacheTtlSeconds: positiveInteger('CACHE_TTL_SECONDS', 86400),
  currentWeather: booleanEnv('CURRENT_WEATHER_ENABLED', true),
  useSecretManager: booleanEnv('METEOMATICS_USE_SECRET_MANAGER', process.env.FUNCTIONS_EMULATOR !== 'true'),
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
