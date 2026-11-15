import { useCallback, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import type { AuthStatus } from '../app.types';
import { isConfigured, signInWithGoogle, signOutUser, watchAuthUser } from '../services/firebase';
import { resolveAuthError } from './auth.resolver';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>(isConfigured ? 'loading' : 'unconfigured');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isConfigured) return;
    try {
      return watchAuthUser(next => { setUser(next); setStatus(next ? 'signed_in' : 'signed_out'); });
    } catch (caught) {
      setStatus('signed_out');
      setError(resolveAuthError(caught));
    }
  }, []);

  const signIn = useCallback(async () => {
    setBusy(true);
    setError('');
    try { await signInWithGoogle(); }
    catch (caught) { setError(resolveAuthError(caught)); }
    finally { setBusy(false); }
  }, []);

  const signOut = useCallback(async () => {
    try { await signOutUser(); }
    catch (caught) { setError(resolveAuthError(caught)); }
  }, []);

  return { user, status, busy, error, signIn, signOut };
}
