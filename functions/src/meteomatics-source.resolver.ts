/** ECMWF publishes multiple distinct products; its organization name is not an API source. */
export function meteomaticsSourceIssue(source: unknown): string | null {
  return typeof source === 'string' && source.trim().toLowerCase() === 'ecmwf'
    ? 'ECMWF has several products. Choose a specific source, such as ecmwf-ifs for forecasts or an appropriate reanalysis source; access and historical coverage depend on your account.'
    : null;
}
