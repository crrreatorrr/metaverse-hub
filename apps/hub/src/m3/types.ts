import type { GameId, RelicId } from '@metaverse/hub-sdk';
import type { Object3D } from 'three';

export type { GameId, RelicId };

/**
 * Relic gems. Socket names match the architecture loadout. M3 orbits every
 * owned gem around the avatar anchor instead of pinning it to a bone.
 * `height` is metres above that anchor (the hub rig origin sits near the shoulders).
 */
export const RELIC_GEMS: readonly {
  id: RelicId;
  gem: 'gem_hpos' | 'gem_pb' | 'gem_nobu' | 'gem_duel' | 'gem_fighter' | 'gem_coin' | 'gem_anchor' | 'gem_scale';
  socket: 'socket_orbit' | 'socket_back' | 'socket_shoulder_R' | 'socket_head' | 'socket_waist';
  color: string;
  radius: number;
  height: number;
  speed: number;
  phase: number;
}[] = [
  { id: 'hpos10i_core', gem: 'gem_hpos', socket: 'socket_orbit', color: '#ff2ea6', radius: 0.72, height: 0.05, speed: 0.9, phase: 0 },
  { id: 'genesis_shard', gem: 'gem_pb', socket: 'socket_back', color: '#f5b942', radius: 0.9, height: -0.15, speed: 0.7, phase: 1.6 },
  { id: 'cones_tip', gem: 'gem_nobu', socket: 'socket_shoulder_R', color: '#3ec6ff', radius: 0.58, height: 0.22, speed: 1.25, phase: 3.2 },
  { id: 'tinubu_crown', gem: 'gem_duel', socket: 'socket_head', color: '#8d6bff', radius: 0.42, height: 0.48, speed: 1.05, phase: 4.7 },
  // Tidebreaker Belt (Sproto Fighter): a wide, slow loop at belt height.
  { id: 'tidebreaker_belt', gem: 'gem_fighter', socket: 'socket_waist', color: '#66d7e8', radius: 0.82, height: -0.42, speed: 0.8, phase: 2.4 },
  { id: 'breakwater_coin', gem: 'gem_coin', socket: 'socket_orbit', color: '#3ec6ff', radius: 0.66, height: 0.3, speed: 0.6, phase: 5.6 },
  // Marina Anchor (Sproto Coop Battle): the widest, slowest loop, low like a hanging anchor.
  { id: 'marina_anchor', gem: 'gem_anchor', socket: 'socket_orbit', color: '#2ee6c8', radius: 0.98, height: -0.3, speed: 0.5, phase: 0.8 },
  // Dragon Scale (Sproto Shooter): a quick, tight loop just above the head.
  { id: 'dragon_scale', gem: 'gem_scale', socket: 'socket_orbit', color: '#ff5a2a', radius: 0.52, height: 0.64, speed: 1.4, phase: 3.9 },
];

export interface OrbitAvatar {
  id: string;
  /** World root. Pass the hub `rig`, or a remote avatar root with the same origin. */
  anchor: Object3D;
  relics: readonly RelicId[];
}

/** Bar wall screen, in cycle order. Verse boards are per game id plus the wallet total. */
export const HUB_BOARD_IDS = [
  'hpos10i_act_time',
  // What a normal (unranked) hub session posts: its own rows, kept out of the ranked standings and `meta`.
  'hpos10i_act_time:open',
  // NOBU time trials: one server board (nobu_trial_time), one page per level (variant), values in integer ms.
  'nobu_trial_time:1v2',
  'nobu_trial_time:2v2',
  'nobu_trial_time:3v2',
  'nobu_trial_time:4',
  'nobu_trial_time:6',
  'nobu_trial_time:5',
  'nobu_trial_time:1',
  'nobu_trial_time:2',
  'nobu_trial_time:3',
  'pb_total_xp',
  'sproto_wins',
  // Sproto Coop Battle: the server settles one row per boss (variant); the wall shows the first boss.
  'coop_stage_clear_ms_v1:01-marina-bront',
  'verse_by_game_hpos10i',
  'verse_by_game_nobu',
  'verse_by_game_peoples-bitcoin',
  'verse_by_game_sproto',
  'verse_total',
  // Cross-game ranking the server recomputes every five minutes (leaderboard.ts META_SQL).
  'meta',
] as const;

