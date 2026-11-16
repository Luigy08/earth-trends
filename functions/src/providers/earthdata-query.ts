import type { EarthdataCatalogResponse, EarthdataExecuteResponse, EarthdataQuerySpec } from '../../../shared/types';
import type { EarthdataVariable, EarthdataZone } from '../../../shared/earthdata.types';
import { EARTHDATA_ATTRIBUTION, EARTHDATA_LIMITS, EARTHDATA_PROVIDER, EARTHDATA_SOURCE_URL, EARTHDATA_UNIT_LABELS } from '../../../shared/earthdata-catalog.constant';
import { earthdataSeriesLabel } from '../../../shared/earthdata.resolver';
import type { BalamReadRepository, ZoneSummary } from '../balam/balam.types';
import { CANONICAL_VARIABLES } from '../datasources/catalog/canonical-variables.constant';
import { resolveEarthdataChart } from '../earthdata-chart.resolver';
import type { IngestTarget, PlanSummary, ZoneRecord } from '../ingest/ingest.types';
import { daysBetween, sourceOf } from '../ingest/ingest.resolver';
import { INGEST_TARGETS, POINT_ZONE_LEVEL } from '../ingest/targets.constant';

const SOURCE = 'appeears';
/** Places are stored at ~110 m: finer than every product offered, coarse enough to reuse a stored series. */
const PLACE_DECIMALS = 3;

/** A request the user can fix (unknown variable, nothing stored yet, too much data). The message is shown as is. */
export class EarthdataRequestError extends Error {
  constructor(public readonly code: 'invalid-argument' | 'failed-precondition' | 'not-found', message: string) {
    super(message);
  }
}

/** What the query side may ask of the ingestion. Every call is idempotent and returns without waiting for NASA. */
export interface EarthdataIngestion {
  /** Requests every missing block of these variables for the preloaded administrative zones. */
  ensureAreas(variableIds: string[]): Promise<PlanSummary>;
  /** Requests the missing series of these variables for one on-demand place. */
  ensurePlace(variableIds: string[], zoneId: string): Promise<PlanSummary>;
  /** Stores the requests for these places that NASA has already finished. */
  collectPlaces(zoneIds: string[]): Promise<void>;
  savePlace(zone: ZoneRecord): Promise<void>;
}

/** "PT-N14072-W087192" for 14.072, -87.192: a stable id made only of characters every source accepts. */
export function placeZoneId(latitude: number, longitude: number): string {
  const part = (value: number, positive: string, negative: string, width: number) =>
    `${value < 0 ? negative : positive}${String(Math.round(Math.abs(value) * 10 ** PLACE_DECIMALS)).padStart(width, '0')}`;
  return `PT-${part(latitude, 'N', 'S', 5)}-${part(longitude, 'E', 'W', 6)}`;
}

const toZone = (zone: ZoneSummary): EarthdataZone => ({
  id: zone.id, name: zone.name, level: zone.level, country: zone.country, latitude: zone.centroidLat, longitude: zone.centroidLon,
  kind: zone.level === POINT_ZONE_LEVEL ? 'point' : 'area',
});

/**
 * Reads the stored AppEEARS series: area statistics for the preloaded administrative zones and pixel
 * series for any other place on Earth. A query never waits for NASA: when a series is missing or stops
 * well before the requested period, it asks the ingestion to request it and says so.
 */
export class EarthdataQueryProvider {
  constructor(
    private readonly repository: () => BalamReadRepository,
    private readonly targets: readonly IngestTarget[] = INGEST_TARGETS,
    private readonly ingestion?: EarthdataIngestion,
  ) {}

