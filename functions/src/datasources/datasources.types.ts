/**
 * Modelo unificado de Balam, calcado del modelo de consulta de Meteomatics:
 *
 *   https://api.meteomatics.com/{tiempo}/{parametros}/{ubicacion}/{formato}
 *
 * - Un PARÁMETRO es "nombre:unidad" (p.ej. t_2m:C). En Balam se le antepone la
 *   fuente:  "meteomatics/t_2m:C", "appeears/MOD11A1.061/LST_Day_1km:K".
 *   Sin prefijo se asume la fuente por defecto (meteomatics) para no romper
 *   las consultas que Balam ya hace.
 * - El TIEMPO es un rango con paso opcional (ISO-8601).
 * - La UBICACIÓN es un punto, una lista de puntos o un bbox.
 * - La RESPUESTA tiene la misma forma que el JSON de Meteomatics, así el
 *   frontend de Balam no cambia al agregar fuentes.
 */

import type { MultiPolygon, Polygon } from 'geojson';

export type SourceId = 'meteomatics' | 'appeears' | (string & {});

export interface ParsedParameter {
  /** Cadena original completa, p.ej. "appeears/MOD11A1.061/LST_Day_1km:K" */
  raw: string;
  source: SourceId;
  /** Nombre dentro de la fuente: "t_2m" o "MOD11A1.061/LST_Day_1km" */
  name: string;
  /** Unidad pedida (token corto estilo Meteomatics): C, K, idx, p, m3m3, mm… */
  unit: string;
}

export interface TimeRange {
  start: Date;
  end: Date;
  /** Paso ISO-8601 (PT1H, P1D…). Las fuentes satelitales lo ignoran: usan la granularidad del producto. */
  step?: string;
}

/** Zona con polígono (departamento, municipio…). Las tendencias de Balam se calculan por zona. */
export interface ZoneRef {
  id: string;
  geometry: Polygon | MultiPolygon;
  centroid: { lat: number; lon: number };
}

export type Location =
  | { kind: 'zones'; zones: ZoneRef[] }
  | { kind: 'point'; lat: number; lon: number; id?: string }
  | { kind: 'points'; points: { lat: number; lon: number; id?: string }[] }
  | {
      kind: 'bbox';
      latMax: number;
      lonMin: number;
      latMin: number;
      lonMax: number;
      /** Resolución en grados (solo la usan fuentes que devuelven grilla). */
      resLat?: number;
      resLon?: number;
    };

export interface BalamQuery {
  parameters: ParsedParameter[];
  time: TimeRange;
  location: Location;
}

/* ---------- Respuesta (forma del JSON de Meteomatics) ---------- */

export interface DateValue {
  date: string; // ISO-8601
  value: number | null;
  /** Extras opcionales para fuentes satelitales (estadísticas de área, QA…). */
  stats?: Partial<Record<'min' | 'max' | 'mean' | 'median' | 'std' | 'count', number>>;
  qa?: string;
}

export interface CoordinateSeries {
  lat: number;
  lon: number;
  id?: string;
  dates: DateValue[];
}

export interface ParameterSeries {
  parameter: string; // cadena Balam completa
  source: SourceId;
  unit: string;
  coordinates: CoordinateSeries[];
}

export interface BalamResponse {
  version: string;
  dateGenerated: string;
  status: 'OK' | 'PARTIAL' | 'ERROR';
  data: ParameterSeries[];
  errors?: { parameter?: string; source: SourceId; message: string }[];
}

/* ---------- Trabajos (para fuentes asíncronas como AppEEARS) ---------- */

export type JobStatus = 'pending' | 'processing' | 'done' | 'error';

export interface SourceJob {
  source: SourceId;
  /** Id interno de la fuente (task_id en AppEEARS). */
  externalId: string;
  status: JobStatus;
  progress?: number;
  /** Lo que haga falta para poder terminar el trabajo después. */
  context: Record<string, unknown>;
  result?: ParameterSeries[];
  error?: string;
}

/* ---------- Contrato que implementa cada fuente ---------- */

export interface DataSource {
  readonly id: SourceId;
  /** true si responde al instante (Meteomatics); false si trabaja con tareas (AppEEARS). */
  readonly synchronous: boolean;
  /** Envía la consulta. Las fuentes síncronas devuelven el trabajo ya en "done". */
  submit(query: BalamQuery): Promise<SourceJob>;
  /** Consulta el estado y, si ya terminó, descarga y normaliza el resultado. */
  refresh(job: SourceJob): Promise<SourceJob>;
}

/* ---------- Catálogo unificado ---------- */

export interface CatalogEntry {
  /** Cadena Balam lista para usar en una consulta. */
  parameter: string;
  source: SourceId;
  dataset: string;
  variable: string;
  description: string;
  unit: string;
  rawUnit: string;
  isQuality: boolean;
  scaleFactor: number | null;
  addOffset: number | null;
  fillValue: number | string | null;
  validRange: [number | null, number | null];
  qualityLayers: string[];
  qualityDataset: string | null;
  dataType: string | null;
  platform: string;
  provider: string;
  resolution: string;
  resolutionMeters: number | null;
  rasterType: string;
  temporalGranularity: string;
  temporalStart: string | null;
  temporalEnd: string | null; // null = vigente ("Present")
  doi: string | null;
  docUrl: string | null;
  queryModes: ('point' | 'area')[];
  synchronous: boolean;
}
