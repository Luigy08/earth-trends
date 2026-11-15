import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from './http';
import type { Analysis, AnalysisResult, AnalysisSpec, CreateAnalysisResponse } from '../../shared/types';
import type { AnalysisJob, StoredAnalysis } from './backend.types';
import { hash } from './cache';
import { LEASE_MS, MAX_ATTEMPTS } from './config.constant';
import { reserveQuota } from './quota';

export class AnalysisRepository {
  constructor(private readonly db: Firestore) {}
  async create(ownerId: string, spec: AnalysisSpec, requestId: string): Promise<CreateAnalysisResponse> {
    const id = hash([ownerId, requestId]);
    const specHash = hash(spec);
    const ref = this.db.collection('analyses').doc(id);
    return this.db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (existing.exists) {
        const analysis = existing.data() as StoredAnalysis;
        if (analysis.ownerId !== ownerId || analysis.specHash !== specHash) {
          throw new HttpsError('already-exists', 'This requestId was already used for another request.');
        }
        return { analysisId: id, status: analysis.status };
      }
      await reserveQuota(this.db, transaction, ownerId, 'createAnalysis');
      const now = new Date().toISOString();
      const analysis: StoredAnalysis = { id, ownerId, spec, specHash, status: 'queued', createdAt: now, updatedAt: now };
      transaction.create(ref, analysis);
      const job: AnalysisJob = { analysisId: id, ownerId, spec, status: 'queued', attempts: 0 };
      transaction.create(this.db.collection('analysisJobs').doc(id), job);
      return { analysisId: id, status: 'queued' };
    });
  }
  async get(ownerId: string, analysisId: string): Promise<Analysis> {
    const snapshot = await this.db.collection('analyses').doc(analysisId).get();
    const data = snapshot.data() as StoredAnalysis | undefined;
    // Conceal existence of another user's document.
    if (!data || data.ownerId !== ownerId) throw new HttpsError('not-found', 'Analysis not found.');
    const { specHash: _specHash, ...analysis } = data;
    return analysis;
  }
  /** Jobs a worker may claim now: queued ones and those whose lease expired without finishing. */
  async pending(): Promise<string[]> {
    const snapshot = await this.db.collection('analysisJobs').where('status', 'in', ['queued', 'processing']).get();
    return snapshot.docs.filter(doc => {
      const job = doc.data() as AnalysisJob;
      return job.status === 'queued' || (job.leaseUntil ?? 0) <= Date.now();
    }).map(doc => doc.id);
  }
  async claim(analysisId: string): Promise<{ job: AnalysisJob; token: string } | null> {
    const jobRef = this.db.collection('analysisJobs').doc(analysisId);
    const analysisRef = this.db.collection('analyses').doc(analysisId);
    return this.db.runTransaction(async transaction => {
      const [snapshot, analysis] = await transaction.getAll(jobRef, analysisRef);
      if (!snapshot!.exists || !analysis!.exists) return null;
      const job = snapshot!.data() as AnalysisJob;
      if (job.status === 'completed' || job.status === 'failed') return null;
      if (job.status === 'processing' && (job.leaseUntil ?? 0) > Date.now()) throw new Error('Lease activa; reintentar entrega');
      if (job.attempts >= MAX_ATTEMPTS) {
        transaction.update(jobRef, { status: 'failed' });
        transaction.update(analysisRef, { status: 'failed', updatedAt: new Date().toISOString(),
          error: { code: 'processing_failed', message: 'The analysis could not be completed. Create a new request.' } });
        return null;
      }
      const token = randomUUID();
      transaction.update(jobRef, { status: 'processing', attempts: job.attempts + 1, leaseToken: token, leaseUntil: Date.now() + LEASE_MS });
      transaction.update(analysisRef, { status: 'processing', updatedAt: new Date().toISOString() });
      return { job: { ...job, attempts: job.attempts + 1 }, token };
    });
  }
  async finish(analysisId: string, token: string, result: AnalysisResult): Promise<void> {
    await this.db.runTransaction(async transaction => {
      const ref = this.db.collection('analysisJobs').doc(analysisId);
      const job = (await transaction.get(ref)).data() as AnalysisJob | undefined;
      if (!job || job.leaseToken !== token || job.status !== 'processing') return;
      const status = result.outcome === 'sufficient_data' ? 'completed' : result.outcome;
      transaction.update(this.db.collection('analyses').doc(analysisId), { result, status, updatedAt: new Date().toISOString() });
      transaction.update(ref, { status: 'completed', leaseUntil: 0 });
    });
  }
  async release(analysisId: string, token: string): Promise<void> {
    await this.db.runTransaction(async transaction => {
      const ref = this.db.collection('analysisJobs').doc(analysisId);
      const job = (await transaction.get(ref)).data() as AnalysisJob | undefined;
      if (!job || job.leaseToken !== token || job.status !== 'processing') return;
      const failed = job.attempts >= MAX_ATTEMPTS;
      transaction.update(ref, { status: failed ? 'failed' : 'queued', leaseUntil: 0 });
      transaction.update(this.db.collection('analyses').doc(analysisId), { status: failed ? 'failed' : 'queued', updatedAt: new Date().toISOString(),
        ...(failed ? { error: { code: 'processing_failed', message: 'The analysis could not be completed. Create a new request.' } } : {}),
      });
    });
  }
}
