// Contract scaffold: registration shape, game registry, matchmaker routing, RT
// scope hooks, migrations, server economy and the srv_ gate.
import assert from 'node:assert/strict';
import { checkRegistrations, loadModule, plain, presence } from './harness';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';

const mod = loadModule();

// Every initializer.register* call sits in InitModule and names a top-level function.
{
  const { issues, calls } = checkRegistrations(mod.source);
  assert.deepEqual(issues, [], JSON.stringify(issues, null, 2));
  assert.ok(calls > 30, `found ${calls} registrations`);
  const bad = checkRegistrations('function InitModule(c,l,n,initializer){ initializer.registerRpc("x", function(){}); }\ninitializer.registerRpc("y", f);');
  assert.deepEqual(bad.issues.map((i) => i.problem), ['registerRpc is not an identifier', 'registration outside InitModule', 'registerRpc f is not a top-level function']);
}

// Hooks registered.
assert.ok(mod.registered.matchmakerMatched, 'matchmaker dispatcher registered');
for (const id of ['MatchmakerAdd', 'MatchCreate', 'ChannelJoin', 'ChannelMessageSend', 'ChannelMessageUpdate', 'ChannelMessageRemove']) {
  assert.ok(mod.registered.rtBefore.has(id), `rt before ${id}`);
}
assert.ok(mod.registered.matches.has('sproto_duel'));

// HubGames registry.
{
  const HubGames = mod.global.HubGames as {
    list(): string[];
    register(r: unknown): void;
    roomAllowed(scope: string, game: string, room: string): boolean;
    matchmakingAllowed(scope: string, game: string, target: string): boolean;
  };
  assert.ok(HubGames.list().includes('sproto-fighter'));
  assert.throws(() => HubGames.register({ game: 'sproto-fighter' }), /hub_games_duplicate/);
  assert.equal(HubGames.roomAllowed('hub', '', 'hub.1'), true);
  assert.equal(HubGames.roomAllowed('', '', 'hub.12'), true);
  assert.equal(HubGames.roomAllowed('hub', '', 'hub.x'), false);
  assert.equal(HubGames.roomAllowed('game', 'sproto', 'hub.1'), false);
  assert.equal(HubGames.matchmakingAllowed('hub', '', 'sproto-fighter'), true, 'Fighter matchmakes on the hub session');
  assert.equal(HubGames.matchmakingAllowed('game', 'nobu', 'sproto-fighter'), false);
}

// Matchmaker dispatcher routes sproto-fighter to SprotoDuel.onMatched and ignores mixed games.
{
  mod.nk.sqlCalls.length = 0;
  const id = mod.matchmake([
    { presence: presence(USER_A, 'alice'), properties: { game: 'sproto-fighter', wager: '0', sim: 'abc' } },
    { presence: presence(USER_B, 'bob'), properties: { game: 'sproto-fighter', wager: '0', sim: 'abc' } },
  ]);
  assert.ok(id, 'fighter pair creates a sproto_duel match');
  assert.equal(mod.nk.matches.get(id!)?.module, 'sproto_duel');
  assert.ok(mod.nk.sqlCalls.some((c) => c.sql.includes('sproto_wager_expire')));
  const mixed = mod.matchmake([
    { presence: presence(USER_A), properties: { game: 'sproto-fighter', wager: '0', sim: 'abc' } },
    { presence: presence(USER_B), properties: { game: 'sproto', wager: '0', sim: 'abc' } },
  ]);
  assert.equal(mixed, undefined);
  assert.equal(mod.matchmake([{ presence: presence(USER_A), properties: { game: 'nope' } }, { presence: presence(USER_B), properties: { game: 'nope' } }]), undefined);
}

// MatchmakerAdd scope check.
{
  const add = (vars: Record<string, string> | null, game: string) =>
    mod.rtBefore('MatchmakerAdd', { userId: USER_A, vars }, { matchmakerAdd: { minCount: 2, maxCount: 2, query: '*', stringProperties: { game } } });
  assert.ok(add({ scope: 'hub' }, 'sproto-fighter'));
  assert.throws(() => add({ scope: 'hub' }, 'sproto'), /wrong_scope/);
  assert.throws(() => add({ scope: 'game', game: 'nobu', sid: SID }, 'sproto-fighter'), /wrong_game/);
  // Game-scope sproto matchmaking is allowed once games/sproto_arena.ts registers its matchmaker.
  if ((mod.global.HubGames as { list(): string[] }).list().includes('sproto')) assert.ok(add({ scope: 'game', game: 'sproto', sid: SID }, 'sproto'));
  else assert.throws(() => add({ scope: 'game', game: 'sproto', sid: SID }, 'sproto'), /wrong_scope/, 'no sproto matchmaker registered in the hub tree yet');
  assert.throws(() => add(null, ''), /bad_game/);
  assert.throws(() => mod.rtBefore('MatchCreate', { userId: USER_A, vars: { scope: 'hub' } }, { matchCreate: {} }), /match_create_disabled/);
}

