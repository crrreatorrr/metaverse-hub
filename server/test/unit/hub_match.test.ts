// Plaza match: 100 cap, rejoin grace, zone-filtered deltas, scope, placement RPC.
import assert from 'node:assert/strict';
import { loadModule, plain, presence, type Presence } from './harness';

const mod = loadModule();
const HUB = { vars: { scope: 'hub' } };
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (n: number): Presence => presence(uid(n), `p${n}`, `sess-${n}`);

// Shard 1 is created at boot.
const boot = [...mod.nk.matches.values()].filter((m) => m.module === 'hub');
assert.equal(boot.length, 1);
assert.deepEqual(JSON.parse(boot[0]!.label), { game: 'hub', kind: 'hub', shard: 1, players: 0, max: 100, open: true });

{
  const m = mod.startMatch('hub', { shard: '7' });
  assert.equal(JSON.parse(m.match.label).shard, 7);

  // Game-scoped sessions are rejected.
  assert.deepEqual(m.joinAttempt(P(1), { vars: { scope: 'game', game: 'nobu', sid: uid(999) } }), { accept: false, rejectMessage: 'wrong_scope' });
  assert.equal(m.joinAttempt(P(1), { vars: null }).accept, true, 'no vars = device/email session');

  // Join 2 players: joiner gets SNAPSHOT, others get ROSTER add.
  m.join([P(1)], HUB);
  m.dispatcher.clear();
  m.join([P(2)], HUB);
  const snap = m.dispatcher.sent<{ you: number; roster: { u: string }[]; p: number[][] }>(2);
  assert.equal(snap.length, 1);
  assert.equal(snap[0]!.to![0]!.userId, uid(2));
  assert.equal(snap[0]!.body.you, 1);
  assert.deepEqual(plain(snap[0]!.body.roster.map((e) => e.u)), [uid(1), uid(2)]);
  const add = m.dispatcher.sent<{ add: { u: string; n: string }[] }>(4);
  assert.equal(add[0]!.to!.length, 1);
  assert.equal(add[0]!.body.add[0]!.u, uid(2));
  assert.equal(JSON.parse(m.match.label).players, 2);

  // Deltas: only changed slots, POSE validated.
  m.dispatcher.clear();
  m.loop([{ sender: P(1), opCode: 1, data: [100, 178, 4200, 64, 1] }]);
  let deltas = m.dispatcher.sent<{ p: number[][] }>(3);
  assert.equal(deltas.length, 1);
  assert.deepEqual(plain(deltas[0]!.body.p), [[0, 100, 178, 4200, 64, 1]]);
  m.dispatcher.clear();
  m.loop([]);
  assert.equal(m.dispatcher.sent(3).length, 0, 'nothing changed, no delta');
  m.loop([{ sender: P(1), opCode: 1, data: [100, 178, 4200, 64, 1] }]);
  assert.equal(m.dispatcher.sent(3).length, 0, 'same pose, no delta');
  m.loop([{ sender: P(1), opCode: 1, data: [5000, 178, 4200, 64, 1] }]);
  assert.equal(m.dispatcher.sent(3).length, 0, 'a 49 m step in one tick is rejected');
  m.loop([{ sender: P(1), opCode: 1, data: [100, 178, 4200, 300, 1] }]);
  m.loop([{ sender: P(1), opCode: 1, data: '[1,2,3]' }]);
  m.loop([{ sender: P(1), opCode: 1, data: 'x'.repeat(70) }]);
  assert.equal(m.dispatcher.sent(3).length, 0, 'bad yaw / short / oversize bodies are dropped');
  // Latest pose per tick wins.
  m.loop([
    { sender: P(2), opCode: 1, data: [10, 178, 4200, 0, 0] },
    { sender: P(2), opCode: 1, data: [20, 178, 4200, 0, 0] },
  ]);
  deltas = m.dispatcher.sent<{ p: number[][] }>(3);
  assert.deepEqual(plain(deltas[0]!.body.p), [[1, 20, 178, 4200, 0, 0]]);

  // Zone filter: player 2 walks into the bar (teleport allowed across zones).
  m.dispatcher.clear();
  m.loop([{ sender: P(2), opCode: 1, data: [0, -29800, 0, 0, 0] }]);
  m.dispatcher.clear();
  m.loop([
    { sender: P(1), opCode: 1, data: [200, 178, 4200, 0, 1] },
    { sender: P(2), opCode: 1, data: [100, -29800, 0, 0, 1] },
  ]);
  deltas = m.dispatcher.sent<{ p: number[][] }>(3);
  assert.equal(deltas.length, 2, 'one delta per occupied zone');
  for (const d of deltas) {
    assert.equal(d.to!.length, 1);
    const row = d.body.p[0]!;
    assert.equal(d.to![0]!.userId, row[0] === 0 ? uid(1) : uid(2));
  }

  // TRAVEL and PROFILE go out as roster upd.
  m.dispatcher.clear();
  m.loop([
    { sender: P(1), opCode: 7, data: { game: 'nobu' } },
    { sender: P(1), opCode: 5, data: { character: 'wizard', staff: 'oak', pet: 'pup' } },
  ]);
  const upd = m.dispatcher.sent<{ upd: { g: string; c: string; st: string; pt: string }[] }>(4);
  assert.equal(upd[0]!.body.upd[0]!.g, 'nobu');
  assert.equal(upd[0]!.body.upd[0]!.c, 'wizard');
  assert.equal(m.signal('status'), JSON.stringify({ shard: 7, players: 2, games: { nobu: 1 } }));

  // Emote rate: 1 per second.
  m.dispatcher.clear();
  m.loop([{ sender: P(1), opCode: 6, data: { e: 'wave' } }]);
  m.loop([{ sender: P(1), opCode: 6, data: { e: 'wave' } }]);
  m.loop([{ sender: P(1), opCode: 6, data: { e: 'moonwalk' } }]);
  assert.equal(m.dispatcher.sent(6).length, 1);

  // Leave → away (roster upd), rejoin within grace gets a SNAPSHOT with the old pose.
  m.dispatcher.clear();
  m.leave([P(1)]);
  const away = m.dispatcher.sent<{ upd: { u: string; away: boolean }[] }>(4);
  assert.equal(away[0]!.body.upd[0]!.away, true);
  assert.equal(JSON.parse(m.match.label).players, 1);
  m.ticks(5);
  m.dispatcher.clear();
  const back = { ...P(1), sessionId: 'sess-1b' };
  assert.equal(m.join([back], HUB)[0]!.accept, true);
  const resnap = m.dispatcher.sent<{ you: number; p: number[][] }>(2);
  assert.equal(resnap[0]!.body.you, 0);
  assert.deepEqual(plain(resnap[0]!.body.p.find((r) => r[0] === 0)), [0, 200, 178, 4200, 0, 1]);
  // The stale session's late leave is ignored.
  m.leave([P(1)]);
  assert.equal(JSON.parse(m.match.label).players, 2);

  // Grace expiry → del.
  m.leave([P(2)]);
  m.dispatcher.clear();
  m.ticks(200);
  const del = m.dispatcher.sent<{ del?: number[] }>(4).filter((r) => r.body.del);
  assert.deepEqual(plain(del[0]!.body.del), [1]);

  // A second tab of the same user takes over the slot and the old presence is kicked.
  m.dispatcher.clear();
  const tab2 = { ...back, sessionId: 'sess-1c' };
  m.join([tab2], HUB);
  assert.equal(m.dispatcher.kicks.length, 1);
  assert.equal(m.dispatcher.kicks[0]![0]!.sessionId, 'sess-1b');
}

