// H1 entrances. Shooter uses the empty plaza ring. Coop Battle is a Bar cabinet choice.
// Open World is a sixth ring beside the Range. A missing page is Coming soon, so the entrance does
// not mint a ticket. None of the three earns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RELIC_BY_GAME } from '@metaverse/hub-sdk';

// games.ts reads Vite env for the three new pages. This program has Node types only.
declare global {
  interface ImportMeta {
    readonly env: {
      readonly VITE_GAME_URL_SPROTO_SHOOTER?: string;
      readonly VITE_GAME_URL_SPROTO_COOP_BATTLE?: string;
      readonly VITE_GAME_URL_SPROTO_OPEN_WORLD?: string;
    };
  }
}
import { ARCADE_GAME, ARCADE_GAMES, ARCADE_STORY_GAME, OPEN_WORLD_ARC, PILLAR_OFFSET, PLAZA_SLOT, PLAZA_YAW, PORTAL_DISTANCE, PORTAL_STANDOFF, PORTALS, RANGE_ANGLE, STATUE_PORTALS } from '../src/realms/plaza/config';
import { ARCADE_PROMPT, ARCADE_RETURN, ARCADE_WALKUP } from '../src/realms/plaza/arcade-layout';
import { gameById, gameUrl } from '../src/games';
import { gameInfo, relicOfGame } from '../src/game-list';
import { buildingBoxColliders, buildingCylinderColliders } from '../src/realms/plaza/blockouts';
import { pillarBoxes, spawnFor, spawnForArrival } from '../src/realms/plaza/layout';
import { portalPosition } from '../src/layout';
import { parseReturnGame, portalContaining } from '../src/travel';
import { GATE_LOCKED_TEXT, LAUNCH_TIMEOUT_MS, LaunchTimeoutError, SERVER_SILENT_TEXT, launchErrorText, restoreErrorText, serverSilent, withTimeout } from '../src/core/launch-errors';

const relics = RELIC_BY_GAME as Partial<Record<string, string>>;

