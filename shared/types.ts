/** Public callable contract. All callables require Firebase Authentication. */
export type ClimateMetric = 'temperature' | 'precipitation';
export type AnalysisStatus = 'queued' | 'processing' | 'completed' | 'insufficient_data' | 'source_unavailable' | 'failed';
export type ScientificOutcome = 'sufficient_data' | 'insufficient_data' | 'source_unavailable';
export type ComparisonMode = 'none' | 'locations' | 'periods';
export interface AnalysisPeriod { startYear: number; endYear: number }
/** Historical series provider. Omitted means 'meteomatics'. One provider per analysis; never spliced. */
export type HistoricalDataSource = 'meteomatics' | 'giovanni';
export type HistoricalProviderName = 'Meteomatics' | 'NASA Giovanni';

export interface Location {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
}

export interface AnalysisSpec {
  metric: ClimateMetric;
  locations: Location[];
  startYear: number;
  endYear: number;
  comparisonMode: ComparisonMode;
  secondPeriod?: AnalysisPeriod;
  dataSource?: HistoricalDataSource;
}

export interface InterpretQueryRequest { query: string }
export interface InterpretQueryResponse {
  status: 'ready' | 'needs_clarification';
  spec?: AnalysisSpec;
  summary: string;
  warnings: string[];
  clarificationQuestions: string[];
}
export interface SearchLocationsRequest { query: string; limit?: number }
export interface SearchLocationsResponse { locations: Location[] }
export interface CreateAnalysisRequest { spec: AnalysisSpec; requestId: string }
export interface CreateAnalysisResponse { analysisId: string; status: AnalysisStatus }
export interface GetAnalysisRequest { analysisId: string }
export interface GetAnalysisResponse { analysis: Analysis }

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  spec?: AnalysisSpec;
  analysisId?: string;
}
export interface ConversationSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  analysisId?: string;
  workflow?: 'meteomatics' | 'giovanni' | 'earthdata' | 'trend';
}
export interface ListSessionsResponse { sessions: ConversationSession[] }
export interface SessionRequest { sessionId: string }
export interface CreateSessionResponse { session: ConversationSession }
export interface GetSessionResponse { session: ConversationSession; messages: ConversationMessage[] }
export interface RenameSessionRequest extends SessionRequest { title: string }
export interface ChatSessionRequest extends SessionRequest { message: string }
export interface ChatSessionResponse {
  session: ConversationSession;
  messages: ConversationMessage[];
  status: 'needs_clarification' | 'ready';
  spec?: AnalysisSpec;
}
export interface AttachSessionAnalysisRequest extends SessionRequest { analysisId: string }
export interface AttachSessionAnalysisResponse { attached: true; message: ConversationMessage }
export interface DeleteSessionResponse { deleted: true }

export type MeteomaticsQueryMode = 'point' | 'grid' | 'station' | 'route' | 'polygon' | 'trajectory';
export type MeteomaticsSource = string;
export interface MeteomaticsCoordinate { latitude: number; longitude: number }
export interface MeteomaticsTrajectoryPoint extends MeteomaticsCoordinate { date: string; altitude?: number }
export interface MeteomaticsQuerySpec {
  mode: MeteomaticsQueryMode;
  source: MeteomaticsSource;
  parameters: string[];
  validDates: string;
  format: 'json' | 'csv' | 'xml';
  options?: { calibrated?: boolean; mask?: 'land' | 'sea'; ens_select?: string };
  point?: MeteomaticsCoordinate;
  grid?: { north: number; west: number; south: number; east: number; resolution: string };
  stationIds?: string[];
  route?: MeteomaticsCoordinate[];
  polygon?: { coordinates: MeteomaticsCoordinate[]; aggregate: 'min' | 'max' | 'mean' | 'median' | 'mode' };
  trajectory?: MeteomaticsTrajectoryPoint[];
}
export interface MeteomaticsCatalogEntry { parameter: string; description: string; domain: string }
export interface MeteomaticsCatalogResponse { version: string; sourceUrl: string; parameters: MeteomaticsCatalogEntry[] }
export interface InterpretMeteomaticsRequest { query: string }
export interface InterpretMeteomaticsResponse { status: 'ready' | 'needs_clarification'; spec?: MeteomaticsQuerySpec; summary: string; clarificationQuestions: string[]; suggestions?: string[]; locationLabel?: string }
export interface MeteomaticsAvailabilityRequest { spec: MeteomaticsQuerySpec }
export interface MeteomaticsAvailabilityResponse { available: boolean; ranges: Array<{ parameter: string; minDate: string; maxDate: string; requestedWithinRange: boolean }>; message?: string }
export interface MeteomaticsExecuteRequest { spec: MeteomaticsQuerySpec; confirmed: true }
export interface MeteomaticsExecuteResponse { provider: 'Meteomatics'; source: string; requestedAt: string; request: Omit<MeteomaticsQuerySpec, 'trajectory'> & { trajectory?: MeteomaticsTrajectoryPoint[] }; responseFormat: string; result: unknown; provenance: DataProvenance; chartTrends?: MeteomaticsChartTrend[] }

