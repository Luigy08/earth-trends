import { useState } from 'react';
import { Button, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import type { QueryExecuteResponse } from '../../shared/types';
import { MeteomaticsChart } from './MeteomaticsChart';
import { downloadMeteomaticsJson, resolveMeteomaticsResult } from '../meteomatics-query.resolver';

function displayValue(value: number | string | null): string {
  if (value === null) return 'No value';
  if (typeof value === 'number' && [-999, -888, -777, -666].includes(value)) return `Missing (${value})`;
  return typeof value === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value) : value;
}

/** Renders Meteomatics results, and Giovanni and Earthdata results (which use the same JSON envelope). */
export function MeteomaticsResponse({ result }: { result: QueryExecuteResponse }) {
  const [showRaw, setShowRaw] = useState(false);
  const normalized = result.responseFormat === 'json' ? resolveMeteomaticsResult(result.result) : null;
  const canDownloadJson = result.responseFormat === 'json' && typeof result.result !== 'string';
  const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);

  return <section className="meteo-result" aria-label={`${result.provider} response`}>
    <div className="conversation-heading"><div><span className="eyebrow">QUERY RESULT</span><h3>Returned by {result.provider}</h3></div><span className="meteo-response-meta">{result.source} · {result.responseFormat.toUpperCase()}</span></div>
    <p>Retrieved {new Date(result.requestedAt).toLocaleString('en-US')} · {result.provenance.parameters.join(', ')}</p>
    {normalized ? <>
      <p className="meteo-response-summary">{normalized.totalRows.toLocaleString('en-US')} values{normalized.status ? ` · API status: ${normalized.status}` : ''}{normalized.version ? ` · response v${normalized.version}` : ''}</p>
      <MeteomaticsChart result={result} />
      <div className="meteo-response-table-wrap"><Table size="small" aria-label={`Normalized ${result.provider} values`}>
        <TableHead><TableRow><TableCell>Date (UTC)</TableCell><TableCell>Parameter</TableCell><TableCell>Latitude</TableCell><TableCell>Longitude</TableCell><TableCell align="right">Value</TableCell></TableRow></TableHead>
        <TableBody>{normalized.rows.map((row, index) => <TableRow key={`${row.date}-${row.parameter}-${index}`}>
          <TableCell>{row.date}</TableCell><TableCell>{row.parameter}</TableCell>
          <TableCell>{row.latitude ?? '—'}</TableCell><TableCell>{row.longitude ?? '—'}</TableCell><TableCell align="right">{displayValue(row.value)}</TableCell>
        </TableRow>)}</TableBody>
      </Table></div>
      {normalized.truncated && <p>Showing the first {normalized.rows.length.toLocaleString('en-US')} values. Download or inspect the raw payload for the full response.</p>}
    </> : <p>This format is shown as returned by the API. The payload has not been converted into trend statistics.</p>}
    {canDownloadJson && <Button size="small" onClick={() => downloadMeteomaticsJson(result.result, result.requestedAt)}>Download original JSON</Button>}
    <Button size="small" onClick={() => setShowRaw(value => !value)}>{showRaw ? 'Hide original response' : 'Show original response'}</Button>
    {showRaw && <pre>{raw}</pre>}
    <details><summary>Provenance</summary><pre>{JSON.stringify(result.provenance, null, 2)}</pre></details>
  </section>;
}
