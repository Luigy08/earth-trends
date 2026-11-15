import type { BalamQuery, Location, ParsedParameter, SourceId, TimeRange } from './datasources.types';

/**
 * Parser de la sintaxis estilo Meteomatics, extendida con prefijo de fuente.
 *
 *   /{tiempo}/{parametros}/{ubicacion}
 *
 *   tiempo      2020-01-01T00:00:00Z--2020-12-31T00:00:00Z:P1D
 *               2020-01-01T00:00:00ZP30D:PT1H           (inicio + duración)
 *               2020-01-01T00:00:00Z                      (instante)
 *   parametros  t_2m:C,appeears/MOD11A1.061/LST_Day_1km:K
 *   ubicacion   14.07,-87.19                              (punto)
 *               14.07,-87.19+15.5,-88.0                   (lista de puntos)
 *               16.0,-89.4_13.0,-83.1:0.1,0.1             (bbox latMax,lonMin_latMin,lonMax[:res])
 */

export const DEFAULT_SOURCE: SourceId = 'meteomatics';

export function parseParameter(raw: string, knownSources: readonly string[]): ParsedParameter {
  const s = raw.trim();
  const colon = s.lastIndexOf(':');
  if (colon <= 0 || colon === s.length - 1) {
    throw new Error(`Parameter without unit: "${raw}" (expected name:unit)`);
  }
  const unit = s.slice(colon + 1);
  let name = s.slice(0, colon);
  let source: SourceId = DEFAULT_SOURCE;
  const slash = name.indexOf('/');
  if (slash > 0 && knownSources.includes(name.slice(0, slash))) {
    source = name.slice(0, slash);
    name = name.slice(slash + 1);
  }
  return { raw: s, source, name, unit };
}

export function formatParameter(p: Pick<ParsedParameter, 'source' | 'name' | 'unit'>): string {
  return `${p.source}/${p.name}:${p.unit}`;
}

export function parseParameters(segment: string, knownSources: readonly string[]): ParsedParameter[] {
  return segment
    .split(',')
    .filter(Boolean)
    .map((p) => parseParameter(p, knownSources));
}

/* ---------------- Tiempo ---------------- */

const DURATION_RE =
  /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Suma una duración ISO-8601 a una fecha (UTC). */
export function addDuration(date: Date, duration: string): Date {
  const m = DURATION_RE.exec(duration);
  if (!m) throw new Error(`Invalid ISO-8601 duration: ${duration}`);
  const [y = 0, mo = 0, w = 0, d = 0, h = 0, mi = 0, s = 0] = m.slice(1).map((v) => (v ? Number(v) : 0));
  const out = new Date(date.getTime());
  if (y) out.setUTCFullYear(out.getUTCFullYear() + y);
  if (mo) out.setUTCMonth(out.getUTCMonth() + mo);
  const ms = ((((w * 7 + d) * 24 + h) * 60 + mi) * 60 + s) * 1000;
  return new Date(out.getTime() + ms);
}

export function parseTime(segment: string): TimeRange {
  const [range, step] = splitStep(segment);
  if (range.includes('--')) {
    const [a = '', b = ''] = range.split('--');
    return { start: toDate(a), end: toDate(b), step };
  }
  const p = range.indexOf('P', 10); // inicio + duración: "...ZP5D"
  if (p > 0) {
    const start = toDate(range.slice(0, p));
    return { start, end: addDuration(start, range.slice(p)), step };
  }
  const t = toDate(range);
  return { start: t, end: t, step };
}

function splitStep(segment: string): [string, string | undefined] {
  // El paso va después del último ":" seguido de "P" (p.ej. ":PT1H"), para no confundir con las horas.
  const i = segment.lastIndexOf(':P');
  return i > 0 ? [segment.slice(0, i), segment.slice(i + 1)] : [segment, undefined];
}

function toDate(s: string): Date {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${s}`);
  return d;
}

export function formatTime(t: TimeRange): string {
  const iso = (d: Date) => d.toISOString().replace('.000Z', 'Z');
  const base = t.start.getTime() === t.end.getTime() ? iso(t.start) : `${iso(t.start)}--${iso(t.end)}`;
  return t.step ? `${base}:${t.step}` : base;
}

/* ---------------- Ubicación ---------------- */

export function parseLocation(segment: string): Location {
  if (segment.includes('_')) {
    const [corners = '', res] = segment.split(':');
    const [nw = '', se = ''] = corners.split('_');
    const [latMax = NaN, lonMin = NaN] = nw.split(',').map(Number);
    const [latMin = NaN, lonMax = NaN] = se.split(',').map(Number);
    assertNumbers([latMax, lonMin, latMin, lonMax], segment);
    const loc: Extract<Location, { kind: 'bbox' }> = { kind: 'bbox', latMax, lonMin, latMin, lonMax };
    if (res) {
      const [rLat = NaN, rLon = rLat] = res.split(',').map(Number);
      assertNumbers([rLat, rLon], segment);
      loc.resLat = rLat;
      loc.resLon = rLon;
    }
    return loc;
  }
  const pts = segment.split('+').map((p) => {
    const [lat = NaN, lon = NaN] = p.split(',').map(Number);
    assertNumbers([lat, lon], segment);
    return { lat, lon };
  });
  const [first] = pts;
  return pts.length === 1 && first ? { kind: 'point', ...first } : { kind: 'points', points: pts };
}

function assertNumbers(ns: number[], ctx: string) {
  if (ns.some((n) => !Number.isFinite(n))) throw new Error(`Invalid location: ${ctx}`);
}

export function formatLocation(l: Location): string {
  switch (l.kind) {
    case 'point':
      return `${l.lat},${l.lon}`;
    case 'points':
      return l.points.map((p) => `${p.lat},${p.lon}`).join('+');
    case 'zones':
      // Zones have no path syntax: point sources receive their centroids.
      return l.zones.map((z) => `${z.centroid.lat},${z.centroid.lon}`).join('+');
    case 'bbox': {
      const base = `${l.latMax},${l.lonMin}_${l.latMin},${l.lonMax}`;
      return l.resLat ? `${base}:${l.resLat},${l.resLon ?? l.resLat}` : base;
    }
  }
}

export function pointsOf(l: Location): { lat: number; lon: number; id?: string }[] {
  if (l.kind === 'point') return [{ lat: l.lat, lon: l.lon, id: l.id }];
  if (l.kind === 'points') return l.points;
  if (l.kind === 'zones') return l.zones.map((z) => ({ lat: z.centroid.lat, lon: z.centroid.lon, id: z.id }));
  return [];
}

/** Parsea una ruta completa: "/{tiempo}/{parametros}/{ubicacion}[/json]" */
export function parseQueryPath(path: string, knownSources: readonly string[]): BalamQuery {
  const parts = path.replace(/^\/+/, '').split('/');
  // Los nombres de AppEEARS contienen "/", así que tiempo es lo primero y ubicación/formato lo último.
  const time = parseTime(parts[0] ?? '');
  let tail = parts.slice(1);
  if (['json', 'csv'].includes(tail[tail.length - 1] ?? '')) tail = tail.slice(0, -1);
  const location = parseLocation(tail[tail.length - 1] ?? '');
  const parameters = parseParameters(tail.slice(0, -1).join('/'), knownSources);
  return { time, parameters, location };
}
