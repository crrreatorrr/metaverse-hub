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
/** Shift sprint: Ken's 16 m/s Sonic-style dash (P4). Explicit, not a multiple of walk. */
export const SPRINT_SPEED = 16;
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
 * Sproto Duel's rigged `wizard_player.glb`: no baked staff, and a
 * `socket_staff` node under RightHand where the picked staff mounts.
 */
export const AVATAR_ASSET = 'world/v2/avatar/wizard.glb';
/** Sproto Duel's player fit height. Duel characters keep their size relative to it. */
const DUEL_PLAYER_HEIGHT = 1.9;

/**
 * Pickable avatars. The wizard is the default. The others are Sproto Duel's
 * stage-one boss rigs (`models/rigged/<id>_stage1.glb`), placeholders until
 * hub-made characters exist. Each shares the wizard's clip names.
 * `ownStaff`: the staff is baked into the mesh, so the picked staff is not mounted.
 */
export const CHARACTERS = [
  { id: 'wizard', label: 'Wizard', blurb: 'The plaza regular.', asset: AVATAR_ASSET, portrait: 'world/v2/avatar/portraits/wizard.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'sahil', label: 'Sahil', blurb: 'Sproto Duel, first boss.', asset: 'world/v2/avatar/sahil.glb', portrait: 'world/v2/avatar/portraits/sahil.webp', duelHeight: 2.0, ownStaff: true },
  { id: 'obama', label: 'Bitcoin Obama', blurb: 'Shills the pump.', asset: 'world/v2/avatar/obama.glb', portrait: 'world/v2/avatar/portraits/obama.webp', duelHeight: 2.1, ownStaff: false },
  { id: 'midget', label: 'The Midget', blurb: "Obama's partner. Quick feet.", asset: 'world/v2/avatar/midget.glb', portrait: 'world/v2/avatar/portraits/midget.webp', duelHeight: 1.25, ownStaff: false },
  { id: 'broccoli', label: 'Broccoli Head', blurb: 'One enormous drag on the vape.', asset: 'world/v2/avatar/broccoli.glb', portrait: 'world/v2/avatar/portraits/broccoli.webp', duelHeight: 2.0, ownStaff: false },
  { id: 'agent', label: 'Glowie', blurb: 'Under laser sights.', asset: 'world/v2/avatar/agent.glb', portrait: 'world/v2/avatar/portraits/agent.webp', duelHeight: 2.0, ownStaff: false },
  { id: 'tinubu', label: 'Tinubu', blurb: 'The final crown.', asset: 'world/v2/avatar/tinubu.glb', portrait: 'world/v2/avatar/portraits/tinubu.webp', duelHeight: 2.1, ownStaff: false },
] as const;
export type CharacterId = (typeof CHARACTERS)[number]['id'];
export type CharacterConfig = (typeof CHARACTERS)[number];
export const DEFAULT_CHARACTER: CharacterId = 'wizard';

export function isCharacterId(value: string): value is CharacterId {
  return CHARACTERS.some((entry) => entry.id === value);
}

/**
 * Staffs from Sproto Duel (`models/staffs/staff_<slug>-lod1.glb`). The grip
 * is the origin, +Y butt to head, +Z front, metres for a 1.9 m wizard.
 */
export const STAFFS = [
  { id: 'none', label: 'No staff', line: 'Empty hands.', asset: null, icon: null, accent: '#8ea2b8' },
  { id: 'sproto', label: 'Sproto Staff', line: 'Stock bolt.', asset: 'world/v2/staffs/staff_sproto.glb', icon: 'world/v2/staffs/icons/sproto.webp', accent: '#ffd21f' },
  { id: 'momentum', label: 'Momentum Staff', line: 'Blink Dash.', asset: 'world/v2/staffs/staff_momentum.glb', icon: 'world/v2/staffs/icons/momentum.webp', accent: '#ffc23a' },
  { id: 'moonward', label: 'Moonward Staff', line: 'COOM Bolt.', asset: 'world/v2/staffs/staff_moonward.glb', icon: 'world/v2/staffs/icons/moonward.webp', accent: '#d9b45a' },
  { id: 'nobu', label: 'Nobu Staff', line: 'Bark Bolt.', asset: 'world/v2/staffs/staff_nobu.glb', icon: 'world/v2/staffs/icons/nobu.webp', accent: '#2f6bff' },
] as const;
export type StaffId = (typeof STAFFS)[number]['id'];
export type StaffConfig = (typeof STAFFS)[number];
export const DEFAULT_STAFF: StaffId = 'sproto';

export function isStaffId(value: string): value is StaffId {
  return STAFFS.some((entry) => entry.id === value);
}

/** Staff size relative to the wizard's, so the Midget is not handed a pole twice his height. */
export function staffScale(character: CharacterConfig): number {
  return Math.min(1.15, Math.max(0.75, character.duelHeight / DUEL_PLAYER_HEIGHT));
}

/** Fitted body height in the plaza. The wizard is `AVATAR_HEIGHT`; the rest keep their Sproto Duel ratio. */
export function characterHeight(character: CharacterConfig): number {
  return AVATAR_HEIGHT * (character.duelHeight / DUEL_PLAYER_HEIGHT);
}

/**
 * Logical gait → clip inside the GLB. P4: arrow keys play `jog` (authored for
 * 7.8 m/s), Shift plays `dash` (authored for 16 m/s). Each clip's glTF extras
 * carry `speed_mps`; the avatar sets timeScale = actual speed / speed_mps so the
 * planted foot never slides. Both clips put the left foot down at t = 0, so
 * jog ↔ dash crossfades keep the step phase.
 */
/**
 * Gait clips. `name` is P4's clip (it carries `speed_mps`, so its time scale comes from the
 * controller speed). Rigs without it use `fallback` at `timeScale`.
 */
export const AVATAR_CLIPS = {
  idle: { name: 'idle', fallback: 'idle', timeScale: 1 },
  walk: { name: 'jog', fallback: 'run', timeScale: 0.6 },
  run: { name: 'dash', fallback: 'run', timeScale: 1 },
} as const;
/** Crossfade times (s). The clips bake their own bounce, so the old procedural bob is off. */
export const AVATAR_BLEND = { idleToMove: 0.15, moveToIdle: 0.2, jogToDash: 0.22, dashToJog: 0.28 } as const;

/** Sockets on the Four Lights, same order as the diagonal orbit (NE, SE, SW, NW). */
export const SOCKETS: readonly { id: RelicId; relic: string; color: string; angle: number }[] = [
  { id: 'hpos10i_core', relic: 'HPOS10I Core', color: '#ff2ea6', angle: Math.PI / 4 },
  { id: 'genesis_shard', relic: 'Genesis Block Shard', color: '#f5b942', angle: (3 * Math.PI) / 4 },
  { id: 'cones_tip', relic: "Cone's Tip", color: '#3ec6ff', angle: (-3 * Math.PI) / 4 },
  { id: 'tinubu_crown', relic: "Tinubu's Crown", color: '#8d6bff', angle: -Math.PI / 4 },
];
