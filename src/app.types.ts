import type { AnalysisSpec, Location } from '../shared/types';
export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
export type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };

export type ChartView = 'annual' | 'monthly' | 'anomaly';
export type NavigationPage = 'explore' | 'analyses' | 'realtime';
export type QueryMode = 'question' | 'form';
export type AnalysisDraft = Omit<AnalysisSpec, 'locations'> & { locations: (Location | null)[] };
export type ChartRow = { label: string; [key: string]: string | number | null };
