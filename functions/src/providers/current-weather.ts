import type { CurrentWeather, Location } from '../../../shared/types';
import type { CacheStore } from '../backend.types';
import { CONFIG } from '../config.constant';
import { fetchJson } from '../http';
import { meteomaticsHeaders, meteomaticsResponseSchema } from './meteomatics';

export const WEATHER_NOTICE = 'Current weather provides context only; it does not demonstrate a long-term climate trend. Precipitation is for the previous hour.';

export async function getCurrentWeather(location: Location, cache: CacheStore): Promise<CurrentWeather> {
  const empty: CurrentWeather = { status: CONFIG.currentWeather ? 'source_unavailable' : 'disabled', observedAt: null,
    temperatureC: null, precipitationMm: null, provenance: null, notice: WEATHER_NOTICE };
  if (!CONFIG.currentWeather) return empty;
  const headers = meteomaticsHeaders();
  if (!headers) return empty;
  const url = `https://api.meteomatics.com/now/t_2m:C,precip_1h:mm/${location.latitude},${location.longitude}/json`;
  const cached = await cache.get<CurrentWeather>(url);
  if (cached) return cached;
  try {
    const parsed = meteomaticsResponseSchema.parse(await fetchJson(url, 'Meteomatics', headers));
    const temperature = parsed.data.find(d => d.parameter === 't_2m:C')?.coordinates[0]?.dates[0];
    const precipitation = parsed.data.find(d => d.parameter === 'precip_1h:mm')?.coordinates[0]?.dates[0];
    if (!temperature || temperature.value === null || temperature.value <= -666 || !Number.isFinite(temperature.value)) return empty;
    const result: CurrentWeather = { status: 'available', observedAt: temperature.date,
      temperatureC: temperature.value, precipitationMm: precipitation?.value != null && precipitation.value >= 0 ? precipitation.value : null, notice: WEATHER_NOTICE,
      provenance: { provider: 'Meteomatics', dataset: 'Tiempo actual Meteomatics', parameters: ['t_2m:C', 'precip_1h:mm'],
        sourceUrl: url.toString(), retrievedAt: new Date().toISOString(), temporalResolution: 'current', isHistorical: false,
        attribution: 'Meteomatics Weather API',
      } };
    await cache.set(url.toString(), result, 900);
    return result;
  } catch { return empty; }
}
