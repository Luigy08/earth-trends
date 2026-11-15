import type { BalamQuery, DataSource, ParameterSeries, SourceJob } from '../datasources.types';
import { formatLocation, formatTime, pointsOf } from '../param-string';

export interface MeteomaticsConfig {
  username: string;
  password: string;
  baseUrl?: string; // https://api.meteomatics.com
  /** Default step when the query has none. */
  defaultStep?: string; // P1D
  /** Default resolution (degrees) for bbox queries. */
  defaultBboxRes?: number;
  /** Meteomatics "model" parameter (mix by default). */
  model?: string;
}

interface MeteomaticsJson {
  status: string;
  data: {
    parameter: string;
    coordinates: { lat: number; lon: number; dates: { date: string; value: number | null }[] }[];
  }[];
}

/** Meteomatics encodes missing data with reserved numbers; they must never be stored as measurements. */
const RESERVED_VALUES = new Set([-999, -888, -777, -666]);

/**
 * Synchronous source: one HTTP call per query.
 * GET {base}/{time}/{p1,p2,…}/{location}/json
 * Zones are queried at their centroids (`lat,lon+lat,lon`) and answered as one series per zone.
 */
export class MeteomaticsSource implements DataSource {
  readonly id = 'meteomatics';
  readonly synchronous = true;

  constructor(private readonly cfg: MeteomaticsConfig) {}

  buildUrl(q: BalamQuery): string {
    const base = this.cfg.baseUrl ?? 'https://api.meteomatics.com';
    const time = formatTime({ ...q.time, step: q.time.step ?? this.cfg.defaultStep ?? 'P1D' });
    const params = q.parameters.map((p) => `${p.name}:${p.unit}`).join(',');
    const loc =
      q.location.kind === 'bbox' && !q.location.resLat
        ? formatLocation({ ...q.location, resLat: this.cfg.defaultBboxRes ?? 0.1 })
        : formatLocation(q.location);
    const qs = this.cfg.model ? `?model=${encodeURIComponent(this.cfg.model)}` : '';
    return `${base}/${time}/${params}/${loc}/json${qs}`;
  }

  async submit(q: BalamQuery): Promise<SourceJob> {
    const url = this.buildUrl(q);
    if (!this.cfg.username || !this.cfg.password) {
      return { source: this.id, externalId: url, status: 'error', context: {}, error: 'Meteomatics credentials are not configured' };
    }
    const auth = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64');
    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) {
      return { source: this.id, externalId: url, status: 'error', context: {}, error: `${res.status} ${await res.text()}` };
    }
    const json = (await res.json()) as MeteomaticsJson;
    // Meteomatics answers coordinates in request order; that is how each series gets its point or zone id.
    const requested = pointsOf(q.location);
    const result: ParameterSeries[] = json.data.map((d) => {
      const unit = d.parameter.slice(d.parameter.lastIndexOf(':') + 1);
      const ordered = requested.length === d.coordinates.length;
      return {
        parameter: `meteomatics/${d.parameter}`,
        source: this.id,
        unit,
        coordinates: d.coordinates.map((c, i) => {
          const point = ordered ? requested[i] : undefined;
          return {
            lat: point?.lat ?? c.lat,
            lon: point?.lon ?? c.lon,
            ...(point?.id ? { id: point.id } : {}),
            dates: c.dates.map((v) => ({ date: v.date, value: v.value === null || RESERVED_VALUES.has(v.value) ? null : v.value })),
          };
        }),
      };
    });
    return { source: this.id, externalId: url, status: 'done', progress: 100, context: {}, result };
  }

  async refresh(job: SourceJob): Promise<SourceJob> {
    return job; // synchronous: already finished
  }
}