export type HubBoardId = (typeof HUB_BOARD_IDS)[number];

/**
 * Pages the Bar wall cycles through (plan item A4). A page is listed only when a normal,
 * hub-entered session can put rows on it:
 * - `hpos10i_act_time` (the ranked rows) stays out: the plaza cannot open a ranked session. Normal
 *   sessions post to `hpos10i_act_time:open` (B4, leaderboard.ts), which is the page shown.
 * - `verse_by_game_hpos10i` is back: HPOS10I Tickets exchange from the Wallet tab (B1, verse.exchange).
 * A page that can never fill goes here; apps/hub/test/boards.test.ts fails when a listed page
 * needs a ranked session the plaza cannot open.
 */
export const BAR_DEAD_BOARD_IDS: readonly HubBoardId[] = ['hpos10i_act_time'];
export const BAR_BOARD_IDS: readonly HubBoardId[] = HUB_BOARD_IDS.filter((id) => !BAR_DEAD_BOARD_IDS.includes(id));

/** The Classic NOBU layouts sit behind the current ones: a Classic page shows only when it has rows. */
export const BAR_OPTIONAL_BOARD_IDS: readonly HubBoardId[] = ['nobu_trial_time:1', 'nobu_trial_time:2', 'nobu_trial_time:3'];

/**
 * Index of the page after `index`, skipping optional pages that have no rows.
 * Returns `index` when nothing else can be shown.
 */
export function nextBarPage(
  boards: readonly HubBoardId[],
  index: number,
  hasRows: (id: HubBoardId) => boolean,
  optional: readonly HubBoardId[] = BAR_OPTIONAL_BOARD_IDS,
): number {
  for (let step = 1; step <= boards.length; step += 1) {
    const at = (index + step) % boards.length;
    const id = boards[at];
    if (id === undefined) continue;
    if (!optional.includes(id) || hasRows(id)) return at;
  }
  return index;
}

/** How many pages one loop shows right now. */
export function barLoopLength(
  boards: readonly HubBoardId[],
  hasRows: (id: HubBoardId) => boolean,
  optional: readonly HubBoardId[] = BAR_OPTIONAL_BOARD_IDS,
): number {
  return boards.filter((id) => !optional.includes(id) || hasRows(id)).length;
}

export const NO_SCORES_TEXT = 'No scores yet. Be the first.';

