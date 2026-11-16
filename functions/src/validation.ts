import { z } from 'zod';
import { HttpsError } from 'firebase-functions/v2/https';
import { isMeteomaticsParameter } from '../../shared/meteomatics-parameter.resolver';
import { GIOVANNI_VARIABLES } from '../../shared/giovanni-catalog.constant';
import { EARTHDATA_LIMITS } from '../../shared/earthdata-catalog.constant';

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
  dataSource: z.enum(['meteomatics', 'giovanni']).optional(),
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
const seriesKey = z.string().trim().min(1).max(400);
export const compareSessionsSchema = z.object({ sessionId, seriesKey, otherSessionId: sessionId, otherSeriesKey: seriesKey }).strict()
  .refine(input => input.sessionId !== input.otherSessionId, 'Choose a different session to compare.');
export const attachSessionAnalysisSchema = z.object({ sessionId, analysisId: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

const coordinateSchema = z.object({ latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) }).strict();
const meteomaticsDate = z.string().trim().min(1).max(500).regex(/^[0-9A-Za-zTZ:+.,_\-/]+$/);
export const meteomaticsQuerySchema = z.object({
  mode: z.enum(['point', 'grid', 'station', 'route', 'polygon', 'trajectory']),
  source: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/).default('mix'),
  options: z.object({ calibrated: z.boolean().optional(), mask: z.enum(['land', 'sea']).optional(), ens_select: z.string().regex(/^[A-Za-z0-9:.,_-]{1,100}$/).optional() }).strict().optional(),
  parameters: z.array(z.string().max(120)).min(1).max(10),
  validDates: meteomaticsDate,
  format: z.enum(['json', 'csv', 'xml']).default('json'),
  point: coordinateSchema.optional(),
  grid: z.object({ north: z.number().min(-90).max(90), west: z.number().min(-180).max(180), south: z.number().min(-90).max(90), east: z.number().min(-180).max(180), resolution: z.string().regex(/^\d{1,3}x\d{1,3}$/) }).strict().optional(),
  stationIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{2,40}$/)).min(1).max(100).optional(),
  route: z.array(coordinateSchema).min(2).max(100).optional(),
  polygon: z.object({ coordinates: z.array(coordinateSchema).min(3).max(100), aggregate: z.enum(['min', 'max', 'mean', 'median', 'mode']) }).strict().optional(),
  trajectory: z.array(z.object({ date: z.string().datetime({ offset: true }), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180), altitude: z.number().finite().min(-500).max(30000).optional() }).strict()).min(1).max(150).optional(),
}).strict().superRefine((spec, ctx) => {
  if (spec.parameters.some(parameter => !isMeteomaticsParameter(parameter))) ctx.addIssue({ code: 'custom', message: 'Select parameters from the Meteomatics catalog.', path: ['parameters'] });
  const fieldByMode = { point: 'point', grid: 'grid', station: 'stationIds', route: 'route', polygon: 'polygon', trajectory: 'trajectory' } as const;
  const expected = fieldByMode[spec.mode];
  if (!spec[expected]) ctx.addIssue({ code: 'custom', message: `The ${spec.mode} request requires ${expected}.`, path: [expected] });
  for (const field of Object.keys(fieldByMode) as Array<keyof typeof fieldByMode>) {
    const key = fieldByMode[field];
    if (field !== spec.mode && spec[key] !== undefined) ctx.addIssue({ code: 'custom', message: `${key} is not valid for ${spec.mode} mode.`, path: [key] });
  }
  if (spec.grid && spec.grid.north <= spec.grid.south) ctx.addIssue({ code: 'custom', message: 'Grid north must be north of south.', path: ['grid', 'north'] });
  if (spec.mode === 'station' && spec.source !== 'mix-obs') ctx.addIssue({ code: 'custom', message: 'Station observations require the mix-obs source.', path: ['source'] });
  if (spec.polygon && spec.polygon.coordinates.length < 3) ctx.addIssue({ code: 'custom', message: 'A polygon requires at least three coordinates.', path: ['polygon', 'coordinates'] });
  if (spec.mode === 'route') {
    const dates = spec.validDates.split(',');
    if (dates.length !== spec.route?.length) ctx.addIssue({ code: 'custom', message: 'Route mode requires one timestamp per route location.', path: ['validDates'] });
  }
  if (spec.mode === 'trajectory' && spec.parameters.some(parameter => /_\*m:/.test(parameter)) && spec.trajectory?.some(point => point.altitude === undefined)) ctx.addIssue({ code: 'custom', message: 'Altitude-level parameters require an altitude for every trajectory point.', path: ['trajectory'] });
});
export const meteomaticsAvailabilitySchema = z.object({ spec: meteomaticsQuerySchema }).strict();
export const meteomaticsExecuteSchema = z.object({ spec: meteomaticsQuerySchema, confirmed: z.literal(true) }).strict();
export const interpretMeteomaticsSchema = z.object({ query: z.string().trim().min(3).max(16000) }).strict();

const giovanniDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(`${value}T00:00:00Z`)), 'Use a valid YYYY-MM-DD date.');
export const giovanniQuerySchema = z.object({
  variables: z.array(z.string().max(120)).min(1).max(5),
  point: coordinateSchema,
  startDate: giovanniDate,
  endDate: giovanniDate,
}).strict().superRefine((spec, ctx) => {
  const variables = spec.variables.map(id => GIOVANNI_VARIABLES.find(item => item.id === id));
  if (variables.some(item => !item)) ctx.addIssue({ code: 'custom', message: 'Select variables from the Giovanni catalog.', path: ['variables'] });
  if (new Set(spec.variables).size !== spec.variables.length) ctx.addIssue({ code: 'custom', message: 'Variables must be distinct.', path: ['variables'] });
  if (spec.endDate < spec.startDate) ctx.addIssue({ code: 'custom', message: 'The end date must be on or after the start date.', path: ['endDate'] });
  if (spec.endDate > new Date().toISOString().slice(0, 10)) ctx.addIssue({ code: 'custom', message: 'Giovanni serves past data only; choose an end date up to today.', path: ['endDate'] });
  const firstYear = Math.max(...variables.map(item => item?.firstYear ?? 1980));
  if (Number(spec.startDate.slice(0, 4)) < firstYear) ctx.addIssue({ code: 'custom', message: `The selected variables start in ${firstYear}.`, path: ['startDate'] });
  if (Number(spec.endDate.slice(0, 4)) - Number(spec.startDate.slice(0, 4)) > 50) ctx.addIssue({ code: 'custom', message: 'Request at most 50 years at a time.', path: ['startDate'] });
});
export const giovanniExecuteSchema = z.object({ spec: giovanniQuerySchema, confirmed: z.literal(true) }).strict();
export const interpretGiovanniSchema = z.object({ query: z.string().trim().min(3).max(16000) }).strict();
export const saveQuerySessionSchema = z.object({ sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), workflow: z.enum(['meteomatics', 'giovanni', 'earthdata']).default('meteomatics') }).strip();

const earthdataId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
/** Variables and zones are checked against the stored catalog when the query runs; this validates shape and period. */
export const earthdataQuerySchema = z.object({
  variables: z.array(earthdataId).min(1).max(EARTHDATA_LIMITS.maxVariables),
  zones: z.array(earthdataId).min(1).max(EARTHDATA_LIMITS.maxZones),
  startDate: giovanniDate,
  endDate: giovanniDate,
}).strict().superRefine((spec, ctx) => {
  if (new Set(spec.variables).size !== spec.variables.length) ctx.addIssue({ code: 'custom', message: 'Variables must be distinct.', path: ['variables'] });
  if (new Set(spec.zones).size !== spec.zones.length) ctx.addIssue({ code: 'custom', message: 'Places must be distinct.', path: ['zones'] });
  if (spec.endDate < spec.startDate) ctx.addIssue({ code: 'custom', message: 'The end date must be on or after the start date.', path: ['endDate'] });
  if (spec.endDate > new Date().toISOString().slice(0, 10)) ctx.addIssue({ code: 'custom', message: 'Stored data are historical; choose an end date up to today.', path: ['endDate'] });
  if (Number(spec.startDate.slice(0, 4)) < EARTHDATA_LIMITS.firstYear) ctx.addIssue({ code: 'custom', message: `The satellite series offered here start in ${EARTHDATA_LIMITS.firstYear}.`, path: ['startDate'] });
});
export const earthdataExecuteSchema = z.object({ spec: earthdataQuerySchema, confirmed: z.literal(true) }).strict();
export const interpretEarthdataSchema = z.object({ query: z.string().trim().min(3).max(16000) }).strict();

export function parseInput<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  if (Buffer.byteLength(JSON.stringify(value ?? null), 'utf8') > 20_000) throw new HttpsError('invalid-argument', 'La solicitud supera los 20 KB.');
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpsError('invalid-argument', 'Revisa los campos de la solicitud.', { fields: parsed.error.issues.map(issue => issue.path.join('.')) });
  return parsed.data;
}
