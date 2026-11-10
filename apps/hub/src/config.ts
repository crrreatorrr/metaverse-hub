import type { GameId, RelicId } from '@metaverse/hub-sdk';
import { MOVEMENT } from './core/movement';

/**
 * Plaza layout. Each portal's page is `gameUrl` in `games.ts` (`GAME_URLS`).
 * Walking into a ring opens that page in this tab with `#t=<ticket>`.
 */
export interface PortalConfig {
  id: GameId;
  distance: number;
  triggerRadius: number;
  label: string;
  /** Placeholder building around the portal. Final models come later. */
  place: string;
  /** Radians around the plaza. 0 is north (−Z), increasing toward east. */
  angle: number;
  color: string;
  /** People's Bitcoin is its own 18+ portal. */
  mature?: boolean;
}

/** 1.5× the previous 5.2 m/s walk. */
export const WALK_SPEED = MOVEMENT.walk;
/** Shift sprint: Ken's 16 m/s Sonic-style dash (P4). Explicit, not a multiple of walk. */
export const SPRINT_SPEED = MOVEMENT.sprint;
export const CAMERA_ARM = MOVEMENT.cameraArm;
export const CAMERA_FOV = MOVEMENT.fov;
/**
 * Body height the plaza used before the size bump. The baked staff is taller
 * than this and is not part of the fit.
 */
export const AVATAR_BODY_REFERENCE = MOVEMENT.bodyReference;
/** Ken's size bump, inside the 1.2–1.3 range. */
export const AVATAR_SCALE = MOVEMENT.bodyScale;
/** Fitted body height. Collider and camera use this, not the staff tip. */
export const AVATAR_HEIGHT = AVATAR_BODY_REFERENCE * AVATAR_SCALE;
/** Look target below the capsule origin, scaled with the body. */
export const CAMERA_LOOK_DROP = MOVEMENT.lookDrop * (AVATAR_HEIGHT / AVATAR_BODY_REFERENCE);
/**
 * Player model path under the site base. Remote players use this same file.
 * Sproto Duel's rigged `wizard_player.glb`: no baked staff, and a
 * `socket_staff` node under RightHand where the picked staff mounts.
 */
export const AVATAR_ASSET = 'world/v2/avatar/wizard.glb';
/** Sproto Duel's player fit height. Duel characters keep their size relative to it. */
const DUEL_PLAYER_HEIGHT = 1.9;

