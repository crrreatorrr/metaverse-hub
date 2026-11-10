import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { AnimationMixer, BoxGeometry, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH } from 'three-mesh-bvh';
import { MOVEMENT } from '../src/core/movement';
import { buildPlazaCollider } from '../src/realms/plaza/plaza-collider';
import { CAPSULE_LENGTH, CAPSULE_RADIUS, STAND_Y, createPlayerController } from '../src/physics';
import { createFlightTurn } from '../src/rig/flight-turn';
import { AVATAR_SCALE, CAMERA_ARM, CAMERA_FOV, SPRINT_SPEED, WALK_SPEED } from '../src/config';
import { loadGLB } from './support/load-glb';

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
// Input can be delivered on a frame whose timer has been reset.
player.step(0, { ...idle, jump: true }, speeds);
assert.ok(Math.abs(player.position.y - restY) < 0.02, 'zero delta does not integrate motion');
player.step(1 / 60, idle, speeds);
assert.ok(player.position.y > restY + 0.08, 'zero-delta jump still launches on the next frame');

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
// Floor support must use the absolute contact height. A preceding wall
// push can otherwise be counted a second time and cause a tiny false takeoff.
for (const hz of [20, 60, 120]) {
  const yaw = 5 * Math.PI / 4;
  player.spawn(-14, clubFloor, 13, yaw);
  for (let i = 0; i < 2 * hz; i++) {
    player.step(1 / hz, { ...idle, forward: 1, sprint: true, yaw }, speeds);
    if (i >= hz) {
      assert.ok(player.grounded && Math.abs(player.position.y - clubFloor) < 0.01, `club corner stays grounded at ${hz} Hz`);
    }
  }
  player.step(1 / hz, { ...idle, jump: true, yaw }, speeds);
  assert.ok(!player.grounded && player.velocity.y > 0, `club corner accepts jump at ${hz} Hz`);
}
player.spawn(-13, clubFloor, 12, 3.5);
const alongBackWall = { ...idle, forward: 1, sprint: true, yaw: 3.5 };
for (let i = 0; i < 120; i++) player.step(1 / 60, alongBackWall, speeds);
player.step(1 / 60, { ...alongBackWall, jump: true }, speeds);
assert.ok(!player.grounded && player.velocity.y > 0, 'back wall contact does not swallow the sprint-jump');
for (const hz of [20, 60, 120]) {
  player.spawn(2.333, clubFloor, 7.75);
  for (let frame = 0; frame < 2 * hz; frame++) {
    player.step(1 / hz, { ...idle, forward: frame / hz < 0.21 ? -1 : 0, jump: frame === 0 }, speeds);
  }
  assert.ok(player.grounded && Math.abs(player.position.y - clubFloor - 0.86) < 0.01, `club stool still catches a jump at ${hz} Hz`);
}
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

// A vertical mesh can touch the capsule cap at its top edge without
// supplying a floor. A platform at the same height must still support it.
const edgeHeight = 1.5;
const edgePieces = [
  new BoxGeometry(20, 1, 20).translate(0, -0.5, 0),
  new PlaneGeometry(8, edgeHeight).rotateY(Math.PI / 2).translate(0, edgeHeight / 2, 0),
  new BoxGeometry(2, edgeHeight, 2).translate(0, edgeHeight / 2, 6),
];
const edges = mergeGeometries(edgePieces);
for (const geometry of edgePieces) geometry.dispose();
const falling = createPlayerController(new MeshBVH(edges));
for (const hz of [20, 60, 120]) {
  for (const x of [-0.2, 0, 0.2]) {
    falling.spawn(x, STAND_Y + 3, 0);
    for (let frame = 0; frame < hz; frame++) {
      falling.step(1 / hz, idle, speeds);
      assert.ok(!falling.grounded || falling.position.y <= STAND_Y + 0.01, `vertical edge cannot be a floor at ${hz} Hz`);
    }
    assert.ok(falling.grounded && Math.abs(falling.position.y - STAND_Y) < 0.01, `fall beside edge lands at ${hz} Hz`);
  }
  falling.spawn(0, STAND_Y + 3, 6);
  for (let frame = 0; frame < hz; frame++) falling.step(1 / hz, idle, speeds);
  assert.ok(falling.grounded && Math.abs(falling.position.y - STAND_Y - edgeHeight) < 0.01, `solid platform supports landing at ${hz} Hz`);
}
edges.dispose();

