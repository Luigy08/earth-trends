import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import type { Analysis } from '../../shared/types';
import { formatNumber, seriesLabel } from '../analysis/resolver';

export function NumericSummary({ analysis }: { analysis: Analysis }) {
  const result = analysis.result;
  if (!result) return null;
  const unit = analysis.spec.metric === 'temperature' ? '°C' : 'mm/year';
  return <section className="numeric-summary" aria-label="Verifiable numeric summary">
    <span className="eyebrow">NUMERIC EVIDENCE · {unit}</span>
    <TableContainer><Table size="small" aria-label="Statistics by location and time period">
      <TableHead><TableRow><TableCell>Location / period</TableCell><TableCell>Mean</TableCell><TableCell>Trend / decade</TableCell><TableCell>95% CI / decade</TableCell><TableCell>p-value</TableCell><TableCell>Years / coverage</TableCell></TableRow></TableHead>
      <TableBody>{result.locations.map((item, index) => <TableRow key={index}>
        <TableCell>{seriesLabel(item, analysis.spec.comparisonMode === 'periods')}<small>{item.period.startYear}–{item.period.endYear}</small></TableCell>
        <TableCell>{formatNumber(item.annual.length ? item.annual.reduce((sum, point) => sum + point.value, 0) / item.annual.length : null)}</TableCell>
        <TableCell>{formatNumber(item.trend?.slopePerDecade, 3, true)}</TableCell>
        <TableCell>{item.trend ? `[${formatNumber(item.trend.confidenceInterval95PerDecade[0], 3)}, ${formatNumber(item.trend.confidenceInterval95PerDecade[1], 3)}]` : 'Not inferred'}</TableCell>
        <TableCell>{item.trend ? item.trend.pValue < .001 ? '< 0,001' : formatNumber(item.trend.pValue, 3) : '—'}</TableCell>
        <TableCell>{item.quality.completeYears} / {item.quality.requestedYears}<small>{formatNumber(item.quality.coverage * 100, 0)} %</small></TableCell>
      </TableRow>)}</TableBody>
    </Table></TableContainer>
    {result.comparison && <div className="comparison-summary">
      <div><span>Difference in means</span><strong>{formatNumber(result.comparison.meanDifference, 3, true)}<small>{unit}</small></strong>{result.comparison.meanDifference === null && <small>Insufficient data to compare</small>}</div>
      <div><span>Difference in slopes</span><strong>{formatNumber(result.comparison.slopeDifferencePerDecade, 3, true)}<small>{unit}/decade</small></strong>{result.comparison.slopeDifferencePerDecade === null && <small>At least one series could not be inferred</small>}</div>
      <p>{result.comparison.mode === 'locations' ? 'Second location − first. Means use common complete years.' : 'Second period − first. Each period is assessed independently.'} These are descriptive differences, not a significance test of the difference.</p>
    </div>}
  </section>;
}
