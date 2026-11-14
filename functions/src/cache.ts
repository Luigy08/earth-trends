import { createHash } from 'node:crypto';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { CacheStore } from './backend.types';

export function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class FirestoreCache implements CacheStore {
  constructor(private readonly db: Firestore) {}
  async get<T>(key: string): Promise<T | null> {
    try {
      const data = (await this.db.collection('serverCache').doc(hash(key)).get()).data();
      return data && data.expiresAt?.toMillis() > Date.now() ? data.value as T : null;
    } catch { return null; } // Cache failures never block scientific work.
  }
  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.db.collection('serverCache').doc(hash(key)).set({ value, expiresAt: Timestamp.fromMillis(Date.now() + ttlSeconds * 1000) });
    } catch { /* Best effort; primary analysis remains durable. */ }
  }
}
