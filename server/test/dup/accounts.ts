/**
 * Username accounts from the hub login page. Sign-up claims the device guest
 * with `account.claim`; log-in is Nakama email auth by username. Both must
 * mint hub-scoped sessions only, and refresh must keep that scope.
 */
import assert from 'node:assert/strict';
import { authenticate, call, ensureNakama, guest } from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const BASE = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const BASIC = `Basic ${Buffer.from('defaultkey:').toString('base64')}`;
const PASSWORD = 'correct-horse-1';

interface Session {
  status: number;
  token?: string;
  refresh_token?: string;
  message?: string;
}

function claims(token: string): { uid: string; vrs?: Record<string, string> } {
  const part = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(part, 'base64url').toString()) as { uid: string; vrs?: Record<string, string> };
}

async function post(path: string, body: object): Promise<Session> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: BASIC, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  return { status: response.status, ...(text ? (JSON.parse(text) as object) : {}) };
}

function logIn(username: string, password: string, vars?: Record<string, string>): Promise<Session> {
  const query = new URLSearchParams({ create: 'false', username });
  return post(`/v2/account/authenticate/email?${query}`, vars ? { email: '', password, vars } : { email: '', password });
}

function names(): { username: string; email: string } {
  const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return { username: `u${tag}`, email: `u${tag}@example.com` };
}

export async function runAccounts(test: TestFn): Promise<void> {
  await ensureNakama();

  await test('accounts', 'claim keeps the guest and logs in by username', async () => {
    const deviceId = crypto.randomUUID();
    const before = await authenticate(deviceId);
    const { username, email } = names();
    const claimed = await call('account.claim', { username: username.toUpperCase(), email, password: PASSWORD }, before.token);
    assert.equal(claimed.body.claimed, true, JSON.stringify(claimed.body));
    assert.equal(claimed.body.username, username);

    const session = await logIn(username, PASSWORD);
    assert.equal(session.status, 200, session.message);
    assert.ok(session.token && session.refresh_token);
    assert.equal(claims(session.token).uid, before.userId, 'login opens the claimed guest');
    assert.equal(claims(session.token).vrs?.scope, 'hub');

    const again = await authenticate(deviceId);
    assert.notEqual(again.userId, before.userId, 'the device id no longer opens the account');

    const second = await call('account.claim', { username: `${username}x`, email: `x${email}`, password: PASSWORD }, before.token);
    assert.equal(second.body.error, 'account_claimed');
  });

  await test('accounts', 'claim validates and reports clashes', async () => {
    const owner = await guest();
    const { username, email } = names();
    assert.equal((await call('account.claim', { username, email, password: PASSWORD }, owner.token)).body.claimed, true);

    const other = await guest();
    const cases: [object, string][] = [
      [{ username: 'ab', email: `z${email}`, password: PASSWORD }, 'bad_username'],
      [{ username: 'has space', email: `z${email}`, password: PASSWORD }, 'bad_username'],
      [{ username: `n${username}`, email: 'not-an-email', password: PASSWORD }, 'bad_email'],
      [{ username: `n${username}`, email: `z${email}`, password: 'short' }, 'bad_password'],
      [{ username, email: `z${email}`, password: PASSWORD }, 'username_taken'],
      [{ username: `n${username}`, email, password: PASSWORD }, 'email_taken'],
    ];
    for (const [body, code] of cases) {
      const result = await call('account.claim', body, other.token);
      assert.equal(result.body.error, code, `${JSON.stringify(body)} -> ${JSON.stringify(result.body)}`);
    }
    const account = await fetch(`${BASE}/v2/account`, { headers: { Authorization: `Bearer ${other.token}` } });
    const user = ((await account.json()) as { user: { username: string } }).user;
    assert.notEqual(user.username, `n${username}`, 'username is reverted when the email clashes');
  });

  await test('accounts', 'login rejects a wrong password and unknown user', async () => {
    const owner = await guest();
    const { username, email } = names();
    await call('account.claim', { username, email, password: PASSWORD }, owner.token);
    assert.equal((await logIn(username, 'wrong-password')).status, 401);
    assert.ok((await logIn(`${username}zz`, PASSWORD)).status >= 400);
  });

  await test('accounts', 'email auth and refresh cannot pick a game scope', async () => {
    const owner = await guest();
    const { username, email } = names();
    await call('account.claim', { username, email, password: PASSWORD }, owner.token);
    const forged = { scope: 'game', game: 'sproto', sid: crypto.randomUUID(), ranked: '1' };

    const session = await logIn(username, PASSWORD, forged);
    assert.equal(session.status, 200, session.message);
    assert.deepEqual(claims(session.token ?? '').vrs, { scope: 'hub' });
    const event = await call('session.event', { eventId: 'sproto.boss_defeated', data: { boss: 'tinubu' }, key: crypto.randomUUID() }, session.token);
    assert.ok(event.body.error, 'a login token cannot report game events');

    const refreshed = await post('/v2/account/session/refresh', { token: session.refresh_token, vars: forged });
    assert.equal(refreshed.status, 200, refreshed.message);
    assert.deepEqual(claims(refreshed.token ?? '').vrs, { scope: 'hub' });

    const portal = await call('portal.enter', { game: 'sproto', ranked: false }, refreshed.token);
    assert.ok(portal.body.ticket, `account opens a portal: ${JSON.stringify(portal.body)}`);
  });

  await test('accounts', 'device guest refresh works and stays hub', async () => {
    const response = await fetch(`${BASE}/v2/account/authenticate/device?create=true`, {
      method: 'POST',
      headers: { Authorization: BASIC, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID() }),
    });
    const device = (await response.json()) as Session;
    const refreshed = await post('/v2/account/session/refresh', { token: device.refresh_token });
    assert.equal(refreshed.status, 200, refreshed.message);
    assert.equal(claims(refreshed.token ?? '').vrs?.scope, 'hub');
  });

  await test('accounts', 'fresh username account is hub scoped', async () => {
    const { username, email } = names();
    const query = new URLSearchParams({ create: 'true', username });
    const created = await post(`/v2/account/authenticate/email?${query}`, { email, password: PASSWORD, vars: { scope: 'game' } });
    assert.equal(created.status, 200, created.message);
    assert.deepEqual(claims(created.token ?? '').vrs, { scope: 'hub' });
    assert.equal((await logIn(username, PASSWORD)).status, 200);
  });
}
