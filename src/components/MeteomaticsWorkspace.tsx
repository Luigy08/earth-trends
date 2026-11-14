import ReactMarkdown from 'react-markdown';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Autocomplete, Button, Chip, CircularProgress, Collapse, TextField } from '@mui/material';
import { CheckCircleOutline, ExpandMore, Send } from '@mui/icons-material';
import type { MeteomaticsAvailabilityResponse, MeteomaticsCatalogResponse, MeteomaticsExecuteResponse, MeteomaticsQuerySpec } from '../../shared/types';
import { executeMeteomaticsQuery, getMeteomaticsCatalog, interpretMeteomatics } from '../services/firebase';
import { MeteomaticsResponse } from './MeteomaticsResponse';

type ChatLine = { role: 'user' | 'assistant'; content: string };
const errorText = (cause: unknown) => {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  if (/Meteomatics credentials are not configured/i.test(cause instanceof Error ? cause.message : '')) return 'Meteomatics credentials are not configured on the server.';
  if (/functions\/internal|internal \[0\]/i.test(`${code} ${cause instanceof Error ? cause.message : ''}`)) {
    return 'The Meteomatics API Functions are not available in this Firebase project or region. Deploy getMeteomaticsCatalog, interpretMeteomatics, checkMeteomaticsAvailability, and executeMeteomaticsQuery.';
  }
  if (/functions\/unavailable|network/i.test(`${code} ${cause instanceof Error ? cause.message : ''}`)) {
    return cause instanceof Error && cause.message && cause.message !== 'unavailable' ? cause.message : 'Could not reach the service. Please try again.';
  }
  return cause instanceof Error ? cause.message : 'The Meteomatics service is unavailable.';
};

