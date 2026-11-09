// Remote players of one plaza shard, fed by SNAPSHOT / DELTA / ROSTER. Pure (no three).
import { createInterp, type Interp } from './interp';
import { decodeRow, type Delta, type RosterChange, type RosterEntry, type Snapshot } from './protocol';

export interface RemotePlayer {
  slot: number;
  userId: string;
  name: string;
  character: string;
  staff: string;
  pet: string;
  relics: string[];
  game: string;
  away: boolean;
  interp: Interp;
  /** Bumped when name/look/relics change, so renderers can refresh. */
  version: number;
}

export interface RemoteWorld {
  readonly players: ReadonlyMap<number, RemotePlayer>;
  readonly selfSlot: number | null;
  readonly shard: number;
  applySnapshot(s: Snapshot, now: number): void;
  applyDelta(d: Delta, now: number): void;
  applyRoster(r: RosterChange): void;
  byUser(userId: string): RemotePlayer | null;
  /** Players present (not away), self and sims (this screen only) excluded. */
  presentCount(): number;
  clear(): void;
  onRoster(cb: () => void): () => void;
}

export function createRemoteWorld(): RemoteWorld {
  const players = new Map<number, RemotePlayer>();
  const users = new Map<string, number>();
  let selfSlot: number | null = null;
  let shard = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const cb of listeners) cb();
  };

  function upsert(e: RosterEntry): void {
    if (e.s === selfSlot) return;
    const existing = players.get(e.s);
    if (existing && existing.userId !== e.u) {
      users.delete(existing.userId);
      players.delete(e.s);
    }
    const p = players.get(e.s);
    if (p) {
      p.name = e.n;
      p.character = e.c;
      p.staff = e.st;
      p.pet = e.pt;
      p.relics = e.r;
      p.game = e.g;
      if (p.away !== e.away && !e.away) p.interp.clear();
      p.away = e.away;
      p.version += 1;
      return;
    }
    players.set(e.s, {
      slot: e.s,
      userId: e.u,
      name: e.n,
      character: e.c,
      staff: e.st,
      pet: e.pt,
      relics: e.r,
      game: e.g,
      away: e.away,
      interp: createInterp(),
      version: 0,
    });
    users.set(e.u, e.s);
  }

  function rows(list: Delta['p'], now: number): void {
    for (const row of list) {
      const pose = decodeRow(row);
      const p = players.get(pose.slot);
      if (p) p.interp.push(now, pose);
    }
  }

  return {
    players,
    get selfSlot() { return selfSlot; },
    get shard() { return shard; },
    applySnapshot(s, now) {
      players.clear();
      users.clear();
      selfSlot = s.you;
      shard = s.shard;
      for (const e of s.roster) upsert(e);
      rows(s.p, now);
      notify();
    },
    applyDelta(d, now) {
      rows(d.p, now);
    },
    applyRoster(r) {
      for (const e of r.add ?? []) upsert(e);
      for (const e of r.upd ?? []) upsert(e);
      for (const slot of r.del ?? []) {
        const p = players.get(slot);
        if (p) users.delete(p.userId);
        players.delete(slot);
      }
      notify();
    },
    byUser(userId) {
      const slot = users.get(userId);
      return slot === undefined ? null : players.get(slot) ?? null;
    },
    presentCount() {
      let n = 0;
      for (const p of players.values()) if (!p.away && !p.userId.startsWith('sim:')) n += 1;
      return n;
    },
    clear() {
      players.clear();
      users.clear();
      selfSlot = null;
      notify();
    },
    onRoster(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
