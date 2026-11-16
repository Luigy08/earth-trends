import { useCallback, useEffect, useState } from 'react';
import type { CompareSessionsRequest, SessionComparison } from '../../shared/types';
import { compareSessions, getSessionComparison } from '../services/firebase';
import { errorMessage } from './resolver';

/** The session's stored comparison (at most one) and the action that creates it. */
export function useSessionComparison(sessionId: string) {
  const [comparison, setComparison] = useState<SessionComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true); setComparison(null); setError('');
    void getSessionComparison({ sessionId })
      .then(response => { if (active) setComparison(response.comparison); })
      .catch(cause => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [sessionId]);

  const compare = useCallback(async (request: Omit<CompareSessionsRequest, 'sessionId'>) => {
    setComparing(true); setError('');
    try { setComparison((await compareSessions({ sessionId, ...request })).comparison); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setComparing(false); }
  }, [sessionId]);

  return { comparison, loading, comparing, error, compare };
}
