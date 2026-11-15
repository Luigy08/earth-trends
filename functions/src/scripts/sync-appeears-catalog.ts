/**
 * Downloads the full AppEEARS catalog (no authentication needed) and stores it normalized to the
 * Balam model in functions/data/appeears-catalog.json. The file is committed: the AppEEARS adapter
 * reads units and fill values from it.
 *
 *   npm run sync:appeears [-- output.json]
 *
 * Run it periodically: AppEEARS adds and retires products.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { APPEEARS_CATALOG_PATH } from '../datasources/catalog/appeears-catalog';
import { normalizeAppeearsCatalog, type AppeearsLayer, type AppeearsProduct } from '../datasources/catalog/normalize-appeears';

const BASE = process.env.APPEEARS_BASE_URL ?? 'https://appeears.earthdatacloud.nasa.gov/api';
const OUT = process.argv[2] ?? APPEEARS_CATALOG_PATH;
// AppEEARS answers 429 when hit too fast: keep the concurrency low and back off on retries.
const CONCURRENCY = 3;

async function getJson<T>(url: string, tries = 7): Promise<T> {
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as T;
    if (i >= tries || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} at ${url}`);
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 3000 * 2 ** (i - 1));
    await new Promise((ok) => setTimeout(ok, waitMs));
  }
}

async function main() {
  const products = await getJson<AppeearsProduct[]>(`${BASE}/product`);
  const layers: Record<string, Record<string, AppeearsLayer>> = {};
  const queue = products.filter((p) => p.Available && !p.Deleted).map((p) => p.ProductAndVersion);
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        layers[id] = await getJson(`${BASE}/product/${encodeURIComponent(id)}`);
      }
    }),
  );
  const catalog = normalizeAppeearsCatalog(products, layers).sort((a, b) => a.parameter.localeCompare(b.parameter));
  await mkdir(dirname(OUT), { recursive: true });
  // One entry per line keeps the committed file compact and its diffs readable.
  const header = { source: 'appeears', syncedAt: new Date().toISOString(), products: Object.keys(layers).length };
  const body = catalog.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n');
  await writeFile(OUT, `${JSON.stringify(header, null, 2).slice(0, -2)},\n  "entries": [\n${body}\n  ]\n}\n`);
  const data = catalog.filter((e) => !e.isQuality).length;
  console.log(`OK: ${Object.keys(layers).length} products, ${catalog.length} layers (${data} data, ${catalog.length - data} quality) → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
