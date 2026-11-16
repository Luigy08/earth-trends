import { useMemo, useState } from 'react';
import { FormControlLabel, MenuItem, Switch, TextField } from '@mui/material';
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SessionComparison } from '../../shared/types';
import { resolveComparisonRows } from '../comparison.resolver';
import type { ComparisonView } from '../comparison.types';
import { COLORS, FONTS } from '../theme.constant';

const formatNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value).replace(/^-(0(\.0+)?)$/, '$1');
const tick = { fontFamily: FONTS.data, fontSize: 11 };

/** Both sessions' series superposed: blue for this session (A), amber for the compared session (B). */
export function ComparisonChart({ comparison }: { comparison: SessionComparison }) {
  const [view, setView] = useState<ComparisonView>('monthly');
  const [standardized, setStandardized] = useState(false);
  const [showTrend, setShowTrend] = useState(true);
  const rows = useMemo(() => resolveComparisonRows(comparison, view, standardized, showTrend), [comparison, view, standardized, showTrend]);
  const { a, b } = comparison;
  if (!rows.length) return <p>Neither session has valid values to plot at this resolution.</p>;
  const start = rows[0]!.time; const end = rows.at(-1)!.time;
  const annualSuffix = (series: typeof a) => view === 'annual' && series.aggregation === 'sum' ? ', annual total' : view === 'annual' ? ', annual mean' : '';
  const nameA = `A · ${a.label} (${standardized ? 'z-score' : `${a.unit}${annualSuffix(a)}`})`;
  const nameB = `B · ${b.label} (${standardized ? 'z-score' : `${b.unit}${annualSuffix(b)}`})`;
  const dualAxis = !standardized;
  const trendAvailable = view === 'annual' && !standardized && Boolean(a.trend || b.trend);

  return <section className="meteo-chart" aria-label="Comparison chart of both sessions">
    <h4>Both datasets over time</h4>
    <TextField select label="Time resolution" size="small" value={view} onChange={event => setView(event.target.value as ComparisonView)} sx={{ minWidth: 160, mt: 1, mr: 2 }}>
      <MenuItem value="monthly">Monthly</MenuItem><MenuItem value="annual">Annual (complete years)</MenuItem>
    </TextField>
    <FormControlLabel sx={{ mt: 1 }} control={<Switch checked={standardized} onChange={event => setStandardized(event.target.checked)} />} label="Standardized (z-scores)" />
    {trendAvailable && <FormControlLabel sx={{ mt: 1 }} control={<Switch checked={showTrend} onChange={event => setShowTrend(event.target.checked)} />} label="Show trends" />}
    <p>{standardized ? 'Each series is shown in standard deviations from its own mean, so their shapes can be compared on one axis.' : 'Each series keeps its own unit: A on the left axis, B on the right axis.'}</p>
    <div className="meteo-chart-plot">
      <ResponsiveContainer width="100%" height={420}>
        <ComposedChart data={rows} margin={{ top: 15, right: 10, bottom: 10, left: 5 }}>
          <CartesianGrid stroke={COLORS.slateLine} />
          <XAxis tick={tick} dataKey="time" type="number" domain={[start, end]} scale="time" tickFormatter={time => String(new Date(Number(time)).getUTCFullYear())} minTickGap={24} />
          <YAxis yAxisId="a" tick={tick} width={65} domain={['auto', 'auto']} stroke={dualAxis ? COLORS.chartBlue : undefined} />
          {dualAxis && <YAxis yAxisId="b" orientation="right" tick={tick} width={65} domain={['auto', 'auto']} stroke={COLORS.chartAmber} />}
          <Tooltip labelFormatter={value => new Date(Number(value)).toISOString().slice(0, view === 'monthly' ? 7 : 4)} formatter={(value, name) => [typeof value === 'number' ? formatNumber(value) : value, name]} />
          <Legend />
          <Line yAxisId="a" name={nameA} dataKey="a" type="linear" stroke={COLORS.chartBlue} strokeWidth={1.75} dot={view === 'annual' ? { r: 2.5 } : false} isAnimationActive={false} />
          <Line yAxisId={dualAxis ? 'b' : 'a'} name={nameB} dataKey="b" type="linear" stroke={COLORS.chartAmber} strokeWidth={1.75} dot={view === 'annual' ? { r: 2.5 } : false} isAnimationActive={false} />
          {trendAvailable && showTrend && a.trend && <Line yAxisId="a" name={`A trend (${formatNumber(a.trend.slopePerDecade)} per decade)`} dataKey="aTrend" stroke={COLORS.chartBlue} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} legendType="plainline" />}
          {trendAvailable && showTrend && b.trend && <Line yAxisId="b" name={`B trend (${formatNumber(b.trend.slopePerDecade)} per decade)`} dataKey="bTrend" stroke={COLORS.chartAmber} strokeDasharray="6 4" dot={false} connectNulls isAnimationActive={false} legendType="plainline" />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <p>Gaps mark months or years without valid data; nothing is interpolated. Trend lines use each session's own annual OLS fit.</p>
  </section>;
}
