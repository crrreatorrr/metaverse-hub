// HUB-W-1-01: every server name map sent to clients is display-safe.
// Owner decision (plan R.6 #1): accounts are never renamed; an unsafe legacy
// username is cleaned wherever the server echoes it (HubMatch.cleanName).
// Covers the Duel arena (matchmaker, room create, private join), the Fighter
// duel (matchmaker and direct params), Coop (matchmaker, room create, join,
// seat names), the public boards and PB friend lookups.
import assert from 'node:assert/strict';
import { loadModule, plain, presence, type LoadedModule, type MatchDriver } from './harness';

const EVIL = '<img src=x onerror=1>';
const EVIL_CLEAN = 'img srcx onerror1';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COOP_SID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function safe(value: unknown, label: string): void {
  const text = JSON.stringify(plain(value));
  assert.ok(!/[<>]/.test(text), `${label} still carries markup: ${text}`);
}

// cleanName / sanitizeName / cleanNameMap.
{
  const mod = loadModule();
  const HubMatch = mod.global.HubMatch as {
    cleanName(raw: unknown, max?: number): string;
    sanitizeName(raw: string): string;
    cleanNameMap(raw: unknown, max?: number): Record<string, string>;
  };
  assert.equal(HubMatch.cleanName(EVIL), EVIL_CLEAN);
  assert.equal(HubMatch.cleanName('ada_lovelace-1.0'), 'ada_lovelace-1.0', 'valid usernames pass unchanged');
  assert.equal(HubMatch.cleanName('<>"\'&;/'), '', 'nothing left is the empty string');
  assert.equal(HubMatch.cleanName(null), '');
  assert.equal(HubMatch.cleanName(undefined), '');
  assert.equal(HubMatch.cleanName('x'.repeat(40)).length, 24);
  assert.equal(HubMatch.cleanName('x'.repeat(40), 16).length, 16);
  assert.equal(HubMatch.sanitizeName('<>'), 'player', 'the plaza keeps its non-empty fallback');
  assert.equal(HubMatch.sanitizeName(EVIL), EVIL_CLEAN);
  assert.deepEqual(plain(HubMatch.cleanNameMap({ [A]: EVIL, [B]: 'bob' })), { [A]: EVIL_CLEAN, [B]: 'bob' });
  assert.deepEqual(plain(HubMatch.cleanNameMap(['x'])), {});
  assert.deepEqual(plain(HubMatch.cleanNameMap(null)), {});
}

// Duel arena (sproto_arena): matchmaker pair, OP_FOUND and OP_START names.
{
  const mod = loadModule();
  const pa = presence(A, EVIL), pb = presence(B, '<>');
  const id = mod.matchmake([
    { presence: pa, properties: { game: 'sproto', v: '2' } },
    { presence: pb, properties: { game: 'sproto', v: '2' } },
  ]);
  assert.ok(id);
  const m = mod.driver(id!);
  assert.deepEqual(plain((m.state as { names: Record<string, string> }).names), { [A]: EVIL_CLEAN, [B]: '' }, 'arena matchmaker name map');
  const vars = (sid: string) => ({ scope: 'game', game: 'sproto', sid });
  m.join([pa], { vars: vars('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1') });
  m.join([pb], { vars: vars('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1') });
  m.loop([
    { sender: pa, opCode: 1, data: { v: '2' } },
    { sender: pb, opCode: 1, data: { v: '2' } },
    { sender: pa, opCode: 19, data: { v: '2' } },
    { sender: pb, opCode: 19, data: { v: '2' } },
  ]);
  const foundMsgs = m.dispatcher.sent<{ names: string[] }>(21);
  assert.ok(foundMsgs.length > 0);
  for (const f of foundMsgs) safe(f.body.names, 'arena OP_FOUND');
  const starts = m.dispatcher.sent<{ seat: number; names: string[] }>(2);
  assert.equal(starts.length, 2);
  for (const s of starts) {
    safe(s.body.names, 'arena OP_START');
    assert.deepEqual(plain(s.body.names), [EVIL_CLEAN, 'Player 2'], 'an empty cleaned name keeps the "Player N" fallback');
  }
}

