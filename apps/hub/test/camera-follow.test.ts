import assert from 'node:assert/strict';
import { PlaneGeometry } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createCameraFollow } from '../src/core/camera-follow';
import { MOVEMENT } from '../src/core/movement';
import { STAND_Y, createPlayerController } from '../src/physics';

const floor = new PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2);
const bvh = new MeshBVH(floor);
const speeds = { walk: MOVEMENT.walk, sprint: MOVEMENT.sprint };
const delta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// Large reversals ease in, stay below 65 degrees/second, and remain slower than ordinary
// turns. Measure the whole motion at several frame rates, including acceleration and arrival.
for (const hz of [30, 60, 120]) {
  const follow = createCameraFollow();
  let yaw = 0;
  let previousSpeed = 0;
  let atOneSecond = 0;
  for (let frame = 1; frame <= hz * 6; frame++) {
    const next = follow.step(1 / hz, yaw, Math.PI, true);
    const speed = (next - yaw) * hz;
    assert.ok(next >= yaw && next <= Math.PI, 'reversal moves steadily toward the target without overshooting');
    assert.ok(speed <= 65 * Math.PI / 180, 'reverse turn has a comfortable speed limit');
    if (frame <= hz / 10) assert.ok(speed >= previousSpeed, 'reversal eases into motion');
    if (frame === hz / 10) assert.ok(next < 5 * Math.PI / 180, 'first 100 ms does not whip around');
    if (frame === hz) atOneSecond = next;
    previousSpeed = speed;
    yaw = next;
  }
  assert.ok(atOneSecond > Math.PI / 6 && atOneSecond < Math.PI * 65 / 180, '180-degree turn stays slow through the first second');
  assert.ok(Math.abs(yaw - Math.PI) < 0.001, 'slower reversal still settles on the target');
  const normal = createCameraFollow();
  let normalYaw = 0;
  for (let frame = 0; frame < hz; frame++) normalYaw = normal.step(1 / hz, normalYaw, Math.PI / 2, true);
  assert.ok(normalYaw > Math.PI / 3 && normalYaw < Math.PI / 2, 'ordinary turns stay responsive and ease toward arrival');
  assert.ok(normalYaw > atOneSecond, 'ordinary turns are faster than reversing');
}

// A recenter also eases around while standing still. Manual look cancels it, and a warp
// clears its accumulated velocity so the next view cannot inherit a leftover turn.
{
  const follow = createCameraFollow();
  follow.recenter();
  let yaw = follow.step(1 / 60, 0, Math.PI, false);
  assert.ok(yaw > 0 && yaw < 0.01, 'recenter starts smoothly instead of snapping 180 degrees');
  for (let frame = 1; frame < 360; frame++) yaw = follow.step(1 / 60, yaw, Math.PI, false);
  assert.ok(Math.abs(yaw - Math.PI) < 0.001, 'idle recenter reaches the avatar heading');
  follow.recenter();
  yaw = follow.step(0.2, yaw, 0, false);
  follow.manualLook(0.1);
  assert.equal(follow.step(1, yaw, 0, false), yaw, 'manual orbit cancels an idle recenter');
  follow.reset();
  assert.equal(follow.step(1 / 60, 0, 0, true), 0, 'warp reset clears angular momentum');
}

// Tiny analog fluctuations around directly backward keep the chosen orbit direction.
{
  const follow = createCameraFollow();
  let yaw = 0;
  for (let frame = 0; frame < 60; frame++) {
    const next = follow.step(1 / 60, yaw, Math.PI + (frame % 2 ? 0.0005 : -0.0005), true);
    assert.ok(next > yaw, 'backward stick jitter cannot reverse the camera orbit');
    yaw = next;
  }
}

// Run the real capsule and camera together. Holding any direction must stay on a straight
// course while the camera catches up, including reverse, diagonals, and the +/- pi seam.
for (const initialYaw of [0, Math.PI - 0.1]) {
  for (const [forward, strafe] of [[1, 0], [0, 1], [0, -1], [-1, 0], [1, 1], [-1, -1]]) {
    const finalYaws: number[] = [];
    for (const hz of [30, 60, 120]) {
      const player = createPlayerController(bvh);
      const follow = createCameraFollow();
      player.spawn(0, STAND_Y, 0, initialYaw);
      let yaw = initialYaw;
      const target = initialYaw + Math.atan2(strafe, forward);
      for (let frame = 0; frame < hz * 6; frame++) {
        const input = { forward, strafe, yaw: follow.movementYaw(yaw, forward, strafe), sprint: false, jump: false };
        player.step(1 / hz, input, speeds);
        yaw = follow.step(1 / hz, yaw, player.facingYaw, true);
      }
      assert.ok(Math.abs(delta(yaw, target)) < 0.001, `camera follows ${forward},${strafe} at ${hz} Hz`);
      assert.ok(Math.abs(player.position.x - Math.sin(target) * MOVEMENT.walk * 6) < 0.001, 'held input keeps its world heading');
      assert.ok(Math.abs(player.position.z + Math.cos(target) * MOVEMENT.walk * 6) < 0.001, 'automatic orbit does not steer the capsule');
      finalYaws.push(yaw);

      const facing = player.facingYaw;
      player.step(1 / hz, { forward: 0, strafe: 0, yaw: yaw + 1, sprint: false, jump: false }, speeds);
      assert.equal(player.facingYaw, facing, 'stopping preserves body facing while the camera can orbit');
      assert.equal(follow.step(1 / hz, yaw, facing, false), yaw, 'stopped or blocked movement does not orbit');
    }
    assert.ok(Math.abs(finalYaws[0] - finalYaws[2]) < 1e-10, 'follow is frame-rate independent');
  }
}

