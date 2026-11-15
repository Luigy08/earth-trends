import { COLORS } from './theme.constant';

export const MAX_YEAR = new Date().getFullYear() - 1;
export const EXAMPLE_QUERIES = [
  { label: 'Is my city getting warmer?', query: `How has the temperature changed in Tegucigalpa between 2000 and ${MAX_YEAR}?` },
  { label: 'Compare two cities', query: `Compare the temperature in Tegucigalpa and San Pedro Sula between 2000 and ${MAX_YEAR}.` },
  { label: 'Is it raining less?', query: `Has precipitation decreased in Madrid between 2000 and ${MAX_YEAR}?` },
];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const SERIES_COLORS = [COLORS.green700, COLORS.accent];
export const CHART_VIEWS = [{ value: 'annual', label: 'Annual' }, { value: 'monthly', label: 'Monthly' }, { value: 'anomaly', label: 'Anomalies' }] as const;
export const WORKFLOW_OPTIONS = [{ value: 'meteomatics', label: 'Meteomatics data', description: 'Raw values from the Meteomatics Weather API' }, { value: 'giovanni', label: 'NASA Giovanni data', description: 'Raw point time series from NASA GES DISC Giovanni' }, { value: 'earthdata', label: 'NASA Earthdata', description: 'Satellite averages by department of Honduras, from NASA AppEEARS' }, { value: 'trend', label: 'Trend analysis', description: 'Historical trends with statistical significance' }] as const;
/** Accessible names of the query assistants that share the chat layout. */
export const QUERY_ASSISTANT_NAMES = { meteomatics: 'Meteomatics', giovanni: 'NASA Giovanni', earthdata: 'NASA Earthdata', trend: 'trend' } as const;
export const HISTORICAL_SOURCE_OPTIONS = [
  { value: 'meteomatics', label: 'Meteomatics', description: 'Daily aggregates converted to complete months' },
  { value: 'giovanni', label: 'NASA Giovanni', description: 'MERRA-2 monthly means via NASA GES DISC' },
] as const;
export const ENV_KEYS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_API_BASE_URL'] as const;
export const API_TIMEOUT_MS = 120_000;
export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/popup-closed-by-user': '',
  'auth/cancelled-popup-request': '',
  'auth/network-request-failed': 'We could not reach Google. Check your connection and try again.',
  'auth/unauthorized-domain': 'This domain is not authorized for Google sign-in yet.',
  'auth/operation-not-allowed': 'Google sign-in is not enabled for this project yet.',
};
export const AUTH_FALLBACK_ERROR = 'Google sign-in did not complete. Please try again.';
