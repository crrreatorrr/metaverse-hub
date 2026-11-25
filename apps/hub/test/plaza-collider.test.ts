// The live plaza collider (buildPlazaCollider): buildings, the Bar's fence and the entrance posts
// are solid, and every entrance ring and the Bar's street door can still be walked to.
import assert from 'node:assert/strict';
import { BUILDING_SOLIDS, buildingBoxes, buildingDrums, buildingPoint, entrancePostBoxes, ENTRANCE_POST, ENTRANCE_POST_OFFSET, type BuildingKey } from '../src/realms/plaza/building-colliders';
import { PORTALS, PORTAL_DISTANCE, PORTAL_TRIGGER_RADIUS, STATUE_PORTALS } from '../src/realms/plaza/config';
import { plazaSpawn, spawnFor, spawnForArrival } from '../src/realms/plaza/layout';
import { buildPlazaCollider } from '../src/realms/plaza/plaza-collider';
import { CAPSULE_RADIUS, STAND_Y, createPlayerController, type PlayerController } from '../src/physics';
import { MOVEMENT } from '../src/core/movement';
import { portalPosition, type BoxSpec } from '../src/layout';
import { portalContaining } from '../src/travel';
import { SPAWN_SPOTS, SPAWN_SPREAD_MAX, spawnSpread } from '../src/core/spawn-spread';

const collider = buildPlazaCollider();
const speeds = { walk: MOVEMENT.walk, sprint: MOVEMENT.sprint };
const boxes = buildingBoxes();
const posts = entrancePostBoxes([...PORTALS, ...STATUE_PORTALS]);
const drums = buildingDrums();

/** How far (x, z) is inside a box's footprint: positive inside, negative outside. */
function depthIn(box: BoxSpec, x: number, z: number): number {
  const dx = x - box.x;
  const dz = z - box.z;
  const cos = Math.cos(box.rotY);
  const sin = Math.sin(box.rotY);
  // Inverse of three's rotateY(rotY).
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.min(box.sx / 2 - Math.abs(lx), box.sz / 2 - Math.abs(lz));
}

function insideSolid(x: number, z: number): string | null {
  for (const [i, box] of [...boxes, ...posts].entries()) if (depthIn(box, x, z) > 0.02) return `box ${i}`;
  for (const [i, drum] of drums.entries()) if (Math.hypot(x - drum.x, z - drum.z) < drum.radius * Math.cos(Math.PI / 12) - 0.02) return `drum ${i}`;
  return null;
}

function walker(x: number, z: number, yaw = 0): PlayerController {
  const p = createPlayerController(collider.bvh, collider.solids);
  p.spawn(x, STAND_Y, z, yaw);
  return p;
}

/** Walk toward (tx, tz), sprinting, until within `tol` or the time runs out. */
function walkTo(p: PlayerController, tx: number, tz: number, tol: number, seconds = 30, dt = 1 / 60): number {
  for (let i = 0; i < seconds / dt; i += 1) {
    const d = Math.hypot(tx - p.position.x, tz - p.position.z);
    if (d < tol) return d;
    p.step(dt, { forward: 1, strafe: 0, sprint: d > 6, jump: false, yaw: Math.atan2(tx - p.position.x, -(tz - p.position.z)) }, speeds);
  }
  return Math.hypot(tx - p.position.x, tz - p.position.z);
}

// The buildings live in a second tree, so the first is exactly the collider every older contact
// test (the Bar's counter and stools, its door posts) was written against.
{
  const open = buildPlazaCollider(undefined, ['castle', 'whitehouse', 'hills', 'club', 'kennel']);
  assert.ok(collider.solids, 'the plaza has a solids tree');
  assert.equal(collider.geometry.getAttribute('position').count, open.geometry.getAttribute('position').count);
  assert.deepEqual(Array.from(collider.geometry.getAttribute('position').array.slice(0, 600)), Array.from(open.geometry.getAttribute('position').array.slice(0, 600)));
}

