// Drain RPCs are server-only. A signed-in player cannot start maintenance.
// While it is on, a new arena room is refused. An empty node reports zero hard matches.
import assert from 'node:assert/strict';
import { loadModule } from './harness';

const USER = '11111111-1111-4111-8111-111111111111';
const mod = loadModule();

const server = { userId: '', vars: {} as { [key: string]: string } };
const player = { userId: USER, username: 'ada', vars: { scope: 'game', game: 'sproto' } };

const denied = mod.call<{ error?: string }>('maint.begin', player, { reason: 'deploy', deadline: Math.floor(Date.now() / 1000) + 120 });
assert.equal(denied.error, 'unauthorized');

const begun = mod.call<{ ok?: boolean; deadline?: number }>('maint.begin', server, { reason: 'deploy test', deadline: Math.floor(Date.now() / 1000) + 120 });
assert.equal(begun.ok, true);

const live = mod.call<{ hard?: number; soft?: number; kinds?: { duel: number; arena: number; coop: number; shooter: number } }>('maint.live', server, {});
assert.equal(live.hard, 0);
assert.equal(live.kinds?.duel, 0);
assert.equal(live.kinds?.shooter, 0);

let roomError = '';
try {
  mod.call('sproto.room_create', player, { v: '2' });
} catch (error) {
  roomError = error instanceof Error ? error.message : String(error);
}
assert.match(roomError, /maintenance/);

const ended = mod.call<{ ok?: boolean }>('maint.end', server, {});
assert.equal(ended.ok, true);
const after = mod.call<{ hard?: number }>('maint.live', server, {});
assert.equal(after.hard, 0);

const past = mod.call<{ error?: string }>('maint.begin', server, { reason: 'late', deadline: Math.floor(Date.now() / 1000) - 5 });
assert.equal(past.error, 'bad_deadline');

console.log('maint tests ok');
