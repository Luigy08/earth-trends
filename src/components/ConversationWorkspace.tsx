import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Chip, IconButton, TextField, Tooltip } from '@mui/material';
import { CheckCircleOutline, KeyboardVoiceOutlined, Send, StopCircleOutlined } from '@mui/icons-material';
import type { AnalysisSpec, ConversationMessage } from '../../shared/types';
import type { SpeechRecognitionLike, SpeechWindow } from '../app.types';
import { EXAMPLE_QUERIES } from '../app.constant';

export function ConversationWorkspace({ messages, proposal, busy, error, analysisBusy, sessionReady, onSend, onConfirm }: { messages: ConversationMessage[]; proposal: AnalysisSpec | null; busy: boolean; error: string; analysisBusy: boolean; sessionReady: boolean; onSend: (message: string) => void; onConfirm: (spec: AnalysisSpec) => void }) {
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }); }, [messages, busy]);
  useEffect(() => () => recognition.current?.stop(), []);
  const send = () => {
    const message = input.trim();
    if (!message || busy) return;
    onSend(message); setInput('');
  };
  const toggleVoice = () => {
    if (listening) { recognition.current?.stop(); setListening(false); return; }
    const browser = window as SpeechWindow;
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) return;
    const instance = new Constructor();
    recognition.current = instance; instance.lang = 'en-US'; instance.interimResults = false;
    instance.onresult = event => {
      const spoken = Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' ').trim();
      setInput(value => value ? `${value} ${spoken}` : spoken);
    };
    instance.onerror = () => setListening(false);
    instance.onend = () => setListening(false);
    setListening(true); instance.start();
  };

  return <section className="conversation-workspace" aria-label="Climate question assistant">
    <div className="conversation-heading"><div><span className="eyebrow">YOUR CLIMATE QUESTION</span><h2>Let’s shape the question together.</h2></div><span className="assistant-status"><i />AI assistant</span></div>
    <div className="conversation-transcript" ref={transcript} aria-live="polite">
      {messages.length === 0 && <div className="assistant-message"><span className="assistant-mark">✳</span><div><strong>What would you like to investigate?</strong><p>Tell me a place, a climate variable, and a time period. I’ll help fill in what’s missing before we calculate anything.</p></div></div>}
      {messages.map(message => <div className={`conversation-message ${message.role}`} key={message.id}><div>{message.content}</div></div>)}
      {busy && <div className="conversation-message assistant"><div className="typing-indicator">Thinking through the request…</div></div>}
      {proposal && <div className="analysis-proposal"><div><CheckCircleOutline /><div><strong>Ready to analyze</strong><span>{proposal.metric === 'temperature' ? 'Temperature' : 'Precipitation'} · {proposal.locations.map(location => location.name).join(' & ')} · {proposal.startYear}–{proposal.endYear}</span></div></div><Button variant="contained" disabled={analysisBusy || busy} onClick={() => onConfirm(proposal)}>{analysisBusy ? 'Submitting…' : 'Confirm and analyze'}</Button></div>}
      {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
    </div>
    {messages.length === 0 && <div className="conversation-suggestions" aria-label="Example questions">{EXAMPLE_QUERIES.map(example => <Chip key={example.label} clickable label={example.label} onClick={() => setInput(example.query)} />)}</div>}
    <div className="composer"><TextField fullWidth multiline maxRows={4} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={sessionReady ? 'Describe the climate question you want to explore…' : busy ? 'Connecting to your session…' : 'Session unavailable — check Firebase Functions'} aria-label="Message the climate assistant" disabled={!sessionReady || busy} slotProps={{ htmlInput: { maxLength: 1500 } }} /><Tooltip title={listening ? 'Stop dictation' : 'Dictate your question'}><span><IconButton aria-label={listening ? 'Stop dictation' : 'Start dictation'} onClick={toggleVoice} disabled={!sessionReady || busy || (!listening && !((window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition))}>{listening ? <StopCircleOutlined /> : <KeyboardVoiceOutlined />}</IconButton></span></Tooltip><Button variant="contained" aria-label="Send message" disabled={!sessionReady || !input.trim() || busy} onClick={send}><Send /></Button></div>
    <span className="composer-hint">{sessionReady ? 'Enter to send · Shift + Enter for a new line' : busy ? 'Connecting to Firebase session…' : 'Session unavailable · deploy the session Cloud Functions and reload'}</span>
  </section>;
}
