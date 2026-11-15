import { useMemo, useState } from 'react';
import { Button } from '@mui/material';
import type { QueryExecuteResponse } from '../../shared/types';
import { MeteomaticsChart } from './MeteomaticsChart';
import { VirtualizedResultsTable } from './VirtualizedResultsTable';
import { downloadMeteomaticsJson, resolveMeteomaticsResult } from '../meteomatics-query.resolver';

function displayValue(value: number | string | null): string {
  if (value === null) return 'No value';
  if (typeof value === 'number' && [-999, -888, -777, -666].includes(value)) return `Missing (${value})`;
  return typeof value === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value) : value;
}

/** Renders Meteomatics results, and Giovanni and Earthdata results (which use the same JSON envelope). */
export function MeteomaticsResponse({ result }: { result: QueryExecuteResponse }) {
  const [showRaw, setShowRaw] = useState(false);
  const normalized = useMemo(() => result.responseFormat === 'json' ? resolveMeteomaticsResult(result.result, Infinity) : null, [result]);
  const canDownloadJson = result.responseFormat === 'json' && typeof result.result !== 'string';
  const raw = showRaw ? typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2) : '';

  return <section className="meteo-result" aria-label={`${result.provider} response`}>
    <div className="conversation-heading"><div><span className="eyebrow">QUERY RESULT</span><h3>Returned by {result.provider}</h3></div><span className="meteo-response-meta">{result.source} · {result.responseFormat.toUpperCase()}</span></div>
    <p>Retrieved {new Date(result.requestedAt).toLocaleString('en-US')} · {result.provenance.parameters.join(', ')}</p>
    {normalized ? <>
      <p className="meteo-response-summary">{normalized.totalRows.toLocaleString('en-US')} values{normalized.status ? ` · API status: ${normalized.status}` : ''}{normalized.version ? ` · response v${normalized.version}` : ''}</p>
      <MeteomaticsChart result={result} />
      <VirtualizedResultsTable rows={normalized.rows} />
    </> : <p>This format is shown as returned by the API. The payload has not been converted into trend statistics.</p>}
    {canDownloadJson && <Button size="small" onClick={() => downloadMeteomaticsJson(result.result, result.requestedAt)}>Download original JSON</Button>}
    <Button size="small" onClick={() => setShowRaw(value => !value)}>{showRaw ? 'Hide original response' : 'Show original response'}</Button>
    {showRaw && <pre>{raw}</pre>}
    <details><summary>Provenance</summary><pre>{JSON.stringify(result.provenance, null, 2)}</pre></details>
  </section>;
}
