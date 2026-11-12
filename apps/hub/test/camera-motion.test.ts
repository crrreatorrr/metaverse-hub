import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createCameraArm, createCameraPitch, createCameraPreview, createCameraTarget } from '../src/core/camera-motion';

for (const hz of [30, 60, 120]) {
  const dt = 1 / hz;
  const target = new Vector3();
  const focus = createCameraTarget();
  let previous = focus.step(0, target).clone();
  let previousVelocity = new Vector3();
  let rawVelocity = new Vector3();
  let maxAcceleration = 0;
  let maxRawAcceleration = 0;
  for (let frame = 0; frame < hz * 4; frame++) {
    const speed = Math.floor(frame / hz / 0.12) % 2 ? -16 : 16;
    target.x += speed * dt;
    const next = focus.step(dt, target).clone();
    const velocity = next.clone().sub(previous).divideScalar(dt);
    maxAcceleration = Math.max(maxAcceleration, velocity.clone().sub(previousVelocity).length() / dt);
    const nextRaw = new Vector3(speed, 0, 0);
    maxRawAcceleration = Math.max(maxRawAcceleration, nextRaw.clone().sub(rawVelocity).length() / dt);
    assert.ok(next.distanceTo(target) < 3, 'smoothed focus keeps the player close to the centre of view');
    previous = next;
    previousVelocity = velocity;
    rawVelocity = nextRaw;
  }
  assert.ok(maxAcceleration < maxRawAcceleration * 0.2, 'sprint zigzags substantially reduce camera acceleration');
  for (let frame = 0; frame < hz * 2; frame++) focus.step(dt, target);
  assert.ok(focus.step(0, target).distanceTo(target) < 0.001, 'focus settles after stopping');
  focus.reset();
  const warp = new Vector3(70, -300, 20);
  assert.ok(focus.step(dt, warp).equals(warp), 'warps reset focus without sweeping across the map');

  const pitch = createCameraPitch();
  pitch.queue(100);
  let angle = 0;
  for (let frame = 0; frame < hz * 3; frame++) {
    const turn = pitch.step(dt);
    assert.ok(Math.abs(turn) / dt < 0.86, 'a pitch spike cannot rotate the camera at unlimited speed');
    angle += turn;
  }
  assert.ok(Math.abs(angle - 0.2) < 0.001, 'large pitch input has a bounded queue and settles');
  pitch.recenter(-0.7);
  assert.ok(Math.abs(pitch.step(dt)) < 0.01, 'pitch recenter starts gently');
  let centered = 0;
  for (let frame = 1; frame < hz * 4; frame++) centered += pitch.step(dt);
  assert.ok(Math.abs(centered + 0.7) < 0.01, 'pitch recenter reaches its full target');
  pitch.queue(1);
  pitch.reset();
  assert.equal(pitch.step(1), 0, 'menu and warp resets discard buffered look');

  for (const boundary of [-0.42, 1.05]) {
    const bounded = createCameraPitch();
    let angle = boundary;
    for (let frame = 0; frame < hz * 3; frame++) {
      bounded.queue(boundary > 0 ? 0.1 : -0.1);
      angle += bounded.step(dt, -0.42 - angle, 1.05 - angle);
    }
    assert.equal(angle, boundary, 'held input cannot accumulate rotation beyond the pitch limit');
    bounded.recenter(0.28 - angle);
    for (let frame = 0; frame < hz * 5; frame++) angle += bounded.step(dt, -0.42 - angle, 1.05 - angle);
    assert.ok(Math.abs(angle - 0.28) < 0.001, 'recenter reaches the correct pitch after pushing against a limit');
  }

  const arm = createCameraArm();
  assert.equal(arm.step(dt, 0.1), 0.1, 'wall clearance retracts immediately');
  assert.ok(arm.step(dt, 1) < 0.2, 'clearing a wall does not snap the arm back out');
  for (let frame = 0; frame < hz * 2; frame++) arm.step(dt, 1);
  assert.ok(arm.step(dt, 1) > 0.99, 'camera arm returns smoothly to full length');
  arm.reset();
  assert.equal(arm.step(dt, 1), 1, 'warps reset the arm at the new location');

  const preview = createCameraPreview();
  preview.open(0);
  for (let frame = 0; frame < hz * 5; frame++) preview.step(dt, true);
  let previousYaw = preview.yaw(0);
  for (let frame = 0; frame < hz * 5; frame++) {
    preview.step(dt, false);
    // Play heading crosses the pi branch while the preview is still leaving.
    const playYaw = -frame * dt * 0.75;
    const next = preview.yaw(playYaw);
    const change = Math.atan2(Math.sin(next - previousYaw), Math.cos(next - previousYaw));
    assert.ok(Math.abs(change) / dt < 2.3, 'menu exit remains bounded across play-heading changes and angle seams');
    previousYaw = next;
    if (frame === hz / 2) preview.open(Math.PI / 2);
  }
  preview.reset();
  assert.equal(preview.yaw(-2), -2, 'warp clears the preview orbit');
}


// D7: vertical look. The plaza's original sense is inverted and stays the default; the switch flips it.
{
  const { lookVertical, parseInvertLook } = await import('../src/core/look-settings');
  assert.equal(parseInvertLook(null), true, 'default keeps the original inverted sense');
  assert.equal(parseInvertLook('1'), true);
  assert.equal(parseInvertLook('0'), false);
  assert.equal(lookVertical(0.25, true), 0.25, 'inverted passes the input through unchanged');
  assert.equal(lookVertical(0.25, false), -0.25, 'standard flips it');
  assert.equal(lookVertical(-0.5, false), 0.5);
  assert.equal(lookVertical(0, true), 0);
}

console.log('camera motion: reduced positional jolts, bounded pitch, smooth arm recovery, and warp resets passed');
