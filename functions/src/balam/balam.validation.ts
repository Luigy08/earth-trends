import { z } from 'zod';
import { BALAM } from './balam.constant';

const identifier = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Use letters, digits, ".", "_" or "-"');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value), 'Not a calendar date');
/** "HN-FM,HN-CR" → ["HN-FM", "HN-CR"] */
const zoneList = z.string().trim().min(1).max(600)
  .transform((value) => [...new Set(value.split(',').map((zone) => zone.trim()).filter(Boolean))])
  .pipe(z.array(identifier).min(1).max(BALAM.maxZonesPerRequest));
const chronological = (value: { from?: string; to?: string }) => !value.from || !value.to || value.from <= value.to;

export const zonesQuerySchema = z.object({ geometry: z.enum(['0', '1', 'true', 'false']).optional() });
export const seriesQuerySchema = z.object({ variable: identifier, zone: zoneList, source: identifier.optional(), from: isoDate.optional(), to: isoDate.optional() })
  .refine(chronological, { message: '"from" must not be after "to"', path: ['to'] });
export const trendsQuerySchema = z.object({ variable: identifier, zone: zoneList.optional(), source: identifier.optional() });
export const querySubmitSchema = z.object({ path: z.string().trim().min(10).max(2000) }).strict();
export const backfillSchema = z.object({ variableId: identifier.optional(), from: isoDate.optional(), to: isoDate.optional(), force: z.boolean().optional() }).strict()
  .refine(chronological, { message: '"from" must not be after "to"', path: ['to'] });