export const BOARD_META: Record<HubBoardId, { title: string; order: 'asc' | 'desc'; unit: string }> = {
  hpos10i_act_time: { title: 'HPOS10I · RANKED', order: 'asc', unit: 'best act time' },
  'hpos10i_act_time:open': { title: 'HPOS10I', order: 'asc', unit: 'best time, Retro Rush Hills act 1' },
  'nobu_trial_time:1v2': { title: 'NOBU · LEVEL 1', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:2v2': { title: 'NOBU · LEVEL 2', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:3v2': { title: 'NOBU · LEVEL 3', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:4': { title: 'NOBU · LEVEL 4', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:6': { title: 'NOBU · LEVEL 6', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:5': { title: 'NOBU · LEVEL 5', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:1': { title: 'NOBU · LEVEL 1 CLASSIC', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:2': { title: 'NOBU · LEVEL 2 CLASSIC', order: 'asc', unit: 'time trial' },
  'nobu_trial_time:3': { title: 'NOBU · LEVEL 3 CLASSIC', order: 'asc', unit: 'time trial' },
  pb_total_xp: { title: "PEOPLE'S BITCOIN", order: 'desc', unit: 'total XP' },
  sproto_wins: { title: 'SPROTO DUEL', order: 'desc', unit: 'wins' },
  'coop_stage_clear_ms_v1:01-marina-bront': { title: 'COOP BATTLE · TIDEBREAK MARINA', order: 'asc', unit: 'fastest boss clear' },
  verse_by_game_hpos10i: { title: 'HPOS10I VERSE', order: 'desc', unit: 'lifetime Verse' },
  verse_by_game_nobu: { title: 'NOBU VERSE', order: 'desc', unit: 'lifetime Verse' },
  'verse_by_game_peoples-bitcoin': { title: "PEOPLE'S BITCOIN VERSE", order: 'desc', unit: 'lifetime Verse' },
  verse_by_game_sproto: { title: 'SPROTO DUEL VERSE', order: 'desc', unit: 'lifetime Verse' },
  verse_total: { title: 'VERSE TOTAL', order: 'desc', unit: 'lifetime Verse' },
  meta: { title: 'HUB RANKING', order: 'desc', unit: 'points across the game boards' },
};

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  name: string;
  /** Seconds for HPOS10I, integer ms for NOBU trials. Points, wins, or Verse for the rest. */
  score: number;
}

export interface LeaderboardPage {
  boardId: HubBoardId;
  title: string;
  order: 'asc' | 'desc';
  unit: string;
  rows: readonly LeaderboardRow[];
}

/** Hub data source. The stub never calls Nakama. A live provider replaces it after M2. */
export interface LeaderboardProvider {
  readonly boards: readonly HubBoardId[];
  load(boardId: HubBoardId): Promise<LeaderboardPage>;
}

export interface NewNumberOneEvent {
  boardId: HubBoardId;
  title: string;
  /** Portal that shares the finisher queue. Null for the Verse total. */
  gameId: GameId | null;
  row: LeaderboardRow;
}

export function gameForBoard(boardId: HubBoardId): GameId | null {
  switch (boardId) {
    case 'hpos10i_act_time':
    case 'hpos10i_act_time:open':
    case 'verse_by_game_hpos10i':
      return 'hpos10i';
    case 'nobu_trial_time:1':
    case 'nobu_trial_time:2':
    case 'nobu_trial_time:3':
    case 'nobu_trial_time:1v2':
    case 'nobu_trial_time:2v2':
    case 'nobu_trial_time:3v2':
    case 'nobu_trial_time:4':
    case 'nobu_trial_time:6':
    case 'nobu_trial_time:5':
    case 'verse_by_game_nobu':
      return 'nobu';
    case 'pb_total_xp':
    case 'verse_by_game_peoples-bitcoin':
      return 'peoples-bitcoin';
    case 'sproto_wins':
    case 'verse_by_game_sproto':
      return 'sproto';
    case 'coop_stage_clear_ms_v1:01-marina-bront':
      return 'sproto-coop-battle';
    case 'verse_total':
    case 'meta':
      return null;
    default: {
      const never: never = boardId;
      return never;
    }
  }
}

/** Server board and variant behind a screen id (`nobu_trial_time:2` → board nobu_trial_time, variant "2"). */
export function serverBoard(boardId: HubBoardId): { board: string; variant?: string } | null {
  if (boardId.startsWith('verse_')) return null;
  const at = boardId.indexOf(':');
  return at < 0 ? { board: boardId } : { board: boardId.slice(0, at), variant: boardId.slice(at + 1) };
}

/** Integer ms → m:ss.cc, the same format as NOBU's fmtTime. */
export function formatTrialMs(ms: number): string {
  const safe = Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0;
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const hundredths = Math.floor((safe % 1000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export function formatBoardScore(boardId: HubBoardId, score: number): string {
  if (boardId.startsWith('nobu_trial_time') || boardId.startsWith('coop_stage_clear_ms_v1')) return formatTrialMs(score);
  if (boardId === 'hpos10i_act_time' || boardId === 'hpos10i_act_time:open') {
    const safe = Number.isFinite(score) ? Math.max(0, score) : 0;
    const minutes = Math.floor(safe / 60);
    const seconds = safe - minutes * 60;
    return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
  }
  const whole = Number.isFinite(score) ? Math.round(score) : 0;
  return whole.toLocaleString('en-US');
}

export interface ChampionEntry {
  /** Server order. 1 is the first player who owned all four Relics. */
  order: number;
  playerId: string;
  name: string;
}

export interface PortalPlacement {
  gameId: GameId;
  x: number;
  y: number;
  z: number;
  /** Yaw that turns the placeholder ring toward the plaza center. */
  rotationY: number;
  color: string;
  label: string;
}

export interface PortalTopRow {
  name: string;
  score: string;
}

export interface PortalPresence {
  gameId: GameId;
  /** Players currently in the game. Tiers are 0, 1–2, 3–5, 6+. */
  count: number;
  names: readonly string[];
  top: readonly PortalTopRow[];
}

export interface FinisherEvent {
  gameId: GameId;
  name: string;
  /** Short line under the name, for example "defeated Tinubu" or "New #1". */
  line: string;
}
