import type { z } from 'zod';
import { CANONICAL_VARIABLES } from '../datasources/catalog/canonical-variables.constant';
import type { BalamQuery, CoordinateSeries, DateValue, ParameterSeries } from '../datasources/datasources.types';
import type { ObservationRow } from '../ingest/ingest.types';
import { sourceOf, unitOf } from '../ingest/ingest.resolver';
import { BALAM } from './balam.constant';
import type { ApiDependencies, ApiRequest, ApiResponse, StoredCoverage } from './balam.types';
import { querySubmitSchema, seriesQuerySchema, trendsQuerySchema, zonesQuerySchema } from './balam.validation';

const SIGNIFICANCE_LEVEL = 0.05;

/** An error the client can act on; everything else is reported as an internal failure. */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: Record<string, unknown>) {
    super(message);
  }
}

function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value ?? {});
  if (result.success) return result.data as z.output<S>;
  throw new ApiError(400, 'invalid_argument', 'Check the request parameters.', {
    fields: result.error.issues.map((issue) => ({ field: issue.path.join('.') || 'request', message: issue.message })),
  });
}

function requireVariable(id: string) {
  const variable = CANONICAL_VARIABLES.find((v) => v.id === id);
  if (!variable) throw new ApiError(404, 'unknown_variable', `Unknown variable "${id}". See GET /variables.`);
  return variable;
}

/** Framework-free router for the Balam HTTP API, so it can be tested without Firebase. */
export async function handleBalamRequest(request: ApiRequest, deps: ApiDependencies): Promise<ApiResponse> {
  const path = request.path.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();
  const queryId = /^\/query\/([^/]+)$/.exec(path)?.[1];
  const route = queryId ? '/query/:id' : path;
  const allowed: Record<string, string> = { '/variables': 'GET', '/zones': 'GET', '/series': 'GET', '/trends': 'GET', '/query': 'POST', '/query/:id': 'GET' };
  if (!allowed[route]) throw new ApiError(404, 'not_found', `No route for ${path}.`);
  if (allowed[route] !== method) throw new ApiError(405, 'method_not_allowed', `Use ${allowed[route]} for ${path}.`);

  switch (route) {
    case '/variables': return ok(await listVariables(deps));
    case '/zones': return ok({ zones: await deps.repository.zones(['1', 'true'].includes(parse(zonesQuerySchema, request.query).geometry ?? '0')) });
    case '/series': return ok(await readSeries(request, deps));
    case '/trends': return ok(await readTrends(request, deps));
    case '/query': return submitQuery(request, deps);
    default: return pollQuery(queryId ?? '', deps);
  }
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });

/* ---------- Catalogue ---------- */

async function listVariables(deps: ApiDependencies) {
  // The variable list is static; only the stored coverage depends on the database.
  let coverage: StoredCoverage[] | null = null;
  try {
    coverage = await deps.repository.coverage();
  } catch {
    coverage = null;
  }
  return {
    storeAvailable: coverage !== null,
    variables: CANONICAL_VARIABLES.map((variable) => ({
      ...variable,
      preloaded: deps.targets.filter((t) => t.variableId === variable.id).map((target) => {
        const source = sourceOf(target.parameter);
        const stored = coverage?.find((c) => c.variableId === variable.id && c.source === source);
        return {
          parameter: target.parameter,
          source,
          since: target.since ?? null,
          stored: stored ? { firstDate: stored.firstDate, lastDate: stored.lastDate, zones: stored.zones } : null,
        };
      }),
    })),
  };
}

/* ---------- Stored series (Meteomatics JSON shape) ---------- */

function toDateValue(row: ObservationRow): DateValue {
  const stats = Object.fromEntries(
    (['min', 'max', 'median', 'std', 'count'] as const).flatMap((key) => (row[key] === null ? [] : [[key, row[key]]])),
  ) as DateValue['stats'];
  return { date: `${row.date}T00:00:00Z`, value: row.value, ...(stats && Object.keys(stats).length ? { stats } : {}) };
}