/** Public result values: temperature °C; precipitation mm/month. Internal providers use mm/day. */
export interface MonthlyObservation { year: number; month: number; value: number | null }
export interface AnnualObservation { year: number; value: number; anomaly: number | null }
export interface TrendStatistics {
  method: 'OLS-Newey-West';
  slopePerYear: number;
  slopePerDecade: number;
  intercept: number;
  confidenceInterval95PerDecade: [number, number];
  pValue: number;
  significant: boolean;
  sampleSize: number;
  lag: number;
  rSquared: number;
}
export interface DataQuality {
  requestedYears: number;
  completeYears: number;
  coverage: number;
  excludedYears: number[];
  baselineYears: number;
  warnings: string[];
}
export interface DataProvenance {
  provider: HistoricalProviderName | 'Open-Meteo' | 'NASA AppEEARS';
  dataset: string;
  parameters: string[];
  sourceUrl: string;
  retrievedAt: string;
  temporalResolution: 'monthly' | 'current' | 'request-defined';
  isHistorical: boolean;
  attribution: string;
}
export interface CurrentWeather {
  status: 'available' | 'source_unavailable' | 'disabled';
  observedAt: string | null;
  temperatureC: number | null;
  precipitationMm: number | null;
  provenance: DataProvenance | null;
  notice: string;
}
export interface LocationAnalysis {
  location: Location;
  period: AnalysisPeriod;
  outcome: ScientificOutcome;
  unit: '°C' | 'mm/year';
  monthly: MonthlyObservation[];
  annual: AnnualObservation[];
  trend: TrendStatistics | null;
  quality: DataQuality;
  baseline: { startYear: 1991; endYear: 2020; mean: number | null };
  source: HistoricalProviderName;
  provenance: DataProvenance | null;
  currentWeather: CurrentWeather;
}
export interface AnalysisResult {
  outcome: ScientificOutcome;
  locations: LocationAnalysis[];
  commonYears: number[];
  comparison: {
    mode: 'locations' | 'periods';
    slopeDifferencePerDecade: number | null;
    meanDifference: number | null;
    description: string;
  } | null;
  narrative: string;
  warnings: string[];
  methodologyVersion: string;
}
export interface Analysis {
  id: string;
  ownerId: string;
  spec: AnalysisSpec;
  status: AnalysisStatus;
  createdAt: string;
  updatedAt: string;
  result?: AnalysisResult;
  error?: { code: string; message: string };
}

export interface MeteomaticsSessionState {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  proposal: MeteomaticsQuerySpec | null;
  results: MeteomaticsExecuteResponse[];
  suggestions: string[];
  summary: string;
  locationLabel: string;
  selectedParameters: string[];
}

