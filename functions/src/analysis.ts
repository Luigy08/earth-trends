import type { AnalysisPeriod, AnalysisResult, AnalysisSpec, AnnualObservation, Location, LocationAnalysis } from '../../shared/types';
import type { CacheStore, ClimateProvider, ClimateSeries } from './backend.types';
import { BASELINE, CONFIG, METHODOLOGY_VERSION, MIN_COVERAGE, MIN_YEARS } from './config.constant';
import { annualize, calculateTrend, daysInMonth } from './statistics';
import { getCurrentWeather, WEATHER_NOTICE } from './providers/current-weather';

function yearsOf(period: AnalysisPeriod): number[] {
  return Array.from({ length: period.endYear - period.startYear + 1 }, (_, i) => period.startYear + i);
}

export function summarizeSeries(location: Location, spec: AnalysisSpec, period: AnalysisPeriod,
  series: ClimateSeries | null, commonYears?: Set<number>): LocationAnalysis {
  const allAnnual = annualize(series?.monthly ?? [], spec.metric);
  const baselineAnnual = allAnnual.filter(p => p.year >= BASELINE.startYear && p.year <= BASELINE.endYear);
  // A partial climatology is disclosed but never presented as a complete 1991–2020 baseline.
  const baselineMean = baselineAnnual.length === 30 ? baselineAnnual.reduce((s, p) => s + p.value, 0) / 30 : null;
  const annual = allAnnual.filter(p => p.year >= period.startYear && p.year <= period.endYear && (!commonYears || commonYears.has(p.year)))
    .map(p => ({ ...p, anomaly: baselineMean === null ? null : p.value - baselineMean }));
  const requested = yearsOf(period);
  const present = new Set(annual.map(p => p.year));
  const coverage = annual.length / requested.length;
  const sufficient = annual.length >= MIN_YEARS && coverage >= MIN_COVERAGE;
  const warnings: string[] = [];
  if (!sufficient) warnings.push('At least 10 complete years and 80% coverage are required to infer a trend.');
  if (baselineMean === null) warnings.push('The 1991–2020 baseline is incomplete; anomalies are not calculated.');
  if (coverage < 1) warnings.push('Years without 12 valid months or not shared by both locations are excluded.');
  return {
    location, period, outcome: !series ? 'source_unavailable' : sufficient ? 'sufficient_data' : 'insufficient_data',
    unit: spec.metric === 'temperature' ? '°C' : 'mm/year',
    // Public precipitation months are accumulated mm/month; providers retain mm/day rates.
    monthly: (series?.monthly ?? []).filter(p => p.year >= period.startYear && p.year <= period.endYear)
      .map(p => ({ ...p, value: p.value === null ? null : spec.metric === 'precipitation' ? p.value * daysInMonth(p.year, p.month) : p.value })),
    annual, trend: sufficient && series ? calculateTrend(annual) : null,
    quality: { requestedYears: requested.length, completeYears: annual.length, coverage,
      excludedYears: requested.filter(y => !present.has(y)), baselineYears: baselineAnnual.length, warnings },
    baseline: { ...BASELINE, mean: baselineMean },
    source: series?.provenance.provider === 'Meteomatics' ? 'Meteomatics' : 'NASA POWER', provenance: series?.provenance ?? null,
    currentWeather: { status: 'source_unavailable', observedAt: null, temperatureC: null, precipitationMm: null, provenance: null, notice: WEATHER_NOTICE },
  };
}

function mean(annual: AnnualObservation[]): number | null {
  return annual.length ? annual.reduce((s, p) => s + p.value, 0) / annual.length : null;
}

