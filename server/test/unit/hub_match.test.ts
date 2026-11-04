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
