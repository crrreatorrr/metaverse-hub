import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { CLUB_COLLIDERS, CLUB_MARKERS } from '../src/realms/plaza/club-interior-colliders';
import { CLUB_INTERIOR_SCALE, SCALED_CLUB_COLLIDERS, scaleClubPoint } from '../src/realms/plaza/club-interior-scale';
import { ARCADE_RETURN, atArcade } from '../src/realms/plaza/arcade-layout';
import { SPROTEL_INTERACT_RADIUS, createSprotelController } from '../src/realms/plaza/sprotel-npc';
import { buildPlazaCollider } from '../src/realms/plaza/plaza-collider';
import { CAPSULE_RADIUS, STAND_Y, createPlayerController } from '../src/physics';
import { MOVEMENT } from '../src/core/movement';

const close = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual}`);
const box = (name: string) => SCALED_CLUB_COLLIDERS.find(box => box.name === name)!;
close(box('wall_left').min[0] - box('wall_right').max[0], 26, 'room width');
close(box('wall_back').min[2], 18.2, 'room depth');
close(box('ceiling').min[1], 6.76, 'room height');
const sourceNpc = CLUB_COLLIDERS.find(box => box.npc)!;
const npcBox = box('sprotel_npc');
for (let axis = 0; axis < 3; axis++) {
  close(npcBox.max[axis] - npcBox.min[axis], sourceNpc.max[axis] - sourceNpc.min[axis], 'Sprotel collider keeps its size');
}
const spot = scaleClubPoint(CLUB_MARKERS.barman_spot.pos);
close((npcBox.min[0] + npcBox.max[0]) / 2, spot[0], 'NPC collider follows the barman marker');
close((npcBox.min[2] + npcBox.max[2]) / 2, spot[2], 'NPC collider follows the barman marker');

// The trigger must still reach across the enlarged counter while the actor stays native size.
const room = new Group();
room.scale.setScalar(CLUB_INTERIOR_SCALE);
const anchor = new Group();
anchor.position.set(...CLUB_MARKERS.barman_spot.pos);
anchor.scale.setScalar(1 / CLUB_INTERIOR_SCALE);
room.add(anchor);
const npc = new Group();
anchor.add(npc);
const sprotel = createSprotelController(npc, [], 'idle', SPROTEL_INTERACT_RADIUS * CLUB_INTERIOR_SCALE);
const walkup = new Vector3(...scaleClubPoint(CLUB_MARKERS.store_walkup.pos));
sprotel.update(1 / 60, walkup, false);
assert.ok(sprotel.playerNear, 'Sprotel is reachable from the enlarged walk-up spot');
assert.ok(npc.getWorldScale(new Vector3()).distanceTo(new Vector3(1, 1, 1)) < 1e-10, 'NPC body retains native world scale');
const outside = new Vector3(...spot).add(new Vector3(sprotel.interactRadius + 0.1, 0, 0));
sprotel.update(1 / 60, outside, false);
assert.ok(!sprotel.playerNear, 'interaction remains bounded');

// Exercise the actual plaza BVH in the added floor space, at multiple frame rates.
const collider = buildPlazaCollider();
const speeds = { walk: MOVEMENT.walk, sprint: MOVEMENT.sprint };
const idle = { forward: 0, strafe: 0, sprint: false, jump: false, yaw: 0 };
for (const hz of [30, 60, 120]) {
  const player = createPlayerController(collider.bvh);
  const floor = -300 + STAND_Y;
  player.spawn(5.6, floor, 4);
  for (let frame = 0; frame < hz; frame++) player.step(1 / hz, idle, speeds);
  assert.ok(player.grounded && Math.abs(player.position.y - floor) < 0.01, 'added floor supports the player');
  for (let frame = 0; frame < hz; frame++) player.step(1 / hz, { ...idle, strafe: 1, sprint: true }, speeds);
  assert.ok(Math.abs(player.position.x - (6.5 - CAPSULE_RADIUS)) < 0.02, 'expanded side wall stops the player');
  player.spawn(5.9, floor, 14);
  for (let frame = 0; frame < hz; frame++) player.step(1 / hz, { ...idle, forward: -1, sprint: true }, speeds);
  assert.ok(Math.abs(player.position.z - (18.2 - CAPSULE_RADIUS)) < 0.02, 'expanded back wall stops the player');
  const [x, , z] = scaleClubPoint([ARCADE_RETURN.x, 0, ARCADE_RETURN.z]);
  player.spawn(x, floor, z);
  for (let frame = 0; frame < hz; frame++) player.step(1 / hz, idle, speeds);
  assert.ok(player.grounded && Math.abs(player.position.y - floor) < 0.01, 'cabinet return lands on the resized floor');
  assert.ok(atArcade(player.position.x / CLUB_INTERIOR_SCALE, player.position.z / CLUB_INTERIOR_SCALE), 'scaled return still reaches the arcade');
}
collider.geometry.dispose();
console.log('bar interior: 30% larger room, native NPC size, reachable interactions, floor and wall collisions passed');
