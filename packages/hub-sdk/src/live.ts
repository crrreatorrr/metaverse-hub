import { resolveHubEnv, type HubSdkEnv } from './env';
import { HubSdkError } from './errors';
import type { NakamaClient, RedeemResult } from './nakama';
import { getOrCreateDeviceId } from './storage';
import { readTicketParam, stripTicketParam } from './ticket';
import {
  GAME_IDS,
  isBoardId,
  isGameId,
  isRelicId,
  type GameId,
  type HubSdk,
  type InitResult,
  type RelicId,
} from './types';

/** IndexedDB database for earn, event, and exchange writes that have not been acked. */
export const HUB_OUTBOX_DB = 'hub-outbox';
const OUTBOX_STORE = 'writes';

type EconomyRpc = 'session.event' | 'tickets.earn' | 'tickets.exchange';

interface OutboxRecord {
  rpc: EconomyRpc;
  body: Record<string, unknown>;
  key: string;
  token: string;
  gameId: string;
}

interface LiveSession {
  game: GameId;
  playerId: string;
  ranked: boolean;
  sid: string;
  token: string;
  effects: Record<string, number | boolean | string>;
  relics: RelicId[];
  ticketsCapLeft: number;
}

const memoryWrites = new Map<string, OutboxRecord>();

function flatEffects(value: unknown): Record<string, number | boolean | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number | boolean | string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'number' || typeof item === 'boolean' || typeof item === 'string') out[key] = item;
  }
  return out;
}

function asRelics(value: unknown): RelicId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RelicId => typeof item === 'string' && isRelicId(item));
}

function cloneBody(body: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
}

function useIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openOutbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HUB_OUTBOX_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
  });
}

function requestDone<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
  const db = await openOutbox();
  try {
    const tx = db.transaction(OUTBOX_STORE, mode);
    const done = transactionDone(tx);
    const result = await run(tx.objectStore(OUTBOX_STORE));
    await done;
    return result;
  } finally {
    db.close();
  }
}

async function readWrite(key: string): Promise<OutboxRecord | null> {
  if (!useIndexedDb()) return memoryWrites.get(key) ?? null;
  return withStore('readonly', (store) => requestDone<OutboxRecord | undefined>(store.get(key))).then((row) => row ?? null);
}

async function listWrites(): Promise<OutboxRecord[]> {
  if (!useIndexedDb()) return [...memoryWrites.values()];
  return withStore('readonly', (store) => requestDone<OutboxRecord[]>(store.getAll()));
}

/** Commit the record before any RPC. An existing key is left untouched. */
async function remember(record: OutboxRecord): Promise<OutboxRecord> {
  const existing = await readWrite(record.key);
  if (existing) return existing;
  const stored = { ...record, body: cloneBody(record.body) };
  if (!useIndexedDb()) {
    memoryWrites.set(stored.key, stored);
    return stored;
  }
  await withStore('readwrite', (store) => {
    store.put(stored);
  });
  return stored;
}

async function forget(key: string): Promise<void> {
  if (!useIndexedDb()) {
    memoryWrites.delete(key);
    return;
  }
  await withStore('readwrite', (store) => {
    store.delete(key);
  });
}

/**
 * Hub SDK backed by Nakama. `init` reads `#t=<ticket>`, strips it, and exchanges it
 * for a game-scoped session cached in sessionStorage. Without a ticket or a cached
 * session every call no-ops so the game still runs standalone.
 */
