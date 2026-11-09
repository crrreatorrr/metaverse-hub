// Plaza controller: deadzones, latch on connect, edges, menu auto-repeat, pad switching, focus geometry.
import assert from 'node:assert/strict';
import { DEFAULT_MOVE_STICK, PAD, PAD_TUNING, createPadReader, curve, loadMoveStick, navDirection, padPrompt, radialDeadzone, stickAxes, stickClicks, type PadSnapshot } from '../src/core/gamepad';
import { pickInDirection } from '../src/core/pad-focus';

function pad(index: number, down: readonly number[] = [], axes: readonly number[] = [0, 0, 0, 0]): PadSnapshot {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 }));
  return { index, connected: true, buttons, axes };
}

// Deadzone and curve.
{
  assert.deepEqual(radialDeadzone(0.1, 0.1, 0.2), { x: 0, y: 0 });
  const full = radialDeadzone(1, 0, 0.2);
  assert.equal(full.x, 1);
  const edge = radialDeadzone(0.21, 0, 0.2);
  assert.ok(edge.x > 0 && edge.x < 0.05, 'motion starts near zero past the deadzone');
  assert.deepEqual(radialDeadzone(Number.NaN, 0.9, 0.2).x, 0);
  const curved = curve({ x: 0.5, y: 0 }, 2);
  assert.equal(curved.x, 0.25);
  assert.deepEqual(curve({ x: 0, y: 0 }, 2), { x: 0, y: 0 });
}

// Nav direction: D-pad first, then the dominant stick axis past the threshold.
{
  assert.equal(navDirection(pad(0, [PAD.DOWN])), 'down');
  assert.equal(navDirection(pad(0, [], [0.8, 0.3, 0, 0])), 'right');
  assert.equal(navDirection(pad(0, [], [0.2, -0.7, 0, 0])), 'up');
  assert.equal(navDirection(pad(0, [], [0.3, 0.3, 0, 0])), null);
}

// No pads: idle frame.
{
  const reader = createPadReader();
  const frame = reader.poll([], 0);
  assert.equal(frame.connected, false);
  assert.equal(frame.pressed(PAD.A), false);
  assert.equal(reader.poll(null, 0).connected, false);
}

// Latch on connect: A held when the pad appears (the hub's confirm) is ignored until released.
{
  const reader = createPadReader();
  let frame = reader.poll([pad(0, [PAD.A])], 0);
  assert.equal(frame.connected, true);
  assert.equal(frame.pressed(PAD.A), false);
  assert.equal(frame.held(PAD.A), false);
  frame = reader.poll([pad(0, [PAD.A])], 16);
  assert.equal(frame.pressed(PAD.A), false);
  frame = reader.poll([pad(0)], 32);
  assert.equal(frame.held(PAD.A), false);
  frame = reader.poll([pad(0, [PAD.A])], 48);
  assert.equal(frame.pressed(PAD.A), true, 'a fresh press after release counts');
  frame = reader.poll([pad(0, [PAD.A])], 64);
  assert.equal(frame.pressed(PAD.A), false, 'one edge per press');
  assert.equal(frame.held(PAD.A), true);
}

// Unplug and replug latches again.
{
  const reader = createPadReader();
  reader.poll([pad(0)], 0);
  assert.equal(reader.poll([pad(0, [PAD.MENU])], 16).pressed(PAD.MENU), true);
  assert.equal(reader.poll([null], 32).connected, false);
  assert.equal(reader.poll([pad(0, [PAD.MENU])], 48).pressed(PAD.MENU), false);
}

// Triggers use their analog value.
{
  const reader = createPadReader();
  reader.poll([pad(0)], 0);
  const light = pad(0);
  (light.buttons as { pressed: boolean; value: number }[])[PAD.RT] = { pressed: true, value: 0.2 };
  assert.equal(reader.poll([light], 16).held(PAD.RT), false);
  const firm = pad(0);
  (firm.buttons as { pressed: boolean; value: number }[])[PAD.RT] = { pressed: true, value: 0.8 };
  assert.equal(reader.poll([firm], 32).held(PAD.RT), true);
}

// Movement: D-pad overrides the stick; sticks are deadzoned.
{
  const reader = createPadReader();
  reader.poll([pad(0)], 0);
  let frame = reader.poll([pad(0, [], [0.1, 0.1, 0.05, 0])], 16);
  assert.deepEqual(frame.move, { x: 0, y: 0 });
  assert.deepEqual(frame.look, { x: 0, y: 0 });
  assert.equal(frame.active, false);
  frame = reader.poll([pad(0, [], [0, -1, 1, 0])], 32);
  assert.equal(frame.move.y, -1);
  assert.equal(frame.look.x, 1);
  assert.equal(frame.active, true);
  frame = reader.poll([pad(0, [PAD.LEFT], [0, -1, 0, 0])], 48);
  assert.deepEqual(frame.move, { x: -1, y: 0 });
}