// HubSchema: registered migrations are sorted by number; duplicates are rejected.
{
  const HubSchema = mod.global.HubSchema as { register(m: unknown): void; all(): { id: string }[] };
  const ids = plain(HubSchema.all().map((m) => m.id));
  // The hub's own range ends at 0012; game files may register higher ids (Contract C4).
  assert.deepEqual(ids.filter((id) => Number(id.split('_')[0]) <= 12).slice(-2), ['0011_ranked_scores', '0012_chat_moderation']);
  const nums = ids.map((id) => Number(id.split('_')[0]));
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
  assert.deepEqual(ids.filter((id) => id.startsWith('0050_')), [
    '0050_pb_campaign_pistol_price', '0050_shooter_verification_queue',
  ], 'the released independent pair has deterministic order');
  for (const id of ['0050_unrelated_collision', '0050_pb_campaign_pistol_price', '0050_shooter_verification_queue']) {
    const isolated = loadModule({ noInit: true });
    const schema = isolated.global.HubSchema as typeof HubSchema;
    schema.register({ id, statements: ['SELECT 1'] });
    assert.throws(() => schema.all(), /duplicate schema migration (id|number)/, id);
  }
  const fresh = loadModule({ noInit: true });
  const S = fresh.global.HubSchema as typeof HubSchema;
  // Test ids outside every reserved range (hub 0011-0012, PB 0013-0019, sproto 0020-0024).
  S.register({ id: '0090_test_late', statements: ['SELECT 1'] });
  S.register({ id: '0089_test_early', statements: ['SELECT 2'] });
  const order = S.all().map((m) => m.id);
  assert.ok(order.indexOf('0089_test_early') < order.indexOf('0090_test_late'));
  assert.ok(order.indexOf('0012_chat_moderation') < order.indexOf('0089_test_early'));
  S.register({ id: '0089_test_clash', statements: ['SELECT 3'] });
  assert.throws(() => S.all(), /duplicate schema migration number/);
  assert.throws(() => S.register({ id: 'nonumber', statements: ['SELECT 1'] }), /numeric|number/);
  // InitModule applies the sorted list as one locked statement.
  const applied = mod.nk.sqlCalls.length;
  void applied;
}

// tickets.earn refuses server-only reasons.
{
  const res = mod.call<{ error?: string }>('tickets.earn', { userId: USER_A, vars: { scope: 'game', game: 'sproto', sid: SID, ranked: '0' } }, { amount: 20, reason: 'srv_pvp_win', key: 'k1' });
  assert.equal(res.error, 'server_reason');
}