// Capacity: 100 joins, #101 rejected with "full"; label closes at the soft cap.
{
  const m = mod.startMatch('hub', { shard: '8' });
  for (let i = 0; i < 100; i += 1) {
    assert.equal(m.join([P(1000 + i)], HUB)[0]!.accept, true, `join ${i}`);
    if (i === 88) assert.equal(JSON.parse(m.match.label).open, true);
    if (i === 89) assert.equal(JSON.parse(m.match.label).open, false, 'closed for placement at 90');
  }
  assert.deepEqual(m.joinAttempt(P(2000), HUB), { accept: false, rejectMessage: 'full' });
  // One broadcast per zone per tick even with 100 movers.
  m.dispatcher.clear();
  m.loop(Array.from({ length: 100 }, (_v, i) => ({ sender: P(1000 + i), opCode: 1, data: [i, 178, 4200, 0, 1] })));
  const deltas = m.dispatcher.sent<{ p: number[][] }>(3);
  assert.equal(deltas.length, 1);
  assert.equal(deltas[0]!.body.p.length, 100);
  const bytes = m.dispatcher.broadcasts.find((b) => b.opCode === 3)!.data.length;
  assert.ok(bytes < 3200, `full delta is ${bytes} bytes`);
}

// Empty shards close after 2 minutes; shard 1 never does.
{
  const two = mod.startMatch('hub', { shard: '2' });
  assert.equal(two.ticks(1199), true);
  assert.equal(two.loop([]), false, 'shard 2 closes when empty for 120 s');
  const one = mod.startMatch('hub', { shard: '1' });
  assert.equal(one.ticks(1300), true);
}

