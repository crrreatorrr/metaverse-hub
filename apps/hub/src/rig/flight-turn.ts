import { MOVEMENT } from '../core/movement';

const TURN_SECONDS = 0.37;
const ABORT_SECONDS = 0.12;

export interface FlightTiming {
  airborne: boolean;
  dt: number;
  remote?: boolean;
  restart?: boolean;
}

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

  function update({ dt, airborne, remote, restart }: FlightTiming, vy: number): number {
    if (restart) reset();
    if (!airborne) {
      reset();
      return 0;
    }
    if (previousVy === null) {
      sawLaunch = !remote && vy >= MOVEMENT.jump * 0.7;
      interrupted = !remote && !sawLaunch;
    }
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