// Duel arena: private room create, private join and direct match params.
{
  const mod = loadModule();
  const ctx = { userId: A, username: EVIL, vars: { scope: 'game', game: 'sproto', sid: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1' } };
  const room = mod.call<{ matchId: string; code: string }>('sproto.room_create', ctx, { v: '2' });
  assert.ok(room.matchId, JSON.stringify(room));
  const m = mod.driver(room.matchId);
  assert.deepEqual(plain((m.state as { names: Record<string, string> }).names), { [A]: EVIL_CLEAN }, 'room_create name map');
  const joiner = presence(B, '"><script>alert(1)</script>');
  assert.equal(m.joinAttempt(joiner, { vars: { scope: 'game', game: 'sproto', sid: 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1' } }).accept, true);
  assert.equal((m.state as { names: Record<string, string> }).names[B], 'scriptalert1script', 'private joiner name');
  const direct = mod.startMatch('sproto_arena', { players: JSON.stringify([A, B]), names: JSON.stringify({ [A]: EVIL, [B]: 'bob' }), v: '2', private: '0' });
  assert.deepEqual(plain((direct.state as { names: Record<string, string> }).names), { [A]: EVIL_CLEAN, [B]: 'bob' }, 'arena matchInit cleans params');
}

// Fighter duel (sproto_duel): matchmaker map, direct params and OP_START.
{
  const mod = loadModule();
  const sim = String(mod.global.SPROTO_SIM_VERSION ?? '');
  const id = mod.matchmake([
    { presence: presence(A, EVIL), properties: { game: 'sproto-fighter', wager: '0', sim } },
    { presence: presence(B, '<>'), properties: { game: 'sproto-fighter', wager: '0', sim } },
  ]);
  assert.ok(id);
  const m = mod.driver(id!);
  assert.deepEqual(plain((m.state as { names: Record<string, string> }).names), { [A]: EVIL_CLEAN, [B]: '' }, 'Fighter matchmaker name map');
  const pa = presence(A, EVIL), pb = presence(B, '<>');
  m.join([pa, pb]);
  m.loop([
    { sender: pa, opCode: 1, data: { fighter: 'rivet', stage: 'ranch', sim } },
    { sender: pb, opCode: 1, data: { fighter: 'vela', stage: 'ranch', sim } },
  ]);
  const starts = m.dispatcher.sent<{ names: string[] }>(2);
  assert.equal(starts.length, 2);
  for (const s of starts) assert.deepEqual(plain(s.body.names), [EVIL_CLEAN, 'Player 2']);
  const direct = mod.startMatch('sproto_duel', { players: JSON.stringify([A, B]), names: JSON.stringify({ [A]: EVIL, [B]: 'bob' }), wager: '0', sim });
  assert.deepEqual(plain((direct.state as { names: Record<string, string> }).names), { [A]: EVIL_CLEAN, [B]: 'bob' }, 'Fighter matchInit cleans params');
}

// Coop: matchmaker map, room_create map, join and the seat name in the sim.
function coopGame(userId: string, username: string, sessionId = `s-${userId}`) {
  return { userId, sessionId, username, vars: { scope: 'game', game: 'sproto-coop-battle', sid: COOP_SID } };
}
function coopNames(mod: LoadedModule, matchId: string): Record<string, string> {
  return plain((mod.driver(matchId).state as { names: Record<string, string> }).names);
}
/** Nakama keeps the coop sim packed between callbacks; rebuild it to read the seats. */
function coopPlayers(mod: LoadedModule, m: MatchDriver): { name: string }[] {
  const st = m.state as { cold?: boolean; simPacked?: unknown; session: { state: { players: { name: string }[] } } };
  if (st.cold && st.simPacked) return (mod.global.Sim as { importState(d: unknown): { players: { name: string }[] } }).importState(st.simPacked).players;
  return st.session.state.players;
}
{
  const mod = loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
  const version = mod.call<{ protocol: number; fingerprint: string }>('coop.version', coopGame(A, 'ada'), {});
  const props = { game: 'sproto-coop-battle', v: String(version.protocol), sim: version.fingerprint };
  const id = mod.matchmake([
    { presence: presence(A, EVIL), properties: props },
    { presence: presence(B, 'bob'), properties: props },
  ]);
  assert.ok(id, 'coop matchmaker creates a match');
  assert.deepEqual(coopNames(mod, id!), { [A]: 'img srcx onerror', [B]: 'bob' }, 'coop matchmaker name map (16 chars)');
}
{
  const mod = loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
  const version = mod.call<{ protocol: number; fingerprint: string }>('coop.version', coopGame(A, 'ada'), {});
  const hello = (devices: string[]) => ({ t: 'hello', protocol: version.protocol, fingerprint: version.fingerprint, devices });
  const created = mod.call<{ matchId: string; code: string }>('coop.room_create', coopGame(A, EVIL), {});
  assert.ok(created.matchId, JSON.stringify(created));
  assert.deepEqual(coopNames(mod, created.matchId), { [A]: 'img srcx onerror' }, 'coop room_create name map');
  const m = mod.driver(created.matchId);
  const pa = presence(A, EVIL), pb = presence(B, '<b>x</b>');
  assert.equal(m.join([pa], coopGame(A, EVIL))[0]?.accept, true);
  assert.equal(m.join([pb], coopGame(B, '<b>x</b>'))[0]?.accept, true);
  assert.equal(coopNames(mod, created.matchId)[B], 'bxb', 'coop join fills a cleaned name');
  m.loop([{ sender: pa, opCode: 1, data: hello(['k1']) }]);
  m.loop([{ sender: pb, opCode: 1, data: hello(['k2']) }]);
  const players = coopPlayers(mod, m);
  assert.equal(players[0]!.name, 'img srcx onerror', 'seat name in the sim is clean');
  assert.equal(players[1]!.name, 'bxb');
  for (const b of m.dispatcher.broadcasts) assert.ok(!b.data.includes('<'), `coop broadcast op ${b.opCode} carries markup`);
}
{
  // A seat whose name cleans to "" keeps the "P<slot>" fallback.
  const mod = loadModule({ env: { COOP_AUTHORITATIVE: '1' } });
  const version = mod.call<{ protocol: number; fingerprint: string }>('coop.version', coopGame(A, 'ada'), {});
  const created = mod.call<{ matchId: string }>('coop.room_create', coopGame(B, '<>'), {});
  const m = mod.driver(created.matchId);
  const pc = presence(B, '<>');
  assert.equal(m.join([pc], coopGame(B, '<>'))[0]?.accept, true);
  m.loop([{ sender: pc, opCode: 1, data: { t: 'hello', protocol: version.protocol, fingerprint: version.fingerprint, devices: ['k1'] } }]);
  assert.equal(coopPlayers(mod, m)[0]!.name, 'P1');
}

// Boards: leaderboard.top and verse board rows.
{
  const mod = loadModule();
  mod.nk.onSql('WITH ranked AS', (args) => [{
    result: JSON.stringify({ boardId: args[0], variant: args[3], order: args[1], rows: [{ userId: A, name: EVIL, value: 3, rank: 1 }, { userId: B, name: '', value: 2, rank: 2 }], me: { userId: A, name: EVIL, value: 3, rank: 1 } }),
  }]);
  const top = mod.call<{ rows: { name: string }[]; me: { name: string } }>('leaderboard.top', { userId: A, vars: { scope: 'hub' } }, { boardId: 'sproto_wins' });
  assert.deepEqual(top.rows.map((r) => r.name), [EVIL_CLEAN, B.slice(0, 8)], 'leaderboard rows: an empty name shows the id prefix');
  assert.equal(top.me.name, EVIL_CLEAN, 'leaderboard me row');
  mod.nk.onSql('game.verse_earned', () => [{ result: JSON.stringify([{ name: EVIL, gameId: 'nobu', lifetime: 9 }, { name: 'ada', gameId: 'pb', lifetime: 3 }]) }]);
  const verse = mod.call<{ rows: { name: string }[] }>('verse.board', { userId: A, vars: { scope: 'hub' } }, {});
  assert.deepEqual(verse.rows.map((r) => r.name), [EVIL_CLEAN, 'ada'], 'verse board rows');
}

// Review fix: verse.board rows carry userId, so names that clean alike stay apart,
// and a name that cleans to "" shows the 8-char id prefix instead of being dropped.
{
  const mod = loadModule();
  mod.nk.onSql("'userId', user_id, 'name', name, 'gameId'", () => [{ result: JSON.stringify([
    { userId: A, name: 'ada\u202e', gameId: 'nobu', lifetime: 9 },
    { userId: B, name: 'ada', gameId: 'nobu', lifetime: 4 },
    { userId: C, name: '\u738b\u5c0f\u660e', gameId: 'pb', lifetime: 3 },
  ]) }]);
  const verse = mod.call<{ rows: { name: string; userId: string }[] }>('verse.board', { userId: A, vars: { scope: 'hub' } }, {});
  assert.deepEqual(verse.rows.map((r) => [r.userId, r.name]), [[A, 'ada'], [B, 'ada'], [C, C.slice(0, 8)]], 'verse rows keep userId; empty clean name falls back to id prefix');
}

// PB friend lookups return a clean username to the PB sim.
{
  const mod = loadModule();
  const lookup = mod.nk.usersGetUsername as (names: string[]) => { userId: string; username: string }[];
  mod.nk.usersGetUsername = (names: string[]) => lookup(names).map((u) => ({ ...u, username: EVIL }));
  const PbWorld = mod.global.PbWorld as { resolveUsername(nk: unknown, name: string): { userId: string; username: string } | null };
  assert.equal(typeof PbWorld.resolveUsername, 'function', 'PbWorld.resolveUsername');
  assert.deepEqual(plain(PbWorld.resolveUsername(mod.nk, 'whoever')), { userId: 'id-whoever', username: EVIL_CLEAN });
}

console.log('name sanitize tests ok');
