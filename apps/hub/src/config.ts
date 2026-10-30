import type { GameId, RelicId } from '@metaverse/hub-sdk';

/**
 * Plaza layout. Each portal's page is `gameUrl` in `games.ts` (`GAME_URLS`).
 * Walking into a ring opens that page in this tab with `#t=<ticket>`.
 */
export interface PortalConfig {
  id: GameId;
  label: string;
  /** Placeholder building around the portal. Final models come later. */
  place: string;
  /** Radians around the plaza. 0 is north (−Z), increasing toward east. */
  angle: number;
  color: string;
  /** People's Bitcoin is its own 18+ portal. */
  mature?: boolean;
}

/** Artist slots are 72° apart, castle at north. Two slots of yaw keep HPOS10I on the north gate. */
export const PLAZA_SLOT = (Math.PI * 2) / 5;
export const PLAZA_YAW = -2 * PLAZA_SLOT;

export const PORTALS: readonly PortalConfig[] = [
  { id: 'hpos10i', label: 'HPOS10I', place: 'Green Hill Zone', angle: 2 * PLAZA_SLOT + PLAZA_YAW, color: '#39ff6a' },
  { id: 'nobu', label: 'NOBU: Saviour Dog', place: 'The Kennel', angle: 4 * PLAZA_SLOT + PLAZA_YAW, color: '#ff8a1f' },
  { id: 'peoples-bitcoin', label: "The People's Bitcoin", place: 'The White House', angle: 1 * PLAZA_SLOT + PLAZA_YAW, color: '#ffc233', mature: true },
  { id: 'sproto', label: 'Sproto Duel', place: 'The Castle', angle: 0 * PLAZA_SLOT + PLAZA_YAW, color: '#7b5cff' },
];

export const PLAZA_RADIUS = 110;
export const PORTAL_DISTANCE = 96;
export const PORTAL_STANDOFF = 7.5;
export const PORTAL_TRIGGER_RADIUS = 2.4;
export const SPAWN_DISTANCE = 42;
export const MONUMENT_RADIUS = 4.2;
export const PEDESTAL_HEIGHT = 1.45;
export const CURB_RADIUS = 28.5;
export const PILLAR_OFFSET = 1.7;
export const PILLAR_HEIGHT = 3.05;
export const PILLAR_WIDTH = 0.44;
export const BOLLARD_RADIUS = 13.5;
/** 1.5× the previous 5.2 m/s walk. */
export const WALK_SPEED = 7.8;
/** Shift run is 1.8× walk. */
export const SPRINT_SPEED = WALK_SPEED * 1.8;
export const CAMERA_ARM = 7.6;
export const CAMERA_FOV = 78;
/**
 * Body height the plaza used before the size bump. The baked staff is taller
 * than this and is not part of the fit.
 */
export const AVATAR_BODY_REFERENCE = 1.75;
/** Ken's size bump, inside the 1.2–1.3 range. */
export const AVATAR_SCALE = 1.25;
/** Fitted body height. Collider and camera use this, not the staff tip. */
export const AVATAR_HEIGHT = AVATAR_BODY_REFERENCE * AVATAR_SCALE;
/** Look target below the capsule origin, scaled with the body. */
export const CAMERA_LOOK_DROP = 0.15 * (AVATAR_HEIGHT / AVATAR_BODY_REFERENCE);
/**
 * Player model path under the site base. Remote players use this same file.
 * Bald-yellow wizard, same rig as sproto-duel wizard_player.glb.
 */
export const AVATAR_ASSET = 'world/v2/avatar/wizard-player.glb';
/**
 * Logical gait → clip inside the GLB. There is no walk clip; walk plays run
 * at about 0.6× so the stride reads slower than the run.
 */
export const AVATAR_CLIPS = {
  idle: { name: 'idle', timeScale: 1 },
  walk: { name: 'run', timeScale: 0.6 },
  run: { name: 'run', timeScale: 1 },
} as const;

/** Sockets on the Four Lights, same order as the diagonal orbit (NE, SE, SW, NW). */
export const SOCKETS: readonly { id: RelicId; relic: string; color: string; angle: number }[] = [
  { id: 'hpos10i_core', relic: 'HPOS10I Core', color: '#ff2ea6', angle: Math.PI / 4 },
  { id: 'genesis_shard', relic: 'Genesis Block Shard', color: '#f5b942', angle: (3 * Math.PI) / 4 },
  { id: 'cones_tip', relic: "Cone's Tip", color: '#3ec6ff', angle: (-3 * Math.PI) / 4 },
  { id: 'tinubu_crown', relic: "Tinubu's Crown", color: '#8d6bff', angle: -Math.PI / 4 },
];
