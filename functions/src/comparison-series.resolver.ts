import type { Analysis, ComparableSeries, ComparableSeriesSummary, ConversationSession, EarthdataSessionState, GiovanniSessionState, MeteomaticsChartTrend, MeteomaticsSessionState, QueryExecuteResponse } from '../../shared/types';
import { resolveEarthdataChart } from './earthdata-chart.resolver';
import { resolveGiovanniChart } from './giovanni-chart.resolver';
import { resolveMeteomaticsChart } from './meteomatics-chart.resolver';

export type QuerySessionState = MeteomaticsSessionState | GiovanniSessionState | EarthdataSessionState;

/** Chart trends are not stored with a session; they are recomputed from the raw provider payload. */
export function withChartTrends(result: QueryExecuteResponse): QueryExecuteResponse {
  return result.provider === 'NASA Giovanni' ? { ...result, chartTrends: resolveGiovanniChart(result.result, result.request) }
    : result.provider === 'NASA AppEEARS' ? { ...result, chartTrends: resolveEarthdataChart(result.result, result.request) }
    : { ...result, chartTrends: resolveMeteomaticsChart(result.result, result.request) };
}

function span(series: Pick<ComparableSeries, 'monthly'>): Pick<ComparableSeriesSummary, 'firstYear' | 'lastYear' | 'validMonths'> {
  const valid = series.monthly.filter(point => point.value !== null && Number.isFinite(point.value));
  return { firstYear: valid[0]?.year ?? 0, lastYear: valid.at(-1)?.year ?? 0, validMonths: valid.length };
}

function variableName(parameter: string): string {
  const separator = parameter.lastIndexOf(':');
  return separator > 0 ? parameter.slice(0, separator) : parameter;
}

function unitOf(parameter: string): string {
  const separator = parameter.lastIndexOf(':');
  return separator > 0 ? parameter.slice(separator + 1) : '';
}

/** Every monthly series a query-chat session holds. Series without a monthly aggregation cannot be compared. */
export function querySessionSeries(session: ConversationSession, state: QuerySessionState | null): ComparableSeries[] {
  const results = (state?.results ?? []) as QueryExecuteResponse[];
  return results.flatMap((stored, index) => {
    const result = stored.chartTrends ? stored : withChartTrends(stored);
    return (result.chartTrends ?? []).flatMap((trend: MeteomaticsChartTrend): ComparableSeries[] => {
      if (!trend.monthly || !trend.aggregation) return [];
      const place = result.provider === 'NASA AppEEARS' ? '' : state?.locationLabel || `${trend.latitude.toFixed(2)}, ${trend.longitude.toFixed(2)}`;
      const series: ComparableSeries = {
        key: `${index}|${trend.parameter}|${trend.latitude},${trend.longitude}`,
        label: place ? `${variableName(trend.parameter)} · ${place}` : variableName(trend.parameter),
        unit: unitOf(trend.parameter), provider: result.provider, aggregation: trend.aggregation,
        firstYear: 0, lastYear: 0, validMonths: 0,
        sessionId: session.id, sessionTitle: session.title,
        monthly: trend.monthly, annual: trend.annual, trend: trend.trend, provenance: result.provenance,
      };
      return [{ ...series, ...span(series) }];
    });
  });
}

/** The location series of a finished trend analysis. */
export function analysisSessionSeries(session: ConversationSession, analysis: Analysis | null): ComparableSeries[] {
  if (!analysis?.result) return [];
  const metric = analysis.spec.metric;
  return analysis.result.locations.map(location => {
    const series: ComparableSeries = {
      key: `analysis|${location.location.id}|${location.period.startYear}`,
      label: `${metric === 'temperature' ? 'Mean temperature' : 'Precipitation'} · ${location.location.name}`,
      unit: metric === 'temperature' ? '°C' : 'mm/month', provider: location.source, aggregation: metric === 'temperature' ? 'mean' : 'sum',
      firstYear: 0, lastYear: 0, validMonths: 0,
      sessionId: session.id, sessionTitle: session.title,
      monthly: location.monthly, annual: location.annual, trend: location.trend, provenance: location.provenance,
    };
    return { ...series, ...span(series) };
  });
}

export function summarize({ key, label, unit, provider, aggregation, firstYear, lastYear, validMonths }: ComparableSeries): ComparableSeriesSummary {
  return { key, label, unit, provider, aggregation, firstYear, lastYear, validMonths };
}
