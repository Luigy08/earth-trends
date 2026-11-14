import { useState } from 'react';
import { Alert, Button, CircularProgress, Collapse, FormControl, InputLabel, MenuItem, Select, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup } from '@mui/material';
import { ArrowForward, AutoAwesomeOutlined, CheckCircleOutline, ExpandMore, TuneOutlined, WaterDropOutlined, WbSunnyOutlined } from '@mui/icons-material';
import type { AnalysisSpec } from '../../shared/types';
import { EXAMPLE_QUERIES, MAX_YEAR } from '../app.constant';
import type { AnalysisDraft, QueryMode } from '../app.types';
import { interpretQuery, isConfigured } from '../services/firebase';
import { errorMessage, toSpec, validateDraft } from '../analysis/resolver';
import { LocationSearch } from './LocationSearch';

export function QueryBuilder({ onSubmit, busy, onSetup }: { onSubmit: (spec: AnalysisSpec) => void; busy: boolean; onSetup: () => void }) {
  const [mode, setMode] = useState<QueryMode>('question');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<AnalysisDraft>({ metric: 'temperature', locations: [null, null], startYear: 2000, endYear: MAX_YEAR, comparisonMode: 'none', secondPeriod: { startYear: 2010, endYear: MAX_YEAR } });
  const [interpreting, setInterpreting] = useState(false);
  const [confirmation, setConfirmation] = useState(false);
  const [summary, setSummary] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const updateDraft = (next: Partial<AnalysisDraft>) => { setDraft(previous => ({ ...previous, ...next })); setError(''); };
  const interpret = async () => {
    if (!isConfigured) { onSetup(); return; }
    if (query.trim().length < 10) { setError('Please describe what you want to explore in at least 10 characters.'); return; }
    setInterpreting(true); setError(''); setQuestions([]); setWarnings([]);
    try {
      const response = await interpretQuery({ query: query.trim() });
      setSummary(response.summary); setWarnings(response.warnings); setQuestions(response.clarificationQuestions);
      if (response.status === 'ready' && response.spec) { setDraft({ ...response.spec, locations: [...response.spec.locations, null].slice(0, 2) }); setConfirmation(true); }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setInterpreting(false); }
  };
  const submit = () => {
    const validation = validateDraft(draft);
    if (validation) { setError(validation); return; }
    if (!isConfigured) { onSetup(); return; }
    onSubmit(toSpec(draft));
  };
  const form = <div className="configuration-form">
    <div className="form-intro"><span className="eyebrow">{confirmation && mode === 'question' ? 'CONFIRM YOUR ANALYSIS' : 'DEFINE YOUR ANALYSIS'}</span><p>{confirmation && mode === 'question' ? summary : 'One place, one time period, and one question to explore.'}</p></div>
    <div className="configuration-grid"><FormControl size="small"><InputLabel id="comparison-label">Analysis type</InputLabel><Select labelId="comparison-label" label="Analysis type" value={draft.comparisonMode} onChange={event => updateDraft({ comparisonMode: event.target.value, secondPeriod: draft.secondPeriod ?? { startYear: 2010, endYear: MAX_YEAR } })}><MenuItem value="none">One location</MenuItem><MenuItem value="locations">Compare two cities</MenuItem><MenuItem value="periods">Compare two time periods</MenuItem></Select></FormControl><ToggleButtonGroup className="metric-selector" exclusive fullWidth size="small" value={draft.metric} onChange={(_, metric) => metric && updateDraft({ metric })}><ToggleButton value="temperature"><WbSunnyOutlined fontSize="small" />Temperature</ToggleButton><ToggleButton value="precipitation"><WaterDropOutlined fontSize="small" />Precipitation</ToggleButton></ToggleButtonGroup>
    <LocationSearch label={draft.comparisonMode === 'locations' ? 'First city' : 'Location'} value={draft.locations[0] ?? null} onChange={location => updateDraft({ locations: [location, draft.locations[1] ?? null] })} />
    {draft.comparisonMode === 'locations' ? <LocationSearch label="Second city" value={draft.locations[1] ?? null} onChange={location => updateDraft({ locations: [draft.locations[0] ?? null, location] })} /> : <div className="location-hint">Select a match to set its coordinates.</div>}
    <YearFields startYear={draft.startYear} endYear={draft.endYear} label={draft.comparisonMode === 'periods' ? 'First time period' : 'Study period'} onChange={(startYear, endYear) => updateDraft({ startYear, endYear })} />
    {draft.comparisonMode === 'periods' && <YearFields startYear={draft.secondPeriod?.startYear ?? 2010} endYear={draft.secondPeriod?.endYear ?? MAX_YEAR} label="Second time period" onChange={(startYear, endYear) => updateDraft({ secondPeriod: { startYear, endYear } })} />}</div>
    <div className="form-footer"><span><CheckCircleOutline fontSize="small" />Review the settings before continuing.</span><Button variant="contained" disabled={busy || interpreting} endIcon={busy ? <CircularProgress size={16} color="inherit" /> : <ArrowForward />} onClick={submit}>{busy ? 'Analyzing…' : 'Confirm and analyze'}</Button></div>
  </div>;
  return <section className="query-card" aria-label="New analysis"><div className="query-tabs"><Tabs value={mode} onChange={(_, value) => { setMode(value); setError(''); }} aria-label="Query mode"><Tab icon={<AutoAwesomeOutlined />} iconPosition="start" value="question" label="Ask in your own words" /><Tab icon={<TuneOutlined />} iconPosition="start" value="form" label="Configure analysis" /></Tabs><span className="query-step">01 <span>/ THE QUESTION</span></span></div>
    {mode === 'question' ? <><div className="question-input"><label htmlFor="natural-query">What would you like to discover?</label><TextField id="natural-query" fullWidth multiline minRows={2} maxRows={5} value={query} onChange={event => { setQuery(event.target.value); setConfirmation(false); setQuestions([]); setError(''); }} placeholder={`How has the temperature changed in Tegucigalpa between 2000 and ${MAX_YEAR}?`} slotProps={{ htmlInput: { maxLength: 1500 } }} variant="standard" /><div className="question-bottom"><span><AutoAwesomeOutlined />You ask. Science responds.</span><Button variant="contained" disabled={interpreting || busy} endIcon={interpreting ? <CircularProgress size={16} color="inherit" /> : <ArrowForward />} onClick={() => void interpret()}>{interpreting ? 'Interpreting…' : 'Explore question'}</Button></div></div><div className="example-queries"><span>TRY ONE</span>{EXAMPLE_QUERIES.map(example => <button key={example.label} onClick={() => { setQuery(example.query); setConfirmation(false); setQuestions([]); setError(''); }}>{example.label}<ArrowForward /></button>)}</div><Collapse in={confirmation}>{form}</Collapse></> : form}
    {(error || warnings.length > 0 || questions.length > 0) && <div className="query-messages" aria-live="polite">{error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}{warnings.map((warning, index) => <Alert severity="warning" key={index}>{warning}</Alert>)}{questions.length > 0 && <Alert severity="info"><strong>We need a little more context.</strong>{questions.map((question, index) => <p key={index}>{question}</p>)}<span>Complete your question or use the manual settings.</span></Alert>}</div>}
    {mode === 'question' && confirmation && <button className="edit-confirmation" onClick={() => setConfirmation(false)}>Back to question<ExpandMore /></button>}
  </section>;
}

function YearFields({ startYear, endYear, label, onChange }: { startYear: number; endYear: number; label: string; onChange: (start: number, end: number) => void }) {
  return <fieldset className="year-fields"><legend>{label}</legend><TextField size="small" label="From" type="number" value={Number.isNaN(startYear) ? '' : startYear} onChange={event => onChange(event.target.value === '' ? NaN : Number(event.target.value), endYear)} slotProps={{ htmlInput: { min: 1981, max: MAX_YEAR } }} /><span>→</span><TextField size="small" label="To" type="number" value={Number.isNaN(endYear) ? '' : endYear} onChange={event => onChange(startYear, event.target.value === '' ? NaN : Number(event.target.value))} slotProps={{ htmlInput: { min: 1981, max: MAX_YEAR } }} /></fieldset>;
}
