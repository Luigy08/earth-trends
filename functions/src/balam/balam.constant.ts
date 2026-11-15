import { defineSecret } from 'firebase-functions/params';
import { CONFIG } from '../config.constant';
import { meteomaticsPassword, meteomaticsUsername, processingSecrets } from '../providers/meteomatics';

// Same pattern as the Meteomatics credentials: Secret Manager in production, ignored local env files in the emulator.
const databaseUrlSecret = CONFIG.useSecretManager ? defineSecret('DATABASE_URL') : undefined;
const earthdataUserSecret = CONFIG.useSecretManager ? defineSecret('EARTHDATA_USER') : undefined;
const earthdataPassSecret = CONFIG.useSecretManager ? defineSecret('EARTHDATA_PASS') : undefined;

export const balamSecrets = [
  ...(databaseUrlSecret && earthdataUserSecret && earthdataPassSecret ? [databaseUrlSecret, earthdataUserSecret, earthdataPassSecret] : []),
  ...processingSecrets,
];

/** Pooled connection string. Only call inside a function invocation: secrets are not readable at load time. */
export function databaseUrl(): string | undefined {
  return CONFIG.useSecretManager ? databaseUrlSecret?.value() : process.env.DATABASE_URL;
}

export function earthdataCredentials(): { username: string; password: string } {
  return {
    username: (CONFIG.useSecretManager ? earthdataUserSecret?.value() : process.env.EARTHDATA_USER) ?? '',
    password: (CONFIG.useSecretManager ? earthdataPassSecret?.value() : process.env.EARTHDATA_PASS) ?? '',
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
  /** 00:15 in Honduras: the trailing 24 h of hourly data then cover the previous local day. */
  schedule: process.env.BALAM_INGEST_SCHEDULE || '15 0 * * *',
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
