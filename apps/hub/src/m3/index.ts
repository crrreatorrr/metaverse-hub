export { paintedCanvas, fitText } from './canvas';
export {
  addHallOfChampions,
  HALL_DOOR_POSE,
  HALL_ROOM_ORIGIN,
  HALL_SPAWN,
  type HallOfChampions,
  type HallOfChampionsOptions,
} from './hallOfChampions';
export {
  addLivingPortals,
  defaultPortalPlacements,
  glowTierForCount,
  FINISHER_BANNER_S,
  FINISHER_FIREWORK_S,
  FINISHER_INTERVAL_S,
  type GlowTier,
  type LivingPortals,
  type LivingPortalsOptions,
} from './livingPortals';
export { addOrbitGems, type OrbitGems, type OrbitGemsOptions } from './orbitGems';
export {
  addBarLeaderboardScreen,
  BAR_SCREEN_POSE,
  type BarLeaderboard,
  type BarLeaderboardOptions,
} from './barLeaderboard';
export {
  createStubLeaderboardProvider,
  createStubOrbitAvatars,
  STUB_CHAMPIONS,
  STUB_PORTAL_PRESENCE,
} from './stub';
export {
  BOARD_META,
  HUB_BOARD_IDS,
  RELIC_GEMS,
  formatBoardScore,
  gameForBoard,
  type ChampionEntry,
  type FinisherEvent,
  type HubBoardId,
  type LeaderboardPage,
  type LeaderboardProvider,
  type LeaderboardRow,
  type NewNumberOneEvent,
  type OrbitAvatar,
  type PortalPlacement,
  type PortalPresence,
  type PortalTopRow,
} from './types';

/**
 * Draw calls added while that mesh is visible. Instancing keeps the gem,
 * ring, beam, firework, and hall-gem counts at one each for 10 avatars.
 * Finisher banners, the sky beam, and the open hall add draws only while shown.
 */
export const M3_DRAW_CALLS = {
  orbitGems: 1,
  portalRings: 1,
  portalBeams: 1,
  portalLabels: 4,
  portalBanners: 4,
  fireworks: 1,
  hallShell: 1,
  hallRoster: 1,
  hallGems: 1,
  hallArch: 1,
  hallSeal: 1,
  hallPlaque: 1,
  hallBeam: 1,
  barBezel: 1,
  barScreen: 1,
} as const;

/** Hall sealed, no finisher, no occupied-portal beam. */
export const M3_STEADY_DRAW_CALLS =
  M3_DRAW_CALLS.orbitGems +
  M3_DRAW_CALLS.portalRings +
  M3_DRAW_CALLS.portalLabels +
  M3_DRAW_CALLS.hallArch +
  M3_DRAW_CALLS.hallSeal +
  M3_DRAW_CALLS.hallPlaque +
  M3_DRAW_CALLS.barBezel +
  M3_DRAW_CALLS.barScreen;

/** Hall open (seal hidden), sky beam, four banners, fireworks. */
export const M3_PEAK_DRAW_CALLS =
  M3_DRAW_CALLS.orbitGems +
  M3_DRAW_CALLS.portalRings +
  M3_DRAW_CALLS.portalBeams +
  M3_DRAW_CALLS.portalLabels +
  M3_DRAW_CALLS.portalBanners +
  M3_DRAW_CALLS.fireworks +
  M3_DRAW_CALLS.hallShell +
  M3_DRAW_CALLS.hallRoster +
  M3_DRAW_CALLS.hallGems +
  M3_DRAW_CALLS.hallArch +
  M3_DRAW_CALLS.hallPlaque +
  M3_DRAW_CALLS.hallBeam +
  M3_DRAW_CALLS.barBezel +
  M3_DRAW_CALLS.barScreen;
