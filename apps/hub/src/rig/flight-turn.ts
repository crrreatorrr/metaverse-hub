import { MOVEMENT } from '../core/movement';

// Finish around the jump apex, before even an elevated platform can land.
const TURN_SECONDS = 0.23;
const ABORT_SECONDS = 0.12;

export interface FlightTiming {
  airborne: boolean;
  dt: number;
  remote?: boolean;
  restart?: boolean;
  takeoff?: boolean;
}

/** Progress through the authored air window. Remotes confirm a launch from
 * rising snapshots, then play the turn on a clock. */
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

  function update({ dt, airborne, remote, restart, takeoff }: FlightTiming, vy: number): number {
    if (restart) reset();
    if (!airborne) {
      reset();
      return 0;
    }
    if (remote) {
      sawLaunch ||= takeoff === true;
    } else if (previousVy === null) {
      sawLaunch = vy >= MOVEMENT.jump * 0.7;
    } else if (sawLaunch && elapsed < ABORT_SECONDS && previousVy > 0) {
      // An early head hit stops the ascent faster than gravity. Keep the
      // anticipation pose and let the landing crossfade settle it.
      interrupted ||= previousVy + MOVEMENT.gravity * dt - vy > 1;
    }
    previousVy = vy;
    if (sawLaunch && !interrupted) elapsed += dt;
    return Math.min(1, elapsed / TURN_SECONDS);
  }

  return {
    update,
    reset,
    get launched() { return sawLaunch; },
    get needsRecovery() { return !interrupted && elapsed >= TURN_SECONDS * 0.55 && elapsed < TURN_SECONDS; },
  };
}
