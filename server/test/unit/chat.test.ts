// Plaza chat guard: shared rules with the SDK, room scope, rate limit, mute,
// filter, read-only messages and chat.report.
import assert from 'node:assert/strict';
import { CHAT_RULE_FIXTURES } from '../../../packages/hub-sdk/src/realtime/chatRules';
import { loadModule } from './harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const HUB = { userId: A, vars: { scope: 'hub' } };
const mod = loadModule();
const HubChat = mod.global.HubChat as {
  validate(raw: string): { ok: boolean; code?: string; content?: { text: string; color?: string; effect?: string } };
  filter(text: string): { text: string; masked: boolean; hard: boolean };
};

// The ES5 guard and the SDK rules agree on the fixture table.
for (const row of CHAT_RULE_FIXTURES) {
  const r = HubChat.validate(row.raw);
  const got = r.ok ? `ok:${[r.content!.text, r.content!.color, r.content!.effect].filter(Boolean).join('|')}` : r.code;
  assert.equal(got, row.expect, row.raw.slice(0, 40));
}

// Filter: masks profanity (case, leetspeak, suffixes), flags the hard list, leaves clean words.
{
  assert.deepEqual(JSON.parse(JSON.stringify(HubChat.filter('what the FUCK'))), { text: 'what the F***', masked: true, hard: false });
  assert.equal(HubChat.filter('sh1t happens').text, 's*** happens');
  assert.equal(HubChat.filter('fucking hell').masked, true);
  assert.equal(HubChat.filter('scunthorpe dickens class').masked, false);
  assert.equal(HubChat.filter('you f4gg0t').hard, true);
  assert.equal(HubChat.filter('k i k e').hard, true);
  assert.equal(HubChat.filter('hello there friend').hard, false);
}

const join = (ctx: object, target: string, type = 1) => mod.rtBefore('ChannelJoin', ctx, { channelJoin: { target, type, persistence: true, hidden: false } });
const send = (ctx: object, text: unknown) => mod.rtBefore('ChannelMessageSend', ctx, { channelMessageSend: { channelId: '2...hub.1', content: typeof text === 'string' ? text : JSON.stringify(text) } }) as { channelMessageSend: { content: string } };

// Room scope.
{
  assert.ok(join(HUB, 'hub.1'));
  assert.ok(join({ userId: A, vars: null }, 'hub.42'));
  assert.throws(() => join(HUB, 'pb.trade'), /room_not_allowed/);
  assert.throws(() => join({ userId: A, vars: { scope: 'game', game: 'nobu', sid: B } }, 'hub.1'), /room_not_allowed/);
  assert.throws(() => join({ userId: A, vars: { scope: 'game', game: 'nobu', sid: B } }, B, 2), /room_not_allowed/);
  assert.ok(join(HUB, B, 2), 'hub DMs allowed');
  mod.nk.friends.set(B, { friends: [{ user: { userId: A, username: 'a' }, state: 3 }] });
  assert.throws(() => join(HUB, B, 2), /chat_blocked/);
  assert.ok(join(HUB, 'group-id', 3));
}

// Send: normalise + mask, rewrite the envelope, bucket, duplicate, guest refill.
{
  mod.nk.accounts.set(A, { user: { userId: A, username: 'alice' }, email: 'a@example.com' });
  const out = send(HUB, { text: '  hello   shit world ', color: 'red', effect: 'spin', x: 1 });
  assert.deepEqual(JSON.parse(out.channelMessageSend.content), { text: 'hello s*** world', color: 'red' });
  assert.throws(() => send(HUB, { text: 'hello shit world' }), /chat_duplicate/);
  for (let i = 0; i < 4; i += 1) send(HUB, { text: `line ${i}` });
  assert.throws(() => send(HUB, { text: 'one too many' }), /chat_rate_limited/);
  for (const value of mod.nk.localcache.values()) assert.notEqual(typeof value, 'object');
  assert.throws(() => send(HUB, { text: '' }), /chat_empty/);
  assert.throws(() => send(HUB, 'not json'), /chat_bad_json/);
  assert.throws(() => send(HUB, { text: 'x'.repeat(130) }), /chat_too_long/);
  // A bucket emptied 2 s ago has refilled one token for an account (1.5 s), none for a guest (3 s).
  const twoSecondsAgo = Date.now() - 2000;
  mod.nk.localcache.set(`chat:${A}`, `0:${twoSecondsAgo}`);
  assert.ok(send(HUB, { text: 'account refilled' }));
  mod.nk.localcache.set(`chat:${B}`, `0:${twoSecondsAgo}`);
  assert.throws(() => send({ userId: B, vars: { scope: 'hub' } }, { text: 'guest waits' }), /chat_rate_limited/);
  assert.equal(mod.nk.localcache.get(`guest:${B}`), '1');
}

// Mute (cached 30 s) and the hard list (rejected + auto report).
{
  const C = '33333333-3333-4333-8333-333333333333';
  mod.nk.onSql('game.chat_mute', () => [{ until: String(Date.now() + 60_000) }]);
  assert.throws(() => send({ userId: C, vars: { scope: 'hub' } }, { text: 'hi' }), /chat_muted/);
  const D = '44444444-4444-4444-8444-444444444444';
  mod.nk.onSql('game.chat_mute', () => [{ until: '0' }]);
  mod.nk.sqlCalls.length = 0;
  assert.throws(() => send({ userId: D, vars: { scope: 'hub' } }, { text: 'you n1gg3r' }), /chat_rejected/);
  const report = mod.nk.sqlCalls.find((c) => c.sql.includes('INSERT INTO game.chat_report'));
  assert.ok(report, 'auto report filed');
  assert.equal(report!.args[0], D);
}

// Edits and removals are rejected.
assert.throws(() => mod.rtBefore('ChannelMessageUpdate', HUB, { channelMessageUpdate: { channelId: 'x', messageId: 'm', content: '{}' } }), /chat_readonly/);
assert.throws(() => mod.rtBefore('ChannelMessageRemove', HUB, { channelMessageRemove: { channelId: 'x', messageId: 'm' } }), /chat_readonly/);

// chat.report: hub scope, valid target, 10 per hour.
{
  mod.nk.sqlCalls.length = 0;
  const ok = mod.call<{ ok?: boolean; error?: string }>('chat.report', HUB, { channelId: '2...hub.1', messageId: 'm1', userId: B, text: 'rude', reason: 'abuse' });
  assert.equal(ok.ok, true);
  assert.ok(mod.nk.sqlCalls.some((c) => c.sql.includes('INSERT INTO game.chat_report') && c.args[1] === B));
  assert.equal(mod.call<{ error: string }>('chat.report', HUB, { userId: A }).error, 'bad_target');
  assert.equal(mod.call<{ error: string }>('chat.report', { userId: A, vars: { scope: 'game', game: 'nobu', sid: B } }, { userId: B }).error, 'wrong_scope');
  for (let i = 0; i < 9; i += 1) mod.call('chat.report', HUB, { userId: B });
  assert.equal(mod.call<{ error: string }>('chat.report', HUB, { userId: B }).error, 'rate_limited');
}

console.log('chat guard tests ok');
