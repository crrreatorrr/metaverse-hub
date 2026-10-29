import { Box3, Line3, Vector3 } from 'three';
import { INTERSECTED, NOT_INTERSECTED, type MeshBVH } from 'three-mesh-bvh';
import { AVATAR_SCALE } from './config';

/** 1.25× the previous 0.34 / 1.08 capsule, matching the taller avatar. */
export const CAPSULE_RADIUS = 0.34 * AVATAR_SCALE;
export const CAPSULE_LENGTH = 1.08 * AVATAR_SCALE;
/** Player origin is the top of the capsule segment. Feet rest on y = 0. */
export const STAND_Y = CAPSULE_RADIUS + CAPSULE_LENGTH;

const GRAVITY = -28;
const JUMP_VELOCITY = 6.4;

export interface MoveInput {
  forward: number;
  strafe: number;
  sprint: boolean;
  jump: boolean;
  yaw: number;
}

export interface MoveSpeeds {
  walk: number;
  sprint: number;
}

export interface PlayerController {
  readonly position: Vector3;
  readonly velocity: Vector3;
  grounded: boolean;
  facingYaw: number;
  spawn(x: number, y: number, z: number, yaw?: number): void;
  step(dt: number, input: MoveInput, speeds: MoveSpeeds): void;
}

/**
 * Kinematic capsule against a three-mesh-bvh collider.
 * The origin matches the three-mesh-bvh character example: segment start is
 * the player position, segment end hangs down by CAPSULE_LENGTH, and the
 * radius pads both ends. Horizontal motion is a position delta; gravity
 * lives in velocity so a grounded landing can zero it.
 */
export function createPlayerController(bvh: MeshBVH): PlayerController {
  const position = new Vector3(0, STAND_Y, 0);
  const velocity = new Vector3();
  const lastGood = new Vector3().copy(position);
  const tempSegment = new Line3();
  const tempBox = new Box3();
  const triPoint = new Vector3();
  const capsulePoint = new Vector3();
  const delta = new Vector3();
  let grounded = true;
  let facingYaw = 0;

  function spawn(x: number, y: number, z: number, yaw = 0): void {
    position.set(x, y, z);
    velocity.set(0, 0, 0);
    grounded = true;
    facingYaw = yaw;
    lastGood.copy(position);
  }

  function substep(dt: number, input: MoveInput, speeds: MoveSpeeds): void {
    if (grounded) velocity.y = dt * GRAVITY;
    else velocity.y += dt * GRAVITY;
    velocity.y = Math.max(velocity.y, -40);

    position.addScaledVector(velocity, dt);

    const mag = Math.hypot(input.forward, input.strafe);
    if (mag > 0) {
      const inv = mag > 1 ? 1 / mag : 1;
      const sin = Math.sin(input.yaw);
      const cos = Math.cos(input.yaw);
      const mx = sin * input.forward * inv + cos * input.strafe * inv;
      const mz = -cos * input.forward * inv + sin * input.strafe * inv;
      const speed = (input.sprint ? speeds.sprint : speeds.walk) * dt;
      position.x += mx * speed;
      position.z += mz * speed;
      facingYaw = Math.atan2(mx, -mz);
    } else {
      facingYaw = input.yaw;
    }

    tempSegment.start.copy(position);
    tempSegment.end.set(position.x, position.y - CAPSULE_LENGTH, position.z);
    tempBox.makeEmpty();
    tempBox.expandByPoint(tempSegment.start);
    tempBox.expandByPoint(tempSegment.end);
    tempBox.min.addScalar(-CAPSULE_RADIUS);
    tempBox.max.addScalar(CAPSULE_RADIUS);

    bvh.shapecast({
      intersectsBounds: (box) => (box.intersectsBox(tempBox) ? INTERSECTED : NOT_INTERSECTED),
      intersectsTriangle: (tri) => {
        const distance = tri.closestPointToSegment(tempSegment, triPoint, capsulePoint);
        if (distance < CAPSULE_RADIUS) {
          const depth = CAPSULE_RADIUS - distance;
          const direction = capsulePoint.sub(triPoint);
          if (direction.lengthSq() < 1e-12) direction.set(0, 1, 0);
          else direction.normalize();
          tempSegment.start.addScaledVector(direction, depth);
          tempSegment.end.addScaledVector(direction, depth);
        }
        return false;
      },
    });

    delta.subVectors(tempSegment.start, position);
    // A steep contact (wall, curb, pedestal) must not lift the capsule.
    // The rounded bottom otherwise walks up any vertical face.
    const separated = delta.length();
    if (separated > 1e-8 && delta.y / separated < 0.45) delta.y = 0;
    const len = delta.length();
    const rising = velocity.y > 0.2;
    grounded = !rising && delta.y > Math.abs(dt * velocity.y * 0.25);
    if (len > 1e-5) {
      const offset = len - 1e-5;
      delta.multiplyScalar(offset / len);
      position.add(delta);
      if (grounded) velocity.set(0, 0, 0);
      else if (!rising) {
        delta.multiplyScalar(1 / Math.max(offset, 1e-8));
        velocity.addScaledVector(delta, -delta.dot(velocity));
      }
    } else if (grounded) {
      velocity.set(0, 0, 0);
    }
  }

  function step(dt: number, input: MoveInput, speeds: MoveSpeeds): void {
    const frame = Math.min(Math.max(dt, 0), 0.05);
    if (input.jump && grounded) {
      velocity.y = JUMP_VELOCITY;
      grounded = false;
    }
    const substeps = 4;
    for (let i = 0; i < substeps; i += 1) substep(frame / substeps, input, speeds);
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      position.copy(lastGood);
      velocity.set(0, 0, 0);
      return;
    }
    lastGood.copy(position);
  }

  return { position, velocity, get grounded() { return grounded; }, set grounded(value) { grounded = value; }, get facingYaw() { return facingYaw; }, set facingYaw(value) { facingYaw = value; }, spawn, step };
}
