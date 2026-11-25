import { RELICS } from '../../core/relics';
import type { PortalConfig } from '../../config';

export const PORTAL_DISTANCE = 96;
export const PORTAL_TRIGGER_RADIUS = 2.4;
/** Artist slots are 72° apart, castle at north. Two slots of yaw keep HPOS10I on the north gate. */
export const PLAZA_SLOT = (Math.PI * 2) / 5;
export const PLAZA_YAW = -2 * PLAZA_SLOT;
/** The Range ring's angle, on the fifth artist slot in front of the Bar. */
export const RANGE_ANGLE = 3 * PLAZA_SLOT + PLAZA_YAW;
/**
 * Sproto Open World stands this many metres of arc from the Range ring, on the Green Hill side
 * (lower angle). The Bar's fence gap is on the other side, so the door path stays clear.
 */
export const OPEN_WORLD_ARC = 10;
/**
 * Sproto Racer stands this many metres of arc past Open World, further toward Green Hill.
 * The Bar's fence gap stays on the far side of the Range.
 */
export const RACER_ARC = 10;

export const PORTALS: readonly PortalConfig[] = [
  { distance: PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'hpos10i', label: 'HPOS10I', place: 'Green Hill Zone', angle: 2 * PLAZA_SLOT + PLAZA_YAW, color: '#39ff6a' },
  { distance: PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'nobu', label: 'NOBU: Saviour Dog', place: 'The Kennel', angle: 4 * PLAZA_SLOT + PLAZA_YAW, color: '#ff8a1f' },
  { distance: PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'peoples-bitcoin', label: "The People's Bitcoin", place: 'The White House', angle: 1 * PLAZA_SLOT + PLAZA_YAW, color: '#ffc233', mature: true },
  { distance: PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'sproto', label: 'Sproto Duel', place: 'The Castle', angle: 0 * PLAZA_SLOT + PLAZA_YAW, color: '#7b5cff' },
  // The Range entrance stands in front of the Bar.
  { distance: PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'sproto-shooter', label: 'Sproto Shooter', place: 'The Range', angle: 3 * PLAZA_SLOT + PLAZA_YAW, color: '#ff5ec4' },
  // Sixth ring, beside the Range on the same 96 m circle. Like every ring it faces the statue.
  { distance: PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'sproto-open-world', label: 'Sproto Open World', place: 'Sproutvale', angle: RANGE_ANGLE - OPEN_WORLD_ARC / PORTAL_DISTANCE, color: '#a6ff4d' },
  // Seventh ring, 10 m of arc past Open World on the same 96 m circle. Like every ring it faces the statue.
  { distance: PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'sproto-racer', label: 'Sproto Racer', place: 'The Paddock', angle: RANGE_ANGLE - (OPEN_WORLD_ARC + RACER_ARC) / PORTAL_DISTANCE, color: '#19d3c5' },
];

/**
 * A second Shooter entrance stands north of the statue, just past the pedestal.
 * Returns from the game land at the Range entrance.
 */
export const STATUE_PORTAL_DISTANCE = 31;
export const STATUE_PORTALS: readonly PortalConfig[] = [
  { distance: STATUE_PORTAL_DISTANCE, triggerRadius: PORTAL_TRIGGER_RADIUS, id: 'sproto-shooter', label: 'Sproto Shooter', place: 'Behind the statue', angle: 0, color: '#39ff6a' },
];

/**
 * Sproto Fighter, Sproto Arcade and Sproto Coop Battle share the arcade cabinet inside the Bar.
 * Press E at the cabinet and pick a game to launch it with a portal ticket.
 */
export const ARCADE_GAME = { id: 'sproto-fighter', label: 'Sproto Fighter', place: 'The Bar arcade', color: '#ff3d6e' } as const;
export const ARCADE_STORY_GAME = { id: 'sproto-arcade', label: 'Sproto Arcade', place: 'The Bar arcade', color: '#ffcc59' } as const;
export const ARCADE_COOP_GAME = { id: 'sproto-coop-battle', label: 'Sproto Coop Battle', place: 'The Bar arcade', color: '#5ee0ff' } as const;

/** Cabinet choices, in picker order. */
export const ARCADE_GAMES = [
  { ...ARCADE_STORY_GAME, blurb: 'The Long Way Home · twelve giant bosses, a rooftop chase and the code shaft' },
  { ...ARCADE_GAME, blurb: 'Story mode and online 1v1 duels' },
  { ...ARCADE_COOP_GAME, blurb: 'Up to four players across thirteen stages' },
] as const;

export const PORTAL_STANDOFF = 7.5;
export const SPAWN_DISTANCE = 42;
export const MONUMENT_RADIUS = 4.2;
export const PEDESTAL_HEIGHT = 1.45;
export const CURB_RADIUS = 28.5;
export const PILLAR_OFFSET = 1.7;
export const PILLAR_HEIGHT = 3.05;
export const PILLAR_WIDTH = 0.44;
export const BOLLARD_RADIUS = 13.5;

/** Monument angles stay in plaza ring order. Eight Relics sit 45° apart. */
const SOCKET_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, -Math.PI / 4, 0, Math.PI, Math.PI / 2, -Math.PI / 2];
export const SOCKETS = RELICS.map((relic, index) => ({ ...relic, relic: relic.name, angle: SOCKET_ANGLES[index]! }));
export const PEDESTAL_COLORS = RELICS.map(relic => relic.color);
export const ARCADE_RELIC = SOCKETS[4];
