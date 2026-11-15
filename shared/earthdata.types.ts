/** A preloaded NASA AppEEARS variable: zonal statistics stored per zone by the daily ingestion. */
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
  /** What the store holds right now; null until the first ingestion finishes. */
  stored: { firstDate: string; lastDate: string; zones: number } | null;
  /** True while a request for this variable is being processed by NASA AppEEARS. */
  ingesting: boolean;
}

/** An administrative zone with stored series. Coordinates are the polygon centroid, used only as a label position. */
export interface EarthdataZone {
  id: string;
  name: string;
  level: string;
  country: string;
  latitude: number;
  longitude: number;
}
