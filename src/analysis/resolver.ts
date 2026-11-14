import type { Analysis, AnalysisSpec, LocationAnalysis } from '../../shared/types';
import { MAX_YEAR, MONTHS } from '../app.constant';
import type { AnalysisDraft, ChartRow, ChartView } from '../app.types';

export function validateDraft(draft: AnalysisDraft): string | null {
  const count = draft.comparisonMode === 'locations' ? 2 : 1;
  if (draft.locations.slice(0, count).length !== count || draft.locations.slice(0, count).some(location => !location)) return 'Search for and explicitly select each location.';
  if (count === 2 && draft.locations[0]?.id === draft.locations[1]?.id) return 'Select two different locations.';
  const periods = [{ startYear: draft.startYear, endYear: draft.endYear }, ...(draft.comparisonMode === 'periods' ? [draft.secondPeriod] : [])];
  for (const period of periods) {
    if (!period || !Number.isInteger(period.startYear) || !Number.isInteger(period.endYear)) return 'Enter complete years for each time period.';
    if (period.startYear < 1981 || period.endYear > MAX_YEAR) return `Available years range from 1981 to ${MAX_YEAR}.`;
    if (period.endYear < period.startYear) return 'The end year must be the same as or later than the start year.';
  }
  return null;
}

export function toSpec(draft: AnalysisDraft): AnalysisSpec {
  const error = validateDraft(draft);
  if (error) throw new Error(error);
  return {
    metric: draft.metric,
    startYear: draft.startYear,
    endYear: draft.endYear,
    comparisonMode: draft.comparisonMode,
    locations: draft.locations.slice(0, draft.comparisonMode === 'locations' ? 2 : 1).filter(location => location !== null),
    ...(draft.comparisonMode === 'periods' ? { secondPeriod: draft.secondPeriod } : {}),
  };
}

export function formatNumber(value: number | null | undefined, digits = 2, signed = false): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits, signDisplay: signed ? 'exceptZero' : 'auto' }).format(value);
}

export function seriesLabel(item: LocationAnalysis, comparePeriods = false): string {
  return comparePeriods ? `${item.location.name} · ${item.period.startYear}–${item.period.endYear}` : item.location.name;
}

export function buildChartRows(locations: LocationAnalysis[], view: ChartView): ChartRow[] {
  const rows = new Map<string, ChartRow>();
  locations.forEach((location, index) => {
    for (let year = location.period.startYear; year <= location.period.endYear; year++) {
      if (view === 'monthly') {
        for (let month = 1; month <= 12; month++) {
          const key = `${year}-${String(month).padStart(2, '0')}`;
          const row = rows.get(key) ?? { label: key, display: `${MONTHS[month - 1]} ${year}` };
          row[`series${index}`] = null;
          rows.set(key, row);
        }
      } else {
        const key = String(year);
        const row = rows.get(key) ?? { label: key };
        row[`series${index}`] = null;
        rows.set(key, row);
      }
    }
    if (view === 'monthly') {
      location.monthly.forEach(point => {
        const key = `${point.year}-${String(point.month).padStart(2, '0')}`;
        const row = rows.get(key) ?? { label: key, display: `${MONTHS[point.month - 1]} ${point.year}` };
        row[`series${index}`] = point.value;
        rows.set(key, row);
      });
    } else {
      location.annual.forEach(point => {
        const key = String(point.year);
        const row = rows.get(key) ?? { label: key };
        row[`series${index}`] = view === 'anomaly' ? point.anomaly : point.value;
        if (location.trend && (view !== 'anomaly' || location.baseline.mean !== null)) {
          row[`trend${index}`] = location.trend.intercept + location.trend.slopePerYear * point.year - (view === 'anomaly' ? location.baseline.mean! : 0);
        }
        rows.set(key, row);
      });
    }
  });
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  const safe = /^[=+@\-\t\r]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildAnalysisCsv(analysis: Analysis): string {
  const rows: unknown[][] = [['Location', 'Latitude', 'Longitude', 'Period start', 'Period end', 'Resolution', 'Year', 'Month', 'Metric', 'Value', 'Unit', 'Anomaly', 'Trend per decade', '95% CI lower', '95% CI upper', 'p-value', 'Coverage', 'Scientific outcome', 'Source', 'Dataset', 'Source URL', 'Retrieved at']];
  analysis.result?.locations.forEach(item => {
    const append = (resolution: string, year: number, month: number | null, value: number | null, anomaly: number | null) => rows.push([item.location.name, item.location.latitude, item.location.longitude, item.period.startYear, item.period.endYear, resolution, year, month, analysis.spec.metric, value, resolution === 'monthly' && analysis.spec.metric === 'precipitation' ? 'mm/month' : item.unit, anomaly, item.trend?.slopePerDecade, item.trend?.confidenceInterval95PerDecade[0], item.trend?.confidenceInterval95PerDecade[1], item.trend?.pValue, item.quality.coverage, item.outcome, item.source, item.provenance?.dataset, item.provenance?.sourceUrl, item.provenance?.retrievedAt]);
    item.annual.forEach(point => append('annual', point.year, null, point.value, point.anomaly));
    item.monthly.forEach(point => append('monthly', point.year, point.month, point.value, null));
  });
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(analysis: Analysis) {
  const url = URL.createObjectURL(new Blob([buildAnalysisCsv(analysis)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url; link.download = `earth-trend-${analysis.id}.csv`; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (/unauthenticated|permission-denied/i.test(error.message)) return 'Could not verify your session. Check anonymous authentication and App Check.';
    if (/unavailable|network|fetch|internal/i.test(error.message)) return 'Could not connect to the service. Check your connection and try again.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
