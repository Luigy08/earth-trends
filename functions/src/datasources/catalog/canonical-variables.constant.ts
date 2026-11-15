/**
 * Variables canónicas de Balam: un nombre estable para el frontend y, por
 * cada fuente, el parámetro exacto que la provee. Así el usuario elige
 * "Temperatura de superficie" y Balam decide si la pide a Meteomatics o a
 * AppEEARS (o compara ambas).
 *
 * Capas de AppEEARS verificadas contra /api/product/{id} el 2026-11-15.
 * "equivalence": exact = misma magnitud física; approx = magnitud relacionada
 * (p.ej. temperatura del aire a 2 m vs. temperatura radiativa de la superficie).
 */

export interface SourceBinding {
  parameter: string;
  equivalence: 'exact' | 'approx';
  resolution?: string;
  temporal?: string;
  since?: string;
  coverage?: string;
  notes?: string;
}

export interface CanonicalVariable {
  id: string;
  label: string;
  unit: string; // unidad en la que Balam muestra la variable
  category: 'temperature' | 'water' | 'vegetation' | 'snow' | 'fire' | 'radiation' | 'surface';
  bindings: SourceBinding[];
}

export const CANONICAL_VARIABLES: CanonicalVariable[] = [
  {
    id: 'air_temperature_2m',
    label: 'Air temperature at 2 m',
    unit: 'C',
    category: 'temperature',
    bindings: [
      { parameter: 'meteomatics/t_2m:C', equivalence: 'exact', temporal: 'hourly', coverage: 'global' },
      { parameter: 'appeears/DAYMET.004/tmax:C', equivalence: 'approx', resolution: '1000m', temporal: 'daily', since: '1950-01-01', coverage: 'North America (USA, Canada, Mexico, Hawaii, Puerto Rico)', notes: 'Daily maximum; does not cover Central America' },
      { parameter: 'appeears/DAYMET.004/tmin:C', equivalence: 'approx', resolution: '1000m', temporal: 'daily', since: '1950-01-01', coverage: 'North America', notes: 'Daily minimum' },
      { parameter: 'appeears/ECO_L3T_MET.002/Ta:C', equivalence: 'exact', resolution: '70m', temporal: 'per ISS overpass', since: '2018-07-10', coverage: 'near-global (ISS latitudes)' },
    ],
  },
  {
    id: 'land_surface_temperature_day',
    label: 'Land surface temperature (day)',
    unit: 'C',
    category: 'temperature',
    bindings: [
      { parameter: 'appeears/MOD11A1.061/LST_Day_1km:C', equivalence: 'exact', resolution: '1000m', temporal: 'daily', since: '2000-02-24', coverage: 'global', notes: 'Terra ~10:30 local time' },
      { parameter: 'appeears/MYD11A1.061/LST_Day_1km:C', equivalence: 'exact', resolution: '1000m', temporal: 'daily', since: '2002-07-04', coverage: 'global', notes: 'Aqua ~13:30 local time' },
      { parameter: 'appeears/VNP21A1D.002/LST_1KM:C', equivalence: 'exact', resolution: '1000m', temporal: 'daily', since: '2012-01-17', coverage: 'global', notes: 'VIIRS, MODIS continuity' },
      { parameter: 'meteomatics/t_0m:C', equivalence: 'approx', temporal: 'hourly', coverage: 'global', notes: 'Modelled ground surface temperature, not satellite LST' },
    ],
  },
  {
    id: 'land_surface_temperature_night',
    label: 'Land surface temperature (night)',
    unit: 'C',
    category: 'temperature',
    bindings: [
      { parameter: 'appeears/MOD11A1.061/LST_Night_1km:C', equivalence: 'exact', resolution: '1000m', temporal: 'daily', since: '2000-02-24', coverage: 'global' },
      { parameter: 'appeears/MYD11A1.061/LST_Night_1km:C', equivalence: 'exact', resolution: '1000m', temporal: 'daily', since: '2002-07-04', coverage: 'global' },
    ],
  },
  {
    id: 'ndvi',
    label: 'NDVI vegetation index',
    unit: 'idx',
    category: 'vegetation',
    bindings: [
      { parameter: 'appeears/MOD13Q1.061/_250m_16_days_NDVI:idx', equivalence: 'exact', resolution: '250m', temporal: '16 days', since: '2000-02-18', coverage: 'global' },
      { parameter: 'appeears/VNP13A1.002/500_m_16_days_NDVI:idx', equivalence: 'exact', resolution: '500m', temporal: '16 days', since: '2012-01-17', coverage: 'global' },
      { parameter: 'meteomatics/sat_ndvi:idx', equivalence: 'exact', coverage: 'subject to Meteomatics satellite availability' },
    ],
  },
  {
    id: 'evi',
    label: 'Enhanced vegetation index (EVI)',
    unit: 'idx',
    category: 'vegetation',
    bindings: [
      { parameter: 'appeears/MOD13Q1.061/_250m_16_days_EVI:idx', equivalence: 'exact', resolution: '250m', temporal: '16 days', since: '2000-02-18', coverage: 'global' },
      { parameter: 'appeears/VNP13A1.002/500_m_16_days_EVI:idx', equivalence: 'exact', resolution: '500m', temporal: '16 days', since: '2012-01-17', coverage: 'global' },
    ],
  },
  {
    id: 'leaf_area_index',
    label: 'Leaf area index (LAI)',
    unit: 'm2m2',
    category: 'vegetation',
    bindings: [{ parameter: 'appeears/MCD15A2H.061/Lai_500m:m2m2', equivalence: 'exact', resolution: '500m', temporal: '8 days', since: '2002-07-04', coverage: 'global' }],
  },
  {
    id: 'gross_primary_productivity',
    label: 'Gross primary productivity (GPP)',
    unit: 'kgCm2_8d',
    category: 'vegetation',
    bindings: [{ parameter: 'appeears/MOD17A2HGF.061/Gpp_500m:kgCm2_8d', equivalence: 'exact', resolution: '500m', temporal: '8 days', coverage: 'global' }],
  },
  {
    id: 'soil_moisture_surface',
    label: 'Surface soil moisture',
    unit: 'm3m3',
    category: 'water',
    bindings: [
      { parameter: 'meteomatics/volumetric_soil_water_-5cm:m3m3', equivalence: 'exact', notes: '0–7 cm layer', coverage: 'global' },
      { parameter: 'appeears/SPL4SMGP.008/Geophysical_Data_sm_surface:m3m3', equivalence: 'exact', resolution: '9000m', temporal: 'daily (3-hourly at source)', since: '2015-03-31', coverage: 'global', notes: 'SMAP L4, 0–5 cm layer' },
      { parameter: 'appeears/SPL3SMP_E.006/Soil_Moisture_Retrieval_Data_AM_soil_moisture:m3m3', equivalence: 'exact', resolution: '9000m', temporal: 'daily', since: '2015-03-31', coverage: 'global', notes: 'SMAP L3 (AM overpass); the catalog lists no unit, m³/m³ assumed' },
    ],
  },
  {
    id: 'soil_moisture_rootzone',
    label: 'Root-zone soil moisture',
    unit: 'm3m3',
    category: 'water',
    bindings: [
      { parameter: 'appeears/SPL4SMGP.008/Geophysical_Data_sm_rootzone:m3m3', equivalence: 'exact', resolution: '9000m', temporal: 'daily', since: '2015-03-31', coverage: 'global', notes: '0–100 cm' },
      { parameter: 'meteomatics/volumetric_soil_water_-50cm:m3m3', equivalence: 'approx', notes: '28–100 cm layer' },
    ],
  },
  {
    id: 'precipitation_daily',
    label: 'Daily precipitation',
    unit: 'mm',
    category: 'water',
    bindings: [
      { parameter: 'meteomatics/precip_24h:mm', equivalence: 'exact', coverage: 'global' },
      { parameter: 'appeears/SPL4SMGP.008/Geophysical_Data_precipitation_total_surface_flux:mm', equivalence: 'approx', resolution: '9000m', since: '2015-03-31', coverage: 'global', notes: 'Flux in kg/m²/s converted to mm/day (×86400)' },
      { parameter: 'appeears/DAYMET.004/prcp:mm', equivalence: 'exact', resolution: '1000m', since: '1950-01-01', coverage: 'North America' },
    ],
  },
  {
    id: 'evapotranspiration',
    label: 'Evapotranspiration',
    unit: 'mmd',
    category: 'water',
    bindings: [
      { parameter: 'meteomatics/evapotranspiration_24h:mm', equivalence: 'exact', coverage: 'global', notes: 'mm accumulated over 24 h = mm/day' },
      { parameter: 'appeears/MOD16A2GF.061/ET_500m:mmd', equivalence: 'exact', resolution: '500m', temporal: '8 days', coverage: 'global', notes: 'kg/m²/8 days converted to mm/day (÷8)' },
    ],
  },
  {
    id: 'potential_evapotranspiration',
    label: 'Potential evapotranspiration',
    unit: 'mmd',
    category: 'water',
    bindings: [{ parameter: 'appeears/MOD16A2GF.061/PET_500m:mmd', equivalence: 'exact', resolution: '500m', temporal: '8 days', coverage: 'global' }],
  },
  {
    id: 'relative_humidity',
    label: 'Relative humidity',
    unit: 'p',
    category: 'water',
    bindings: [
      { parameter: 'meteomatics/relative_humidity_2m:p', equivalence: 'exact', coverage: 'global' },
      { parameter: 'appeears/ECO_L3T_MET.002/RH:p', equivalence: 'exact', resolution: '70m', since: '2018-07-10', notes: 'Delivered as a 0–1 ratio; converted to %' },
    ],
  },
  {
    id: 'snow_cover',
    label: 'Snow cover (NDSI)',
    unit: 'p',
    category: 'snow',
    bindings: [{ parameter: 'appeears/MOD10A1.061/NDSI_Snow_Cover:p', equivalence: 'exact', resolution: '500m', temporal: 'daily', coverage: 'global' }],
  },
  {
    id: 'albedo',
    label: 'Shortwave albedo',
    unit: 'idx',
    category: 'radiation',
    bindings: [{ parameter: 'appeears/MCD43A3.061/Albedo_WSA_shortwave:idx', equivalence: 'exact', resolution: '500m', temporal: 'daily', since: '2000-02-16', coverage: 'global' }],
  },
  {
    id: 'shortwave_radiation',
    label: 'Global solar radiation',
    unit: 'Wm2',
    category: 'radiation',
    bindings: [
      { parameter: 'meteomatics/global_rad:W', equivalence: 'exact', coverage: 'global' },
      { parameter: 'appeears/DAYMET.004/srad:Wm2', equivalence: 'exact', resolution: '1000m', coverage: 'North America', notes: 'Daytime mean' },
    ],
  },
  {
    id: 'burned_area',
    label: 'Burned area (day of year)',
    unit: 'idx',
    category: 'fire',
    bindings: [{ parameter: 'appeears/MCD64A1.061/Burn_Date:idx', equivalence: 'exact', resolution: '500m', temporal: 'monthly', coverage: 'global', notes: '0 = unburned; 1–366 = burn day of year' }],
  },
  {
    id: 'active_fire',
    label: 'Active fire detection',
    unit: 'idx',
    category: 'fire',
    bindings: [{ parameter: 'appeears/MOD14A2.061/FireMask:idx', equivalence: 'exact', resolution: '1000m', temporal: '8 days', coverage: 'global', notes: 'Classes 7–9 = fire (low/nominal/high confidence)' }],
  },
  {
    id: 'land_cover',
    label: 'Land cover (IGBP)',
    unit: 'idx',
    category: 'surface',
    bindings: [{ parameter: 'appeears/MCD12Q1.061/LC_Type1:idx', equivalence: 'exact', resolution: '500m', temporal: 'annual', since: '2001-01-01', coverage: 'global' }],
  },
  {
    id: 'tree_cover',
    label: 'Tree cover',
    unit: 'p',
    category: 'surface',
    bindings: [{ parameter: 'appeears/MOD44B.061/Percent_Tree_Cover:p', equivalence: 'exact', resolution: '250m', temporal: 'annual', coverage: 'global' }],
  },
  {
    id: 'elevation',
    label: 'Elevation',
    unit: 'm',
    category: 'surface',
    bindings: [{ parameter: 'appeears/NASADEM_NC.001/NASADEM_HGT:m', equivalence: 'exact', resolution: '30m', temporal: 'static', coverage: '56°S–60°N' }],
  },
];

/** Busca la mejor fuente disponible para una variable canónica. */
export function bindingsFor(id: string, preferSources: string[] = ['meteomatics', 'appeears']): SourceBinding[] {
  const v = CANONICAL_VARIABLES.find((x) => x.id === id);
  if (!v) return [];
  const rank = (b: SourceBinding) => {
    const i = preferSources.indexOf(b.parameter.split('/')[0] ?? '');
    return (b.equivalence === 'exact' ? 0 : 10) + (i < 0 ? 99 : i);
  };
  return [...v.bindings].sort((a, b) => rank(a) - rank(b));
}