export function createLiveHubSdk(env: HubSdkEnv, client: NakamaClient): HubSdk {
  const resolved = resolveHubEnv(env);
  let active: LiveSession | null = null;

  function sessionKey(game: GameId): string {
    return `hub:${game}:session`;
  }

  function readCached(game: GameId): LiveSession | null {
    const raw = resolved.session.getItem(sessionKey(game));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<LiveSession>;
      if (parsed.game !== game || !parsed.token || !parsed.playerId || !parsed.sid) return null;
      if (typeof parsed.ranked !== 'boolean') return null;
      return {
        game,
        playerId: parsed.playerId,
        ranked: parsed.ranked,
        sid: parsed.sid,
        token: parsed.token,
        effects: flatEffects(parsed.effects),
        relics: asRelics(parsed.relics),
        ticketsCapLeft: typeof parsed.ticketsCapLeft === 'number' ? parsed.ticketsCapLeft : 0,
      };
    } catch {
      resolved.session.removeItem(sessionKey(game));
      return null;
    }
  }

  function writeCached(session: LiveSession): void {
    for (const game of GAME_IDS) resolved.session.removeItem(sessionKey(game));
    resolved.session.setItem(sessionKey(session.game), JSON.stringify(session));
    active = session;
  }

  function profileOf(session: LiveSession): InitResult {
    return {
      playerId: session.playerId,
      ranked: session.ranked,
      relics: [...session.relics],
      effects: { ...session.effects },
      ticketsCapLeft: session.ticketsCapLeft,
    };
  }

  function standalone(): InitResult {
    active = null;
    return {
      playerId: getOrCreateDeviceId(resolved.local),
      ranked: false,
      relics: [],
      effects: {},
      ticketsCapLeft: 0,
    };
  }

  function noteGrant(session: LiveSession, response: unknown): void {
    if (!response || typeof response !== 'object') return;
    const granted = (response as { granted?: unknown }).granted;
    if (typeof granted !== 'string' || !isRelicId(granted) || session.relics.includes(granted)) return;
    session.relics.push(granted);
    writeCached(session);
  }

  /** One attempt. A lost response rejects and leaves the queued record in place. */
  async function transmit(row: OutboxRecord): Promise<unknown> {
    const response = await client.rpc(row.rpc, { ...row.body, key: row.key }, { token: row.token });
    await forget(row.key);
    if (active && row.gameId === active.game && row.rpc === 'session.event') noteGrant(active, response);
    return response;
  }

  async function sendOnce(session: LiveSession, rpc: EconomyRpc, key: string, body: Record<string, unknown>): Promise<unknown> {
    const row = await remember({ rpc, body, key, token: session.token, gameId: session.game });
    return transmit(row);
  }

  async function drain(): Promise<void> {
    const rows = await listWrites();
    for (const row of rows) await transmit(row);
  }

  return {
    async init(gameId) {
      if (!isGameId(gameId)) throw new HubSdkError('bad_game', `Unknown game "${gameId}"`);
      const token = readTicketParam(resolved.readHash());
      if (token) {
        const body = await client.rpc<RedeemResult>('session.redeem', { ticket: token, gameId }, { httpKey: true });
        if (!body.token || !body.playerId || !body.sid) {
          throw new HubSdkError('ticket_invalid', 'Redeem did not return a session');
        }
        resolved.writeHash(stripTicketParam(resolved.readHash()));
        writeCached({
          game: gameId,
          playerId: body.playerId,
          ranked: body.ranked === true,
          sid: body.sid,
          token: body.token,
          effects: flatEffects(body.effects),
          relics: asRelics(body.relics),
          ticketsCapLeft: typeof body.ticketsCapLeft === 'number' ? body.ticketsCapLeft : 0,
        });
      } else {
        const cached = readCached(gameId);
        if (!cached) {
          active = null;
        } else {
          try {
            const profile = await client.rpc<{ playerId?: string; relics?: unknown; ticketsCapLeft?: number }>(
              'profile.get',
              {},
              { token: cached.token },
            );
            cached.relics = asRelics(profile.relics);
            if (profile.playerId) cached.playerId = profile.playerId;
            if (typeof profile.ticketsCapLeft === 'number') cached.ticketsCapLeft = profile.ticketsCapLeft;
            writeCached(cached);
          } catch {
            active = cached;
          }
        }
      }
      await drain();
      return active ? profileOf(active) : standalone();
    },

    async reportEvent(eventId, data, key) {
      if (!key) throw new HubSdkError('bad_key', 'Idempotency key is required');
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new HubSdkError('bad_event', 'Event data must be an object');
      }
      if (!active) return {};
      const result = await sendOnce(active, 'session.event', key, { eventId, data });
      const granted = result && typeof result === 'object' ? (result as { granted?: unknown }).granted : undefined;
      return typeof granted === 'string' && isRelicId(granted) ? { granted } : {};
    },

    async submitScore(boardId, value, meta) {
      if (!isBoardId(boardId)) throw new HubSdkError('bad_board', `Unknown board "${boardId}"`);
      if (!Number.isFinite(value) || value < 0) throw new HubSdkError('bad_score', 'Score must be a non-negative number');
      if (!active || !active.ranked) return;
      await client.rpc('score.submit', { boardId, value, meta: meta ?? {} }, { token: active.token });
    },

    async earnTickets(amount, reason, key) {
      if (!key) throw new HubSdkError('bad_key', 'Idempotency key is required');
      if (!Number.isFinite(amount) || amount <= 0) throw new HubSdkError('bad_amount', 'Ticket amount must be positive');
      if (!reason) throw new HubSdkError('bad_reason', 'A reason is required');
      if (!active) return { balance: 0, capped: false };
      return sendOnce(active, 'tickets.earn', key, { amount: Math.floor(amount), reason }) as Promise<{
        balance: number;
        capped: boolean;
      }>;
    },

    async exchange(tickets, key) {
      if (!key) throw new HubSdkError('bad_key', 'Idempotency key is required');
      if (!Number.isFinite(tickets) || tickets <= 0) {
        throw new HubSdkError('bad_amount', 'Exchange amount must be positive');
      }
      if (!active) return { verse: 0, ticketsLeft: 0, receiptId: 'noop', verseCapLeft: 0 };
      return sendOnce(active, 'tickets.exchange', key, { tickets: Math.floor(tickets) }) as Promise<{
        verse: number;
        ticketsLeft: number;
        receiptId: string;
        verseCapLeft?: number;
      }>;
    },

    exit(reason) {
      if (!active) return;
      const game = active.game;
      const token = active.token;
      resolved.session.removeItem(sessionKey(game));
      active = null;
      resolved.clearBeforeUnload();
      resolved.releasePointer();
      void client.rpc('session.close', { reason: reason ?? '' }, { token, keepalive: true }).catch(() => undefined);
      const base = resolved.hubUrl.replace(/\/$/, '');
      resolved.assign(`${base}/#from=${game}`);
    },
  };
}
