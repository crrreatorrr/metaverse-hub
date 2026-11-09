// Sims (Menu → Sims): the dialogue director, the walkers in the RemoteWorld, and the stored list.
import assert from 'node:assert/strict';
import { createRemoteWorld } from '../src/net/remoteWorld';
import script from '../src/sims/script.json';
import { ACTS, PERSONAS, QUIET, SIM_STORY, SimDirector, actAt } from '../src/sims/director';
import { MAX_SIMS, SIM_AREA, createSims, isSimUser, simUserId, type SimSpec } from '../src/sims/sims';
import { cleanSimName, defaultSimName, validSims } from '../src/sims/store';

const end = SIM_STORY.actStartTicks[SIM_STORY.actStartTicks.length - 1]!;
const cast = PERSONAS.map((p, i) => ({ key: `sim:${i}`, persona: p.id }));

// Acts follow the start ticks.
{
  assert.equal(actAt(0), 'loop');
  SIM_STORY.actStartTicks.forEach((t, i) => assert.equal(actAt(t), ACTS[i]));
}

// Every line fits hub chat (80 characters).
{
  const lines: string[] = [];
  for (const c of script.characters) lines.push(...c.loop, ...c.reverie, ...c.maze, ...c.behind, ...c.awake);
  for (const pool of Object.values(script.shared)) lines.push(...pool);
  for (const s of script.scenes) lines.push(...s.lines.map((l) => l.text));
  assert.ok(lines.length > 200);
  for (const text of lines) assert.ok(text.replaceAll('{uid}', 'sim:abcdefgh').length <= 80, text);
}

// The loop act: a persona repeats its own loop lines in order.
{
  const d = new SimDirector({ seed: 3 });
  d.setCast([{ key: 'a', persona: 'rue' }, { key: 'q', persona: QUIET }]);
  const said: string[] = [];
  for (let t = 0; t < 140; t += 1) {
    const out = d.step();
    assert.equal(out.has('q'), false, 'a quiet sim never talks');
    const line = out.get('a');
    if (line) said.push(line.text);
  }
  const loop = script.characters.find((c) => c.id === 'rue')!.loop;
  assert.ok(said.length > 3);
  const start = loop.indexOf(said[0]!);
  said.forEach((line, k) => assert.equal(line, loop[(start + k) % loop.length]));
}

// The whole cast: every scene plays once, in order, and the chorus is everyone.
{
  const d = new SimDirector({ seed: 5 });
  d.setCast(cast);
  const said: string[] = [];
  for (let t = 0; t < end + 200; t += 1) for (const line of d.step().values()) said.push(line.text);
  let from = 0;
  for (const s of script.scenes) {
    const at = said.indexOf(s.lines[0]!.text.replaceAll('{uid}', 'sim:6'), from);
    assert.ok(at >= from, `scene ${s.id}`);
    from = at;
  }
  assert.equal(said.filter((l) => l === 'The Hash remembers. And so do we.').length, PERSONAS.length);
  for (const c of cast) assert.equal(d.actOf(c.key), 'free');
}

// A scene with only one of its speakers present is skipped.
{
  const d = new SimDirector({ seed: 1, speed: 50 });
  d.setCast([{ key: 'x', persona: 'dee' }]);
  const said: string[] = [];
  for (let t = 0; t < 60; t += 1) for (const line of d.step().values()) if (line.scene) said.push(line.text);
  assert.ok(!said.includes(script.scenes[0]!.lines[0]!.text));
}

// Speed and restart.
{
  const d = new SimDirector({ speed: 10 });
  d.setCast(cast);
  for (let t = 0; t < 40; t += 1) d.step();
  assert.equal(d.storyTick(), 400);
  d.restart();
  assert.equal(d.storyTick(), 0);
}

// Walkers: added to the RemoteWorld beside real players, survive a snapshot, leave on removal.
{
  const world = createRemoteWorld();
  const heard: string[] = [];
  let clock = 0;
  const sims = createSims({ world, autoRun: false, now: () => clock, speed: 50, seed: 2, onLine: (_id, name, text) => heard.push(`${name}: ${text}`) });
  const list: SimSpec[] = PERSONAS.map((p, i) => ({ id: `s${i}`, name: p.name, character: 'wizard', persona: p.id }));
  sims.set(list);
  assert.equal(world.players.size, list.length);
  assert.ok(world.byUser(simUserId('s0')));
  assert.equal(world.presentCount(), 0, 'sims are not counted as players');
  assert.ok(isSimUser(simUserId('s0')));

  // A server snapshot with one real player replaces the roster; the sims come back.
  world.applySnapshot({ t: 0, you: 1, shard: 1, roster: [{ s: 2, u: 'real', n: 'Real', c: 'wizard', st: 'sproto', pt: '', r: [], g: '', away: false }], p: [] }, 0);
  assert.equal(world.players.size, list.length + 1);
  assert.equal(world.presentCount(), 1);

  const before = sims.positionOf('s0')!;
  // A minute of play (at 50x story speed the first scenes start right away).
  for (let i = 0; i < 600; i += 1) {
    clock += 100;
    sims.tick(100);
  }
  const after = sims.positionOf('s0')!;
  assert.ok(before.x !== after.x || before.z !== after.z, 'sims walk');
  assert.ok(heard.length > 10, 'sims talk');
  assert.ok(heard[0]!.includes(': '));

  // Fast-forward until everyone is awake, then at normal speed they gather in a ring.
  sims.restart();
  const allAwake = () => list.every((s) => sims.director.actOf(simUserId(s.id)) === 'awake');
  for (let i = 0; i < 5000 && !allAwake(); i += 1) sims.tick(100);
  assert.ok(allAwake());
  sims.setSpeed(1);
  for (let i = 0; i < 300; i += 1) sims.tick(100);
  for (const s of list) {
    const p = sims.positionOf(s.id)!;
    const r = Math.hypot(p.x - SIM_AREA.cx, p.z - SIM_AREA.cz);
    assert.ok(Math.abs(r - SIM_AREA.rGather) < 0.2, `${s.name} in the ring (${r.toFixed(2)})`);
  }

  // Renaming updates the roster; removing takes them out.
  sims.set([{ ...list[0]!, name: 'Renamed' }]);
  assert.equal(world.byUser(simUserId('s0'))!.name, 'Renamed');
  assert.equal(world.players.size, 2);
  sims.dispose();
  assert.equal(world.players.size, 1);
}

// The stored list: bad entries dropped, names cleaned, capped.
{
  assert.equal(cleanSimName('  Hi<b>there!!  '), 'Hibthere');
  assert.equal(defaultSimName('hollis', 'wizard'), 'HollisMines');
  assert.equal(defaultSimName(QUIET, 'broccoli'), 'Broccoli Hea');
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `id${i}`, name: '', character: 'nope', persona: 'nope' }));
  const valid = validSims([null, { id: 'BAD ID' }, { id: 'ok', name: 'X', character: 'sahil', persona: 'penny' }, { id: 'ok' }, ...many]);
  assert.equal(valid.length, MAX_SIMS);
  assert.deepEqual(valid[0], { id: 'ok', name: 'X', character: 'sahil', persona: 'penny' });
  assert.equal(valid[1]!.persona, QUIET);
  assert.equal(valid[1]!.character, 'wizard');
  assert.deepEqual(validSims('nope'), []);
}

console.log('sims tests passed');
