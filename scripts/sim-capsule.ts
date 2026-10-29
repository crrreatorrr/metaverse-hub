import assert from 'node:assert/strict';
import { MONUMENT_RADIUS, PORTAL_DISTANCE, PORTAL_STANDOFF, PORTAL_TRIGGER_RADIUS, CURB_RADIUS } from '../apps/hub/src/config';
import { buildCollider } from '../apps/hub/src/collider';
import { spawnFor } from '../apps/hub/src/layout';
import { CAPSULE_RADIUS, STAND_Y, createPlayerController } from '../apps/hub/src/physics';
import { parseReturnGame, portalContaining, portalUrl } from '../apps/hub/src/travel';
import type { GameId } from '@metaverse/hub-sdk';

const collider = buildCollider();
const player = createPlayerController(collider.bvh);
const speeds = { walk: 5.2, sprint: 8.6 };

function settle(seconds: number): void {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i += 1) {
    player.step(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false, yaw: 0 }, speeds);
  }
}

player.spawn(0, STAND_Y + 1.5, 10, 0);
settle(2);
const restY = player.position.y;
assert.ok(Math.abs(restY - STAND_Y) < 0.08, `rest height ${restY} vs ${STAND_Y}`);
const before = restY;
settle(0.5);
assert.ok(Math.abs(player.position.y - before) < 0.02, 'capsule should sit still on the floor');
assert.ok([player.position.x, player.position.y, player.position.z].every(Number.isFinite));

let peak = player.position.y;
for (let i = 0; i < 50; i += 1) {
  player.step(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: i === 0, yaw: 0 }, speeds);
  peak = Math.max(peak, player.position.y);
}
assert.ok(peak > restY + 0.4 && peak < restY + 1.6, `jump peak delta ${peak - restY}`);

player.spawn(0, STAND_Y, 12, 0);
let closest = Infinity;
let highest = 0;
for (let i = 0; i < 240; i += 1) {
  player.step(1 / 60, { forward: 1, strafe: 0, sprint: true, jump: false, yaw: 0 }, speeds);
  closest = Math.min(closest, Math.hypot(player.position.x, player.position.z));
  highest = Math.max(highest, player.position.y);
}
const monumentLimit = MONUMENT_RADIUS * Math.cos(Math.PI / 8) + CAPSULE_RADIUS - 0.08;
assert.ok(closest > monumentLimit, `walked into the monument at r=${closest}`);
assert.ok(highest < STAND_Y + 0.35, `climbed the pedestal to y=${highest}`);

for (let i = 0; i < 8; i += 1) {
  const angle = (i / 8) * Math.PI * 2;
  const start = 22;
  player.spawn(Math.sin(angle) * start, STAND_Y, -Math.cos(angle) * start, angle);
  for (let step = 0; step < 180; step += 1) {
    player.step(1 / 60, { forward: 1, strafe: 0, sprint: true, jump: false, yaw: angle }, speeds);
  }
  const radius = Math.hypot(player.position.x, player.position.z);
  assert.ok(radius < CURB_RADIUS - 0.05, `left the plaza at angle ${angle} r=${radius}`);
}

const games: (GameId | null)[] = [null, 'hpos10i', 'nobu', 'peoples-bitcoin', 'sproto'];
for (const game of games) {
  const spawn = spawnFor(game);
  assert.equal(portalContaining(spawn.x, spawn.z), null, `${game ?? 'default'} spawn is inside a portal`);
  if (game) {
    const radius = Math.hypot(spawn.x, spawn.z);
    assert.ok(Math.abs(radius - (PORTAL_DISTANCE - PORTAL_STANDOFF)) < 0.001);
    const forwardX = Math.sin(spawn.yaw);
    const forwardZ = -Math.cos(spawn.yaw);
    const outward = Math.hypot(spawn.x, spawn.z);
    const dot = (forwardX * spawn.x + forwardZ * spawn.z) / outward;
    assert.ok(dot > 0.99, `${game} should face its portal`);
    const portal = portalContaining(
      Math.sin(Math.atan2(spawn.x, -spawn.z)) * PORTAL_DISTANCE,
      -Math.cos(Math.atan2(spawn.x, -spawn.z)) * PORTAL_DISTANCE,
    );
    assert.equal(portal?.id, game);
    const dx = spawn.x - Math.sin(Math.atan2(spawn.x, -spawn.z)) * PORTAL_DISTANCE;
    const dz = spawn.z - (-Math.cos(Math.atan2(spawn.x, -spawn.z)) * PORTAL_DISTANCE);
    assert.ok(Math.abs(Math.hypot(dx, dz) - PORTAL_STANDOFF) < 0.02);
    assert.ok(PORTAL_STANDOFF > PORTAL_TRIGGER_RADIUS);
  }
}

assert.equal(parseReturnGame('#from=peoples-bitcoin'), 'peoples-bitcoin');
assert.equal(parseReturnGame('#from=sproto&extra=1'), 'sproto');
assert.equal(parseReturnGame('#from=nope'), null);
assert.equal(parseReturnGame(''), null);
assert.equal(portalUrl('/play/hpos10i/', 'abc-def_012.sig'), '/play/hpos10i/#t=abc-def_012.sig');
assert.equal(portalContaining(0, -PORTAL_DISTANCE)?.id, 'hpos10i');

console.log('capsule sim ok', { restY: restY.toFixed(3), jump: (peak - restY).toFixed(3) });
