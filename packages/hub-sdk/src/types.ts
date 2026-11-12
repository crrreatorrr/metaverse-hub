import type { FeedbackAccess, FeedbackSubmission } from './feedback';
/** Game ids stored on the server and used in `/hub#from=<game>` and `play/<game>`. */
export const GAME_IDS = [
  'hpos10i',
  'nobu',
  'peoples-bitcoin',
  'sproto',
  'sproto-fighter',
  'sproto-arcade',
  'sproto-shooter',
  'sproto-coop-battle',
] as const;
export type GameId = (typeof GAME_IDS)[number];

/** Earn-once relics. The primary key on the server is (user, relic). */
export const RELIC_IDS = [
  'hpos10i_core',
  'genesis_shard',
  'cones_tip',
  'tinubu_crown',
  'tidebreaker_belt',
  'breakwater_coin',
  'marina_anchor',
  'dragon_scale',
] as const;
export type RelicId = (typeof RELIC_IDS)[number];

/**
 * The four Relics that make the Four Lights. The Tidebreaker Belt (Sproto Fighter), the Breakwater
 * Coin (Sproto Arcade), the Marina Anchor (Sproto Coop Battle) and the Dragon Scale (Sproto Shooter)
 * are Relics too, but they do not count toward the Four Lights, the Hall of Champions or the Four
 * Lights pet.
 */
export const FOUR_LIGHTS_RELIC_IDS = ['hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown'] as const;

