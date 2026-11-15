import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Chip, ToggleButton, ToggleButtonGroup, Tooltip } from '@mui/material';
import { CheckCircleOutline } from '@mui/icons-material';
import type { AnalysisSpec, ConversationMessage, HistoricalDataSource } from '../../shared/types';
import { EXAMPLE_QUERIES, HISTORICAL_SOURCE_OPTIONS } from '../app.constant';
import { ChatComposer, ChatGreeting } from './ChatComposer';
import { DictationButton } from './DictationButton';

export function ConversationWorkspace({ messages, proposal, busy, error, analysisBusy, sessionReady, onSend, onConfirm, tools, children }: { messages: ConversationMessage[]; proposal: AnalysisSpec | null; busy: boolean; error: string; analysisBusy: boolean; sessionReady: boolean; onSend: (message: string) => void; onConfirm: (spec: AnalysisSpec) => void; tools?: ReactNode; children?: ReactNode }) {
  const [input, setInput] = useState('');
  const [dataSource, setDataSource] = useState<HistoricalDataSource>('meteomatics');
  const threadEnd = useRef<HTMLDivElement>(null);
  const empty = messages.length === 0 && !proposal && !children;
  useEffect(() => { if (!empty) threadEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy, empty]);
  const send = () => {
    const message = input.trim();
    if (!message || busy) return;
    onSend(message); setInput('');
  };

  const voice = <DictationButton disabled={!sessionReady || busy} onTranscript={spoken => setInput(value => value ? `${value} ${spoken}` : spoken)} />;

  return <section className={`chat-workspace ${empty ? 'is-empty' : ''}`} aria-label="Climate question assistant">
    {empty && <ChatGreeting />}
    {!empty && <div className="chat-thread" aria-live="polite">
      {messages.map(message => <div className={`conversation-message ${message.role}`} key={message.id}><div>{message.content}</div></div>)}
      {busy && <div className="conversation-message assistant"><div className="typing-indicator">Thinking through the request…</div></div>}
      {proposal && <div className="analysis-proposal"><div><CheckCircleOutline /><div><strong>Ready to analyze</strong><span>{proposal.metric === 'temperature' ? 'Temperature' : 'Precipitation'} · {proposal.locations.map(location => location.name).join(' & ')} · {proposal.startYear}–{proposal.endYear}</span></div></div><ToggleButtonGroup exclusive size="small" aria-label="Historical data source" value={dataSource} onChange={(_, value: HistoricalDataSource | null) => value && setDataSource(value)}>{HISTORICAL_SOURCE_OPTIONS.map(option => <Tooltip key={option.value} title={option.description}><ToggleButton value={option.value}>{option.label}</ToggleButton></Tooltip>)}</ToggleButtonGroup><Button variant="contained" disabled={analysisBusy || busy} onClick={() => onConfirm({ ...proposal, dataSource })}>{analysisBusy ? 'Submitting…' : 'Confirm and analyze'}</Button></div>}
      {children}
      <div ref={threadEnd} />
    </div>}
    {error && <Alert severity="error" className="chat-alert">{error}</Alert>}
    <div className="chat-dock">
      <ChatComposer value={input} onChange={setInput} onSubmit={send} ariaLabel="Message the climate assistant" maxLength={1500} disabled={!sessionReady || busy} canSubmit={sessionReady && !busy && Boolean(input.trim())}
        placeholder={sessionReady ? 'Ask about a place, a variable and a period…' : busy ? 'Connecting to your session…' : 'Session unavailable — check the backend connection'} tools={tools} actions={voice} />
      {empty && <div className="chat-suggestions" aria-label="Example questions">{EXAMPLE_QUERIES.map(example => <Chip key={example.label} clickable variant="outlined" label={example.label} onClick={() => setInput(example.query)} />)}</div>}
      <span className="chat-disclaimer">{sessionReady ? 'Trends use one source per analysis: Meteomatics daily aggregates or NASA Giovanni (MERRA-2) monthly means. Review the interpretation before analyzing.' : busy ? 'Connecting to Firebase session…' : 'Session unavailable · deploy the session Cloud Functions and reload'}</span>
    </div>
  </section>;
}
