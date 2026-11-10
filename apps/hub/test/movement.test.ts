import assert from 'node:assert/strict';
import { BoxGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { MOVEMENT } from '../src/core/movement';
import { buildPlazaCollider } from '../src/realms/plaza/plaza-collider';
import { CAPSULE_LENGTH, CAPSULE_RADIUS, STAND_Y, createPlayerController } from '../src/physics';
import { AVATAR_SCALE, CAMERA_ARM, CAMERA_FOV, SPRINT_SPEED, WALK_SPEED } from '../src/config';

assert.deepEqual(MOVEMENT, {
  gravity: -28, jump: 6.4, terminal: -40, walk: 7.8, sprint: 16,
  cameraArm: 7.6, fov: 78, yawRate: 1.8, pitchRate: 1.15,
  mouseYaw: 0.0017, mousePitch: 0.0014, pitchMin: -0.42, pitchMax: 1.05,
  armMin: 1.25, armOffset: 0.28, capsuleRadius: 0.34, capsuleLength: 1.08,
  bodyReference: 1.75, bodyScale: 1.25, standHeight: 0.34 * 1.25 + 1.08 * 1.25,
  initialPitch: 0.28, lookDrop: 0.15,
}, 'movement_values_are_locked');
assert.ok(Object.isFrozen(MOVEMENT));
assert.equal(CAPSULE_RADIUS, MOVEMENT.capsuleRadius * MOVEMENT.bodyScale);
assert.equal(CAPSULE_LENGTH, MOVEMENT.capsuleLength * MOVEMENT.bodyScale);
assert.equal(STAND_Y, MOVEMENT.standHeight);
assert.ok(Math.abs(STAND_Y - 1.775) < 1e-12);
assert.deepEqual([WALK_SPEED, SPRINT_SPEED, CAMERA_ARM, CAMERA_FOV, AVATAR_SCALE], [7.8, 16, 7.6, 78, 1.25]);
const collider = buildPlazaCollider();
const player = createPlayerController(collider.bvh);
const speeds = { walk: MOVEMENT.walk, sprint: MOVEMENT.sprint };
const idle = { forward: 0, strafe: 0, sprint: false, jump: false, yaw: 0 };
player.spawn(0, STAND_Y + 1.5, 42);
for (let i = 0; i < 120; i++) player.step(1 / 60, idle, speeds);
const restY = player.position.y;
assert.ok(Math.abs(restY - STAND_Y) < 0.08, `capsule_rests_on_live_plaza_collider: ${restY}`);
for (let i = 0; i < 30; i++) player.step(1 / 60, idle, speeds);
assert.ok(Math.abs(player.position.y - restY) < 0.02);
let peak = restY;
for (let i = 0; i < 50; i++) {
  player.step(1 / 60, { ...idle, jump: i === 0 }, speeds);
  peak = Math.max(peak, player.position.y);
}
assert.ok(peak > restY + 0.4 && peak < restY + 1.6, `jump band: ${peak - restY}`);
for (let direction = 0; direction < 1; direction++) {
  const yaw = direction * Math.PI / 4;
  player.spawn(Math.sin(yaw) * 42, STAND_Y, -Math.cos(yaw) * 42, yaw);
  for (let i = 0; i < 1500; i++) player.step(1 / 60, { ...idle, forward: 1, sprint: true, yaw }, speeds);
  assert.ok(Math.hypot(player.position.x, player.position.z) > 290, `reached edge: ${direction}`);
  assert.ok(Math.hypot(player.position.x, player.position.z) < 320, `edge wall: ${direction}`);
}
// The club wall has triangulated seams where a side contact can point
// upward. A sprint-jump into the back wall must settle on the club floor.
const clubFloor = -300 + STAND_Y;
const clubYaw = 3.68;
player.spawn(4.15, clubFloor, 12.13, clubYaw);
let clubPeak = clubFloor;
for (let i = 0; i < 40; i++) {
  player.step(1 / 20, { ...idle, forward: 1, sprint: true, jump: i === 0, yaw: clubYaw }, speeds);
  clubPeak = Math.max(clubPeak, player.position.y);
}
assert.ok(clubPeak > clubFloor + 0.4 && clubPeak < clubFloor + 0.9, `club wall jump peak: ${clubPeak}`);
assert.ok(player.grounded && Math.abs(player.position.y - clubFloor) < 0.01, `club wall landing: ${player.position.y}`);
collider.geometry.dispose();
console.log('locked movement and live plaza capsule ok', { restY, jump: peak - restY });

// Sprint into a wall, then jump through the low passage at several frame rates.
const ceiling = 2.48;
const wall = 2;
const pieces = [
  new BoxGeometry(20, 1, 20).translate(0, -0.5, 0),
  new BoxGeometry(10, 0.2, 10).translate(0, ceiling + 0.1, 0),
  new BoxGeometry(1, 4, 20).translate(wall + 0.5, 2, 0),
];
const passage = mergeGeometries(pieces);
for (const geometry of pieces) geometry.dispose();
const indoors = createPlayerController(new MeshBVH(passage));
for (const hz of [20, 60, 120]) {
  const dt = 1 / hz;
  indoors.spawn(0, STAND_Y, 0);
  const towardWall = { ...idle, strafe: 1, sprint: true };
  for (let i = 0; i < hz; i++) indoors.step(dt, towardWall, speeds);
  assert.ok(Math.abs(indoors.position.x - (wall - CAPSULE_RADIUS)) < 0.01, `wall contact at ${hz} Hz`);
  assert.ok(Math.abs(indoors.position.y - STAND_Y) < 0.01, `wall does not lift capsule at ${hz} Hz`);
  let maxTop = 0;
  for (let i = 0; i < hz; i++) {
    indoors.step(dt, { ...idle, strafe: -0.25, jump: i === 0 }, speeds);
    maxTop = Math.max(maxTop, indoors.position.y + CAPSULE_RADIUS);
  }
  assert.ok(maxTop > ceiling - 0.1 && maxTop <= ceiling + 0.001, `jump meets the ceiling at ${hz} Hz: ${maxTop}`);
  assert.ok(indoors.grounded && Math.abs(indoors.position.y - STAND_Y) < 0.01, `jump lands at ${hz} Hz`);
}
passage.dispose();
console.log('capsule wall, ceiling, and landing contacts ok at 20/60/120 Hz');
