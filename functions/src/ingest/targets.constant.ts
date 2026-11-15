import type { IngestTarget } from './ingest.types';

/** Honduras has no daylight saving time: America/Tegucigalpa is always UTC−6. */
export const HONDURAS_UTC_OFFSET_HOURS = -6;

/**
 * Preloaded for the challenge: the 18 departments of Honduras × these canonical variables.
 * Every `parameter` is a binding of its variable in canonical-variables.constant.ts.
 */
export const INGEST_TARGETS: readonly IngestTarget[] = [
  { variableId: 'land_surface_temperature_day', parameter: 'appeears/MOD11A1.061/LST_Day_1km:C', mode: 'range', zoneLevel: 'ADM1', since: '2000-02-24', chunkYears: 5, cadenceDays: 1 },
  { variableId: 'ndvi', parameter: 'appeears/MOD13Q1.061/_250m_16_days_NDVI:idx', mode: 'range', zoneLevel: 'ADM1', since: '2000-02-18', chunkYears: 5, cadenceDays: 16 },
  { variableId: 'evapotranspiration', parameter: 'appeears/MOD16A2GF.061/ET_500m:mmd', mode: 'range', zoneLevel: 'ADM1', since: '2000-01-01', chunkYears: 5, cadenceDays: 8 },
  // SMAP L4 is 3-hourly at source: yearly requests keep each statistics file small.
  { variableId: 'soil_moisture_surface', parameter: 'appeears/SPL4SMGP.008/Geophysical_Data_sm_surface:m3m3', mode: 'range', zoneLevel: 'ADM1', since: '2015-03-31', chunkYears: 1, cadenceDays: 1 },
  // The free Meteomatics plan only serves the last 24 h, so the series is built one day at a time:
  // 24 hourly values are averaged into one daily mean labelled with the local date the window starts on
  // (the 23:15 local run of the hourly schedule covers the whole local day).
  { variableId: 'air_temperature_2m', parameter: 'meteomatics/t_2m:C', mode: 'trailing', zoneLevel: 'ADM1', trailingHours: 24, step: 'PT1H', utcOffsetHours: HONDURAS_UTC_OFFSET_HOURS, minSamplesPerDay: 18 },
];

/** Default length of one historical request. */
export const DEFAULT_CHUNK_YEARS = 5;
/** A range that was already requested is not requested again within this window. */
export const RECHECK_HOURS = 20;
