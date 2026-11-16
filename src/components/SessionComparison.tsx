import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Autocomplete, Button, Chip, CircularProgress, MenuItem, TextField } from '@mui/material';
import { CompareArrows, DownloadOutlined } from '@mui/icons-material';
import type { ComparableSeriesSummary, ConversationSession, CorrelationEstimate, SessionComparison as Comparison } from '../../shared/types';
import { useSessionComparison } from '../analysis/useSessionComparison';
import { errorMessage } from '../analysis/resolver';
import { downloadComparisonCsv } from '../comparison.resolver';
import { printElement } from '../print.resolver';
import { getComparableSeries } from '../services/firebase';
import { ComparisonChart } from './ComparisonChart';
import { ExportPdfButton } from './ExportPdfButton';

const formatNumber = (value: number, digits = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value).replace(/^-(0(\.0+)?)$/, '$1');
const WORKFLOW_LABELS: Record<string, string> = { meteomatics: 'Meteomatics', giovanni: 'NASA Giovanni', earthdata: 'NASA Earthdata', trend: 'Trend analysis' };
const seriesText = (series: ComparableSeriesSummary) => `${series.label} · ${series.unit || 'unitless'} · ${series.firstYear}–${series.lastYear} · ${series.validMonths} months`;

type SeriesState = { loading: boolean; series: ComparableSeriesSummary[]; reason: string };
const EMPTY: SeriesState = { loading: false, series: [], reason: '' };

/** Loads a session's comparable series; `refreshKey` reloads them after the session is saved again. */
function useComparableSeries(sessionId: string | null, refreshKey: string) {
  const [state, setState] = useState<SeriesState>(EMPTY);
  useEffect(() => {
    if (!sessionId) { setState(EMPTY); return; }
    let active = true;
    setState(value => ({ ...value, loading: true, reason: '' }));
    void getComparableSeries({ sessionId })
      .then(response => { if (active) setState({ loading: false, series: response.series, reason: response.unavailableReason ?? '' }); })
      .catch(cause => { if (active) setState({ loading: false, series: [], reason: errorMessage(cause) }); });
    return () => { active = false; };
  }, [sessionId, refreshKey]);
  return state;
}

function SeriesSelect({ label, state, value, onChange }: { label: string; state: SeriesState; value: string; onChange: (key: string) => void }) {
  if (state.loading) return <p className="comparison-hint"><CircularProgress size={12} /> Loading the series in this session…</p>;
  if (!state.series.length) return state.reason ? <Alert severity="info">{state.reason}</Alert> : null;
  return <TextField select fullWidth size="small" label={label} value={value} onChange={event => onChange(event.target.value)}>
    {state.series.map(series => <MenuItem key={series.key} value={series.key}>{seriesText(series)}</MenuItem>)}
  </TextField>;
}

