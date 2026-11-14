export const MAX_YEAR = new Date().getFullYear() - 1;
export const EXAMPLE_QUERIES = [
  { label: 'Is my city getting warmer?', query: `How has the temperature changed in Tegucigalpa between 2000 and ${MAX_YEAR}?` },
  { label: 'Compare two cities', query: `Compare the temperature in Tegucigalpa and San Pedro Sula between 2000 and ${MAX_YEAR}.` },
  { label: 'Is it raining less?', query: `Has precipitation decreased in Madrid between 2000 and ${MAX_YEAR}?` },
];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const SERIES_COLORS = ['#295846', '#d7754e'];
export const CHART_VIEWS = [{ value: 'annual', label: 'Annual' }, { value: 'monthly', label: 'Monthly' }, { value: 'anomaly', label: 'Anomalies' }] as const;
export const ENV_KEYS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_APPCHECK_SITE_KEY'] as const;
