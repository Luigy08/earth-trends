import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Button, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { PrintOutlined } from '@mui/icons-material';
import type { QueryExecuteResponse } from '../../shared/types';
import { MeteomaticsChart } from './MeteomaticsChart';
import { VirtualizedResultsTable } from './VirtualizedResultsTable';
import { downloadMeteomaticsJson, resolveMeteomaticsResult } from '../meteomatics-query.resolver';
import { PRINT_ROW_LIMIT } from '../meteomatics-query.constant';
import { printElement } from '../print.resolver';

function displayValue(value: number | string | null): string {
  if (value === null) return 'No value';
  if (typeof value === 'number' && [-999, -888, -777, -666].includes(value)) return `Missing (${value})`;
  return typeof value === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value) : value;
}

/** Renders Meteomatics results, and Giovanni and Earthdata results (which use the same JSON envelope). */
export function MeteomaticsResponse({ result }: { result: QueryExecuteResponse }) {
  const section = useRef<HTMLElement>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [printing, setPrinting] = useState(false);
  const normalized = useMemo(() => result.responseFormat === 'json' ? resolveMeteomaticsResult(result.result, Infinity) : null, [result]);
  const canDownloadJson = result.responseFormat === 'json' && typeof result.result !== 'string';
  const raw = showRaw ? typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2) : '';
  const exportPdf = () => {
    if (!section.current) return;
    // The virtualized table only mounts visible rows, so a static table is rendered for the report first.
    flushSync(() => setPrinting(true));
    const source = result.source === 'giovanni' || result.source === 'earthdata' ? result.source : 'meteomatics';
    printElement(section.current, `earth-trend-${source}-${result.requestedAt.replace(/[^0-9TZ-]/g, '-')}`, () => setPrinting(false));
  };

  return <section ref={section} className="meteo-result" aria-label={`${result.provider} response`}>
    <div className="conversation-heading"><div><span className="eyebrow">QUERY RESULT</span><h3>Returned by {result.provider}</h3></div><span className="meteo-response-meta">{result.source} · {result.responseFormat.toUpperCase()}</span></div>
    <p>Retrieved {new Date(result.requestedAt).toLocaleString('en-US')} · {result.provenance.parameters.join(', ')}</p>
    {normalized ? <>
      <p className="meteo-response-summary">{normalized.totalRows.toLocaleString('en-US')} values{normalized.status ? ` · API status: ${normalized.status}` : ''}{normalized.version ? ` · response v${normalized.version}` : ''}</p>
      <MeteomaticsChart result={result} />
      <div className="screen-only"><VirtualizedResultsTable rows={normalized.rows} /></div>
      {printing && <div className="meteo-response-table-wrap print-only">
        <Table size="small" aria-label="Normalized observation values">
          <TableHead><TableRow><TableCell>Date (UTC)</TableCell><TableCell>Parameter</TableCell><TableCell>Latitude</TableCell><TableCell>Longitude</TableCell><TableCell align="right">Value</TableCell></TableRow></TableHead>
          <TableBody>{normalized.rows.slice(0, PRINT_ROW_LIMIT).map((row, index) => <TableRow key={index}><TableCell>{row.date}</TableCell><TableCell>{row.parameter}</TableCell><TableCell>{row.latitude ?? '—'}</TableCell><TableCell>{row.longitude ?? '—'}</TableCell><TableCell align="right">{displayValue(row.value)}</TableCell></TableRow>)}</TableBody>
        </Table>
        {normalized.totalRows > PRINT_ROW_LIMIT && <p>Showing the first {PRINT_ROW_LIMIT.toLocaleString('en-US')} of {normalized.totalRows.toLocaleString('en-US')} values. Download the original JSON for the complete data.</p>}
      </div>}
    </> : <p>This format is shown as returned by the API. The payload has not been converted into trend statistics.</p>}
    <Button size="small" startIcon={<PrintOutlined />} onClick={exportPdf}>Export PDF</Button>
    {canDownloadJson && <Button size="small" onClick={() => downloadMeteomaticsJson(result.result, result.requestedAt)}>Download original JSON</Button>}
    <Button size="small" onClick={() => setShowRaw(value => !value)}>{showRaw ? 'Hide original response' : 'Show original response'}</Button>
    {showRaw && <pre>{raw}</pre>}
    <details><summary>Provenance</summary><pre>{JSON.stringify(result.provenance, null, 2)}</pre></details>
  </section>;
}