// hub.join: hub scope only, least-full placement, room name, rate limit.
{
  const m2 = loadModule();
  const first = m2.call<{ matchId: string; shard: number; room: string }>('hub.join', { userId: uid(1), ...HUB }, {});
  assert.equal(first.shard, 1);
  assert.equal(first.room, 'hub.1');
  assert.equal(m2.call<{ error: string }>('hub.join', { userId: uid(2), vars: { scope: 'game', game: 'nobu', sid: uid(3) } }, {}).error, 'wrong_scope');
  const shard1 = m2.driver(first.matchId);
  for (let i = 0; i < 90; i += 1) shard1.join([P(3000 + i)], HUB);
  const next = m2.call<{ matchId: string; shard: number; room: string }>('hub.join', { userId: uid(4), ...HUB }, { prefer: first.matchId });
  assert.equal(next.shard, 2, 'a full shard 1 opens shard 2');
  assert.equal(next.room, 'hub.2');
  for (let i = 0; i < 6; i += 1) m2.call('hub.join', { userId: uid(5), ...HUB }, {});
  assert.equal(m2.call<{ error: string }>('hub.join', { userId: uid(5), ...HUB }, {}).error, 'rate_limited');
}

console.log('hub match tests ok');

// Realm placement keeps the no-realm contract byte-for-byte and isolates pools.
{
  const realms = loadModule();
  type Placed = { matchId: string; shard: number; room: string; error?: string };
  const join = (n: number, body: object) => realms.call<Placed>('hub.join', { userId: uid(n), ...HUB }, body);
  const plaza = join(8000, {});
  assert.equal(plaza.room, 'hub.1', 'join_without_realm_is_plaza');
  assert.equal(realms.nk.matches.get(plaza.matchId)!.label, '{"game":"hub","kind":"hub","shard":1,"players":0,"max":100,"open":true}', 'plaza label stays byte-identical');
  const before = realms.nk.matches.size;
  assert.equal(join(8001, { realm: 'nope' }).error, 'bad_realm', 'join_unknown_realm_fails');
  assert.equal(realms.nk.matches.size, before, 'unknown realm creates no match');
  const sandbox = join(8002, { realm: 'sandbox', prefer: plaza.matchId });
  assert.equal(sandbox.room, 'hub.sandbox.1', 'join_sandbox_places_separately');
  assert.notEqual(sandbox.matchId, plaza.matchId, 'prefer_from_other_realm_is_ignored');
  assert.equal(JSON.parse(realms.nk.matches.get(sandbox.matchId)!.label).kind, 'hub_sandbox');
  assert.equal(join(8003, { prefer: sandbox.matchId }).matchId, plaza.matchId, 'cross-realm prefer ignored in both directions');
  const empty = realms.startMatch('hub', { shard: '1', realm: 'sandbox' });
  assert.equal(empty.ticks(1199), true);
  assert.equal(empty.loop([]), false, 'sandbox_shard_one_closes_when_empty');
  const always = realms.startMatch('hub', { shard: '1' });
  assert.equal(always.ticks(1300), true, 'plaza_shard_one_stays_open');
  for (const id of ['plaza', 'sandbox']) {
    const m = realms.startMatch('hub', { realm: id, shard: '3' });
    m.join([P(8100)], HUB);
    const state = m.state as { slots: { x: number; y: number; z: number }[] };
    assert.deepEqual([state.slots[0]!.x, state.slots[0]!.y, state.slots[0]!.z], id === 'sandbox' ? [0, 178, 0] : [0, 178, 4200]);
    m.loop([{ sender: P(8100), opCode: 1, data: [0, -30000, 0, 0, 0] }]);
    assert.equal(state.slots[0]!.y, id === 'sandbox' ? 178 : -30000, 'sandbox_bounds_reject_interior_band');
  }
}

