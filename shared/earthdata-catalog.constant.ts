/** NASA Earthdata workflow: NASA AppEEARS series for Honduras and Central America, stored in the project database as they are requested. */
export const EARTHDATA_PROVIDER = 'NASA AppEEARS';
export const EARTHDATA_SOURCE_URL = 'https://appeears.earthdatacloud.nasa.gov/';
export const EARTHDATA_ATTRIBUTION = 'NASA AppEEARS (LP DAAC / NSIDC DAAC, Earthdata Login), stored in the project database once requested. '
  + 'This workflow covers Honduras and Central America. A "pixel" series is the value of the product pixel at the place; an "area mean" is the mean over an administrative polygon (geoBoundaries, ODbL 1.0, © OpenStreetMap contributors). '
  + 'Values are converted to the display unit. Missing values stay missing; nothing is imputed.';

/**
 * The only region this workflow serves. A place is accepted when its country is one of these and its
 * coordinates fall inside the bounds; bare coordinates, which carry no country, are checked against the
 * bounds alone, so a point just across a border (southern Mexico, north-western Colombia) can pass.
 */
export const EARTHDATA_REGION = {
  name: 'Honduras and Central America',
  countries: ['Honduras', 'Guatemala', 'El Salvador', 'Nicaragua', 'Costa Rica', 'Panama', 'Belize'],
  countryCodes: ['HN', 'GT', 'SV', 'NI', 'CR', 'PA', 'BZ'],
  bounds: { south: 7.0, north: 18.6, west: -92.4, east: -77.1 },
} as const;

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
  'NDVI in Tegucigalpa from 2005 to 2024',
  'Land surface temperature in San Salvador and Guatemala City since 2010',
  'Evapotranspiration in the Olancho department, 2001–2023',
  'Surface soil moisture in Managua, Nicaragua from 2016 to 2025',
];
