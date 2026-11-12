// Actual Nakama/PostgreSQL + production coordinator + offline replay container.
// Browser and adversarial/restart stages are separate; this does not claim them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guest, openGame, psql, num, waitReady } from './dup/harness';
import { appendActor, finishActor, integrationCases, observeActor, prepareTrustedActor } from './dup/shooter_verification_e2e_fixtures';

import { ops, prepareOperations, waitUntil } from './dup/shooter_verification_e2e_operations';
import { retainedOracle } from './dup/shooter_verification_e2e_oracle';

type Obj = Record<string, unknown>;
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const digest = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
const obj = (value: unknown): Obj => value as Obj;
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  const v = value as Obj; return '{' + Object.keys(v).sort().map(key => JSON.stringify(key) + ':' + stable(v[key])).join(',') + '}';
}
function query(sql: string): string {
  return execFileSync('docker', ['compose', '-f', 'server/docker-compose.yml', 'exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'nakama', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
    cwd: ROOT, input: sql, encoding: 'utf8', timeout: 30000, maxBuffer: 22 * 1024 * 1024,
  }).trim();
}

await waitReady();
const workerId = await prepareOperations();
let started = false;
try {
  // No finish, append, owner status or browser request will heal this run.
  const abandonedLogin = await openGame((await guest()).token, 'sproto-shooter');
  const abandoned = await prepareTrustedActor('sahil-success-7', abandonedLogin);
  psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${abandonedLogin.sessionId}'`);
  // The base Hub is already healthy and owns live SDK connections. Starting
  // worker services must not recreate that dependency underneath those calls.
  ops(['up', '-d', '--build', '--no-deps', 'replay', 'coordinator']); started = true;
  await waitUntil(() => {
    try { return JSON.parse(ops(['exec', '-T', 'coordinator', 'node', '-e', "fetch('http://127.0.0.1:9476/ready').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))"])).ready === true; }
    catch { return false; }
  }, 60000, 'actual coordinator and offline daemon become ready');
  await waitUntil(() => psql(`SELECT lifecycle||':'||COALESCE(terminal_outcome,'') FROM game.shooter_verification_run WHERE run_id='${abandoned.runId}'`) === 'terminal:incomplete', 90000, 'idle coordinator maintenance must close an abandoned empty run without status healing');
  assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${abandoned.runId}'`), 0);
  console.log('PASS isolated-stack abandoned-empty DB-only closure, no owner status or queued work');

  let completed = 0;
  for (const definition of integrationCases) {
    const login = await openGame((await guest()).token, 'sproto-shooter');
    const actor = await prepareTrustedActor(definition.id, login, { ageMs: 1200000 });
    const batches = await appendActor(actor); assert.equal(batches.length, 1, 'the entire full stored trace is accepted atomically before terminal');
    await finishActor(actor, 0);
    const expected = retainedOracle(actor, batches[0]!);
    const terminal = expected.firstTerminal === null ? null : obj(expected.firstTerminal);
    const expectedOutcome = terminal ? terminal.outcome : 'incomplete';
    assert.equal(expectedOutcome, definition.legacyObservation.outcome, 'do not silently bless a changed outcome');
    const deadline = 30000 + Math.ceil(definition.frames / 4096) * 25000;
    await waitUntil(() => num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`) === definition.frames, deadline, 'full stored trace must resolve through the actual isolated coordinator');
    const actual = obj(JSON.parse(query(`SELECT checkpoint_json::text FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`)));
    assert.equal(digest(stable(actual)), digest(stable(expected)), 'full private checkpoint/state/RNG/IDs/parts/counters agree with retained05f; hashes only in failure output');
    const eligible = !!terminal && terminal.outcome === 'clear' && terminal.eligible === true;
    if (expectedOutcome === 'clear') assert.equal(eligible, true);
    await waitUntil(async () => {
      const status = await observeActor(actor), payment = obj(status.payment);
      return status.state === 'terminal' && payment.state === (eligible ? 'paid' : 'ineligible');
    }, 60000, 'authoritative payment or incomplete/zero closure settles separately');
    const credits = num(`SELECT COALESCE(sum(delta),0) FROM game.tickets_ledger WHERE user_id='${login.hub.userId}' AND reason='srv_shooter_boss_clear'`);
    assert.equal(credits, eligible ? 20 : 0);
    assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'`), eligible ? 1 : 0);
    assert.equal(num(`SELECT accepted_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), definition.frames);
    assert.equal(num(`SELECT accepted_bytes FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), definition.framesTextBytes);
    completed += 1;
    console.log(`PASS isolated-stack ${definition.id} full ${definition.frames} frames; retained checkpoint parity; outcome ${String(expectedOutcome)}; tickets ${credits}`);
  }
  assert.equal(completed, 12);
  assert.ok(num(`SELECT count(*) FROM game.shooter_verification_gateway_receipt WHERE worker_id='${workerId}' AND acknowledgment ? 'work'`) === 0, 'private work was never duplicated into durable ACKs');
  console.log('13 actual isolated-stack cases passed; browser, restart/drain and broader adversarial stages are not claimed here');
} finally {
  if (started) ops(['stop', '-t', '40', 'coordinator', 'replay']);
}
