import type { MultiPolygon, Polygon, Position } from 'geojson';

function inRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Outer ring minus holes. */
const inPolygon = (lon: number, lat: number, rings: Position[][]): boolean =>
  rings.length > 0 && inRing(lon, lat, rings[0] ?? []) && !rings.slice(1).some(hole => inRing(lon, lat, hole));

/** True when the point lies inside the zone geometry (ray casting; boundaries are not significant at this scale). */
export function geometryContains(geometry: Polygon | MultiPolygon, latitude: number, longitude: number): boolean {
  return geometry.type === 'Polygon'
    ? inPolygon(longitude, latitude, geometry.coordinates)
    : geometry.coordinates.some(polygon => inPolygon(longitude, latitude, polygon));
}
