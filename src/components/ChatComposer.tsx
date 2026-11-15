import type { ReactNode } from 'react';
import { IconButton, InputBase, Tooltip } from '@mui/material';
import { ArrowUpward } from '@mui/icons-material';
import { Globe } from './Globe';

export function ChatComposer({ value, onChange, onSubmit, placeholder, ariaLabel, maxLength, disabled, canSubmit, tools, actions }: { value: string; onChange: (value: string) => void; onSubmit: () => void; placeholder: string; ariaLabel: string; maxLength: number; disabled?: boolean; canSubmit: boolean; tools?: ReactNode; actions?: ReactNode }) {
  return <div className={`chat-composer ${disabled ? 'disabled' : ''}`}>
    <InputBase fullWidth multiline maxRows={8} value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (canSubmit) onSubmit(); } }}
      placeholder={placeholder} disabled={disabled} inputProps={{ 'aria-label': ariaLabel, maxLength }} />
    <div className="chat-composer-toolbar"><div className="chat-composer-tools">{tools}</div>
      <div className="chat-composer-actions">{actions}<Tooltip title="Send · Enter"><span><IconButton className="chat-send" aria-label="Send message" disabled={!canSubmit} onClick={onSubmit}><ArrowUpward fontSize="small" /></IconButton></span></Tooltip></div></div>
  </div>;
}

export function ChatGreeting() {
  return <><div className="chat-art"><Globe /></div><h1 className="chat-greeting">Climate changes.<br /><em>Ask the questions.</em></h1></>;
}