// A trip shorter than the rejoin grace keeps the slot: the Relic it earned is in the roster at once.
{
  const trip = loadModule();
  let owned: string[] = [];
  trip.nk.onSql(/FROM game\.relic_claim WHERE user_id = ANY/, () => (owned.length ? [{ user_id: uid(9201), relics: JSON.stringify(owned) }] : []));
  trip.nk.onSql(/AT TIME ZONE/, () => [{ result: '2026-11-19T00:00:00Z' }]);
  const m = trip.startMatch('hub', { shard: '11' });
  m.join([P(9201)], HUB);
  const st = m.state as { slots: { relics: string[] }[] };
  assert.deepEqual(plain(st.slots[0]!.relics), []);
  m.leave([P(9201)]);
  owned = ['tinubu_crown'];
  m.ticks(5);
  m.dispatcher.clear();
  m.join([{ ...P(9201), sessionId: 'sess-9201b' }], HUB);
  assert.deepEqual(plain(st.slots[0]!.relics), ['tinubu_crown'], 'a rejoin within grace re-reads Relics');
  const snap = m.dispatcher.sent<{ you: number; roster: { u: string; r: string[] }[] }>(2);
  assert.deepEqual(plain(snap[0]!.body.roster[0]!.r), ['tinubu_crown'], 'and the snapshot carries them');
  // A failed read keeps the list the slot already has.
  m.leave([{ ...P(9201), sessionId: 'sess-9201b' }]);
  owned = [];
  m.ticks(5);
  m.join([{ ...P(9201), sessionId: 'sess-9201c' }], HUB);
  assert.deepEqual(plain(st.slots[0]!.relics), ['tinubu_crown']);
}

// Pets: read in one batch at join, never in the loop; loadout.set_hub signals the shard (handoff §3.1).
{
  const pets = loadModule();
  pets.nk.onSql(/FROM game\.relic_claim WHERE user_id = ANY/, () => [{ user_id: uid(9001), relics: JSON.stringify(['tinubu_crown']) }]);
  pets.nk.onSql(/AT TIME ZONE/, () => [{ result: '2026-11-19T00:00:00Z' }]);
  const m = pets.startMatch('hub', { shard: '9' });
  // 9001 owns the Wizard pet through Tinubu's Crown and has it equipped; 9002 has no loadout row (default pet).
  pets.nk.storage.set(`loadout/hub/${uid(9001)}`, { value: { v: 1, slots: { pet: 'pet_wizard' }, seq: 1 }, version: 'v1', permissionRead: 1, permissionWrite: 0 });
  const before = pets.nk.sqlCalls.length;
  m.join([P(9001), P(9002)], HUB);
  const joinSql = pets.nk.sqlCalls.slice(before).map((c) => c.sql);
  assert.equal(joinSql.filter((sql) => sql.includes('game.item_owned')).length, 1, 'one batched item_owned read for the whole join');
  assert.equal(pets.nk.storage.has(`pets/owned/${uid(9001)}`), false, 'the join writes no entitlement snapshot');
  const st = m.state as { slots: { pet: string }[] };
  assert.equal(st.slots[0]!.pet, 'pet_wizard');
  assert.equal(st.slots[1]!.pet, 'pet_pepe_bull');

  // OP_PROFILE in the loop: no SQL and no storage read.
  const sqlBefore = pets.nk.sqlCalls.length;
  const reads = { n: 0 };
  type Read = (keys: { collection: string; key: string; userId: string }[]) => unknown[];
  const fake = pets.nk as unknown as { storageRead: Read };
  const read = fake.storageRead.bind(fake);
  fake.storageRead = (keys) => { reads.n += 1; return read(keys); };
  m.dispatcher.clear();
  m.loop([{ sender: P(9001), opCode: 5, data: { character: 'wizard', staff: 'sproto', pet: 'pet_mecha' } }]);
  assert.equal(pets.nk.sqlCalls.length, sqlBefore, 'OP_PROFILE runs no SQL');
  assert.equal(reads.n, 0, 'OP_PROFILE reads no storage');
  assert.equal(st.slots[0]!.pet, 'pet_wizard', 'the client cannot pick its pet over the socket');
  fake.storageRead = read;

  // Equip the starter: set_hub signals every hub shard and the roster carries it on the next loop.
  const ack = pets.call<{ ok: boolean }>('loadout.set_hub', { userId: uid(9001), vars: { scope: 'hub' } }, { pet: 'pet_starter', seq: 2 });
  assert.equal(ack.ok, true);
  assert.ok(pets.nk.signals.some((sig) => sig.matchId === m.match.matchId && JSON.parse(sig.data).op === 'pet'));
  m.dispatcher.clear();
  m.loop([]);
  const upd = m.dispatcher.sent<{ upd: { u: string; pt: string }[] }>(4);
  assert.equal(upd[0]!.body.upd.find((e) => e.u === uid(9001))!.pt, 'pet_starter');
  assert.equal(m.signal(JSON.stringify({ op: 'pet', u: uid(9001), pet: 'Bad Id!' })), '', 'a malformed pet signal is ignored');
  console.log('hub match pets ok');
}

