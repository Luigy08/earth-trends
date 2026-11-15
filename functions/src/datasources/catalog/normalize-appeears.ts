import type { CatalogEntry } from '../datasources.types';
import { normalizeUnit } from '../units';

/** Forma de GET /api/product */
export interface AppeearsProduct {
  Product: string;
  Platform: string;
  Description: string;
  RasterType: string;
  Resolution: string;
  TemporalGranularity: string;
  Version: string;
  Available: boolean;
  DocLink?: string;
  Source: string;
  TemporalExtentStart?: string;
  TemporalExtentEnd?: string;
  Deleted: boolean;
  DOI?: string;
  ProductAndVersion: string;
}

/** Forma de cada capa en GET /api/product/{id} */
export interface AppeearsLayer {
  Layer: string;
  Description?: string;
  Units?: string;
  IsQA?: boolean;
  DataType?: string;
  ScaleFactor?: number | string;
  AddOffset?: number | string;
  FillValue?: number | string;
  ValidMin?: number | string;
  ValidMax?: number | string;
  QualityLayers?: string;
  QualityProductAndVersion?: string;
}

const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "500m" → 500, "500/1000m" → 500, "4km" → 4000, "0.1 deg" → ~11132 */
export function resolutionToMeters(res: string): number | null {
  const s = (res || '').toLowerCase();
  const m = /([\d.]+)\s*(km|m|deg|degree|°)?/.exec(s.replace(/p/g, '.'));
  if (!m) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  const unit = m[2] ?? (s.includes('km') ? 'km' : s.includes('deg') ? 'deg' : 'm');
  if (unit === 'km') return v * 1000;
  if (unit.startsWith('deg') || unit === '°') return Math.round(v * 111320);
  return v;
}

/** "['QC_Day']" → ["QC_Day"] */
function parseList(s?: string): string[] {
  if (!s) return [];
  return Array.from(s.matchAll(/'([^']+)'/g), (m) => m[1] ?? '');
}

export function normalizeAppeearsCatalog(
  products: AppeearsProduct[],
  layersByProduct: Record<string, Record<string, AppeearsLayer>>,
): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const p of products) {
    if (!p.Available || p.Deleted) continue;
    const layers = layersByProduct[p.ProductAndVersion];
    if (!layers) continue;
    const end = p.TemporalExtentEnd && p.TemporalExtentEnd !== 'Present' ? p.TemporalExtentEnd : null;
    for (const l of Object.values(layers)) {
      const unit = normalizeUnit(l.Units);
      out.push({
        parameter: `appeears/${p.ProductAndVersion}/${l.Layer}:${unit}`,
        source: 'appeears',
        dataset: p.ProductAndVersion,
        variable: l.Layer,
        description: `${p.Description} — ${l.Description ?? l.Layer}`,
        unit,
        rawUnit: l.Units ?? '',
        isQuality: Boolean(l.IsQA),
        scaleFactor: num(l.ScaleFactor),
        addOffset: num(l.AddOffset),
        fillValue: l.FillValue === undefined || l.FillValue === '' ? null : (num(l.FillValue) ?? String(l.FillValue)),
        validRange: [num(l.ValidMin), num(l.ValidMax)],
        qualityLayers: parseList(l.QualityLayers),
        qualityDataset: l.QualityProductAndVersion || null,
        dataType: l.DataType ?? null,
        platform: p.Platform,
        provider: p.Source,
        resolution: p.Resolution,
        resolutionMeters: resolutionToMeters(p.Resolution),
        rasterType: p.RasterType,
        temporalGranularity: p.TemporalGranularity,
        temporalStart: p.TemporalExtentStart ?? null,
        temporalEnd: end,
        doi: p.DOI ?? null,
        docUrl: p.DocLink ?? null,
        queryModes: ['point', 'area'],
        synchronous: false,
      });
    }
  }
  return out;
}
