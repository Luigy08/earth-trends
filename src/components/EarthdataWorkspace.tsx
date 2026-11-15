import ReactMarkdown from 'react-markdown';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Autocomplete, Badge, Button, Chip, CircularProgress, Collapse, IconButton, Popover, TextField, Tooltip } from '@mui/material';
import { CheckCircleOutline, ExpandMore, TuneOutlined } from '@mui/icons-material';
import type { ConversationSession, EarthdataCatalogResponse, EarthdataExecuteResponse, EarthdataQuerySpec, EarthdataSessionState } from '../../shared/types';
import { EARTHDATA_LIMITS, EARTHDATA_SEARCH_SUGGESTIONS } from '../../shared/earthdata-catalog.constant';
import { executeEarthdataQuery, getEarthdataCatalog, interpretEarthdata } from '../services/firebase';
import { useQuerySession } from '../analysis/useQuerySession';
import { MeteomaticsResponse } from './MeteomaticsResponse';
import { ChatComposer, ChatGreeting } from './ChatComposer';
import { DictationButton } from './DictationButton';

type ChatLine = { role: 'user' | 'assistant'; content: string };
const errorText = (cause: unknown) => {
  const code = cause !== null && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
  const message = cause instanceof Error ? cause.message : '';
  if (/functions\/internal|functions\/not-found|internal \[0\]/i.test(`${code} ${message}`)) {
    return 'The NASA Earthdata Functions are not available in this Firebase project or region. Deploy getEarthdataCatalog, interpretEarthdata, and executeEarthdataQuery.';
  }
  return message && message !== 'unavailable' ? message : 'The NASA Earthdata store is unavailable. Please try again.';
};