// A capsule can also balance between two upward surfaces. Neither edge
// alone pushes mostly upward, but together they support a jump.
const halfGap = 0.39;
const splitPieces = [
  new BoxGeometry(20, 1, 20).translate(0, -0.5, 0),
  ...[-1, 1].map(side => new PlaneGeometry(2, 8).rotateX(-Math.PI / 2).translate(side * (1 + halfGap), edgeHeight, 0)),
];
const splitFloor = mergeGeometries(splitPieces);
for (const geometry of splitPieces) geometry.dispose();
const balanced = createPlayerController(new MeshBVH(splitFloor));
for (const hz of [20, 60, 120]) {
  balanced.spawn(0, STAND_Y + 3, 0);
  for (let frame = 0; frame < 2 * hz; frame++) balanced.step(1 / hz, idle, speeds);
  assert.ok(balanced.grounded && balanced.position.y > STAND_Y + 1, `two floor edges jointly support the capsule at ${hz} Hz`);
  balanced.step(1 / hz, { ...idle, jump: true }, speeds);
  assert.ok(!balanced.grounded && balanced.velocity.y > 0, `joint support accepts a jump at ${hz} Hz`);
}
splitFloor.dispose();

const flyer = await loadGLB(fileURLToPath(new URL('../public/world/v2/avatar/flyer.glb', import.meta.url)));
const idleClip = flyer.animations.find((clip) => clip.name === 'idle');
const flightClip = flyer.animations.find((clip) => clip.name === 'run');
const jumpClip = flyer.animations.find((clip) => clip.name === 'jump');
const hips = flyer.scene.getObjectByName('Hips');
assert.ok(hips && idleClip && flightClip && jumpClip, 'Flying Midget has a dedicated jump');
const mixer = new AnimationMixer(flyer.scene);
mixer.clipAction(idleClip).play();
mixer.setTime(0);
const idleHips = hips.getWorldPosition(new Vector3());
mixer.stopAllAction();
mixer.clipAction(flightClip).play();
mixer.setTime(0);
const flightHips = hips.getWorldPosition(new Vector3());
assert.ok(Math.hypot(flightHips.x - idleHips.x, flightHips.z - idleHips.z) < 0.025, 'idle and flight share the horizontal origin');
mixer.stopAllAction();
mixer.clipAction(jumpClip).play();
mixer.setTime(jumpClip.duration * 0.15);
const inverseTakeoff = hips.quaternion.clone().invert();
const relative = new Quaternion();
const up = new Vector3();
let previousPitch = 0;
let turn = 0;
for (let step = 1; step <= 60; step++) {
  mixer.setTime(jumpClip.duration * (0.15 + 0.7 * step / 60));
  up.set(0, 1, 0).applyQuaternion(relative.copy(hips.quaternion).multiply(inverseTakeoff));
  const pitch = Math.atan2(up.z, up.y);
  const delta = pitch - previousPitch;
  turn += Math.atan2(Math.sin(delta), Math.cos(delta));
  previousPitch = pitch;
}
assert.ok(Math.abs(turn + 2 * Math.PI) < 0.08, 'Flying Midget completes one backward turn before the landing blend');
mixer.stopAllAction();

for (const hz of [30, 60, 120]) {
  const dt = 1 / hz;
  const flight = createFlightTurn();
  let phase = 0;
  for (let frame = 0; frame < Math.ceil(0.38 * hz); frame++) {
    // Remote vertical speed can hold and then step at a snapshot boundary.
    const vy = frame * dt < 0.2 ? 2.5 : -2.5;
    const next = flight.update({ dt, airborne: true, remote: true }, vy);
    assert.ok(next >= phase);
    phase = next;
  }
  assert.equal(phase, 1, `a remote flight completes the turn before landing at ${hz} Hz`);
  assert.ok(flight.update({ dt, airborne: true, remote: true, restart: true }, 2.5) < 0.2, 'a new remote takeoff restarts the turn');
  assert.equal(flight.update({ dt, airborne: false }, 0), 0);
  const takeoff = flight.update({ dt, airborne: true }, MOVEMENT.jump);
  assert.equal(flight.update({ dt, airborne: true }, 0), takeoff, `early ceiling contact stops the turn at ${hz} Hz`);
  assert.equal(flight.update({ dt, airborne: true }, -1), takeoff);
  assert.equal(flight.update({ dt, airborne: false }, 0), 0);
  assert.equal(flight.update({ dt, airborne: true }, -1), 0, 'walking off an edge does not start a backflip');
}
