import type { GameId, RelicId } from '@metaverse/hub-sdk';

/**
 * Portal pages and plaza layout. Change `url` when a game is hosted.
 * Walking into a portal opens `url#t=<mock ticket>`.
 */
export interface PortalConfig {
  id: GameId;
  label: string;
  /** Placeholder building around the portal. Final models come later. */
  place: string;
  url: string;
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
  { id: 'hpos10i', label: 'HPOS10I', place: 'Green Hill Zone', url: '/play/hpos10i/', angle: 2 * PLAZA_SLOT + PLAZA_YAW, color: '#39ff6a' },
  { id: 'nobu', label: 'NOBU: Saviour Dog', place: 'The Kennel', url: '/play/nobu/', angle: 4 * PLAZA_SLOT + PLAZA_YAW, color: '#ff8a1f' },
  { id: 'peoples-bitcoin', label: "The People's Bitcoin", place: 'The White House', url: '/play/peoples-bitcoin/', angle: 1 * PLAZA_SLOT + PLAZA_YAW, color: '#ffc233', mature: true },
  { id: 'sproto', label: 'Sproto Duel', place: 'The Castle', url: '/play/sproto/', angle: 0 * PLAZA_SLOT + PLAZA_YAW, color: '#7b5cff' },
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
export const WALK_SPEED = 5.2;
export const SPRINT_SPEED = 8.6;
export const CAMERA_ARM = 7.6;
export const CAMERA_FOV = 78;

/** Sockets on the Four Lights, same order as the diagonal orbit (NE, SE, SW, NW). */
export const SOCKETS: readonly { id: RelicId; relic: string; color: string; angle: number }[] = [
  { id: 'hpos10i_core', relic: 'HPOS10I Core', color: '#ff2ea6', angle: Math.PI / 4 },
  { id: 'genesis_shard', relic: 'Genesis Block Shard', color: '#f5b942', angle: (3 * Math.PI) / 4 },
  { id: 'cones_tip', relic: "Cone's Tip", color: '#3ec6ff', angle: (-3 * Math.PI) / 4 },
  { id: 'tinubu_crown', relic: "Tinubu's Crown", color: '#8d6bff', angle: -Math.PI / 4 },
];