// AOI (handoff §3.2): full rate within the 3x3 grid cells, 2 Hz beyond, same {t, p} message.
{
  const aoi = loadModule();
  const m = aoi.startMatch('hub', { shard: '11' });
  m.join([P(9101), P(9102), P(9103)], HUB);
  // 9101 and 9102 stand together near the fountain; 9103 is 100 m away.
  m.loop([
    { sender: P(9101), opCode: 1, data: [100, 178, 4200, 0, 1] },
    { sender: P(9102), opCode: 1, data: [300, 178, 4200, 0, 1] },
    { sender: P(9103), opCode: 1, data: [100, 178, -5800, 0, 1] },
  ]);
  const rowsFor = (user: string) => m.dispatcher.sent<{ p: number[][] }>(3).filter((d) => d.to!.some((p) => p.userId === user)).flatMap((d) => d.body.p.map((r) => r[0]));
  // Walk 9101 for ten ticks; 9102 sees every step, 9103 only the far ticks.
  m.dispatcher.clear();
  for (let i = 1; i <= 10; i += 1) m.loop([{ sender: P(9101), opCode: 1, data: [100 + i * 50, 178, 4200, 0, 1] }]);
  assert.equal(rowsFor(uid(9102)).filter((s) => s === 0).length, 10, 'a neighbour gets every move');
  const far = rowsFor(uid(9103)).filter((s) => s === 0).length;
  assert.ok(far >= 1 && far <= 3, `a far player gets the mover at 2 Hz (got ${far} of 10)`);
  // The last position always reaches the far player by the next far tick.
  m.dispatcher.clear();
  for (let i = 0; i < 5; i += 1) m.loop([]);
  const lastFar = m.dispatcher.sent<{ p: number[][] }>(3).filter((d) => d.to!.some((p) => p.userId === uid(9103))).flatMap((d) => d.body.p).filter((r) => r[0] === 0);
  assert.ok(lastFar.length <= 1);
  const seenByFar = [...rowsFor(uid(9103))];
  assert.ok(seenByFar.length <= 1, 'nothing repeats once the far player is up to date');

  // 100 movers spread over the plaza: bytes per client against the old zone-wide broadcast.
  const big = aoi.startMatch('hub', { shard: '12' });
  const ids = Array.from({ length: 100 }, (_v, i) => 9200 + i);
  for (const n of ids) big.join([P(n)], HUB);
  const at = (i: number, t: number) => [-12000 + (i % 10) * 2600 + (t % 2) * 40, 178, -12000 + Math.floor(i / 10) * 2600, 0, 1];
  big.loop(ids.map((n, i) => ({ sender: P(n), opCode: 1, data: at(i, 0) })));
  big.dispatcher.clear();
  const TICKS = 50;
  let oldBytes = 0;
  for (let t = 1; t <= TICKS; t += 1) {
    big.loop(ids.map((n, i) => ({ sender: P(n), opCode: 1, data: at(i, t) })));
    // What the zone-wide delta sent: every row to every player.
    oldBytes += JSON.stringify({ t, p: ids.map((_n, i) => [i, ...at(i, t)]) }).length * ids.length;
  }
  let newBytes = 0;
  for (const b of big.dispatcher.broadcasts.filter((x) => x.opCode === 3)) newBytes += b.data.length * (b.presences?.length ?? 0);
  const perClient = (bytes: number) => Math.round(bytes / ids.length / (TICKS / 10));
  console.log(`hub AOI: 100 movers over the plaza, delta bytes/s per client ${perClient(oldBytes)} zone-wide -> ${perClient(newBytes)} AOI`);
  assert.ok(newBytes < oldBytes / 2, 'AOI at least halves delta bandwidth for a spread-out crowd');
  console.log('hub match AOI ok');
}

