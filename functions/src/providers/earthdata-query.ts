import type { MultiPolygon, Polygon } from 'geojson';
import type { EarthdataCatalogResponse, EarthdataExecuteResponse, EarthdataQuerySpec } from '../../../shared/types';
import type { EarthdataVariable, EarthdataZone } from '../../../shared/earthdata.types';
import { EARTHDATA_ATTRIBUTION, EARTHDATA_LIMITS, EARTHDATA_PROVIDER, EARTHDATA_SOURCE_URL, EARTHDATA_UNIT_LABELS } from '../../../shared/earthdata-catalog.constant';
import { earthdataSeriesLabel } from '../../../shared/earthdata.resolver';
import type { BalamReadRepository } from '../balam/balam.types';
import { CANONICAL_VARIABLES } from '../datasources/catalog/canonical-variables.constant';
import { resolveEarthdataChart } from '../earthdata-chart.resolver';
import { geometryContains } from '../earthdata-zone.resolver';
import type { IngestTarget, PlanSummary } from '../ingest/ingest.types';
import { daysBetween, sourceOf } from '../ingest/ingest.resolver';
import { INGEST_TARGETS } from '../ingest/targets.constant';

const SOURCE = 'appeears';
const ZONE_CACHE_MS = 600_000;

/** A request the user can fix (unknown variable, nothing stored yet, too much data). The message is shown as is. */
export class EarthdataRequestError extends Error {
  constructor(public readonly code: 'invalid-argument' | 'failed-precondition' | 'not-found', message: string) {
    super(message);
  }
}

/**
 * Reads the preloaded AppEEARS zonal series. A query never waits for NASA: when it finds a variable missing or
 * far behind the requested period, it asks the ingestion to request it (`ensureIngestion`) and says so.
 */
export class EarthdataQueryProvider {
  private zoneGeometry: { expires: number; zones: Array<EarthdataZone & { geometry: Polygon | MultiPolygon }> } | undefined;

  constructor(
    private readonly repository: () => BalamReadRepository,
    private readonly targets: readonly IngestTarget[] = INGEST_TARGETS,
    /** Requests every missing block of these variables. Idempotent: a variable already in progress is left alone. */
    private readonly ensureIngestion?: (variableIds: string[]) => Promise<PlanSummary>,
  ) {}

  /** Variables preloaded from AppEEARS, without their stored coverage. */
  variables(): EarthdataVariable[] {
    return this.targets.filter(target => sourceOf(target.parameter) === SOURCE).flatMap(target => {
      const canonical = CANONICAL_VARIABLES.find(variable => variable.id === target.variableId);
      if (!canonical) return [];
      const binding = canonical.bindings.find(item => item.parameter === target.parameter);
      return [{
        id: canonical.id, description: canonical.label, domain: canonical.category.charAt(0).toUpperCase() + canonical.category.slice(1),
        unit: EARTHDATA_UNIT_LABELS[canonical.unit] ?? canonical.unit, parameter: target.parameter, dataset: target.parameter.split('/')[1] ?? '',
        temporalResolution: binding?.temporal ?? 'product-defined', ...(binding?.resolution ? { spatialResolution: binding.resolution } : {}),
        since: target.since ?? binding?.since ?? null, ...(binding?.notes ? { notes: binding.notes } : {}), stored: null, ingesting: false,
      }];
    });
  }

  async catalog(): Promise<EarthdataCatalogResponse> {
    const repository = this.repository();
    const [zones, coverage, active] = await Promise.all([repository.zones(false), repository.coverage(), repository.activeIngestions()]);
    return {
      provider: EARTHDATA_PROVIDER, sourceUrl: EARTHDATA_SOURCE_URL,
      variables: this.variables().map(variable => {
        const stored = coverage.find(item => item.variableId === variable.id && item.source === SOURCE);
        return { ...variable, stored: stored ? { firstDate: stored.firstDate, lastDate: stored.lastDate, zones: stored.zones } : null,
          ingesting: active.some(item => item.variableId === variable.id && item.source === SOURCE) };
      }),
      zones: zones.map(zone => ({ id: zone.id, name: zone.name, level: zone.level, country: zone.country, latitude: zone.centroidLat, longitude: zone.centroidLon })),
    };
  }

  /** The zone whose polygon contains the point, if any. Geometries are cached briefly: they only change when zones are reseeded. */
  async zoneAt(latitude: number, longitude: number): Promise<EarthdataZone | undefined> {
    if (!this.zoneGeometry || this.zoneGeometry.expires < Date.now()) {
      const zones = await this.repository().zones(true);
      this.zoneGeometry = { expires: Date.now() + ZONE_CACHE_MS, zones: zones.flatMap(zone => zone.geometry
        ? [{ id: zone.id, name: zone.name, level: zone.level, country: zone.country, latitude: zone.centroidLat, longitude: zone.centroidLon, geometry: zone.geometry }] : []) };
    }
    const match = this.zoneGeometry.zones.find(zone => geometryContains(zone.geometry, latitude, longitude));
    if (!match) return undefined;
    const { geometry: _geometry, ...zone } = match;
    return zone;
  }

