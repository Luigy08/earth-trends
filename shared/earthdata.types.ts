/** A NASA AppEEARS variable offered by the Earthdata workflow; its series are stored per place as they are requested. */
export interface EarthdataVariable {
  /** Canonical variable id, e.g. "ndvi". */
  id: string;
  description: string;
  domain: string;
  /** Display unit of the stored values (after conversion, e.g. K → °C). */
  unit: string;
  /** Full source parameter, e.g. "appeears/MOD13Q1.061/_250m_16_days_NDVI:idx". */
  parameter: string;
  /** AppEEARS product and version, e.g. "MOD13Q1.061". */
  dataset: string;
  temporalResolution: string;
  spatialResolution?: string;
  /** First date of the product, YYYY-MM-DD. */
  since: string | null;
  notes?: string;
  /** What the store holds right now across all places; null until a first series is stored. */
  stored: { firstDate: string; lastDate: string; zones: number } | null;
  /** True while a request for this variable is being processed by NASA AppEEARS. */
  ingesting: boolean;
}

/**
 * A place with stored series. An `area` is an administrative zone answered with the mean over its polygon
 * (its coordinates are the centroid, a label position); a `point` is any place on Earth answered with the
 * series of the satellite pixel at its coordinates.
 */
export interface EarthdataZone {
  id: string;
  name: string;
  level: string;
  country: string;
  latitude: number;
  longitude: number;
  kind: 'area' | 'point';
}