// A new direction is read against the current view; slight analog jitter or a speed change
// must not repeatedly recapture the rotating view and introduce a steering feedback loop.
{
  const follow = createCameraFollow();
  assert.equal(follow.movementYaw(0, 0, 1), 0);
  assert.equal(follow.movementYaw(0.8, 0.01, 0.5), 0, 'analog jitter keeps the original basis');
  assert.equal(follow.movementYaw(0.8, 1, 0, { forward: 1, strafe: 0 }), 0.8, 'a digital direction change uses the new view');
  assert.equal(follow.movementYaw(1, 1, 0.1, { forward: 1, strafe: 0 }), 0.8, 'analog input mixed with a held key does not recapture the view');
  follow.movementYaw(1, 0, 0);
  assert.equal(follow.movementYaw(1, 1, 0), 1, 'starting again uses the current view');
  follow.reset();
  assert.equal(follow.movementYaw(-2, 1, 0), -2, 'warps and recenters discard the old basis');
}

// Gradually sweep an analog stick after the camera has caught up to a side run. Crossing
// any input angle must stay continuous, including crossing the +/- pi seam on the stick.
for (const start of [Math.PI / 2, -Math.PI + 0.1]) {
  const follow = createCameraFollow();
  follow.movementYaw(0, Math.cos(start), Math.sin(start));
  let yaw = follow.step(2, 0, start, true);
  let previousHeading = start;
  for (let step = 1; step <= 400; step++) {
    const direction = start - step * 0.01;
    const forward = Math.cos(direction);
    const strafe = Math.sin(direction);
    const basis = follow.movementYaw(yaw, forward, strafe);
    const heading = basis + direction;
    assert.ok(Math.abs(delta(previousHeading, heading)) < 0.011, 'gradual analog turn cannot jump with auto-follow');
    yaw = follow.step(1 / 60, yaw, heading, true);
    previousHeading = heading;
  }
}

// Manual look has priority during movement, then auto-follow resumes smoothly after the
// grace period. Holding the camera stick continually refreshes that grace period.
{
  const follow = createCameraFollow();
  follow.movementYaw(0, 0, 1);
  follow.manualLook(-1);
  assert.equal(follow.movementYaw(-1, 0, 1), -1, 'manual look steers with the camera');
  assert.equal(follow.step(0.5, -1, 1, true), -1, 'manual look suppresses follow');
  follow.manualLook(-1);
  assert.equal(follow.step(0.5, -1, 1, true), -1, 'continued manual input keeps priority');
  assert.equal(follow.step(0, -1, 1, true), -1, 'zero delta does not move the camera');
  const resumed = follow.step(0.5, -1, 1, true);
  assert.ok(resumed > -1 && resumed < 1, 'follow eases back without snapping');
  follow.reset();
  assert.ok(follow.step(1 / 60, -1, 1, true) > -1, 'reset clears the manual grace period');
}

// Looking vertically and recentering during an auto-followed side/backward run must not
// redirect the capsule. Manual yaw adds only the requested turn, without the automatic orbit.
for (const [forward, strafe] of [[0, 1], [-1, 0]]) {
  const follow = createCameraFollow();
  follow.movementYaw(0, forward, strafe);
  const facing = Math.atan2(strafe, forward);
  const yaw = follow.step(2, 0, facing, true);
  follow.manualLook(0);
  assert.equal(follow.movementYaw(yaw, forward, strafe), 0, 'pitch-only look preserves travel direction');
  follow.manualLook(0.1);
  assert.equal(follow.movementYaw(yaw + 0.1, forward, strafe), 0.1, 'manual yaw turns movement by just the requested amount');
  follow.recenter();
  assert.equal(follow.movementYaw(facing + 0.1, forward, strafe), 0.1, 'recenter preserves held movement');
}

floor.dispose();
console.log('camera follow: straight movement, turns, frame rates, idle facing, and manual override passed');
