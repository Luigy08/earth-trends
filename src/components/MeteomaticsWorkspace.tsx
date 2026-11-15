import ReactMarkdown from 'react-markdown';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Autocomplete, Badge, Button, Chip, CircularProgress, Collapse, IconButton, MenuItem, Popover, TextField, Tooltip } from '@mui/material';
import { CheckCircleOutline, ExpandMore, Refresh, TuneOutlined } from '@mui/icons-material';
import type { MeteomaticsAvailabilityResponse, MeteomaticsCatalogResponse, MeteomaticsExecuteResponse, MeteomaticsQuerySpec, MeteomaticsSessionState, ConversationSession } from '../../shared/types';
import { executeMeteomaticsQuery, getMeteomaticsCatalog, getMeteomaticsSuggestions, interpretMeteomatics, getMeteomaticsSession, saveMeteomaticsSession } from '../services/firebase';
import { MeteomaticsResponse } from './MeteomaticsResponse';
import { ChatComposer, ChatGreeting } from './ChatComposer';
import { DictationButton } from './DictationButton';

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

export function MeteomaticsWorkspace({ sessionId, onSessionUpdated, tools }: { sessionId: string; onSessionUpdated: (session: ConversationSession) => void; tools?: ReactNode }) {
  const threadEnd = useRef<HTMLDivElement>(null);
  const [catalogAnchor, setCatalogAnchor] = useState<HTMLElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const updatedCallback = useRef(onSessionUpdated);
  updatedCallback.current = onSessionUpdated;
  const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
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
  const [results, setResults] = useState<MeteomaticsExecuteResponse[]>([]);
  const [showRequest, setShowRequest] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const sourceIssue = proposal?.source.trim().toLowerCase() === 'ecmwf' || !proposal?.source.trim();
  const options = useMemo(() => catalog?.parameters ?? [], [catalog]);

  useEffect(() => {
    void getMeteomaticsCatalog().then(setCatalog).catch(cause => setCatalogError(errorText(cause))).finally(() => setCatalogBusy(false));
  }, []);

  useEffect(() => {
    let active = true;
    void getMeteomaticsSession(sessionId).then(({ state }) => {
      if (!active) return;
      if (state) {
        setMessages(state.messages); setProposal(state.proposal); setResults(state.results ?? []);
        setSuggestions(state.suggestions); setSummary(state.summary); setLocationLabel(state.locationLabel);
        setSelectedParameters(state.selectedParameters ?? []);
      }
      setLoaded(true);
    }).catch(cause => { if (active) setError(`Could not restore this session: ${errorText(cause)}`); });
    return () => { active = false; };
  }, [sessionId]);

  useEffect(() => {
    if (!loaded || messages.length === 0) return;
    const state: MeteomaticsSessionState = { messages, proposal, results, suggestions, summary, locationLabel, selectedParameters };
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
        const { session } = await saveMeteomaticsSession(sessionId, state);
        updatedCallback.current(session);
      }).catch(cause => { setError(`Could not save this session: ${errorText(cause)}`); });
  }, [loaded, sessionId, messages, proposal, results, suggestions, summary, locationLabel, selectedParameters]);

  const refreshSearchSuggestions = async () => {
    setSuggestionsBusy(true);
    try {
      const response = await getMeteomaticsSuggestions();
      setSearchSuggestions(response.suggestions);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSuggestionsBusy(false);
    }
  };

  useEffect(() => { void refreshSearchSuggestions(); }, []);

  const send = async () => {
    const message = input.trim() || (selectedParameters.length ? `Use these selected parameters: ${selectedParameters.join(', ')}.` : '');
    if (!message || busy) return;
    setBusy(true); setError(''); setSuggestions([]); setSummary(''); setProposal(null); setAvailability(null); setInput('');
    const history = [...messages, { role: 'user' as const, content: message }];
    setMessages(history);
    try {
      const prompt = `${history.slice(-8).map(line => `${line.role}: ${line.content}`).join('\n')}\nSelected catalog parameters: ${selectedParameters.join(', ') || 'none'}`;
      const interpreted = await interpretMeteomatics({ query: prompt });
      setSuggestions([]);
      const optional = interpreted.suggestions?.length ? `\n\n**Optional suggestions**\n\n${interpreted.suggestions.map(item => `- ${item}`).join('\n')}` : '';
      setSummary(interpreted.summary);
      setLocationLabel(interpreted.locationLabel ?? '');
      if (interpreted.status === 'needs_clarification' || !interpreted.spec) {
        setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Information needed**\n\n${interpreted.clarificationQuestions.map(question => `- ${question}`).join('\n')}${optional}` }]);
        return;
      }
      const spec = interpreted.spec;
      setProposal(spec);
      setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Ready to review**\n\nYour required details are complete. Submit when ready; availability will be determined by Meteomatics.${optional}` }]);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    if (!proposal || busy || sourceIssue) return;
    setBusy(true); setError('');
    try {
      const response = await executeMeteomaticsQuery({ spec: proposal, confirmed: true });
      setResults(items => [...items, response]);
    }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const empty = messages.length === 0 && results.length === 0 && !proposal;
  useEffect(() => { if (!empty) threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, results, busy, empty]);
  const catalogPicker = <><Tooltip title="Browse weather variables"><span><IconButton size="small" aria-label="Browse weather variables" disabled={!loaded} onClick={event => setCatalogAnchor(event.currentTarget)}><Badge color="secondary" badgeContent={selectedParameters.length} invisible={!selectedParameters.length}><TuneOutlined fontSize="small" /></Badge></IconButton></span></Tooltip>
    <Popover open={Boolean(catalogAnchor)} anchorEl={catalogAnchor} onClose={() => setCatalogAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'right' }} slotProps={{ paper: { className: 'catalog-popover' } }}>
      {catalogError && <Alert severity="warning" sx={{ mb: 1.5 }}>The parameter catalog could not be loaded: {catalogError}</Alert>}
      <Autocomplete multiple options={options} groupBy={option => option.domain} value={options.filter(option => selectedParameters.includes(option.parameter))}
        getOptionLabel={option => option.parameter} loading={catalogBusy} onChange={(_, selected) => setSelectedParameters(selected.slice(0, 10).map(option => option.parameter))}
        renderInput={params => <TextField {...params} autoFocus label="Weather variables and parameter families" placeholder="Parameter code or name" helperText={catalog ? `Optional · up to 10 · ${catalog.parameters.length} parameters · catalog ${catalog.version}` : catalogBusy ? 'Loading catalog…' : 'Catalog unavailable; check Firebase Functions.'} />}
        renderOption={(props, option) => <li {...props} key={option.parameter}><span><strong>{option.parameter}</strong><br />{option.description}</span></li>} />
    </Popover></>;

  return <section className={`chat-workspace ${empty ? 'is-empty' : ''}`} aria-label="Meteomatics query assistant">
    {empty && <ChatGreeting />}
    {!empty && <div className="chat-thread" aria-live="polite">
      {messages.map((line, index) => <div className={`conversation-message ${line.role}`} key={`${index}-${line.role}`}><div>{line.role === 'assistant' ? <ReactMarkdown>{line.content}</ReactMarkdown> : line.content}</div></div>)}
      {suggestions.length > 0 && <Alert severity="info"><strong>Optional ways to refine your request</strong><ul>{suggestions.map(item => <li key={item}>{item}</li>)}</ul>These suggestions are optional.</Alert>}
    {proposal && <div className="analysis-proposal meteo-proposal"><div><CheckCircleOutline /><div><strong>{sourceIssue ? 'Choose a data source' : 'Ready to submit'}</strong><p>{summary}</p><p>{locationLabel || 'Selected location'}{proposal.point ? ` · ${proposal.point.latitude}, ${proposal.point.longitude}` : ''}</p><p>Dates (UTC): {proposal.validDates}</p><p>Variables: {proposal.parameters.join(', ')} · Format: {proposal.format.toUpperCase()} · Source: {proposal.source}</p></div></div>
      <TextField select fullWidth size="small" label="Data source" value={sourceIssue ? '' : proposal.source} onChange={event => { setProposal(current => current ? { ...current, source: event.target.value } : current); setError(''); }} helperText={sourceIssue ? 'ECMWF offers several products. Select a specific source before submitting.' : 'Changing the source changes the dataset. Availability depends on your account and dates.'} sx={{ mt: 2 }}>
        <MenuItem value="" disabled>Choose a source</MenuItem>
        <MenuItem value="mix">Meteomatics Mix</MenuItem>
        <MenuItem value="ecmwf-ifs">ECMWF IFS (forecast)</MenuItem>
        {!sourceIssue && !['mix', 'ecmwf-ifs'].includes(proposal.source) && <MenuItem value={proposal.source}>{proposal.source}</MenuItem>}
      </TextField>
      <div className="meteo-controls"><Button size="small" endIcon={<ExpandMore />} onClick={() => setShowRequest(value => !value)}>{showRequest ? 'Hide request' : 'Review request'}</Button>
        <Button variant="contained" disabled={busy || sourceIssue} onClick={() => void execute()}>{busy ? 'Working…' : 'Submit request'}</Button></div>
      <Collapse in={showRequest}><div className="meteo-request-details"><pre>{JSON.stringify(proposal, null, 2)}</pre><div>{(availability?.ranges ?? []).map(range => <Chip key={range.parameter} size="small" color={range.requestedWithinRange ? 'success' : 'error'} label={`${range.parameter}: ${range.minDate || 'unavailable'} → ${range.maxDate || 'unavailable'}`} />)}</div></div></Collapse>
    </div>}
      {results.map((result, index) => <MeteomaticsResponse key={`${result.requestedAt}-${index}`} result={result} />)}
      {busy && <div className="conversation-message assistant"><div className="typing-indicator"><CircularProgress size={14} /> Checking the request…</div></div>}
      <div ref={threadEnd} />
    </div>}
    {error && <Alert severity="error" className="chat-alert">{error}</Alert>}
    <div className="chat-dock">
      <ChatComposer value={input} onChange={setInput} onSubmit={() => void send()} ariaLabel="Message the Meteomatics assistant" maxLength={2000} placeholder="Ask for weather data: what, where and when…"
        canSubmit={Boolean(input.trim() || selectedParameters.length) && !busy && !catalogBusy && loaded} tools={tools} actions={<>{catalogPicker}<DictationButton disabled={busy || !loaded} onTranscript={spoken => setInput(value => value ? `${value} ${spoken}` : spoken)} /></>} />
      {empty && (searchSuggestions.length > 0 || suggestionsBusy) && <div className="chat-suggestions" aria-label="Suggested searches">{searchSuggestions.map(suggestion => <Chip key={suggestion} label={suggestion} title={suggestion} variant="outlined" clickable onClick={() => setInput(suggestion)} disabled={busy || !loaded} />)}<Tooltip title="Refresh suggestions"><span><IconButton className="suggestions-refresh" size="small" aria-label="Refresh suggestions" onClick={() => void refreshSearchSuggestions()} disabled={suggestionsBusy || busy || !loaded}>{suggestionsBusy ? <CircularProgress size={15} /> : <Refresh fontSize="small" />}</IconButton></span></Tooltip></div>}
      <span className="chat-disclaimer">Meteomatics access depends on the configured account and subscription. This does not produce climate trend statistics.</span>
    </div>
  </section>;
}
