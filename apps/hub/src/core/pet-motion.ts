import { Vector3, type Box3, type Matrix4 } from 'three';

export interface PetCollision {
  (position: Vector3): void;
  blocked?(bounds: Box3, transform: Matrix4): boolean;
  beamRange?(origin: Vector3, direction: Vector3, range: number): number;
}

/** Reused vectors and bounded sweep steps: no frame-time objects or callbacks. */
export function createPetMotion(collide?: PetCollision, followSpeed = 8) {
  const position = new Vector3();
  const lastPlayer = new Vector3();
  const heading = new Vector3(0, 0, -1);
  const target = new Vector3();
  const delta = new Vector3();
  let placed = false;
  let spawnAtTarget = false;
  let speed = 0;
  return {
    position,
    get speed() { return speed; },
    get headingYaw() { return Math.atan2(heading.x, heading.z); },
    reset() { placed = false; },
    setSpawnAtTarget(value: boolean) { spawnAtTarget = value; },
    setFollowSpeed(value: number) { followSpeed = value; },
    update(dt: number, player: Vector3, standY: number) {
      const frame = Math.min(Math.max(dt, 0), 0.05);
      delta.subVectors(player, lastPlayer).setY(0);
      if (placed && delta.lengthSq() > 1e-8 && delta.lengthSq() < 4) heading.copy(delta).normalize();
      lastPlayer.copy(player);
      target.set(player.x - heading.x * 1.5, player.y - standY, player.z - heading.z * 1.5);
      const snap = !placed || position.distanceToSquared(target) > 100 || Math.abs(position.y - target.y) > 4;
      if (snap) {
        // Long companions start at the trail position. The view validates their complete animated hull.
        // Compact companions keep the original owner-centred spawn and trail out using the sweep.
        position.set(player.x, target.y, player.z);
        collide?.(position);
        if (spawnAtTarget) {
          const steps = 10;
          delta.subVectors(target, position).divideScalar(steps);
          for (let step = 0; step < steps; step += 1) {
            position.add(delta);
            collide?.(position);
          }
        }
        placed = true;
        speed = 0;
      }
      delta.subVectors(target, position);
      const distance = delta.length();
      const travel = Math.min(distance * (1 - Math.exp(-followSpeed * frame)), followSpeed * 2 * frame);
      const steps = Math.max(1, Math.ceil(travel / 0.15));
      if (distance > 1e-6) delta.multiplyScalar(travel / distance / steps);
      else delta.set(0, 0, 0);
      const beforeX = position.x;
      const beforeZ = position.z;
      for (let i = 0; i < steps; i++) {
        position.add(delta);
        collide?.(position);
      }
      speed = frame > 0 ? Math.hypot(position.x - beforeX, position.z - beforeZ) / frame : 0;
    },
  };
}
