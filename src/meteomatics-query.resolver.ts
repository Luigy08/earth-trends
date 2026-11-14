import type { MeteomaticsDisplayResult, MeteomaticsDisplayRow } from './meteomatics-query.types';

const ROW_LIMIT = 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finiteCoordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function appendValue(rows: MeteomaticsDisplayRow[], parameter: unknown, date: unknown,
  location: Record<string, unknown>, value: unknown) {
  const validValue = typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' || value === null;
  if (!validValue || typeof parameter !== 'string' || typeof date !== 'string') return;
  rows.push({ parameter, date,
    latitude: finiteCoordinate(location.lat ?? location.latitude),
    longitude: finiteCoordinate(location.lon ?? location.longitude),
    value: value as number | string | null,
  });
}

/** Normalizes Meteomatics' documented time-series JSON and route-style JSON into display rows. */
export function resolveMeteomaticsResult(result: unknown, limit = ROW_LIMIT): MeteomaticsDisplayResult | null {
  const root = asRecord(result);
  if (!root || !Array.isArray(root.data)) return null;
  const rows: MeteomaticsDisplayRow[] = [];

  for (const entryValue of root.data) {
    const entry = asRecord(entryValue);
    if (!entry) continue;

    if (typeof entry.parameter === 'string' && Array.isArray(entry.coordinates)) {
      for (const coordinateValue of entry.coordinates) {
        const coordinate = asRecord(coordinateValue);
        if (!coordinate || !Array.isArray(coordinate.dates)) continue;
        for (const dateValue of coordinate.dates) {
          const date = asRecord(dateValue);
          if (date) appendValue(rows, entry.parameter, date.date, coordinate, date.value);
        }
      }
      continue;
    }

    // Meteomatics route JSON returns one location/date record with parameter/value pairs.
    if (typeof entry.date === 'string' && Array.isArray(entry.parameters)) {
      for (const parameterValue of entry.parameters) {
        const parameter = asRecord(parameterValue);
        if (parameter) appendValue(rows, parameter.parameter, entry.date, entry, parameter.value);
      }
    }
  }

  if (!rows.length) return null;
  return { rows: rows.slice(0, limit), totalRows: rows.length, truncated: rows.length > limit,
    status: typeof root.status === 'string' ? root.status : null,
    version: typeof root.version === 'string' ? root.version : null,
  };
}

/** Downloads the complete provider payload, not the limited display rows. */
export function downloadMeteomaticsJson(result: unknown, requestedAt: string): void {
  const json = typeof result === 'string' ? JSON.stringify(JSON.parse(result) as unknown, null, 2) : JSON.stringify(result, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `meteomatics-response-${requestedAt.replace(/[^0-9TZ-]/g, '-')}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
