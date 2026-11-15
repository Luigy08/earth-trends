import { JOB_SWEEP_MS, WORKER_CONCURRENCY } from './config.constant';
import { logger } from './logger';

/**
 * Runs queued analyses inside the server process. `enqueue` starts a new analysis immediately; the periodic sweep
 * recovers what a restart or a failed attempt left behind. Correctness rests on the job lease, not on this queue:
 * claiming a job twice is refused by the repository.
 */
export class AnalysisWorker {
  private readonly active = new Set<string>();
  private readonly waiting: string[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly pending: () => Promise<string[]>,
    private readonly processAnalysis: (analysisId: string) => Promise<void>,
    private readonly concurrency = WORKER_CONCURRENCY,
  ) {}

  enqueue(analysisId: string): void {
    if (this.active.has(analysisId) || this.waiting.includes(analysisId)) return;
    this.waiting.push(analysisId);
    this.drain();
  }

  start(): void {
    if (this.timer) return;
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), JOB_SWEEP_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private drain(): void {
    while (this.active.size < this.concurrency && this.waiting.length) {
      const analysisId = this.waiting.shift()!;
      this.active.add(analysisId);
      void this.processAnalysis(analysisId)
        // A job that could not be claimed or released stays in the store; the next sweep retries it.
        .catch(() => logger.warn('Analysis attempt was not completed', { analysisId }))
        .finally(() => { this.active.delete(analysisId); this.drain(); });
    }
  }

  private async sweep(): Promise<void> {
    try { for (const analysisId of await this.pending()) this.enqueue(analysisId); }
    catch { logger.warn('Analysis queue sweep failed'); }
  }
}
