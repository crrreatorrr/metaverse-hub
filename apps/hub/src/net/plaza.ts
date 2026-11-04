// Plaza connection: realtime socket, hub.join placement, the shard's match and
// its pose stream. Remote state goes into a RemoteWorld; rendering is remotes.ts.
import { HubSdkError, createRealtime, type HubRealtime, type MatchHandle } from '@metaverse/hub-sdk';
import { createRemoteWorld, type RemoteWorld } from './remoteWorld';
import { OP, TICK_RATE, encodePose, parseDelta, parseRoster, parseSnapshot, samePose, type EmoteEvent } from './protocol';

const LAST_MATCH_KEY = 'hub:plaza:match';
const SEND_EVERY_MS = 1000 / TICK_RATE;
const KEEPALIVE_MS = 1000;

export type PlazaStatus = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'elsewhere';

export interface PlazaOptions {
  getToken: () => string | Promise<string>;
  serverUrl?: string;
  /** Injected realtime (tests, mock server). */
  realtime?: HubRealtime;
  /** Store to fill; created when omitted. */
  world?: RemoteWorld;
  onStatus?: (status: PlazaStatus, detail: string) => void;
  /** New shard joined (first join and every re-placement). */
  onShard?: (info: { matchId: string; shard: number; room: string }) => void;
  now?: () => number;
}

export interface Plaza {
  readonly realtime: HubRealtime;
  readonly world: RemoteWorld;
  readonly matchId: string | null;
  readonly shard: number;
  readonly room: string;
  /** Call every frame; sends at most 10/s when the pose changed, plus a 1 Hz keepalive. */
  sendPose(x: number, y: number, z: number, yaw: number, anim: number): void;
  profile(look: { character: string; staff: string; pet: string | null }): void;
  emote(e: string): void;
  /** Tell the shard where this player is heading, before window.location changes. */
  travel(game: string): void;
  onEmote(cb: (e: EmoteEvent) => void): () => void;
  close(): void;
}

function readLast(): string | undefined {
  try {
    return sessionStorage.getItem(LAST_MATCH_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLast(id: string): void {
  try {
    sessionStorage.setItem(LAST_MATCH_KEY, id);
  } catch {
    // Private mode: the next visit is placed fresh.
  }
}

export async function connectPlaza(opts: PlazaOptions): Promise<Plaza> {
  const now = opts.now ?? (() => performance.now());
  const rt = opts.realtime ?? createRealtime({ serverUrl: opts.serverUrl ?? '', getToken: opts.getToken });
  const world = opts.world ?? createRemoteWorld();
  const emoteListeners = new Set<(e: EmoteEvent) => void>();
  let match: MatchHandle | null = null;
  let shard = 0;
  let room = '';
  let closed = false;
  let lastSent: number[] | null = null;
  let lastSentAt = -Infinity;
  let lastProfile = '';
  let profileSentAt = -Infinity;
  let profilePending = false;
  const PROFILE_EVERY_MS = 2100;
  function flushProfile(): void {
    if (!match || !profilePending || now() - profileSentAt < PROFILE_EVERY_MS) return;
    profilePending = false;
    profileSentAt = now();
    match.send(OP.PROFILE, lastProfile);
  }
  let placing: Promise<void> | null = null;
  const status = (s: PlazaStatus, detail = '') => opts.onStatus?.(s, detail);

  rt.onState((state) => {
    if (closed) return;
    if (state === 'reconnecting') status('reconnecting', 'Reconnecting to the plaza…');
    else if (state === 'open' && match) status('online', '');
    else if (state === 'closed') status('offline', 'Plaza offline');
  });

  function wire(handle: MatchHandle): void {
    handle.onMessage((msg) => {
      let body: unknown;
      try {
        body = msg.json();
      } catch {
        return;
      }
      if (msg.opCode === OP.SNAPSHOT) {
        const s = parseSnapshot(body);
        if (s) {
          world.applySnapshot(s, now());
          lastSent = null;
          if (lastProfile) profilePending = true;
        }
      } else if (msg.opCode === OP.DELTA) {
        const d = parseDelta(body);
        if (d) world.applyDelta(d, now());
      } else if (msg.opCode === OP.ROSTER) {
        const r = parseRoster(body);
        if (r) world.applyRoster(r);
      } else if (msg.opCode === OP.EMOTE) {
        const e = body as EmoteEvent;
        if (e && typeof e.s === 'number' && typeof e.e === 'string') for (const cb of emoteListeners) cb(e);
      }
    });
    handle.onRejoin(() => status('online', ''));
    handle.onClose((reason) => {
      if (match !== handle || closed) return;
      match = null;
      world.clear();
      if (reason === 'kicked') {
        // A newer tab of this account took the slot. Do not fight it.
        status('elsewhere', 'The plaza is open in another tab');
        return;
      }
      if (reason === 'left') return;
      void place();
    });
  }

  async function placeOnce(): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prefer = attempt === 0 ? readLast() : undefined;
      try {
        const placed = await rt.rpc<{ matchId: string; shard: number; room: string }>('hub.join', prefer ? { prefer } : {});
        const handle = await rt.joinMatch({ matchId: placed.matchId });
        match = handle;
        shard = placed.shard;
        room = placed.room;
        writeLast(placed.matchId);
        wire(handle);
        status('online', '');
        opts.onShard?.({ matchId: placed.matchId, shard, room });
        return;
      } catch (error) {
        lastError = error;
        // A full or vanished shard: ask again without the preference.
        if (error instanceof HubSdkError && (error.code.startsWith('match_rejected') || error.code === 'match_not_found')) continue;
        throw error;
      }
    }
    throw lastError ?? new HubSdkError('match_not_found', 'No plaza shard');
  }

  function place(): Promise<void> {
    if (!placing) {
      placing = placeOnce()
        .catch((error: unknown) => {
          status('offline', error instanceof Error ? error.message : 'Plaza offline');
          throw error;
        })
        .finally(() => {
          placing = null;
        });
    }
    return placing;
  }

  status('connecting', 'Joining the plaza…');
  await rt.connect();
  await place();

  return {
    realtime: rt,
    world,
    get matchId() { return match?.matchId ?? null; },
    get shard() { return shard; },
    get room() { return room; },
    sendPose(x, y, z, yaw, anim) {
      if (!match) return;
      flushProfile();
      const t = now();
      if (t - lastSentAt < SEND_EVERY_MS) return;
      const body = encodePose(x, y, z, yaw, anim);
      if (samePose(lastSent, body) && t - lastSentAt < KEEPALIVE_MS) return;
      lastSent = body;
      lastSentAt = t;
      match.send(OP.POSE, body);
    },
    profile(look) {
      lastProfile = JSON.stringify({ character: look.character, staff: look.staff, pet: look.pet ?? '' });
      profilePending = true;
      flushProfile();
    },
    emote(e) {
      match?.send(OP.EMOTE, { e });
    },
    travel(game) {
      match?.send(OP.TRAVEL, { game });
    },
    onEmote(cb) {
      emoteListeners.add(cb);
      return () => {
        emoteListeners.delete(cb);
      };
    },
    close() {
      closed = true;
      rt.disconnect();
    },
  };
}
