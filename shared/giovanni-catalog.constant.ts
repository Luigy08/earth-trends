import type { ClimateMetric } from './types';
import type { GiovanniUnitConversion, GiovanniVariable } from './giovanni.types';

export const GIOVANNI_TIME_SERIES_URL = 'https://api.giovanni.earthdata.nasa.gov/timeseries';
export const EARTHDATA_TOKEN_URL = 'https://urs.earthdata.nasa.gov/api/users/find_or_create_token';
export const GIOVANNI_ATTRIBUTION = 'NASA GES DISC Giovanni time series service (Earthdata Login). Values are the nearest grid cell to the requested point.';

export const GIOVANNI_CATALOG_VERSION = '2026-11-15.2';
export const GIOVANNI_CATALOG_SOURCE = 'https://api.giovanni.earthdata.nasa.gov/configured-variables/';
const DOCS = (shortname: string) => `https://disc.gsfc.nasa.gov/datasets/${shortname}_5.12.4/summary`;
const merra = (collection: string, product: string, temporalResolution: GiovanniVariable['temporalResolution'], aggregation: string) =>
  (variable: string, description: string, unit: string, domain: string, extra: Partial<GiovanniVariable> = {}): GiovanniVariable => ({
    id: `${collection}_5_12_4_${variable}`, description, unit, domain, temporalResolution, firstYear: 1980,
    dataset: `MERRA-2 ${product} (${collection} 5.12.4): ${description.toLowerCase()}, ${aggregation}`, documentationUrl: DOCS(collection), ...extra });
// Giovanni's time series service does not serve the MERRA-2 monthly tavgM collections (M2TMNX*), so the catalog uses the
// hourly and daily collections it lists and the app averages them; M2IMNXASM is the only monthly MERRA-2 product offered.
const slvDaily = merra('M2SDNXSLV', 'statD_2d_slv_Nx', 'daily', 'daily mean');
const slvHourly = merra('M2T1NXSLV', 'tavg1_2d_slv_Nx', 'hourly', 'hourly mean');
const flxHourly = merra('M2T1NXFLX', 'tavg1_2d_flx_Nx', 'hourly', 'hourly mean');
const asmMonthly = merra('M2IMNXASM', 'instM_2d_asm_Nx', 'monthly', 'monthly mean of instantaneous values');

/**
 * Curated Giovanni data IDs (<collection shortname>_<version>_<variable>), each listed by Giovanni's configured-variables
 * endpoint. Hourly series are averaged to complete days and daily series to complete months in the app; incomplete periods stay
 * missing. Trend variables share the *meaning* of the Meteomatics trend parameters, not the product: MERRA-2 is a ~0.5°×0.625°
 * reanalysis, IMERG is 0.1° satellite precipitation. Re-check GES DISC metadata (units, aggregation, coverage) when changing a variable.
 */
export const GIOVANNI_VARIABLES: readonly GiovanniVariable[] = [
  slvDaily('T2MMEAN', '2-metre air temperature', 'K', 'Temperature', { metric: 'temperature', meteomaticsParameter: 't_mean_2m_24h:C' }),
  slvHourly('TS', 'Surface skin temperature', 'K', 'Temperature'),
  asmMonthly('QV2M', '2-metre specific humidity', 'kg kg-1', 'Humidity'),
  slvHourly('TQV', 'Total precipitable water vapor', 'kg m-2', 'Humidity'),
  slvHourly('U10M', '10-metre eastward wind', 'm s-1', 'Wind'),
  slvHourly('V10M', '10-metre northward wind', 'm s-1', 'Wind'),
  flxHourly('PRECTOT', 'Total precipitation', 'kg m-2 s-1', 'Precipitation', { metric: 'precipitation', meteomaticsParameter: 'precip_24h:mm' }),
  flxHourly('EVAP', 'Evaporation from turbulence', 'kg m-2 s-1', 'Surface fluxes'),
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
  '10-metre wind over Reykjavik, 2015–2024',
] as const;

/** One product per metric for trend analysis, so a series never mixes products. */
export const GIOVANNI_DEFAULT_VARIABLE: Record<ClimateMetric, string> = {
  temperature: 'M2SDNXSLV_5_12_4_T2MMEAN',
  precipitation: 'M2T1NXFLX_5_12_4_PRECTOT',
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
