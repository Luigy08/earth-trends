import { useMemo, useState } from 'react';
import { MenuItem, TextField } from '@mui/material';
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import type { MeteomaticsExecuteResponse } from '../../shared/types';
import { resolveMeteomaticsResult } from '../meteomatics-query.resolver';
import { COLORS, FONTS } from '../theme.constant';

const YEAR_MS = 31556952000;
const formatNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);

export function MeteomaticsChart({ result }: { result: MeteomaticsExecuteResponse }) {
  const [selected, setSelected] = useState('');
  const series = useMemo(() => {
    const rows = resolveMeteomaticsResult(result.result, Infinity)?.rows ?? [];
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.parameter} · ${row.latitude ?? '—'}, ${row.longitude ?? '—'}`;
      const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
    }
    return [...groups.entries()];
  }, [result]);
  if (!series.length) return null;
  const [key, rows] = series.find(([name]) => name === selected) ?? series[0]!;
  const first = rows[0]!;
  const analysis = result.chartTrends?.find(item => item.parameter === first.parameter && item.latitude === first.latitude && item.longitude === first.longitude);
  const points = rows.flatMap(row => {
    const time = Date.parse(row.date);
    return Number.isFinite(time) && typeof row.value === 'number' && Number.isFinite(row.value) && ![-999, -888, -777, -666].includes(row.value)
      ? [{ time, value: row.value }] : [];
  }).sort((a, b) => a.time - b.time);
  const fit = analysis?.dailyFit;
  const stats = analysis?.trend;
  const unit = first.parameter.split(':').at(-1) ?? '';
  if (!points.length) return <p>No numeric observations are available to plot.</p>;
  const start = points[0]!.time; const end = points[points.length - 1]!.time;
  const firstYear = new Date(start).getUTCFullYear(); const lastYear = new Date(end).getUTCFullYear();
  const ticks = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => Date.UTC(firstYear + index, 0, 1)).filter(time => time >= start && time <= end);
  const showFit = Boolean(fit && stats);
  const trendPoints = showFit && fit ? [start, end].map(time => ({ time, value: fit.intercept + fit.slopePerYear * (time - fit.origin) / YEAR_MS })) : [];
  return <section aria-label="Meteomatics time series chart" className="meteo-chart">
    <h4>Change over time</h4>
    {series.length > 1 && <TextField select label="Variable and location" size="small" value={key} onChange={event => setSelected(event.target.value)} fullWidth>{series.map(([name]) => <MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField>}
    <p>{analysis ? 'Daily observations' : 'Returned observations'} · {unit} · {points.length.toLocaleString('en-US')} valid points</p>
    {fit && <div className="meteo-chart-summary"><strong>Daily observations</strong><br />{showFit ? <>y = {formatNumber(fit.slopePerYear)} · t {fit.intercept < 0 ? '−' : '+'} {formatNumber(Math.abs(fit.intercept))}<br />t: years since {new Date(fit.origin).toISOString().slice(0, 10)}<br />Change per decade: {formatNumber(fit.slopePerYear * 10)} {unit}<br />R²: {fit.rSquared === null ? '—' : formatNumber(fit.rSquared)}<br /></> : null}Mean: {formatNumber(fit.mean)} {unit}<br />Maximum: {formatNumber(fit.maximum)} {unit}<br />n = {fit.count.toLocaleString('en-US')}</div>}
    <div className="meteo-chart-plot">
      <ResponsiveContainer width="100%" height={420}><ScatterChart margin={{ top: 15, right: 20, bottom: 10, left: 5 }}><CartesianGrid stroke={COLORS.slateLine} /><XAxis tick={{ fontFamily: FONTS.data, fontSize: 11 }} dataKey="time" type="number" domain={[start, end]} ticks={ticks} tickFormatter={time => String(new Date(Number(time)).getUTCFullYear())} minTickGap={24} /><ZAxis range={[12, 12]} /><YAxis tick={{ fontFamily: FONTS.data, fontSize: 11 }} dataKey="value" type="number" domain={['auto', 'auto']} width={65} /><Tooltip labelFormatter={value => new Date(Number(value)).toISOString().slice(0, 10)} formatter={(value, name) => [typeof value === 'number' ? formatNumber(value) : value, name]} /><Legend /><Scatter name={`Daily observations (${unit})`} data={points} fill={COLORS.chartBlue} fillOpacity={0.35} shape="circle" legendType="circle" />{showFit && fit && <Scatter name={`Daily linear fit (${formatNumber(fit.slopePerYear)} ${unit}/year)`} data={trendPoints} fill={COLORS.chartRed} line={{ stroke: COLORS.chartRed, strokeWidth: 2 }} shape={() => <g />} legendType="line" />}</ScatterChart></ResponsiveContainer>
    </div>
    {stats ? <p>The red line is a descriptive fit to daily samples. Annual inference uses complete-year means: {formatNumber(stats.slopePerDecade)} {unit}/decade; 95% CI {stats.confidenceInterval95PerDecade.map(formatNumber).join(' to ')}; p = {formatNumber(stats.pValue)} (OLS, Newey–West). {stats.significant ? 'Statistically significant at 0.05.' : 'Not statistically significant at 0.05.'} {analysis?.annual.length} complete years of {analysis?.requestedYears} requested.</p> : <p>The trend line is unavailable: at least 10 complete years and 80% coverage are required for this point-based daily series.</p>}
    <p>Daily and annual fits use different observations and may differ. A trend does not establish causation.</p>
  </section>;
}
