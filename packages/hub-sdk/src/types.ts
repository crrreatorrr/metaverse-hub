/** Game ids stored on the server and used in `/hub#from=<game>`. */
export const GAME_IDS = ['hpos10i', 'nobu', 'pb', 'sproto'] as const;
export type GameId = (typeof GAME_IDS)[number];

/**
 * Play-path slugs a build may send. They resolve to a stored game id
 * before tickets, sessions, and events, so the economy stays one row.
 */
export const GAME_ID_ALIASES = {
  'peoples-bitcoin': 'pb',
} as const satisfies Record<string, GameId>;

export type GameIdAlias = keyof typeof GAME_ID_ALIASES;
export type GameIdInput = GameId | GameIdAlias;

/** Earn-once relics. The primary key on the server is (user, relic). */
export const RELIC_IDS = ['hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown'] as const;
export type RelicId = (typeof RELIC_IDS)[number];

export const RELIC_BY_GAME: Record<GameId, RelicId> = {
  hpos10i: 'hpos10i_core',
  pb: 'genesis_shard',
  nobu: 'cones_tip',
  sproto: 'tinubu_crown',
};

/**
 * Nakama leaderboard ids. Sort direction matches the architecture:
 * times are ascending best, XP and meta are set, Sproto wins increment.
 */
export const BoardId = {
  Hpos10iActTime: 'hpos10i_act_time',
  NobuTrialTime: 'nobu_trial_time',
  PbTotalXp: 'pb_total_xp',
  SprotoWins: 'sproto_wins',
  Meta: 'meta',
} as const;
export type BoardId = (typeof BoardId)[keyof typeof BoardId];

export const BOARD_IDS: readonly BoardId[] = [
  BoardId.Hpos10iActTime,
  BoardId.NobuTrialTime,
  BoardId.PbTotalXp,
  BoardId.SprotoWins,
  BoardId.Meta,
];

/** 10 Tickets = 1 Verse. At most 50 Verse per game per day. */
export const TICKETS_PER_VERSE = 10;
export const VERSE_DAILY_CAP = 50;

/** Mock-only daily earn cap. The real per-event caps arrive with the Go module. */
export const MOCK_TICKET_EARN_CAP = 1000;

/** Portal tickets are single-use and short-lived. */
export const MOCK_TICKET_TTL_SECONDS = 60;

export interface InitResult {
  playerId: string;
  ranked: boolean;
  relics: RelicId[];
  /** Resolved effects for this game only. Empty until the server ships the matrix. */
  effects: Record<string, number | boolean | string>;
  ticketsCapLeft: number;
}

export interface EarnResult {
  balance: number;
  capped: boolean;
}

export interface ExchangeResult {
  /** Verse wallet balance after the exchange. */
  verse: number;
  ticketsLeft: number;
  receiptId: string;
  /** Verse this game can still earn today. Omitted by older servers. */
  verseCapLeft?: number;
}

export interface EventResult {
  granted?: RelicId;
}

/**
 * Surface the games call. Outside a redeemed ticket the methods no-op so a
 * game still runs standalone. HPOS10I reaches the same object through
 * `JavaScriptBridge.get_interface("hubSdk")` once `installHubSdk` has run.
 */
export interface HubSdk {
  init(gameId: GameIdInput): Promise<InitResult>;
  reportEvent(eventId: string, data: object, key: string): Promise<EventResult>;
  submitScore(boardId: string, value: number, meta?: object): Promise<void>;
  earnTickets(amount: number, reason: string, key: string): Promise<EarnResult>;
  exchange(tickets: number, key: string): Promise<ExchangeResult>;
  exit(reason?: string): void;
}

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

/** Stored game id. `peoples-bitcoin` is the White House play slug for `pb`. */
export function canonicalGameId(value: string): GameId | null {
  if (isGameId(value)) return value;
  const alias = (GAME_ID_ALIASES as Record<string, GameId | undefined>)[value];
  return alias ?? null;
}

export function isRelicId(value: string): value is RelicId {
  return (RELIC_IDS as readonly string[]).includes(value);
}

export function isBoardId(value: string): value is BoardId {
  return (BOARD_IDS as readonly string[]).includes(value);
}

declare global {
  interface Window {
    hubSdk?: HubSdk;
  }
}
