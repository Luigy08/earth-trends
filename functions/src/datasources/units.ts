/**
 * Unidades en tokens cortos estilo Meteomatics (C, K, p, idx, m3m3, mm…).
 * AppEEARS trae ~100 variantes de texto libre ("Kelvin", "degrees C",
 * "kg/m^2/8day", "parameter, no units"…); aquí se normalizan.
 */

const RULES: [RegExp, string][] = [
  [/^(kelvin|k)$/i, 'K'],
  [/^(degrees? ?c|°c|celsius|c)$/i, 'C'],
  [/^(percent|%|'?percent'?)$/i, 'p'],
  [/^ratio$/i, 'frac'],
  [/^m\^?3\/m\^?3$|^cm\^?3\/cm\^?3$/i, 'm3m3'],
  [/^m\^?2\/m\^?2$/i, 'm2m2'],
  [/^mm\/day$/i, 'mmd'],
  [/^mm$/i, 'mm'],
  [/^kg\/m\^?2\/s$/i, 'kgm2s'],
  [/^kg\/m\^?2\/8 ?day$/i, 'kgm2_8d'],
  [/^kg\/m\^?2$/i, 'kgm2'],
  [/^kgc\/m\^?2\/8 ?day$/i, 'kgCm2_8d'],
  [/^(w\/m\^?2|w\/m2|w\/m²)$/i, 'Wm2'],
  [/^mj\/m\^?2\/day$/i, 'MJm2d'],
  [/^(meters?|m)$/i, 'm'],
  [/^(degrees?|degree)$/i, 'deg'],
  [/^pa$/i, 'Pa'],
  [/^s\/day$/i, 'sd'],
  [/^(ndvi|evi2?|nirv|ndsi)$/i, 'idx'],
  [/(no units|unitless|dimensionless|^none$|^$)/i, 'idx'],
  [/reflectance/i, 'refl'],
];

export function normalizeUnit(raw: string | null | undefined): string {
  const u = (raw ?? '').trim();
  for (const [re, token] of RULES) if (re.test(u)) return token;
  // Sin regla conocida: slug seguro para usar después de ":" en el parámetro.
  return u.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'idx';
}

type Converter = (v: number) => number;

const CONVERSIONS: Record<string, Converter> = {
  'K->C': (v) => v - 273.15,
  'C->K': (v) => v + 273.15,
  'K->F': (v) => ((v - 273.15) * 9) / 5 + 32,
  'C->F': (v) => (v * 9) / 5 + 32,
  'F->C': (v) => ((v - 32) * 5) / 9,
  'frac->p': (v) => v * 100,
  'p->frac': (v) => v / 100,
  // 1 kg/m² de agua = 1 mm
  'kgm2s->mmd': (v) => v * 86400,
  'kgm2s->mm': (v) => v * 86400, // acumulado diario
  'kgm2_8d->mmd': (v) => v / 8,
  'kgm2_8d->mm': (v) => v, // acumulado de 8 días
  'kgm2->mm': (v) => v,
  'mmd->mm': (v) => v,
  'MJm2d->Wm2': (v) => (v * 1e6) / 86400,
  'Wm2->MJm2d': (v) => (v * 86400) / 1e6,
};

/** Convierte entre tokens. Lanza error si no hay conversión conocida. */
export function converter(from: string, to: string): Converter {
  if (from === to) return (v) => v;
  const fn = CONVERSIONS[`${from}->${to}`];
  if (!fn) throw new Error(`No unit conversion from ${from} to ${to}`);
  return fn;
}

const PHYSICAL = new Set(['K', 'C', 'F', 'p', 'frac', 'm3m3', 'm2m2', 'mm', 'mmd', 'kgm2s', 'kgm2_8d', 'kgm2', 'kgCm2_8d', 'Wm2', 'MJm2d', 'm', 'Pa']);

/** true si el token es una magnitud física conocida (no un índice o una etiqueta libre). */
export function isPhysicalUnit(token: string): boolean {
  return PHYSICAL.has(token);
}

export function canConvert(from: string, to: string): boolean {
  return from === to || `${from}->${to}` in CONVERSIONS;
}