export interface MeteomaticsChartTrend {
  parameter: string;
  latitude: number;
  longitude: number;
  annual: AnnualObservation[];
  trend: TrendStatistics | null;
  requestedYears: number;
  aggregation?: 'mean' | 'sum';
  monthly?: MonthlyObservation[];
  excludedYears?: number[];
  dailyFit?: { origin: number; slopePerYear: number; intercept: number; mean: number; maximum: number; rSquared: number | null; count: number } | null;
}

export interface MeteomaticsSuggestionsResponse { suggestions: string[] }

/** NASA Giovanni point time-series request (chat workflow). Dates are UTC calendar days, YYYY-MM-DD. */
export interface GiovanniQuerySpec {
  variables: string[];
  point: MeteomaticsCoordinate;
  startDate: string;
  endDate: string;
}
export interface GiovanniCatalogResponse { version: string; sourceUrl: string; variables: import('./giovanni.types').GiovanniVariable[] }
export interface InterpretGiovanniRequest { query: string }
export interface InterpretGiovanniResponse { status: 'ready' | 'needs_clarification'; spec?: GiovanniQuerySpec; summary: string; clarificationQuestions: string[]; suggestions?: string[]; locationLabel?: string }
export interface GiovanniExecuteRequest { spec: GiovanniQuerySpec; confirmed: true }
/** `result` uses the Meteomatics JSON envelope ({ data: [{ parameter: "<id>:<unit>", coordinates: [{ lat, lon, dates }] }] }) with raw provider values. */
export interface GiovanniExecuteResponse { provider: 'NASA Giovanni'; source: 'giovanni'; requestedAt: string; request: GiovanniQuerySpec; responseFormat: 'json'; result: unknown; provenance: DataProvenance; chartTrends?: MeteomaticsChartTrend[] }
export type QueryExecuteResponse = MeteomaticsExecuteResponse | GiovanniExecuteResponse | EarthdataExecuteResponse;
export interface GiovanniSessionState {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  proposal: GiovanniQuerySpec | null;
  results: GiovanniExecuteResponse[];
  suggestions: string[];
  summary: string;
  locationLabel: string;
  selectedParameters: string[];
}
export type QuerySessionWorkflow = 'meteomatics' | 'giovanni' | 'earthdata';

/** NASA Earthdata request (chat workflow): stored AppEEARS zonal series. Dates are calendar days, YYYY-MM-DD. */
export interface EarthdataQuerySpec {
  /** Canonical variable ids from the Earthdata catalog. */
  variables: string[];
  /** Zone ids from the Earthdata catalog, e.g. "HN-FM". */
  zones: string[];
  startDate: string;
  endDate: string;
}
export interface EarthdataCatalogResponse { provider: string; sourceUrl: string; variables: import('./earthdata.types').EarthdataVariable[]; zones: import('./earthdata.types').EarthdataZone[] }
export interface InterpretEarthdataRequest { query: string }
export interface InterpretEarthdataResponse { status: 'ready' | 'needs_clarification'; spec?: EarthdataQuerySpec; summary: string; clarificationQuestions: string[]; suggestions?: string[]; locationLabel?: string }
export interface EarthdataExecuteRequest { spec: EarthdataQuerySpec; confirmed: true }
/** `result` uses the Meteomatics JSON envelope; each entry is one variable in one zone, labeled "<variable> · <zone>:<unit>". */
export interface EarthdataExecuteResponse { provider: 'NASA AppEEARS'; source: 'earthdata'; requestedAt: string; request: EarthdataQuerySpec; responseFormat: 'json'; result: unknown; provenance: DataProvenance; chartTrends?: MeteomaticsChartTrend[];
  /** What the reader must know about this result: a series that stops early and what was requested from NASA to complete it. */
  notices?: string[] }
export interface EarthdataSessionState {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  proposal: EarthdataQuerySpec | null;
  results: EarthdataExecuteResponse[];
  suggestions: string[];
  summary: string;
  locationLabel: string;
  selectedParameters: string[];
  selectedZones: string[];
}
