import { FirebaseError } from 'firebase/app';
import { AUTH_ERROR_MESSAGES, AUTH_FALLBACK_ERROR } from '../app.constant';

export function resolveAuthError(error: unknown): string {
  if (error instanceof FirebaseError && error.code in AUTH_ERROR_MESSAGES) return AUTH_ERROR_MESSAGES[error.code] ?? AUTH_FALLBACK_ERROR;
  return AUTH_FALLBACK_ERROR;
}
