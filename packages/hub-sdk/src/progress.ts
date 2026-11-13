import { HubSdkError } from './errors';
import { encodeSave } from './save';
import { browserKeyValue, type KeyValue } from './storage';
import { readTicketParam } from './ticket';
import type { GameId, HubSdk } from './types';

/**
 * A game's progress, described once so the store can keep, merge and sync it.
 *
 * Progress only advances. `merge` must keep everything either copy has earned (union the
 * sets, keep the better record) and must be commutative, associative and idempotent. That
 * is what lets two devices, two tabs and the cloud copy be combined in any order without
 * one overwriting the other.
 */
export interface ProgressModel<T> {
  /** Progress of a player who has done nothing yet. */
  empty(): T;
  /** Reads anything from storage or the cloud into a valid `T`. Never throws. */
  normalize(raw: unknown): T;
  /** Combines two copies without losing progress from either. */
  merge(a: T, b: T): T;
  /** The cloud form, a JSON object of at most `SAVE_MAX_BYTES`. Defaults to `T` itself. */
  toCloud?(value: T): Record<string, unknown>;
  /** Reads the cloud form back, before `normalize`. Defaults to the object itself. */
  fromCloud?(data: Record<string, unknown>): unknown;
}

/**
 * Whose progress the store holds.
 * - `device`: play outside a hub session. Kept in this browser only, under the base key.
 * - `pending`: a hub visit is starting and the account is not known yet. Kept in memory and
 *   given to the account (or back to the device) once the visit resolves.
 * - `account`: a hub player. Kept in this browser under the player's own key and synced
 *   to the player's cloud save, so it follows the account to other devices.
 */
export type ProgressOwner = { kind: 'device' } | { kind: 'pending' } | { kind: 'account'; playerId: string };

/** Cloud state for an account: `local` (device or pending), `syncing`, `synced`, `offline` (will retry), `error` (will not). */
export type ProgressSync = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

export type ProgressCloud = Pick<HubSdk, 'loadSave' | 'writeSave'>;

export interface ProgressStoreOptions<T> {
  /** Storage key of the device copy. An account's copy is `${key}@${playerId}`. */
  key: string;
  model: ProgressModel<T>;
  /** Defaults to localStorage, or memory when it is unavailable. Null keeps progress in memory. */
  storage?: KeyValue | null;
  /** Progress kept under older keys, merged into the device copy only. */
  readLegacy?(storage: KeyValue): unknown;
  /** Wait after an update before pushing to the cloud, so a burst becomes one write. Default 1500 ms. */
  pushDelayMs?: number;
  /** First retry after a failed push. Doubles up to 2 minutes. Default 5000 ms. */
  retryDelayMs?: number;
  /** Called when a cloud read or write fails. */
  onError?(error: unknown): void;
}

export interface ProgressStore<T> {
  /** The current progress. Treat it as read-only. */
  get(): T;
  owner(): ProgressOwner;
  sync(): ProgressSync;
  /** False when the last local write failed, so progress lasts only for this visit. */
  persistent(): boolean;
  /**
   * Advances progress: `advance` gets the current progress and returns the next. The result
   * is merged with the current copy, so nothing earned can be lost here. Saved at once and,
   * for an account, pushed to the cloud shortly after.
   */
  update(advance: (current: T) => T): T;
  /** Re-reads storage, for progress another tab saved. */
  refresh(): void;
  /** True when a `storage` event with this key concerns the current copy. */
  watches(key: string | null): boolean;
  subscribe(listener: () => void): () => void;
  /** A hub visit is starting: keep new progress in memory until `attach` or `release`. */
  hold(): void;
  /** Switch to `playerId`'s progress and sync it with the cloud save. */
  attach(cloud: ProgressCloud, playerId: string): Promise<void>;
  /** Back to the device copy, for play without a hub session. */
  release(): void;
  /** Pushes any unsynced account progress now. Resolves when done or failed. */
  flush(): Promise<void>;
}

