import assert from 'node:assert/strict';
import { loadModule } from '../unit/harness';

const m = loadModule();
const schema = m.global.HubSchema as { all(): { id: string; statements: string[] }[] };
const migration = schema.all().find((entry) => entry.id === '0055_shooter_verification_settlement')!;
const clock = migration.statements.find((statement) => statement.includes('FUNCTION game.shooter_verification_payment_now()'))!;
assert.match(clock, /^CREATE OR REPLACE FUNCTION game\.shooter_verification_payment_now\(\)\s+RETURNS timestamptz LANGUAGE sql VOLATILE AS \$clock\$SELECT clock_timestamp\(\)\$clock\$$/,
  'production financial time has no caller argument, table, configuration or fixture override');
const worker = 'a0550000-0000-4000-8000-000000000001';
const ack = { state: 'terminal_verified', runId: 'untrusted-echo-is-not-the-sql-target', terminalRevision: 1, revision: 3 };
const before = JSON.stringify(ack);
const hook = m.global.ShooterVerificationSettlement as { afterResult: (...args: unknown[]) => void };
const calls: unknown[][] = [];
m.nk.onSql('SELECT game.settle_shooter_verified_result', (args) => {
  calls.push(Array.from(args)); // Own host-realm array for the assertion boundary.
  throw new Error('private-checkpoint-or-credential-must-never-enter-logs');
});
hook.afterResult(m.ctx({ userId: worker }), m.logger, m.nk, 'worker', 'key', 'a'.repeat(64), 'committed-receipt-reference', ack);
assert.deepEqual(calls, [[worker, 'worker', 'key', 'a'.repeat(64), 'committed-receipt-reference']], 'payment target comes from the committed SQL receipt, not caller echoes or amounts');
assert.equal(JSON.stringify(ack), before, 'a payment failure cannot rewrite the immutable checkpoint acknowledgment');
assert.equal(m.logger.lines.filter((line) => line.level === 'error').length, 1);
assert.equal(JSON.stringify(m.logger.lines).includes('private-checkpoint-or-credential'), false);
assert.ok(JSON.stringify(m.logger.lines).includes('shooter deferred payment operational failure'));
hook.afterResult(m.ctx({ userId: worker }), m.logger, m.nk, 'worker', 'key', 'a'.repeat(64), 'reference', { state: 'verified', runId: ack.runId, terminalRevision: null });
assert.equal(calls.length, 1, 'no financial query for a nonterminal progress acknowledgment');
console.log('deferred payment receipt binding, immutable acknowledgment and secret-redaction tests ok');
