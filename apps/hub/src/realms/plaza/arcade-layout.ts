import { CLUB_MARKERS } from './club-interior-colliders';

/**
 * Sproto Fighter's entrance: the arcade cabinet already in club-interior.glb (`arcade_cabinet`
 * collider, `arcade_spot` marker on the back wall, screen facing the room along local -Z).
 * Standing at the walk-up spot and pressing E opens Sproto Fighter with a portal ticket.
 *
 * The Tidebreaker Belt (Sproto Fighter's Relic) sits on a plinth beside the cabinet. It is not
 * one of the Four Lights sockets. All positions are club-local (the Bar is mounted at y = -300
 * with no yaw, so local x/z are world x/z).
 */
const SPOT = CLUB_MARKERS.arcade_spot.pos;

/** Where the player stands to play, in front of the cabinet screen. The back-wall EXIT door beside it is scenery. */
export const ARCADE_WALKUP = { x: SPOT[0] + 0.25, z: SPOT[2] - 1.25 } as const;
/** Horizontal metres from the walk-up spot that still count as "at the machine". */
export const ARCADE_RADIUS = 1.15;
/** Return spawn from `#from=sproto-fighter` or `#from=sproto-arcade`: at the machine, facing back into the room (hub yaw 0 walks -Z). */
export const ARCADE_RETURN = { x: ARCADE_WALKUP.x, z: ARCADE_WALKUP.z - 0.6, yaw: 0 } as const;

/** Belt plinth, beside the cabinet toward the bar gate. Footprint and height in metres. */
export const BELT_PLINTH = { x: SPOT[0] + 1.1, z: SPOT[2] - 0.9, size: 0.5, height: 1.05 } as const;
/** Same box in club-local space, for the walk collider. */
export const BELT_PLINTH_BOX = {
  min: [BELT_PLINTH.x - BELT_PLINTH.size / 2, 0, BELT_PLINTH.z - BELT_PLINTH.size / 2] as const,
  max: [BELT_PLINTH.x + BELT_PLINTH.size / 2, BELT_PLINTH.height + 0.45, BELT_PLINTH.z + BELT_PLINTH.size / 2] as const,
};

export const ARCADE_PROMPT = 'Press E · Choose Sproto Arcade or Sproto Fighter';

export function atArcade(localX: number, localZ: number): boolean {
  return Math.hypot(localX - ARCADE_WALKUP.x, localZ - ARCADE_WALKUP.z) <= ARCADE_RADIUS;
}
