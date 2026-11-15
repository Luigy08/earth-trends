import type {
  BalamQuery,
  CatalogEntry,
  CoordinateSeries,
  DataSource,
  DateValue,
  JobStatus,
  ParameterSeries,
  ParsedParameter,
  SourceJob,
} from '../datasources.types';
import { pointsOf } from '../param-string';
import { canConvert, converter, isPhysicalUnit } from '../units';
import { parseCsv } from '../csv';

export interface AppeearsConfig {
  /** NASA Earthdata Login username and password. */
  username: string;
  password: string;
  baseUrl?: string; // https://appeears.earthdatacloud.nasa.gov/api
  /** Normalized catalog (sync:appeears) used for units, fill values and layer validation. */
  catalog?: CatalogEntry[];
  /** Output format for area requests. Per-date statistics arrive in a separate CSV. */
  areaFileType?: 'geotiff' | 'netcdf4';
  areaProjection?: string; // "native" works for every product
}

interface Token {
  value: string;
  expires: number;
}

interface BundleFile {
  file_id: string;
  file_name: string;
  file_type: string;
}

/** One requested area: a zone, or the single bbox feature. Persisted in the job context, in feature order. */
interface AreaRef {
  id: string;
  lat: number;
  lon: number;
}

/**
 * Asynchronous source. Flow:
 *   submit  → POST /task              (returns task_id)
 *   refresh → GET  /task/{id}         (pending | processing | done | error)
 *           → GET  /bundle/{id}       (file list)
 *           → GET  /bundle/{id}/{fid} (302 to S3 → CSV)
 *
 * Points → "*-results.csv" with {Product}_{Version}_{Layer} columns.
 * Areas  → "*-Statistics.csv" with mean/min/max/median per date, layer and feature (`aid`).
 * Zones  → one area task whose FeatureCollection holds one feature per zone, in order;
 *          `aid000N` is assumed to be feature N (1-based).
 */
export class AppeearsSource implements DataSource {
  readonly id = 'appeears';
  readonly synchronous = false;
  private token?: Token;
  private readonly base: string;
  private readonly catalog = new Map<string, CatalogEntry>();

  constructor(private readonly cfg: AppeearsConfig) {
    this.base = cfg.baseUrl ?? 'https://appeears.earthdatacloud.nasa.gov/api';
    for (const e of cfg.catalog ?? []) this.catalog.set(`${e.dataset}/${e.variable}`, e);
  }

