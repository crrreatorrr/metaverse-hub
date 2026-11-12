import { cameraVelocity } from './camera-motion';

/** Third-person follow, shared by keyboard and controller movement in every realm. */
const FOLLOW_RATE = 2;
const REVERSE_FOLLOW_RATE = 1.6;
const MAX_TURN_SPEED = 1;
const REVERSE_TURN_SPEED = 0.75;
const TURN_RESPONSE = 8;
const REVERSE_ANGLE = Math.PI * 2 / 3;
const SETTLED_ANGLE = 0.0001;
const MANUAL_DELAY = 0.85;
const DIRECTION_DELAY = 0.3;

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function createCameraFollow() {
  let moveYaw = 0;
  let inputActive = false;
  let digitalDirection: number | null = null;
  let manualRemaining = 0;
  let manualOffset = 0;
  let steeringRemaining = 0;
  let manualYaw = false;
  let turnVelocity = 0;
  let reversing = false;
  let recentering = false;
  let stableHeading: number | null = null;
  let directionRemaining = 0;

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

    /** Buffer sudden input; only the rotation actually shown on screen steers movement. */
    manualLook(yawDelta: number): void {
      if (yawDelta !== 0) {
        const previousOffset = manualOffset;
        manualOffset = Math.max(-0.35, Math.min(0.35, manualOffset + yawDelta));
        steeringRemaining = Math.max(-0.35, Math.min(0.35, steeringRemaining + manualOffset - previousOffset));
        manualYaw = true;
      }
      manualRemaining = MANUAL_DELAY;
      reversing = false;
      recentering = false;
    },

    step(dt: number, cameraYaw: number, facingYaw: number, moving: boolean): number {
      const frame = Math.max(0, dt);
      if (moving && (stableHeading === null || Math.abs(angleDelta(stableHeading, facingYaw)) > 0.12)) {
        stableHeading = facingYaw;
        directionRemaining = DIRECTION_DELAY;
      } else if (!moving) {
        stableHeading = null;
        directionRemaining = 0;
        reversing = false;
      }
      const steps = Math.max(1, Math.ceil(frame * 120));
      const stepTime = frame / steps;
      for (let step = 0; step < steps; step++) {
        manualRemaining = Math.max(0, manualRemaining - stepTime);
        directionRemaining = Math.max(0, directionRemaining - stepTime);
        const manual = manualRemaining > 0 || manualYaw;
        const manualTurning = manual && manualYaw;
        const following = !manual && (recentering || (moving && directionRemaining === 0));
        if (!manualTurning && !following && Math.abs(turnVelocity) < 0.001) {
          turnVelocity = 0;
          continue;
        }
        let remaining = angleDelta(cameraYaw, facingYaw);
        if (following && Math.abs(remaining) >= REVERSE_ANGLE) reversing = true;
        if (reversing && Math.abs(remaining) > Math.PI - 0.15) {
          const direction = turnVelocity !== 0 ? turnVelocity : angleDelta(cameraYaw, stableHeading ?? facingYaw);
          remaining = Math.abs(remaining) * Math.sign(direction);
        }
        if (manualTurning) remaining = manualOffset;
        const rate = manualTurning ? 4 : reversing ? REVERSE_FOLLOW_RATE : FOLLOW_RATE;
        const limit = manualTurning ? 1.5 : reversing ? REVERSE_TURN_SPEED : MAX_TURN_SPEED;
        const desiredVelocity = manualTurning || following ? Math.max(-limit, Math.min(limit, remaining * rate)) : 0;
        if (Math.abs(remaining) < SETTLED_ANGLE && Math.abs(turnVelocity) < 0.001) {
          if (following) cameraYaw += remaining;
          turnVelocity = 0;
          reversing = false;
          if (following) recentering = false;
          if (manualTurning) {
            manualOffset = 0;
            steeringRemaining = 0;
            manualYaw = false;
          }
          continue;
        }
        const previousVelocity = turnVelocity;
        // Brake instead of stopping or reversing angular velocity in a single frame.
        const acceleration = manual || Math.abs(turnVelocity) > limit ? 4 : 1.5;
        turnVelocity = cameraVelocity(turnVelocity, desiredVelocity, acceleration, manual ? 16 : TURN_RESPONSE, stepTime);
        const turn = (previousVelocity + turnVelocity) * 0.5 * stepTime;
        if (manualTurning) {
          manualOffset -= turn;
          // Inherited automatic momentum may coast farther than a tiny manual request.
          // That extra camera motion must not steer the player or steer them back afterward.
          if (turn * steeringRemaining > 0) {
            const steering = Math.sign(turn) * Math.min(Math.abs(turn), Math.abs(steeringRemaining));
            moveYaw += steering;
            steeringRemaining -= steering;
          }
        }
        cameraYaw += turn;
      }
      return cameraYaw;
    },

    /** Recenter the view without changing an already held movement direction. */
    recenter(): void {
      manualRemaining = 0;
      manualOffset = 0;
      steeringRemaining = 0;
      manualYaw = false;
      reversing = false;
      recentering = true;
    },

    /** A warp or menu return starts from the new view. */
    reset(): void {
      inputActive = false;
      digitalDirection = null;
      manualRemaining = 0;
      manualOffset = 0;
      steeringRemaining = 0;
      manualYaw = false;
      turnVelocity = 0;
      reversing = false;
      recentering = false;
      stableHeading = null;
      directionRemaining = 0;
    },
  };
}
