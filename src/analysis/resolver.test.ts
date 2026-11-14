import { describe, expect, it } from 'vitest';
import type { Analysis, LocationAnalysis } from '../../shared/types';
import type { AnalysisDraft } from '../app.types';
import { buildAnalysisCsv, buildChartRows, csvCell, formatNumber, toSpec, validateDraft } from './resolver';

const location = { id: 'test-city', name: 'Ciudad de prueba', latitude: 14, longitude: -87 };
const draft: AnalysisDraft = { locations: [location, null], metric: 'temperature', startYear: 2020, endYear: 2020, comparisonMode: 'none' };
const series: LocationAnalysis = {
  location, period: { startYear: 2020, endYear: 2022 }, outcome: 'sufficient_data', unit: '°C',
  monthly: [{ year: 2020, month: 1, value: 22 }, { year: 2020, month: 2, value: null }],
  annual: [{ year: 2020, value: 22, anomaly: 1 }, { year: 2022, value: 24, anomaly: 3 }],
  trend: { method: 'OLS-Newey-West', slopePerYear: 1, slopePerDecade: 10, intercept: -1998, confidenceInterval95PerDecade: [9, 11], pValue: .01, significant: true, sampleSize: 2, lag: 0, rSquared: 1 },
  quality: { requestedYears: 3, completeYears: 2, coverage: 2 / 3, excludedYears: [2021], baselineYears: 30, warnings: [] },
  baseline: { startYear: 1991, endYear: 2020, mean: 21 }, source: 'NASA POWER', provenance: null,
  currentWeather: { status: 'disabled', observedAt: null, temperatureC: null, precipitationMm: null, provenance: null, notice: '' },
};

describe('scientific request validation', () => {
  it('allows one year for an insufficient-data scientific outcome', () => expect(validateDraft(draft)).toBeNull());
  it('requires explicitly selected, distinct locations', () => {
    expect(validateDraft({ ...draft, locations: [null] })).toMatch(/explicitly/);
    expect(validateDraft({ ...draft, comparisonMode: 'locations', locations: [location, location] })).toMatch(/diferentes/);
  });
  it('validates both periods and reversed or incomplete years', () => {
    expect(validateDraft({ ...draft, endYear: 2019 })).toMatch(/posterior/);
    expect(validateDraft({ ...draft, startYear: NaN })).toMatch(/completos/);
    expect(validateDraft({ ...draft, comparisonMode: 'periods' })).toMatch(/completos/);
    expect(validateDraft({ ...draft, comparisonMode: 'periods', secondPeriod: { startYear: 2010, endYear: 2010 } })).toBeNull();
  });
  it('sends only selected parameters appropriate to comparison mode', () => {
    const spec = toSpec({ ...draft, secondPeriod: { startYear: 2010, endYear: 2020 } });
    expect(spec.locations).toEqual([location]); expect(spec.secondPeriod).toBeUndefined();
    expect(Object.hasOwn(spec, 'secondPeriod')).toBe(false);
  });
});

describe('observations and fitted trends', () => {
  it('preserves missing years as gaps instead of interpolating', () => {
    const rows = buildChartRows([series], 'annual');
    expect(rows).toHaveLength(3); expect(rows[1].series0).toBeNull();
    expect(rows[0].trend0).toBe(22); expect(rows[2].trend0).toBe(24);
  });
  it('subtracts the actual baseline from the fitted anomaly line', () => {
    expect(buildChartRows([series], 'anomaly')[0].trend0).toBe(1);
    const unavailable = { ...series, baseline: { ...series.baseline, mean: null }, annual: [{ year: 2020, value: 22, anomaly: null }] };
    expect(buildChartRows([unavailable], 'anomaly')[0].trend0).toBeUndefined();
  });
  it('does not invent a trend when inference is unavailable', () => {
    expect(buildChartRows([{ ...series, trend: null }], 'annual')[0].trend0).toBeUndefined();
  });
  it('preserves monthly nulls and does not overlay annual trends on monthly data', () => {
    const rows = buildChartRows([series], 'monthly');
    expect(rows[0].series0).toBe(22); expect(rows[1].series0).toBeNull(); expect(rows[0].trend0).toBeUndefined();
  });
});

describe('honest and safe exports', () => {
  it('escapes CSV cells, quotes and spreadsheet formula prefixes', () => {
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"'); expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell(-1.2)).toBe('"-1.2"'); expect(csvCell(null)).toBe('""');
  });
  it('uses mm/month for normalized monthly precipitation and mm/year for annual data', () => {
    const analysis: Analysis = { id: 'test', ownerId: 'test', spec: { ...toSpec(draft), metric: 'precipitation' }, status: 'completed', createdAt: '', updatedAt: '', result: { outcome: 'sufficient_data', locations: [{ ...series, unit: 'mm/year' }], commonYears: [], comparison: null, narrative: '', warnings: [], methodologyVersion: 'test' } };
    const csv = buildAnalysisCsv(analysis);
    expect(csv).toContain('"mensual","2020","1","precipitation","22","mm/month"');
    expect(csv).toContain('"anual","2020","","precipitation","22","mm/year"');
  });
  it('never displays nonfinite or missing values as statistics', () => {
    expect(formatNumber(null)).toBe('—'); expect(formatNumber(Infinity)).toBe('—'); expect(formatNumber(NaN)).toBe('—');
  });
});
