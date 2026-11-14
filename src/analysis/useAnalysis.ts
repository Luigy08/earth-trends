import { useCallback, useEffect, useRef, useState } from 'react';
import type { Analysis, AnalysisSpec } from '../../shared/types';
import { createAnalysis, getAnalysis } from '../services/firebase';
import { errorMessage } from './resolver';

export function useAnalysis() {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, setHistory] = useState<Analysis[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingId = useRef<string | null>(null);
  useEffect(() => () => { generation.current++; clearTimeout(timer.current); }, []);

  const poll = useCallback(async (id: string, current: number, startedAt: number) => {
    try {
      const { analysis: next } = await getAnalysis({ analysisId: id });
      if (current !== generation.current) return;
      setAnalysis(next);
      if (next.status === 'queued' || next.status === 'processing') {
        if (Date.now() - startedAt > 300000) throw new Error('Processing is taking longer than expected. Resume the analysis to check its status.');
        timer.current = setTimeout(() => { void poll(id, current, startedAt); }, 2000);
      } else {
        setBusy(false);
        setHistory(items => [next, ...items.filter(item => item.id !== id)]);
        if (next.status === 'failed') setError(next.error?.message || 'The analysis could not be completed.');
      }
    } catch (cause) {
      if (current === generation.current) { setBusy(false); setError(errorMessage(cause)); }
    }
  }, []);

  const submit = useCallback(async (spec: AnalysisSpec) => {
    const current = ++generation.current;
    clearTimeout(timer.current);
    setBusy(true); setError(''); setAnalysis(null); pendingId.current = null;
    try {
      const created = await createAnalysis({ spec, requestId: crypto.randomUUID() });
      if (current !== generation.current) return null;
      pendingId.current = created.analysisId;
      void poll(created.analysisId, current, Date.now());
      return created.analysisId;
    } catch (cause) { if (current === generation.current) { setBusy(false); setError(errorMessage(cause)); } return null; }
  }, [poll]);

  const retry = useCallback(() => {
    if (!pendingId.current) return;
    setBusy(true); setError('');
    void poll(pendingId.current, ++generation.current, Date.now());
  }, [poll]);

  const select = useCallback((item: Analysis) => {
    const current = ++generation.current;
    clearTimeout(timer.current); setError(''); setAnalysis(item); pendingId.current = item.id;
    const active = item.status === 'queued' || item.status === 'processing';
    setBusy(active);
    if (active) void poll(item.id, current, Date.now());
  }, [poll]);
  const clear = useCallback(() => { generation.current++; clearTimeout(timer.current); setBusy(false); setError(''); setAnalysis(null); pendingId.current = null; }, []);
  return { analysis, history, busy, error, submit, retry, select, clear, canRetry: Boolean(pendingId.current) };
}
