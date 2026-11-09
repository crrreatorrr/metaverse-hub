// H1 entrances. Shooter uses the empty plaza ring. Coop Battle is a Bar cabinet choice.
// A missing page is Coming soon, so the entrance does not mint a ticket. Neither game earns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RELIC_BY_GAME } from '@metaverse/hub-sdk';

// games.ts reads Vite env for the two new pages. This program has Node types only.
declare global {
  interface ImportMeta {
    readonly env: {
      readonly VITE_GAME_URL_SPROTO_SHOOTER?: string;
      readonly VITE_GAME_URL_SPROTO_COOP_BATTLE?: string;
    };
  }
}
import { ARCADE_GAME, ARCADE_GAMES, ARCADE_STORY_GAME, PLAZA_SLOT, PLAZA_YAW, PORTAL_DISTANCE, PORTAL_STANDOFF, PORTALS, STATUE_PORTALS } from '../src/realms/plaza/config';
import { ARCADE_PROMPT, ARCADE_RETURN, ARCADE_WALKUP } from '../src/realms/plaza/arcade-layout';
import { gameUrl } from '../src/games';
import { spawnFor, spawnForArrival } from '../src/realms/plaza/layout';
import { parseReturnGame, portalContaining } from '../src/travel';

const relics = RELIC_BY_GAME as Partial<Record<string, string>>;

// The four original rings stay on their slots. Shooter takes the empty fifth. Coop has no ring.
{
  const slots: Record<string, number> = {
    hpos10i: 2,
    nobu: 4,
    'peoples-bitcoin': 1,
    sproto: 0,
    'sproto-shooter': 3,
  };
  assert.deepEqual(PORTALS.map((portal) => portal.id), ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-shooter']);
  for (const portal of PORTALS) {
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
  assert.equal(ARCADE_GAMES[0]?.blurb, 'The Long Way Home · ten giant bosses, a rooftop chase and the code shaft');
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
  assert.equal(gameUrl('sproto-fighter', { dev: true }), '/play/sproto-fighter/');
  assert.equal(gameUrl('sproto-arcade', { dev: true }), '/play/sproto-arcade/');
  assert.equal(gameUrl('sproto', { dev: true }), '/play/sproto-duel/');
}

// Neither new game grants a Relic. Fighter and Arcade still do. V Coin is not a menu row.
{
  assert.equal(relics['sproto-shooter'], undefined);
  assert.equal(relics['sproto-coop-battle'], undefined);
  assert.equal(relics['sproto-fighter'], 'tidebreaker_belt');
  assert.equal(relics['sproto-arcade'], 'breakwater_coin');
  assert.equal(JSON.stringify(PORTALS).includes('vcoin'), false);
  assert.equal(JSON.stringify(ARCADE_GAMES).includes('vcoin'), false);
}

console.log('game entry ok');
