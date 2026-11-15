import { useState } from 'react';
import { Button, ListItemText, Menu, MenuItem } from '@mui/material';
import { Check, ExpandMore } from '@mui/icons-material';
import type { QueryWorkflow } from '../app.types';
import { WORKFLOW_OPTIONS } from '../app.constant';

export function WorkflowSelect({ value, onChange, disabled }: { value: QueryWorkflow; onChange: (value: QueryWorkflow) => void; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const selected = WORKFLOW_OPTIONS.find(option => option.value === value) ?? WORKFLOW_OPTIONS[0];
  return <>
    <Button className="workflow-select" size="small" disabled={disabled} endIcon={<ExpandMore fontSize="small" />} aria-haspopup="menu" aria-label={`Query mode: ${selected.label}`} onClick={event => setAnchor(event.currentTarget)}>{selected.label}</Button>
    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} slotProps={{ paper: { className: 'workflow-menu' } }}>
      {WORKFLOW_OPTIONS.map(option => <MenuItem key={option.value} selected={option.value === value} onClick={() => { onChange(option.value); setAnchor(null); }}>
        <ListItemText primary={option.label} secondary={option.description} />{option.value === value && <Check fontSize="small" />}
      </MenuItem>)}
    </Menu>
  </>;
}