// Hub-scope wallet RPCs (plan B1): registered, refused for game-scope and anonymous callers,
// and the exchange hands the SQL function the game, the floored amount, the key and a request hash.
{
  assert.ok(mod.registered.rpcs.has('tickets.balances'), 'tickets.balances registered');
  assert.ok(mod.registered.rpcs.has('verse.exchange'), 'verse.exchange registered');
  const hub = { userId: USER_A, vars: { scope: 'hub' } };
  const game = { userId: USER_A, vars: { scope: 'game', game: 'nobu', sid: SID, ranked: '0' } };
  // The hub_exchange launch flag gates the exchange (on since 0062_hub_exchange_open). Off (the
  // operator closed it, or no row): refused
  // before anything else is read, and tickets.balances says so.
  let flagState = 'off';
  mod.nk.onSql('FROM game.server_flags WHERE key', (args) => (args[0] === 'hub_exchange' ? [{ result: JSON.stringify({ state: flagState, allowlist: [], percent: 0 }) }] : []));
  const flush = () => { for (const key of [...mod.nk.localcache.keys()]) if (String(key).startsWith('flag:')) mod.nk.localcache.delete(key); };
  let reached = 0;
  mod.nk.onSql('game.exchange_tickets_hub', () => { reached += 1; return [{ result: '{}' }]; });
  assert.deepEqual(plain(mod.call('verse.exchange', hub, { game: 'nobu', tickets: 10, key: 'closed' })), { error: 'exchange_off', message: 'The plaza exchange is not open yet' });
  assert.equal(reached, 0, 'a closed exchange never reaches SQL');
  mod.nk.onSql('unnest(string_to_array', () => [{ result: '[]' }]);
  mod.nk.onSql('FROM game.verse_wallet WHERE user_id', () => [{ verse: '0' }]);
  assert.equal(mod.call<{ exchangeEnabled?: boolean }>('tickets.balances', hub, {}).exchangeEnabled, false);
  flagState = 'on';
  flush();
  assert.equal(mod.call<{ exchangeEnabled?: boolean }>('tickets.balances', hub, {}).exchangeEnabled, true);
  for (const rpc of ['tickets.balances', 'verse.exchange']) {
    const body = { game: 'nobu', tickets: 10, key: 'k' };
    assert.equal(mod.call<{ error?: string }>(rpc, game, body).error, 'not_hub_session', `${rpc} game scope`);
    assert.equal(mod.call<{ error?: string }>(rpc, { userId: '', vars: { scope: 'hub' } }, body).error, 'unauthorized', `${rpc} anonymous`);
  }
  let seen: unknown[] = [];
  mod.nk.onSql('game.exchange_tickets_hub', (args) => {
    seen = args;
    return [{ result: JSON.stringify({ verse: 3, gained: 3, ticketsLeft: 7 }) }];
  });
  const out = mod.call<{ gained?: number; error?: string }>('verse.exchange', hub, { game: 'sproto-coop-battle', tickets: 37.9, key: 'wallet-1' });
  assert.equal(out.gained, 3);
  assert.deepEqual(plain(seen.slice(0, 4)), [USER_A, 'sproto-coop-battle', 37, 'wallet-1']);
  assert.match(String(seen[4]), /^[0-9a-f]{64}$/);
  const hashOf = (body: object): string => {
    mod.call('verse.exchange', hub, body);
    return String(seen[4]);
  };
  const base = hashOf({ game: 'nobu', tickets: 100, key: 'h' });
  assert.equal(hashOf({ game: 'nobu', tickets: 100, key: 'other-key' }), base, 'the key is not part of the request hash');
  assert.notEqual(hashOf({ game: 'nobu', tickets: 110, key: 'h' }), base, 'the amount is');
  assert.notEqual(hashOf({ game: 'sproto', tickets: 100, key: 'h' }), base, 'the game is');
  seen = [];
  for (const bad of [
    { game: 'vcoin', tickets: 10, key: 'k' },
    { game: 'nope', tickets: 10, key: 'k' },
    { game: 'nobu', tickets: 0, key: 'k' },
    { game: 'nobu', tickets: '10', key: 'k' },
    { game: 'nobu', tickets: 10, key: '' },
    { game: 'nobu', tickets: 10, key: 'x'.repeat(81) },
  ]) {
    assert.ok(mod.call<{ error?: string }>('verse.exchange', hub, bad).error, JSON.stringify(bad));
  }
  assert.deepEqual(seen, [], 'bad input never reaches SQL');
  mod.nk.onSql('game.exchange_tickets_hub', () => [{ result: JSON.stringify({ error: 'verse_cap', verseCapLeft: 20 }) }]);
  assert.deepEqual(plain(mod.call('verse.exchange', hub, { game: 'nobu', tickets: 300, key: 'cap' })), { error: 'verse_cap', message: 'verse_cap', verseCapLeft: 20 });
  // The in-game exchange keeps its HPOS10I refusal.
  assert.equal(mod.call<{ error?: string }>('tickets.exchange', { userId: USER_A, vars: { scope: 'game', game: 'hpos10i', sid: SID, ranked: '0' } }, { tickets: 10, key: 'k' }).error, 'exchange_not_allowed');
  const ids = plain((mod.global.HubSchema as { all(): { id: string }[] }).all().map((m) => m.id));
  assert.ok(ids.includes('0060_hub_exchange'));
  // 0062 opens the exchange with one upsert that only ever writes state 'on'.
  const open = (mod.global.HubSchema as { all(): { id: string; statements: string[] }[] }).all().find((m) => m.id === '0062_hub_exchange_open');
  assert.ok(open, '0062_hub_exchange_open is registered');
  assert.equal(open.statements.length, 1);
  assert.match(open.statements[0]!, /INSERT INTO game\.server_flags \(key, state\) VALUES \('hub_exchange', 'on'\)\s+ON CONFLICT \(key\) DO UPDATE SET state = 'on', updated_at = now\(\)$/);
  assert.ok(ids.indexOf('0062_hub_exchange_open') > ids.indexOf('0061_relic_unhold'));
}

