// E3 hub.presence and E4 hub.champions with a scripted nk: scope, shape, cache, rate limit, name cleaning.
import assert from 'node:assert/strict';
import { loadModule, plain } from './harness';

const U = '11111111-1111-4111-8111-111111111111';
const SID = '33333333-3333-4333-8333-333333333333';
const hub = { userId: U, vars: { scope: 'hub' } };
const game = { userId: U, vars: { scope: 'game', game: 'nobu', sid: SID, ranked: '0' } };

interface Presence { counts: Record<string, number>; windowMinutes: number; error?: string }
interface Champions { champions: { order: number; userId: string; name: string }[]; error?: string }

// hub.presence
{
  const mod = loadModule();
  assert.ok(mod.registered.rpcs.has('hub.presence') && mod.registered.rpcs.has('hub.champions'));
  let queries = 0;
  let rows: Record<string, unknown>[] = [{ game_id: 'nobu', n: 3 }, { game_id: 'sproto-coop-battle', n: '2' }, { game_id: 'vcoin', n: 9 }, { game_id: 'hpos10i', n: -4 }];
  mod.nk.onSql('FROM game.game_session', (args, sql) => {
    queries += 1;
    assert.deepEqual(plain(args), [30]);
    assert.match(sql, /state = 'open'/);
    assert.match(sql, /ticket_redeemed_at > now\(\)/);
    assert.match(sql, /count\(DISTINCT user_id\)/);
    return rows;
  });
  const first = mod.call<Presence>('hub.presence', hub, {});
  assert.deepEqual(plain(first.counts), {
    hpos10i: 0, nobu: 3, 'peoples-bitcoin': 0, sproto: 0, 'sproto-fighter': 0, 'sproto-arcade': 0, 'sproto-shooter': 0, 'sproto-coop-battle': 2,
  }, 'all eight games, unknown ids dropped, junk clamped');
  assert.equal(first.windowMinutes, 30);
  rows = [{ game_id: 'nobu', n: 99 }];
  assert.equal(mod.call<Presence>('hub.presence', hub, {}).counts.nobu, 3, 'cached: the second call does not query');
  assert.equal(queries, 1);
  assert.equal(typeof mod.nk.localcache.get('hub:presence'), 'string', 'cached as a scalar (Contract C12)');
  mod.nk.localcache.delete('hub:presence');
  assert.equal(mod.call<Presence>('hub.presence', hub, {}).counts.nobu, 99);
  assert.equal(mod.call<Presence>('hub.presence', game, {}).error, 'wrong_scope');
  assert.equal(mod.call<Presence>('hub.presence', { vars: { scope: 'hub' } }, {}).error, 'unauthorized');
  // 12 per minute per account.
  let limited = 0;
  for (let i = 0; i < 20; i += 1) if (mod.call<Presence>('hub.presence', hub, {}).error === 'rate_limited') limited += 1;
  assert.equal(limited, 20 - (12 - 3), 'three calls were already spent above');
}

// hub.champions
{
  const mod = loadModule();
  let queries = 0;
  mod.nk.onSql('FROM game.relic_claim', (args, sql) => {
    queries += 1;
    assert.deepEqual(plain(args), [50]);
    for (const relic of ['hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown']) assert.ok(sql.includes(`'${relic}'`), relic);
    assert.match(sql, /count\(DISTINCT relic_id\) = 4/);
    assert.match(sql, /ORDER BY c\.done, c\.user_id/);
    assert.equal(/tidebreaker_belt|breakwater_coin|marina_anchor|dragon_scale/.test(sql), false, 'later Relics never open the Hall');
    return [
      { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'first_light' },
      { user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: '' },
      { user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: null },
    ];
  });
  const out = mod.call<Champions>('hub.champions', hub, {});
  assert.deepEqual(plain(out.champions.map((c) => [c.order, c.name])), [[1, 'first_light'], [2, 'bbbbbbbb'], [3, 'cccccccc']], 'a blank name shows the id stub, like board rows');
  mod.call('hub.champions', hub, {});
  assert.equal(queries, 1, 'cached for a minute');
  assert.equal(mod.call<Champions>('hub.champions', game, {}).error, 'wrong_scope');
}

console.log('hub life tests ok');
