/**
 * Loads the 18 departments of Honduras (ADM1) into the Zone table.
 *
 * Source: geoBoundaries gbOpen, HND, ADM1, simplified geometry (https://www.geoboundaries.org).
 * Licence: Open Data Commons Open Database License 1.0 — boundaries from OpenStreetMap contributors.
 * Attribution is required wherever the boundaries are shown.
 *
 *   npm run seed:zones                 # needs DIRECT_URL or DATABASE_URL in functions/.env.local
 *   npm run seed:zones -- --dry-run    # download, check and report only
 */
import centroid from '@turf/centroid';
import kinks from '@turf/kinks';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { disconnectPrisma, getPrisma } from '../db/client';

const API = 'https://www.geoboundaries.org/api/current/gbOpen/HND/ADM1/';
const EXPECTED_ZONES = 18;
const COORDINATE_DECIMALS = 6; // roughly 0.1 m: trims the payload without moving any vertex across another edge

type ZoneFeature = Feature<Polygon | MultiPolygon, { shapeName?: string; shapeISO?: string }>;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} at ${url}`);
  return (await res.json()) as T;
}

const round = (value: number) => Number(value.toFixed(COORDINATE_DECIMALS));
/** Rounds a ring and drops consecutive duplicates; the ring stays closed. */
function cleanRing(ring: Position[]): Position[] {
  const out: Position[] = [];
  for (const [lon = 0, lat = 0] of ring) {
    const point: Position = [round(lon), round(lat)];
    const previous = out[out.length - 1];
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) out.push(point);
  }
  return out;
}
function cleanGeometry(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geometry.coordinates.map(cleanRing) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map(cleanRing)) };
}

/**
 * NASA AppEEARS rejects a whole request when a single polygon is invalid, so a geometry that cannot be
 * requested is refused here. The published boundaries are stored as they are: simplifying them further
 * is what introduces self-intersections along intricate coastlines.
 */
function geometryProblems(geometry: Polygon | MultiPolygon): string[] {
  const problems: string[] = [];
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length < 4) problems.push('a ring has fewer than 4 positions');
    else if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) problems.push('a ring is not closed');
  }
  const crossings = kinks({ type: 'Feature', properties: {}, geometry }).features.length;
  if (crossings) problems.push(`${crossings} self-intersection(s)`);
  return problems;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No local env file: the variables may already be in the environment.
  }

  const meta = await getJson<{ simplifiedGeometryGeoJSON: string; boundaryLicense: string; boundarySource: string; boundaryYearRepresented: string }>(API);
  console.log(`Source: geoBoundaries gbOpen HND ADM1 (${meta.boundaryYearRepresented}) — ${meta.boundarySource}`);
  console.log(`Licence: ${meta.boundaryLicense}`);

  const collection = await getJson<FeatureCollection<Polygon | MultiPolygon, ZoneFeature['properties']>>(meta.simplifiedGeometryGeoJSON);
  const zones = collection.features.map((feature) => {
    const id = feature.properties.shapeISO ?? '';
    const name = feature.properties.shapeName ?? '';
    if (!/^HN-[A-Z]{2}$/.test(id) || !name) throw new Error(`Unexpected feature properties: ${JSON.stringify(feature.properties)}`);
    const geometry = cleanGeometry(feature.geometry);
    const problems = geometryProblems(geometry);
    if (problems.length) throw new Error(`${id} ${name} has an invalid polygon: ${problems.join('; ')}`);
    const [lon = NaN, lat = NaN] = centroid(geometry).geometry.coordinates;
    return { id, name, level: 'ADM1', country: 'HN', centroidLat: round(lat), centroidLon: round(lon), geometry };
  }).sort((a, b) => a.id.localeCompare(b.id));

  if (zones.length !== EXPECTED_ZONES || new Set(zones.map((z) => z.id)).size !== EXPECTED_ZONES) {
    throw new Error(`Expected ${EXPECTED_ZONES} distinct departments, found ${zones.length}`);
  }
  console.log(`Geometry: ${JSON.stringify(zones.map((z) => z.geometry)).length} bytes, every polygon valid`);
  for (const zone of zones) console.log(`  ${zone.id}  ${zone.name}  (${zone.centroidLat}, ${zone.centroidLon})`);

  if (dryRun) {
    console.log('Dry run: nothing was written.');
    return;
  }
  const prisma = getPrisma(process.env.DIRECT_URL ?? process.env.DATABASE_URL, 1);
  try {
    for (const { id, ...data } of zones) {
      const values = { ...data, geometry: JSON.parse(JSON.stringify(data.geometry)) as object };
      await prisma.zone.upsert({ where: { id }, create: { id, ...values }, update: values });
    }
    console.log(`OK: ${zones.length} zones upserted.`);
  } finally {
    await disconnectPrisma();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
