export type ComparisonView = 'monthly' | 'annual';

export interface ComparisonChartRow {
  time: number;
  a: number | null;
  b: number | null;
  aTrend?: number | null;
  bTrend?: number | null;
}