  /* ---------- Authentication (token lasts ~48 h) ---------- */

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expires > Date.now() + 5 * 60_000) return this.token.value;
    if (!this.cfg.username || !this.cfg.password) throw new Error('AppEEARS credentials are not configured');
    const auth = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64');
    const res = await fetch(`${this.base}/login`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Length': '0' },
    });
    if (!res.ok) throw new Error(`AppEEARS login failed: ${res.status} ${await res.text()}`);
    const j = (await res.json()) as { token: string; expiration: string };
    this.token = { value: j.token, expires: new Date(j.expiration).getTime() };
    return j.token;
  }

  private async api(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if ((res.status === 401 || res.status === 403) && retry) {
      await this.getToken(true);
      return this.api(path, init, false);
    }
    return res;
  }

  /* ---------- Task construction ---------- */

  private layerOf(p: ParsedParameter): { product: string; layer: string } {
    const i = p.name.indexOf('/');
    if (i < 0) throw new Error(`Invalid AppEEARS parameter "${p.raw}". Expected appeears/PRODUCT.VERSION/LAYER:unit`);
    const product = p.name.slice(0, i);
    const layer = p.name.slice(i + 1);
    if (this.catalog.size && !this.catalog.has(`${product}/${layer}`)) {
      throw new Error(`Layer not found in the AppEEARS catalog: ${product}/${layer}`);
    }
    return { product, layer };
  }

  buildTask(q: BalamQuery): Record<string, unknown> {
    const mdy = (d: Date) =>
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}-${d.getUTCFullYear()}`;
    const layers = q.parameters.map((p) => this.layerOf(p));
    const dates = [{ startDate: mdy(q.time.start), endDate: mdy(q.time.end) }];
    const task_name = `balam-${Date.now()}`;
    const features = areaFeatures(q);

    if (features) {
      return {
        task_type: 'area',
        task_name,
        params: {
          dates,
          layers,
          geo: { type: 'FeatureCollection', features },
          output: { format: { type: this.cfg.areaFileType ?? 'geotiff' }, projection: this.cfg.areaProjection ?? 'native' },
        },
      };
    }
    const coordinates = pointsOf(q.location).map((p, i) => ({
      latitude: p.lat,
      longitude: p.lon,
      id: p.id ?? `p${i}`,
    }));
    return { task_type: 'point', task_name, params: { dates, layers, coordinates } };
  }

  /* ---------- DataSource ---------- */

  async submit(q: BalamQuery): Promise<SourceJob> {
    const task = this.buildTask(q);
    const res = await this.api('/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task),
    });
    if (!res.ok) {
      return { source: this.id, externalId: '', status: 'error', context: { taskType: task.task_type }, error: `${res.status} ${await res.text()}` };
    }
    const j = (await res.json()) as { task_id: string; status: JobStatus };
    return {
      source: this.id,
      externalId: j.task_id,
      status: j.status ?? 'pending',
      // Geometry is not persisted: only what is needed to rebuild the series later.
      context: { taskType: task.task_type, parameters: q.parameters, ...(areaRefs(q) ? { areas: areaRefs(q) } : {}) },
    };
  }

  async refresh(job: SourceJob): Promise<SourceJob> {
    if (job.status === 'done' || job.status === 'error') return job;
    const res = await this.api(`/task/${job.externalId}`);
    if (!res.ok) return { ...job, status: 'error', error: `${res.status} ${await res.text()}` };
    const t = (await res.json()) as { status: JobStatus; error?: string | null; summary?: { empty?: boolean; description?: string } };

    if (t.status === 'error') return { ...job, status: 'error', error: t.error ?? 'AppEEARS task failed' };
    if (t.status !== 'done') {
      const progress = await this.progress(job.externalId);
      return { ...job, status: t.status, progress };
    }
    if (t.summary?.empty) {
      return { ...job, status: 'done', progress: 100, result: this.emptyResult(job), error: t.summary.description };
    }
    const result = await this.collect(job);
    return { ...job, status: 'done', progress: 100, result };
  }

  private async progress(taskId: string): Promise<number | undefined> {
    const res = await this.api(`/status/${taskId}`, { redirect: 'manual' });
    if (!res.ok) return undefined;
    const j = (await res.json()) as { progress?: { summary?: number } }[] | { progress?: { summary?: number } };
    const s = Array.isArray(j) ? j[0] : j;
    return s?.progress?.summary;
  }

  /* ---------- Download and normalization ---------- */

  private async download(taskId: string, fileId: string): Promise<string> {
    // The endpoint answers 302 to a signed S3 URL, which must be followed without the Authorization header.
    const res = await this.api(`/bundle/${taskId}/${fileId}`, { redirect: 'manual' });
    const loc = res.headers.get('location');
    const final = loc ? await fetch(loc) : res;
    if (!final.ok) throw new Error(`Download failed (${final.status}) for ${fileId}`);
    return final.text();
  }

  private async collect(job: SourceJob): Promise<ParameterSeries[]> {
    const res = await this.api(`/bundle/${job.externalId}`);
    if (!res.ok) throw new Error(`Bundle unavailable: ${res.status}`);
    const { files } = (await res.json()) as { files: BundleFile[] };
    const params = job.context.parameters as ParsedParameter[];

    if (job.context.taskType === 'point') {
      const csvs = files.filter((f) => /-results\.csv$/i.test(f.file_name));
      const rows = (await Promise.all(csvs.map((f) => this.download(job.externalId, f.file_id)))).flatMap(parseCsv);
      return params.map((p) => this.pointSeries(p, rows));
    }
    const stats = files.filter((f) => /statistics\.csv$/i.test(f.file_name));
    const rows = (await Promise.all(stats.map((f) => this.download(job.externalId, f.file_id)))).flatMap(parseCsv);
    const areas = (job.context.areas as AreaRef[] | undefined) ?? [];
    return params.map((p) => this.areaSeries(p, rows, areas));
  }

  private valueMapper(p: ParsedParameter) {
    const { product, layer } = this.layerOf(p);
    const meta = this.catalog.get(`${product}/${layer}`);
    // When the catalog has no physical unit (unitless layer or free label), the requested unit is kept.
    const from = meta && isPhysicalUnit(meta.unit) ? meta.unit : p.unit;
    if (!canConvert(from, p.unit)) {
      throw new Error(`Cannot convert ${product}/${layer} from ${from} to ${p.unit}`);
    }
    const conv = converter(from, p.unit);
    const fill = typeof meta?.fillValue === 'number' ? meta.fillValue : null;
    const scale = meta?.scaleFactor ?? 1;
    // AppEEARS CSVs already apply the scale factor; the fill value may arrive raw or scaled.
    const value = (raw: string | undefined): number | null => {
      if (raw === '' || raw === undefined) return null;
      const v = Number(raw);
      if (!Number.isFinite(v)) return null;
      if (fill !== null && (v === fill || v === fill * scale)) return null;
      return conv(v);
    };
    // A spread (standard deviation) only takes the multiplicative part of the conversion, never the offset.
    const spread = (raw: number | undefined): number | undefined =>
      raw === undefined || !Number.isFinite(raw) ? undefined : Math.abs(conv(raw) - conv(0));
    return { value, spread };
  }

  private pointSeries(p: ParsedParameter, rows: Record<string, string>[]): ParameterSeries {
    const { product, layer } = this.layerOf(p);
    const col = `${product.replace('.', '_')}_${layer}`;
    const map = this.valueMapper(p);
    const byId = new Map<string, CoordinateSeries>();
    for (const r of rows) {
      const key = findColumn(r, col);
      if (!key) continue;
      const id = r.ID ?? `${r.Latitude},${r.Longitude}`;
      let s = byId.get(id);
      if (!s) {
        s = { lat: Number(r.Latitude), lon: Number(r.Longitude), id, dates: [] };
        byId.set(id, s);
      }
      s.dates.push({ date: toIso(r.Date ?? ''), value: map.value(r[key]) });
    }
    for (const s of byId.values()) s.dates.sort((a, b) => a.date.localeCompare(b.date));
    return { parameter: p.raw, source: this.id, unit: p.unit, coordinates: [...byId.values()] };
  }

  /** One coordinate series per requested area, in request order. Rows are matched to areas by `aid`. */
  private areaSeries(p: ParsedParameter, rows: Record<string, string>[], areas: AreaRef[]): ParameterSeries {
    const { product, layer } = this.layerOf(p);
    const map = this.valueMapper(p);
    const g = (r: Record<string, string>, ...names: string[]) => {
      for (const n of names) {
        const k = Object.keys(r).find((h) => h.toLowerCase() === n.toLowerCase());
        if (k && r[k] !== '') return Number(r[k]);
      }
      return undefined;
    };
    const mine = rows.filter((r) => {
      const ds = r.Dataset ?? r.dataset ?? '';
      const file = r['File Name'] ?? '';
      return ds === layer && (!file || file.includes(product.split('.')[0] ?? product));
    });
    const series = areas.map((a): CoordinateSeries => ({ lat: a.lat, lon: a.lon, id: a.id, dates: [] }));
    for (const r of mine) {
      const index = aidIndex(r.aid ?? r.AID);
      // A statistics file without `aid` can only be attributed when a single area was requested.
      if (index === undefined && areas.length !== 1) {
        throw new Error('AppEEARS statistics rows have no "aid" column, so they cannot be attributed to a zone');
      }
      const target = series[index ?? 0];
      if (!target) continue;
      const conv = (n?: number) => (n === undefined ? undefined : (map.value(String(n)) ?? undefined));
      const mean = conv(g(r, 'Mean'));
      const point: DateValue = {
        date: toIso(r.Date ?? ''),
        value: mean ?? null,
        stats: {
          mean,
          min: conv(g(r, 'Minimum')),
          max: conv(g(r, 'Maximum')),
          median: conv(g(r, 'Median')),
          std: map.spread(g(r, 'Standard Deviation')),
          count: g(r, 'Count'),
        },
      };
      target.dates.push(point);
    }
    for (const s of series) s.dates.sort((a, b) => a.date.localeCompare(b.date));
    return { parameter: p.raw, source: this.id, unit: p.unit, coordinates: series };
  }

  private emptyResult(job: SourceJob): ParameterSeries[] {
    return (job.context.parameters as ParsedParameter[]).map((p) => ({
      parameter: p.raw,
      source: this.id,
      unit: p.unit,
      coordinates: [],
    }));
  }
}

/** GeoJSON features for an area task (zones or bbox); undefined for point requests. */
function areaFeatures(q: BalamQuery): Record<string, unknown>[] | undefined {
  if (q.location.kind === 'zones') {
    return q.location.zones.map((z) => ({ type: 'Feature', properties: { id: z.id }, geometry: z.geometry }));
  }
  if (q.location.kind === 'bbox') {
    const { latMax, lonMin, latMin, lonMax } = q.location;
    return [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[lonMin, latMin], [lonMax, latMin], [lonMax, latMax], [lonMin, latMax], [lonMin, latMin]]],
        },
      },
    ];
  }
  return undefined;
}

function areaRefs(q: BalamQuery): AreaRef[] | undefined {
  if (q.location.kind === 'zones') return q.location.zones.map((z) => ({ id: z.id, lat: z.centroid.lat, lon: z.centroid.lon }));
  if (q.location.kind === 'bbox') {
    const { latMax, lonMin, latMin, lonMax } = q.location;
    return [{ id: 'bbox', lat: (latMax + latMin) / 2, lon: (lonMax + lonMin) / 2 }];
  }
  return undefined;
}

/** "aid0003" → 2 (zero-based feature index). */
export function aidIndex(aid: string | undefined): number | undefined {
  const m = /(\d+)\s*$/.exec(aid ?? '');
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n - 1 : undefined;
}

function findColumn(row: Record<string, string>, col: string): string | undefined {
  if (col in row) return col;
  return Object.keys(row).find((k) => k.toLowerCase() === col.toLowerCase());
}

function toIso(d: string): string {
  if (!d) return d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${d}T00:00:00Z`;
  // Timestamps without a zone are UTC in AppEEARS; never let the host time zone shift them.
  const naive = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)$/.exec(d);
  return new Date(naive ? `${naive[1]}T${naive[2]}Z` : d).toISOString().replace('.000Z', 'Z');
}
