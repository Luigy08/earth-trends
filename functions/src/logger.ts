type LogFields = Record<string, unknown>;

function write(severity: 'INFO' | 'WARNING' | 'ERROR', message: string, fields?: LogFields): void {
  // One JSON object per line, so the host's log viewer can filter by severity and field.
  // A caller's own `message` field is kept as `detail` so it cannot replace the log message.
  const { message: detail, ...rest } = fields ?? {};
  const line = JSON.stringify({ severity, message, ...rest, ...(detail === undefined ? {} : { detail }) });
  if (severity === 'ERROR') console.error(line);
  else if (severity === 'WARNING') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write('INFO', message, fields),
  warn: (message: string, fields?: LogFields) => write('WARNING', message, fields),
  error: (message: string, fields?: LogFields) => write('ERROR', message, fields),
};
