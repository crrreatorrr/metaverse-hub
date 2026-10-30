import { RELIC_IDS, type RelicId } from '@metaverse/hub-sdk';
import { Group } from 'three';
import { STAND_Y } from '../physics';
import {
  BOARD_META,
  HUB_BOARD_IDS,
  formatBoardScore,
  type ChampionEntry,
  type GameId,
  type HubBoardId,
  type LeaderboardPage,
  type LeaderboardProvider,
  type LeaderboardRow,
  type OrbitAvatar,
  type PortalPresence,
} from './types';

interface Person {
  playerId: string;
  name: string;
  hpos10i_act_time: number;
  nobu_trial_time: number;
  pb_total_xp: number;
  sproto_wins: number;
  verse: Record<GameId, number>;
}

const PEOPLE: readonly Person[] = [
  { playerId: 'p-dusk', name: 'dusk-walker', hpos10i_act_time: 58.2, nobu_trial_time: 70.4, pb_total_xp: 6400, sproto_wins: 9, verse: { hpos10i: 6, nobu: 4, 'peoples-bitcoin': 8, sproto: 2 } },
  { playerId: 'p-cone', name: 'cone-kid', hpos10i_act_time: 74.2, nobu_trial_time: 48.15, pb_total_xp: 9100, sproto_wins: 11, verse: { hpos10i: 4, nobu: 30, 'peoples-bitcoin': 20, sproto: 6 } },
  { playerId: 'p-morelight', name: 'morelight', hpos10i_act_time: 62.4, nobu_trial_time: 55.0, pb_total_xp: 18420, sproto_wins: 14, verse: { hpos10i: 40, nobu: 12, 'peoples-bitcoin': 50, sproto: 14 } },
  { playerId: 'p-sproto', name: 'sproto', hpos10i_act_time: 81.05, nobu_trial_time: 66.1, pb_total_xp: 4200, sproto_wins: 36, verse: { hpos10i: 8, nobu: 6, 'peoples-bitcoin': 10, sproto: 36 } },
  { playerId: 'p-guest', name: 'guest-17', hpos10i_act_time: 66.9, nobu_trial_time: 74.8, pb_total_xp: 3100, sproto_wins: 4, verse: { hpos10i: 44, nobu: 2, 'peoples-bitcoin': 6, sproto: 4 } },
  { playerId: 'p-tinubu', name: 'tinubu', hpos10i_act_time: 95.0, nobu_trial_time: 81.0, pb_total_xp: 7600, sproto_wins: 21, verse: { hpos10i: 2, nobu: 8, 'peoples-bitcoin': 12, sproto: 18 } },
  { playerId: 'p-nobu', name: 'nobu', hpos10i_act_time: 88.4, nobu_trial_time: 51.9, pb_total_xp: 2800, sproto_wins: 7, verse: { hpos10i: 10, nobu: 22, 'peoples-bitcoin': 4, sproto: 2 } },
  { playerId: 'p-moon', name: 'moonward', hpos10i_act_time: 71.3, nobu_trial_time: 60.3, pb_total_xp: 12350, sproto_wins: 16, verse: { hpos10i: 14, nobu: 10, 'peoples-bitcoin': 28, sproto: 8 } },
  { playerId: 'p-jester', name: 'jester', hpos10i_act_time: 102.6, nobu_trial_time: 90.2, pb_total_xp: 1540, sproto_wins: 3, verse: { hpos10i: 2, nobu: 2, 'peoples-bitcoin': 2, sproto: 2 } },
  { playerId: 'p-pixel', name: 'pixel', hpos10i_act_time: 77.75, nobu_trial_time: 63.4, pb_total_xp: 8800, sproto_wins: 12, verse: { hpos10i: 16, nobu: 8, 'peoples-bitcoin': 18, sproto: 10 } },
];

function verseTotal(person: Person): number {
  return person.verse.hpos10i + person.verse.nobu + person.verse['peoples-bitcoin'] + person.verse.sproto;
}

