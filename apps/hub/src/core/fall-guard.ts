/**
 * The walk collider is thin boxes, and at low frame rates a squeezed capsule can be pushed through
 * one (the Bar's doorway posts at 25 fps or less). Outside it there is no floor, so the player
 * fell for ever with no way back but a reload. This remembers the last place the player stood and
 * hands it back once a fall has gone deeper than any jump or step in a realm.
 */
export const FALL_RESCUE_DEPTH = 12;

export interface FallPoint { x: number; y: number; z: number }

export function createFallGuard(depth: number = FALL_RESCUE_DEPTH) {
  let safe: FallPoint | null = null;
  return {
    /** A spawn or warp: stand here until the player lands somewhere else. */
    reset(x: number, y: number, z: number): void {
      safe = { x, y, z };
    },
    /** Call once per frame after the physics step. Returns where to put the player back, or null. */
    step(position: FallPoint, grounded: boolean): FallPoint | null {
      if (grounded || !safe) {
        safe = { x: position.x, y: position.y, z: position.z };
        return null;
      }
      return position.y < safe.y - depth ? { ...safe } : null;
    },
  };
}
