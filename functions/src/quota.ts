import { Timestamp, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpsError } from './http';
import type { QuotaAction } from './backend.types';
import { CONFIG } from './config.constant';
import { hash } from './cache';

/** Must be called after any other transaction reads, before any other writes. */
export async function reserveQuota(db: Firestore, transaction: Transaction, ownerId: string, action: QuotaAction): Promise<void> {
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const userWindow = action === 'createAnalysis' ? now.slice(0, 13) : day;
  const userRef = db.collection('quotas').doc(`${hash(ownerId)}_${userWindow}`);
  const globalRef = db.collection('quotas').doc(`global_${day}`);
  const refs = action === 'getAnalysis' ? [userRef] : [userRef, globalRef];
  const docs = await transaction.getAll(...refs);
  const count = Number(docs[0]!.data()?.[action] ?? 0);
  if (count >= CONFIG.quota[action]) throw new HttpsError('resource-exhausted', action === 'createAnalysis'
    ? 'You have reached the hourly analysis limit. Try again next hour.' : 'The application’s daily request limit has been reached. Please try again after 00:00 UTC.');
  const globalCount = Number(docs[1]?.data()?.[action] ?? 0);
  const globalLimit = action === 'createAnalysis' ? CONFIG.globalDailyQuota
    : action === 'interpretQuery' || action === 'meteomaticsSuggestions' ? CONFIG.globalInterpretDailyQuota : action === 'meteomaticsExecute' || action === 'giovanniExecute' || action === 'earthdataExecute' ? CONFIG.globalDailyQuota : CONFIG.globalSearchDailyQuota;
  if (action !== 'getAnalysis' && globalCount >= globalLimit) {
    throw new HttpsError('resource-exhausted', 'The service has reached its daily capacity. Try again tomorrow.');
  }
  const expiresAt = Timestamp.fromMillis(Date.parse(`${day}T00:00:00Z`) + 3 * 86400000);
  transaction.set(userRef, { [action]: count + 1, expiresAt }, { merge: true });
  if (action !== 'getAnalysis') transaction.set(globalRef, { [action]: globalCount + 1, expiresAt }, { merge: true });
}

export async function consumeQuota(db: Firestore, ownerId: string, action: QuotaAction): Promise<void> {
  await db.runTransaction(transaction => reserveQuota(db, transaction, ownerId, action));
}
