import { MOVEMENT } from '../core/movement';

const TURN_SECONDS = 0.34;
const ABORT_SECONDS = 0.12;

/** Progress through the authored air window. Remote velocity is a smoothed
 * estimate, so only the flight clock advances the turn. */
export function createFlightTurn() {
  let elapsed = 0;
  let previousVy: number | null = null;
  let sawLaunch = false;
  let interrupted = false;

  function reset(): void {
    elapsed = 0;
    previousVy = null;
    sawLaunch = false;
    interrupted = false;
  }

  function update(dt: number, airborne: boolean, vy: number): number {
    if (!airborne) {
      reset();
      return 0;
    }
    if (previousVy === null) sawLaunch = vy >= MOVEMENT.jump * 0.7;
    else if (sawLaunch && elapsed < ABORT_SECONDS && previousVy > 0) {
      // An early head hit stops the ascent faster than gravity. Keep the
      // anticipation pose and let the landing crossfade settle it.
      interrupted ||= previousVy + MOVEMENT.gravity * dt - vy > 1;
    }
    previousVy = vy;
    if (!interrupted) elapsed += dt;
    return Math.min(1, elapsed / TURN_SECONDS);
  }

  return { update, reset };
}