  /** Variables offered from AppEEARS, without their stored coverage. */
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
      zones: zones.map(toZone),
    };
  }

  /** Registers a place anywhere on Earth as a point zone, reusing the stored one when it already exists. */
  async place(location: { latitude: number; longitude: number; name: string; country?: string }): Promise<EarthdataZone> {
    const round = (value: number) => Number(value.toFixed(PLACE_DECIMALS));
    const latitude = round(location.latitude);
    const longitude = round(location.longitude);
    const id = placeZoneId(latitude, longitude);
    const existing = (await this.repository().zones(false, [id]))[0];
    if (existing) return toZone(existing);
    const zone: ZoneRecord = { id, name: location.name.slice(0, 120), level: POINT_ZONE_LEVEL, country: (location.country ?? '').slice(0, 60),
      centroidLat: latitude, centroidLon: longitude, geometry: { type: 'Point', coordinates: [longitude, latitude] } };
    if (!this.ingestion) throw new EarthdataRequestError('failed-precondition', 'New places cannot be registered right now.');
    await this.ingestion.savePlace(zone);
    return toZone(zone);
  }

  async execute(spec: EarthdataQuerySpec): Promise<EarthdataExecuteResponse> {
    const repository = this.repository();
    const offered = this.variables();
    const variables = spec.variables.map(id => offered.find(item => item.id === id));
    const unknownVariable = spec.variables.find((_, index) => !variables[index]);
    if (unknownVariable) throw new EarthdataRequestError('invalid-argument', `"${unknownVariable}" is not a NASA Earthdata variable offered here.`);
    const found = (await repository.zones(false, spec.zones)).map(toZone);
    const zones = spec.zones.map(id => found.find(item => item.id === id));
    const unknownZone = spec.zones.find((_, index) => !zones[index]);
    if (unknownZone) throw new EarthdataRequestError('not-found', `Place "${unknownZone}" is not available. Ask for it by name so it can be located.`);
    const chosenVariables = variables as EarthdataVariable[];
    const chosenZones = zones as EarthdataZone[];
    const places = chosenZones.filter(zone => zone.kind === 'point');

    // Requests for these places that NASA already finished are stored first, so they show up in this answer.
    if (places.length && this.ingestion) await this.ingestion.collectPlaces(places.map(zone => zone.id)).catch(() => undefined);

    const data: Array<{ parameter: string; coordinates: Array<{ lat: number; lon: number; dates: Array<{ date: string; value: number | null }> }> }> = [];
    let values = 0;
    for (const variable of chosenVariables) {
      const rows = await repository.series({ variableId: variable.id, zoneIds: spec.zones, source: SOURCE, from: spec.startDate, to: spec.endDate });
      values += rows.length;
      if (values > EARTHDATA_LIMITS.maxValues) {
        throw new EarthdataRequestError('invalid-argument', `This request returns more than ${EARTHDATA_LIMITS.maxValues.toLocaleString('en-US')} values. Choose fewer variables or places, or a shorter period.`);
      }
      for (const zone of chosenZones) {
        // One entry per variable and place, so the place name travels in the series label.
        data.push({ parameter: earthdataSeriesLabel(variable, zone), coordinates: [{ lat: zone.latitude, lon: zone.longitude,
          dates: rows.filter(row => row.zoneId === zone.id).map(row => ({ date: `${row.date}T00:00:00Z`, value: row.value })) }] });
      }
    }

    const notices = await this.requestMissing(spec, chosenVariables, chosenZones);
    if (values === 0) {
      // Nothing to show is reported as such: an empty store or period must not look like a flat or absent signal.
      throw new EarthdataRequestError('failed-precondition', notices.length
        ? `No values are stored for this request yet. ${notices.join(' ')} ${notices.some(notice => /just now|already processing/.test(notice)) ? 'NASA takes from minutes to hours; submit the request again later to see the data.' : 'Please try again later.'}`
        : 'No values are stored for this period, and nothing newer is available from NASA for it.');
    }

    const requestedAt = new Date().toISOString();
    const result = { version: 'balam-1.0', status: 'OK', dateGenerated: requestedAt, data };
    return {
      provider: EARTHDATA_PROVIDER, source: 'earthdata', requestedAt, request: spec, responseFormat: 'json', result, chartTrends: resolveEarthdataChart(result, spec),
      provenance: { provider: EARTHDATA_PROVIDER, dataset: chosenVariables.map(variable => variable.dataset).join('; '),
        parameters: chosenVariables.map(variable => variable.parameter), sourceUrl: EARTHDATA_SOURCE_URL, retrievedAt: requestedAt,
        temporalResolution: 'request-defined', isHistorical: true, attribution: EARTHDATA_ATTRIBUTION },
      ...(notices.length ? { notices } : {}),
    };
  }

  /**
   * Finds every variable/place series that is missing or stops well before the requested end, asks the
   * ingestion for it, and describes per series what is stored and what was requested.
   */
  private async requestMissing(spec: EarthdataQuerySpec, variables: EarthdataVariable[], zones: EarthdataZone[]): Promise<string[]> {
    const today = new Date().toISOString().slice(0, 10);
    const wantedEnd = spec.endDate < today ? spec.endDate : today;
    const coverage = await this.repository().seriesCoverage(spec.variables, spec.zones, SOURCE);
    const behind = zones.flatMap(zone => variables.flatMap(variable => {
      const stored = coverage.find(item => item.variableId === variable.id && item.zoneId === zone.id);
      const missing = (!variable.since || variable.since <= wantedEnd) && (!stored || daysBetween(stored.lastDate, wantedEnd) > EARTHDATA_LIMITS.staleDays);
      return missing ? [{ zone, variable, stored }] : [];
    }));
    if (!behind.length) return [];

    // Administrative zones are ingested together, so one request per variable covers all of them; places go one by one.
    const summaries = new Map<string, PlanSummary | null>();
    if (this.ingestion) {
      const areaVariables = [...new Set(behind.filter(item => item.zone.kind === 'area').map(item => item.variable.id))];
      if (areaVariables.length) summaries.set('areas', await this.ingestion.ensureAreas(areaVariables).catch(() => null));
      for (const zone of zones.filter(item => item.kind === 'point')) {
        const ids = behind.filter(item => item.zone.id === zone.id).map(item => item.variable.id);
        if (ids.length) summaries.set(zone.id, await this.ingestion.ensurePlace(ids, zone.id).catch(() => null));
      }
    }
    return behind.map(({ zone, variable, stored }) => {
      const have = stored ? `stored through ${stored.lastDate}` : 'not stored yet';
      const summary = summaries.get(zone.kind === 'area' ? 'areas' : zone.id);
      return `${variable.description} · ${zone.name}: ${have}; ${summary === undefined ? 'not requested' : summary === null ? 'it could not be requested from NASA AppEEARS right now' : describePlan(summary, variable.id)}.`;
    });
  }
}

function describePlan(summary: PlanSummary, variableId: string): string {
  const created = summary.created.filter(job => job.variableId === variableId && job.source === SOURCE);
  const sent = created.filter(job => job.status !== 'error');
  const reason = summary.skipped.find(item => item.variableId === variableId && item.source === SOURCE)?.reason ?? '';
  if (sent.length) return `requested from NASA AppEEARS just now (${sent[0]!.start} → ${sent[sent.length - 1]!.end})`;
  if (created.length) return 'NASA AppEEARS did not accept the request; the source is unavailable for now';
  if (/in progress/i.test(reason)) return 'NASA AppEEARS is already processing it';
  if (/recently/i.test(reason)) return 'already requested from NASA AppEEARS in the last hours, with no new data so far';
  if (/up to date/i.test(reason)) return 'NASA has published nothing newer';
  return reason ? `not requested (${reason})` : 'not requested';
}
