import ReactMarkdown from 'react-markdown';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Autocomplete, Badge, Button, Chip, CircularProgress, Collapse, IconButton, Popover, TextField, Tooltip } from '@mui/material';
import { CheckCircleOutline, ExpandMore, TuneOutlined } from '@mui/icons-material';
import type { ConversationSession, GiovanniCatalogResponse, GiovanniExecuteResponse, GiovanniQuerySpec, GiovanniSessionState } from '../../shared/types';
import { GIOVANNI_SEARCH_SUGGESTIONS } from '../../shared/giovanni-catalog.constant';
import { executeGiovanniQuery, getGiovanniCatalog, interpretGiovanni } from '../services/firebase';
import { useQuerySession } from '../analysis/useQuerySession';
import { MeteomaticsResponse } from './MeteomaticsResponse';
import { ChatComposer, ChatGreeting } from './ChatComposer';
import { SessionComparison } from './SessionComparison';
import { DictationButton } from './DictationButton';
import { SessionLoading } from './SessionLoading';

type ChatLine = { role: 'user' | 'assistant'; content: string };
const errorText = (cause: unknown) => {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  const message = cause instanceof Error ? cause.message : '';
  if (/functions\/internal|functions\/not-found|internal \[0\]/i.test(`${code} ${message}`)) {
    return 'The Giovanni Functions are not available in this Firebase project or region. Deploy getGiovanniCatalog, interpretGiovanni, and executeGiovanniQuery.';
  }
  return message && message !== 'unavailable' ? message : 'NASA Giovanni is unavailable. Please try again.';
};

