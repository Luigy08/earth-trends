import type { QueryWorkflow } from './app.types';

/** Project description shown on the sign-in page. Mirrors README.md; update both together. */
export const ABOUT_SECTION_ID = 'about-project';
export const CHALLENGE_URL = 'https://www.spaceappschallenge.org/2026/challenges/earth-system-trend-detective/';
export const ABOUT_INTRO = 'Earth Trend Detective is a web application for exploring how environmental variables change over time. It turns a question about a place and period into visual evidence, coverage information, and, when the data supports it, a statistical estimate of a linear trend.';
export const ABOUT_CHALLENGE = 'select Earth science variables, visualize their evolution, and investigate what is changing, where, by how much, and whether the change is statistically significant.';

export const CHALLENGE_QUESTIONS = [
  { question: 'What is changing?', answer: 'Explore temperature and precipitation in the trend workflow, or browse additional variables in the NASA Giovanni workflow.' },
  { question: 'Where is it changing?', answer: 'Select a geocoded location or compare two locations. Coordinates and source context accompany results.' },
  { question: 'How much is it changing?', answer: 'View monthly and annual observations and, when supported, a linear slope per decade with a 95% confidence interval.' },
  { question: 'Is the change significant?', answer: 'The trend workflow reports a p-value and significance at the 0.05 threshold, subject to its coverage requirements.' },
] as const;

export const INVESTIGATION_STEPS = [
  { title: 'Choose a workflow', description: 'Sign in with Google and choose a workflow in Explore.' },
  { title: 'Ask a question', description: 'Write it in English, including the variable, location, and dates. The assistant interprets the request and asks for clarification when needed.' },
  { title: 'Review and confirm', description: 'Check the proposed request before it runs. For trend analysis, select either NASA Giovanni or Meteomatics as the historical source.' },
  { title: 'Explore the evidence', description: 'Trend results include coverage, the estimated slope, uncertainty, and statistical evidence when inference is supported.' },
  { title: 'Keep the record', description: 'Download the data and provenance as JSON or save a PDF report. Sessions and analyses can be revisited from the sidebar.' },
] as const;
export const INVESTIGATION_EXAMPLE = 'How has temperature changed in Tegucigalpa since 2000?';
export const INVESTIGATION_NOTE = 'A second city or a second period can be included for comparison. A trend is an estimate over the selected period, not an explanation of its cause.';

export const ABOUT_WORKFLOWS: readonly { workflow: QueryWorkflow; title: string; description: string }[] = [
  { workflow: 'trend', title: 'Trend analysis', description: 'Analyzes temperature or precipitation for a location, compares two locations over common complete years, or compares two periods at one location. Each analysis uses one provider; data from different providers are not spliced together.' },
  { workflow: 'giovanni', title: 'NASA Giovanni data', description: 'Queries a curated catalog of NASA Earth science variables for a point and date range. The reviewed request returns provider series and source details.' },
  { workflow: 'earthdata', title: 'NASA Earthdata', description: 'Explores satellite data from NASA AppEEARS stored as averages over departments of Honduras. Department boundaries are from geoBoundaries / OpenStreetMap contributors.' },
  { workflow: 'meteomatics', title: 'Meteomatics data', description: 'Builds and confirms requests to the Meteomatics Weather API, checks source availability, and displays provider results. Supported parameters and coverage depend on the account and source.' },
];
export const ABOUT_SOURCES_NOTE = 'NASA data is available through the Giovanni integration. Meteomatics is a separate commercial data source and is not NASA data. Availability of each source depends on credentials, provider access, and coverage; the presence of an integration does not guarantee live access.';

export const METHOD_FACTS = [
  { value: '12', label: 'valid months for a year to count. Missing values are not interpolated.' },
  { value: '10', label: 'complete years, and 80% of the requested years, before a trend is inferred.' },
  { value: '95%', label: 'confidence interval on the slope per decade, from OLS with Newey–West uncertainty.' },
  { value: '0.05', label: 'significance threshold for the two-sided p-value.' },
] as const;
export const METHOD_NOTES = [
  'These are operational thresholds for this proof of concept, not a universal definition of adequate climate data. Results below the threshold remain descriptive and explicitly report insufficient data.',
  'A non-significant result does not prove that nothing changed. A significant trend does not establish its cause. Provider outages and missing coverage are reported separately from statistical results.',
  'The numerical analysis and report are calculated by the server; Gemini can help interpret a question and add a qualitative explanation.',
] as const;

export const ABOUT_REFERENCES: readonly { label: string; href: string; workflow?: QueryWorkflow }[] = [
  { label: 'NASA Space Apps challenge', href: CHALLENGE_URL },
  { label: 'NASA Giovanni', href: 'https://giovanni.gsfc.nasa.gov/giovanni/', workflow: 'giovanni' },
  { label: 'NASA AppEEARS', href: 'https://appeears.earthdatacloud.nasa.gov/', workflow: 'earthdata' },
  { label: 'Meteomatics Weather API', href: 'https://www.meteomatics.com/en/api/getting-started/', workflow: 'meteomatics' },
  { label: 'Open-Meteo geocoding', href: 'https://open-meteo.com/en/docs/geocoding-api' },
];
