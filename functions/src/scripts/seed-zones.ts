/**
 * Loads the 18 departments of Honduras (ADM1) into the Zone table.
 *
 * Source: geoBoundaries gbOpen, HND, ADM1, simplified geometry (https://www.geoboundaries.org).
 * Licence: Open Data Commons Open Database License 1.0 — boundaries from OpenStreetMap contributors.
 * Attribution is required wherever the boundaries are shown.
 *
 *   npm run seed:zones                 # needs DIRECT_URL or DATABASE_URL in functions/.env.local
 *   npm run seed:zones -- --dry-run    # download, simplify and report only
 */
import centroid from '@turf/centroid';
import simplify from '@turf/simplify';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { disconnectPrisma, getPrisma } from '../db/client';

const API = 'https://www.geoboundaries.org/api/current/gbOpen/HND/ADM1/';
const EXPECTED_ZONES = 18;
/** AppEEARS receives every polygon in one request, so the collection is kept well under this size. */
const MAX_COLLECTION_BYTES = 150_000;
const SIMPLIFY_TOLERANCE_DEGREES = 0.005; // roughly 500 m
const COORDINATE_DECIMALS = 5; // roughly 1 m

type ZoneFeature = Feature<Polygon | MultiPolygon, { shapeName?: string; shapeISO?: string }>;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} at ${url}`);
  return (await res.json()) as T;
}

const round = (value: number) => Number(value.toFixed(COORDINATE_DECIMALS));
const roundRing = (ring: Position[]): Position[] => ring.map(([lon = 0, lat = 0]) => [round(lon), round(lat)]);
function roundGeometry(geometry: Polygon | MultiPolygon): Polygon | MultiPolygon {
  return geometry.type === 'Polygon'
    ? { type: 'Polygon', coordinates: geometry.coordinates.map(roundRing) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map(roundRing)) };
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

  let collection = await getJson<FeatureCollection<Polygon | MultiPolygon, ZoneFeature['properties']>>(meta.simplifiedGeometryGeoJSON);
  const originalBytes = JSON.stringify(collection).length;
  if (originalBytes > MAX_COLLECTION_BYTES) {
    collection = simplify(collection, { tolerance: SIMPLIFY_TOLERANCE_DEGREES, highQuality: true, mutate: false });
  }
  const zones = collection.features.map((feature) => {
    const id = feature.properties.shapeISO ?? '';
    const name = feature.properties.shapeName ?? '';
    if (!/^HN-[A-Z]{2}$/.test(id) || !name) throw new Error(`Unexpected feature properties: ${JSON.stringify(feature.properties)}`);
    const geometry = roundGeometry(feature.geometry);
    const [lon = NaN, lat = NaN] = centroid(geometry).geometry.coordinates;
    return { id, name, level: 'ADM1', country: 'HN', centroidLat: round(lat), centroidLon: round(lon), geometry };
  }).sort((a, b) => a.id.localeCompare(b.id));

  if (zones.length !== EXPECTED_ZONES || new Set(zones.map((z) => z.id)).size !== EXPECTED_ZONES) {
    throw new Error(`Expected ${EXPECTED_ZONES} distinct departments, found ${zones.length}`);
  }
  const bytes = JSON.stringify(zones.map((z) => z.geometry)).length;
  console.log(`Geometry: ${originalBytes} bytes downloaded, ${bytes} bytes stored`);
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
  console.error(e);
  process.exit(1);
});
