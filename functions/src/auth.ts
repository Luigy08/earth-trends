import { getAppCheck } from 'firebase-admin/app-check';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import type { CallableHandler, CallableRequest } from './backend.types';
import { CONFIG } from './config.constant';
import { HttpsError } from './http';

/** Rejects the request unless it carries a valid App Check token. A no-op while enforcement is off. */
export async function verifyAppCheck(appCheckToken: string | undefined): Promise<void> {
  if (!CONFIG.enforceAppCheck) return;
  if (!appCheckToken) throw new HttpsError('unauthenticated', 'App Check verification is required.');
  await getAppCheck().verifyToken(appCheckToken).catch(() => { throw new HttpsError('unauthenticated', 'App Check verification failed.'); });
}

/** The verified Firebase ID token of an `Authorization: Bearer` header, or undefined when none was sent. */
export async function verifyIdToken(authorization: string | undefined): Promise<DecodedIdToken | undefined> {
  const token = /^Bearer (.+)$/i.exec(authorization ?? '')?.[1];
  if (!token) return undefined;
  return getAuth().verifyIdToken(token).catch(() => { throw new HttpsError('unauthenticated', 'Sign in to continue.'); });
}

/** Marks a handler as a public endpoint; the server exposes it as `POST /api/<export name>`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function onCall<Result>(run: (request: CallableRequest<any>) => Promise<Result>): CallableHandler<Result> {
  return { callable: true, run };
}