const MAX_RETRY_MS = 120_000;

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Errors that a retry cannot fix. */
function isFinal(error: unknown): boolean {
  return error instanceof HubSdkError && (error.code === 'bad_save' || error.code === 'save_too_large');
}

/**
 * One game's progress, owned by the device or by a hub account.
 *
 * Every copy (this tab, other tabs, the cloud) is combined with `model.merge`, so the
 * order of reads and writes never loses progress. `save.put` has no compare-and-swap: two
 * devices writing at once can each miss the other's latest win, but the device that lost
 * still holds it locally and puts it back on its next push.
 */
export function createProgressStore<T>(options: ProgressStoreOptions<T>): ProgressStore<T> {
  const { key, model } = options;
  const storage: KeyValue | null = options.storage === undefined ? browserKeyValue('local') : options.storage;
  const pushDelay = options.pushDelayMs ?? 1500;
  const retryBase = options.retryDelayMs ?? 5000;
  const toCloud = (value: T): Record<string, unknown> =>
    model.toCloud ? model.toCloud(value) : (value as unknown as Record<string, unknown>);
  const fromCloud = (data: Record<string, unknown>): T => model.normalize(model.fromCloud ? model.fromCloud(data) : data);

  let owner: ProgressOwner = { kind: 'device' };
  let status: ProgressSync = 'local';
  let persistent = !!storage;
  let cloud: ProgressCloud | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryMs = retryBase;
  let pushing: Promise<void> | null = null;
  /** Bumped on every owner change, so a push that outlives its account changes nothing. */
  let epoch = 0;
  const listeners = new Set<() => void>();

  const slotKey = (o: ProgressOwner): string | null =>
    o.kind === 'device' ? key : o.kind === 'account' ? `${key}@${o.playerId}` : null;
  const dirtyKey = (o: ProgressOwner): string | null => (o.kind === 'account' ? `${key}@${o.playerId}:unsynced` : null);

  function readRaw(k: string): unknown {
    if (!storage) return null;
    let raw: string | null;
    try {
      raw = storage.getItem(k);
    } catch {
      // Blocked storage: progress lasts for this visit only.
      persistent = false;
      return null;
    }
    try {
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  }

  function readSlot(o: ProgressOwner): T {
    const k = slotKey(o);
    let value = model.normalize(k ? readRaw(k) : null);
    if (o.kind === 'device' && storage && options.readLegacy) {
      try {
        value = model.merge(value, model.normalize(options.readLegacy(storage)));
      } catch {
        /* Unreadable legacy progress is skipped. */
      }
    }
    return value;
  }

  function writeSlot(o: ProgressOwner, value: T): void {
    const k = slotKey(o);
    if (!k) return;
    try {
      if (!storage) throw new Error('no storage');
      storage.setItem(k, JSON.stringify(value));
      persistent = true;
    } catch {
      persistent = false;
    }
  }

  function setDirty(o: ProgressOwner, dirty: boolean): void {
    const k = dirtyKey(o);
    if (!k || !storage) return;
    try {
      if (dirty) storage.setItem(k, '1');
      else storage.removeItem(k);
    } catch {
      /* The next attach syncs anyway. */
    }
  }

  function isDirty(o: ProgressOwner): boolean {
    const k = dirtyKey(o);
    if (!k || !storage) return false;
    try {
      return storage.getItem(k) === '1';
    } catch {
      return false;
    }
  }

  let value: T = readSlot(owner);

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  function clearTimers(): void {
    if (pushTimer) clearTimeout(pushTimer);
    if (retryTimer) clearTimeout(retryTimer);
    pushTimer = null;
    retryTimer = null;
  }

  function schedulePush(delay: number): void {
    if (owner.kind !== 'account' || !cloud) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void push();
    }, delay);
  }

  /** Read the cloud copy, merge it with ours, store the result here and there. */
  function push(): Promise<void> {
    if (pushing) {
      // One push at a time; a later update gets a fresh push after this one.
      return pushing.then(() => (owner.kind === 'account' && isDirty(owner) ? push() : undefined));
    }
    const o = owner;
    const api = cloud;
    const at = epoch;
    if (o.kind !== 'account' || !api?.loadSave || !api.writeSave) return Promise.resolve();
    status = 'syncing';
    emit();
    pushing = (async () => {
      try {
        const remote = await api.loadSave!();
        if (at !== epoch) return;
        const theirs = remote.data ? fromCloud(remote.data) : null;
        value = model.merge(readSlot(o), theirs ? model.merge(value, theirs) : value);
        writeSlot(o, value);
        const body = toCloud(value);
        encodeSave(body);
        // No cloud save and nothing earned: nothing to write.
        if (stable(body) !== stable(toCloud(theirs ?? model.empty()))) {
          await api.writeSave!(body);
          if (at !== epoch) return;
        }
        setDirty(o, false);
        status = 'synced';
        retryMs = retryBase;
      } catch (error) {
        if (at !== epoch) return;
        options.onError?.(error);
        if (isFinal(error)) {
          status = 'error';
        } else {
          status = 'offline';
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void push();
          }, retryMs);
          retryMs = Math.min(MAX_RETRY_MS, retryMs * 2);
        }
      } finally {
        pushing = null;
        if (at === epoch) emit();
      }
    })();
    return pushing;
  }

  function moveTo(next: ProgressOwner): void {
    epoch += 1;
    clearTimers();
    retryMs = retryBase;
    owner = next;
  }

  return {
    get: () => value,
    owner: () => owner,
    sync: () => status,
    persistent: () => persistent,

    update(advance) {
      if (owner.kind !== 'pending') value = model.merge(value, readSlot(owner));
      value = model.merge(value, model.normalize(advance(value)));
      writeSlot(owner, value);
      if (owner.kind === 'account') {
        setDirty(owner, true);
        schedulePush(pushDelay);
      }
      emit();
      return value;
    },

    refresh() {
      if (owner.kind === 'pending') return;
      value = model.merge(value, readSlot(owner));
      emit();
    },

    watches(changed) {
      return changed === null || changed === slotKey(owner);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    hold() {
      if (owner.kind === 'pending') return;
      moveTo({ kind: 'pending' });
      cloud = null;
      value = model.empty();
      status = 'local';
      emit();
    },

    async attach(api, playerId) {
      if (!playerId) throw new HubSdkError('bad_player', 'attach needs a player id');
      const earned = owner.kind === 'pending' ? value : null;
      const next: ProgressOwner = { kind: 'account', playerId };
      moveTo(next);
      cloud = api;
      value = readSlot(next);
      if (earned) {
        value = model.merge(value, earned);
        writeSlot(next, value);
        setDirty(next, true);
      }
      status = 'local';
      emit();
      await push();
    },

    release() {
      if (owner.kind === 'device') return;
      const earned = owner.kind === 'pending' ? value : null;
      moveTo({ kind: 'device' });
      cloud = null;
      value = readSlot(owner);
      if (earned) {
        value = model.merge(value, earned);
        writeSlot(owner, value);
      }
      status = 'local';
      emit();
    },

    flush() {
      if (owner.kind !== 'account' || !cloud) return Promise.resolve();
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
      }
      return push();
    },
  };
}

/**
 * True when this page load is starting or resuming a hub visit for `game`: a portal ticket
 * in the URL fragment, or a live session from earlier in this tab. Games call
 * `store.hold()` when it is true, before `init` resolves, so a moment of play before the
 * account is known never lands in the device copy.
 */
export function hubVisitStarting(game: GameId, hash?: string, session?: KeyValue): boolean {
  const fragment = hash ?? (typeof location !== 'undefined' ? location.hash : '');
  if (readTicketParam(fragment)) return true;
  try {
    const store = session ?? browserKeyValue('session');
    return store.getItem(`hub:${game}:session`) !== null;
  } catch {
    return false;
  }
}
