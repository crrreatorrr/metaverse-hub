import { Vector3 } from 'three';

export type PetCollision = (position: Vector3) => void;

/** Reused vectors and bounded sweep steps: no frame-time objects or callbacks. */
export function createPetMotion(collide?: PetCollision, followSpeed = 8) {
  const position = new Vector3();
  const lastPlayer = new Vector3();
  const heading = new Vector3(0, 0, -1);
  const target = new Vector3();
  const delta = new Vector3();
  let placed = false;
  let speed = 0;
  return {
    position,
    get speed() { return speed; },
    reset() { placed = false; },
    setFollowSpeed(value: number) { followSpeed = value; },
    update(dt: number, player: Vector3, standY: number) {
      const frame = Math.min(Math.max(dt, 0), 0.05);
      delta.subVectors(player, lastPlayer).setY(0);
      if (placed && delta.lengthSq() > 1e-8 && delta.lengthSq() < 4) heading.copy(delta).normalize();
      lastPlayer.copy(player);
      target.set(player.x - heading.x * 1.5, player.y - standY, player.z - heading.z * 1.5);
      const snap = !placed || position.distanceToSquared(target) > 100 || Math.abs(position.y - target.y) > 4;
      if (snap) {
        // The owner's position is known traversable. Snap there, then trail out using the sweep.
        position.set(player.x, target.y, player.z);
        collide?.(position);
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
