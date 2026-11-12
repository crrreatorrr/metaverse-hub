import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createPetMotion } from '../src/core/pet-motion';
import { createPetCollision } from '../src/core/pet-collision';

const player = new Vector3(0, 1.8, 0);
const pet = createPetMotion();
assert.equal(pet.update(1 / 60, player, 1.8), true, 'initial placement');
assert.ok(pet.position.distanceTo(new Vector3(1.6, 0, 2.5)) < 1e-8, 'spawns in a diagonal lane beside the owner');
for (let i = 0; i < 120; i++) pet.update(1 / 60, player, 1.8);
assert.ok(pet.position.distanceTo(new Vector3(1.6, 0, 2.5)) < 1e-8, 'does not slide into position on idle');
const retainedPosition = pet.position;
player.z = -0.1;
pet.update(1 / 60, player, 1.8);
assert.ok(pet.speed > 0);
assert.equal(pet.position, retainedPosition, 'mutates its preallocated position');
player.set(0, -298.2, -0.1);
assert.equal(pet.update(1 / 60, player, 1.8), true, 'vertical-only portal warp');
assert.ok(pet.position.distanceTo(new Vector3(0, -300, -0.1)) < 3.1, 'portal snap');
pet.update(5, player, 1.8);
assert.ok(Number.isFinite(pet.position.x), 'long frames remain stable');

const spawnEast = createPetMotion();
spawnEast.update(1 / 60, new Vector3(0, 1.8, 0), 1.8, Math.PI / 2);
assert.ok(spawnEast.position.distanceTo(new Vector3(-2.5, 0, 1.6)) < 1e-8, 'spawn lane starts from the avatar facing');
spawnEast.update(1 / 60, new Vector3(0, 1.8, 0), 1.8, 0);
assert.ok(spawnEast.position.distanceTo(new Vector3(-2.5, 0, 1.6)) < 1e-8, 'a stationary owner turning their view does not drag the pet');

function walkTurn(hz: number): Vector3 {
  const owner = new Vector3(0, 1.8, 0);
  const follower = createPetMotion();
  const dt = 1 / hz;
  const stride = 7.8 * dt;
  follower.update(dt, owner, 1.8);
  for (let i = 0; i < hz * 2; i++) {
    owner.z -= stride;
    follower.update(dt, owner, 1.8);
  }
  const beforeTurn = follower.position.clone();
  const facing = follower.facingYaw;
  owner.z += stride;
  follower.update(dt, owner, 1.8);
  assert.ok(follower.position.z < beforeTurn.z, 'a sudden owner reversal keeps the pet moving on its own path at first');
  assert.ok(Math.abs(follower.facingYaw - facing) < 0.25, 'the pet does not snap around on the first reversed frame');
  assert.ok(follower.position.distanceTo(beforeTurn) < 16 * dt + 0.001, 'a sudden turn stays within the movement cap');
  for (let i = 1; i < hz * 2; i++) {
    owner.z += stride;
    follower.update(dt, owner, 1.8);
  }
  assert.ok(follower.position.x < -1, 'the pet settles in its own lane when the owner reverses');
  const stop = follower.position.clone();
  for (let i = 0; i < hz; i++) follower.update(dt, owner, 1.8);
  assert.deepEqual(follower.position.toArray(), stop.toArray(), 'a stopped owner leaves the pet exactly where it stopped');
  assert.equal(follower.speed, 0, 'a stopped owner has no horizontal follow speed');
  return stop;
}
const steady = walkTurn(60);
for (const hz of [30, 120]) {
  assert.ok(walkTurn(hz).distanceTo(steady) < 0.15, 'follow lane and reversal are stable across frame rates');
}


