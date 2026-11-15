import type { ClimateMetric, MonthlyObservation } from './types';
import type { GiovanniCsv, GiovanniUnitConversion, GiovanniVariable } from './giovanni.types';

/** Parses Giovanni time-series CSV: "key,value" metadata lines, a column header line, then "timestamp,value" rows. */
export function parseGiovanniCsv(text: string): GiovanniCsv {
  const headers: Record<string, string> = {};
  const rows: GiovanniCsv['rows'] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [first = '', ...rest] = line.split(',');
    const second = rest.join(',').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(first)) {
      const value = second === '' ? null : Number(second);
      rows.push({ timestamp: first.trim(), value: value !== null && Number.isFinite(value) ? value : null });
    } else if (rows.length === 0 && rest.length) {
      headers[first.trim().toLowerCase()] = second;
    }
  }
  return { headers, rows };
}

/** Returns the conversion for the unit Giovanni reported, or null when the unit is not explicitly verified. */
export function resolveGiovanniConversion(conversions: Record<ClimateMetric, readonly GiovanniUnitConversion[]>,
  metric: ClimateMetric, unit: string | undefined): ((value: number) => number) | null {
  const match = conversions[metric].find(({ pattern }) => pattern.test((unit ?? '').trim()));
  return match ? value => value * match.factor + match.offset : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Valid samples per complete day: hourly products have 24, daily products 1. Monthly products are matched 1:1 instead. */
export function giovanniSamplesPerDay(temporalResolution: GiovanniVariable['temporalResolution']): number {
  return temporalResolution === 'hourly' ? 24 : 1;
}

function isValid(value: number | null, fillValue: number | undefined): value is number {
  return value !== null && value !== fillValue && Number.isFinite(value) && Math.abs(value) < 1e14;
}

function utcDate(timestamp: string): Date | null {
  const iso = timestamp.trim().replace(' ', 'T');
  const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Hourly rows to one mean per UTC day. A day needs all 24 valid hours, otherwise it is null; nothing is imputed.
 * Giovanni variables are means or rates, so the daily value is the mean of the hourly values.
 */
export function resolveGiovanniDaily(csv: GiovanniCsv): GiovanniCsv {
  const fillValue = csv.headers.fill_value !== undefined ? Number(csv.headers.fill_value) : undefined;
  const days = new Map<string, Map<number, number | null>>();
  for (const row of csv.rows) {
    const date = utcDate(row.timestamp);
    if (!date) continue;
    const day = date.toISOString().slice(0, 10);
    const hours = days.get(day) ?? new Map<number, number | null>();
    hours.set(date.getTime(), isValid(row.value, fillValue) ? row.value : null);
    days.set(day, hours);
  }
  const rows = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, hours]) => {
    const values = [...hours.values()].filter((value): value is number => value !== null);
    return { timestamp: `${day}T00:00:00Z`, value: values.length === 24 ? values.reduce((a, b) => a + b, 0) / 24 : null };
  });
  return { headers: { ...csv.headers }, rows };
}

/**
 * One value per calendar month. Monthly products map 1:1; daily and hourly products need every day of the month,
 * each with all `samplesPerDay` samples. Fill values, non-finite values and incomplete months stay null and are never imputed.
 */
export function resolveGiovanniMonthly(csv: GiovanniCsv, convert: (value: number) => number,
  startYear: number, endYear: number, samplesPerDay = 1): MonthlyObservation[] {
  const fillValue = csv.headers.fill_value !== undefined ? Number(csv.headers.fill_value) : undefined;
  const months = new Map<string, { samples: number; days: Map<number, Map<number, number | null>> }>();
  for (const row of csv.rows) {
    const date = utcDate(row.timestamp);
    if (!date) continue;
    const year = date.getUTCFullYear();
    if (year < startYear || year > endYear) continue;
    const key = `${year}-${date.getUTCMonth() + 1}`;
    const bucket = months.get(key) ?? { samples: 0, days: new Map<number, Map<number, number | null>>() };
    bucket.samples++;
    const day = bucket.days.get(date.getUTCDate()) ?? new Map<number, number | null>();
    day.set(date.getTime(), isValid(row.value, fillValue) ? convert(row.value) : null);
    bucket.days.set(date.getUTCDate(), day);
    months.set(key, bucket);
  }
  const monthly: MonthlyObservation[] = [];
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const bucket = months.get(`${year}-${month}`);
      const samples = bucket ? [...bucket.days.values()].map(day => [...day.values()]) : [];
      const completeDays = samples.filter(day => day.length === samplesPerDay && day.every(value => value !== null)) as number[][];
      const single = bucket?.samples === 1 && samplesPerDay === 1 ? samples[0]?.[0] ?? null : null;
      const values = completeDays.flat();
      const value = single !== null ? single
        : bucket && completeDays.length === daysInMonth(year, month) ? values.reduce((a, b) => a + b, 0) / values.length : null;
      monthly.push({ year, month, value: value === null ? null : Number(value.toFixed(4)) });
    }
  }
  return monthly;
}