// The solids stand where the models do: nothing covers a ring, a spawn or the Bar's door.
{
  for (const portal of [...PORTALS, ...STATUE_PORTALS]) {
    const at = portalPosition(portal.angle, portal.distance);
    for (let a = 0; a < 16; a += 1) {
      const x = at.x + Math.sin((a / 16) * Math.PI * 2) * (PORTAL_TRIGGER_RADIUS + CAPSULE_RADIUS);
      const z = at.z + Math.cos((a / 16) * Math.PI * 2) * (PORTAL_TRIGGER_RADIUS + CAPSULE_RADIUS);
      assert.equal(insideSolid(x, z), null, `${portal.id} ring is clear`);
    }
  }
  assert.ok(ENTRANCE_POST_OFFSET - ENTRANCE_POST.sx / 2 - CAPSULE_RADIUS >= PORTAL_TRIGGER_RADIUS, 'the whole trigger fits between the posts');
  assert.equal(posts.length, (PORTALS.length + STATUE_PORTALS.length) * 2);
  for (const key of Object.keys(BUILDING_SOLIDS) as BuildingKey[]) {
    const centre = buildingPoint(key, 0, 0);
    assert.ok(Math.abs(Math.hypot(centre.x, centre.z) - BUILDING_SOLIDS[key].radius) < 1e-6);
  }
  // Nothing but the entrance posts stands on the plaza out to 5 m past the ring road.
  for (let r = 26; r <= PORTAL_DISTANCE + 5; r += 1) {
    for (let a = 0; a < 720; a += 1) {
      const at = portalPosition((a / 720) * Math.PI * 2, r);
      const hit = [...boxes].findIndex((box) => depthIn(box, at.x, at.z) > 0);
      assert.equal(hit, -1, `a building solid reaches r=${r}`);
    }
  }
  assert.equal(buildingBoxes(['castle']).length, boxes.length - BUILDING_SOLIDS.castle.boxes.length, 'the castle can be left open');
}

// Arrivals spread around the spawn point: 64 spots, apart from each other, clear of every solid
// and of the ring a returning player faces.
{
  const spots = Array.from({ length: SPAWN_SPOTS }, (_, n) => spawnSpread(n));
  for (const [i, a] of spots.entries()) {
    const r = Math.hypot(a.x, a.z);
    assert.ok(r >= 1.2 - 1e-9 && r <= SPAWN_SPREAD_MAX + 1e-9, `spot ${i} is ${r.toFixed(2)} m out`);
    for (let j = i + 1; j < spots.length; j += 1) assert.ok(Math.hypot(a.x - spots[j]!.x, a.z - spots[j]!.z) > 0.75, `spots ${i} and ${j} overlap`);
  }
  assert.deepEqual(spawnSpread(SPAWN_SPOTS + 3), spawnSpread(3));
  assert.deepEqual(spawnSpread(-1), spawnSpread(SPAWN_SPOTS - 1));
  for (const game of [null, ...PORTALS.map((portal) => portal.id)]) {
    const spawn = spawnFor(game);
    for (const offset of spots) {
      const x = spawn.x + offset.x;
      const z = spawn.z + offset.z;
      assert.equal(insideSolid(x, z), null, `${game ?? 'first'} spawn spot is inside a solid`);
      assert.equal(portalContaining([...PORTALS, ...STATUE_PORTALS], x, z), null, `${game ?? 'first'} spawn spot is inside a ring`);
      assert.ok(Math.hypot(x, z) > 25 + CAPSULE_RADIUS, 'spawn spot is on the pedestal');
      const p = walker(x, z);
      for (let i = 0; i < 30; i += 1) p.step(1 / 60, { forward: 0, strafe: 0, sprint: false, jump: false, yaw: 0 }, speeds);
      assert.ok(Math.hypot(p.position.x - x, p.position.z - z) < 0.01 && Math.abs(p.position.y - STAND_Y) < 0.05, 'a spawn spot pushes the player');
    }
  }
  // Back from a game, every spot faces its ring: holding forward walks straight in.
  for (const portal of PORTALS) {
    for (let n = 0; n < SPAWN_SPOTS; n += 1) {
      const spawn = plazaSpawn(`#from=${portal.id}`, n);
      const base = spawnFor(portal.id);
      assert.ok(Math.abs(Math.hypot(spawn.x - base.x, spawn.z - base.z) - Math.hypot(spots[n]!.x, spots[n]!.z)) < 1e-9);
      const p = walker(spawn.x, spawn.z, spawn.yaw);
      let entered = false;
      for (let i = 0; i < 180 && !entered; i += 1) {
        p.step(1 / 60, { forward: 1, strafe: 0, sprint: false, jump: false, yaw: spawn.yaw }, speeds);
        entered = portalContaining(PORTALS, p.position.x, p.position.z)?.id === portal.id;
      }
      assert.ok(entered, `${portal.id} spot ${n}: forward does not reach the ring`);
    }
  }
  assert.deepEqual(plazaSpawn('#realm=sandbox', 5), spawnForArrival('#realm=sandbox'), 'the sandbox arrival stays exact');
  assert.equal(plazaSpawn('', 5).yaw, spawnFor(null).yaw);
  assert.deepEqual(plazaSpawn('#from=sproto-fighter', 0).yaw, spawnFor(null).yaw, 'a cabinet game returns to the first spawn (then the Bar)');
}

