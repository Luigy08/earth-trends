import { useEffect, useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { KeyboardVoiceOutlined, StopCircleOutlined } from '@mui/icons-material';
import type { SpeechRecognitionLike, SpeechWindow } from '../app.types';
import { useVoiceLevel } from '../speech/useVoiceLevel';

export function DictationButton({ onTranscript, disabled }: { onTranscript: (spoken: string) => void; disabled?: boolean }) {
  const [listening, setListening] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  useEffect(() => () => recognition.current?.stop(), []);
  useVoiceLevel(listening);
  const browser = window as SpeechWindow;
  const available = Boolean(browser.SpeechRecognition || browser.webkitSpeechRecognition);
  const toggle = () => {
    if (listening) { recognition.current?.stop(); setListening(false); return; }
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) return;
    const instance = new Constructor();
    recognition.current = instance; instance.lang = 'en-US'; instance.interimResults = false;
    instance.onresult = event => {
      const spoken = Array.from(event.results).map(result => result[0]?.transcript ?? '').join(' ').trim();
      if (spoken) onTranscript(spoken);
    };
    instance.onerror = () => setListening(false);
    instance.onend = () => setListening(false);
    setListening(true); instance.start();
  };
  const title = !available ? 'Dictation is not supported in this browser' : listening ? 'Stop dictation' : 'Dictate your message';
  return <Tooltip title={title}><span><IconButton size="small" className={listening ? 'dictation-active' : undefined} aria-label={listening ? 'Stop dictation' : 'Start dictation'} onClick={toggle} disabled={(disabled && !listening) || (!listening && !available)}>{listening ? <StopCircleOutlined fontSize="small" /> : <KeyboardVoiceOutlined fontSize="small" />}</IconButton></span></Tooltip>;
}
