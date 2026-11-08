/**
 * Shooter boss receipts. One verified clear pays 20 Tickets and one score.
 * Retries, races, a new key, a new session, and the same boss the same UTC day
 * do not pay again. Forged logs pay 0. The client earn, event, and score paths
 * cannot name this payout.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  arm,
  call,
  canonical,
  disarm,
  dropFaultHooks,
  faulted,
  guest,
  installFaultHooks,
  num,
  openGame,
  psql,
  sqlId,
  ticketBalance,
  type GameLogin,
  type RpcResult,
} from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const PAY = 20;
const REASON = 'srv_shooter_boss_clear';
const PIN = JSON.parse(readFileSync(new URL('../../modules/vendor/shooter-sim.pin.json', import.meta.url), 'utf8')) as { commit: string };

interface Issuance {
  runId: string;
  accountId: string;
  sessionId: string;
  day: string;
  seed: number;
  canonicalBoss: string;
  [key: string]: unknown;
}

interface IssueBody {
  ok?: boolean;
  error?: string;
  reason?: string;
  tickets?: number;
  ticketsMinted?: number;
  issuance?: Issuance;
}

interface SubmitBody {
  ok?: boolean;
  error?: string;
  reason?: string;
  paid?: boolean;
  tickets?: number;
  ticketsMinted?: number;
  balance?: number;
  canonicalBoss?: string;
  score?: number;
  replay?: boolean;
  checkpointHash?: string;
}

function body(result: RpcResult): SubmitBody & IssueBody {
  return result.body as SubmitBody & IssueBody;
}

function shooterSrc(): string {
  const candidates = [process.env.SHOOTER_SRC || '', '/tmp/sproto-shooter'].filter(Boolean);
  for (const dir of candidates) {
    try {
      const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (head === PIN.commit) return dir;
    } catch {
      // Try the next checkout.
    }
  }
  const dir = join(tmpdir(), `sproto-shooter-${PIN.commit.slice(0, 8)}`);
  execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', `https://github.com/crrreatorrr/sproto-shooter.git`, dir], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', 'src'], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'fetch', '--depth', '1', 'origin', PIN.commit], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'checkout', '--detach', PIN.commit], { stdio: 'inherit' });
  return dir;
}

function record(issuance: Issuance, mode = 'success'): { v: number; binding: { [key: string]: string }; segments: unknown[] } {
  const root = shooterSrc();
  const dir = mkdtempSync(join(tmpdir(), 'shooter-record-'));
  const file = join(dir, 'record.mjs');
  const sim = pathToFileURL(join(root, 'src/sim/simulate.js')).href;
  const contract = pathToFileURL(join(root, 'src/server/runContract.js')).href;
  const protocol = pathToFileURL(join(root, 'src/server/protocol.js')).href;
  writeFileSync(file, `import { simulate } from ${JSON.stringify(sim)};
import { buildIssuedState } from ${JSON.stringify(contract)};
import { quantizeCommand, dequantizeCommand, encodeQuantized } from ${JSON.stringify(protocol)};
import fs from 'node:fs';
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const issuance = spec.issuance;
const mode = spec.mode;
function livingBosses(state) {
  return state.enemies.filter((e) => e.boss && !e.dead && !e.fled);
}
function aimYaw(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
function decide(state, mode) {
  const p = state.players[state.localPlayerId];
  const live = livingBosses(state);
  if (!live.length) return { yaw: -Math.PI / 2, pitch: 0, moveX: 0, moveZ: 1, held: { sprint: true }, pressed: {}, slot: -1, wheel: 0, actions: [] };
  let target = live[0];
  let best = Infinity;
  for (const e of live) {
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    if (d < best) { best = d; target = e; }
  }
  if (mode === 'fail') {
    if (best > 4.5) return { yaw: aimYaw(p.pos, target.pos), pitch: 0, moveX: 0, moveZ: 1, held: { sprint: true }, pressed: {}, slot: -1, wheel: 0, actions: [] };
    return { yaw: aimYaw(p.pos, target.pos), pitch: 0, moveX: 0, moveZ: 0, held: {}, pressed: {}, slot: -1, wheel: 0, actions: [] };
  }
  const eye = p.pos.y + 1.6;
  const aimY = target.pos.y + target.height * 0.55;
  let pitch = Math.atan2(aimY - eye, Math.max(0.2, best)) - p.recoil.pitch;
  if (pitch > 1.45) pitch = 1.45;
  if (pitch < -1.45) pitch = -1.45;
  let moveZ = 0;
  if (best > 18) moveZ = 1;
  else if (best < 9) moveZ = -1;
  const pressed = {};
  if (p.hp < 45 && p.medkits > 0 && !p.downed) pressed.medkit = true;
  return { yaw: aimYaw(p.pos, target.pos), pitch, moveX: 0, moveZ, held: { fire: true, sprint: best > 18 }, pressed, slot: -1, wheel: 0, actions: [] };
}
function noteBoss(memory, state, parts) {
  for (const e of state.enemies) {
    if (!e.boss || parts.indexOf(e.type) < 0) continue;
    const prev = memory[e.type] || { dead: false, fled: false };
    if (e.fled) prev.fled = true;
    if (e.dead && e.hp <= 0) prev.dead = true;
    memory[e.type] = prev;
  }
}
const state = buildIssuedState(issuance);
const id = state.localPlayerId;
const qs = [];
const memory = {};
let guard = 20000;
while (guard-- > 0) {
  const q = quantizeCommand(decide(state, mode));
  qs.push(q);
  simulate(state, { [id]: dequantizeCommand(q) });
  if (mode === 'fail' && state.players[id].dead) break;
  noteBoss(memory, state, issuance.parts);
  if (mode !== 'fail' && issuance.parts.every((type) => memory[type] && memory[type].dead && !memory[type].fled)) break;
}
const encoded = encodeQuantized(qs);
const log = { v: 1, binding: { accountId: issuance.accountId, sessionId: issuance.sessionId, day: issuance.day, runId: issuance.runId }, segments: [{ i: 0, from: null, tick0: 0, n: encoded.n, frames: encoded.frames, actions: encoded.actions }] };
process.stdout.write(JSON.stringify({ tick: state.tick, dead: state.players[id].dead, log }));
`);
  const out = execFileSync(process.execPath, [file], { input: JSON.stringify({ issuance, mode }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(out) as { tick: number; dead: boolean; log: { v: number; binding: { [key: string]: string }; segments: { n: number }[] } };
  if (mode === 'success' && (parsed.dead || parsed.log.segments[0].n < 10)) {
    throw new Error(`recorder did not clear ${issuance.canonicalBoss} in ${parsed.tick} frames`);
  }
  return parsed.log;
}

async function cleared(session: GameLogin, boss: string, key: string): Promise<{ issuance: Issuance; log: ReturnType<typeof record> }> {
  let last = 'no attempt';
  for (let i = 0; i < 6; i++) {
    const issuance = await issue(session, boss, `${key}-${i}`);
    try {
      return { issuance, log: record(issuance, 'success') };
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`no clear for ${boss}: ${last}`);
}

async function issue(session: GameLogin, boss: string, key: string): Promise<Issuance> {
  const result = await call('shooter.run.issue', { key, canonicalBoss: boss }, session.gameToken);
  const parsed = body(result);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.ticketsMinted, 0);
  assert.equal(parsed.tickets, 0);
  assert.ok(parsed.issuance, JSON.stringify(parsed));
  assert.equal(parsed.issuance.accountId, session.hub.userId);
  assert.equal(parsed.issuance.sessionId, session.sessionId);
  assert.equal(parsed.issuance.canonicalBoss, boss);
  return parsed.issuance;
}

async function submit(session: GameLogin, runId: string, log: unknown): Promise<RpcResult> {
  return call('shooter.run.submit', { runId, log }, session.gameToken, { timeoutMs: 60_000 });
}

function credits(userId: string): number {
  return num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = 'sproto-shooter' AND reason = '${REASON}' AND delta = ${PAY}`);
}

function scores(userId: string, boss = 'sahil'): number {
  return num(`SELECT count(*) FROM game.ranked_score WHERE user_id = '${sqlId(userId)}' AND board_id = 'shooter_story_clear_ms_v1' AND variant = '${boss}'`);
}

function receipts(userId: string, boss = 'sahil'): number {
  return num(`SELECT count(*) FROM game.shooter_receipt WHERE user_id = '${sqlId(userId)}' AND canonical_boss = '${boss}'`);
}

function idleLog(issuance: Issuance, from: string | null = null) {
  return {
    v: 1,
    binding: { accountId: issuance.accountId, sessionId: issuance.sessionId, day: issuance.day, runId: issuance.runId },
    segments: [{ i: 0, from, tick0: from ? 1 : 0, n: 1, frames: 'AAAAAAAAAAAAAAAA', actions: [] }],
  };
}

export async function runShooterRewards(test: TestFn): Promise<void> {
  await test('shooter', 'no client event rule can name the shooter payout', async () => {
    assert.equal(num(`SELECT count(*) FROM game.event_rule WHERE game_id = 'sproto-shooter' AND tickets > 0`), 0);
    const session = await loginShooter();
    const earn = await call('tickets.earn', { amount: 20, reason: REASON, key: 'client-earn' }, session.gameToken);
    assert.equal(body(earn).error, 'server_reason', JSON.stringify(earn.body));
    const named = await call('tickets.earn', { amount: 20, reason: 'shooter.boss_clear', key: 'client-name' }, session.gameToken);
    assert.equal(body(named).error, 'server_reason');
    const event = await call('session.event', { eventId: 'shooter.boss_clear', key: 'client-event', data: { boss: 'sahil' } }, session.gameToken);
    assert.equal(body(event).error, 'server_reason');
    assert.equal(body(event).tickets, undefined);
    const score = await call('score.submit', { boardId: 'shooter_story_clear_ms_v1', value: 10, meta: {} }, session.gameToken);
    assert.equal(body(score).error, 'bad_board');
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), 0);
    assert.equal(credits(session.hub.userId), 0);
  });

  await test('shooter', 'aliases and a forged issue do not open a payable run', async () => {
    const session = await loginShooter();
    for (const boss of ['obamaDuo', 'midgetDuo', 'agent', 'glowieAgent']) {
      const result = await call('shooter.run.issue', { key: `alias-${boss}`, canonicalBoss: boss }, session.gameToken);
      assert.notEqual(body(result).ok, true, boss);
      assert.equal(body(result).tickets, 0, JSON.stringify(result.body));
      assert.equal(body(result).ticketsMinted, 0);
    }
    const seeded = await call('shooter.run.issue', { key: 'forged-seed', canonicalBoss: 'sahil', seed: 7, loadout: 'god' }, session.gameToken);
    assert.equal(body(seeded).reason, 'forged_seed');
    assert.equal(body(seeded).tickets, 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE user_id = '${sqlId(session.hub.userId)}'`), 0);
  });

  await test('shooter', 'x100 retries of one clear pay once and write one score', async () => {
    const who = await guest();
    const duel = await openGame(who.token, 'sproto');
    const duelPay = await call('session.event', { eventId: 'sproto.boss_defeated', key: 'duel-sahil', data: { boss: 'sahil' } }, duel.gameToken);
    assert.equal(Number(duelPay.body.tickets), PAY, JSON.stringify(duelPay.body));
    const session = await openGame(who.token, 'sproto-shooter');
    const { issuance, log } = await cleared(session, 'sahil', 'clear-1');
    const first = await submit(session, issuance.runId, log);
    const paid = body(first);
    assert.equal(paid.paid, true, JSON.stringify(first.body));
    assert.equal(paid.tickets, PAY);
    assert.equal(paid.ticketsMinted, 0);
    assert.equal(paid.canonicalBoss, 'sahil');
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), PAY);
    assert.equal(ticketBalance(session.hub.userId, 'sproto'), 0);
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(scores(session.hub.userId), 1);
    assert.equal(receipts(session.hub.userId), 1);
    console.log(`shooter ledger ${psql(`SELECT delta::text || ' ' || reason || ' ' || balance_after::text FROM game.tickets_ledger WHERE user_id = '${sqlId(session.hub.userId)}' AND game_id = 'sproto-shooter' ORDER BY seq`)}`);
    console.log(`shooter score ${psql(`SELECT variant || '=' || value::text FROM game.ranked_score WHERE user_id = '${sqlId(session.hub.userId)}' AND board_id = 'shooter_story_clear_ms_v1'`)}`);
    for (let i = 0; i < 100; i++) {
      const again = await submit(session, issuance.runId, log);
      assert.equal(canonical(again.body), canonical(first.body), `retry ${i} ${JSON.stringify(again.body)}`);
    }
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), PAY);
    assert.equal(scores(session.hub.userId), 1);
  });

  await test('shooter', '20 concurrent races and a new key or session pay once', async () => {
    const session = await loginShooter();
    const { issuance, log } = await cleared(session, 'sahil', 'race-key');
    const results = await Promise.all(Array.from({ length: 20 }, () => submit(session, issuance.runId, log)));
    const winners = results.filter((result) => body(result).paid === true);
    assert.ok(winners.length >= 1, results.map((result) => JSON.stringify(result.body)).join('\n'));
    const sealed = canonical(winners[0]?.body);
    for (const result of winners) assert.equal(canonical(result.body), sealed);
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), PAY);
    const otherClear = await cleared(session, 'sahil', 'race-other-key');
    const other = otherClear.issuance;
    assert.notEqual(other.runId, issuance.runId);
    const second = await submit(session, other.runId, otherClear.log);
    assert.equal(body(second).paid, false, JSON.stringify(second.body));
    assert.equal(body(second).tickets, 0);
    assert.equal(body(second).reason, 'already_paid');
    const again = await openGame(session.hub.token, 'sproto-shooter');
    const thirdClear = await cleared(again, 'sahil', 'race-new-session');
    const third = await submit(again, thirdClear.issuance.runId, thirdClear.log);
    assert.equal(body(third).tickets, 0, JSON.stringify(third.body));
    assert.notEqual(body(third).paid, true);
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(receipts(session.hub.userId), 1);
  });

  await test('shooter', 'crash after commit and a raised wallet fault pay once', async () => {
    installFaultHooks();
    try {
      const committed = await loginShooter();
      const { issuance, log } = await cleared(committed, 'broccoli', 'fault-commit');
      arm(committed.hub.userId, 'shooter.after_commit', 'raise');
      const blown = await submit(committed, issuance.runId, log);
      assert.equal(faulted(blown), true, JSON.stringify(blown));
      assert.equal(credits(committed.hub.userId), 1);
      assert.equal(ticketBalance(committed.hub.userId, 'sproto-shooter'), PAY);
      disarm(committed.hub.userId);
      const recovered = await submit(committed, issuance.runId, log);
      assert.equal(body(recovered).paid, true, JSON.stringify(recovered.body));
      assert.equal(body(recovered).tickets, PAY);
      assert.equal(credits(committed.hub.userId), 1);
      assert.equal(scores(committed.hub.userId, 'broccoli'), 1);

      const rolled = await loginShooter();
      const rolledClear = await cleared(rolled, 'sahil', 'fault-wallet');
      const rolledIssue = rolledClear.issuance;
      const rolledLog = rolledClear.log;
      arm(rolled.hub.userId, 'earn.after_wallet', 'raise');
      const failed = await submit(rolled, rolledIssue.runId, rolledLog);
      assert.equal(faulted(failed), true, JSON.stringify(failed));
      assert.equal(credits(rolled.hub.userId), 0);
      assert.equal(ticketBalance(rolled.hub.userId, 'sproto-shooter'), 0);
      assert.equal(receipts(rolled.hub.userId), 0);
      disarm(rolled.hub.userId);
      const retry = await submit(rolled, rolledIssue.runId, rolledLog);
      assert.equal(body(retry).paid, true, JSON.stringify(retry.body));
      assert.equal(credits(rolled.hub.userId), 1);
      assert.equal(ticketBalance(rolled.hub.userId, 'sproto-shooter'), PAY);
    } finally {
      dropFaultHooks();
    }
  });

  await test('shooter', 'session cap, daily cap, and the UTC day bucket', async () => {
    const capped = await loginShooter();
    psql(`INSERT INTO game.tickets_balance (user_id, game_id, balance) VALUES ('${sqlId(capped.hub.userId)}', 'sproto-shooter', 190) ON CONFLICT (user_id, game_id) DO UPDATE SET balance = 190`);
    psql(`INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind) VALUES (gen_random_uuid(), '${sqlId(capped.hub.userId)}', 'sproto-shooter', 190, 190, 'seed_cap', '${sqlId(capped.sessionId)}', 'earn')`);
    psql(`INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response) VALUES ('${sqlId(capped.hub.userId)}', 'seed-cap', 'tickets.earn', decode('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'hex'), '{"balance":190}'::jsonb)`);
    const cappedClear = await cleared(capped, 'sahil', 'cap-session');
    const issuance = cappedClear.issuance;
    const denied = await submit(capped, issuance.runId, cappedClear.log);
    assert.equal(body(denied).error, 'session_ticket_cap', JSON.stringify(denied.body));
    assert.equal(ticketBalance(capped.hub.userId, 'sproto-shooter'), 190);
    assert.equal(credits(capped.hub.userId), 0);
    assert.equal(receipts(capped.hub.userId), 0);
    const room = await openGame(capped.hub.token, 'sproto-shooter');
    const retryClear = await cleared(room, 'sahil', 'cap-new-session');
    const paid = await submit(room, retryClear.issuance.runId, retryClear.log);
    assert.equal(body(paid).paid, true, JSON.stringify(paid.body));
    assert.equal(ticketBalance(capped.hub.userId, 'sproto-shooter'), 210);
    assert.equal(credits(capped.hub.userId), 1);

    const daily = await loginShooter();
    psql(`INSERT INTO game.earn_window (user_id, bucket, day, amount) VALUES ('${sqlId(daily.hub.userId)}', 'tickets:sproto-shooter', (now() AT TIME ZONE 'utc')::date, 990)`);
    const dailyClear = await cleared(daily, 'sahil', 'cap-day');
    const dailyDenied = await submit(daily, dailyClear.issuance.runId, dailyClear.log);
    assert.equal(body(dailyDenied).error, 'daily_ticket_cap', JSON.stringify(dailyDenied.body));
    assert.equal(ticketBalance(daily.hub.userId, 'sproto-shooter'), 0);
    assert.equal(credits(daily.hub.userId), 0);
    assert.equal(receipts(daily.hub.userId), 0);

    const boundary = await loginShooter();
    const todayClear = await cleared(boundary, 'obama', 'utc-today');
    const todayPay = await submit(boundary, todayClear.issuance.runId, todayClear.log);
    assert.equal(body(todayPay).paid, true, JSON.stringify(todayPay.body));
    psql(`UPDATE game.shooter_receipt SET day = (now() AT TIME ZONE 'utc')::date - 1 WHERE user_id = '${sqlId(boundary.hub.userId)}' AND canonical_boss = 'obama'`);
    psql(`UPDATE game.earn_window SET day = (now() AT TIME ZONE 'utc')::date - 1 WHERE user_id = '${sqlId(boundary.hub.userId)}' AND bucket = 'boss:sproto-shooter:obama'`);
    const nextClear = await cleared(boundary, 'obama', 'utc-next');
    const nextPay = await submit(boundary, nextClear.issuance.runId, nextClear.log);
    assert.equal(body(nextPay).paid, true, JSON.stringify(nextPay.body));
    assert.equal(receipts(boundary.hub.userId, 'obama'), 2);
    assert.equal(credits(boundary.hub.userId), 2);
    assert.equal(ticketBalance(boundary.hub.userId, 'sproto-shooter'), 40);
    const sameClear = await cleared(boundary, 'obama', 'utc-same');
    const samePay = await submit(boundary, sameClear.issuance.runId, sameClear.log);
    assert.equal(body(samePay).tickets, 0, JSON.stringify(samePay.body));
    assert.equal(credits(boundary.hub.userId), 2);
  });

  await test('shooter', 'forged account, checkpoint, god mode, and oversized logs pay 0', async () => {
    const session = await loginShooter();
    const before = ticketBalance(session.hub.userId, 'sproto-shooter');
    const forgedClear = await cleared(session, 'sahil', 'forged-log');
    const issuance = forgedClear.issuance;
    const log = forgedClear.log;
    const forged = JSON.parse(JSON.stringify(log)) as { binding: { accountId: string } };
    forged.binding.accountId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const rebound = await submit(session, issuance.runId, forged);
    assert.equal(body(rebound).reason, 'rebind', JSON.stringify(rebound.body));
    assert.equal(body(rebound).tickets, 0);
    const malformed = await submit(session, issuance.runId, { v: 1 });
    assert.equal(body(malformed).reason, 'malformed');
    assert.equal(body(malformed).tickets, 0);
    const oversized = await submit(session, issuance.runId, {
      v: 1,
      binding: { accountId: issuance.accountId, sessionId: issuance.sessionId, day: issuance.day, runId: issuance.runId },
      segments: [{ i: 0, from: null, tick0: 0, n: 30000, frames: 'AAAA', actions: [] }],
    });
    assert.equal(body(oversized).reason, 'oversized', JSON.stringify(oversized.body));
    assert.equal(body(oversized).tickets, 0);
    const hostile = JSON.parse(JSON.stringify(log)) as { segments: { actions: number[][] }[] };
    hostile.segments[0].actions = [[0, 3]];
    const god = await submit(session, issuance.runId, hostile);
    assert.equal(body(god).reason, 'god_mode', JSON.stringify(god.body));
    assert.equal(body(god).tickets, 0);
    const idleIssue = await issue(session, 'glowie', 'checkpoint-1');
    const partial = await submit(session, idleIssue.runId, idleLog(idleIssue));
    assert.equal(body(partial).tickets, 0, JSON.stringify(partial.body));
    assert.equal(body(partial).paid, false);
    assert.equal(typeof body(partial).checkpointHash, 'string');
    const badFrom = idleLog(idleIssue, 'deadbeef');
    const bad = await submit(session, idleIssue.runId, badFrom);
    assert.equal(body(bad).reason, 'bad_checkpoint', JSON.stringify(bad.body));
    assert.equal(body(bad).tickets, 0);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), before);
    assert.equal(credits(session.hub.userId), 0);
    const failIssue = await issue(session, 'sahil', 'fail-run');
    const failed = await submit(session, failIssue.runId, record(failIssue, 'fail'));
    assert.equal(body(failed).tickets, 0, JSON.stringify(failed.body));
    assert.notEqual(body(failed).paid, true);
    assert.equal(credits(session.hub.userId), 0);
  });
}

async function loginShooter(): Promise<GameLogin> {
  const who = await guest();
  return openGame(who.token, 'sproto-shooter');
}
