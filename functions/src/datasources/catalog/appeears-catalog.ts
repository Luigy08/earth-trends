import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CatalogEntry } from '../datasources.types';

/** functions/data/appeears-catalog.json, written by `npm run sync:appeears` and committed to the repository. */
export const APPEEARS_CATALOG_PATH = resolve(__dirname, '../../../../../data/appeears-catalog.json');

let cached: CatalogEntry[] | undefined;

/**
 * The AppEEARS adapter needs the catalog for units and fill values: without it, Kelvin values
 * could be stored as Celsius. A missing or empty catalog is therefore an error, never a silent default.
 */
export function loadAppeearsCatalog(path = APPEEARS_CATALOG_PATH): CatalogEntry[] {
  if (cached && path === APPEEARS_CATALOG_PATH) return cached;
  let parsed: { entries?: CatalogEntry[] };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as { entries?: CatalogEntry[] };
  } catch {
    throw new Error(`AppEEARS catalog not found at ${path}. Run "npm run sync:appeears".`);
  }
  if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
    throw new Error(`AppEEARS catalog at ${path} has no entries. Run "npm run sync:appeears".`);
  }
  if (path === APPEEARS_CATALOG_PATH) cached = parsed.entries;
  return parsed.entries;
}
