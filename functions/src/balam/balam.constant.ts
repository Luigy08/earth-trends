import { defineSecret } from 'firebase-functions/params';
import { CONFIG } from '../config.constant';
import { earthdataPassword, earthdataUsername, giovanniSecrets } from '../providers/giovanni';
import { meteomaticsPassword, meteomaticsUsername, processingSecrets } from '../providers/meteomatics';

// Same pattern as the Meteomatics credentials: Secret Manager in production, ignored local env files in the emulator.
const databaseUrlSecret = CONFIG.useSecretManager ? defineSecret('DATABASE_URL') : undefined;

/** For functions that only read the Balam store. */
export const balamDatabaseSecrets = databaseUrlSecret ? [databaseUrlSecret] : [];

// AppEEARS signs in with the same NASA Earthdata Login account as Giovanni, so both share its secrets.
export const balamSecrets = [...(databaseUrlSecret ? [databaseUrlSecret] : []), ...giovanniSecrets, ...processingSecrets];

/** Pooled connection string. Only call inside a function invocation: secrets are not readable at load time. */
export function databaseUrl(): string | undefined {
  return CONFIG.useSecretManager ? databaseUrlSecret?.value() : process.env.DATABASE_URL;
}

export function earthdataCredentials(): { username: string; password: string } {
  return {
    username: (CONFIG.useSecretManager ? earthdataUsername?.value() : process.env.EARTHDATA_USERNAME) ?? '',
    password: (CONFIG.useSecretManager ? earthdataPassword?.value() : process.env.EARTHDATA_PASSWORD) ?? '',
  };
}

export function meteomaticsCredentials(): { username: string; password: string } {
  return {
    username: (CONFIG.useSecretManager ? meteomaticsUsername?.value() : process.env.METEOMATICS_USERNAME) ?? '',
    password: (CONFIG.useSecretManager ? meteomaticsPassword?.value() : process.env.METEOMATICS_PASSWORD) ?? '',
  };
}

function corsOrigins(): string[] {
  const configured = (process.env.BALAM_CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (configured.length) return configured;
  const hosting = [`https://${CONFIG.projectId}.web.app`, `https://${CONFIG.projectId}.firebaseapp.com`];
  return process.env.FUNCTIONS_EMULATOR === 'true' ? [...hosting, 'http://localhost:5173', 'http://localhost:5000'] : hosting;
}

export const BALAM = {
  /** Browsers may only call the API from the frontend. CORS is not access control: /query also requires sign-in. */
  corsOrigins: corsOrigins(),
  /**
   * Hourly, so a request NASA has finished is stored within the hour and the next block goes out right away.
   * Planning stays idempotent: nothing is requested twice. The 23:15 run in Honduras stores the Meteomatics
   * daily mean for the whole local day (00:00–23:00).
   */
  schedule: process.env.BALAM_INGEST_SCHEDULE || '15 * * * *',
  timeZone: 'America/Tegucigalpa',
  /** Connections per function instance. */
  poolMax: 2,
  /** `process()` stops picking up finished jobs after this long, leaving time for `plan()`. */
  processBudgetMs: 360_000,
  apiVersion: 'balam-1.0',
  /** Limits for on-demand /query requests. */
  query: { maxParameters: 5, maxPoints: 10, maxYears: 30, maxBboxSquareDegrees: 25 },
  maxZonesPerRequest: 20,
} as const;