function rowsFor(boardId: HubBoardId): LeaderboardRow[] {
  const meta = BOARD_META[boardId];
  const scored = PEOPLE.map((person) => ({
    playerId: person.playerId,
    name: person.name,
    score: scoreOf(person, boardId),
  }));
  scored.sort((a, b) => (meta.order === 'asc' ? a.score - b.score : b.score - a.score));
  return scored.slice(0, 10).map((row, index) => ({ rank: index + 1, ...row }));
}

function scoreOf(person: Person, boardId: HubBoardId): number {
  switch (boardId) {
    case 'hpos10i_act_time':
      return person.hpos10i_act_time;
    case 'nobu_trial_time':
      return person.nobu_trial_time;
    case 'pb_total_xp':
      return person.pb_total_xp;
    case 'sproto_wins':
      return person.sproto_wins;
    case 'verse_by_game_hpos10i':
      return person.verse.hpos10i;
    case 'verse_by_game_nobu':
      return person.verse.nobu;
    case 'verse_by_game_peoples-bitcoin':
      return person.verse['peoples-bitcoin'];
    case 'verse_by_game_sproto':
      return person.verse.sproto;
    case 'verse_total':
      return verseTotal(person);
    default: {
      const never: never = boardId;
      return never;
    }
  }
}

function page(boardId: HubBoardId): LeaderboardPage {
  const meta = BOARD_META[boardId];
  return {
    boardId,
    title: meta.title,
    order: meta.order,
    unit: meta.unit,
    rows: rowsFor(boardId),
  };
}

/** In-memory boards. No Nakama client, no fetch. */
export function createStubLeaderboardProvider(): LeaderboardProvider {
  return {
    boards: HUB_BOARD_IDS,
    load(boardId) {
      return Promise.resolve(page(boardId));
    },
  };
}

const STUB_RELICS: readonly (readonly RelicId[])[] = [
  RELIC_IDS,
  ['hpos10i_core'],
  ['genesis_shard', 'cones_tip'],
  ['tinubu_crown'],
  ['hpos10i_core', 'tinubu_crown'],
  ['cones_tip'],
  ['genesis_shard'],
  ['hpos10i_core', 'genesis_shard', 'cones_tip'],
  [],
  ['tinubu_crown', 'cones_tip'],
];

/** Ten anchors in a ring at standing height, so a 10-avatar budget check has gems to draw. */
export function createStubOrbitAvatars(): OrbitAvatar[] {
  return STUB_RELICS.map((relics, index) => {
    const angle = (index / STUB_RELICS.length) * Math.PI * 2;
    const anchor = new Group();
    anchor.name = `m3-stub-avatar-${index}`;
    anchor.position.set(Math.sin(angle) * 36, STAND_Y, -Math.cos(angle) * 36);
    const owned: RelicId[] = relics.slice();
    return { id: `stub-${index}`, anchor, relics: owned };
  });
}

export const STUB_CHAMPIONS: readonly ChampionEntry[] = [
  { order: 1, playerId: 'p-morelight', name: 'morelight' },
  { order: 2, playerId: 'p-sproto', name: 'sproto' },
  { order: 3, playerId: 'p-cone', name: 'cone-kid' },
];

function topFor(boardId: HubBoardId): { name: string; score: string }[] {
  return rowsFor(boardId).map((row) => ({ name: row.name, score: formatBoardScore(boardId, row.score) }));
}

/** One portal at each glow tier: 0, 2, 4, and 8 players. */
export const STUB_PORTAL_PRESENCE: readonly PortalPresence[] = [
  { gameId: 'hpos10i', count: 0, names: [], top: topFor('hpos10i_act_time') },
  { gameId: 'nobu', count: 2, names: ['cone-kid', 'nobu'], top: topFor('nobu_trial_time') },
  {
    gameId: 'peoples-bitcoin',
    count: 4,
    names: ['morelight', 'moonward', 'jester', 'pixel'],
    top: topFor('pb_total_xp'),
  },
  {
    gameId: 'sproto',
    count: 8,
    names: ['sproto', 'tinubu', 'morelight', 'moonward', 'pixel', 'cone-kid', 'dusk-walker', 'nobu'],
    top: topFor('sproto_wins'),
  },
];