// Every ring: from its return spawn, straight ahead into the trigger, at 30 and 60 fps.
for (const dt of [1 / 30, 1 / 60]) {
  for (const portal of PORTALS) {
    const spawn = spawnFor(portal.id);
    const p = walker(spawn.x, spawn.z, spawn.yaw);
    const at = portalPosition(portal.angle, portal.distance);
    const left = walkTo(p, at.x, at.z, 0.5, 10, dt);
    assert.ok(left < 0.5, `${portal.id}: stopped ${left.toFixed(2)} m short of its ring`);
    assert.equal(portalContaining(PORTALS, p.position.x, p.position.z)?.id, portal.id);
  }
  // The second Shooter entrance behind the statue, from the first spawn, around the pedestal.
  const start = spawnFor(null);
  const p = walker(start.x, start.z);
  const ring = portalPosition(STATUE_PORTALS[0]!.angle, STATUE_PORTALS[0]!.distance);
  walkTo(p, 40, 0, 2);
  walkTo(p, 25, ring.z - 12, 2);
  walkTo(p, ring.x, ring.z - 9, 1);
  assert.ok(walkTo(p, ring.x, ring.z, 0.5) < 0.5, 'the statue entrance is reachable');
}

// A post stops a walker; so does a building; the walker slides off and is not held.
{
  const hpos = PORTALS.find((portal) => portal.id === 'hpos10i')!;
  const at = portalPosition(hpos.angle, hpos.distance);
  const post = posts.find((box) => Math.hypot(box.x - (at.x + Math.cos(hpos.angle) * ENTRANCE_POST_OFFSET), box.z - (at.z + Math.sin(hpos.angle) * ENTRANCE_POST_OFFSET)) < 0.01)!;
  assert.ok(post, 'hpos10i has a right-hand post');
  const p = walker(post.x, post.z + 8);
  for (let i = 0; i < 240; i += 1) p.step(1 / 60, { forward: 1, strafe: 0, sprint: true, jump: i % 40 === 0, yaw: 0 }, speeds);
  assert.ok(p.position.z > post.z + CAPSULE_RADIUS, `walked through an entrance post to z=${p.position.z.toFixed(2)}`);

  for (const key of Object.keys(BUILDING_SOLIDS) as BuildingKey[]) {
    // The middle of the building's first solid, from the ring road straight in front of it.
    const first = BUILDING_SOLIDS[key].boxes[0]!;
    const centre = buildingPoint(key, first.x, first.z);
    const r = Math.hypot(centre.x, centre.z);
    const from = { x: (centre.x / r) * 100, z: (centre.z / r) * 100 };
    const walk = walker(from.x, from.z);
    walkTo(walk, centre.x, centre.z, 1, 12);
    assert.equal(insideSolid(walk.position.x, walk.position.z), null, `${key}: walked into the building`);
    assert.ok(Math.hypot(walk.position.x - centre.x, walk.position.z - centre.z) > 10, `${key}: reached the middle of the building`);
    assert.ok(Math.abs(walk.position.y - STAND_Y) < 0.1, `${key}: left the ground at the wall (y=${walk.position.y.toFixed(2)})`);
    const before = { x: walk.position.x, z: walk.position.z };
    walkTo(walk, 0, 0, 1, 1);
    assert.ok(Math.hypot(walk.position.x - before.x, walk.position.z - before.z) > 5, `${key}: held at the wall`);
  }
}

