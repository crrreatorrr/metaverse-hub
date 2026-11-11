import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadModule } from '../unit/harness';

const USER = 'a0510000-0000-4000-8000-000000000001';
const SID = 'a0510000-0000-4000-8000-000000000002';
const RUN = 'a0510000-0000-4000-8000-000000000003';
const ctx = { userId: USER, vars: { scope: 'game', game: 'sproto-shooter', sid: SID } };
const input = { protocol: 2, runId: RUN, sequence: 0, tick0: 0, n: 1, frames: Buffer.alloc(12).toString('base64'), actions: [] };

{
  const mod = loadModule();
  mod.nk.sqlCalls.length = 0;
  const captured: unknown[][] = [];
  mod.nk.onSql('game.shooter_verification_preflight', () => [{ result: '{"state":"ready"}' }]);
  mod.nk.onSql('game.shooter_verification_append', (args) => {
    captured.push(args);
    return [{ result: JSON.stringify({ protocol: 2, state: 'received', sequence: 0, digest: args[8] }) }];
  });
  const a = mod.call<Record<string, unknown>>('shooter.run.append', ctx, input);
  const reordered = { actions: [], frames: input.frames, n: 1, tick0: 0, sequence: 0, runId: RUN, protocol: 2 };
  const b = mod.call<Record<string, unknown>>('shooter.run.append', ctx, reordered);
  assert.deepEqual(a, b, 'JSON property order does not alter canonical request identity');
  assert.equal(a.state, 'received');
  assert.equal(captured[0]![0], USER);
  assert.equal(captured[0]![1], SID);
  assert.equal(captured[0]![8], createHash('sha256').update(`shooter.append.v2\n${JSON.stringify(input)}`).digest('hex'));
  assert.ok(!mod.nk.sqlCalls.some((call) => /settle_shooter|save_shooter_checkpoint|close_shooter_run/.test(call.sql)), 'append never pays or runs legacy verification');
}

{
  const mod = loadModule();
  mod.nk.sqlCalls.length = 0;
  mod.nk.onSql('game.shooter_verification_preflight', () => [{ result: '{"state":"ready"}' }]);
  const badFrames = Buffer.alloc(12); badFrames[10] = 128;
  const cases = [
    { ...input, checkpoint: {} }, { ...input, seed: 7 }, { ...input, outcome: 'clear' },
    { ...input, reward: 20 }, { ...input, sequence: 0.5 }, { ...input, tick0: -1 },
    { ...input, n: 28801 }, { ...input, protocol: 1 }, { ...input, frames: input.frames + '=' },
    { ...input, frames: badFrames.toString('base64') }, { ...input, actions: [[0, 1], [0, 1]] },
    { ...input, actions: [[0, 2]] }, { ...input, actions: [[1, 1]] },
  ];
  for (const body of cases) assert.equal(mod.call<Record<string, unknown>>('shooter.run.append', ctx, body).state, 'invalid');
  assert.ok(!mod.nk.sqlCalls.some((call) => call.sql.includes('game.shooter_verification_append')));
  const before = mod.nk.sqlCalls.length;
  assert.equal(mod.call<Record<string, unknown>>('shooter.run.append', ctx, { ...input, frames: 'é'.repeat(1100000) }).state, 'invalid');
  assert.equal(mod.nk.sqlCalls.length, before, 'UTF8 wire bytes rejected before database/decoding work');
  assert.equal(mod.call<Record<string, unknown>>('shooter.run.append', { userId: USER, vars: { scope: 'hub' } }, input).state, 'authorization_denied');
}

{
  const mod = loadModule();
  mod.nk.sqlCalls.length = 0;
  mod.nk.onSql('game.shooter_verification_preflight', () => [{ result: '{"state":"pending_retryable","reason":"rate_limited"}' }]);
  const result = mod.call<Record<string, unknown>>('shooter.run.append', ctx, { ...input, frames: '!'.repeat(16) });
  assert.equal(result.reason, 'rate_limited', 'durable preflight rate denial occurs before frame decoding');
  assert.ok(!mod.nk.sqlCalls.some((call) => call.sql.includes('game.shooter_verification_append')));
}

{
  const mod = loadModule();
  mod.nk.sqlCalls.length = 0;
  mod.nk.onSql('FROM game.shooter_verification_run r', () => [{ result: '{"protocol":2,"state":"expired","payment":{"state":"none"}}' }]);
  const status = mod.call<Record<string, unknown>>('shooter.run.status', { userId: USER, vars: { scope: 'hub' } }, { runId: RUN });
  assert.equal(status.state, 'expired', 'owner account auth can read after original game-session expiry');
  const sql = mod.nk.sqlCalls.find((call) => call.sql.includes('FROM game.shooter_verification_run r'))!.sql;
  assert.ok(!sql.includes('r.checkpoint_json') && !sql.includes('r.terminal_result'), 'status selects explicit fields only');
  assert.ok(sql.includes('paid.run_id IS NOT NULL'), 'metadata alone cannot claim payment');
  assert.equal(mod.call<Record<string, unknown>>('shooter.run.status', { userId: USER, vars: { scope: 'game', game: 'nobu' } }, { runId: RUN }).state, 'authorization_denied');
}

console.log('shooter v2 ingress: strict envelopes, canonical digest, UTF8 bounds, predecode admission and owner status ok');
