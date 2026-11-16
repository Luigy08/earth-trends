import { CircularProgress } from '@mui/material';

export function SessionLoading() {
  return <section className="session-loading" role="status" aria-live="polite">
    <div className="session-loading-indicator"><CircularProgress size={32} thickness={3} /></div>
    <span className="session-loading-label">YOUR FIELD NOTES</span>
    <h1>Opening your session</h1>
    <p>Restoring your conversation and preparing your data. Larger sessions may take a little longer.</p>
  </section>;
}
