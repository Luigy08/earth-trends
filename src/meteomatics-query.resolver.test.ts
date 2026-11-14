import { describe, expect, it } from 'vitest';
import { resolveMeteomaticsResult } from './meteomatics-query.resolver';

describe('Meteomatics API response normalization', () => {
  it('flattens documented parameter-coordinate-date JSON responses', () => {
    const result = resolveMeteomaticsResult({ version: '3.0', status: 'OK', data: [
      { parameter: 't_2m:C', coordinates: [{ lat: 50.23, lon: 10.23, dates: [
        { date: '2026-11-12T00:00:00Z', value: 10 }, { date: '2026-11-12T01:00:00Z', value: null },
      ] }] },
    ] });

    expect(result).toMatchObject({ totalRows: 2, status: 'OK', version: '3.0' });
    expect(result?.rows).toEqual([
      { parameter: 't_2m:C', date: '2026-11-12T00:00:00Z', latitude: 50.23, longitude: 10.23, value: 10 },
      { parameter: 't_2m:C', date: '2026-11-12T01:00:00Z', latitude: 50.23, longitude: 10.23, value: null },
    ]);
  });

  it('flattens route responses with nested parameter values', () => {
    const result = resolveMeteomaticsResult({ data: [
      { lat: 47.42, lon: 9.37, date: '2026-11-12T12:00:00Z', parameters: [
        { parameter: 't_2m:C', value: 9.8 }, { parameter: 'precip_1h:mm', value: 0 },
      ] },
    ] });

    expect(result?.rows).toEqual([
      { parameter: 't_2m:C', date: '2026-11-12T12:00:00Z', latitude: 47.42, longitude: 9.37, value: 9.8 },
      { parameter: 'precip_1h:mm', date: '2026-11-12T12:00:00Z', latitude: 47.42, longitude: 9.37, value: 0 },
    ]);
  });

  it('keeps unrecognized JSON available as raw payload instead of fabricating rows', () => {
    expect(resolveMeteomaticsResult({ data: [{ unexpected: true }] })).toBeNull();
  });
});
