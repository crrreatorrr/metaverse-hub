// Real public ingress denial matrix, followed by actual isolated verification.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { call, canonical, guest, num, openGame, psql, waitReady } from './dup/harness';
import { appendActor, appendDigest, finishActor, observeActor, prepareTrustedActor, reboundBatches } from './dup/shooter_verification_e2e_fixtures';
import { ops, prepareOperations, waitUntil } from './dup/shooter_verification_e2e_operations';

type Obj = Record<string, unknown>;
await waitReady(); await prepareOperations();
const login = await openGame((await guest()).token, 'sproto-shooter');
console.log('::add-mask::' + login.gameToken); console.log('::add-mask::' + login.hub.token);
const actor = await prepareTrustedActor('sahil-fail-7', login, { ageMs: 1200000 });
const batch = reboundBatches(actor)[0]!;
const stranger = await openGame((await guest()).token, 'sproto-shooter');
// Opening a replacement correctly closes the owner's old game session. Keep
// that adversarial binding fixture separate from the live primary actor.
const replacementOwner = await openGame((await guest()).token, 'sproto-shooter');
const replacementActor = await prepareTrustedActor('sahil-fail-7', replacementOwner, { ageMs: 1200000 });
const replacement = await openGame(replacementOwner.hub.token, 'sproto-shooter');
const sha = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
function history(): string {
  return sha(JSON.parse(psql(`SELECT jsonb_build_object('accepted',jsonb_build_array(accepted_sequence,accepted_tick,accepted_bytes,accepted_actions,accepted_batches),
    'verified',jsonb_build_array(revision,verified_tick,simulation_tick),'checkpoint',checkpoint_sha256,
    'batches',(SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${actor.runId}'),
    'jobs',(SELECT count(*) FROM game.shooter_verification_job WHERE run_id='${actor.runId}'),
    'receipt',(SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'),
    'money',(SELECT COALESCE(sum(delta),0) FROM game.tickets_ledger WHERE user_id='${login.hub.userId}' AND reason='srv_shooter_boss_clear'))::text
    FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`)));
}
let passes = 0;
async function reject(label: string, name: string, body: Obj, token: string, state: string, reason: string): Promise<void> {
  const before = history(), response = (await call(name, body, token)).body as Obj;
  assert.equal(response.state, state, label); assert.equal(response.reason, reason, label);
  assert.equal(history(), before, label + ' changes no accepted evidence/checkpoint/job/payment');
  passes++; console.log('PASS public-adversarial ' + label);
}
const append = (label: string, body: Obj, state = 'invalid', reason = 'malformed', token = login.gameToken): Promise<void> => reject(label, 'shooter.run.append', body, token, state, reason);
for (const [key, value] of [['state', { hp: 999, godMode: true }], ['seed', 7], ['outcome', 'clear'], ['manifest', { sha256: 'a'.repeat(64) }]] as const)
  await append('client supplied ' + key + ' is not upload authority', { ...batch, [key]: value });
