/** Pooled connection string, from the server environment. */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL;
}

export function earthdataCredentials(): { username: string; password: string } {
  return {
    username: process.env.EARTHDATA_USERNAME ?? '',
    password: process.env.EARTHDATA_PASSWORD ?? '',
  };
}

export function meteomaticsCredentials(): { username: string; password: string } {
  return {
    username: process.env.METEOMATICS_USERNAME ?? '',
    password: process.env.METEOMATICS_PASSWORD ?? '',
  };
}

export const BALAM = {
  /** Connections per process. */
  poolMax: 2,
  /** `process()` stops picking up finished jobs after this long, leaving time for `plan()`. */
  processBudgetMs: 360_000,
  apiVersion: 'balam-1.0',
  /** Limits for on-demand /query requests. */
  query: { maxParameters: 5, maxPoints: 10, maxYears: 30, maxBboxSquareDegrees: 25 },
  maxZonesPerRequest: 20,
} as const;
