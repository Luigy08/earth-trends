import { useEffect, useRef, useState } from 'react';
import type { ConversationSession, QuerySessionWorkflow } from '../../shared/types';
import { getMeteomaticsSession, saveMeteomaticsSession } from '../services/firebase';

type StoredState = Parameters<typeof saveMeteomaticsSession>[1];

/**
 * Restores a query-chat session once, then saves `state` (debounced, serialized) whenever it changes.
 * `state` is null until there is something worth saving. Pending saves are flushed on unmount.
 */
export function useQuerySession<State extends StoredState>(sessionId: string, workflow: QuerySessionWorkflow, state: State | null,
  restore: (state: State) => void, onSessionUpdated: (session: ConversationSession) => void, onError: (message: string) => void) {
  const [loaded, setLoaded] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const pendingSave = useRef<(() => void) | null>(null);
  const callbacks = useRef({ restore, onSessionUpdated, onError });
  callbacks.current = { restore, onSessionUpdated, onError };

  useEffect(() => {
    let active = true;
    void getMeteomaticsSession(sessionId).then(({ state: stored }) => {
      if (!active) return;
      if (stored) callbacks.current.restore(stored as State);
      setLoaded(true);
    }).catch(cause => { if (active) callbacks.current.onError(`Could not restore this session: ${cause instanceof Error ? cause.message : 'unknown error'}`); });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!loaded || !state) return;
    const save = () => { pendingSave.current = null; saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      const { session } = await saveMeteomaticsSession(sessionId, state, workflow);
      callbacks.current.onSessionUpdated(session);
    }).catch(cause => { callbacks.current.onError(`Could not save this session: ${cause instanceof Error ? cause.message : 'unknown error'}`); }); };
    pendingSave.current = save;
    const timer = window.setTimeout(save, 750);
    return () => window.clearTimeout(timer);
  }, [loaded, sessionId, workflow, state]);

  useEffect(() => () => { pendingSave.current?.(); }, []);
  return loaded;
}