await append('unsupported god/debug action', { ...batch, actions: [[0, 3]] });
await append('duplicate action index', { ...batch, actions: [[0, 1], [0, 1]] });
await append('noncanonical padded base64', { ...batch, frames: batch.frames.slice(0, -1) + '=' });
const invalidSlot = Buffer.from(batch.frames, 'base64'); invalidSlot[10] = 5;
await append('out of range canonical slot', { ...batch, frames: invalidSlot.toString('base64') });
await append('noninteger sequence', { ...batch, sequence: 0.5 });
await append('negative sequence', { ...batch, sequence: -1 });
await append('sequence gap', { ...batch, sequence: 1 }, 'invalid', 'noncontiguous');
await append('tick gap', { ...batch, tick0: 1 }, 'invalid', 'noncontiguous');
await append('other account cannot upload', batch, 'invalid', 'unknown_run', stranger.gameToken);
await append('owner Hub JWT cannot upload', batch, 'authorization_denied', 'not_game_session', login.hub.token);
await append('replacement session cannot rebind original run', reboundBatches(replacementActor)[0]!, 'invalid', 'unknown_run', replacement.gameToken);
assert.equal(num(`SELECT accepted_tick FROM game.shooter_verification_run WHERE run_id='${replacementActor.runId}'`), 0);
assert.equal(num(`SELECT count(*) FROM game.shooter_verification_batch WHERE run_id='${replacementActor.runId}'`), 0);
await reject('forged finish outcome', 'shooter.run.finish', { protocol: 2, runId: actor.runId, lastSequence: -1, lastTick: 0, outcome: 'clear' }, login.gameToken, 'invalid', 'malformed');
await reject('finish cannot skip unaccepted highwater', 'shooter.run.finish', { protocol: 2, runId: actor.runId, lastSequence: 0, lastTick: batch.n }, login.gameToken, 'invalid', 'seal_conflict');
await reject('cohort issue cannot choose seed', 'shooter.run.issue', { key: randomUUID(), canonicalBoss: 'sahil', seed: 7 }, login.gameToken, 'invalid', 'malformed');
await reject('cohort issue cannot request legacy fallback', 'shooter.run.issue', { key: randomUUID(), canonicalBoss: 'sahil', protocol: 1 }, login.gameToken, 'invalid', 'malformed');
await reject('other owner cannot inspect status', 'shooter.run.status', { runId: actor.runId }, stranger.hub.token, 'invalid', 'unknown_run');
assert.equal(passes, 20, 'every explicit public denial case ran');
const legacyBefore = history();
const legacy = (await call('shooter.run.submit', { runId: actor.runId, log: {}, state: { bossDead: true }, outcome: 'clear' }, login.gameToken)).body as Obj;
assert.equal(legacy.reason, 'wrong_protocol'); assert.equal(legacy.paid, false); assert.equal(history(), legacyBefore);
passes++; console.log('PASS public-adversarial forged legacy submit cannot bypass v2');
await appendActor(actor);
const accepted = (await call('shooter.run.append', batch, login.gameToken)).body as Obj;
assert.equal(accepted.state, 'received'); assert.equal(accepted.digest, appendDigest(batch));
const beforeRetry = history();
const retry = (await call('shooter.run.append', batch, login.gameToken)).body as Obj;
assert.deepEqual(retry, accepted); assert.equal(history(), beforeRetry);
passes++; console.log('PASS public-adversarial exact duplicate returns immutable ACK without resource duplication');
const changed = Buffer.from(batch.frames, 'base64'); changed[4] = changed[4] === 0 ? 1 : 0;
await append('changed duplicate is a conflict', { ...batch, frames: changed.toString('base64') }, 'invalid', 'sequence_conflict');
const seal = await finishActor(actor, 0), sealBefore = history();
assert.deepEqual(await finishActor(actor, 0), seal); assert.equal(history(), sealBefore);
passes++; console.log('PASS public-adversarial finish retry preserves exact seal without verification revision changes');
await append('new tail cannot append after seal', { ...batch, sequence: 1, tick0: batch.n, n: 1, frames: batch.frames.slice(0, 16), actions: [] }, 'invalid', 'run_closed');
let started = false;
try {
  ops(['up', '-d', '--build', '--no-deps', 'replay', 'coordinator']); started = true;
  await waitUntil(() => num(`SELECT verified_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`) === batch.n, 90000,
    'valid original full input still completes through actual isolated worker after hostile requests');
  await waitUntil(async () => {
    const status = await observeActor(actor);
    return status.state === 'terminal' && (status.payment as Obj).state === 'ineligible';
  }, 60000, 'actual failed trace closes without payment');
  assert.equal(num(`SELECT count(*) FROM game.shooter_receipt WHERE run_id='${actor.runId}'`), 0);
  assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id='${login.hub.userId}' AND reason='srv_shooter_boss_clear'`), 0);
  assert.equal(num(`SELECT accepted_tick FROM game.shooter_verification_run WHERE run_id='${actor.runId}'`), 1001);
  passes++; console.log('PASS public-adversarial actual full1001 verifier result remains fail/zero after every forgery');
  assert.equal(passes, 26);
  console.log('26 actual public-ingress adversarial/idempotency/isolated-verification cases passed; concurrency/time/caps remain separately required backend matrix evidence');
} finally { if (started) ops(['stop', '-t', '40', 'coordinator', 'replay']); }