export function assembleResult(spec: AnalysisSpec, locations: LocationAnalysis[], commonYears: number[]): AnalysisResult {
  const outcome = locations.some(l => l.outcome === 'source_unavailable') ? 'source_unavailable'
    : locations.some(l => l.outcome === 'insufficient_data') ? 'insufficient_data' : 'sufficient_data';
  let comparison: AnalysisResult['comparison'] = null;
  const [a, b] = locations;
  if (spec.comparisonMode !== 'none' && a && b) {
    const meanA = mean(a.annual), meanB = mean(b.annual);
    comparison = { mode: spec.comparisonMode,
      slopeDifferencePerDecade: a.trend && b.trend ? b.trend.slopePerDecade - a.trend.slopePerDecade : null,
      meanDifference: meanA !== null && meanB !== null ? meanB - meanA : null,
      description: spec.comparisonMode === 'locations'
        ? 'Differences: second location minus first, using only common complete years. No significance test is performed on the difference.'
        : 'Differences: second period minus first. Each period is assessed separately; the slope difference is descriptive.',
    };
  }
  const narrative = locations.map(l => {
    const prefix = `${l.location.name}, ${l.period.startYear}–${l.period.endYear}`;
    if (l.outcome === 'source_unavailable') return `${prefix}: the historical data source is unavailable. No trend is inferred.`;
    if (!l.trend) return `${prefix}: ${l.annual.length} complete years (${Math.round(l.quality.coverage * 100)}% coverage). Insufficient data to infer a trend.`;
    const [low, high] = l.trend.confidenceInterval95PerDecade;
    return `${prefix}: estimated change of ${l.trend.slopePerDecade.toFixed(3)} ${l.unit}/decade; 95% CI [${low.toFixed(3)}, ${high.toFixed(3)}], p=${l.trend.pValue.toPrecision(3)}. ${l.trend.significant ? 'The slope is statistically different from zero at the 0.05 level.' : 'There is insufficient evidence that the slope differs from zero at the 0.05 level.'}`;
  }).join('\n');
  return { outcome, locations, commonYears, comparison, narrative,
    warnings: [...new Set(locations.flatMap(l => l.quality.warnings)),
      'Intervals and p-values use Newey–West and a t approximation; they do not demonstrate causality or attribution to climate change.',
      ...(spec.comparisonMode === 'periods' && spec.secondPeriod && spec.secondPeriod.startYear <= spec.endYear && spec.secondPeriod.endYear >= spec.startYear
        ? ['The periods overlap; their estimates are not independent.'] : []),
    ], methodologyVersion: METHODOLOGY_VERSION };
}

export class AnalysisService {
  constructor(private readonly provider: ClimateProvider, private readonly cache: CacheStore, private readonly fallback?: ClimateProvider) {}
  async run(spec: AnalysisSpec): Promise<AnalysisResult> {
    const startYear = Math.min(BASELINE.startYear, spec.startYear, spec.secondPeriod?.startYear ?? spec.startYear);
    const endYear = Math.max(BASELINE.endYear, spec.endYear, spec.secondPeriod?.endYear ?? spec.endYear);
    const series = await Promise.all(spec.locations.map(async location => {
      try { return await this.provider.getMonthly(location, spec.metric, startYear, endYear); }
      catch {
        if (CONFIG.meteomaticsFallback && this.fallback) {
          try { return await this.fallback.getMonthly(location, spec.metric, startYear, endYear); } catch { return null; }
        }
        return null;
      }
    }));
    let commonYears: number[] = [];
    if (spec.comparisonMode === 'locations') {
      const sets = series.map(s => new Set(annualize(s?.monthly ?? [], spec.metric).map(p => p.year)));
      commonYears = yearsOf(spec).filter(y => sets.every(set => set.has(y)));
    }
    const locations = spec.locations.map((location, i) => summarizeSeries(location, spec, spec, series[i] ?? null,
      spec.comparisonMode === 'locations' ? new Set(commonYears) : undefined));
    if (spec.comparisonMode === 'periods' && spec.secondPeriod) {
      locations.push(summarizeSeries(spec.locations[0]!, spec, spec.secondPeriod, series[0] ?? null));
    }
    const weather = await Promise.all(spec.locations.map(location => getCurrentWeather(location, this.cache)));
    locations.forEach((location, i) => { location.currentWeather = weather[spec.comparisonMode === 'periods' ? 0 : i]!; });
    return assembleResult(spec, locations, commonYears);
  }
}
