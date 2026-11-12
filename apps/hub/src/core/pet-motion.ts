import { MathUtils, Vector3, type Box3, type Matrix4 } from 'three';

/** Uniform display scale relative to the authored pet models and catalog sizes. */
export const PET_SCALE = 2;
const FOLLOW_BACK = 1.25 * PET_SCALE;
const FOLLOW_SIDE = 0.8 * PET_SCALE;
const HEADING_RATE = 5;
const HEADING_TURN_LIMIT = 2.7;
const VELOCITY_RATE = 10;
const FACING_RATE = 12;
const MOTION_EPSILON = 0.0001;
const OWNER_WARP_DISTANCE = 5;

export interface PetCollision {
  (position: Vector3): void;
  blocked?(bounds: Box3, transform: Matrix4): boolean;
  beamRange?(origin: Vector3, direction: Vector3, range: number): number;
}

function turnToward(from: number, to: number, rate: number, limit: number, dt: number): number {
  let turn = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  // A reversal has two equal arcs. Keep the chosen direction stable through tiny pose jitter.
  if (Math.abs(turn) > Math.PI - 0.01) turn = Math.PI;
  return from + MathUtils.clamp(turn * (1 - Math.exp(-rate * dt)), -limit * dt, limit * dt);
}

/** Reused vectors and bounded sweep steps: no frame-time objects or callbacks. */
export function createPetMotion(collide?: PetCollision, followSpeed = 8) {
  const position = new Vector3();
  const lastPlayer = new Vector3();
  const target = new Vector3();
  const delta = new Vector3();
  const velocity = new Vector3();
  let headingYaw = Math.PI;
  let facingYaw = Math.PI;
  let placed = false;
  let speed = 0;

  function lane(player: Vector3, standY: number): void {
    const sin = Math.sin(headingYaw);
    const cos = Math.cos(headingYaw);
    target.set(player.x - sin * FOLLOW_BACK - cos * FOLLOW_SIDE, player.y - standY,
      player.z - cos * FOLLOW_BACK + sin * FOLLOW_SIDE);
  }

  function sweep(): void {
    const steps = Math.ceil(delta.length() / 0.15);
    if (steps === 0) return;
    delta.divideScalar(steps);
    for (let step = 0; step < steps; step += 1) {
      position.add(delta);
      collide?.(position);
    }
  }

  return {
    position,
    get speed() { return speed; },
    get headingYaw() { return headingYaw; },
    get facingYaw() { return facingYaw; },
    reset() { placed = false; },
    /** The animated hull rejected the step. Discard its velocity along with its position. */
    holdAt(spot: Vector3) {
      position.copy(spot);
      velocity.set(0, 0, 0);
      speed = 0;
    },
    setFollowSpeed(value: number) { followSpeed = value; },
    /** Returns true on initial placement or an owner warp. Spawn yaw uses +Z forward. */
    update(dt: number, player: Vector3, standY: number, spawnYaw = headingYaw) {
      const frame = MathUtils.clamp(dt, 0, 0.05);
      delta.subVectors(player, lastPlayer);
      // Only an owner discontinuity can move the pet instantly. Being blocked
      // or falling behind does not move it to the other side of an obstacle.
      const warp = delta.lengthSq() > OWNER_WARP_DISTANCE ** 2;
      delta.y = 0;
      const moving = delta.lengthSq() > MOTION_EPSILON ** 2 && frame > 0;
      if (placed && moving && !warp) {
        headingYaw = turnToward(headingYaw, Math.atan2(delta.x, delta.z), HEADING_RATE, HEADING_TURN_LIMIT, frame);
      }
      lastPlayer.copy(player);
      if (!placed || warp) {
        // Spawn beside the owner without a slide on idle. Sweep from the owner so
        // a wall between them and the lane cannot put the pet on the wrong side.
        headingYaw = facingYaw = spawnYaw;
        lane(player, standY);
        position.set(player.x, target.y, player.z);
        collide?.(position);
        delta.subVectors(target, position);
        sweep();
        velocity.set(0, 0, 0);
        placed = true;
        speed = 0;
        return true;
      }

      lane(player, standY);
      const catchUp = 1 - Math.exp(-followSpeed * frame);
      const maxSpeed = followSpeed * 2;
      const beforeX = position.x;
      const beforeZ = position.z;
      if (moving) {
        // The lane turns independently of the owner, and the pet carries its own
        // travel velocity through that turn. A stop holds the current spot.
        delta.subVectors(target, position).setY(0).multiplyScalar(catchUp / frame);
        delta.clampLength(0, maxSpeed);
        velocity.lerp(delta, 1 - Math.exp(-VELOCITY_RATE * frame));
      } else velocity.set(0, 0, 0);
      const rise = MathUtils.clamp((target.y - position.y) * catchUp, -maxSpeed * frame, maxSpeed * frame);
      delta.copy(velocity).multiplyScalar(frame).setY(Math.abs(rise) > MOTION_EPSILON ? rise : 0);
      sweep();
      const dx = position.x - beforeX;
      const dz = position.z - beforeZ;
      speed = moving ? Math.hypot(dx, dz) / frame : 0;
      if (moving) velocity.set(dx / frame, 0, dz / frame).clampLength(0, maxSpeed);
      if (speed > 0.6) facingYaw = turnToward(facingYaw, Math.atan2(dx, dz), FACING_RATE, 6, frame);
      return false;
    },
  };
}