export function MeteomaticsWorkspace() {
  const [catalog, setCatalog] = useState<MeteomaticsCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [selectedParameters, setSelectedParameters] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<MeteomaticsQuerySpec | null>(null);
  const [availability, setAvailability] = useState<MeteomaticsAvailabilityResponse | null>(null);
  const [result, setResult] = useState<MeteomaticsExecuteResponse | null>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const options = useMemo(() => catalog?.parameters ?? [], [catalog]);

  useEffect(() => {
    void getMeteomaticsCatalog().then(setCatalog).catch(cause => setCatalogError(errorText(cause))).finally(() => setCatalogBusy(false));
  }, []);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setBusy(true); setError(''); setSuggestions([]); setSummary(''); setProposal(null); setAvailability(null); setResult(null); setInput('');
    const history = [...messages, { role: 'user' as const, content: message }];
    setMessages(history);
    try {
      const prompt = `${history.slice(-8).map(line => `${line.role}: ${line.content}`).join('\n')}\nSelected catalog parameters: ${selectedParameters.join(', ') || 'none'}`;
      const interpreted = await interpretMeteomatics({ query: prompt });
      setSuggestions(interpreted.suggestions ?? []);
      setSummary(interpreted.summary);
      setLocationLabel(interpreted.locationLabel ?? '');
      if (interpreted.status === 'needs_clarification' || !interpreted.spec) {
        setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Information needed**\n\n${interpreted.clarificationQuestions.map(question => `- ${question}`).join('\n')}` }]);
        return;
      }
      const spec = interpreted.spec;
      setProposal(spec);
      setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Ready to review**\n\nYour required details are complete. Submit when ready; availability will be determined by Meteomatics.` }]);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    if (!proposal || busy) return;
    setBusy(true); setError('');
    try {
      setResult(await executeMeteomaticsQuery({ spec: proposal, confirmed: true }));
    }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  return <section className="meteo-workspace" aria-label="Meteomatics query assistant">
    <div className="conversation-heading"><div><span className="eyebrow">METEOMATICS WEATHER API</span><h2>Build a data request.</h2></div><span className="assistant-status"><i />API assistant</span></div>
    <p className="meteo-intro">Tell me what you want to explore. I’ll collect the details, find your location, and help you review the request before you submit it.</p>
    {catalogError && <Alert severity="warning" sx={{ mb: 1 }}>The parameter catalog could not be loaded: {catalogError}</Alert>}
    <details><summary>Optional: browse weather variables</summary><Autocomplete multiple options={options} groupBy={option => option.domain} value={options.filter(option => selectedParameters.includes(option.parameter))}
      getOptionLabel={option => option.parameter} loading={catalogBusy} onChange={(_, selected) => setSelectedParameters(selected.slice(0, 10).map(option => option.parameter))}
      renderInput={params => <TextField {...params} label="Browse weather variables and parameter families" placeholder="Parameter code or name" helperText={catalog ? `${catalog.parameters.length} parameters · catalog ${catalog.version}` : catalogBusy ? 'Loading catalog…' : 'Catalog unavailable; check Firebase Functions.'} />}
      renderOption={(props, option) => <li {...props} key={option.parameter}><span><strong>{option.parameter}</strong><br />{option.description}</span></li>} sx={{ mb: 2 }} /></details>
    <div className="meteo-transcript" aria-live="polite">
      {!messages.length && <div className="assistant-message"><span className="assistant-mark">✳</span><div><strong>What Meteomatics data do you need?</strong><p>Tell me which weather conditions interest you, where, and when. For a series, include how often you want a value. You can describe a city, an area, a station or a route in your own words.</p></div></div>}
      {messages.map((line, index) => <div className={`conversation-message ${line.role}`} key={`${index}-${line.role}`}><div>{line.role === 'assistant' ? <ReactMarkdown>{line.content}</ReactMarkdown> : line.content}</div></div>)}
      {suggestions.length > 0 && <Alert severity="info"><strong>Optional ways to refine your request</strong><ul>{suggestions.map(item => <li key={item}>{item}</li>)}</ul>These suggestions are optional.</Alert>}
    {proposal && <div className="analysis-proposal meteo-proposal"><div><CheckCircleOutline /><div><strong>Ready to submit</strong><p>{summary}</p><p>{locationLabel || 'Selected location'}{proposal.point ? ` · ${proposal.point.latitude}, ${proposal.point.longitude}` : ''}</p><p>Dates (UTC): {proposal.validDates}</p><p>Variables: {proposal.parameters.join(', ')} · Format: {proposal.format.toUpperCase()} · Source: {proposal.source}</p></div></div>
      <div className="meteo-controls"><Button size="small" endIcon={<ExpandMore />} onClick={() => setShowRequest(value => !value)}>{showRequest ? 'Hide request' : 'Review request'}</Button>
        <Button variant="contained" disabled={busy} onClick={() => void execute()}>{busy ? 'Working…' : 'Submit request'}</Button></div>
      <Collapse in={showRequest}><div className="meteo-request-details"><pre>{JSON.stringify(proposal, null, 2)}</pre><div>{(availability?.ranges ?? []).map(range => <Chip key={range.parameter} size="small" color={range.requestedWithinRange ? 'success' : 'error'} label={`${range.parameter}: ${range.minDate || 'unavailable'} → ${range.maxDate || 'unavailable'}`} />)}</div></div></Collapse>
    </div>}
      {busy && <div className="conversation-message assistant"><div className="typing-indicator"><CircularProgress size={14} /> Checking the request…</div></div>}
    </div>
    <div className="composer"><TextField fullWidth multiline maxRows={4} value={input} onChange={event => setInput(event.target.value)}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Describe a Meteomatics request…" aria-label="Message the Meteomatics assistant" slotProps={{ htmlInput: { maxLength: 2000 } }} />
      <Button variant="contained" aria-label="Send message" disabled={!input.trim() || busy || catalogBusy} onClick={() => void send()}><Send /></Button></div>
    {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    {result && <MeteomaticsResponse result={result} />}
    <span className="composer-hint">Meteomatics access depends on the configured account and subscription. This does not produce climate trend statistics.</span>
  </section>;
}