const waiting = new Vector3();
const traveler = new Vector3(0, 1.8, 0);
let obstructed = true;
const leftBehind = createPetMotion(position => {
  if (obstructed) position.copy(waiting);
});
assert.equal(leftBehind.update(1 / 60, traveler, 1.8), true);
for (let i = 0; i < 100; i++) {
  traveler.z -= 0.2;
  assert.equal(leftBehind.update(1 / 60, traveler, 1.8), false, 'walking out of range does not snap a stuck pet');
}
assert.deepEqual(leftBehind.position.toArray(), waiting.toArray(), 'pet stays where it got stuck');
obstructed = false;
traveler.x += 0.2;
assert.equal(leftBehind.update(1 / 60, traveler, 1.8), false, 'turning after getting far away cannot snap a pet');
assert.ok(leftBehind.position.length() <= 16 / 60, 'pet resumes its path at its normal speed');
for (let i = 0; i < 60; i++) {
  traveler.z -= 0.2;
  leftBehind.update(1 / 60, traveler, 1.8);
  leftBehind.holdAt(waiting);
}
traveler.z -= 0.2;
leftBehind.update(1 / 60, traveler, 1.8);
assert.ok(leftBehind.position.length() < 0.05, 'pet eases back into motion after repeated hull rejections');
const stopFarAway = leftBehind.position.clone();
assert.equal(leftBehind.update(1 / 60, traveler, 1.8), false);
assert.deepEqual(leftBehind.position.toArray(), stopFarAway.toArray(), 'distant pets stop when their owners do');

const descent = createPetMotion(position => { position.y = 0; });
const fallingOwner = new Vector3(0, 1.8, 0);
descent.update(0.05, fallingOwner, 1.8);
for (let i = 0; i < 4; i++) {
  // Terminal fall plus sprint on a capped frame is still normal movement.
  fallingOwner.add(new Vector3(0, -2, -0.8));
  assert.equal(descent.update(0.05, fallingOwner, 1.8), false, 'falling below a stuck pet is not an owner warp');
}

// Put a wall between the owner and trailing offset; the capsule must remain on the owner's side.
const geometry = new BoxGeometry(8, 5, 0.1);
geometry.translate(0, 1, 0.75);
const wall = new Mesh(geometry, new MeshBasicMaterial());
const collision = createPetCollision(new MeshBVH(wall.geometry));
const blocked = createPetMotion(collision);
player.set(0, 1.8, 0);
for (let i = 0; i < 180; i++) blocked.update(1 / 60, player, 1.8);
assert.ok(blocked.position.z <= 0.21, `double-size pet crossed wall: ${blocked.position.z}`);
for (let i = 0; i < 12; i++) {
  player.z -= 0.1;
  blocked.update(1 / 60, player, 1.8);
  assert.ok(blocked.position.z <= 0.21, 'a moving pet remains on the owner’s side of the wall');
}
const settled = blocked.position.clone();
for (let i = 0; i < 60; i++) blocked.update(1 / 60, player, 1.8);
assert.deepEqual(blocked.position.toArray(), settled.toArray(), 'a blocked pet does not inch along the wall while the owner is idle');
const clearance = new Box3(new Vector3(-0.3, 0.02, -0.3), new Vector3(0.3, 0.8, 0.3));
const transform = new Matrix4().makeTranslation(0, 0, 0.45);
assert.equal(collision.blocked?.(clearance, transform), true, 'animated envelope crosses the wall even when the capsule stops');
assert.equal(collision.blocked?.(clearance, transform.setPosition(0, 0, 0.2)), false, 'clear placement');
const muzzle = new Vector3(0, 0.4, 0.2);
assert.equal(collision.beamRange?.(muzzle, new Vector3(0, 0, -1), 2), 2, 'beam keeps its open-air range');
assert.ok(Math.abs((collision.beamRange?.(muzzle, new Vector3(0, 0, 1), 2) ?? 2) - 0.495) < 1e-5, 'beam ends just before the wall');
assert.equal(collision.beamRange?.(muzzle, new Vector3(0, 0, 1), 0.2), 0.2, 'short animated beam does not reach the wall');
geometry.dispose();
wall.material.dispose();
console.log('pet diagonal lane, reversal, stop, blocked-pet continuity, portal, frame rates and wall collision tests ok');
