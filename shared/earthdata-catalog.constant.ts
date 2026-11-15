/** NASA Earthdata workflow: zonal series from NASA AppEEARS, preloaded into the project store. */
export const EARTHDATA_PROVIDER = 'NASA AppEEARS';
export const EARTHDATA_SOURCE_URL = 'https://appeears.earthdatacloud.nasa.gov/';
export const EARTHDATA_ATTRIBUTION = 'NASA AppEEARS (LP DAAC / NSIDC DAAC, Earthdata Login) area statistics, preloaded into the project store by the daily ingestion. '
  + 'Each value is the mean over a department polygon (geoBoundaries, ODbL 1.0, © OpenStreetMap contributors), converted to the display unit. Missing values stay missing; nothing is imputed.';

/** Stored unit tokens → display units. */
export const EARTHDATA_UNIT_LABELS: Record<string, string> = { C: '°C', K: 'K', idx: 'index', mmd: 'mm/day', mm: 'mm', m3m3: 'm³/m³', p: '%' };

export const EARTHDATA_LIMITS = {
  maxVariables: 3,
  maxZones: 4,
  /** Keeps one response, and the saved session, well under the callable and Firestore limits. */
  maxValues: 60_000,
  /** A stored series ending this many days before the requested end counts as incomplete and is requested again. */
  staleDays: 60,
  /** MODIS Terra, the longest series offered, starts in 2000. */
  firstYear: 2000,
} as const;

export const EARTHDATA_SEARCH_SUGGESTIONS = [
  'NDVI in Francisco Morazán from 2005 to 2024',
  'Land surface temperature in Cortés and Choluteca since 2010',
  'Evapotranspiration in Olancho, 2001–2023',
  'Surface soil moisture in Valle from 2016 to 2025',
];