/** Chat workflow for raw NASA Giovanni point time series; mirrors the Meteomatics workspace. */
export function GiovanniWorkspace({ sessionId, sessions, onSessionUpdated, tools }: { sessionId: string; sessions: ConversationSession[]; onSessionUpdated: (session: ConversationSession) => void; tools?: ReactNode }) {
  const threadEnd = useRef<HTMLDivElement>(null);
  const [catalogAnchor, setCatalogAnchor] = useState<HTMLElement | null>(null);
  const [catalog, setCatalog] = useState<GiovanniCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [selectedParameters, setSelectedParameters] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<GiovanniQuerySpec | null>(null);
  const [results, setResults] = useState<GiovanniExecuteResponse[]>([]);
  const [showRequest, setShowRequest] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const options = useMemo(() => catalog?.variables ?? [], [catalog]);
  const describe = (id: string) => options.find(option => option.id === id)?.description ?? id;

  useEffect(() => {
    void getGiovanniCatalog().then(setCatalog).catch(cause => setCatalogError(errorText(cause))).finally(() => setCatalogBusy(false));
  }, []);

  const sessionState = useMemo<GiovanniSessionState | null>(() => messages.length === 0 ? null
    : { messages, proposal, results, suggestions, summary, locationLabel, selectedParameters },
  [messages, proposal, results, suggestions, summary, locationLabel, selectedParameters]);
  const loaded = useQuerySession(sessionId, 'giovanni', sessionState, state => {
    setMessages(state.messages); setProposal(state.proposal); setResults(state.results ?? []);
    setSuggestions(state.suggestions); setSummary(state.summary); setLocationLabel(state.locationLabel);
    setSelectedParameters(state.selectedParameters ?? []);
  }, onSessionUpdated, setError);

  const send = async () => {
    const message = input.trim() || (selectedParameters.length ? `Use these selected variables: ${selectedParameters.join(', ')}.` : '');
    if (!message || busy) return;
    setBusy(true); setError(''); setSuggestions([]); setSummary(''); setProposal(null); setInput('');
    const history = [...messages, { role: 'user' as const, content: message }];
    setMessages(history);
    try {
      const prompt = `${history.slice(-8).map(line => `${line.role}: ${line.content}`).join('\n')}\nSelected catalog variables: ${selectedParameters.join(', ') || 'none'}`;
      const interpreted = await interpretGiovanni({ query: prompt });
      const optional = interpreted.suggestions?.length ? `\n\n**Optional suggestions**\n\n${interpreted.suggestions.map(item => `- ${item}`).join('\n')}` : '';
      setSummary(interpreted.summary);
      setLocationLabel(interpreted.locationLabel ?? '');
      if (interpreted.status === 'needs_clarification' || !interpreted.spec) {
        setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Information needed**\n\n${interpreted.clarificationQuestions.map(question => `- ${question}`).join('\n')}${optional}` }]);
        return;
      }
      setProposal(interpreted.spec);
      setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Ready to review**\n\nYour required details are complete. Submit when ready; NASA Giovanni determines whether the variable is served for this place and period.${optional}` }]);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    if (!proposal || busy) return;
    setBusy(true); setExecuting(true); setError('');
    try {
      const response = await executeGiovanniQuery({ spec: proposal, confirmed: true });
      setResults(items => [...items, response]);
    }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); setExecuting(false); }
  };

  const empty = messages.length === 0 && results.length === 0 && !proposal;
  const submitted = executing || results.length > 0;
  useEffect(() => { if (!empty) threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, results, busy, empty]);
  const catalogPicker = <><Tooltip title="Browse NASA variables"><span><IconButton size="small" aria-label="Browse NASA variables" disabled={!loaded} onClick={event => setCatalogAnchor(event.currentTarget)}><Badge color="secondary" badgeContent={selectedParameters.length} invisible={!selectedParameters.length}><TuneOutlined fontSize="small" /></Badge></IconButton></span></Tooltip>
    <Popover open={Boolean(catalogAnchor)} anchorEl={catalogAnchor} onClose={() => setCatalogAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'right' }} slotProps={{ paper: { className: 'catalog-popover' } }}>
      {catalogError && <Alert severity="warning" sx={{ mb: 1.5 }}>The variable catalog could not be loaded: {catalogError}</Alert>}
      <Autocomplete multiple options={options} groupBy={option => option.domain} value={options.filter(option => selectedParameters.includes(option.id))}
        getOptionLabel={option => option.description} loading={catalogBusy} onChange={(_, selected) => setSelectedParameters(selected.slice(0, 5).map(option => option.id))}
        renderInput={params => <TextField {...params} autoFocus label="NASA Earth science variables" placeholder="Variable name or Giovanni ID" helperText={catalog ? `Optional · up to 5 · ${catalog.variables.length} variables · catalog ${catalog.version}` : catalogBusy ? 'Loading catalog…' : 'Catalog unavailable; check Firebase Functions.'} />}
        renderOption={(props, option) => <li {...props} key={option.id}><span><strong>{option.description}</strong><br />{option.id} · {option.temporalResolution} · {option.unit} · from {option.firstYear}</span></li>} />
    </Popover></>;

  if (!loaded) return <SessionLoading />;

  return <section className={`chat-workspace ${empty ? 'is-empty' : ''}`} aria-label="NASA Giovanni query assistant">
    {empty && <ChatGreeting />}
    {!empty && <div className="chat-thread" aria-live="polite">
      {messages.map((line, index) => <div className={`conversation-message ${line.role}`} key={`${index}-${line.role}`}><div>{line.role === 'assistant' ? <ReactMarkdown>{line.content}</ReactMarkdown> : line.content}</div></div>)}
      {suggestions.length > 0 && <Alert severity="info"><strong>Optional ways to refine your request</strong><ul>{suggestions.map(item => <li key={item}>{item}</li>)}</ul>These suggestions are optional.</Alert>}
      {proposal && !submitted && <div className="analysis-proposal meteo-proposal"><div><CheckCircleOutline /><div><strong>Ready to submit</strong><p>{summary}</p><p>{locationLabel || 'Selected location'} · {proposal.point.latitude}, {proposal.point.longitude}</p><p>Dates (UTC): {proposal.startDate} → {proposal.endDate}</p><p>Variables: {proposal.variables.map(describe).join(', ')} · Source: NASA Giovanni (nearest grid cell)</p></div></div>
        <div className="meteo-controls"><Button size="small" endIcon={<ExpandMore />} onClick={() => setShowRequest(value => !value)}>{showRequest ? 'Hide request' : 'Review request'}</Button>
          <Button variant="contained" disabled={busy} onClick={() => void execute()}>{busy ? 'Working…' : 'Submit request'}</Button></div>
        <Collapse in={showRequest}><div className="meteo-request-details"><pre>{JSON.stringify(proposal, null, 2)}</pre></div></Collapse>
      </div>}
      {results.map((result, index) => <MeteomaticsResponse key={`${result.requestedAt}-${index}`} result={result} />)}
      {busy && <div className="conversation-message assistant"><div className="typing-indicator"><CircularProgress size={14} /> Checking the request…</div></div>}
      {results.length > 0 && <SessionComparison sessionId={sessionId} sessions={sessions} ready={!executing} />}
      <div ref={threadEnd} />
    </div>}
    {error && <Alert severity="error" className="chat-alert">{error}</Alert>}
    {!submitted && <div className="chat-dock">
      <ChatComposer value={input} onChange={setInput} onSubmit={() => void send()} ariaLabel="Message the NASA Giovanni assistant" maxLength={2000} placeholder="Ask for NASA Earth data: what, where and when…"
        canSubmit={Boolean(input.trim() || selectedParameters.length) && !busy && !catalogBusy && loaded} tools={tools} actions={<>{catalogPicker}<DictationButton disabled={busy || !loaded} onTranscript={spoken => setInput(value => value ? `${value} ${spoken}` : spoken)} /></>} />
      {empty && <div className="chat-suggestions" aria-label="Suggested searches">{GIOVANNI_SEARCH_SUGGESTIONS.map(suggestion => <Chip key={suggestion} label={suggestion} title={suggestion} variant="outlined" clickable onClick={() => setInput(suggestion)} disabled={busy || !loaded} />)}</div>}
      <span className="chat-disclaimer">NASA Giovanni access requires the server's Earthdata Login. Values are raw point time series at the nearest grid cell; this does not run the trend analysis.</span>
    </div>}
  </section>;
}