/** Each game's Relic. Partial: a game id with no entry cannot grant a Relic. */
export const RELIC_BY_GAME: Partial<Record<GameId, RelicId>> = {
  hpos10i: 'hpos10i_core',
  'peoples-bitcoin': 'genesis_shard',
  nobu: 'cones_tip',
  sproto: 'tinubu_crown',
  'sproto-fighter': 'tidebreaker_belt',
  'sproto-arcade': 'breakwater_coin',
  'sproto-coop-battle': 'marina_anchor',
  'sproto-shooter': 'dragon_scale',
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

/**
 * One hub gate as `init()` may show it. `unlocked` is cosmetic.
 * The server does not send the missing item ids, and this type has nowhere to put them.
 */
export interface HubGateView {
  gateId: string;
  unlocked: boolean;
  actionType: string;
  /** Allowlisted realm id or session/zone key. Never a URL. */
  target: string | null;
  lockedHintPool: string | null;
}

export interface InitResult {
  playerId: string;
  ranked: boolean;
  relics: RelicId[];
  /** Resolved effects for this game only. Empty until the server ships the matrix. */
  effects: Record<string, number | boolean | string>;
  ticketsCapLeft: number;
  /** Nakama server clock at this response, epoch milliseconds. */
  serverTime: number;
  /**
   * Owned union from the server (starters, relic-derived, item_owned, keepsake-derived).
   * Omitted when this response did not come from `profile.get`.
   */
  items?: string[];
  /**
   * Per-gate unlocked bools. Omitted when this response did not come from `profile.get`.
   * Never includes the server's missing-item list.
   */
  gates?: HubGateView[];
}

export interface EarnResult {
  balance: number;
  capped: boolean;
}

export interface ExchangeResult {
  /** Verse wallet balance after the exchange. */
  verse: number;
  ticketsLeft: number;
  /** Ticket wallet after the exchange. Same number as ticketsLeft. */
  balance: number;
  receiptId: string;
  /** Verse this game can still earn today. Omitted by older servers. */
  verseCapLeft?: number;
}

export interface SpendResult {
  shop_id: string;
  item_id: string;
  packs: number;
  units: number;
  spent: number;
  balance: number;
}

export interface SellResult {
  shop_id: string;
  item_id: string;
  packs: number;
  units: number;
  credited: number;
  balance: number;
}

export interface TicketBalanceResult {
  balance: number;
  /** Tickets this session can still credit before `session_ticket_cap`. */
  sessionCapLeft: number;
  /** Tickets this game can still credit today before `daily_ticket_cap`. */
  dailyCapLeft: number;
  /** Nakama server clock at this response, epoch milliseconds. */
  serverTime: number;
}

export interface EventResult {
  granted?: RelicId;
  /**
   * Tickets the server credited for this event (0.7.1), for example 20 for a story boss in
   * Sproto Duel or Sproto Fighter. Absent when the event paid nothing (most events, a boss
   * already paid today, a cap), in a standalone or mock session, and from a server that does
   * not send it. A replayed key returns the stored answer, so the same number comes back
   * without a second credit: show it, do not add it to a balance; read `getBalance` for that.
   */
  tickets?: number;
  /** Cosmetic items (pets) this event granted, from the live server (migration 0030). `[]` when none. */
  granted_items?: string[];
}

/** Nakama session from `redeemTicket`. The HTTP key is not involved. */
export interface RedeemedSession {
  token: string;
  refreshToken: string;
}

/**
 * Surface the games call. Outside a redeemed ticket the methods no-op so a
 * game still runs standalone. HPOS10I reaches the same object through
 * `JavaScriptBridge.get_interface("hubSdk")` once `installHubSdk` has run.
 */
export interface HubSdk {
  /**
   * Read `#t=` from the page hash, strip it immediately, and exchange it for a
   * Nakama session using the server key only (`authenticateCustom`, create=false).
   */
  redeemTicket(input: { game: GameId }): Promise<RedeemedSession>;
  init(gameId: GameId): Promise<InitResult>;
  reportEvent(eventId: string, data: object, key: string): Promise<EventResult>;
  /**
   * The server decides eligibility (ranked gate, god mode, bounds) and answers with a
   * `ScoreResult`. Errors throw `HubSdkError` (`session_closed`, `not_game_session`,
   * `bad_board`, `bad_score`, `bad_variant`, `implausible_score`, `rate_limited`).
   * Standalone (no session) resolves with nothing.
   */
  submitScore(boardId: string, value: number, meta?: object): Promise<ScoreResult | void>;
  earnTickets(amount: number, reason: string, key: string): Promise<EarnResult>;
  exchange(tickets: number, key: string): Promise<ExchangeResult>;
  /** Buy `packs` from `shopId` at the server price per pack. The caller mints `key` once. */
  spendTickets(shopId: string, itemId: string, packs: number, key: string): Promise<SpendResult>;
  /** Sell `packs` back to `shopId` at the server sell price per pack. The caller mints `key` once. */
  sellItem(shopId: string, itemId: string, packs: number, key: string): Promise<SellResult>;
  getTicketBalance(): Promise<TicketBalanceResult>;
  exit(reason?: string): void;
  /** The live game session, or null standalone. Optional so older doubles still typecheck. */
  getSession?(): HubSessionInfo | null;
  /** Refresh via /v2/account/session/refresh when within 5 min of expiry; null when standalone. */
  refreshSession?(): Promise<HubSessionInfo | null>;
  /** Public board read (leaderboard.top). Works for any session. */
  getLeaderboard?(boardId: BoardId, opts?: { variant?: string; limit?: number }): Promise<LeaderboardTop>;
  /** This game's cloud save (`save.get`). Standalone resolves `{ data: null, updatedAt: 0 }`. */
  loadSave?(): Promise<SaveResult>;
  /**
   * Replace this game's cloud save (`save.put`). Errors throw `HubSdkError`
   * (`bad_save`, `save_too_large`). Standalone resolves `{ data: null, updatedAt: 0 }`.
   */
  writeSave?(data: Record<string, unknown>): Promise<SaveResult>;
  /**
   * May this player send in-game feedback (`feedback.can`)? Signed-in hub accounts only:
   * standalone play answers `{ ok: false, reason: 'standalone' }`, a guest `sign_in_required`.
   */
  feedbackAccess?(): Promise<FeedbackAccess>;
  /**
   * Send one feedback note (`feedback.submit`) and get its id, e.g. `SHOOTER-0042`. Errors throw
   * `HubSdkError` (`standalone`, `sign_in_required`, `rate_limited`, `empty`, `bad_image`).
   */
  submitFeedback?(input: FeedbackSubmission): Promise<{ id: string }>;
}

/**
 * One cloud save per player per game (`save.get` / `save.put`). The server stores the
 * object as given after checking it is a JSON object of at most `SAVE_MAX_BYTES`.
 * A save never grants Relics, Tickets or items.
 */
export interface SaveResult {
  /** The stored object, or null when this player has no save for this game. */
  data: Record<string, unknown> | null;
  /** Epoch ms of the last write, 0 when there is no save. */
  updatedAt: number;
}

/** Largest save the server accepts, in bytes of its JSON text. */
export const SAVE_MAX_BYTES = 4096;

/** Game session handed to realtime (`realtimeFromSdk`). */
export interface HubSessionInfo {
  token: string;
  playerId: string;
  game: GameId;
  ranked: boolean;
  /** Epoch ms from the JWT `exp` claim. */
  expiresAt: number;
}

/** `score.submit` answer. `reason` explains `accepted:false`. */
export interface ScoreResult {
  accepted: boolean;
  posted?: boolean;
  value?: number;
  order?: 'asc' | 'desc';
  reason?: 'god_mode' | 'server_board' | 'unranked';
}

export interface LeaderboardRow { userId: string; name: string; value: number; rank: number }

/** `leaderboard.top` answer: top rows plus the caller's own row. */
export interface LeaderboardTop {
  boardId: string;
  variant: string;
  order: 'asc' | 'desc';
  rows: LeaderboardRow[];
  me: LeaderboardRow | null;
}

/** NOBU time-trial floors per Classic level, versioned layout or Chapter 2 level, integer ms (Contract C13). */
export const NOBU_TRIAL_FLOOR_MS: Readonly<Record<'1' | '2' | '3' | '1v2' | '2v2' | '3v2' | '4' | '6' | '5', number>> = {
  '1': 15000, '2': 15000, '3': 12000,
  '1v2': 25700, '2v2': 26000, '3v2': 20600,
  '4': 24000, '6': 30000, '5': 21000,
};
/** NOBU time-trial ceiling, integer ms. */
export const NOBU_TRIAL_CEIL_MS = 1_800_000;

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

/** True when `value` is a stored game id. */
export function canonicalGameId(value: string): GameId | null {
  return isGameId(value) ? value : null;
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
