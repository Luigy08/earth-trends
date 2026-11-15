import { CircularProgress } from '@mui/material';
import { App } from '../App';
import { useAuth } from '../auth/useAuth';
import { SignInPage } from './SignInPage';

export function AuthGate() {
  const { user, status, busy, error, signIn, signOut } = useAuth();
  if (status === 'unconfigured') return <App />;
  if (status === 'loading') return <div className="auth-loading" role="status" aria-label="Checking your session"><CircularProgress size={28} /></div>;
  if (!user) return <SignInPage busy={busy} error={error} onSignIn={() => { void signIn(); }} />;
  return <App key={user.uid} user={user} onSignOut={() => { void signOut(); }} />;
}
