import type { ClimateMetric, MonthlyObservation } from './types';
import type { GiovanniCsv, GiovanniUnitConversion } from './giovanni.types';

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

/**
 * One value per calendar month. Monthly products map 1:1; daily products need every day of the month.
 * Fill values, non-finite values and incomplete months stay null and are never imputed.
 */
export function resolveGiovanniMonthly(csv: GiovanniCsv, convert: (value: number) => number,
  startYear: number, endYear: number): MonthlyObservation[] {
  const fillValue = csv.headers.fill_value !== undefined ? Number(csv.headers.fill_value) : undefined;
  const months = new Map<string, { samples: number; days: Map<number, number> }>();
  for (const row of csv.rows) {
    const iso = row.timestamp.replace(' ', 'T');
    const date = new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
    if (!Number.isFinite(date.getTime())) continue;
    const year = date.getUTCFullYear();
    if (year < startYear || year > endYear) continue;
    const key = `${year}-${date.getUTCMonth() + 1}`;
    const bucket = months.get(key) ?? { samples: 0, days: new Map<number, number>() };
    bucket.samples++;
    if (row.value !== null && row.value !== fillValue && Math.abs(row.value) < 1e14) bucket.days.set(date.getUTCDate(), convert(row.value));
    months.set(key, bucket);
  }
  const monthly: MonthlyObservation[] = [];
  for (let year = startYear; year <= endYear; year++) {
    for (let month = 1; month <= 12; month++) {
      const bucket = months.get(`${year}-${month}`);
      const values = bucket ? [...bucket.days.values()] : [];
      const value = bucket?.samples === 1 && values.length === 1 ? values[0]!
        : bucket && values.length === daysInMonth(year, month) ? values.reduce((a, b) => a + b, 0) / values.length : null;
      monthly.push({ year, month, value: value === null ? null : Number(value.toFixed(4)) });
    }
  }
  return monthly;
}
