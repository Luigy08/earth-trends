import { Button, Tooltip } from '@mui/material';
import { PictureAsPdfOutlined } from '@mui/icons-material';

/** Shared PDF export action: the report is produced by the browser print dialog (Save as PDF). */
export function ExportPdfButton({ onClick, disabled = false, label = 'Export PDF' }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return <Tooltip title="Opens the print dialog. Choose “Save as PDF” as the destination.">
    <span><Button size="small" variant="outlined" disabled={disabled} startIcon={<PictureAsPdfOutlined />} onClick={onClick}>{label}</Button></span>
  </Tooltip>;
}
