// Coop wire savings (Sproto-Coop-Battle docs/coop-server-contract.md, "Optional: input batches and
// snapshot deltas"): coop.version advertises them only when the vendored bundle has the helpers,
// a { t: 'inputs', batch } message is checked item by item like single inputs, and a socket that
// joined with snapDelta: '1' gets deltas that rebuild exactly the full envelopes everyone else gets.
import assert from 'node:assert/strict';
import { loadModule, presence, type LoadedModule, type MatchDriver, type Presence } from '../unit/harness';

const FP = '3fddedd1b65c0e2d71600e54822e0db5c66b45ac765535b7d0e88c2cf262e97b';
const PROTO = 1;
const USERS = [0, 1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000001${n}`);
const OP = { HELLO: 1, WELCOME: 2, READY: 3, START: 4, INPUT: 10, SNAPSHOT: 11, REJECT: 13, RESUME: 14 };
const DELTA_KIND = 'sproto-coop-battle-snapshot-delta';

interface Snap { kind: string; matchId: string; tick: number; loop: number; state: Record<string, unknown>; base?: number; baseTick?: number }
interface Api {
  LIMITS: { snapshotKeyframeLoops: number; inputBatchMax: number; maxInputBytes: number };
  splitInputBatch?: unknown;
  snapshotDelta?: unknown;
  applySnapshotDelta(base: Snap, delta: Snap): { ok: boolean; envelope?: Snap; reason?: string };
}

function game(userId: string, sessionId = `s-${userId}`) {
  return { userId, sessionId, username: 'ada', vars: { scope: 'game', game: 'sproto-coop-battle', sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } };
}

function load(strip = false): LoadedModule {
  const mod = loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
  if (strip) {
    // A bundle from before Coop 4f142a78: no helpers, so neither feature is on.
    const api = mod.global.CoopProtocol as Record<string, unknown>;
    delete api.splitInputBatch;
    delete api.snapshotDelta;
  }
  return mod;
}

function meta(delta: boolean): Record<string, string> {
  const out: Record<string, string> = { protocol: String(PROTO), fingerprint: FP, v: String(PROTO), sim: FP };
  if (delta) out.snapDelta = '1';
  return out;
}

interface Run { mod: LoadedModule; m: MatchDriver; players: Presence[] }

/** A private room, players joined with the given snapDelta choices, all seated and ready (so playing). */
function start(deltas: boolean[], strip = false): Run {
  const mod = load(strip);
  const created = mod.call<{ matchId: string; error?: string }>('coop.room_create', game(USERS[0]!), {});
  assert.equal(created.error, undefined, JSON.stringify(created));
  const m = mod.driver(created.matchId);
  const players = deltas.map((_d, i) => presence(USERS[i]!, `p${i}`, `s-${USERS[i]}`));
  players.forEach((p, i) => {
    assert.equal(m.join([p], game(p.userId, p.sessionId), meta(deltas[i]!))[0]?.accept, true);
    m.loop([{ sender: p, opCode: OP.HELLO, data: { t: 'hello', protocol: PROTO, fingerprint: FP, devices: ['k1'] } }]);
  });
  for (const p of players) m.loop([{ sender: p, opCode: OP.READY, data: { t: 'ready' } }]);
  assert.equal((m.state as { phase: string }).phase, 'playing');
  return { mod, m, players };
}

function tickOf(m: MatchDriver): number {
  return (m.state as { session: { state: { t: number } } }).session.state.t;
}

function slotOf(m: MatchDriver, userId: string): number {
  const seats = (m.state as { session: { seats: { slot: number; accountId: string | null }[] } }).session.seats;
  return seats.find((seat) => seat.accountId === userId)!.slot;
}

/** OP_SNAPSHOT bodies each presence received, in order. */
function snapshotsFor(m: MatchDriver, p: Presence): Snap[] {
  return m.dispatcher.broadcasts
    .filter((b) => b.opCode === OP.SNAPSHOT && (b.presences === null || b.presences.some((to) => to.sessionId === p.sessionId)))
    .map((b) => JSON.parse(b.data) as Snap);
}

function rejects(m: MatchDriver, p: Presence): string[] {
  return m.dispatcher.broadcasts
    .filter((b) => b.opCode === OP.REJECT && b.presences !== null && b.presences.some((to) => to.sessionId === p.sessionId))
    .map((b) => (JSON.parse(b.data) as { reason: string }).reason);
}

// coop.version advertises both features with this bundle, neither without the helpers.
{
  const version = load().call<{ features?: { inputBatch: boolean; snapshotDelta: boolean }; fingerprint: string }>('coop.version', game(USERS[0]!), {});
  assert.equal(version.fingerprint, FP);
  assert.deepEqual(version.features, { inputBatch: true, snapshotDelta: true });
  const old = load(true).call<{ features?: { inputBatch: boolean; snapshotDelta: boolean } }>('coop.version', game(USERS[0]!), {});
  assert.deepEqual(old.features, { inputBatch: false, snapshotDelta: false });
  const api = load().global.CoopProtocol as Api;
  assert.equal(api.LIMITS.snapshotKeyframeLoops, 60);
  assert.equal(api.LIMITS.inputBatchMax, 3);
}

// Input batches: each item is checked as if it had arrived alone.
{
  const run = start([false]);
  const [p] = run.players as [Presence];
  const slot = slotOf(run.m, p.userId);
  const item = (seq: number, frame: number, s = slot) => ({ t: 'input', seq, frame, seats: [{ slot: s, device: 'k1', mask: 1 }] });
  run.m.dispatcher.clear();

  // Three substeps in one message: applied, nothing rejected.
  let t = tickOf(run.m);
  run.m.loop([{ sender: p, opCode: OP.INPUT, data: { t: 'inputs', batch: [item(1, t + 1), item(2, t + 2), item(3, t + 3)] } }]);
  assert.deepEqual(rejects(run.m, p), []);
  const seq = (run.m.state as { session: { seq: Record<string, number> } }).session.seq;
  assert.equal(Object.values(seq ?? {}).includes(3), true, `seq after a batch: ${JSON.stringify(seq)}`);

  // A replayed seq inside a batch is refused like a replayed single input.
  t = tickOf(run.m);
  run.m.dispatcher.clear();
  run.m.loop([{ sender: p, opCode: OP.INPUT, data: { t: 'inputs', batch: [item(3, t + 1)] } }]);
  assert.ok(rejects(run.m, p).length >= 1, 'a replayed seq is rejected');

  // Owner and frame checks per item: a batch gets exactly the answers the same items get as
  // separate messages in the same loop (a bad item there also neutralizes its loop's substeps).
  const same = (items: (s: number, t: number) => Record<string, unknown>[]) => {
    const one = start([false]);
    const two = start([false]);
    const p1 = one.players[0]!;
    const p2 = two.players[0]!;
    one.m.dispatcher.clear();
    two.m.dispatcher.clear();
    one.m.loop([{ sender: p1, opCode: OP.INPUT, data: { t: 'inputs', batch: items(slotOf(one.m, p1.userId), tickOf(one.m)) } }]);
    two.m.loop(items(slotOf(two.m, p2.userId), tickOf(two.m)).map((data) => ({ sender: p2, opCode: OP.INPUT, data })));
    const seqOf = (m: MatchDriver) => JSON.stringify((m.state as { session: { seq: unknown } }).session.seq);
    assert.deepEqual(rejects(one.m, p1), rejects(two.m, p2));
    assert.equal(seqOf(one.m), seqOf(two.m));
    return rejects(one.m, p1);
  };
  const mk = (seq: number, frame: number, s: number) => ({ t: 'input', seq, frame, seats: [{ slot: s, device: 'k1', mask: 1 }] });
  assert.ok(same((s, t) => [mk(1, t + 1, s), mk(2, t + 2, (s + 1) % 4)]).includes('owner'));
  assert.ok(same((s, t) => [mk(1, t + 1, s), mk(2, t + 9, s)]).includes('future'));
  assert.deepEqual(same((s, t) => [mk(1, t + 1, s), mk(2, t + 2, s), mk(3, t + 3, s)]), []);

  // splitInputBatch's own rules: 1-3 items, frames increasing, each t: 'input'.
  t = tickOf(run.m);
  for (const [batch, reason] of [
    [[], 'batch'],
    [[item(30, t + 1), item(31, t + 2), item(32, t + 3), item(33, t + 4)], 'batch'],
    [[item(34, t + 2), item(35, t + 1)], 'frame'],
    [[{ ...item(36, t + 1), t: 'god' }], 'schema'],
  ] as [unknown[], string][]) {
    run.m.dispatcher.clear();
    run.m.loop([{ sender: p, opCode: OP.INPUT, data: { t: 'inputs', batch } }]);
    assert.deepEqual(rejects(run.m, p), [reason], JSON.stringify(batch));
  }

  // A batch may exceed the single-input cap (768) up to the 2048-byte payload cap; a single input may not.
  const pad = 'x'.repeat(300);
  t = tickOf(run.m);
  run.m.dispatcher.clear();
  const wide = JSON.stringify({ t: 'inputs', batch: [{ ...item(40, t + 1), pad }, { ...item(41, t + 2), pad }] });
  assert.ok(wide.length > 768 && wide.length < 2048);
  run.m.loop([{ sender: p, opCode: OP.INPUT, data: wide }]);
  assert.equal(rejects(run.m, p).includes('oversized'), false, 'the batch is not refused for its size');
  run.m.dispatcher.clear();
  run.m.loop([{ sender: p, opCode: OP.INPUT, data: JSON.stringify({ ...item(42, t + 1), pad: 'x'.repeat(800) }) }]);
  assert.deepEqual(rejects(run.m, p), ['oversized']);
  run.m.dispatcher.clear();
  run.m.loop([{ sender: p, opCode: OP.INPUT, data: JSON.stringify({ t: 'inputs', batch: [{ ...item(43, t + 1), pad: 'x'.repeat(800) }] }) }]);
  assert.deepEqual(rejects(run.m, p), ['oversized'], 'each item keeps the single-input cap');
  run.m.dispatcher.clear();
  run.m.loop([{ sender: p, opCode: OP.INPUT, data: JSON.stringify({ t: 'inputs', batch: [{ ...item(44, t + 1), pad: 'x'.repeat(2100) }] }) }]);
  assert.deepEqual(rejects(run.m, p), ['oversized']);

  // The per-tick message cap counts batch items: six batches of three (18) pass sixteen.
  t = tickOf(run.m);
  run.m.dispatcher.clear();
  const many = Array.from({ length: 6 }, (_v, i) => ({ sender: p, opCode: OP.INPUT, data: { t: 'inputs', batch: [item(100 + 3 * i, t + 1), item(101 + 3 * i, t + 2), item(102 + 3 * i, t + 3)] } }));
  run.m.loop(many);
  assert.ok(rejects(run.m, p).includes('rate'), JSON.stringify(rejects(run.m, p)));

  // Without the helper a batch is refused, as before this bundle.
  const old = start([false], true);
  const q = old.players[0]!;
  const qs = slotOf(old.m, q.userId);
  old.m.dispatcher.clear();
  const ot = tickOf(old.m);
  old.m.loop([{ sender: q, opCode: OP.INPUT, data: { t: 'inputs', batch: [item(1, ot + 1, qs)] } }]);
  assert.deepEqual(rejects(old.m, q), ['rejected']);
}

// Snapshot deltas: only for sockets that asked; they rebuild the full envelopes exactly.
{
  const run = start([true, false]);
  const api = run.mod.global.CoopProtocol as Api;
  const [a, b] = run.players as [Presence, Presence];
  run.m.dispatcher.clear();
  run.m.ticks(150);
  const plain = snapshotsFor(run.m, b);
  const mixed = snapshotsFor(run.m, a);
  assert.ok(plain.length >= 70, `snapshots: ${plain.length}`);
  assert.equal(mixed.length, plain.length, 'one snapshot message per loop for each socket');
  assert.ok(plain.every((s) => s.kind !== DELTA_KIND), 'a socket without snapDelta gets only full envelopes');
  assert.notEqual(mixed[0]!.kind, DELTA_KIND, 'the first snapshot after the start is full');
  const deltas = mixed.filter((s) => s.kind === DELTA_KIND).length;
  assert.ok(deltas > mixed.length / 2, `deltas ${deltas} of ${mixed.length}`);
  let held: Snap | null = null;
  let lastFull = -Infinity;
  for (let i = 0; i < mixed.length; i += 1) {
    const got = mixed[i]!;
    let rebuilt: Snap;
    if (got.kind === DELTA_KIND) {
      assert.ok(held, 'a delta always has a base');
      assert.equal(got.base, held!.loop);
      assert.equal(got.baseTick, held!.tick);
      const applied = api.applySnapshotDelta(held!, got);
      assert.equal(applied.ok, true, applied.reason);
      rebuilt = applied.envelope!;
    } else {
      rebuilt = got;
      lastFull = got.loop;
    }
    assert.equal(JSON.stringify(rebuilt), JSON.stringify(plain[i]), `snapshot ${i} rebuilds the full envelope`);
    assert.ok(got.loop - lastFull < api.LIMITS.snapshotKeyframeLoops, `a full envelope at least every ${api.LIMITS.snapshotKeyframeLoops} loops`);
    held = rebuilt;
  }
  const fulls = mixed.filter((s) => s.kind !== DELTA_KIND).length;
  assert.ok(fulls >= 3, `keyframes: ${fulls}`);
  const bytes = (list: Snap[]) => list.reduce((n, s) => n + JSON.stringify(s).length, 0);
  assert.ok(bytes(mixed) < bytes(plain), `delta bytes ${bytes(mixed)} < full ${bytes(plain)}`);
  const metrics = JSON.parse(run.m.signal('metrics') ?? '{}') as { deltaCount: number; deltaBytes: number; snapCount: number };
  assert.equal(metrics.deltaCount, deltas);
  assert.ok(metrics.deltaBytes > 0);

  // Resume: a new socket gets the RESUME and then a full envelope, even though it asked for deltas.
  const again = presence(a.userId, 'p0', 's-again');
  assert.equal(run.m.join([again], game(a.userId, again.sessionId), meta(true))[0]?.accept, true);
  run.m.dispatcher.clear();
  run.m.loop([{ sender: again, opCode: OP.HELLO, data: { t: 'hello', protocol: PROTO, fingerprint: FP, devices: ['k1'] } }]);
  assert.ok(run.m.dispatcher.sent(OP.RESUME).length >= 1);
  run.m.ticks(6);
  const resumed = snapshotsFor(run.m, again);
  assert.ok(resumed.length >= 2);
  assert.notEqual(resumed[0]!.kind, DELTA_KIND, 'full envelope after resume');
  assert.equal(resumed[1]!.kind, DELTA_KIND, 'then deltas again');

  // Stage change: the next envelope is full for everyone.
  const live = (run.mod.global.CoopMatch as { liveSession(id: string): { state: { stageIdx: number } } }).liveSession((run.m.state as { matchId: string }).matchId);
  live.state.stageIdx += 1;
  run.m.dispatcher.clear();
  run.m.ticks(2);
  const staged = snapshotsFor(run.m, again);
  assert.ok(staged.length >= 1);
  assert.notEqual(staged[0]!.kind, DELTA_KIND, 'full envelope on a stage change');
}

// Without the helper, snapDelta: '1' is ignored and every socket gets full envelopes.
{
  const run = start([true], true);
  run.m.dispatcher.clear();
  run.m.ticks(20);
  const got = snapshotsFor(run.m, run.players[0]!);
  assert.ok(got.length >= 5);
  assert.ok(got.every((s) => s.kind !== DELTA_KIND));
}

console.log('coop wire tests ok');
