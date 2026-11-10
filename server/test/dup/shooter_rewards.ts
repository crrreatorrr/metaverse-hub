/**
 * Shooter boss receipts. One verified clear pays 20 Tickets and one score.
 * Retries, races, a new key, a new session, and the same boss the same UTC day
 * do not pay again. Forged logs pay 0. The client earn, event, and score paths
 * cannot name this payout.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  sleep,
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

let pinnedSrc: string | null = null;

function gitRev(dir: string): string {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function shooterSrc(): string {
  if (pinnedSrc && existsSync(join(pinnedSrc, 'src/sim/simulate.js'))) return pinnedSrc;
  const dir = process.env.SHOOTER_SRC || join(tmpdir(), `sproto-shooter-${PIN.commit.slice(0, 12)}`);
  if (gitRev(dir) === PIN.commit && existsSync(join(dir, 'src/sim/simulate.js'))) {
    pinnedSrc = dir;
    return dir;
  }
  rmSync(dir, { recursive: true, force: true });
  execFileSync('git', ['clone', '--depth', '1', '--filter=blob:none', '--sparse', 'https://github.com/crrreatorrr/sproto-shooter.git', dir], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'sparse-checkout', 'set', 'src'], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'fetch', '--depth', '1', 'origin', PIN.commit], { stdio: 'inherit' });
  execFileSync('git', ['-C', dir, 'checkout', '--detach', PIN.commit], { stdio: 'inherit' });
  if (gitRev(dir) !== PIN.commit || !existsSync(join(dir, 'src/sim/simulate.js'))) {
    throw new Error(`shooter checkout ${gitRev(dir)} is missing src/sim/simulate.js`);
  }
  pinnedSrc = dir;
  return dir;
}

function record(issuance: Issuance, mode = 'success'): { v: number; binding: { [key: string]: string }; segments: unknown[] } {
  const root = shooterSrc();
  const dir = mkdtempSync(join(tmpdir(), 'shooter-record-'));
  const file = join(dir, 'record.mjs');
  const sim = pathToFileURL(join(root, 'src/sim/simulate.js')).href;
  const contract = pathToFileURL(join(root, 'src/server/runContract.js')).href;
  const protocol = pathToFileURL(join(root, 'src/server/protocol.js')).href;
  const kite = pathToFileURL(join(root, 'src/sim/campaign/kiteAim.js')).href;
  writeFileSync(file, `import { simulate } from ${JSON.stringify(sim)};
import { buildIssuedState } from ${JSON.stringify(contract)};
import { quantizeCommand, dequantizeCommand, encodeQuantized } from ${JSON.stringify(protocol)};
import { kiteCommand } from ${JSON.stringify(kite)};
import fs from 'node:fs';
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const issuance = spec.issuance;
const mode = spec.mode;
function decide(state, mode) {
  return kiteCommand(state, mode);
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
// 15000 frames of 12-byte input stay under Nakama's 256 KB HTTP body cap.
let guard = 15000;
while (guard-- > 0) {
  const q = quantizeCommand(decide(state, mode));
  qs.push(q);
  simulate(state, { [id]: dequantizeCommand(q) });
  if (mode === 'fail' && state.players[id].dead) break;
  noteBoss(memory, state, issuance.parts);
  if (mode !== 'fail' && issuance.parts.every((type) => memory[type] && memory[type].dead && !memory[type].fled)) break;
}
const cleared = issuance.parts.every((type) => memory[type] && memory[type].dead && !memory[type].fled);
const encoded = encodeQuantized(qs);
const log = { v: 1, binding: { accountId: issuance.accountId, sessionId: issuance.sessionId, day: issuance.day, runId: issuance.runId }, segments: [{ i: 0, from: null, tick0: 0, n: encoded.n, frames: encoded.frames, actions: encoded.actions }] };
process.stdout.write(JSON.stringify({ tick: state.tick, dead: state.players[id].dead, cleared, log }));
`);
  const out = execFileSync(process.execPath, [file], { input: JSON.stringify({ issuance, mode }), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(out) as { tick: number; dead: boolean; cleared: boolean; log: { v: number; binding: { [key: string]: string }; segments: { n: number }[] } };
  if (mode === 'success' && (parsed.dead || !parsed.cleared || parsed.log.segments[0].n < 10)) {
    throw new Error(`recorder did not clear ${issuance.canonicalBoss} in ${parsed.tick} frames`);
  }
  return parsed.log;
}

async function cleared(session: GameLogin, boss: string, key: string): Promise<{ issuance: Issuance; log: ReturnType<typeof record> }> {
  let last = 'no attempt';
  for (let i = 0; i < 24; i++) {
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

async function racePayOnce(boss: string, n: number, label: string): Promise<void> {
  const session = await loginShooter();
  const { issuance, log } = await cleared(session, boss, `${label}-key`);
  const results = await Promise.all(Array.from({ length: n }, () => submit(session, issuance.runId, log)));
  const winners = results.filter((result) => body(result).paid === true);
  assert.ok(winners.length >= 1, results.map((result) => JSON.stringify(result.body)).join('\n'));
  const sealed = canonical(winners[0]?.body);
  for (const result of winners) assert.equal(canonical(result.body), sealed);
  assert.equal(credits(session.hub.userId), 1);
  assert.equal(creditSum(session.hub.userId), PAY);
  assert.equal(scores(session.hub.userId, boss), 1);
  assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), PAY);
  const aliasNames = ['obamaDuo', 'midgetDuo', 'agent', 'glowieAgent'];
  const aliasRace = await Promise.all(aliasNames.flatMap((name) => (
    Array.from({ length: 5 }, (_, i) => call('shooter.run.issue', { key: `${label}-alias-${name}-${i}`, canonicalBoss: name }, session.gameToken))
  )));
  assert.equal(aliasRace.length, 20);
  for (const result of aliasRace) {
    assert.notEqual(body(result).ok, true, JSON.stringify(result.body));
    assert.equal(body(result).tickets, 0);
    assert.equal(body(result).ticketsMinted, 0);
  }
  const otherClear = await cleared(session, boss, `${label}-other`);
  assert.notEqual(otherClear.issuance.runId, issuance.runId);
  const second = await submit(session, otherClear.issuance.runId, otherClear.log);
  assert.equal(body(second).paid, false, JSON.stringify(second.body));
  assert.equal(body(second).tickets, 0);
  assert.equal(body(second).reason, 'already_paid');
  const again = await openGame(session.hub.token, 'sproto-shooter');
  const thirdClear = await cleared(again, boss, `${label}-session`);
  const third = await submit(again, thirdClear.issuance.runId, thirdClear.log);
  assert.equal(body(third).tickets, 0, JSON.stringify(third.body));
  assert.notEqual(body(third).paid, true);
  assert.equal(credits(session.hub.userId), 1);
  assert.equal(creditSum(session.hub.userId), PAY);
  assert.equal(scores(session.hub.userId, boss), 1);
  assert.equal(receipts(session.hub.userId, boss), 1);
}

function credits(userId: string): number {
  return num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = 'sproto-shooter' AND reason = '${REASON}' AND delta = ${PAY}`);
}

function creditSum(userId: string): number {
  return num(`SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND game_id = 'sproto-shooter' AND reason = '${REASON}'`);
}

function scores(userId: string, boss = 'sahil'): number {
  return num(`SELECT count(*) FROM game.ranked_score WHERE user_id = '${sqlId(userId)}' AND board_id = 'shooter_story_clear_ms_v1' AND variant = '${boss}'`);
}

function receipts(userId: string, boss = 'sahil'): number {
  return num(`SELECT count(*) FROM game.shooter_receipt WHERE user_id = '${sqlId(userId)}' AND canonical_boss = '${boss}'`);
}

function idleLog(issuance: Issuance, from: string | null = null, frames = 1) {
  return {
    v: 1,
    binding: { accountId: issuance.accountId, sessionId: issuance.sessionId, day: issuance.day, runId: issuance.runId },
    segments: [{ i: 0, from, tick0: from ? 1 : 0, n: frames, frames: Buffer.alloc(frames * 12).toString('base64'), actions: [] }],
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
    const score = await call('score.submit', { boardId: 'shooter_story_clear_ms_v1', value: 10, meta: { boss: 'sahil' } }, session.gameToken);
    assert.equal(body(score).error, 'bad_board');
    for (const reason of ['boss', 'win', 'sproto.boss_defeated']) {
      const generic = await call('tickets.earn', { amount: 20, reason, key: `generic-${reason}` }, session.gameToken);
      assert.notEqual(body(generic).balance, PAY, JSON.stringify(generic.body));
      assert.equal(body(generic).error === 'unknown_reason' || body(generic).error === 'amount_over_rule' || body(generic).error === 'server_reason', true, JSON.stringify(generic.body));
    }
    const duelEvent = await call('session.event', { eventId: 'sproto.boss_defeated', key: 'generic-event', data: { boss: 'sahil' } }, session.gameToken);
    assert.equal(body(duelEvent).tickets, undefined, JSON.stringify(duelEvent.body));
    const aliasEvent = await call('session.event', { eventId: 'sproto.boss_defeated', key: 'generic-alias', data: { boss: 'obamaDuo' } }, session.gameToken);
    assert.equal(body(aliasEvent).tickets, undefined, JSON.stringify(aliasEvent.body));
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), 0);
    assert.equal(credits(session.hub.userId), 0);
    assert.equal(creditSum(session.hub.userId), 0);
    assert.equal(scores(session.hub.userId), 0);
  });

  await test('shooter', 'aliases and a forged issue do not open a payable run', async () => {
    const session = await loginShooter();
    const aliasReason: { [boss: string]: string } = {
      obamaDuo: 'obama_is_one',
      midgetDuo: 'obama_is_one',
      agent: 'glowie_not_agent',
      glowieAgent: 'glowie_not_agent',
    };
    for (const boss of Object.keys(aliasReason)) {
      const result = await call('shooter.run.issue', { key: `alias-${boss}`, canonicalBoss: boss }, session.gameToken);
      assert.equal(body(result).reason, aliasReason[boss], JSON.stringify(result.body));
      assert.equal(body(result).tickets, 0);
      assert.equal(body(result).ticketsMinted, 0);
    }
    const seeded = await call('shooter.run.issue', { key: 'forged-seed', canonicalBoss: 'sahil', seed: 7 }, session.gameToken);
    assert.equal(body(seeded).reason, 'forged_seed', JSON.stringify(seeded.body));
    assert.equal(body(seeded).tickets, 0);
    const loaded = await call('shooter.run.issue', { key: 'forged-loadout', canonicalBoss: 'sahil', loadout: 'god' }, session.gameToken);
    assert.equal(body(loaded).reason, 'injected_inventory', JSON.stringify(loaded.body));
    assert.equal(body(loaded).tickets, 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_run WHERE user_id = '${sqlId(session.hub.userId)}'`), 0);
    assert.equal(credits(session.hub.userId), 0);
    assert.equal(scores(session.hub.userId), 0);
  });

  await test('shooter', 'x100 retries and a delayed retry of one clear pay once and write one score', async () => {
    const who = await guest();
    const duel = await openGame(who.token, 'sproto');
    const duelPay = await call('session.event', { eventId: 'sproto.boss_defeated', key: 'duel-sahil', data: { boss: 'sahil' } }, duel.gameToken);
    assert.equal(Number(duelPay.body.tickets), PAY, JSON.stringify(duelPay.body));
    assert.equal(ticketBalance(who.userId, 'sproto'), PAY);
    const session = await openGame(who.token, 'sproto-shooter');
    const { issuance, log } = await cleared(session, 'sahil', 'clear-1');
    const first = await submit(session, issuance.runId, log);
    const paid = body(first);
    assert.equal(paid.paid, true, JSON.stringify(first.body));
    assert.equal(paid.tickets, PAY);
    assert.equal(paid.ticketsMinted, 0);
    assert.equal(paid.canonicalBoss, 'sahil');
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), PAY);
    assert.equal(ticketBalance(session.hub.userId, 'sproto'), PAY);
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
    assert.equal(creditSum(session.hub.userId), PAY);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-shooter'), PAY);
    assert.equal(scores(session.hub.userId), 1);
    assert.equal(psql(`SELECT day::text FROM game.shooter_receipt WHERE run_id = '${sqlId(issuance.runId)}'`), issuance.day);
    await sleep(2000);
    const delayed = await submit(session, issuance.runId, log);
    assert.equal(canonical(delayed.body), canonical(first.body), JSON.stringify(delayed.body));
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(creditSum(session.hub.userId), PAY);
    assert.equal(scores(session.hub.userId), 1);
    const alias = await call('shooter.run.issue', { key: 'after-clear-obamaDuo', canonicalBoss: 'obamaDuo' }, session.gameToken);
    assert.equal(body(alias).reason, 'obama_is_one', JSON.stringify(alias.body));
    assert.equal(body(alias).tickets, 0);
    assert.equal(credits(session.hub.userId), 1);
    assert.equal(scores(session.hub.userId), 1);
  });

  // Broccoli clears in about 3k frames, so twenty parallel verifies stay inside
  // the 15s wall-clock budget. Sahil is about 10k frames and does not.
  await test('shooter', '20 concurrent races, new keys, new sessions, and same-boss aliases pay once', async () => {
    await racePayOnce('broccoli', 20, 'race20');
  });

  await test('shooter', '4 concurrent Sahil races pay once', async () => {
    await racePayOnce('sahil', 4, 'race4');
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

  await test('shooter', 'forged run, account, checkpoint, and malformed or expensive logs pay 0', async () => {
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
    const missing = await submit(session, 'ffffffff-ffff-4fff-8fff-ffffffffffff', log);
    assert.equal(body(missing).reason, 'unknown_run', JSON.stringify(missing.body));
    assert.equal(body(missing).tickets, 0);
    const swapped = JSON.parse(JSON.stringify(log)) as { binding: { runId: string } };
    swapped.binding.runId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const wrongRun = await submit(session, issuance.runId, swapped);
    assert.equal(body(wrongRun).reason, 'rebind', JSON.stringify(wrongRun.body));
    assert.equal(body(wrongRun).tickets, 0);
    const otherDay = JSON.parse(JSON.stringify(log)) as { binding: { day: string } };
    otherDay.binding.day = '1999-01-01';
    const wrongDay = await submit(session, issuance.runId, otherDay);
    assert.equal(body(wrongDay).reason, 'rebind', JSON.stringify(wrongDay.body));
    assert.equal(body(wrongDay).tickets, 0);
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
    const expensive = await submit(session, issuance.runId, idleLog(issuance, null, 1800));
    assert.equal(body(expensive).tickets, 0, JSON.stringify(expensive.body));
    assert.notEqual(body(expensive).paid, true);
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
