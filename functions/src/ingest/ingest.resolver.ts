import type { DateValue, ParameterSeries, TimeRange } from '../datasources/datasources.types';
import type { ObservationRow } from './ingest.types';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const toDateString = (date: Date): string => date.toISOString().slice(0, 10);
export const fromDateString = (date: string): Date => new Date(`${date}T00:00:00Z`);
export const addDays = (date: string, days: number): string => toDateString(new Date(fromDateString(date).getTime() + days * DAY_MS));
export const daysBetween = (from: string, to: string): number => Math.round((fromDateString(to).getTime() - fromDateString(from).getTime()) / DAY_MS);

/** "appeears/MOD11A1.061/LST_Day_1km:C" → "appeears" */
export const sourceOf = (parameter: string): string => parameter.split('/')[0] ?? '';
/** "appeears/MOD11A1.061/LST_Day_1km:C" → "C" */
export const unitOf = (parameter: string): string => parameter.slice(parameter.lastIndexOf(':') + 1);

/** Splits an inclusive date range into consecutive blocks of at most `chunkYears` years. */
export function splitRange(start: string, end: string, chunkYears: number): { start: string; end: string }[] {
  return splitRangeByMonths(start, end, chunkYears * 12);
}

/** Splits an inclusive date range into consecutive blocks of at most `chunkMonths` months. */
export function splitRangeByMonths(start: string, end: string, chunkMonths: number): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  for (let cursor = start; cursor <= end; ) {
    const next = fromDateString(cursor);
    next.setUTCMonth(next.getUTCMonth() + Math.max(1, Math.round(chunkMonths)));
    const chunkEnd = addDays(toDateString(next), -1);
    const stop = chunkEnd < end ? chunkEnd : end;
    chunks.push({ start: cursor, end: stop });
    cursor = addDays(stop, 1);
  }
  return chunks;
}

/**
 * The last `hours` whole hours ending at the current hour, for sources with a short history window.
 * `label` is the local calendar date (at `utcOffsetHours`) on which the window starts.
 */
export function trailingWindow(now: Date, hours: number, utcOffsetHours: number): { time: TimeRange; label: string } {
  const end = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
  const start = new Date(end.getTime() - (hours - 1) * HOUR_MS);
  return { time: { start, end }, label: toDateString(new Date(start.getTime() + utcOffsetHours * HOUR_MS)) };
}

const finite = (value: number | null | undefined): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Turns one parameter series into daily rows, one per zone and date.
 * - A single sample per day keeps the statistics the source provided (area mean, min, max…).
 * - Several samples per day (hourly or 3-hourly sources) become their mean; `count` is then the
 *   number of valid samples, and the value is null when fewer than `minSamples` are valid.
 * - With `label`, the whole series is one day: used for trailing windows that straddle midnight.
 * Missing values stay null: nothing is imputed.
 */
export function toObservationRows(
  series: ParameterSeries,
  context: { variableId: string; zoneIds: ReadonlySet<string>; minSamples?: number; label?: string },
): ObservationRow[] {
  const minSamples = Math.max(1, context.minSamples ?? 1);
  const rows: ObservationRow[] = [];
  for (const coordinate of series.coordinates) {
    if (!coordinate.id || !context.zoneIds.has(coordinate.id)) continue;
    const byDate = new Map<string, DateValue[]>();
    for (const sample of coordinate.dates) {
      const date = context.label ?? sample.date.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const bucket = byDate.get(date);
      if (bucket) bucket.push(sample);
      else byDate.set(date, [sample]);
    }
    for (const [date, samples] of byDate) {
      const base = { variableId: context.variableId, source: series.source, parameter: series.parameter, zoneId: coordinate.id, date };
      const only = samples[0];
      if (samples.length === 1 && only && minSamples === 1) {
        const count = finite(only.stats?.count);
        rows.push({ ...base, value: finite(only.value), min: finite(only.stats?.min), max: finite(only.stats?.max),
          median: finite(only.stats?.median), std: finite(only.stats?.std), count: count === null ? null : Math.round(count) });
        continue;
      }
      const values = samples.map((s) => finite(s.value)).filter((v): v is number => v !== null);
      const lows = samples.map((s) => finite(s.stats?.min) ?? finite(s.value)).filter((v): v is number => v !== null);
      const highs = samples.map((s) => finite(s.stats?.max) ?? finite(s.value)).filter((v): v is number => v !== null);
      rows.push({
        ...base,
        value: values.length >= minSamples ? values.reduce((a, b) => a + b, 0) / values.length : null,
        min: lows.length ? Math.min(...lows) : null,
        max: highs.length ? Math.max(...highs) : null,
        median: null,
        std: null,
        count: values.length,
      });
    }
  }
  return rows;
}