function ComparisonPicker({ sessionId, sessions, comparing, onCompare }: { sessionId: string; sessions: ConversationSession[]; comparing: boolean; onCompare: (seriesKey: string, otherSessionId: string, otherSeriesKey: string) => void }) {
  const current = sessions.find(session => session.id === sessionId);
  const candidates = useMemo(() => sessions.filter(session => session.id !== sessionId), [sessions, sessionId]);
  const [other, setOther] = useState<ConversationSession | null>(null);
  const mine = useComparableSeries(sessionId, current?.updatedAt ?? '');
  const theirs = useComparableSeries(other?.id ?? null, other?.updatedAt ?? '');
  const [mineKey, setMineKey] = useState('');
  const [theirKey, setTheirKey] = useState('');
  useEffect(() => { if (!mine.series.some(series => series.key === mineKey)) setMineKey(mine.series[0]?.key ?? ''); }, [mine.series, mineKey]);
  useEffect(() => { setTheirKey(theirs.series[0]?.key ?? ''); }, [theirs.series]);
  const ready = Boolean(mineKey && other && theirKey) && !comparing;

  return <section className="analysis-proposal comparison-picker" aria-label="Compare with another session">
    <div><CompareArrows /><div><strong>Compare with another session</strong><p>Overlay one series from another of your sessions and test whether the two move together. Each session can hold one comparison.</p></div></div>
    <div className="comparison-fields">
      <SeriesSelect label="Series from this session (A)" state={mine} value={mineKey} onChange={setMineKey} />
      <Autocomplete size="small" options={candidates} value={other} onChange={(_, value) => setOther(value)} disabled={comparing}
        getOptionLabel={session => session.title} isOptionEqualToValue={(option, value) => option.id === value.id}
        renderOption={(props, session) => <li {...props} key={session.id}><span><strong>{session.title}</strong><br /><small>{WORKFLOW_LABELS[session.workflow ?? 'trend']} · updated {new Date(session.updatedAt).toLocaleDateString('en-US')}</small></span></li>}
        renderInput={params => <TextField {...params} label="Other session (B)" placeholder={candidates.length ? 'Search your sessions' : 'No other sessions yet'} />} />
      {other && <SeriesSelect label="Series from the other session (B)" state={theirs} value={theirKey} onChange={setTheirKey} />}
    </div>
    <div className="meteo-controls">
      <Button variant="contained" disabled={!ready} onClick={() => onCompare(mineKey, other!.id, theirKey)}>{comparing ? 'Comparing…' : 'Compare sessions'}</Button>
    </div>
    {comparing && <p className="comparison-hint"><CircularProgress size={12} /> Computing the correlation and writing the AI report. This can take up to a minute.</p>}
  </section>;
}

function EstimateRow({ label, estimate }: { label: string; estimate: CorrelationEstimate }) {
  return <tr><th>{label}</th><td>{formatNumber(estimate.r)}</td><td>{formatNumber(estimate.confidenceInterval95[0])} to {formatNumber(estimate.confidenceInterval95[1])}</td><td>{estimate.pValue < 0.001 ? '< 0.001' : formatNumber(estimate.pValue, 3)}</td><td>{estimate.sampleSize} ({Math.round(estimate.effectiveSampleSize)} effective)</td><td>{estimate.significant ? 'Yes' : 'No'}</td></tr>;
}

