export interface MeteomaticsDisplayRow {
  parameter: string;
  date: string;
  latitude: number | null;
  longitude: number | null;
  value: number | string | null;
}

export interface MeteomaticsDisplayResult {
  rows: MeteomaticsDisplayRow[];
  totalRows: number;
  truncated: boolean;
  status: string | null;
  version: string | null;
}

export type QueryChartType = 'auto' | 'points' | 'line' | 'bar';