// Character allowlist (handoff §4.3): the server list equals the plaza's, and anything else keeps the look.
{
  const { readFileSync } = await import('node:fs');
  const cfg = readFileSync(new URL('../../../apps/hub/src/config.ts', import.meta.url), 'utf8');
  const block = cfg.slice(cfg.indexOf('export const CHARACTERS = ['), cfg.indexOf('] as const;', cfg.indexOf('export const CHARACTERS = [')));
  const plaza = [...block.matchAll(/id: '([a-z0-9_-]+)'/g)].map((x) => x[1]);
  const chars = loadModule();
  assert.deepEqual(plain((chars.global.HubMatch as { CHARACTERS: string[] }).CHARACTERS), plaza, 'server CHARACTERS match apps/hub/src/config.ts');
  const m = chars.startMatch('hub', { shard: '13' });
  m.join([P(9301)], HUB);
  m.loop([{ sender: P(9301), opCode: 5, data: { character: 'wizard', staff: 'sproto' } }]);
  for (let i = 0; i < 25; i += 1) m.loop([]);
  m.loop([{ sender: P(9301), opCode: 5, data: { character: 'definitely-not-a-skin', staff: 'sproto' } }]);
  assert.equal((m.state as { slots: { character: string }[] }).slots[0]!.character, 'wizard');
  console.log('hub match characters ok');
}

// AOI catch-up (review): a receiver that walks into a mover's neighbourhood after the mover stopped
// gets the mover's last position on the next far tick.
{
  const aoi = loadModule();
  const m = aoi.startMatch('hub', { shard: '14' });
  m.join([P(9401), P(9402)], HUB);
  m.loop([
    { sender: P(9401), opCode: 1, data: [100, 178, 4200, 0, 1] },
    { sender: P(9402), opCode: 1, data: [100, 178, -5800, 0, 1] },
  ]);
  for (let i = 0; i < 6; i += 1) m.loop([]);
  m.dispatcher.clear();
  // 9401 takes three steps and stops; 9402 then walks over next to it (cell jumps are allowed per tick within 49 m steps).
  for (let i = 1; i <= 3; i += 1) m.loop([{ sender: P(9401), opCode: 1, data: [100 + i * 100, 178, 4200, 0, 1] }]);
  for (let z = -5800 + 4000, k = 0; k < 3; z += 4000, k += 1) m.loop([{ sender: P(9402), opCode: 1, data: [100, 178, Math.min(z, 4000), 0, 1] }]);
  for (let i = 0; i < 6; i += 1) m.loop([]);
  const rows = m.dispatcher.sent<{ p: number[][] }>(3).filter((d) => d.to!.some((p) => p.userId === uid(9402))).flatMap((d) => d.body.p).filter((r) => r[0] === 0);
  assert.ok(rows.length >= 1, 'the late arrival gets the mover');
  assert.equal(rows.at(-1)![1], 400, "the late arrival sees the mover's final x");
  console.log('hub match AOI catch-up ok');
}
