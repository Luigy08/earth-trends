export class SourceError extends Error {
  constructor(public readonly provider: string, public readonly retryable = false) {
    super(`${provider} is unavailable`);
  }
}

export async function fetchJson(url: string, provider: string, headers?: Record<string, string>): Promise<unknown> {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new SourceError(provider, response.status === 429 || response.status >= 500);
    const body = await response.text();
    if (body.length > 8_000_000) throw new SourceError(provider);
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new SourceError(provider, true);
  }
}