// The four original rings stay on their slots. Shooter takes the empty fifth. Coop has no ring.
// Open World is the sixth ring, off-slot beside the Range.
{
  const slots: Record<string, number> = {
    hpos10i: 2,
    nobu: 4,
    'peoples-bitcoin': 1,
    sproto: 0,
    'sproto-shooter': 3,
  };
  assert.deepEqual(PORTALS.map((portal) => portal.id), ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-shooter', 'sproto-open-world']);
  for (const portal of PORTALS) {
    if (portal.id === 'sproto-open-world') continue;
    assert.equal(portal.angle, slots[portal.id]! * PLAZA_SLOT + PLAZA_YAW, portal.id);
  }
  assert.equal(PORTALS.filter((portal) => portal.id === 'sproto-shooter').length, 1);
  assert.equal(PORTALS.some((portal) => portal.id === 'sproto-coop-battle'), false);
  const shooter = PORTALS.find((portal) => portal.id === 'sproto-shooter');
  assert.equal(shooter?.label, 'Sproto Shooter');
  assert.equal(shooter?.place, 'The Range');
}

// Shooter return stands at its ring, outside the trigger, facing the gate.
{
  const at = spawnForArrival('#from=sproto-shooter');
  assert.deepEqual(at, spawnFor('sproto-shooter'));
  assert.notDeepEqual(at, spawnFor(null));
  assert.equal(portalContaining(PORTALS, at.x, at.z), null);
  assert.ok(Math.abs(Math.hypot(at.x, at.z) - (PORTAL_DISTANCE - PORTAL_STANDOFF)) < 0.001);
  const gate = portalContaining(
    PORTALS,
    Math.sin(at.yaw) * PORTAL_DISTANCE,
    -Math.cos(at.yaw) * PORTAL_DISTANCE,
  );
  assert.equal(gate?.id, 'sproto-shooter');
  assert.equal(parseReturnGame('#from=sproto-shooter'), 'sproto-shooter');
}

// Open World is the sixth ring: 10 m of arc from the Range on the Green Hill side, on the same
// 96 m circle, facing the statue. The two entrances and their triggers do not overlap.
{
  assert.equal(PORTALS.filter((portal) => portal.id === 'sproto-open-world').length, 1);
  const world = PORTALS.find((portal) => portal.id === 'sproto-open-world')!;
  const range = PORTALS.find((portal) => portal.id === 'sproto-shooter')!;
  assert.equal(world.label, 'Sproto Open World');
  assert.equal(world.place, 'Sproutvale');
  assert.equal(world.color, '#a6ff4d');
  assert.equal(world.mature, undefined);
  assert.equal(world.distance, PORTAL_DISTANCE);
  assert.equal(world.triggerRadius, range.triggerRadius);
  assert.equal(range.angle, RANGE_ANGLE);
  assert.equal(world.angle, RANGE_ANGLE - OPEN_WORLD_ARC / PORTAL_DISTANCE);
  assert.ok(world.angle < range.angle, 'on the Green Hill side, away from the Bar fence gap');
  const a = portalPosition(world.angle, world.distance);
  const b = portalPosition(range.angle, range.distance);
  const apart = Math.hypot(a.x - b.x, a.z - b.z);
  // Entrance signs are 11 m × 0.57 wide and the posts stand 3 m either side of centre.
  assert.ok(apart > 11 * 0.57 + 2 && apart < 12, `rings ${apart.toFixed(2)} m apart`);
  assert.equal(portalContaining(PORTALS, a.x, a.z)?.id, 'sproto-open-world');
  assert.equal(portalContaining(PORTALS, b.x, b.z)?.id, 'sproto-shooter');
  assert.ok(apart > world.triggerRadius + range.triggerRadius + 4);
  // No portal shell, so nothing solid sits around the ring or on the way to the Bar.
  for (const box of [...buildingBoxColliders(), ...buildingCylinderColliders()]) {
    assert.ok(Math.hypot(box.x - a.x, box.z - a.z) > 8, 'no blockout collider beside Open World');
  }
  // Its pillar colliders stand clear of the Range's.
  const pillars = pillarBoxes();
  const index = PORTALS.indexOf(world);
  const own = pillars.slice(index * 2, index * 2 + 2);
  const rangePillars = pillars.slice(PORTALS.indexOf(range) * 2, PORTALS.indexOf(range) * 2 + 2);
  for (const p of own) {
    assert.ok(Math.abs(Math.hypot(p.x - a.x, p.z - a.z) - PILLAR_OFFSET) < 1e-9);
    for (const q of rangePillars) assert.ok(Math.hypot(p.x - q.x, p.z - q.z) > 6);
  }
  const entry = gameById('sproto-open-world');
  assert.equal(entry?.slug, 'sproto-open-world');
  assert.equal(entry?.env, 'VITE_GAME_URL_SPROTO_OPEN_WORLD');
  assert.equal(entry?.entry, 'ring');
  const info = gameInfo('sproto-open-world');
  assert.equal(info?.label, world.label);
  assert.equal(info?.color, world.color);
  assert.equal(info?.where, 'Plaza ring by The Range');
  assert.equal(relicOfGame('sproto-open-world'), undefined);
  assert.equal(/Relic|Dragon|Scale/.test(info?.goal ?? ''), false, 'the goal names no Relic');
}

// #from=sproto-open-world lands in front of the new ring, outside every trigger, facing it.
{
  const at = spawnForArrival('#from=sproto-open-world');
  assert.equal(parseReturnGame('#from=sproto-open-world'), 'sproto-open-world');
  assert.deepEqual(at, spawnFor('sproto-open-world'));
  assert.notDeepEqual(at, spawnFor(null));
  assert.notDeepEqual(at, spawnFor('sproto-shooter'));
  assert.equal(portalContaining([...PORTALS, ...STATUE_PORTALS], at.x, at.z), null);
  assert.ok(Math.abs(Math.hypot(at.x, at.z) - (PORTAL_DISTANCE - PORTAL_STANDOFF)) < 0.001);
  const ring = portalPosition(RANGE_ANGLE - OPEN_WORLD_ARC / PORTAL_DISTANCE, PORTAL_DISTANCE);
  const toRing = { x: ring.x - at.x, z: ring.z - at.z };
  const length = Math.hypot(toRing.x, toRing.z);
  assert.ok(Math.abs(length - PORTAL_STANDOFF) < 0.001);
  const facing = (Math.sin(at.yaw) * toRing.x - Math.cos(at.yaw) * toRing.z) / length;
  assert.ok(facing > 0.9999, 'facing the Open World ring');
  const gate = portalContaining(PORTALS, Math.sin(at.yaw) * PORTAL_DISTANCE, -Math.cos(at.yaw) * PORTAL_DISTANCE);
  assert.equal(gate?.id, 'sproto-open-world');
  assert.equal(ARCADE_GAMES.some((game) => game.id === parseReturnGame('#from=sproto-open-world')), false);
}

// The green gate behind the statue head (north, off the 25 m pedestal) is a second Shooter entrance.
// It does not overlap any ring, and Shooter returns still land at the Range ring.
{
  assert.deepEqual(STATUE_PORTALS.map((portal) => portal.id), ['sproto-shooter']);
  const gate = STATUE_PORTALS[0]!;
  assert.equal(gate.angle, 0);
  assert.equal(gate.color, '#39ff6a');
  assert.ok(gate.distance - gate.triggerRadius > 25);
  const all = [...PORTALS, ...STATUE_PORTALS];
  assert.equal(portalContaining(all, 0, -gate.distance)?.id, 'sproto-shooter');
  assert.equal(portalContaining(PORTALS, 0, -gate.distance), null);
  assert.equal(portalContaining(all, spawnFor(null).x, spawnFor(null).z), null);
  assert.deepEqual(spawnForArrival('#from=sproto-shooter'), spawnFor('sproto-shooter'));
}

// Coop return is the Bar cabinet lookup, the same spot as Fighter and Arcade. Not a ring.
{
  assert.deepEqual(
    ARCADE_GAMES.map((game) => game.id),
    ['sproto-arcade', 'sproto-fighter', 'sproto-coop-battle'],
  );
  assert.equal(ARCADE_GAMES[0]?.label, ARCADE_STORY_GAME.label);
  assert.equal(ARCADE_GAMES[0]?.blurb, 'The Long Way Home · twelve giant bosses, a rooftop chase and the code shaft');
  assert.equal(ARCADE_GAMES[1]?.label, ARCADE_GAME.label);
  assert.equal(ARCADE_GAMES[1]?.blurb, 'Story mode and online 1v1 duels');
  assert.equal(ARCADE_GAMES[2]?.label, 'Sproto Coop Battle');
  assert.equal(ARCADE_PROMPT, 'Press E · Choose Sproto Arcade, Sproto Fighter or Sproto Coop Battle');
  assert.equal(ARCADE_RETURN.x, ARCADE_WALKUP.x);
  assert.equal(ARCADE_RETURN.z, ARCADE_WALKUP.z - 0.6);
  assert.equal(ARCADE_RETURN.yaw, 0);
  for (const id of ['sproto-fighter', 'sproto-arcade', 'sproto-coop-battle'] as const) {
    assert.equal(parseReturnGame(`#from=${id}`), id);
    assert.equal(ARCADE_GAMES.some((game) => game.id === id), true);
    assert.deepEqual(spawnFor(id), spawnFor(null));
  }
  assert.equal(ARCADE_GAMES.some((game) => game.id === parseReturnGame('#from=sproto-shooter')), false);
  const content = readFileSync(new URL('../src/realms/plaza/content.ts', import.meta.url), 'utf8');
  assert.match(content, /ARCADE_GAMES\.some\(game => game\.id === parseReturnGame\(window\.location\.hash\)\)/);
}

// A page mints. An empty or missing URL is Coming soon and does not navigate.
{
  assert.equal(gameUrl('sproto-shooter', { dev: true }), '/play/sproto-shooter/');
  assert.equal(gameUrl('sproto-coop-battle', { dev: true }), '/play/sproto-coop-battle/');
  assert.equal(gameUrl('sproto-shooter', { dev: false, playDomain: 'example.com' }), 'https://play.example.com/sproto-shooter/');
  assert.equal(gameUrl('sproto-coop-battle', { dev: false, playDomain: 'example.com' }), 'https://play.example.com/sproto-coop-battle/');
  assert.equal(gameUrl('sproto-shooter', { dev: true, overrides: { 'sproto-shooter': '' } }), null);
  assert.equal(gameUrl('sproto-coop-battle', { dev: true, overrides: { 'sproto-coop-battle': '' } }), null);
  assert.equal(gameUrl('sproto-shooter', { dev: false }), null);
  assert.equal(gameUrl('sproto-coop-battle', { dev: false }), null);
  assert.equal(gameUrl('sproto-open-world', { dev: true }), '/play/sproto-open-world/');
  assert.equal(gameUrl('sproto-open-world', { dev: false, playDomain: 'example.com' }), 'https://play.example.com/sproto-open-world/');
  assert.equal(gameUrl('sproto-open-world', { dev: true, overrides: { 'sproto-open-world': '' } }), null);
  assert.equal(gameUrl('sproto-open-world', { dev: false, overrides: { 'sproto-open-world': 'https://example.org/world/' } }), 'https://example.org/world/');
  assert.equal(gameUrl('sproto-open-world', { dev: false }), null);
  assert.equal(gameUrl('sproto-fighter', { dev: true }), '/play/sproto-fighter/');
  assert.equal(gameUrl('sproto-arcade', { dev: true }), '/play/sproto-arcade/');
  assert.equal(gameUrl('sproto', { dev: true }), '/play/sproto-duel/');
}

// Shooter grants the Dragon Scale and Coop the Marina Anchor. Fighter and Arcade still grant theirs.
// V Coin is not a menu row.
{
  assert.equal(relics['sproto-shooter'], 'dragon_scale');
  assert.equal(relics['sproto-coop-battle'], 'marina_anchor');
  assert.equal(relics['sproto-fighter'], 'tidebreaker_belt');
  assert.equal(relics['sproto-arcade'], 'breakwater_coin');
  assert.equal(relics['sproto-open-world'], undefined);
  assert.equal(JSON.stringify(PORTALS).includes('vcoin'), false);
  assert.equal(JSON.stringify(ARCADE_GAMES).includes('vcoin'), false);
}

// A2: a failed launch reads as a sentence, never a raw status code, and never hangs.
{
  const sdkError = (code: string, message: string, status?: number) => Object.assign(new Error(message), { code, status });
  assert.equal(launchErrorText(sdkError('http', 'HTTP 502', 502), 'NOBU'), SERVER_SILENT_TEXT);
  assert.equal(launchErrorText(sdkError('http', 'HTTP 503'), 'NOBU'), SERVER_SILENT_TEXT);
  assert.equal(launchErrorText(new TypeError('Failed to fetch'), 'NOBU'), SERVER_SILENT_TEXT);
  assert.equal(launchErrorText(new SyntaxError('Unexpected token <'), 'NOBU'), SERVER_SILENT_TEXT);
  assert.equal(launchErrorText(new LaunchTimeoutError(), 'NOBU'), SERVER_SILENT_TEXT);
  assert.equal(
    launchErrorText(sdkError('rate_limited', 'Too many portal entries. Try again in a minute.', 400), 'NOBU'),
    'Too many portal entries. Try again in a minute.',
  );
  assert.equal(launchErrorText(sdkError('GATE_LOCKED', 'GATE_LOCKED', 400), 'NOBU'), GATE_LOCKED_TEXT);
  assert.equal(launchErrorText(sdkError('bad_game', 'unknown game', 400), 'Sproto Duel'), 'Could not open Sproto Duel.');
  assert.equal(launchErrorText('boom', 'Sproto Duel'), 'Could not open Sproto Duel.');
  // A refused recovery code reads as a sentence, never as the server's bare error code.
  assert.equal(restoreErrorText(sdkError('recovery_invalid', 'recovery_invalid')), 'That code is not valid. Check it and try again.');
  assert.equal(restoreErrorText(sdkError('device_mismatch', 'Device is not on this account')), 'Device is not on this account');
  assert.equal(restoreErrorText(sdkError('restore_failed', 'restore_failed')), 'Could not restore that code.');
  assert.equal(restoreErrorText(new TypeError('Failed to fetch')), SERVER_SILENT_TEXT);
  assert.equal(serverSilent(sdkError('bad_game', 'unknown game', 400)), false);
  for (const text of [SERVER_SILENT_TEXT, GATE_LOCKED_TEXT, launchErrorText(sdkError('x', 'HTTP 404', 404), 'NOBU')]) {
    assert.equal(/HTTP|\b[45]\d\d\b|Nakama/.test(text), false, text);
  }
  assert.equal(LAUNCH_TIMEOUT_MS, 10_000);

  // Timeout: a request that never settles fails when the timer fires; a settled one clears it.
  let fire: (() => void) | null = null;
  let cleared = 0;
  const timers = { set: (fn: () => void) => { fire = fn; return 1; }, clear: () => { cleared += 1; } };
  const hung = withTimeout(new Promise<never>(() => undefined), 10, timers);
  (fire as (() => void) | null)?.();
  await assert.rejects(hung, LaunchTimeoutError);
  assert.equal(await withTimeout(Promise.resolve(7), 10, timers), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error('no')), 10, timers), /no/);
  assert.equal(cleared, 2);
}

console.log('game entry ok');
