// Drain RPCs are server-only. A signed-in player cannot start maintenance.
// While it is on, a new arena room is refused. An empty node reports zero hard matches.
// maint.live sorts live matches by their label, the only thing a real Nakama lists about them.
import assert from 'node:assert/strict';
import { loadModule, presence, type LoadedModule } from './harness';

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

// One match of every kind, each made by its own matchInit so the label is the one the real server lists,
// and each with a player in it. The drain waits for the five hard kinds and for nothing else.
{
  const A = '00000000-0000-4000-8000-00000000000a';
  const B = '00000000-0000-4000-8000-00000000000b';
  const flagOn = (args: unknown[]) => (String(args[0]) === 'racer_online' ? [{ result: JSON.stringify({ state: 'on', allowlist: [], percent: 0 }) }] : []);
  const all: LoadedModule = loadModule({ env: { COOP_AUTHORITATIVE: '1' }, sql: [[/FROM game\.server_flags/, flagOn]] });
  const names = JSON.stringify({ [A]: 'ada', [B]: 'bea' });
  let seats = 0;
  /** Puts one player in the match, the way a join leaves it: `size` is all maint.live reads besides the label. */
  const seat = (matchId: string): void => {
    seats += 1;
    all.nk.matches.get(matchId)!.presences.set(`s-${seats}`, presence(A, 'ada', `s-${seats}`));
  };
  type Live = { hard: number; soft: number; kinds: { duel: number; arena: number; coop: number; shooter: number; racer: number } };
  const count = (): Live => all.call<Live>('maint.live', server, {});
  const byKind = (kind: string): string[] => [...all.nk.matches.values()].filter((m) => JSON.parse(m.label).kind === kind).map((m) => m.matchId);

  // The always-on matches (plaza shard 1 and the wager sweep) are there from boot, empty, and count for nothing.
  assert.equal(byKind('shooter_wager_sweep').length, 1);
  assert.deepEqual(count(), { hard: 0, soft: 0, kinds: { duel: 0, arena: 0, coop: 0, shooter: 0, racer: 0 } });

  const duel = all.startMatch('sproto_duel', { players: JSON.stringify([A, B]), names, wager: '0', sim: 'maint-test' }).match;
  const arena = all.startMatch('sproto_arena', { players: JSON.stringify([A]), names, v: '2', private: '1', code: 'MAINT1' }).match;
  const coop = all.startMatch('sproto_coop', { private: '1', code: 'MAINT2', names, seed: '3', seedSource: 'server' }).match;
  const shooter = all.startMatch('sproto_shooter_free', { spawnSeed: '7', seedSource: 'server', private: '1', host: A }).match;
  const racerMade = all.call<{ matchId: string; error?: string }>('racer.room_create', { userId: A, vars: { scope: 'game', game: 'sproto-racer', sid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }, {
    game: 'sproto-racer', version: (all.global.RacerProto as { NET_VERSION: string }).NET_VERSION, simVersion: (all.global.RacerProto as { SIM_VERSION: string }).SIM_VERSION, courseId: 'track01', mode: 'race', maxSeats: 2,
  });
  assert.equal(racerMade.error, undefined, JSON.stringify(racerMade));
  const racer = all.nk.matches.get(racerMade.matchId)!;

  // A row is exactly what Nakama 3.41 gives a module. Nothing here names the handler.
  const rows = (all.nk.matchList as (limit: number, authoritative: boolean) => Record<string, unknown>[])(1000, true);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['authoritative', 'label', 'matchId', 'size']);
  assert.deepEqual(Object.keys((all.nk.matchGet as (id: string) => Record<string, unknown>)(duel.matchId)).sort(), ['authoritative', 'label', 'matchId', 'size']);

  // The labels this sorting rests on. A duel's has a game and no kind.
  assert.deepEqual(JSON.parse(duel.label), { game: 'sproto-fighter', wager: false });
  assert.equal(JSON.parse(arena.label).kind, 'sproto_arena');
  assert.equal(JSON.parse(coop.label).kind, 'sproto_coop');
  assert.equal(JSON.parse(shooter.label).kind, 'sproto_shooter_free');
  assert.equal(JSON.parse(racer.label).kind, 'sproto_racer');

  // Empty matches are not waited for.
  assert.equal(count().hard, 0);

  let hard = 0;
  for (const [kind, match] of [['duel', duel], ['arena', arena], ['coop', coop], ['shooter', shooter], ['racer', racer]] as const) {
    seat(match.matchId);
    hard += 1;
    const live = count();
    assert.equal(live.kinds[kind], 1, `${kind}: ${JSON.stringify(live)}`);
    assert.equal(live.hard, hard, `${kind}: ${JSON.stringify(live)}`);
    assert.equal(live.soft, 0, `${kind}: ${JSON.stringify(live)}`);
  }
  // A wager lobby is a Shooter match too: same kind, another mode.
  const wager = all.startMatch('sproto_shooter_free', { spawnSeed: '8', seedSource: 'server', private: '1', host: B, wager: '1', stake: '10' }).match;
  assert.equal(JSON.parse(wager.label).kind, 'sproto_shooter_free');
  seat(wager.matchId);
  assert.deepEqual(count(), { hard: 6, soft: 0, kinds: { duel: 1, arena: 1, coop: 1, shooter: 2, racer: 1 } });

  // The plaza, a People's Bitcoin world and an arcade coop room are soft: counted, never waited for.
  seat(byKind('hub')[0]!);
  const pb = all.startMatch('pb_world', { world: '1' }).match;
  seat(pb.matchId);
  const arcade = all.startMatch('sproto_arcade_coop', { code: 'MAINT', level: '1', quick: '0' }).match;
  seat(arcade.matchId);
  assert.deepEqual(count(), { hard: 6, soft: 3, kinds: { duel: 1, arena: 1, coop: 1, shooter: 2, racer: 1 } });

  // The wager sweep is the server's timer. Nobody can join it; even if its size were not 0 it is in neither count.
  seat(byKind('shooter_wager_sweep')[0]!);
  assert.deepEqual(count(), { hard: 6, soft: 3, kinds: { duel: 1, arena: 1, coop: 1, shooter: 2, racer: 1 } });

  // A populated match whose label is not JSON, or is JSON of another shape, is soft. It cannot stop a deploy.
  for (const label of ['', 'not json', '"sproto_coop"', 'null', '[1]', '{"kind":7}', '{"kind":"sproto_duel"}', '{"kind":"other","game":"sproto-fighter"}']) {
    const odd = all.startMatch('sproto_duel', { players: JSON.stringify([A, B]), names, wager: '0', sim: 'maint-test' }).match;
    odd.label = label;
    seat(odd.matchId);
    const live = count();
    assert.equal(live.hard, 6, `${JSON.stringify(label)}: ${JSON.stringify(live)}`);
    odd.ended = true;
  }

  // A match that ends leaves the count, which is what lets the drain finish.
  shooter.ended = true;
  wager.ended = true;
  assert.deepEqual(count().kinds, { duel: 1, arena: 1, coop: 1, shooter: 0, racer: 1 });
  for (const match of [duel, arena, coop, racer]) match.presences.clear();
  assert.equal(count().hard, 0);
}

console.log('maint tests ok');
