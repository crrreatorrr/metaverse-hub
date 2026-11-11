/** Third-person follow, shared by keyboard and controller movement in every realm. */
const FOLLOW_RATE = 5;
const MANUAL_DELAY = 0.85;

function angleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function createCameraFollow() {
  let moveYaw = 0;
  let inputActive = false;
  let digitalDirection: number | null = null;
  let manualRemaining = 0;

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
      }
      inputActive = true;
      digitalDirection = nextDigital;
      return moveYaw;
    },

    /** Manual orbit steers movement with the view and temporarily holds off auto-follow. */
    manualLook(yawDelta: number): void {
      moveYaw += yawDelta;
      manualRemaining = MANUAL_DELAY;
    },

    step(dt: number, cameraYaw: number, facingYaw: number, moving: boolean): number {
      const frame = Math.max(0, dt);
      const followTime = Math.max(0, frame - manualRemaining);
      manualRemaining = Math.max(0, manualRemaining - frame);
      if (!moving || followTime === 0) return cameraYaw;
      return cameraYaw + angleDelta(cameraYaw, facingYaw) * (1 - Math.exp(-FOLLOW_RATE * followTime));
    },

    /** Recenter the view without changing an already held movement direction. */
    recenter(): void {
      manualRemaining = 0;
    },

    /** A warp or menu return starts from the new view. */
    reset(): void {
      inputActive = false;
      digitalDirection = null;
      manualRemaining = 0;
    },
  };
}
