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
  gem: 'gem_hpos' | 'gem_pb' | 'gem_nobu' | 'gem_duel';
  socket: 'socket_orbit' | 'socket_back' | 'socket_shoulder_R' | 'socket_head';
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
  'nobu_trial_time',
  'pb_total_xp',
  'sproto_wins',
  'verse_by_game_hpos10i',
  'verse_by_game_nobu',
  'verse_by_game_peoples-bitcoin',
  'verse_by_game_sproto',
  'verse_total',
] as const;

export type HubBoardId = (typeof HUB_BOARD_IDS)[number];

export const BOARD_META: Record<HubBoardId, { title: string; order: 'asc' | 'desc'; unit: string }> = {
  hpos10i_act_time: { title: 'HPOS10I', order: 'asc', unit: 'best act time' },
  nobu_trial_time: { title: 'NOBU', order: 'asc', unit: 'best trial time' },
  pb_total_xp: { title: "PEOPLE'S BITCOIN", order: 'desc', unit: 'total XP' },
  sproto_wins: { title: 'SPROTO DUEL', order: 'desc', unit: 'wins' },
  verse_by_game_hpos10i: { title: 'HPOS10I VERSE', order: 'desc', unit: 'lifetime Verse' },
  verse_by_game_nobu: { title: 'NOBU VERSE', order: 'desc', unit: 'lifetime Verse' },
  'verse_by_game_peoples-bitcoin': { title: "PEOPLE'S BITCOIN VERSE", order: 'desc', unit: 'lifetime Verse' },
  verse_by_game_sproto: { title: 'SPROTO DUEL VERSE', order: 'desc', unit: 'lifetime Verse' },
  verse_total: { title: 'VERSE TOTAL', order: 'desc', unit: 'lifetime Verse' },
};

export interface LeaderboardRow {
  rank: number;
  playerId: string;
  name: string;
  /** Seconds for time boards. Points, wins, or Verse for the rest. */
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
    case 'verse_by_game_hpos10i':
      return 'hpos10i';
    case 'nobu_trial_time':
    case 'verse_by_game_nobu':
      return 'nobu';
    case 'pb_total_xp':
    case 'verse_by_game_peoples-bitcoin':
      return 'peoples-bitcoin';
    case 'sproto_wins':
    case 'verse_by_game_sproto':
      return 'sproto';
    case 'verse_total':
      return null;
    default: {
      const never: never = boardId;
      return never;
    }
  }
}

export function formatBoardScore(boardId: HubBoardId, score: number): string {
  if (boardId === 'hpos10i_act_time' || boardId === 'nobu_trial_time') {
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