  async execute(spec: EarthdataQuerySpec): Promise<EarthdataExecuteResponse> {
    const catalog = await this.catalog();
    const variables = spec.variables.map(id => catalog.variables.find(item => item.id === id));
    const zones = spec.zones.map(id => catalog.zones.find(item => item.id === id));
    const unknownVariable = spec.variables.find((_, index) => !variables[index]);
    if (unknownVariable) throw new EarthdataRequestError('invalid-argument', `"${unknownVariable}" is not a stored NASA Earthdata variable.`);
    const unknownZone = spec.zones.find((_, index) => !zones[index]);
    if (unknownZone) throw new EarthdataRequestError('not-found', `Zone "${unknownZone}" is not available.`);

    const repository = this.repository();
    const data: Array<{ parameter: string; coordinates: Array<{ lat: number; lon: number; dates: Array<{ date: string; value: number | null }> }> }> = [];
    let values = 0;
    for (const variable of variables as EarthdataVariable[]) {
      const rows = await repository.series({ variableId: variable.id, zoneIds: spec.zones, source: SOURCE, from: spec.startDate, to: spec.endDate });
      values += rows.length;
      if (values > EARTHDATA_LIMITS.maxValues) {
        throw new EarthdataRequestError('invalid-argument', `This request returns more than ${EARTHDATA_LIMITS.maxValues.toLocaleString('en-US')} values. Choose fewer variables or departments, or a shorter period.`);
      }
      for (const zone of zones as EarthdataZone[]) {
        // One entry per variable and zone, so the zone name travels in the series label.
        data.push({ parameter: earthdataSeriesLabel(variable, zone), coordinates: [{ lat: zone.latitude, lon: zone.longitude,
          dates: rows.filter(row => row.zoneId === zone.id).map(row => ({ date: `${row.date}T00:00:00Z`, value: row.value })) }] });
      }
    }
    // A variable that is missing, or stops well before the requested end, is requested from NASA now.
    const today = new Date().toISOString().slice(0, 10);
    const wantedEnd = spec.endDate < today ? spec.endDate : today;
    const behind = (variables as EarthdataVariable[]).filter(variable => (!variable.since || variable.since <= wantedEnd)
      && (!variable.stored || daysBetween(variable.stored.lastDate, wantedEnd) > EARTHDATA_LIMITS.staleDays));
    const notices = behind.length ? await this.requestMissing(behind) : [];
    if (values === 0) {
      // Nothing to show is reported as such: an empty store or period must not look like a flat or absent signal.
      throw new EarthdataRequestError('failed-precondition', notices.length
        ? `No values are stored for this request yet. ${notices.join(' ')} ${notices.some(notice => /just now|already processing/.test(notice)) ? 'NASA takes from minutes to hours and the store is refreshed every hour; please try again later.' : 'Please try again later.'}`
        : `No values are stored for this period. Stored coverage: ${(variables as EarthdataVariable[]).map(variable => `${variable.description} ${variable.stored ? `${variable.stored.firstDate} → ${variable.stored.lastDate}` : 'none'}`).join('; ')}.`);
    }

    const requestedAt = new Date().toISOString();
    const result = { version: 'balam-1.0', status: 'OK', dateGenerated: requestedAt, data };
    return {
      provider: EARTHDATA_PROVIDER, source: 'earthdata', requestedAt, request: spec, responseFormat: 'json', result, chartTrends: resolveEarthdataChart(result, spec),
      provenance: { provider: EARTHDATA_PROVIDER, dataset: (variables as EarthdataVariable[]).map(variable => variable.dataset).join('; '),
        parameters: (variables as EarthdataVariable[]).map(variable => variable.parameter), sourceUrl: EARTHDATA_SOURCE_URL, retrievedAt: requestedAt,
        temporalResolution: 'request-defined', isHistorical: true, attribution: EARTHDATA_ATTRIBUTION },
      ...(notices.length ? { notices } : {}),
    };
  }

  /** Asks the ingestion for the variables that are behind and describes, per variable, what happened. */
  private async requestMissing(variables: EarthdataVariable[]): Promise<string[]> {
    const stored = (variable: EarthdataVariable) => (variable.stored ? `stored through ${variable.stored.lastDate}` : 'not stored yet');
    if (!this.ensureIngestion) return variables.map(variable => `${variable.description}: ${stored(variable)}.`);
    let summary: PlanSummary;
    try {
      summary = await this.ensureIngestion(variables.map(variable => variable.id));
    } catch {
      return variables.map(variable => `${variable.description}: ${stored(variable)}; it could not be requested from NASA AppEEARS right now.`);
    }
    return variables.map(variable => {
      const created = summary.created.filter(job => job.variableId === variable.id && job.source === SOURCE);
      const sent = created.filter(job => job.status !== 'error');
      const reason = summary.skipped.find(item => item.variableId === variable.id && item.source === SOURCE)?.reason ?? '';
      const status = sent.length ? `requested from NASA AppEEARS just now (${sent[0]!.start} → ${sent[sent.length - 1]!.end})`
        : created.length ? 'NASA AppEEARS did not accept the request; the source is unavailable for now'
        : /in progress/i.test(reason) ? 'NASA AppEEARS is already processing it'
        : /recently/i.test(reason) ? 'already requested from NASA AppEEARS in the last hours, with no new data so far'
        : /up to date/i.test(reason) ? 'NASA has published nothing newer'
        : reason ? `not requested (${reason})` : 'not requested';
      return `${variable.description}: ${stored(variable)}; ${status}.`;
    });
  }
}