/**
 * Pickable avatars. The wizard is the default. Sproto Duel's stage-one bosses
 * came first. Sproto Shooter adds its soldier and every enemy model (the duel
 * cast's later stages, the bots, and the bosses). `duelHeight` is only the fit
 * ratio: bosses that tower in the shooter stand with the plaza regulars.
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
  { id: 'soldier', label: 'Sproto Soldier', blurb: 'Sproto Shooter.', asset: 'world/v2/avatar/soldier.glb', portrait: 'world/v2/avatar/portraits/soldier.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'midget2', label: 'Midget II', blurb: 'The swarm, grown.', asset: 'world/v2/avatar/midget2.glb', portrait: 'world/v2/avatar/portraits/midget2.webp', duelHeight: 1.25, ownStaff: false },
  { id: 'flyer', label: 'Flying Midget', blurb: 'Gold top hat.', asset: 'world/v2/avatar/flyer.glb', portrait: 'world/v2/avatar/portraits/flyer.webp', duelHeight: 1.25, ownStaff: false },
  { id: 'obama2', label: 'Obama II', blurb: 'Second coat.', asset: 'world/v2/avatar/obama2.glb', portrait: 'world/v2/avatar/portraits/obama2.webp', duelHeight: 2.1, ownStaff: false },
  { id: 'bigobama', label: 'Big Obama', blurb: 'Shield up front.', asset: 'world/v2/avatar/bigobama.glb', portrait: 'world/v2/avatar/portraits/bigobama.webp', duelHeight: 2.1, ownStaff: false },
  { id: 'sahil2', label: 'Sahil II', blurb: 'Second rite.', asset: 'world/v2/avatar/sahil2.glb', portrait: 'world/v2/avatar/portraits/sahil2.webp', duelHeight: 2.0, ownStaff: true },
  { id: 'hexsahil', label: 'Hex Sahil', blurb: 'The auditor.', asset: 'world/v2/avatar/hexsahil.glb', portrait: 'world/v2/avatar/portraits/hexsahil.webp', duelHeight: 2.0, ownStaff: true },
  { id: 'tinubu2', label: 'Tinubu II', blurb: 'Second crown.', asset: 'world/v2/avatar/tinubu2.glb', portrait: 'world/v2/avatar/portraits/tinubu2.webp', duelHeight: 2.1, ownStaff: false },
  { id: 'megatinubu', label: 'Mega Tinubu', blurb: 'The last wave.', asset: 'world/v2/avatar/megatinubu.glb', portrait: 'world/v2/avatar/portraits/megatinubu.webp', duelHeight: 2.1, ownStaff: false },
  { id: 'laser', label: 'Laser Bot', blurb: 'Two red bolts.', asset: 'world/v2/avatar/laser.glb', portrait: 'world/v2/avatar/portraits/laser.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'shooterbot', label: 'Shooter Bot', blurb: 'Arm cannon.', asset: 'world/v2/avatar/shooterbot.glb', portrait: 'world/v2/avatar/portraits/shooterbot.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'monster', label: 'Blue Monster', blurb: 'Wave-two boss.', asset: 'world/v2/avatar/monster.glb', portrait: 'world/v2/avatar/portraits/monster.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'beast', label: 'Sproto Beast', blurb: 'Punches and kicks.', asset: 'world/v2/avatar/beast.glb', portrait: 'world/v2/avatar/portraits/beast.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'cargolem', label: 'Car Golem', blurb: 'Magnet fists.', asset: 'world/v2/avatar/cargolem.glb', portrait: 'world/v2/avatar/portraits/cargolem.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'mole', label: 'Mole Monster', blurb: 'A drill for a hand.', asset: 'world/v2/avatar/mole.glb', portrait: 'world/v2/avatar/portraits/mole.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
  { id: 'dragon', label: 'Jade Dragon', blurb: 'Wave-one boss.', asset: 'world/v2/avatar/dragon.glb', portrait: 'world/v2/avatar/portraits/dragon.webp', duelHeight: DUEL_PLAYER_HEIGHT, ownStaff: false },
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
  { id: 'fighters_might', label: 'Fighter\'s Might', line: 'Fist Bolt.', asset: 'world/v2/staffs/staff_fighters_might.glb', icon: 'world/v2/staffs/icons/fighters_might.webp', accent: '#ff3a3a' },
  { id: 'alien_ray', label: 'Alien Ray Staff', line: 'Alien Ray.', asset: 'world/v2/staffs/staff_alien_ray.glb', icon: 'world/v2/staffs/icons/alien_ray.webp', accent: '#ff8c2a' },
  { id: 'shooter', label: 'Shooter Staff', line: 'Requires Dragon Scale.', asset: 'world/v2/staffs/staff_shooter.glb', icon: 'world/v2/staffs/icons/shooter.webp', accent: '#ff942b' },
  { id: 'fighter', label: 'Fighter Staff', line: 'Requires Tinubu\'s Crown.', asset: 'world/v2/staffs/staff_fighter.glb', icon: 'world/v2/staffs/icons/fighter.webp', accent: '#56eaff' },
] as const;
export type StaffId = (typeof STAFFS)[number]['id'];
export type StaffConfig = (typeof STAFFS)[number];
export const DEFAULT_STAFF: StaffId = 'sproto';

export const STAFF_RELICS: Partial<Record<StaffId, RelicId>> = {
  shooter: 'dragon_scale',
  fighter: 'tinubu_crown',
};

export function isStaffId(value: string): value is StaffId {
  return STAFFS.some((entry) => entry.id === value);
}

/** Staff size relative to the wizard's, so the Midget is not handed a pole twice his height. */
export function staffScale(character: CharacterConfig): number {
  return Math.min(1.15, Math.max(0.75, character.duelHeight / DUEL_PLAYER_HEIGHT));
}

