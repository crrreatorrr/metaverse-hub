// M11 play lease wiring (handoff §4.3): migration 0074 is registered, session.claim and
// session.heartbeat answer, and no other RPC requires a lease yet.
import assert from 'node:assert/strict';
import { loadModule } from './harness';

const U = '00000000-0000-4000-8000-000000000071';
const SID = '00000000-0000-4000-9000-000000000071';
const mod = loadModule();
assert.ok(mod.registered.rpcs.has('session.claim'));
assert.ok(mod.registered.rpcs.has('session.heartbeat'));
assert.match(mod.source, /0074_play_lease/);
assert.match(mod.source, /'sproto-coop-battle', 'vcoin'/, 'every game id is a valid surface');

let claims = 0;
mod.nk.onSql(/game\.claim_play_lease/, (args) => {
  claims += 1;
  return [{ result: JSON.stringify({ ok: true, leaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', surface: (args as unknown[])[1], previousLeaseId: null, superseded: false, heartbeatSeconds: 15, ttlSeconds: 45 }) }];
});
mod.nk.onSql(/game\.heartbeat_play_lease/, () => [{ result: JSON.stringify({ error: 'session_superseded' }) }]);
const claimed = mod.call<{ leaseId?: string; surface?: string; error?: string }>('session.claim', { userId: U, vars: { scope: 'game', game: 'sproto-arcade', sid: SID } }, {});
assert.equal(claimed.leaseId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', JSON.stringify(claimed));
assert.equal(claimed.surface, 'sproto-arcade');
assert.equal(claims, 1);
assert.equal(mod.call<{ error?: string }>('session.claim', { userId: U, vars: { scope: 'game', game: 'sproto-arcade', sid: SID } }, { surface: 'hub' }).error, 'bad_surface');
const beat = mod.call<{ error?: string }>('session.heartbeat', { userId: U, vars: { scope: 'game', game: 'sproto-arcade', sid: SID } }, { leaseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
assert.equal(beat.error, 'session_superseded');
console.log('play lease wiring ok');
