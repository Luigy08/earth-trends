import { useEffect, useRef, useState } from 'react';
import type { ConversationSession, QuerySessionWorkflow } from '../../shared/types';
import { getMeteomaticsSession, saveMeteomaticsSession } from '../services/firebase';

type StoredState = Parameters<typeof saveMeteomaticsSession>[1];

function persistentState<State extends StoredState>(state: State): State {
  return { ...state, results: (state.results ?? []).map(({ chartTrends: _chartTrends, ...result }) => result) } as State;
}

/**
 * Restores a query-chat session once, then saves `state` (debounced, serialized) whenever it changes.
 * `state` is null until there is something worth saving. Pending saves are flushed on unmount.
 */
export function useQuerySession<State extends StoredState>(sessionId: string, workflow: QuerySessionWorkflow, state: State | null,
  restore: (state: State) => void, onSessionUpdated: (session: ConversationSession) => void, onError: (message: string) => void) {
  const [loaded, setLoaded] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const pendingSave = useRef<(() => void) | null>(null);
  const savedSnapshot = useRef('');
  const queuedSaves = useRef(0);
  const callbacks = useRef({ restore, onSessionUpdated, onError });
  callbacks.current = { restore, onSessionUpdated, onError };

  useEffect(() => {
    let active = true;
    void getMeteomaticsSession(sessionId).then(({ state: stored }) => {
      if (!active) return;
      if (stored) {
        savedSnapshot.current = JSON.stringify(persistentState(stored as State));
        callbacks.current.restore(stored as State);
      }
      setLoaded(true);
    }).catch(cause => { if (active) { setRestoreFailed(true); callbacks.current.onError(`Could not restore this session: ${cause instanceof Error ? cause.message : 'unknown error'}`); } });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!loaded || !state) return;
    const cleanState = persistentState(state);
    const snapshot = JSON.stringify(cleanState);
    if (snapshot === savedSnapshot.current && queuedSaves.current === 0) { pendingSave.current = null; return; }
    const save = () => { pendingSave.current = null; queuedSaves.current++; saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (snapshot === savedSnapshot.current) return;
      const { session } = await saveMeteomaticsSession(sessionId, cleanState, workflow);
      savedSnapshot.current = snapshot;
      callbacks.current.onSessionUpdated(session);
    }).catch(cause => { callbacks.current.onError(`Could not save this session: ${cause instanceof Error ? cause.message : 'unknown error'}`); }).finally(() => { queuedSaves.current--; }); };
    pendingSave.current = save;
    const timer = window.setTimeout(save, 750);
    return () => window.clearTimeout(timer);
  }, [loaded, sessionId, workflow, state]);

  useEffect(() => () => { pendingSave.current?.(); }, []);
  return loaded || restoreFailed;
}
