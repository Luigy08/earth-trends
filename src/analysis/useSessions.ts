import { useCallback, useEffect, useState } from 'react';
import type { Analysis, AnalysisSpec, ConversationMessage, ConversationSession } from '../../shared/types';
import { attachSessionAnalysis, chatSession, createSession, deleteSession, getAnalysis, getSession, listSessions, renameSession } from '../services/firebase';
import { errorMessage } from './resolver';

export function useSessions(onRestoreAnalysis: (analysis: Analysis | null) => void) {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [current, setCurrent] = useState<ConversationSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [proposal, setProposal] = useState<AnalysisSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const { sessions: items } = await listSessions();
    setSessions(items);
    return items;
  }, []);

  const open = useCallback(async (session: ConversationSession) => {
    setBusy(true); setError(''); onRestoreAnalysis(null);
    try {
      const result = await getSession({ sessionId: session.id });
      setCurrent(result.session); setMessages(result.messages);
      setProposal([...result.messages].reverse().find(message => message.role === 'assistant')?.spec ?? null);
      onRestoreAnalysis(result.session.analysisId ? (await getAnalysis({ analysisId: result.session.analysisId })).analysis : null);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }, [onRestoreAnalysis]);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const items = await refresh();
        if (!active) return;
        if (items.length) await open(items[0]!);
        else {
          const { session } = await createSession();
          if (!active) return;
          setSessions([session]); setCurrent(session); setMessages([]); setProposal(null); onRestoreAnalysis(null);
        }
      } catch (cause) {
        if (active) {
          const code = cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
          const message = cause instanceof Error ? cause.message : '';
          const failure = `${code} ${message}`;
          setError(/not-found|NOT_FOUND|internal|unavailable|network|fetch/i.test(failure)
            ? 'Could not initialize a saved session. The session Cloud Functions are missing or unavailable in this Firebase project/region. Deploy the current Functions code and reload.'
            : errorMessage(cause));
        }
      } finally { if (active) setBusy(false); }
    })();
    return () => { active = false; };
  }, [open, refresh, onRestoreAnalysis]);

  const create = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const { session } = await createSession();
      setSessions(items => [session, ...items]); setCurrent(session); setMessages([]); setProposal(null); onRestoreAnalysis(null);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }, [onRestoreAnalysis]);

  const send = useCallback(async (message: string) => {
    if (!current) {
      setError('A session is required to send a question. Check that the session Cloud Functions are deployed, then reload.');
      return;
    }
    setBusy(true); setError('');
    try {
      const result = await chatSession({ sessionId: current.id, message });
      setCurrent(result.session);
      setMessages(items => [...items, ...result.messages]);
      setProposal(result.spec ?? null);
      setSessions(items => [result.session, ...items.filter(item => item.id !== result.session.id)]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }, [current]);

  const submit = useCallback(async (analysisId: string) => {
    if (!current) return;
    try {
      const { message } = await attachSessionAnalysis({ sessionId: current.id, analysisId });
      const updated = { ...current, analysisId, updatedAt: new Date().toISOString() };
      setCurrent(updated); setSessions(items => [updated, ...items.filter(item => item.id !== updated.id)]);
      setMessages(items => [...items, message]);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [current]);

  const rename = useCallback(async (session: ConversationSession, title: string) => {
    try {
      const { session: updated } = await renameSession({ sessionId: session.id, title });
      setSessions(items => items.map(item => item.id === session.id ? updated : item));
      if (current?.id === session.id) setCurrent(updated);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [current]);

  const remove = useCallback(async (session: ConversationSession) => {
    try {
      await deleteSession({ sessionId: session.id });
      const remaining = sessions.filter(item => item.id !== session.id);
      setSessions(remaining);
      if (current?.id === session.id) {
        if (remaining.length) await open(remaining[0]!);
        else { setCurrent(null); setMessages([]); setProposal(null); onRestoreAnalysis(null); await create(); }
      }
    } catch (cause) { setError(errorMessage(cause)); }
  }, [sessions, current, open, onRestoreAnalysis, create]);

  const updateSession = useCallback((session: ConversationSession) => {
    setSessions(items => [session, ...items.filter(item => item?.id !== session.id)]);
    setCurrent(item => item?.id === session.id ? session : item);
  }, []);

  return { updateSession, sessions, current, messages, proposal, busy, error, create, open, send, submit, rename, remove };
}
