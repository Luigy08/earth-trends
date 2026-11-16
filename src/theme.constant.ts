// Single source of truth for UI colors. CSS reads them as `--color-<kebab-name>` variables
// (injected from theme.styles.ts); TS/TSX imports COLORS directly.
export const COLORS = {
  // Brand greens
  green900: '#16392f',
  green800: '#204c3e',
  green700: '#295846',
  green600: '#42623e',
  ink: '#243c33',
  // Neutral sage (text and icons, dark → light)
  sage800: '#52654e',
  sage700: '#65715e',
  sage600: '#788078',
  sage500: '#8a9281',
  sage400: '#a1ab94',
  sage300: '#c0c5b8',
  // Saturated moss (labels, markers, illustration)
  moss700: '#637758',
  moss600: '#6d8a64',
  moss500: '#859575',
  moss400: '#97aa83',
  // Lines and borders
  line200: '#dce4d0',
  line100: '#e3e5db',
  line50: '#e9ecdf',
  // Surfaces
  white: '#ffffff',
  paper: '#fffef9',
  page: '#f6f5ef',
  surfaceMuted: '#f2f4eb',
  surfaceTint: '#e4e8dc',
  sidebar: '#eeefe6',
  // Terracotta accents
  accent: '#d7754e',
  accentDark: '#bc6645',
  accentSoft: '#f4e0d5',
  selection: '#ead9c6',
  clay: '#b07850',
  warning: '#9c662c',
  // Globe atmosphere
  atmosphere: '#6fb1dc',
  atmosphereSoft: '#b9dcf2',
  // Data and status
  chartBlue: '#3b82f6',
  chartRed: '#ef4444',
  chartAmber: '#d97706',
  slate: '#334155',
  slateLine: '#dbe4ea',
  shadow: '#173d30',
  black: '#000000',
} as const;

// Single source of truth for typefaces, exposed to CSS as `--font-<name>`.
// display: organic serif for titles · body: interface text · data: figures, coordinates and tables.
export const FONTS = {
  display: '"Fraunces", Georgia, serif',
  body: '"Manrope", system-ui, sans-serif',
  data: '"IBM Plex Mono", ui-monospace, monospace',
} as const;