/**
 * Bodies with no hand for a staff: the soldier's gun, the bots' blasters and cannon, the brutes' fists, claws and
 * drill, the dragon. The picked staff stays in the look and returns on any other avatar.
 */
const NO_STAFF: ReadonlySet<CharacterId> = new Set<CharacterId>(['soldier', 'laser', 'shooterbot', 'monster', 'beast', 'cargolem', 'mole', 'dragon']);

/** False when the picked staff is not mounted: the body can't hold one, or carries its own (`ownStaff`). */
export function holdsStaff(character: CharacterConfig): boolean {
  return !character.ownStaff && !NO_STAFF.has(character.id);
}

/** The Flying Midget flies when it moves: walk and sprint both play its own airborne `run`, not the wizard's jog and dash. */
export function fliesWhenMoving(character: CharacterConfig): boolean {
  return character.id === 'flyer';
}

/**
 * The Sproto Shooter cast walk at shooter speeds (about 1 m/s); the plaza's walk is a 7.8 m/s jog. Their `walk`
 * clip would skate even at the 2.5x playback cap, so in the plaza both gaits play their `run` (the shooter
 * still uses `walk`). The Sproto Soldier's `walk` is a jog authored for the plaza, so it keeps it. The dragon
 * keeps its cruise `walk` and fast `run` flights.
 */
const WALKS_WITH_RUN: ReadonlySet<CharacterId> = new Set<CharacterId>(['laser', 'shooterbot', 'monster', 'beast', 'cargolem', 'mole']);

export function walksWithRun(character: CharacterConfig): boolean {
  return WALKS_WITH_RUN.has(character.id);
}

/** Plaza-only size on top of the fit ratio, so the shooter brutes tower over the regulars. Other games keep their own sizes. */
const PLAZA_SIZE: Partial<Record<CharacterId, number>> = {
  soldier: 1.1,
  monster: 1.3,
  beast: 1.4,
  cargolem: 1.4,
  mole: 1.4,
  dragon: 1.3,
};

/** Fitted body height in the plaza. The wizard is `AVATAR_HEIGHT`; the rest keep their ratio to it, times `PLAZA_SIZE`. */
export function characterHeight(character: CharacterConfig): number {
  return AVATAR_HEIGHT * (character.duelHeight / DUEL_PLAYER_HEIGHT) * (PLAZA_SIZE[character.id] ?? 1);
}

/**
 * Yaw applied before the height fit, so the face matches the wizard (toward −Z).
 * Duel rigs and the Mixamo shooter cast face +Z and need a half turn.
 * The jade dragon's nose points along −X, so it only needs a quarter turn.
 */
export function characterYaw(character: CharacterConfig): number {
  return character.id === 'dragon' ? -Math.PI / 2 : Math.PI;
}

/**
 * Gait clips. `name` is P4's clip: arrow keys play `jog`, Shift plays `dash`, both in place with the left
 * foot down at t = 0, so jog ↔ dash crossfades keep the step phase. The wizard ships them; the other rigs on
 * its skeleton (the Sproto Duel cast) get the wizard's, retargeted (`rig/locomotion.ts`), and are measured for
 * the ground speed each clip was animated for, so the avatar sets timeScale = controller speed / that speed
 * and the planted foot never slides. Other skeletons resolve their own clips in `avatar.ts` and play them at
 * `timeScale` (or their `speed_mps`).
 */
export const AVATAR_CLIPS = {
  idle: { name: 'idle', fallback: 'idle', timeScale: 1 },
  walk: { name: 'jog', fallback: 'run', timeScale: 0.6 },
  run: { name: 'dash', fallback: 'run', timeScale: 1 },
} as const;
/** Crossfade times (s). The clips bake their own bounce, so the old procedural bob is off. */
export const AVATAR_BLEND = { idleToMove: 0.15, moveToIdle: 0.2, jogToDash: 0.22, dashToJog: 0.28 } as const;