async function readSeries(request: ApiRequest, deps: ApiDependencies) {
  const input = parse(seriesQuerySchema, request.query);
  requireVariable(input.variable);
  const zones = (await deps.repository.zones(false)).filter((zone) => input.zone.includes(zone.id));
  const unknown = input.zone.filter((id) => !zones.some((zone) => zone.id === id));
  if (unknown.length) throw new ApiError(404, 'unknown_zone', `Unknown zone: ${unknown.join(', ')}. See GET /zones.`);

  const rows = await deps.repository.series({ variableId: input.variable, zoneIds: input.zone, source: input.source, from: input.from, to: input.to });
  // One entry per source and parameter: values from different providers are never spliced into one series.
  const bySeries = new Map<string, ParameterSeries & { byZone: Map<string, CoordinateSeries> }>();
  for (const row of rows) {
    let series = bySeries.get(row.parameter);
    if (!series) {
      series = { parameter: row.parameter, source: row.source, unit: unitOf(row.parameter), coordinates: [], byZone: new Map() };
      bySeries.set(row.parameter, series);
    }
    let coordinate = series.byZone.get(row.zoneId);
    if (!coordinate) {
      const zone = zones.find((z) => z.id === row.zoneId);
      coordinate = { lat: zone?.centroidLat ?? NaN, lon: zone?.centroidLon ?? NaN, id: row.zoneId, dates: [] };
      series.byZone.set(row.zoneId, coordinate);
      series.coordinates.push(coordinate);
    }
    coordinate.dates.push(toDateValue(row));
  }
  return {
    version: BALAM.apiVersion,
    dateGenerated: new Date().toISOString(),
    status: 'OK',
    variable: input.variable,
    data: [...bySeries.values()].map(({ byZone: _byZone, ...series }) => series),
  };
}

/* ---------- Stored trends ---------- */

async function readTrends(request: ApiRequest, deps: ApiDependencies) {
  const input = parse(trendsQuerySchema, request.query);
  requireVariable(input.variable);
  const trends = await deps.repository.trends({ variableId: input.variable, zoneIds: input.zone, source: input.source });
  return {
    variable: input.variable,
    significanceLevel: SIGNIFICANCE_LEVEL,
    trends: trends.map((trend) => ({
      ...trend,
      // Null statistics mean the series cannot support inference yet; that is not evidence of "no trend".
      inferenceSupported: trend.mannKendallP !== null,
      significant: trend.mannKendallP === null ? null : trend.mannKendallP < SIGNIFICANCE_LEVEL,
    })),
  };
}

/* ---------- On-demand queries ---------- */

function assertQueryLimits(query: BalamQuery): void {
  const limits = BALAM.query;
  const reject = (message: string) => { throw new ApiError(400, 'invalid_query', message); };
  if (!query.parameters.length || query.parameters.length > limits.maxParameters) reject(`Request between 1 and ${limits.maxParameters} parameters.`);
  if (query.time.end < query.time.start) reject('The time range must be in chronological order.');
  if (query.time.end.getTime() - query.time.start.getTime() > limits.maxYears * 366 * 86_400_000) reject(`The time range may span at most ${limits.maxYears} years.`);
  const location = query.location;
  if (location.kind === 'points' && location.points.length > limits.maxPoints) reject(`Request at most ${limits.maxPoints} points.`);
  if (location.kind === 'bbox') {
    const area = (location.latMax - location.latMin) * (location.lonMax - location.lonMin);
    if (!(area > 0) || area > limits.maxBboxSquareDegrees) reject(`A bounding box must cover between 0 and ${limits.maxBboxSquareDegrees} square degrees.`);
  }
  const coordinates = location.kind === 'point' ? [location] : location.kind === 'points' ? location.points : [];
  if (coordinates.some((p) => Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) reject('Coordinates are out of range.');
}

async function submitQuery(request: ApiRequest, deps: ApiDependencies): Promise<ApiResponse> {
  const ownerId = await deps.authenticate();
  const { path } = parse(querySubmitSchema, request.body);
  const registry = deps.registry();
  let query: BalamQuery;
  try {
    query = registry.parse(path);
  } catch (error) {
    throw new ApiError(400, 'invalid_query', error instanceof Error ? error.message : 'The query path could not be parsed.');
  }
  assertQueryLimits(query);
  await deps.consumeQueryQuota(ownerId);
  const job = await registry.submit(query, { ownerId });
  const polled = await registry.poll(job.id);
  return { status: polled.done ? 200 : 202, body: { id: job.id, done: polled.done, progress: polled.progress, response: polled.response } };
}

async function pollQuery(id: string, deps: ApiDependencies): Promise<ApiResponse> {
  const ownerId = await deps.authenticate();
  const notFound = new ApiError(404, 'not_found', 'Query not found.');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound;
  let polled: Awaited<ReturnType<ReturnType<ApiDependencies['registry']>['poll']>>;
  try {
    polled = await deps.registry().poll(id);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Job not found')) throw notFound;
    throw error;
  }
  // A query is only visible to the user who submitted it.
  if (polled.job.ownerId !== ownerId) throw notFound;
  return ok({ id, done: polled.done, progress: polled.progress, response: polled.response });
}