/** Chat workflow for stored NASA AppEEARS zonal series; mirrors the Giovanni workspace. */
export function EarthdataWorkspace({ sessionId, onSessionUpdated, tools }: { sessionId: string; onSessionUpdated: (session: ConversationSession) => void; tools?: ReactNode }) {
  const threadEnd = useRef<HTMLDivElement>(null);
  const [catalogAnchor, setCatalogAnchor] = useState<HTMLElement | null>(null);
  const [catalog, setCatalog] = useState<EarthdataCatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [selectedParameters, setSelectedParameters] = useState<string[]>([]);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<EarthdataQuerySpec | null>(null);
  const [results, setResults] = useState<EarthdataExecuteResponse[]>([]);
  const [showRequest, setShowRequest] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [summary, setSummary] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const variables = useMemo(() => catalog?.variables ?? [], [catalog]);
  const zones = useMemo(() => catalog?.zones ?? [], [catalog]);
  const describeVariable = (id: string) => variables.find(option => option.id === id)?.description ?? id;
  const describeZone = (id: string) => zones.find(option => option.id === id)?.name ?? id;
  const coverage = (id: string) => {
    const variable = variables.find(option => option.id === id);
    const state = variable?.stored ? `${variable.stored.firstDate} → ${variable.stored.lastDate}` : 'not stored yet';
    return `${describeVariable(id)}: ${state}${variable?.ingesting ? ' (NASA is processing a request)' : ''}`;
  };
  const selectedCount = selectedParameters.length + selectedZones.length;

  useEffect(() => {
    void getEarthdataCatalog().then(setCatalog).catch(cause => setCatalogError(errorText(cause))).finally(() => setCatalogBusy(false));
  }, []);

  const sessionState = useMemo<EarthdataSessionState | null>(() => messages.length === 0 ? null
    : { messages, proposal, results, suggestions, summary, locationLabel, selectedParameters, selectedZones },
  [messages, proposal, results, suggestions, summary, locationLabel, selectedParameters, selectedZones]);
  const loaded = useQuerySession(sessionId, 'earthdata', sessionState, state => {
    setMessages(state.messages); setProposal(state.proposal); setResults(state.results ?? []);
    setSuggestions(state.suggestions); setSummary(state.summary); setLocationLabel(state.locationLabel);
    setSelectedParameters(state.selectedParameters ?? []); setSelectedZones(state.selectedZones ?? []);
  }, onSessionUpdated, setError);

  const send = async () => {
    const picked = [selectedParameters.length ? `variables: ${selectedParameters.join(', ')}` : '', selectedZones.length ? `departments: ${selectedZones.join(', ')}` : ''].filter(Boolean).join('; ');
    const message = input.trim() || (picked ? `Use these selected ${picked}.` : '');
    if (!message || busy) return;
    setBusy(true); setError(''); setSuggestions([]); setSummary(''); setProposal(null); setInput('');
    const history = [...messages, { role: 'user' as const, content: message }];
    setMessages(history);
    try {
      const prompt = `${history.slice(-8).map(line => `${line.role}: ${line.content}`).join('\n')}\nSelected catalog variables: ${selectedParameters.join(', ') || 'none'}\nSelected zones: ${selectedZones.join(', ') || 'none'}`;
      const interpreted = await interpretEarthdata({ query: prompt });
      const optional = interpreted.suggestions?.length ? `\n\n**Optional suggestions**\n\n${interpreted.suggestions.map(item => `- ${item}`).join('\n')}` : '';
      setSummary(interpreted.summary);
      setLocationLabel(interpreted.locationLabel ?? '');
      if (interpreted.status === 'needs_clarification' || !interpreted.spec) {
        setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Information needed**\n\n${interpreted.clarificationQuestions.map(question => `- ${question}`).join('\n')}${optional}` }]);
        return;
      }
      setProposal(interpreted.spec);
      setMessages(lines => [...lines, { role: 'assistant', content: `**Identified**\n\n${interpreted.summary}\n\n**Ready to review**\n\nYour required details are complete. Submit when ready; the values come from the project store. Anything missing is requested from NASA AppEEARS when you submit, and arrives within hours.${optional}` }]);
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };

  const execute = async () => {
    if (!proposal || busy) return;
    setBusy(true); setError('');
    try {
      const response = await executeEarthdataQuery({ spec: proposal, confirmed: true });
      setResults(items => [...items, response]);
    }
    catch (cause) { setError(errorText(cause)); }
    finally {
      setBusy(false);
      // Running a query can start a NASA request, so the stored coverage and its status are read again.
      void getEarthdataCatalog().then(setCatalog).catch(() => undefined);
    }
  };

  const empty = messages.length === 0 && results.length === 0 && !proposal;
  useEffect(() => { if (!empty) threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, results, busy, empty]);
  const catalogPicker = <><Tooltip title="Browse NASA Earthdata variables and departments"><span><IconButton size="small" aria-label="Browse NASA Earthdata variables and departments" disabled={!loaded} onClick={event => setCatalogAnchor(event.currentTarget)}><Badge color="secondary" badgeContent={selectedCount} invisible={!selectedCount}><TuneOutlined fontSize="small" /></Badge></IconButton></span></Tooltip>
    <Popover open={Boolean(catalogAnchor)} anchorEl={catalogAnchor} onClose={() => setCatalogAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }} transformOrigin={{ vertical: 'bottom', horizontal: 'right' }} slotProps={{ paper: { className: 'catalog-popover' } }}>
      {catalogError && <Alert severity="warning" sx={{ mb: 1.5 }}>The catalog could not be loaded: {catalogError}</Alert>}
      <Autocomplete multiple options={variables} groupBy={option => option.domain} value={variables.filter(option => selectedParameters.includes(option.id))}
        getOptionLabel={option => option.description} loading={catalogBusy} onChange={(_, selected) => setSelectedParameters(selected.slice(0, EARTHDATA_LIMITS.maxVariables).map(option => option.id))}
        renderInput={params => <TextField {...params} autoFocus label="NASA satellite variables" placeholder="Variable name" helperText={catalog ? `Optional · up to ${EARTHDATA_LIMITS.maxVariables} · ${catalog.variables.length} stored variables` : catalogBusy ? 'Loading catalog…' : 'Catalog unavailable; check Firebase Functions.'} />}
        renderOption={(props, option) => <li {...props} key={option.id}><span><strong>{option.description}</strong><br />{option.dataset} · {option.temporalResolution} · {option.unit} · {option.stored ? `stored ${option.stored.firstDate} → ${option.stored.lastDate}` : 'not stored yet'}{option.ingesting ? ' · NASA is processing a request' : ''}</span></li>} />
      <Autocomplete multiple options={zones} value={zones.filter(option => selectedZones.includes(option.id))} sx={{ mt: 2 }}
        getOptionLabel={option => option.name} loading={catalogBusy} onChange={(_, selected) => setSelectedZones(selected.slice(0, EARTHDATA_LIMITS.maxZones).map(option => option.id))}
        renderInput={params => <TextField {...params} label="Departments of Honduras" placeholder="Department name" helperText={catalog ? `Optional · up to ${EARTHDATA_LIMITS.maxZones} · ${catalog.zones.length} departments` : ''} />}
        renderOption={(props, option) => <li {...props} key={option.id}><span><strong>{option.name}</strong> · {option.id}</span></li>} />
    </Popover></>;

  return <section className={`chat-workspace ${empty ? 'is-empty' : ''}`} aria-label="NASA Earthdata query assistant">
    {empty && <ChatGreeting />}
    {!empty && <div className="chat-thread" aria-live="polite">
      {messages.map((line, index) => <div className={`conversation-message ${line.role}`} key={`${index}-${line.role}`}><div>{line.role === 'assistant' ? <ReactMarkdown>{line.content}</ReactMarkdown> : line.content}</div></div>)}
      {suggestions.length > 0 && <Alert severity="info"><strong>Optional ways to refine your request</strong><ul>{suggestions.map(item => <li key={item}>{item}</li>)}</ul>These suggestions are optional.</Alert>}
      {proposal && <div className="analysis-proposal meteo-proposal"><div><CheckCircleOutline /><div><strong>Ready to submit</strong><p>{summary}</p><p>Departments: {locationLabel || proposal.zones.map(describeZone).join(', ')}</p><p>Dates: {proposal.startDate} → {proposal.endDate}</p><p>Variables: {proposal.variables.map(describeVariable).join(', ')} · Source: NASA AppEEARS (department average)</p><p>Stored coverage · {proposal.variables.map(coverage).join(' · ')}</p></div></div>
        <div className="meteo-controls"><Button size="small" endIcon={<ExpandMore />} onClick={() => setShowRequest(value => !value)}>{showRequest ? 'Hide request' : 'Review request'}</Button>
          <Button variant="contained" disabled={busy} onClick={() => void execute()}>{busy ? 'Working…' : 'Submit request'}</Button></div>
        <Collapse in={showRequest}><div className="meteo-request-details"><pre>{JSON.stringify(proposal, null, 2)}</pre></div></Collapse>
      </div>}
      {results.map((result, index) => <Fragment key={`${result.requestedAt}-${index}`}>
        {result.notices?.length ? <Alert severity="info"><strong>This series is incomplete for the requested period</strong><ul>{result.notices.map(item => <li key={item}>{item}</li>)}</ul>The values below are what is stored so far.</Alert> : null}
        <MeteomaticsResponse result={result} />
      </Fragment>)}
      {busy && <div className="conversation-message assistant"><div className="typing-indicator"><CircularProgress size={14} /> Checking the request…</div></div>}
      <div ref={threadEnd} />
    </div>}
    {error && <Alert severity="error" className="chat-alert">{error}</Alert>}
    <div className="chat-dock">
      <ChatComposer value={input} onChange={setInput} onSubmit={() => void send()} ariaLabel="Message the NASA Earthdata assistant" maxLength={2000} placeholder="Ask for NASA satellite data: what, which department and when…"
        canSubmit={Boolean(input.trim() || selectedCount) && !busy && !catalogBusy && loaded} tools={tools} actions={<>{catalogPicker}<DictationButton disabled={busy || !loaded} onTranscript={spoken => setInput(value => value ? `${value} ${spoken}` : spoken)} /></>} />
      {empty && <div className="chat-suggestions" aria-label="Suggested searches">{EARTHDATA_SEARCH_SUGGESTIONS.map(suggestion => <Chip key={suggestion} label={suggestion} title={suggestion} variant="outlined" clickable onClick={() => setInput(suggestion)} disabled={busy || !loaded} />)}</div>}
      <span className="chat-disclaimer">NASA Earthdata values are satellite averages over each department of Honduras, stored from NASA AppEEARS. Department boundaries © OpenStreetMap contributors (geoBoundaries, ODbL). This does not run the trend analysis.</span>
    </div>
  </section>;
}
