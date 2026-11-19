// Trust hardening behind server flags (handoff §4.3). Every rule is off without a flag row, so
// live clients keep working; each turns on with its game.server_flags row.
import assert from 'node:assert/strict';
import { loadModule } from './harness';

const U = '00000000-0000-4000-8000-000000000081';
const SID = '00000000-0000-4000-9000-000000000081';
const ctx = { userId: U, vars: { scope: 'game', game: 'nobu', sid: SID } };

function load(on: string[], ageS = 5) {
  const mod = loadModule();
  mod.nk.onSql(/FROM game\.server_flags/, (args) => (on.includes(String((args as unknown[])[0])) ? [{ result: JSON.stringify({ state: 'on', allowlist: [], percent: 0 }) }] : []));
  mod.nk.onSql(/game\.earn_tickets/, () => [{ result: JSON.stringify({ balance: 10, capped: false }) }]);
  mod.nk.onSql(/game\.apply_event/, () => [{ result: JSON.stringify({}) }]);
  mod.nk.onSql(/opened_at\)\)::float8/, () => [{ age: String(ageS) }]);
  return mod;
}

// Flags off: today's behaviour.
{
  const mod = load([]);
  assert.equal(mod.call<{ balance?: number }>('tickets.earn', ctx, { amount: 10, reason: 'win', key: 'k1', godMode: true }).balance, 10);
  assert.equal(mod.call<{ error?: string }>('session.event', ctx, { eventId: 'nobu.ready', data: {}, key: 'e1' }).error, undefined);
}
// Each flag on.
{
  const mod = load(['trust_godmode_tickets']);
  assert.equal(mod.call<{ error?: string }>('tickets.earn', ctx, { amount: 10, reason: 'win', key: 'k2', godMode: true }).error, 'god_mode');
  assert.equal(mod.call<{ balance?: number }>('tickets.earn', ctx, { amount: 10, reason: 'win', key: 'k3' }).balance, 10);
}
{
  const mod = load(['trust_min_session'], 5);
  assert.equal(mod.call<{ error?: string }>('tickets.earn', ctx, { amount: 10, reason: 'win', key: 'k4' }).error, 'too_soon');
  const old = load(['trust_min_session'], 120);
  assert.equal(old.call<{ balance?: number }>('tickets.earn', ctx, { amount: 10, reason: 'win', key: 'k5' }).balance, 10);
}
{
  const mod = load(['trust_event_seq']);
  assert.equal(mod.call<{ error?: string }>('session.event', ctx, { eventId: 'nobu.ready', data: {}, key: 'e2' }).error, 'bad_event');
  assert.equal(mod.call<{ error?: string }>('session.event', ctx, { eventId: 'nobu.ready', data: {}, key: 'e3', seq: 1 }).error, undefined);
}
console.log('trust flags ok');
