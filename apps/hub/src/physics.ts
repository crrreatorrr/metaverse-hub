import { Box3, Line3, Vector3 } from 'three';
import { INTERSECTED, NOT_INTERSECTED, type MeshBVH } from 'three-mesh-bvh';
import { MOVEMENT } from './core/movement';

/** Previous 0.34 / 1.08 capsule matched a 1.75 m body. Scale with that body, not the staff. */
const BODY_SCALE = MOVEMENT.bodyScale;
export const CAPSULE_RADIUS = MOVEMENT.capsuleRadius * BODY_SCALE;
export const CAPSULE_LENGTH = MOVEMENT.capsuleLength * BODY_SCALE;
/** Player origin is the top of the capsule segment. Feet rest on y = 0. */
export const STAND_Y = MOVEMENT.standHeight;

const GRAVITY = MOVEMENT.gravity;
const JUMP_VELOCITY = MOVEMENT.jump;

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
  const incomingSegment = new Line3();
  const tempBox = new Box3();
  const triPoint = new Vector3();
  const capsulePoint = new Vector3();
  const delta = new Vector3();
  const normal = new Vector3();
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
    velocity.y = Math.max(velocity.y, MOVEMENT.terminal);

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
    }

    incomingSegment.start.copy(position);
    incomingSegment.end.set(position.x, position.y - CAPSULE_LENGTH, position.z);
    tempBox.makeEmpty();
    tempBox.expandByPoint(incomingSegment.start);
    tempBox.expandByPoint(incomingSegment.end);
    tempBox.min.addScalar(-CAPSULE_RADIUS);
    tempBox.max.addScalar(CAPSULE_RADIUS);

    let floorY = -Infinity;
    let ceilingY = Infinity;
    let floorContact = false;
    let wallLift = false;
    const intersectsBounds = (box: Box3) => box.intersectsBox(tempBox) ? INTERSECTED : NOT_INTERSECTED;
    function separate(sideways: boolean): void {
      tempSegment.copy(incomingSegment);
      floorY = -Infinity;
      ceilingY = Infinity;
      floorContact = false;
      wallLift = false;
      bvh.shapecast({
        intersectsBounds,
        intersectsTriangle: (tri) => {
          const distance = tri.closestPointToSegment(tempSegment, triPoint, capsulePoint);
          if (distance < CAPSULE_RADIUS) {
            let depth = CAPSULE_RADIUS - distance;
            const contactY = capsulePoint.y;
            const direction = capsulePoint.sub(triPoint);
            const supportsVerticalContact = Math.abs(tri.getNormal(normal).y) >= 0.45;
            if (supportsVerticalContact || !sideways) {
              if (direction.lengthSq() < 1e-12) direction.set(0, 1, 0);
              else direction.normalize();
              wallLift ||= !supportsVerticalContact && direction.y > 0;
            } else {
              // At a wall's top edge the capsule cap can overlap diagonally.
              // Clear the overlap sideways, using the cap's radius at that height.
              const reach = Math.sqrt(Math.max(0, CAPSULE_RADIUS * CAPSULE_RADIUS - direction.y * direction.y));
              direction.y = 0;
              const horizontal = direction.length();
              depth = Math.max(0, reach - horizontal);
              if (horizontal > 1e-6) direction.divideScalar(horizontal);
              else {
                direction.set(normal.x, 0, normal.z).normalize();
                if ((lastGood.x - triPoint.x) * direction.x + (lastGood.z - triPoint.z) * direction.z < 0) direction.negate();
              }
            }
            // Keep floor and ceiling corrections when a much larger wall
            // contact would otherwise hide them in the combined correction.
            // A vertical face can push up at a triangle edge. Only surfaces
            // with a vertical normal component can support or cap the capsule.
            if (supportsVerticalContact) {
              const correctedY = tempSegment.start.y + direction.y * depth;
              if (direction.y > 0 && contactY <= tempSegment.end.y + 1e-6) {
                // Two shallow contacts can jointly support the capsule, even
                // when neither provides a standalone floor-height correction.
                floorContact = true;
                if (direction.y >= 0.45) floorY = Math.max(floorY, correctedY);
              }
              if (direction.y <= -0.45 && contactY >= tempSegment.start.y - 1e-6) ceilingY = Math.min(ceilingY, correctedY);
            }
            tempSegment.start.addScaledVector(direction, depth);
            tempSegment.end.addScaledVector(direction, depth);
          }
          return false;
        },
      });
    }
    separate(false);
    // A closed ledge's side may resolve before its top face is visited.
    // Look for support at the incoming position before treating a top edge
    // as a wall only. The extra query is limited to ambiguous edge contacts.
    let supportedEdge = false;
    if (wallLift && !floorContact) {
      supportedEdge = bvh.shapecast({
        intersectsBounds,
        intersectsTriangle: (tri) => Math.abs(tri.getNormal(normal).y) >= 0.45 &&
          tri.closestPointToSegment(incomingSegment, triPoint, capsulePoint) < CAPSULE_RADIUS &&
          capsulePoint.y <= incomingSegment.end.y + 1e-6 && capsulePoint.y > triPoint.y,
      });
      if (!supportedEdge) separate(true);
    }

    delta.subVectors(tempSegment.start, position);
    const separated = delta.length();
    // Use the contact heights here, since a wall may have temporarily pushed
    // the segment down before the floor triangle was visited (or vice versa).
    if (separated > 1e-8 && delta.y / separated < 0.45) {
      delta.y = Math.max(0, floorY - position.y) + Math.min(0, ceilingY - position.y);
    }
    const len = delta.length();
    const rising = velocity.y > 0.2;
    grounded = !rising && (floorContact || supportedEdge) && delta.y > Math.abs(dt * velocity.y * 0.25);
    if (len > 1e-5) {
      position.addScaledVector(delta, (len - 1e-5) / len);
      if (!grounded && !rising) {
        delta.divideScalar(len);
        velocity.addScaledVector(delta, -delta.dot(velocity));
      }
    }
    if (grounded) velocity.set(0, 0, 0);
    else if (ceilingY < position.y + 1e-5 && velocity.y > 0) velocity.y = 0;
  }

  function step(dt: number, input: MoveInput, speeds: MoveSpeeds): void {
    const frame = Math.min(Math.max(dt, 0), 0.05);
    if (input.jump && grounded) {
      velocity.y = JUMP_VELOCITY;
      grounded = false;
    }
    if (frame === 0) return;
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