// The Bar's street door: from the Range ring's spawn, through the fence gap, to the door trigger.
{
  const door = buildingPoint('club', -17, 22);
  const gap = buildingPoint('club', -1.15, 38);
  const outside = buildingPoint('club', -1.15, 46);
  const inside = buildingPoint('club', -1.15, 32);
  for (const dt of [1 / 30, 1 / 60]) {
    const spawn = spawnFor('sproto-shooter');
    const p = walker(spawn.x, spawn.z, spawn.yaw);
    assert.ok(walkTo(p, outside.x, outside.z, 1, 20, dt) < 1, 'reached the fence gap');
    assert.ok(walkTo(p, inside.x, inside.z, 1, 10, dt) < 1, `the fence gap is open (stopped ${Math.hypot(p.position.x - gap.x, p.position.z - gap.z).toFixed(2)} m from it)`);
    assert.ok(walkTo(p, door.x, door.z, 2.5, 20, dt) < 2.6, 'reached the Bar door trigger');
  }
  // Straight at the fence from the plaza: it holds.
  const fence = buildingPoint('club', -20, 38);
  const far = buildingPoint('club', -20, 60);
  const yard = buildingPoint('club', -20, 30);
  const p = walker(far.x, far.z);
  walkTo(p, yard.x, yard.z, 1, 8);
  assert.ok(Math.hypot(p.position.x - far.x, p.position.z - far.z) < Math.hypot(fence.x - far.x, fence.z - far.z), 'walked through the picket fence');
}

// Seeded random walks over the whole plaza at 20 to 144 fps: nobody falls, nobody ends up inside
// a solid, and nobody is left unable to move.
{
  let seed = 20261124;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const starts = [spawnFor(null), ...PORTALS.map((portal) => spawnFor(portal.id)), buildingPoint('club', -17, 27), buildingPoint('club', 20, 26), buildingPoint('kennel', -24.5, 60)];
  for (const dt of [1 / 144, 1 / 60, 1 / 30, 0.05]) {
    for (let w = 0; w < 26; w += 1) {
      const start = starts[w % starts.length]!;
      const offset = spawnSpread(w);
      const p = walker(start.x + offset.x, start.z + offset.z);
      assert.equal(insideSolid(p.position.x, p.position.z), null, `start ${w % starts.length} is inside a solid`);
      let yaw = rnd() * Math.PI * 2;
      let forward = 1;
      let strafe = 0;
      let sprint = true;
      const steps = Math.round(40 / dt);
      for (let i = 0; i < steps; i += 1) {
        if (i % Math.round(0.5 / dt) === 0) {
          yaw += (rnd() - 0.5) * 3;
          forward = rnd() < 0.8 ? 1 : rnd() < 0.5 ? -1 : 0;
          strafe = rnd() < 0.3 ? (rnd() < 0.5 ? 1 : -1) : 0;
          sprint = rnd() < 0.7;
        }
        p.step(dt, { forward, strafe, sprint, jump: rnd() < 0.05, yaw }, speeds);
        assert.ok(p.position.y > STAND_Y - 0.2, `fell at ${p.position.x.toFixed(1)}, ${p.position.z.toFixed(1)} (dt ${dt.toFixed(4)})`);
        if (i % 20 === 0) assert.equal(insideSolid(p.position.x, p.position.z), null, `inside a solid at ${p.position.x.toFixed(1)}, ${p.position.z.toFixed(1)} (dt ${dt.toFixed(4)})`);
      }
      // Not stuck: some direction still gives a metre within a second.
      let best = 0;
      for (let a = 0; a < 8 && best < 1; a += 1) {
        const probe = createPlayerController(collider.bvh, collider.solids);
        probe.spawn(p.position.x, p.position.y, p.position.z);
        for (let i = 0; i < 60; i += 1) probe.step(1 / 60, { forward: 1, strafe: 0, sprint: false, jump: false, yaw: (a / 8) * Math.PI * 2 }, speeds);
        best = Math.max(best, Math.hypot(probe.position.x - p.position.x, probe.position.z - p.position.z));
      }
      assert.ok(best >= 1, `stuck at ${p.position.x.toFixed(1)}, ${p.position.z.toFixed(1)} (dt ${dt.toFixed(4)})`);
    }
  }
}

console.log('plaza collider ok');
