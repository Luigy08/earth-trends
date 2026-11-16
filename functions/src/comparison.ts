import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { ComparableSeries, CompareSessionsRequest, ConversationSession, GetComparableSeriesResponse, SessionComparison } from '../../shared/types';
import { analysisSessionSeries, querySessionSeries, summarize, type QuerySessionState } from './comparison-series.resolver';
import { compareSeries } from './comparison-statistics';
import { comparisonPayload, explainComparison } from './comparison-ai';
import { COMPARISON_METHODOLOGY_VERSION } from './config.constant';
import type { AnalysisRepository } from './repository';
import type { SessionRepository } from './sessions';

/** One stored comparison per session: comparing again returns it unchanged. */
export class ComparisonService {
  constructor(private readonly db: Firestore, private readonly sessions: SessionRepository, private readonly analyses: AnalysisRepository) {}

  private comparisonRef(sessionId: string) { return this.db.collection('sessions').doc(sessionId).collection('comparisons').doc('latest'); }

  /** Query-chat state as stored by saveMeteomaticsSession (chunked JSON). Ownership must be checked by the caller. */
  async loadQueryState(sessionId: string): Promise<QuerySessionState | null> {
    const snapshot = await this.db.collection('sessions').doc(sessionId).collection('meteoState').orderBy('index').get();
    return snapshot.empty ? null : JSON.parse(snapshot.docs.map(doc => doc.get('data')).join('')) as QuerySessionState;
  }

  private async seriesOf(ownerId: string, sessionId: string): Promise<{ session: ConversationSession; series: ComparableSeries[] }> {
    const { session } = await this.sessions.get(ownerId, sessionId);
    if (session.workflow === 'meteomatics' || session.workflow === 'giovanni' || session.workflow === 'earthdata') {
      return { session, series: querySessionSeries(session, await this.loadQueryState(sessionId)) };
    }
    if (session.analysisId) {
      const analysis = await this.analyses.get(ownerId, session.analysisId).catch(() => null);
      return { session, series: analysisSessionSeries(session, analysis) };
    }
    return { session, series: querySessionSeries(session, await this.loadQueryState(sessionId)) };
  }

  async listSeries(ownerId: string, sessionId: string): Promise<GetComparableSeriesResponse> {
    const { series } = await this.seriesOf(ownerId, sessionId);
    return series.length ? { series: series.map(summarize) }
      : { series: [], unavailableReason: 'This session has no monthly series to compare yet. Only completed results with monthly values can be compared.' };
  }

  async get(ownerId: string, sessionId: string): Promise<SessionComparison | null> {
    await this.sessions.get(ownerId, sessionId);
    const snapshot = await this.comparisonRef(sessionId).get();
    return snapshot.exists ? snapshot.data() as SessionComparison : null;
  }

  async compare(ownerId: string, input: CompareSessionsRequest): Promise<SessionComparison> {
    const existing = await this.get(ownerId, input.sessionId);
    if (existing) return existing;
    const [mine, other] = await Promise.all([this.seriesOf(ownerId, input.sessionId), this.seriesOf(ownerId, input.otherSessionId)]);
    const a = mine.series.find(series => series.key === input.seriesKey);
    const b = other.series.find(series => series.key === input.otherSeriesKey);
    if (!a || !b) throw new HttpsError('failed-precondition', 'The selected series is no longer available in one of the sessions.');
    const { aligned, commonYears, statistics, warnings } = compareSeries(a, b);
    const report = await explainComparison(comparisonPayload(a, b, statistics, aligned.length, commonYears));
    const comparison: SessionComparison = {
      id: `${input.sessionId}:${input.otherSessionId}`, createdAt: new Date().toISOString(),
      outcome: statistics ? 'completed' : 'insufficient_data', a, b, commonMonths: aligned.length, commonYears,
      statistics, report, warnings, methodologyVersion: COMPARISON_METHODOLOGY_VERSION,
    };
    // create() fails if a concurrent request already stored one; that stored comparison wins.
    try { await this.comparisonRef(input.sessionId).create(JSON.parse(JSON.stringify(comparison)) as SessionComparison); }
    catch { return (await this.get(ownerId, input.sessionId)) ?? comparison; }
    return comparison;
  }
}