// Menu auto-repeat: first step, wait the delay, then the rate.
{
  const reader = createPadReader();
  reader.poll([pad(0)], 0);
  assert.equal(reader.poll([pad(0, [PAD.DOWN])], 100).nav, 'down');
  assert.equal(reader.poll([pad(0, [PAD.DOWN])], 100 + PAD_TUNING.repeatDelayMs - 1).nav, null);
  assert.equal(reader.poll([pad(0, [PAD.DOWN])], 100 + PAD_TUNING.repeatDelayMs).nav, 'down');
  assert.equal(reader.poll([pad(0, [PAD.DOWN])], 100 + PAD_TUNING.repeatDelayMs + 50).nav, null);
  assert.equal(reader.poll([pad(0, [PAD.DOWN])], 100 + PAD_TUNING.repeatDelayMs + PAD_TUNING.repeatRateMs).nav, 'down');
  assert.equal(reader.poll([pad(0)], 1000).nav, null);
  assert.equal(reader.poll([pad(0, [], [0, 0.9, 0, 0])], 1016).nav, 'down', 'the stick steps menus too');
  // A latched D-pad direction does not step.
  const fresh = createPadReader();
  assert.equal(fresh.poll([pad(0, [PAD.UP])], 0).nav, null);
}

// Two pads: the one last used is read; the other pad's press switches and counts.
{
  const reader = createPadReader();
  reader.poll([pad(0), pad(1)], 0);
  assert.equal(reader.activeIndex, 0);
  const frame = reader.poll([pad(0), pad(1, [PAD.A])], 16);
  assert.equal(reader.activeIndex, 1);
  assert.equal(frame.pressed(PAD.A), true);
  reader.poll([pad(0), null], 32);
  assert.equal(reader.activeIndex, 0, 'unplugging the active pad falls back to another');
}

// Prompts.
{
  assert.equal(padPrompt('Press E · Choose a game'), 'Press A · Choose a game');
  assert.equal(padPrompt('Welcome. Press Enter to chat.'), 'Welcome. Press View to chat.');
  assert.equal(padPrompt('Press Escape'), 'Press Escape');
}

// Stick layout: the plaza walks on the right stick by default; the left-stick layout is one menu switch away.
{
  assert.equal(DEFAULT_MOVE_STICK, 'right');
  assert.equal(loadMoveStick(), 'right', 'no storage (node) falls back to the default');
  assert.deepEqual(stickAxes('right'), { move: [2, 3], look: [0, 1] });
  assert.deepEqual(stickAxes('left'), { move: [0, 1], look: [2, 3] });
  assert.deepEqual(stickClicks('right'), { move: PAD.RS, look: PAD.LS });
  assert.equal(navDirection(pad(0, [], [0, 0, 0.9, 0]), PAD_TUNING, 2), 'right', 'nav reads the stick it is told to');

  let stick: 'left' | 'right' = 'right';
  const reader = createPadReader(PAD_TUNING, { moveStick: () => stick });
  let frame = reader.poll([pad(0, [], [0, -1, 0, -1])], 0);
  assert.ok(frame.move.y < -0.9 && frame.move.x === 0, 'right stick up walks forward');
  assert.ok(frame.look.y < -0.9, 'left stick up tilts the camera');
  frame = reader.poll([pad(0, [], [1, 0, 0, 0])], 16);
  assert.equal(frame.move.x, 0, 'left stick does not walk in the right-stick layout');
  assert.ok(frame.look.x > 0.9);
  stick = 'left';
  frame = reader.poll([pad(0, [], [1, 0, 0, 0])], 32);
  assert.ok(frame.move.x > 0.9 && frame.look.x === 0, 'switching the layout applies on the next poll');

  // Menu steps follow the walking stick.
  stick = 'right';
  const nav = createPadReader(PAD_TUNING, { moveStick: () => stick });
  nav.poll([pad(0)], 0);
  assert.equal(nav.poll([pad(0, [], [0, 0, 0, 0.9])], 16).nav, 'down');
  assert.equal(nav.poll([pad(0, [], [0, 0.9, 0, 0])], 600).nav, null, 'the camera stick does not step menus');
}

// Focus geometry: a column steps down; a row steps right; nothing that way is -1.
{
  const column = [0, 1, 2].map((i) => ({ left: 0, top: i * 40, width: 100, height: 30 }));
  assert.equal(pickInDirection(column, 0, 'down'), 1);
  assert.equal(pickInDirection(column, 2, 'up'), 1);
  assert.equal(pickInDirection(column, 2, 'down'), -1);
  const grid = [
    { left: 0, top: 0, width: 50, height: 30 },
    { left: 60, top: 0, width: 50, height: 30 },
    { left: 0, top: 40, width: 50, height: 30 },
    { left: 60, top: 40, width: 50, height: 30 },
  ];
  assert.equal(pickInDirection(grid, 0, 'right'), 1);
  assert.equal(pickInDirection(grid, 0, 'down'), 2, 'straight down beats the diagonal');
  assert.equal(pickInDirection(grid, 3, 'left'), 2);
  assert.equal(pickInDirection(grid, -1, 'down'), 0);
  assert.equal(pickInDirection([], -1, 'down'), -1);
}

console.log('gamepad tests passed');

// latch(): a button held when a screen closes under it is ignored until released.
{
  const reader = createPadReader();
  reader.poll([pad(0)], 0);
  assert.equal(reader.poll([pad(0, [PAD.A])], 16).pressed(PAD.A), true);
  reader.latch();
  assert.equal(reader.poll([pad(0, [PAD.A])], 32).held(PAD.A), false, 'latched A reads up');
  reader.poll([pad(0)], 48);
  assert.equal(reader.poll([pad(0, [PAD.A])], 64).pressed(PAD.A), true, 'a fresh press counts again');
}
