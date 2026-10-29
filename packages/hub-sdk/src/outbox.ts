/**
 * Persistent outbox for live earn, relic, and exchange calls.
 * The server idempotency key is a UUIDv7 minted once when the row is created.
 * The row is committed before the RPC. Retries resend that same key.
 */

export type EconomyRpc = 'tickets.earn' | 'session.event' | 'tickets.exchange';

export interface OutboxPending {
  opId: string;
  idemKey: string;
  rpc: EconomyRpc;
  playerId: string;
  game: string;
  body: Record<string, unknown>;
  token: string;
  createdAt: number;
  lastError?: string;
}

export interface OutboxSettled {
  opId: string;
  idemKey: string;
  rpc: EconomyRpc;
  playerId: string;
  game: string;
  body: Record<string, unknown>;
  response: unknown;
}

export interface LiveOutbox {
  ready(): Promise<void>;
  list(playerId: string): OutboxPending[];
  all(): OutboxPending[];
  settled(opId: string): OutboxSettled | null;
  /** Insert the row if this operation is new. An existing row keeps its idemKey. */
  claim(draft: Omit<OutboxPending, 'idemKey'>): Promise<OutboxPending>;
  settle(row: OutboxPending, response: unknown): Promise<void>;
  markError(opId: string, code: string): Promise<void>;
}

const DB_NAME = 'metaverse-hub';
const DB_VERSION = 1;
const PENDING = 'outbox';
const SETTLED = 'settled';

export function uuidV7(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const ts = BigInt(now);
  bytes[0] = Number((ts >> 40n) & 255n);
  bytes[1] = Number((ts >> 32n) & 255n);
  bytes[2] = Number((ts >> 24n) & 255n);
  bytes[3] = Number((ts >> 16n) & 255n);
  bytes[4] = Number((ts >> 8n) & 255n);
  bytes[5] = Number(ts & 255n);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sameBody(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return stable(left) === stable(right);
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`).join(',')}}`;
}

export function createMemoryOutbox(): LiveOutbox {
  const pending = new Map<string, OutboxPending>();
  const settled = new Map<string, OutboxSettled>();
  let chain: Promise<unknown> = Promise.resolve();

  function lock<T>(run: () => Promise<T> | T): Promise<T> {
    const next = chain.then(run, run);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  return {
    async ready() {
      return undefined;
    },
    list(playerId) {
      return [...pending.values()].filter((row) => row.playerId === playerId);
    },
    all() {
      return [...pending.values()];
    },
    settled(opId) {
      return settled.get(opId) ?? null;
    },
    claim(draft) {
      return lock(() => {
        const existing = pending.get(draft.opId);
        if (existing) return existing;
        const created: OutboxPending = {
          ...draft,
          body: JSON.parse(JSON.stringify(draft.body)) as Record<string, unknown>,
          idemKey: uuidV7(),
        };
        pending.set(created.opId, created);
        return created;
      });
    },
    settle(row, response) {
      return lock(() => {
        pending.delete(row.opId);
        settled.set(row.opId, {
          opId: row.opId,
          idemKey: row.idemKey,
          rpc: row.rpc,
          playerId: row.playerId,
          game: row.game,
          body: row.body,
          response,
        });
      });
    },
    markError(opId, code) {
      return lock(() => {
        const row = pending.get(opId);
        if (!row) return;
        pending.set(opId, { ...row, lastError: code });
      });
    },
  };
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

export function createIndexedDbOutbox(): LiveOutbox {
  const pending = new Map<string, OutboxPending>();
  const settledRows = new Map<string, OutboxSettled>();
  let opening: Promise<IDBDatabase> | null = null;
  let loaded = false;
  let chain: Promise<unknown> = Promise.resolve();

  function lock<T>(run: () => Promise<T>): Promise<T> {
    const next = chain.then(run, run);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function open(): Promise<IDBDatabase> {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PENDING)) db.createObjectStore(PENDING, { keyPath: 'opId' });
        if (!db.objectStoreNames.contains(SETTLED)) db.createObjectStore(SETTLED, { keyPath: 'opId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    });
    return opening;
  }

  let loading: Promise<void> | null = null;

  function load(): Promise<void> {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    loading = (async () => {
      const db = await open();
      const tx = db.transaction([PENDING, SETTLED], 'readonly');
      const pendingReq = tx.objectStore(PENDING).getAll();
      const settledReq = tx.objectStore(SETTLED).getAll();
      const [pendingRows, doneRows] = await Promise.all([
        requestToPromise<OutboxPending[]>(pendingReq),
        requestToPromise<OutboxSettled[]>(settledReq),
        transactionDone(tx),
      ]);
      for (const row of pendingRows) pending.set(row.opId, row);
      for (const row of doneRows) settledRows.set(row.opId, row);
      loaded = true;
    })().catch((error: unknown) => {
      loading = null;
      throw error;
    });
    return loading;
  }

  return {
    ready: load,
    list(playerId) {
      return [...pending.values()].filter((row) => row.playerId === playerId);
    },
    all() {
      return [...pending.values()];
    },
    settled(opId) {
      return settledRows.get(opId) ?? null;
    },
    claim(draft) {
      return lock(async () => {
        await load();
        const known = pending.get(draft.opId);
        if (known) return known;
        const db = await open();
        const stored = await new Promise<OutboxPending>((resolve, reject) => {
          const tx = db.transaction(PENDING, 'readwrite');
          const store = tx.objectStore(PENDING);
          let result: OutboxPending | null = null;
          const get = store.get(draft.opId);
          get.onsuccess = () => {
            const current = get.result as OutboxPending | undefined;
            if (current) {
              result = current;
              return;
            }
            result = {
              ...draft,
              body: JSON.parse(JSON.stringify(draft.body)) as Record<string, unknown>,
              idemKey: uuidV7(),
            };
            store.put(result);
          };
          tx.oncomplete = () => {
            if (!result) reject(new Error('indexedDB claim did not write'));
            else resolve(result);
          };
          tx.onerror = () => reject(tx.error ?? new Error('indexedDB claim failed'));
          tx.onabort = () => reject(tx.error ?? new Error('indexedDB claim aborted'));
        });
        pending.set(stored.opId, stored);
        return stored;
      });
    },
    settle(row, response) {
      return lock(async () => {
        await load();
        const saved: OutboxSettled = {
          opId: row.opId,
          idemKey: row.idemKey,
          rpc: row.rpc,
          playerId: row.playerId,
          game: row.game,
          body: row.body,
          response,
        };
        const db = await open();
        const tx = db.transaction([PENDING, SETTLED], 'readwrite');
        tx.objectStore(SETTLED).put(saved);
        tx.objectStore(PENDING).delete(row.opId);
        await transactionDone(tx);
        pending.delete(row.opId);
        settledRows.set(row.opId, saved);
      });
    },
    markError(opId, code) {
      return lock(async () => {
        await load();
        const row = pending.get(opId);
        if (!row) return;
        const next = { ...row, lastError: code };
        const db = await open();
        const tx = db.transaction(PENDING, 'readwrite');
        tx.objectStore(PENDING).put(next);
        await transactionDone(tx);
        pending.set(opId, next);
      });
    },
  };
}

export function defaultLiveOutbox(): LiveOutbox {
  if (typeof indexedDB === 'undefined') return createMemoryOutbox();
  return createIndexedDbOutbox();
}
