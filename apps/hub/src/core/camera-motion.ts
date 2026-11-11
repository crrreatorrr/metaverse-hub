import { Vector3 } from 'three';

/** Ease velocity as well as position, including when the requested direction changes abruptly. */
export function cameraVelocity(current: number, desired: number, acceleration: number, response: number, dt: number): number {
  const change = (desired - current) * (1 - Math.exp(-response * dt));
  return current + Math.max(-acceleration * dt, Math.min(acceleration * dt, change));
}

/** Bounded input buffering prevents a mouse spike from queuing seconds of camera rotation. */
export function createCameraPitch() {
  let remaining = 0;
  let velocity = 0;
  let centering = false;
  return {
    queue(delta: number): void {
      if (centering) remaining = 0;
      centering = false;
      remaining = Math.max(-0.2, Math.min(0.2, remaining + delta));
    },
    recenter(delta: number): void {
      remaining = delta;
      centering = true;
    },
    step(dt: number, minTurn = -Infinity, maxTurn = Infinity): number {
      const steps = Math.max(1, Math.ceil(Math.max(0, dt) * 120));
      const h = Math.max(0, dt) / steps;
      let turn = 0;
      for (let step = 0; step < steps; step++) {
        if (Math.abs(remaining) < 0.00001 && Math.abs(velocity) < 0.0001) {
          remaining = velocity = 0;
          centering = false;
          break;
        }
        const desired = Math.max(-0.85, Math.min(0.85, remaining * 4));
        const previous = velocity;
        velocity = cameraVelocity(velocity, desired, 2.5, 16, h);
        const change = (previous + velocity) * 0.5 * h;
        const applied = Math.max(minTurn - turn, Math.min(maxTurn - turn, change));
        turn += applied;
        remaining -= applied;
        if (applied !== change) {
          velocity = 0;
          if ((remaining > 0 && turn >= maxTurn) || (remaining < 0 && turn <= minTurn)) remaining = 0;
        }
      }
      return turn;
    },
    reset(): void {
      remaining = velocity = 0;
      centering = false;
    },
  };
}

/** A critically damped focus point absorbs starts, stops, direction changes, and landings. */
export function createCameraTarget() {
  const position = new Vector3();
  const velocity = new Vector3();
  let initialized = false;
  return {
    step(dt: number, target: Vector3): Vector3 {
      const frame = Math.max(0, dt);
      if (!initialized) {
        position.copy(target);
        velocity.set(0, 0, 0);
        initialized = true;
      }
      for (const axis of ['x', 'y', 'z'] as const) {
        const frequency = axis === 'y' ? 8 : 12;
        const offset = position[axis] - target[axis];
        const change = velocity[axis] + frequency * offset;
        const decay = Math.exp(-frequency * frame);
        position[axis] = target[axis] + (offset + change * frame) * decay;
        velocity[axis] = (velocity[axis] - frequency * change * frame) * decay;
      }
      return position;
    },
    reset(): void {
      initialized = false;
    },
  };
}

/** Retract immediately for geometry; extend gently when a wall or pillar clears. */
export function createCameraArm() {
  let fraction = 1;
  return {
    step(dt: number, clearance: number): number {
      const allowed = Math.max(0, Math.min(1, clearance));
      if (allowed < fraction) fraction = allowed;
      else fraction += (allowed - fraction) * (1 - Math.exp(-3 * Math.max(0, dt)));
      return fraction;
    },
    reset(): void {
      fraction = 1;
    },
  };
}

/** Keep the menu orbit independent of live movement while it eases back into play. */
export function createCameraPreview() {
  let phase = 0;
  let phaseVelocity = 0;
  let facing = 0;
  let spin = 0;
  let spinGoal = 0;
  let spinVelocity = 0;
  let turn: number | null = null;
  return {
    open(bodyYaw: number): void {
      if (phase === 0) {
        facing = bodyYaw;
        spin = spinGoal = spinVelocity = 0;
        turn = null;
      }
    },
    spin(delta: number): void {
      spinGoal = spin + Math.max(-0.35, Math.min(0.35, spinGoal - spin + delta));
    },
    step(dt: number, open: boolean): number {
      const frame = Math.max(0, dt);
      const steps = Math.max(1, Math.ceil(frame * 120));
      const h = frame / steps;
      for (let step = 0; step < steps; step++) {
        const goal = open ? 1 : 0;
        // A changing play heading can lengthen the interpolation arc during exit.
        // Budget the angular motion, rather than treating every arc as the same length.
        const phaseLimit = (open ? 1.2 : 0.7) / Math.max(Math.PI, Math.abs(turn ?? Math.PI));
        const desiredPhase = Math.max(-phaseLimit, Math.min(phaseLimit, (goal - phase) * 3));
        const previousPhaseVelocity = phaseVelocity;
        phaseVelocity = cameraVelocity(phaseVelocity, desiredPhase, 1.5, 12, h);
        phase = Math.max(0, Math.min(1, phase + (previousPhaseVelocity + phaseVelocity) * 0.5 * h));
        if (Math.abs(goal - phase) < 0.002 && Math.abs(phaseVelocity) < 0.01) {
          phase = goal;
          phaseVelocity = 0;
          if (!open) turn = null;
        }
        const desiredSpin = Math.max(-0.9, Math.min(0.9, (spinGoal - spin) * 4));
        const previousSpinVelocity = spinVelocity;
        spinVelocity = cameraVelocity(spinVelocity, desiredSpin, 2.5, 16, h);
        spin += (previousSpinVelocity + spinVelocity) * 0.5 * h;
      }
      return phase;
    },
    yaw(playYaw: number): number {
      if (phase === 0) return playYaw;
      const front = facing + Math.PI + spin;
      const shortest = Math.atan2(Math.sin(front - playYaw), Math.cos(front - playYaw));
      // Unwrap the interpolation arc: crossing +/-pi must not flip the camera to the other side.
      turn = turn === null ? shortest : turn + Math.atan2(Math.sin(shortest - turn), Math.cos(shortest - turn));
      return playYaw + turn * phase;
    },
    reset(): void {
      phase = phaseVelocity = spin = spinGoal = spinVelocity = 0;
      turn = null;
    },
  };
}
