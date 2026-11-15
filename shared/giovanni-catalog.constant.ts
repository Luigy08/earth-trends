import type { ClimateMetric } from './types';
import type { GiovanniUnitConversion, GiovanniVariable } from './giovanni.types';

export const GIOVANNI_TIME_SERIES_URL = 'https://api.giovanni.earthdata.nasa.gov/timeseries';
export const EARTHDATA_TOKEN_URL = 'https://urs.earthdata.nasa.gov/api/users/find_or_create_token';
export const GIOVANNI_ATTRIBUTION = 'NASA GES DISC Giovanni time series service (Earthdata Login). Values are the nearest grid cell to the requested point.';

export const GIOVANNI_CATALOG_VERSION = '2026-11-15';
export const GIOVANNI_CATALOG_SOURCE = 'https://giovanni.gsfc.nasa.gov/giovanni/';
const M2SLV = 'https://disc.gsfc.nasa.gov/datasets/M2TMNXSLV_5.12.4/summary';
const M2FLX = 'https://disc.gsfc.nasa.gov/datasets/M2TMNXFLX_5.12.4/summary';
const slv = (variable: string, description: string, unit: string, domain: string, extra: Partial<GiovanniVariable> = {}): GiovanniVariable => ({
  id: `M2TMNXSLV_5_12_4_${variable}`, description, unit, domain, temporalResolution: 'monthly', firstYear: 1980,
  dataset: `MERRA-2 tavgM_2d_slv_Nx (M2TMNXSLV 5.12.4): ${description.toLowerCase()}, monthly mean`, documentationUrl: M2SLV, ...extra });
const flx = (variable: string, description: string, unit: string, domain: string, extra: Partial<GiovanniVariable> = {}): GiovanniVariable => ({
  id: `M2TMNXFLX_5_12_4_${variable}`, description, unit, domain, temporalResolution: 'monthly', firstYear: 1980,
  dataset: `MERRA-2 tavgM_2d_flx_Nx (M2TMNXFLX 5.12.4): ${description.toLowerCase()}, monthly mean`, documentationUrl: M2FLX, ...extra });

/**
 * Curated Giovanni data IDs (<collection shortname>_<version>_<variable>). Giovanni's time series service decides
 * whether an ID is served; a refusal is reported as source unavailable. Trend variables share the *meaning* of the
 * Meteomatics trend parameters, not the product: MERRA-2 is a ~0.5°×0.625° reanalysis, IMERG is 0.1° satellite precipitation.
 * Re-check GES DISC metadata (units, aggregation, coverage) when changing a variable.
 */
export const GIOVANNI_VARIABLES: readonly GiovanniVariable[] = [
  slv('T2M', '2-metre air temperature', 'K', 'Temperature', { metric: 'temperature', meteomaticsParameter: 't_mean_2m_24h:C' }),
  slv('TS', 'Surface skin temperature', 'K', 'Temperature'),
  slv('QV2M', '2-metre specific humidity', 'kg kg-1', 'Humidity'),
  slv('TQV', 'Total precipitable water vapor', 'kg m-2', 'Humidity'),
  slv('SLP', 'Sea level pressure', 'Pa', 'Pressure'),
  slv('U10M', '10-metre eastward wind', 'm s-1', 'Wind'),
  slv('V10M', '10-metre northward wind', 'm s-1', 'Wind'),
  flx('PRECTOT', 'Total precipitation', 'kg m-2 s-1', 'Precipitation', { metric: 'precipitation', meteomaticsParameter: 'precip_24h:mm' }),
  flx('PRECSNO', 'Snowfall', 'kg m-2 s-1', 'Precipitation'),
  flx('EVAP', 'Evaporation from turbulence', 'kg m-2 s-1', 'Surface fluxes'),
  { id: 'GPM_3IMERGM_07_precipitation', description: 'IMERG Final precipitation rate (monthly)', unit: 'mm/hr', domain: 'Precipitation',
    temporalResolution: 'monthly', firstYear: 1998, dataset: 'GPM IMERG Final Precipitation L3 monthly 0.1° (GPM_3IMERGM 07): monthly mean rate',
    documentationUrl: 'https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary' },
  { id: 'GPM_3IMERGDF_07_precipitation', description: 'IMERG Final precipitation (daily)', unit: 'mm/day', domain: 'Precipitation',
    temporalResolution: 'daily', firstYear: 1998, dataset: 'GPM IMERG Final Precipitation L3 daily 0.1° (GPM_3IMERGDF 07): daily accumulation',
    documentationUrl: 'https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGDF_07/summary' },
];

export const GIOVANNI_SEARCH_SUGGESTIONS = [
  'Monthly 2 m air temperature in Madrid from 1990 to 2024',
  'Total precipitation in Tegucigalpa since 2000',
  'Daily IMERG precipitation in Lagos during 2023',
  'Sea level pressure over Reykjavik, 1980–2024',
] as const;

/** One product per metric for trend analysis, so a series never mixes products. */
export const GIOVANNI_DEFAULT_VARIABLE: Record<ClimateMetric, string> = {
  temperature: 'M2TMNXSLV_5_12_4_T2M',
  precipitation: 'M2TMNXFLX_5_12_4_PRECTOT',
};

export const GIOVANNI_UNIT_CONVERSIONS: Record<ClimateMetric, readonly GiovanniUnitConversion[]> = {
  temperature: [
    { pattern: /^k(elvin)?$/i, factor: 1, offset: -273.15 },
    { pattern: /^(deg ?c|°c|c|celsius|degc)$/i, factor: 1, offset: 0 },
  ],
  precipitation: [
    { pattern: /^(kg ?m-2 ?s-1|kg\/m\^?2\/s|kg m\*\*-2 s\*\*-1)$/i, factor: 86400, offset: 0 },
    { pattern: /^(mm ?\/ ?(hr|h|hour)|mm hr-1|mm h-1)$/i, factor: 24, offset: 0 },
    { pattern: /^(mm ?\/ ?(day|d)|mm day-1|mm d-1)$/i, factor: 1, offset: 0 },
  ],
};
