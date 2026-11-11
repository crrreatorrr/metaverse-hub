/** Third-person follow, shared by keyboard and controller movement in every realm. */
const FOLLOW_RATE = 3;
const REVERSE_FOLLOW_RATE = 1.8;
const MAX_TURN_SPEED = 2.1;
const REVERSE_TURN_SPEED = 1.1;
const TURN_RESPONSE = 12;
const REVERSE_ANGLE = Math.PI * 2 / 3;
const SETTLED_ANGLE = 0.0001;
const MANUAL_DELAY = 0.85;

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function createCameraFollow() {
  let moveYaw = 0;
  let inputActive = false;
  let digitalDirection: number | null = null;
  let manualRemaining = 0;
  let turnVelocity = 0;
  let reversing = false;
  let recentering = false;

  return {
    /**
     * Choose each new gesture or keyboard/D-pad direction relative to the view. Keep that
     * basis through a continuous analog gesture: feeding the automatic orbit back into
     * movement would make held directions circle and gradual stick turns jump.
     */
    movementYaw(cameraYaw: number, forward: number, strafe: number, digital?: { forward: number; strafe: number }): number {
      if (Math.hypot(forward, strafe) === 0) {
        inputActive = false;
        digitalDirection = null;
        return cameraYaw;
      }
      const nextDigital = digital && Math.hypot(digital.forward, digital.strafe) > 0 ? Math.atan2(digital.strafe, digital.forward) : null;
      if (!inputActive || (nextDigital !== null && nextDigital !== digitalDirection)) {
        moveYaw = cameraYaw;
        reversing = false;
      }
      inputActive = true;
      digitalDirection = nextDigital;
      return moveYaw;
    },

    /** Manual orbit steers movement with the view and temporarily holds off auto-follow. */
    manualLook(yawDelta: number): void {
      moveYaw += yawDelta;
      manualRemaining = MANUAL_DELAY;
      turnVelocity = 0;
      reversing = false;
      recentering = false;
    },

    step(dt: number, cameraYaw: number, facingYaw: number, moving: boolean): number {
      const frame = Math.max(0, dt);
      const followTime = Math.max(0, frame - manualRemaining);
      manualRemaining = Math.max(0, manualRemaining - frame);
      if (!moving && !recentering) {
        turnVelocity = 0;
        reversing = false;
        return cameraYaw;
      }
      if (followTime === 0) return cameraYaw;
      if (Math.abs(angleDelta(cameraYaw, facingYaw)) >= REVERSE_ANGLE) reversing = true;
      // Keep reversals slow all the way around, rather than speeding up halfway through.
      const rate = reversing ? REVERSE_FOLLOW_RATE : FOLLOW_RATE;
      const limit = reversing ? REVERSE_TURN_SPEED : MAX_TURN_SPEED;
      // Small integration steps keep acceleration and braking consistent at different frame rates.
      const steps = Math.max(1, Math.ceil(followTime * 120));
      const stepTime = followTime / steps;
      const blend = 1 - Math.exp(-TURN_RESPONSE * stepTime);
      for (let step = 0; step < steps; step++) {
        let remaining = angleDelta(cameraYaw, facingYaw);
        // Tiny stick noise around exactly 180 degrees must not keep changing the chosen arc.
        if (reversing && Math.abs(remaining) > Math.PI - 0.15 && turnVelocity !== 0) {
          remaining = Math.abs(remaining) * Math.sign(turnVelocity);
        }
        if (Math.abs(remaining) < SETTLED_ANGLE) {
          cameraYaw += remaining;
          turnVelocity = 0;
          reversing = false;
          recentering = false;
          break;
        }
        const desiredVelocity = Math.max(-limit, Math.min(limit, remaining * rate));
        const previousVelocity = turnVelocity;
        turnVelocity += (desiredVelocity - turnVelocity) * blend;
        const turn = (previousVelocity + turnVelocity) * 0.5 * stepTime;
        // Stop on the target if its direction changed underneath an already moving camera.
        if (turn * remaining > 0 && Math.abs(turn) >= Math.abs(remaining)) {
          cameraYaw += remaining;
          turnVelocity = 0;
          reversing = false;
          recentering = false;
          break;
        }
        cameraYaw += turn;
      }
      return cameraYaw;
    },

    /** Recenter the view without changing an already held movement direction. */
    recenter(): void {
      manualRemaining = 0;
      turnVelocity = 0;
      reversing = false;
      recentering = true;
    },

    /** A warp or menu return starts from the new view. */
    reset(): void {
      inputActive = false;
      digitalDirection = null;
      manualRemaining = 0;
      turnVelocity = 0;
      reversing = false;
      recentering = false;
    },
  };
}
