import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import type { Analysis, ConversationMessage, ConversationSession, AnalysisSpec } from '../../shared/types';

interface StoredSession extends ConversationSession { ownerId: string }

export class SessionRepository {
  constructor(private readonly db: Firestore) {}
  private ref(sessionId: string) { return this.db.collection('sessions').doc(sessionId); }

  async create(ownerId: string): Promise<ConversationSession> {
    const now = new Date().toISOString();
    const session: StoredSession = { id: randomUUID(), ownerId, title: 'New climate question', createdAt: now, updatedAt: now };
    await this.ref(session.id).create(session);
    return session;
  }

  async list(ownerId: string): Promise<ConversationSession[]> {
    const rows = await this.db.collection('sessions').where('ownerId', '==', ownerId).orderBy('updatedAt', 'desc').limit(100).get();
    return rows.docs.map(doc => this.publicSession(doc.data() as StoredSession));
  }

  async get(ownerId: string, sessionId: string): Promise<{ session: ConversationSession; messages: ConversationMessage[] }> {
    const session = await this.owned(ownerId, sessionId);
    const rows = await this.ref(sessionId).collection('messages').orderBy('createdAt', 'asc').limit(200).get();
    return { session: this.publicSession(session), messages: rows.docs.map(doc => doc.data() as ConversationMessage) };
  }

  async append(ownerId: string, sessionId: string, userText: string, assistantText: string, spec?: AnalysisSpec) {
    const session = await this.owned(ownerId, sessionId);
    const now = new Date().toISOString();
    const userMessage: ConversationMessage = { id: randomUUID(), role: 'user', content: userText, createdAt: now };
    const assistantMessage: ConversationMessage = { id: randomUUID(), role: 'assistant', content: assistantText, createdAt: new Date(Date.now() + 1).toISOString(), ...(spec ? { spec } : {}) };
    const batch = this.db.batch();
    const messages = this.ref(sessionId).collection('messages');
    batch.create(messages.doc(userMessage.id), userMessage);
    batch.create(messages.doc(assistantMessage.id), assistantMessage);
    const nextTitle = session.title === 'New climate question' ? userText.slice(0, 64).trim() : session.title;
    batch.update(this.ref(sessionId), { title: nextTitle || session.title, updatedAt: assistantMessage.createdAt });
    await batch.commit();
    return { session: { ...this.publicSession(session), title: nextTitle || session.title, updatedAt: assistantMessage.createdAt }, messages: [userMessage, assistantMessage] };
  }

  async rename(ownerId: string, sessionId: string, title: string): Promise<ConversationSession> {
    const session = await this.owned(ownerId, sessionId);
    const updatedAt = new Date().toISOString();
    await this.ref(sessionId).update({ title, updatedAt });
    return { ...this.publicSession(session), title, updatedAt };
  }

  async attachAnalysis(ownerId: string, sessionId: string, analysis: Analysis): Promise<ConversationMessage> {
    await this.owned(ownerId, sessionId);
    const message: ConversationMessage = { id: randomUUID(), role: 'assistant', content: 'Analysis submitted. Your results will appear here when processing is complete.', createdAt: new Date().toISOString(), analysisId: analysis.id };
    const batch = this.db.batch();
    batch.set(this.ref(sessionId), { analysisId: analysis.id, updatedAt: message.createdAt }, { merge: true });
    batch.create(this.ref(sessionId).collection('messages').doc(message.id), message);
    await batch.commit();
    return message;
  }

  async delete(ownerId: string, sessionId: string): Promise<void> {
    await this.owned(ownerId, sessionId);
    const messages = this.ref(sessionId).collection('messages');
    while (true) {
      const page = await messages.limit(400).get();
      if (page.empty) break;
      const batch = this.db.batch();
      page.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
    for (const name of ['meteoState', 'comparisons']) {
      const state = await this.ref(sessionId).collection(name).get();
      if (!state.empty) { const batch = this.db.batch(); state.docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); }
    }
    await this.ref(sessionId).delete();
  }

  private async owned(ownerId: string, sessionId: string): Promise<StoredSession> {
    const snapshot = await this.ref(sessionId).get();
    const session = snapshot.data() as StoredSession | undefined;
    if (!session || session.ownerId !== ownerId) throw new HttpsError('not-found', 'Session not found.');
    return session;
  }

  private publicSession({ ownerId: _ownerId, ...session }: StoredSession): ConversationSession { return session; }
}
