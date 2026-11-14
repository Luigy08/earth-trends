import { z } from 'zod';
import { HttpsError } from 'firebase-functions/v2/https';

export const locationSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  country: z.string().trim().max(100).optional(),
}).strict();

const year = z.number().int().min(1981).max(new Date().getUTCFullYear() - 1);
const periodSchema = z.object({ startYear: year, endYear: year }).strict();
export const analysisSpecSchema = z.object({
  metric: z.enum(['temperature', 'precipitation']),
  locations: z.array(locationSchema).min(1).max(2),
  startYear: year,
  endYear: year,
  comparisonMode: z.enum(['none', 'locations', 'periods']),
  secondPeriod: periodSchema.optional(),
}).strict().superRefine((spec, ctx) => {
  if (spec.endYear < spec.startYear) {
    ctx.addIssue({ code: 'custom', message: 'The period must be in chronological order', path: ['endYear'] });
  }
  const expectedLocations = spec.comparisonMode === 'locations' ? 2 : 1;
  if (spec.locations.length !== expectedLocations) {
    ctx.addIssue({ code: 'custom', message: `This comparison requires ${expectedLocations} location(s)`, path: ['locations'] });
  }
  if (spec.comparisonMode === 'locations' && spec.locations.length === 2) {
    const [a, b] = spec.locations;
    if (a!.latitude === b!.latitude && a!.longitude === b!.longitude) {
      ctx.addIssue({ code: 'custom', message: 'Choose two different coordinates', path: ['locations'] });
    }
  }
  if (spec.comparisonMode === 'periods') {
    if (!spec.secondPeriod || spec.secondPeriod.endYear < spec.secondPeriod.startYear) {
      ctx.addIssue({ code: 'custom', message: 'A second chronological period is required', path: ['secondPeriod'] });
    }
  } else if (spec.secondPeriod) {
    ctx.addIssue({ code: 'custom', message: 'A second period is only valid when comparing periods', path: ['secondPeriod'] });
  }
});

export const interpretQuerySchema = z.object({ query: z.string().trim().min(3).max(2000) }).strict();
export const searchLocationsSchema = z.object({ query: z.string().trim().min(2).max(150), limit: z.number().int().min(1).max(10).default(5) }).strict();
export const createAnalysisSchema = z.object({ spec: analysisSpecSchema, requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/) }).strict();
export const getAnalysisSchema = z.object({ analysisId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const sessionId = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const sessionRequestSchema = z.object({ sessionId }).strict();
export const chatSessionSchema = z.object({ sessionId, message: z.string().trim().min(3).max(1500) }).strict();
export const renameSessionSchema = z.object({ sessionId, title: z.string().trim().min(1).max(80) }).strict();
export const attachSessionAnalysisSchema = z.object({ sessionId, analysisId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export function parseInput<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  if (Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') > 20_000) throw new HttpsError('invalid-argument', 'La solicitud supera los 20 KB.');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Revisa los campos de la solicitud.', { fields: parsed.error.issues.map(issue => issue.path.join('.')) });
  return parsed.data;
}
