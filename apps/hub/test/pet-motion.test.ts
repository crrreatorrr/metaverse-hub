import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createPetMotion } from '../src/core/pet-motion';
import { createPetCollision } from '../src/core/pet-collision';

const player = new Vector3(0, 1.8, 0);
const pet = createPetMotion();
for (let i = 0; i < 120; i++) pet.update(1 / 60, player, 1.8);
assert.ok(Math.abs(pet.position.z - 1.5) < 0.01, 'settles at 1.5 m offset');
const retainedPosition = pet.position;
player.z = -0.1;
pet.update(1 / 60, player, 1.8);
assert.ok(pet.speed > 0);
assert.equal(pet.position, retainedPosition, 'mutates its preallocated position');
player.set(80, -298.2, 100);
pet.update(1 / 60, player, 1.8);
assert.ok(pet.position.distanceTo(new Vector3(80, -300, 100)) < 1.6, 'portal snap');
pet.update(5, player, 1.8);
assert.ok(Number.isFinite(pet.position.x), 'long frames remain stable');

// Put a wall between the owner and trailing offset; the capsule must remain on the owner's side.
const geometry = new BoxGeometry(8, 5, 0.1);
geometry.translate(0, 1, 0.75);
const wall = new Mesh(geometry, new MeshBasicMaterial());
const collision = createPetCollision(new MeshBVH(wall.geometry));
const blocked = createPetMotion(collision);
player.set(0, 1.8, 0);
for (let i = 0; i < 180; i++) blocked.update(1 / 60, player, 1.8);
assert.ok(blocked.position.z <= 0.46, `pet crossed wall: ${blocked.position.z}`);
geometry.dispose();
wall.material.dispose();
console.log('pet follow easing, portal and wall collision tests ok');
