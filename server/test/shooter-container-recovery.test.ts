// Real coordinator PID/container crashes, durable result proofs and no-CP repair.
import assert from 'node:assert/strict';
import { arm, disarm, dropFaultHooks, guest, installFaultHooks, num, openGame, psql, waitReady } from './dup/harness';
import { appendActor, finishActor, prepareTrustedActor } from './dup/shooter_verification_e2e_fixtures';
import { ops, prepareOperations, waitUntil } from './dup/shooter_verification_e2e_operations';

type Obj = Record<string, unknown>;
function health(route = 'health'): Obj {
  assert.ok(['health', 'metrics'].includes(route));
  return JSON.parse(ops(['exec', '-T', 'coordinator', 'node', '-e', `fetch('http://127.0.0.1:9476/${route}').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))`])) as Obj;
}
function journalReference(): { phase: string; requestId: string; sha256: string } | null {
  // Import the production journal inside the container as its actual owner.
  // Never emit its body/CP, credentials, arbitrary error or HTTP headers.
  return JSON.parse(ops(['exec', '-T', 'coordinator', 'node', '--input-type=module', '-e',
    "import{Journal}from'./services/shooter-verifier/ops/journal.mjs';import{requestDigest}from'./services/shooter-verifier/src/gateway-client.mjs';const r=new Journal().load();process.stdout.write(JSON.stringify(r?{phase:r.phase,requestId:r.requestId||null,sha256:r.body?requestDigest('result',r.body):null}:null))"])) as { phase: string; requestId: string; sha256: string } | null;
}
const credit = (user: string): number => num(`SELECT COALESCE(sum(delta),0) FROM game.tickets_ledger WHERE user_id='${user}' AND reason='srv_shooter_boss_clear'`);
await waitReady();
const workerId = await prepareOperations();
const accountId = psql(`SELECT account_id FROM game.shooter_verification_worker WHERE worker_id='${workerId}'`);
installFaultHooks();
let started = false;
try {
  for (const expireOriginal of [false, true]) {
    if (started) ops(['stop', '-t', '40', 'coordinator']);
    psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=true');
    const login = await openGame((await guest()).token, 'sproto-shooter');
    const actor = await prepareTrustedActor('broccoli-success-7', login, { ageMs: 1200000 });
    await appendActor(actor); await finishActor(actor, 0);
    psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=false');
    arm(accountId, 'shooter.worker.after_commit', 'sleep');
    ops(['up', '-d', '--build', '--no-deps', 'replay', 'coordinator']); started = true;
    // Existing after_commit hook blocks only the response path AFTER0054's
    // durable result transaction and BEFORE separate0055 payment dispatch.
    await waitUntil(() => num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='hf:${accountId}:shooter.worker.after_commit' AND wait_event='PgSleep'`) === 1,
      60000, 'actual HTTP result is held after durable checkpoint commit');
    assert.equal(num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), actor.trace.definition.frames);
    assert.equal(health().journalPhase, 'submitting');
    const reference = journalReference(); assert.ok(reference); assert.equal(reference.phase, 'submitting');
    assert.match(reference.requestId, /^[A-Za-z0-9_.:@|-]{1,80}$/); assert.match(reference.sha256, /^[0-9a-f]{64}$/);
    const receiptSQL = `FROM game.shooter_verification_gateway_receipt WHERE worker_id='${workerId}' AND request_id='${reference.requestId}'`;
    assert.equal(psql(`SELECT request_sha256 ${receiptSQL}`), reference.sha256);
    assert.equal(psql(`SELECT acknowledgment->>'state' ${receiptSQL}`), 'terminal_verified');
    assert.equal(num(`SELECT count(*) ${receiptSQL}`), 1); assert.equal(credit(login.hub.userId), 0);
    // Kill the actual coordinator process while its result HTTP response is
    // blocked; memory/fetch promises disappear but the fsynced journal remains.
    ops(['kill', '-s', 'SIGKILL', 'coordinator']);
    psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='hf:${accountId}:shooter.worker.after_commit'`);
    disarm(accountId);
    const immutable = psql(`SELECT acknowledgment::text ${receiptSQL}`);
    assert.equal(num(`SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${actor.runId}' AND state IN ('blocked','ready','leased','retry_wait')`), 0);
    if (expireOriginal) psql(`UPDATE game.game_session SET lease_until=clock_timestamp()-interval '1 second' WHERE session_id='${login.sessionId}'`);
    ops(['start', 'coordinator']);
    await waitUntil(() => { try { return journalReference() === null; } catch { return false; } }, 60000,
      'fresh coordinator process recovers stored result proof and deletes full private journal');
    assert.equal(psql(`SELECT acknowledgment::text ${receiptSQL}`), immutable);
    assert.equal(psql(`SELECT request_sha256 ${receiptSQL}`), reference.sha256);
    assert.equal(num(`SELECT count(*) ${receiptSQL}`), 1);
    assert.equal(credit(login.hub.userId), 0);
    // The only remaining authority is the server-stored result reference. No
    // runnable jobs and no journal CP body exist when periodic payment repairs.
    if (!expireOriginal) arm(login.hub.userId, 'earn.after_wallet', 'sleep');
    psql('UPDATE game.shooter_verification_payment_config SET payments_enabled=true');
    if (!expireOriginal) {
      await waitUntil(() => num(`SELECT count(*) FROM pg_stat_activity WHERE application_name='hf:${login.hub.userId}:earn.after_wallet' AND wait_event='PgSleep'`) === 1,
        60000, 'periodic proof-only repair actually reached the held wallet transaction');
      assert.equal(credit(login.hub.userId), 0); assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'`), 0);
      psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='hf:${login.hub.userId}:earn.after_wallet'`);
      disarm(login.hub.userId);
      await waitUntil(() => credit(login.hub.userId) === 20, 60000, 'no-job/no-CP payment repairs after wallet recovery');
      assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'`), 1);
    } else {
      await waitUntil(() => psql(`SELECT payment_state FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`) === 'authorization_denied',
        60000, 'original-session expiry denies payment after restart');
      assert.equal(credit(login.hub.userId), 0); assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'`), 0);
    }
    // A second real container restart cannot duplicate money or verification.
    const revision = num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`);
    ops(['stop', '-t', '40', 'coordinator']); ops(['start', 'coordinator']);
    await waitUntil(() => { try { return health().ready === true; } catch { return false; } },
      60000, 'second coordinator process becomes ready');
    assert.equal(credit(login.hub.userId), expireOriginal ? 0 : 20);
    assert.equal(num(`SELECT revision FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), revision);
    assert.equal(psql(`SELECT acknowledgment::text ${receiptSQL}`), immutable);
    console.log(`PASS actual-container crash after durable54/lostresponse; stable request digest/ACK; nojobs/noCP proof-only repair; ${expireOriginal ? 'expired original session denied0' : 'wallet recovery paid20 once'}`);
  }
  console.log('2 actual coordinator-container crash/payment-repair cases passed; active drain/restore/adversarial lanes remain separate');
} finally {
  disarm(accountId); dropFaultHooks();
  if (started) ops(['stop', '-t', '40', 'coordinator', 'replay']);
}
