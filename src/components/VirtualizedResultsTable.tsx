import { forwardRef } from 'react';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { TableVirtuoso, type TableComponents } from 'react-virtuoso';
import type { MeteomaticsDisplayRow } from '../meteomatics-query.types';

const components: TableComponents<MeteomaticsDisplayRow> = {
  Table: props => <Table {...props} size="small" aria-label="Normalized observation values" />,
  TableHead: forwardRef((props, ref) => <TableHead {...props} ref={ref} />),
  TableBody: forwardRef((props, ref) => <TableBody {...props} ref={ref} />),
  TableRow,
};

function displayValue(value: number | string | null): string {
  if (value === null) return 'No value';
  if (typeof value === 'number' && [-999, -888, -777, -666].includes(value)) return `Missing (${value})`;
  return typeof value === 'number' ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value) : value;
}

export function VirtualizedResultsTable({ rows }: { rows: MeteomaticsDisplayRow[] }) {
  return <div className="meteo-response-table-wrap"><TableVirtuoso
    style={{ height: 430 }}
    data={rows}
    components={components}
    fixedHeaderContent={() => <TableRow><TableCell>Date (UTC)</TableCell><TableCell>Parameter</TableCell><TableCell>Latitude</TableCell><TableCell>Longitude</TableCell><TableCell align="right">Value</TableCell></TableRow>}
    itemContent={(_, row) => <><TableCell>{row.date}</TableCell><TableCell>{row.parameter}</TableCell><TableCell>{row.latitude ?? '—'}</TableCell><TableCell>{row.longitude ?? '—'}</TableCell><TableCell align="right">{displayValue(row.value)}</TableCell></>}
  /></div>;
}
