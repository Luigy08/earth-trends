import type { Firestore } from 'firebase-admin/firestore';

type RecordData = Record<string, unknown>;
class MemoryDocument {
  constructor(readonly path: string, private readonly store: MemoryFirestore) {}
  async get() { return this.store.snapshot(this); }
}

/** Transactional test double: asserts Firestore's read-before-write contract. */
export class MemoryFirestore {
  readonly documents = new Map<string, RecordData>();
  private tail: Promise<unknown> = Promise.resolve();
  collection(name: string) { return { doc: (id: string) => new MemoryDocument(`${name}/${id}`, this) }; }
  snapshot(ref: MemoryDocument) {
    const value = this.documents.get(ref.path);
    return { exists: value !== undefined, data: () => value ? { ...value } : undefined };
  }
  async runTransaction<T>(callback: (transaction: ReturnType<MemoryFirestore['transaction']>) => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const transaction = this.transaction();
      const result = await callback(transaction);
      transaction.commit();
      return result;
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
  private transaction() {
    const writes: (() => void)[] = [];
    const read = (ref: MemoryDocument) => {
      if (writes.length) throw new Error('Firestore read after transaction write');
      return this.snapshot(ref);
    };
    return {
      get: async (ref: MemoryDocument) => read(ref),
      getAll: async (...refs: MemoryDocument[]) => refs.map(read),
      create: (ref: MemoryDocument, value: RecordData) => writes.push(() => {
        if (this.documents.has(ref.path)) throw new Error('Already exists');
        this.documents.set(ref.path, value);
      }),
      set: (ref: MemoryDocument, value: RecordData, options?: { merge: boolean }) => writes.push(() => {
        this.documents.set(ref.path, { ...(options?.merge ? this.documents.get(ref.path) : {}), ...value });
      }),
      update: (ref: MemoryDocument, value: RecordData) => writes.push(() => {
        if (!this.documents.has(ref.path)) throw new Error('Missing document');
        this.documents.set(ref.path, { ...this.documents.get(ref.path), ...value });
      }),
      commit: () => writes.forEach(write => write()),
    };
  }
  asFirestore(): Firestore { return this as unknown as Firestore; }
}
