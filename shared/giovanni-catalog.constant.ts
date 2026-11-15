import type { ClimateMetric } from './types';
import type { GiovanniUnitConversion, GiovanniVariable } from './giovanni.types';

export const GIOVANNI_TIME_SERIES_URL = 'https://api.giovanni.earthdata.nasa.gov/timeseries';
export const EARTHDATA_TOKEN_URL = 'https://urs.earthdata.nasa.gov/api/users/find_or_create_token';
export const GIOVANNI_ATTRIBUTION = 'NASA GES DISC Giovanni time series service (Earthdata Login). Values are the nearest grid cell to the requested point.';

/**
 * Giovanni data IDs (<collection shortname>_<version>_<variable>). These match the meaning of the Meteomatics parameters
 * used for trends, not the product: MERRA-2 is a ~0.5°×0.625° reanalysis, IMERG is 0.1° satellite precipitation.
 * Re-check GES DISC metadata (units, aggregation, coverage) when changing a variable.
 */
export const GIOVANNI_VARIABLES: readonly GiovanniVariable[] = [
  { id: 'M2TMNXSLV_5_12_4_T2M', metric: 'temperature', meteomaticsParameter: 't_mean_2m_24h:C', firstYear: 1980,
    dataset: 'MERRA-2 tavgM_2d_slv_Nx (M2TMNXSLV 5.12.4): 2-metre air temperature, monthly mean',
    documentationUrl: 'https://disc.gsfc.nasa.gov/datasets/M2TMNXSLV_5.12.4/summary' },
  { id: 'M2TMNXFLX_5_12_4_PRECTOT', metric: 'precipitation', meteomaticsParameter: 'precip_24h:mm', firstYear: 1980,
    dataset: 'MERRA-2 tavgM_2d_flx_Nx (M2TMNXFLX 5.12.4): total precipitation, monthly mean rate',
    documentationUrl: 'https://disc.gsfc.nasa.gov/datasets/M2TMNXFLX_5.12.4/summary' },
  { id: 'GPM_3IMERGM_07_precipitation', metric: 'precipitation', meteomaticsParameter: 'precip_24h:mm', firstYear: 1998,
    dataset: 'GPM IMERG Final Precipitation L3 monthly 0.1° (GPM_3IMERGM 07): monthly mean rate',
    documentationUrl: 'https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary' },
];

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
