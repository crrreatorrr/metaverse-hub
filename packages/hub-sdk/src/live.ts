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
        const session: LiveSession = {
          game: gameId,
          playerId: body.playerId,
          ranked: body.ranked === true,
          sid: body.sid,
          token: body.token,
          effects: flatEffects(body.effects),
          relics: asRelics(body.relics),
          ticketsCapLeft: typeof body.ticketsCapLeft === 'number' ? body.ticketsCapLeft : 0,
        };
        writeCached(session);
        return profileOf(session);
      }
      const cached = readCached(gameId);
      if (!cached) return standalone();
      try {
        const profile = await client.rpc<{ playerId?: string; relics?: unknown }>('profile.get', {}, { token: cached.token });
        cached.relics = asRelics(profile.relics);
        if (profile.playerId) cached.playerId = profile.playerId;
        writeCached(cached);
      } catch {
        active = cached;
      }
      return profileOf(cached);
    },

    async reportEvent(eventId, data, key) {
      if (!key) throw new HubSdkError('bad_key', 'Idempotency key is required');
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new HubSdkError('bad_event', 'Event data must be an object');
      }
      if (!active) return {};
      const result = await client.rpc<{ granted?: string }>(
        'session.event',
        { eventId, data, key },
        { token: active.token },
      );
      if (result.granted && isRelicId(result.granted)) {
        if (!active.relics.includes(result.granted)) active.relics.push(result.granted);
        writeCached(active);
        return { granted: result.granted };
      }
      return {};
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
      return client.rpc('tickets.earn', { amount: Math.floor(amount), reason, key }, { token: active.token });
    },

    async exchange(tickets, key) {
      if (!key) throw new HubSdkError('bad_key', 'Idempotency key is required');
      if (!Number.isFinite(tickets) || tickets <= 0) {
        throw new HubSdkError('bad_amount', 'Exchange amount must be positive');
      }
      if (!active) return { verse: 0, ticketsLeft: 0, receiptId: 'noop' };
      return client.rpc('tickets.exchange', { tickets: Math.floor(tickets), key }, { token: active.token });
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
