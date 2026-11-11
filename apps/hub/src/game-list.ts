import { RELIC_BY_GAME, type GameId, type RelicId } from '@metaverse/hub-sdk';

/**
 * The eight games, for the menu's Games tab, the return card and the 18+ confirm (plan items D3,
 * D4, D5). Pure data: labels and colours repeat the plaza's portal and cabinet config, and
 * apps/hub/test/guide.test.ts fails when they drift.
 */
export interface GameInfo {
  id: GameId;
  label: string;
  /** One line under the name. */
  blurb: string;
  /** Where the scenic route is. */
  where: string;
  color: string;
  /** What earns this game's Relic, as a goal: "Defeat Cone for Cone's Tip". */
  goal: string;
  /** 18+ satire: the plaza asks once before launching. */
  mature?: boolean;
}

export const GAME_LIST: readonly GameInfo[] = [
  { id: 'hpos10i', label: 'HPOS10I', blurb: 'Momentum platformer · beat your act time', where: 'North gate', color: '#39ff6a', goal: 'Clear Retro Rush Hills, act 1, for the HPOS10I Core' },
  { id: 'nobu', label: 'NOBU: Saviour Dog', blurb: '3D platformer · time trials on every level', where: 'The Kennel gate', color: '#ff8a1f', goal: "Defeat Cone for Cone's Tip" },
  { id: 'peoples-bitcoin', label: "The People's Bitcoin", blurb: '18+ satire · online worlds, quests and a Ticket shop', where: 'The White House gate', color: '#ffc233', goal: 'Finish the tutorial quest for the Genesis Block Shard', mature: true },
  { id: 'sproto', label: 'Sproto Duel', blurb: 'Wizard duels · story bosses and online 1v1', where: 'The Castle gate', color: '#7b5cff', goal: "Defeat Tinubu for Tinubu's Crown" },
  { id: 'sproto-shooter', label: 'Sproto Shooter', blurb: 'First-person loot shooter · Wave Mode and a campaign', where: 'The Range gate', color: '#ff5ec4', goal: 'Clear wave 1 of Wave Mode for the Dragon Scale' },
  { id: 'sproto-arcade', label: 'Sproto Arcade', blurb: 'The Long Way Home · ten giant bosses', where: 'Bar cabinet', color: '#ffcc59', goal: 'Beat Fat Head Dave for the Breakwater Coin' },
  { id: 'sproto-fighter', label: 'Sproto Fighter', blurb: 'Story mode and online 1v1 duels', where: 'Bar cabinet', color: '#ff3d6e', goal: 'Win Story World 1 for the Tidebreaker Belt' },
  { id: 'sproto-coop-battle', label: 'Sproto Coop Battle', blurb: 'Six players across twelve stages', where: 'Bar cabinet', color: '#5ee0ff', goal: 'Clear stage 1 for the Marina Anchor' },
];

export function gameInfo(id: GameId): GameInfo | undefined {
  return GAME_LIST.find((game) => game.id === id);
}

export function relicOfGame(id: GameId): RelicId | undefined {
  return RELIC_BY_GAME[id];
}

// ---------- Last game played (per browser), so Esc then Enter launches it again.

export const LAST_GAME_KEY = 'hub:last-game';

export function parseLastGame(stored: string | null): GameId | null {
  return GAME_LIST.find((game) => game.id === stored)?.id ?? null;
}

// ---------- 18+ confirm (D5)

export const MATURE_OK_KEY = 'hub:mature-ok';
export const MATURE_QUESTION = '18+ satire. Enter?';

/** True when this launch must ask first: the game is marked mature and this browser has not said yes. */
export function needsMatureConfirm(game: { mature?: boolean } | undefined, stored: string | null): boolean {
  return Boolean(game?.mature) && stored !== '1';
}