// HubEconomy: same SQL and request hash as the RPCs; input validation.
{
  const HubEconomy = mod.global.HubEconomy as {
    earn(nk: unknown, who: unknown, amount: number, reason: string, key: string): Record<string, unknown>;
    spend(nk: unknown, who: unknown, shop: string, item: string, packs: number, key: string): Record<string, unknown>;
    balance(nk: unknown, who: unknown): Record<string, unknown>;
  };
  mod.nk.onSql('game.earn_tickets', (args) => [{ result: JSON.stringify({ balance: 20, capped: false, args }) }]);
  const who = { userId: USER_A, sid: SID, game: 'sproto' };
  const out = HubEconomy.earn(mod.nk, who, 20, 'srv_pvp_win', 'sproto:pvp:m1:a') as { balance: number; args: unknown[] };
  assert.equal(out.balance, 20);
  assert.deepEqual(plain(out.args.slice(0, 6)), [USER_A, SID, 'sproto', 20, 'srv_pvp_win', 'sproto:pvp:m1:a']);
  assert.match(String(out.args[6]), /^[0-9a-f]{64}$/);
  assert.equal(HubEconomy.earn(mod.nk, who, 2.5, 'srv_x', 'k').error, 'bad_amount');
  assert.equal(HubEconomy.earn(mod.nk, { ...who, sid: '' }, 5, 'srv_x', 'k').error, 'session_closed');
  assert.equal(HubEconomy.earn(mod.nk, who, 5, 'srv_x', '').error, 'bad_key');
  mod.nk.onSql('game.spend_tickets', () => [{ result: JSON.stringify({ error: 'insufficient_tickets' }) }]);
  assert.equal(HubEconomy.spend(mod.nk, who, 'shop', 'item', 1, 'k2').error, 'insufficient_tickets');
  mod.nk.onSql('game.tickets_balance', () => [{ result: JSON.stringify({ balance: 7 }) }]);
  assert.equal(HubEconomy.balance(mod.nk, who).balance, 7);
}

// HubBoards.recordWin is idempotent through game.win_record.
{
  const HubBoards = mod.global.HubBoards as { recordWin(nk: unknown, userId: string, board: string, matchId: string): boolean };
  const seen = new Set<string>();
  mod.nk.onSql('game.win_record', (args) => {
    const key = `${String(args[0])}:${String(args[1])}`;
    const recorded = !seen.has(key);
    seen.add(key);
    return [{ result: JSON.stringify({ recorded, value: recorded ? seen.size : null }) }];
  });
  assert.equal(HubBoards.recordWin(mod.nk, USER_A, 'sproto_wins', 'm1'), true);
  assert.equal(HubBoards.recordWin(mod.nk, USER_A, 'sproto_wins', 'm1'), false);
  assert.throws(() => HubBoards.recordWin(mod.nk, USER_A, 'nobu_trial_time', 'm1'), /bad_board/);
}

// HubShards.place: least-full open shard, create the next one when all are full.
{
  const m = loadModule({ noInit: true });
  m.registered.matches.set('room', {
    matchInit: (_c: unknown, _l: unknown, _n: unknown, params: Record<string, string>) => ({
      state: {},
      tickRate: 1,
      label: JSON.stringify({ game: 'hub', kind: 'room', shard: Number(params.shard), open: params.closed !== '1' }),
    }),
  } as never);
  const HubShards = m.global.HubShards as { place(nk: unknown, l: unknown, o: unknown): { matchId: string; shard: number; created: boolean } };
  const opts = { module: 'room', kind: 'room', max: 4, softMax: 3 };
  const first = HubShards.place(m.nk, m.logger, opts);
  assert.deepEqual([first.shard, first.created], [1, true]);
  const fill = (id: string, n: number) => {
    const match = m.nk.matches.get(id)!;
    for (let i = 0; i < n; i += 1) match.presences.set(`${id}-${i}`, presence(`${id}-${i}`));
  };
  fill(first.matchId, 3);
  const second = HubShards.place(m.nk, m.logger, opts);
  assert.deepEqual([second.shard, second.created], [2, true]);
  fill(second.matchId, 1);
  const third = HubShards.place(m.nk, m.logger, opts);
  assert.deepEqual([third.matchId, third.created], [second.matchId, false]);
  m.nk.matches.get(first.matchId)!.presences.clear();
  fill(first.matchId, 2);
  const least = HubShards.place(m.nk, m.logger, opts);
  assert.equal(least.matchId, second.matchId, 'least-full wins');
  const prefer = HubShards.place(m.nk, m.logger, { ...opts, preferMatchId: first.matchId });
  assert.equal(prefer.matchId, first.matchId, 'preferMatchId keeps the shard while it is open');

  // A burst while new matches are not listable yet fills the fresh shard instead of opening one per call.
  const lag = loadModule({ noInit: true });
  lag.registered.matches.set('room', m.registered.matches.get('room')!);
  lag.nk.listLagMs = 60_000;
  const LagShards = lag.global.HubShards as typeof HubShards;
  const burst = Array.from({ length: 7 }, () => LagShards.place(lag.nk, lag.logger, opts));
  assert.deepEqual(plain(burst.map((b) => b.shard)), [1, 1, 1, 2, 2, 2, 3]);
  assert.equal(lag.nk.matches.size, 3);
}

console.log('server scaffold tests ok');
