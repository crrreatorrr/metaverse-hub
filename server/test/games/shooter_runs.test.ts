// H2-S: vendored verifier, client guards, and a one-frame submit that cannot mint.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadModule } from '../unit/harness';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const bundlePath = join(root, 'server/modules/vendor/shooter-sim.js');
const pin = JSON.parse(readFileSync(join(root, 'server/modules/vendor/shooter-sim.pin.json'), 'utf8')) as {
  sha256: string;
  commit: string;
  fingerprint: string;
  protocol: number;
};
const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/sahil-success.json'), 'utf8')) as {
  issuanceBinding: { accountId: string; sessionId: string; day: string; runId: string; seed: number; canonicalBoss: string };
  log: { v: number; binding: { [key: string]: string }; segments: { n: number }[] };
  stateHash: string;
};

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const session = { userId: USER, vars: { scope: 'game', game: 'sproto-shooter', sid: SID, ranked: '0' } };

function loadBundle(): { [key: string]: (...args: never[]) => unknown } & {
  buildIssuance(input: { [key: string]: unknown }): { ok?: boolean; reason?: string; ticketsMinted?: number; issuance?: { [key: string]: unknown } };
  verifyRun(log: { [key: string]: unknown }, ctx: { [key: string]: unknown }): { [key: string]: unknown };
  verifyRunJSON(text: string): string;
  contentFingerprintOf(): string;
  PROTOCOL_VERSION: number;
  SOURCE_COMMIT: string;
  ECONOMY: { mintsTickets: boolean; ticketsMintedByArtifact: number; wagerMayCreateTickets: boolean };
} {
  const sandbox: { [key: string]: unknown } = { console: { log() {}, warn() {}, error() {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(bundlePath, 'utf8'), sandbox, { filename: 'shooter-sim.js' });
  return sandbox.SprotoShooterSim as ReturnType<typeof loadBundle>;
}

function core(receipt: { [key: string]: unknown }) {
  return {
    ok: receipt.ok,
    reason: receipt.reason,
    outcome: receipt.outcome,
    eligible: receipt.eligible,
    ranked: receipt.ranked,
    ticketsMinted: receipt.ticketsMinted,
    canonicalBoss: receipt.canonicalBoss,
    canonicalCount: receipt.canonicalCount,
    stateHash: receipt.stateHash,
    frames: receipt.frames,
    contentFingerprint: receipt.contentFingerprint,
  };
}

const api = loadBundle();
const hash = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
assert.equal(hash, pin.sha256);
assert.equal(api.PROTOCOL_VERSION, 1);
assert.equal(api.SOURCE_COMMIT, pin.commit);
assert.equal(api.contentFingerprintOf(), pin.fingerprint);
assert.equal(api.ECONOMY.mintsTickets, false);
assert.equal(api.ECONOMY.ticketsMintedByArtifact, 0);
assert.equal(api.ECONOMY.wagerMayCreateTickets, false);

const built = api.buildIssuance(fixture.issuanceBinding);
assert.equal(built.ok, true);
assert.equal(built.ticketsMinted, 0);
const started = Date.now();
const clear = api.verifyRun(fixture.log, {
  issuance: built.issuance,
  accountId: fixture.issuanceBinding.accountId,
  sessionId: fixture.issuanceBinding.sessionId,
  day: fixture.issuanceBinding.day,
  seenDigests: [],
  seenRunIds: [],
});
const nodeMs = Date.now() - started;
assert.equal(clear.outcome, 'clear');
assert.equal(clear.eligible, true);
assert.equal(clear.canonicalCount, 1);
assert.equal(clear.ticketsMinted, 0);
assert.equal(clear.stateHash, fixture.stateHash);
assert.equal(clear.stateHash, 'a88b4fde');
console.log(`shooter node verify cpuMs ${String(clear.cpuMs)} wallMs ${nodeMs} frames ${String(clear.frames)}`);

const rebound = api.verifyRun(fixture.log, {
  issuance: built.issuance,
  accountId: 'other-account',
  sessionId: fixture.issuanceBinding.sessionId,
  day: fixture.issuanceBinding.day,
  seenDigests: [],
  seenRunIds: [],
});
assert.equal(rebound.ok, false);
assert.equal(rebound.reason, 'rebind');
assert.equal(rebound.ticketsMinted, 0);

const alias = api.buildIssuance({ ...fixture.issuanceBinding, canonicalBoss: 'obamaDuo' });
assert.equal(alias.ok, false);
assert.equal(alias.reason, 'obama_is_one');
assert.equal(alias.ticketsMinted, 0);
const agent = api.buildIssuance({ ...fixture.issuanceBinding, canonicalBoss: 'agent' });
assert.equal(agent.reason, 'glowie_not_agent');
const glowieAgent = api.buildIssuance({ ...fixture.issuanceBinding, canonicalBoss: 'glowieAgent' });
assert.equal(glowieAgent.reason, 'glowie_not_agent');

const godLog = JSON.parse(JSON.stringify(fixture.log)) as typeof fixture.log & { segments: { actions: number[][] }[] };
godLog.segments[0].actions = [[0, 3]];
const god = api.verifyRun(godLog, {
  issuance: built.issuance,
  accountId: fixture.issuanceBinding.accountId,
  sessionId: fixture.issuanceBinding.sessionId,
  day: fixture.issuanceBinding.day,
  seenDigests: [],
  seenRunIds: [],
});
assert.equal(god.ok, false);
assert.equal(god.reason, 'god_mode');
assert.equal(god.ticketsMinted, 0);

function runGoja(payload: unknown): { [key: string]: unknown } {
  const dir = mkdtempSync(join(tmpdir(), 'shooter-goja-'));
  writeFileSync(join(dir, 'go.mod'), `module shooter-goja

go 1.26.0

require github.com/dop251/goja v0.0.0-20261107161106-d6eaa50db8bc
`);
  writeFileSync(join(dir, 'main.go'), `package main

import (
  "fmt"
  "io"
  "os"

  "github.com/dop251/goja"
)

func main() {
  src, err := os.ReadFile(os.Args[1])
  if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  input, err := io.ReadAll(os.Stdin)
  if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  vm := goja.New()
  if _, err = vm.RunString(string(src)); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  fn, ok := goja.AssertFunction(vm.Get("SprotoShooterSim").ToObject(vm).Get("verifyRunJSON"))
  if !ok { fmt.Fprintln(os.Stderr, "verifyRunJSON missing"); os.Exit(1) }
  out, err := fn(goja.Undefined(), vm.ToValue(string(input)))
  if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
  fmt.Print(out.String())
}
`);
  const tidy = spawnSync('go', ['mod', 'tidy'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'local' },
  });
  if (tidy.error && (tidy.error as NodeJS.ErrnoException).code === 'ENOENT') {
    if (process.env.SHOOTER_REQUIRE_GOJA === '1') throw new Error('go is not installed');
    console.log('shooter goja skipped: go is not installed');
    return { skipped: true };
  }
  if (tidy.status !== 0) throw new Error(tidy.stderr || tidy.stdout || 'go mod tidy failed');
  const res = spawnSync('go', ['run', '.', bundlePath], {
    cwd: dir,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 180000,
    env: { ...process.env, GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'local' },
  });
  if (res.error && (res.error as NodeJS.ErrnoException).code === 'ENOENT') {
    if (process.env.SHOOTER_REQUIRE_GOJA === '1') throw new Error('go is not installed');
    console.log('shooter goja skipped: go is not installed');
    return { skipped: true };
  }
  if (res.status !== 0) throw new Error(res.stderr || res.stdout || 'goja failed');
  return JSON.parse(res.stdout) as { [key: string]: unknown };
}

const gojaReceipt = runGoja({
  log: fixture.log,
  ctx: {
    issuance: built.issuance,
    accountId: fixture.issuanceBinding.accountId,
    sessionId: fixture.issuanceBinding.sessionId,
    day: fixture.issuanceBinding.day,
    seenDigests: [],
    seenRunIds: [],
  },
});
if (!gojaReceipt.skipped) {
  assert.deepEqual(core(gojaReceipt), core(clear));
  console.log(`shooter goja parity stateHash ${String(gojaReceipt.stateHash)} cpuMs ${String(gojaReceipt.cpuMs)}`);
}

const mod = loadModule();
{
  const HubSchema = mod.global.HubSchema as { all(): { id: string; statements: string[] }[] };
  const ShooterRewards = mod.global.ShooterRewards as { FINGERPRINT: string };
  const all = HubSchema.all();
  const ids = all.map((row) => row.id);
  const frozen = all.find((row) => row.id === '0048_shooter_campaign_fingerprint')!.statements.join('\n');
  assert.match(frozen, /replace\(src, '3c657fb5', 'cea1f88b'\)/);
  assert.equal(frozen.includes(pin.fingerprint), false, '0048 stays on the fingerprint it was applied with');
  const relabel = all.filter((row) => row.id === '0065_shooter_campaign_fingerprint');
  assert.equal(relabel.length, 1);
  const swap = relabel[0]!.statements[0]!;
  assert.ok(swap.includes(`replace(src, 'cea1f88b', '${pin.fingerprint}')`));
  assert.equal(ShooterRewards.FINGERPRINT, pin.fingerprint);
  assert.equal(/UPDATE|DELETE|INSERT/.test(swap), false, 'the migration rewrites no row');
  assert.ok(ids.indexOf('0065_shooter_campaign_fingerprint') > ids.indexOf('0064_feedback_check'));
}
const mark = () => mod.nk.sqlCalls.length;
let at = mark();
const earned = mod.call('tickets.earn', session, { key: 'k1', amount: 20, reason: 'srv_shooter_boss_clear' }) as { error?: string; balance?: number };
assert.equal(earned.error, 'server_reason');
assert.equal(earned.balance, undefined);
assert.equal(mod.nk.sqlCalls.slice(at).some((call) => call.sql.includes('earn_tickets')), false);
at = mark();
const named = mod.call('tickets.earn', session, { key: 'k2', amount: 20, reason: 'shooter.boss_clear' }) as { error?: string };
assert.equal(named.error, 'server_reason');
assert.equal(mod.nk.sqlCalls.slice(at).some((call) => call.sql.includes('earn_tickets')), false);
at = mark();
const event = mod.call('session.event', session, { eventId: 'shooter.boss_clear', key: 'k3', data: { boss: 'sahil' } }) as { error?: string; tickets?: number };
assert.equal(event.error, 'server_reason');
assert.equal(event.tickets, undefined);
assert.equal(mod.nk.sqlCalls.slice(at).some((call) => call.sql.includes('apply_event')), false);
const score = mod.call('score.submit', session, { boardId: 'shooter_story_clear_ms_v1', value: 10, meta: {} }) as { error?: string };
assert.equal(score.error, 'bad_board');
mod.nk.onSql(/earn_tickets/, () => [{ result: JSON.stringify({ error: 'unknown_reason' }) }]);
const duel = mod.call('tickets.earn', session, { key: 'k4', amount: 20, reason: 'boss' }) as { error?: string; balance?: number };
assert.equal(duel.error, 'unknown_reason');
assert.equal(duel.balance, undefined);

const issuedBoss = api.buildIssuance({
  accountId: USER,
  sessionId: SID,
  day: '2026-11-08',
  runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  seed: 7,
  canonicalBoss: 'sahil',
});
assert.equal(issuedBoss.ok, true);
const idle = 'AAAAAAAAAAAAAAAA';
function logFor(runId: string, actions: number[][] = []) {
  return {
    v: 1,
    binding: { accountId: USER, sessionId: SID, day: '2026-11-08', runId },
    segments: [{ i: 0, from: null, tick0: 0, n: 1, frames: idle, actions }],
  };
}

mod.nk.onSql(/AT TIME ZONE 'utc'/, () => [{ day: '2026-11-08' }]);
mod.nk.onSql(/issue_shooter_run/, (args) => {
  const issuance = JSON.parse(String(args[7])) as { accountId?: string; seed?: number; loadout?: string; canonicalBoss?: string };
  assert.equal(issuance.accountId, USER);
  assert.equal(issuance.loadout, 'canonical-start');
  assert.equal(issuance.canonicalBoss, 'sahil');
  assert.equal(args[1], SID);
  return [{ result: JSON.stringify({ ok: true, replay: false, paid: false, tickets: 0, ticketsMinted: 0, issuance }) }];
});
Object.freeze(mod.global);
const opened = mod.call('shooter.run.issue', session, { key: 'issue-1', canonicalBoss: 'sahil' }) as { ok?: boolean; ticketsMinted?: number; tickets?: number; issuance?: { seed?: number } };
assert.equal(opened.ok, true, JSON.stringify(opened));
assert.equal(opened.ticketsMinted, 0);
assert.equal(opened.tickets, 0);
assert.equal(typeof opened.issuance?.seed, 'number');
const forged = mod.call('shooter.run.issue', session, { key: 'issue-2', canonicalBoss: 'sahil', seed: 7 }) as { reason?: string; tickets?: number };
assert.equal(forged.reason, 'forged_seed');
assert.equal(forged.tickets, 0);
const duo = mod.call('shooter.run.issue', session, { key: 'issue-3', canonicalBoss: 'obamaDuo' }) as { reason?: string; ticketsMinted?: number };
assert.equal(duo.reason, 'obama_is_one');
assert.equal(duo.ticketsMinted, 0);

const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
mod.nk.onSql(/issuance_json/, () => [{
  session_id: SID,
  day: '2026-11-08',
  canonical_boss: 'sahil',
  status: 'open',
  issuance_json: JSON.stringify(issuedBoss.issuance),
  checkpoint_json: null,
}]);
mod.nk.onSql(/FROM game\.shooter_digest/, () => []);
mod.nk.onSql(/status <> 'open'/, () => []);
mod.nk.onSql(/save_shooter_checkpoint/, () => [{ result: JSON.stringify({ ok: true, paid: false, tickets: 0, ticketsMinted: 0, reason: 'boss_alive', checkpointHash: 'aaaaaaaa' }) }]);
mod.nk.onSql(/close_shooter_run/, () => [{ result: JSON.stringify({ ok: true, paid: false, tickets: 0, ticketsMinted: 0, reason: 'god_mode' }) }]);
const beforeSubmit = mod.nk.sqlCalls.length;
const partial = mod.call('shooter.run.submit', session, { runId, log: logFor(runId) }) as { paid?: boolean; tickets?: number; reason?: string };
assert.equal(partial.paid, false);
assert.equal(partial.tickets, 0);
assert.equal(partial.reason, 'boss_alive');
assert.equal(mod.nk.sqlCalls.slice(beforeSubmit).some((call) => call.sql.includes('settle_shooter_clear')), false);
const hostile = mod.call('shooter.run.submit', session, { runId, log: logFor(runId, [[0, 3]]) }) as { tickets?: number; reason?: string };
assert.equal(hostile.tickets, 0);
assert.equal(hostile.reason, 'god_mode');
const anon = mod.call('shooter.run.submit', { vars: { scope: 'game', game: 'sproto-shooter', sid: SID } }, { runId, log: logFor(runId) }) as { error?: string };
assert.equal(anon.error, 'unauthorized');

console.log('shooter runs ok');
