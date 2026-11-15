import { useEffect, useRef, useState } from 'react';
import { Autocomplete, CircularProgress, TextField } from '@mui/material';
import { PlaceOutlined } from '@mui/icons-material';
import type { Location } from '../../shared/types';
import { isConfigured, searchLocations } from '../services/firebase';
import { COLORS } from '../theme.constant';

export function LocationSearch({ label, value, onChange }: { label: string; value: Location | null; onChange: (value: Location | null) => void }) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  useEffect(() => {
    const current = ++sequence.current;
    setError('');
    if (!isConfigured || query.trim().length < 2 || query === value?.name) { setOptions([]); setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try { const result = await searchLocations({ query: query.trim(), limit: 6 }); if (current === sequence.current) setOptions(result.locations); }
      catch { if (current === sequence.current) { setOptions([]); setError('Could not search locations. Please try again.'); } }
      finally { if (current === sequence.current) setLoading(false); }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, value?.name]);
  return <Autocomplete value={value} options={options} filterOptions={items => items} getOptionLabel={option => option.name} isOptionEqualToValue={(option, selected) => option.id === selected.id} onChange={(_, selected) => onChange(selected)} onInputChange={(_, input, reason) => { if (reason === 'input' && value && input !== value.name) onChange(null); setQuery(input); }} loading={loading} noOptionsText={!isConfigured ? 'Connect Firebase to search locations' : error || (query.length < 2 ? 'Enter at least 2 characters' : 'No matches. Try another city.')} renderOption={(props, option) => <li {...props} key={option.id}><PlaceOutlined fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /><span>{option.name}<small style={{ display: 'block', color: COLORS.sage600 }}>{option.country} · {option.latitude.toFixed(2)}°, {option.longitude.toFixed(2)}°</small></span></li>} renderInput={params => <TextField {...params} size="small" label={label} placeholder="Search and select a city" error={Boolean(error)} helperText={error || undefined} slotProps={{ input: { ...params.InputProps, endAdornment: <>{loading && <CircularProgress size={16} />}{params.InputProps.endAdornment}</> } }} />} />;
}