function ComparisonResult({ comparison }: { comparison: Comparison }) {
  const { a, b, statistics: s, report } = comparison;
  const section = useRef<HTMLElement>(null);
  const exportPdf = () => { if (section.current) printElement(section.current, `earth-trend-comparison-${comparison.createdAt.replace(/[^0-9TZ-]/g, '-')}`); };
  const trendText = (series: typeof a) => series.trend ? `${formatNumber(series.trend.slopePerDecade, 3)} per decade (p = ${formatNumber(series.trend.pValue, 3)}${series.trend.significant ? ', significant' : ', not significant'})` : 'Not estimated (needs 10 complete years and 80% coverage)';
  return <section ref={section} className="meteo-result comparison-result" aria-label="Session comparison">
    <div className="conversation-heading"><div><span className="eyebrow">SESSION COMPARISON</span><h3>Compared with “{b.sessionTitle}”</h3></div><span className="meteo-response-meta">{comparison.commonMonths} common months · {comparison.commonYears} common years</span></div>
    <div className="comparison-legend"><span className="comparison-swatch a" />A · {a.label} ({a.provider})<span className="comparison-swatch b" />B · {b.label} ({b.provider})</div>
    <ComparisonChart comparison={comparison} />
    <div className="comparison-report">
      <div className="comparison-report-heading"><strong>{report.headline}</strong><Chip size="small" variant="outlined" label={report.source === 'gemini' ? 'AI report · numbers verified against the computed statistics' : 'Standard report'} /></div>
      <h4>Findings</h4><ul>{report.findings.map(item => <li key={item}>{item}</li>)}</ul>
      <h4>Caveats</h4><ul>{report.caveats.map(item => <li key={item}>{item}</li>)}</ul>
      {report.nextSteps.length > 0 && <><h4>Next steps</h4><ul>{report.nextSteps.map(item => <li key={item}>{item}</li>)}</ul></>}
    </div>
    {comparison.outcome === 'insufficient_data' && <Alert severity="info">There is not enough overlap to infer a correlation. The chart shows the data each session holds.</Alert>}
    {comparison.warnings.map(warning => <Alert key={warning} severity="warning" sx={{ mt: 1 }}>{warning}</Alert>)}
    {s && <>
      <h4>Correlation statistics</h4>
      <div className="meteo-response-table-wrap"><table><thead><tr><th>Measure</th><th>r</th><th>95% CI</th><th>p</th><th>n</th><th>Significant (0.05)</th></tr></thead><tbody>
        <EstimateRow label="Monthly anomalies (seasonal cycle removed)" estimate={s.monthlyAnomaly} />
        {s.annual && <EstimateRow label="Annual values" estimate={s.annual} />}
      </tbody></table></div>
      <div className="meteo-response-table-wrap"><table><tbody>
        <tr><th>Raw monthly r (inflated by seasonality)</th><td>{formatNumber(s.monthlyRawR)}</td></tr>
        <tr><th>Spearman ρ of monthly anomalies</th><td>{formatNumber(s.monthlyAnomalySpearman)}</td></tr>
        <tr><th>Annual r after removing both trends</th><td>{s.annualDetrendedR === null ? '—' : formatNumber(s.annualDetrendedR)}</td></tr>
        <tr><th>Strongest lagged anomaly r (±6 months, descriptive)</th><td>{s.bestLag.months === 0 ? 'No lag' : `${s.bestLag.months > 0 ? 'B follows A' : 'B leads A'} by ${Math.abs(s.bestLag.months)} months`} · r = {formatNumber(s.bestLag.r)}</td></tr>
        <tr><th>Change in B per unit of A (anomalies, OLS)</th><td>{formatNumber(s.anomalySlopeBOnA, 4)} {b.unit} per {a.unit || 'unit'}</td></tr>
        <tr><th>Lag-1 autocorrelation (A / B)</th><td>{formatNumber(s.lag1AutocorrelationA)} / {formatNumber(s.lag1AutocorrelationB)}</td></tr>
        <tr><th>Annual trend A</th><td>{trendText(a)}</td></tr>
        <tr><th>Annual trend B</th><td>{trendText(b)}</td></tr>
        <tr><th>Trend directions</th><td>{s.trendDirections.agree === null ? 'Cannot be compared' : s.trendDirections.agree ? `Same direction (${s.trendDirections.a})` : `Opposite (A ${s.trendDirections.a}, B ${s.trendDirections.b})`}</td></tr>
      </tbody></table></div>
      <p>Method: Pearson correlation of deseasonalized monthly anomalies over common months, with inference on an effective sample size adjusted for lag-1 autocorrelation (Bretherton et al. 1999) and a Fisher-z interval. At least 36 common months (and 10 common complete years for annual figures) are required: an operational threshold of this POC. Correlation does not establish causation.</p>
    </>}
    <div className="result-actions">
      <ExportPdfButton onClick={exportPdf} />
      <Button size="small" startIcon={<DownloadOutlined />} onClick={() => downloadComparisonCsv(comparison)}>Download monthly CSV (both series)</Button>
    </div>
    <details><summary>Provenance</summary><pre>{JSON.stringify({ A: { session: a.sessionTitle, series: a.label, provenance: a.provenance }, B: { session: b.sessionTitle, series: b.label, provenance: b.provenance }, methodologyVersion: comparison.methodologyVersion, comparedAt: comparison.createdAt }, null, 2)}</pre></details>
  </section>;
}

/** After a request is submitted: a one-time picker to compare with another session, then the stored comparison. */
export function SessionComparison({ sessionId, sessions, ready }: { sessionId: string; sessions: ConversationSession[]; ready: boolean }) {
  const { comparison, loading, comparing, error, compare } = useSessionComparison(sessionId);
  if (loading) return null;
  return <>
    {comparison ? <ComparisonResult comparison={comparison} />
      : ready && <ComparisonPicker sessionId={sessionId} sessions={sessions} comparing={comparing} onCompare={(seriesKey, otherSessionId, otherSeriesKey) => void compare({ seriesKey, otherSessionId, otherSeriesKey })} />}
    {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
  </>;
}
