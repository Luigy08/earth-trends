import { useMemo, useState } from 'react';
import { Button, MenuItem, TextField } from '@mui/material';
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import type { QueryExecuteResponse } from '../../shared/types';
import { resolveMeteomaticsResult } from '../meteomatics-query.resolver';
import { COLORS, FONTS } from '../theme.constant';

const YEAR_MS = 31556952000;
const formatNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);

export function MeteomaticsChart({ result }: { result: QueryExecuteResponse }) {
  const [selected, setSelected] = useState('');
  const [view, setView] = useState('annual');
  const [showTrend, setShowTrend] = useState(true);
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
  const showFit = Boolean(fit && stats && view === 'daily' && showTrend);
  const aggregateAvailable = Boolean(analysis?.aggregation && analysis.monthly);
  const chartPoints = aggregateAvailable && view === 'annual' ? analysis!.annual.map(point => ({ time: Date.UTC(point.year, 0, 1), value: point.value })) : aggregateAvailable && view === 'monthly' ? analysis!.monthly!.flatMap(point => point.value === null ? [] : [{ time: Date.UTC(point.year, point.month - 1, 1), value: point.value }]) : points;
  const downloadSeries = () => {
    if (!analysis?.monthly) return;
    const rows = ['year,month,value', ...analysis.monthly.map(point => `${point.year},${point.month},${point.value ?? ''}`)];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${result.source === 'giovanni' || result.source === 'earthdata' ? result.source : 'meteomatics'}-monthly.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const annualLine = aggregateAvailable && view === 'annual' && stats && showTrend && analysis!.annual.length ? [analysis!.annual[0]!, analysis!.annual[analysis!.annual.length - 1]!].map(point => ({ time: Date.UTC(point.year, 0, 1), value: stats.intercept + stats.slopePerYear * point.year })) : [];
  const trendPoints = showFit && fit ? [start, end].map(time => ({ time, value: fit.intercept + fit.slopePerYear * (time - fit.origin) / YEAR_MS })) : [];
  return <section aria-label={`${result.provider} time series chart`} className="meteo-chart">
    <h4>Change over time</h4>
    {series.length > 1 && <TextField select label="Variable and location" size="small" value={key} onChange={event => setSelected(event.target.value)} fullWidth>{series.map(([name]) => <MenuItem key={name} value={name}>{name}</MenuItem>)}</TextField>}
    {aggregateAvailable && <><TextField select label="Time resolution" size="small" value={view} onChange={event => setView(event.target.value)} sx={{ minWidth: 160, mt: 1 }}><MenuItem value="annual">Annual</MenuItem><MenuItem value="monthly">Monthly</MenuItem><MenuItem value="daily">Daily</MenuItem></TextField><label style={{ marginLeft: 12 }}><input type="checkbox" checked={showTrend} onChange={event => setShowTrend(event.target.checked)} /> Show trend</label></>}
    <p>{aggregateAvailable ? `${view === 'annual' ? 'Annual' : view === 'monthly' ? 'Monthly' : 'Daily'} ${view === 'daily' ? 'observations' : analysis!.aggregation === 'sum' ? 'total' : 'mean'}` : 'Returned observations'} · {unit} · {chartPoints.length.toLocaleString('en-US')} valid points</p>
    {view === 'daily' && fit && <div className="meteo-chart-summary"><strong>Daily observations</strong><br />{showFit ? <>y = {formatNumber(fit.slopePerYear)} · t {fit.intercept < 0 ? '−' : '+'} {formatNumber(Math.abs(fit.intercept))}<br />t: years since {new Date(fit.origin).toISOString().slice(0, 10)}<br />Change per decade: {formatNumber(fit.slopePerYear * 10)} {unit}<br />R²: {fit.rSquared === null ? '—' : formatNumber(fit.rSquared)}<br /></> : null}Mean: {formatNumber(fit.mean)} {unit}<br />Maximum: {formatNumber(fit.maximum)} {unit}<br />n = {fit.count.toLocaleString('en-US')}</div>}
    <div className="meteo-chart-plot">
      <ResponsiveContainer width="100%" height={420}><ScatterChart margin={{ top: 15, right: 20, bottom: 10, left: 5 }}><CartesianGrid stroke={COLORS.slateLine} /><XAxis tick={{ fontFamily: FONTS.data, fontSize: 11 }} dataKey="time" type="number" domain={[start, end]} ticks={ticks} tickFormatter={time => String(new Date(Number(time)).getUTCFullYear())} minTickGap={24} /><ZAxis range={[12, 12]} /><YAxis tick={{ fontFamily: FONTS.data, fontSize: 11 }} dataKey="value" type="number" domain={['auto', 'auto']} width={65} /><Tooltip labelFormatter={value => new Date(Number(value)).toISOString().slice(0, 10)} formatter={(value, name) => [typeof value === 'number' ? formatNumber(value) : value, name]} /><Legend /><Scatter name={`${aggregateAvailable && view !== 'daily' ? view === 'annual' ? 'Annual values' : 'Monthly values' : 'Daily observations'} (${unit})`} data={chartPoints} fill={COLORS.chartBlue} fillOpacity={0.35} shape="circle" legendType="circle" />{annualLine.length > 0 && <Scatter name={`Annual trend (${unit}/year)`} data={annualLine} fill={COLORS.chartRed} line={{ stroke: COLORS.chartRed, strokeWidth: 2 }} shape={() => <g />} legendType="line" />}{showFit && fit && <Scatter name={`Daily linear fit (${formatNumber(fit.slopePerYear)} ${unit}/year)`} data={trendPoints} fill={COLORS.chartRed} line={{ stroke: COLORS.chartRed, strokeWidth: 2 }} shape={() => <g />} legendType="line" />}</ScatterChart></ResponsiveContainer>
    </div>
    {!aggregateAvailable && <p>Aggregation is unavailable for this parameter or request; only returned observations are shown.</p>}
    {aggregateAvailable && <p>Excluded incomplete years: {analysis!.excludedYears?.join(', ') || 'None'}. Anomalies {analysis!.annual.some(point => point.anomaly !== null) ? 'use the complete 1991–2020 baseline.' : 'are unavailable because the 1991–2020 baseline is incomplete.'}</p>}
    {aggregateAvailable && <details><summary>Monthly coverage</summary><p>{result.source === 'earthdata' ? 'Each month is the mean of its valid satellite observations. Empty cells indicate months without valid data.' : 'Only complete months are included. Empty cells indicate incomplete or missing data.'}</p><div className="meteo-response-table-wrap"><table><thead><tr><th>Year</th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{i + 1}</th>)}</tr></thead><tbody>{Array.from(new Set(analysis!.monthly!.map(point => point.year))).map(year => <tr key={year}><th>{year}</th>{analysis!.monthly!.filter(point => point.year === year).map(point => <td key={point.month}>{point.value === null ? '—' : formatNumber(point.value)}</td>)}</tr>)}</tbody></table></div><Button size="small" onClick={downloadSeries}>Download monthly CSV</Button></details>}
    {stats && aggregateAvailable ? <p>Annual inference: {formatNumber(stats.slopePerDecade)} {unit}/decade; 95% CI {stats.confidenceInterval95PerDecade.map(formatNumber).join(' to ')}; p = {formatNumber(stats.pValue)} (OLS, Newey–West). {stats.significant ? 'Statistically significant at 0.05.' : 'Not statistically significant at 0.05.'} {analysis?.annual.length} complete years of {analysis?.requestedYears} requested.</p> : <p>The trend line is unavailable: at least 10 complete years and 80% coverage are required for this {result.source === 'earthdata' ? 'department-average' : 'point-based daily'} series.</p>}
    <p>Daily and annual fits use different observations and may differ. A trend does not establish causation.</p>
  </section>;
}
