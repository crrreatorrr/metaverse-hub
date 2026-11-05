// Security gates on sproto.standalone_session and the ranked-0 payout vars.
// Live Nakama (token expiry, JWT vars, sockets, ledger rows) is in
// server/test/dup/standalone.ts. This file drives the module directly so a
// shared device id can be proven: Nakama itself will not attach one device
// to two accounts.
import assert from 'node:assert/strict';
import { loadModule, type LoadedModule } from './harness';

const APP = 'sproto-duel';
const RPC = 'sproto.standalone_session';

function uid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function ctx(userId: string, vars: Record<string, string> | null, clientIp?: string): Record<string, unknown> {
  return { userId, username: 'player', sessionId: `s-${userId}`, vars, env: {}, clientIp };
}

interface Mint { vars: Record<string, string> }

function open(): { mod: LoadedModule; minted: Mint[] } {
  const mod = loadModule();
  const minted: Mint[] = [];
  mod.nk.authenticateTokenGenerate = (userId: string, _username: unknown, _expire: unknown, vars: unknown) => {
    const copy: Record<string, string> = {};
    if (vars && typeof vars === 'object') {
      for (const key of Object.keys(vars as object)) copy[key] = String((vars as Record<string, unknown>)[key]);
    }
    minted.push({ vars: copy });
    return { token: `tok-${userId}-${minted.length}`, exp: 0 };
  };
  return { mod, minted };
}

function bind(mod: LoadedModule, userId: string, username: string, devices: string[]): void {
  mod.nk.accounts.set(userId, {
    user: { userId, username },
    devices: devices.map((id) => ({ id })),
  });
}

type RpcFn = (ctx: Record<string, unknown>, logger: unknown, nk: unknown, payload: string) => string;

function call(mod: LoadedModule, who: Record<string, unknown>, body?: unknown): Record<string, unknown> {
  const fn = mod.registered.rpcs.get(RPC) as RpcFn | undefined;
  assert.ok(fn, `${RPC} is not registered`);
  const raw = fn(who, mod.logger, mod.nk, body === undefined ? '' : JSON.stringify(body));
  return JSON.parse(raw) as Record<string, unknown>;
}

const failures: string[] = [];

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    failures.push(name);
    console.error(`FAIL ${name}\n${detail}`);
  }
}

check('marker is required and a wrong marker is rejected', () => {
  const { mod, minted } = open();
  const who = ctx(uid(1), { scope: 'hub' });
  for (const body of [{}, { app: '' }, { app: 'sproto' }, { app: 'SPROTO-DUEL' }, { app: 'sproto-duel ' }, { app: ['sproto-duel'] }]) {
    const res = call(mod, who, body);
    assert.equal(res.error, 'bad_app', JSON.stringify(body));
    assert.equal(res.token, undefined);
  }
  assert.equal(minted.length, 0);
  assert.equal(mod.nk.localcache.size, 0, 'a bad marker does not take a rate-limit slot');
});

check('extra payload fields cannot inject vars', () => {
  const { mod, minted } = open();
  const injected = '11111111-1111-4111-8111-111111111111';
  const sqlBefore = mod.nk.sqlCalls.length;
  const res = call(mod, ctx(uid(2), { scope: 'hub' }), {
    app: APP,
    scope: 'hub',
    game: 'sproto-fighter',
    sid: injected,
    ranked: '1',
    vars: { scope: 'hub', game: 'nobu', sid: injected, ranked: '1' },
    userId: uid(9),
    token: 'forged',
    exp: 1,
    admin: true,
  });
  assert.equal(typeof res.token, 'string');
  assert.deepEqual(Object.keys(res).sort(), ['exp', 'sid', 'token']);
  assert.notEqual(res.sid, injected);
  assert.equal(minted.length, 1);
  const vars = minted[0]!.vars;
  assert.deepEqual(Object.keys(vars).sort(), ['game', 'ranked', 'scope', 'sid']);
  assert.equal(vars.scope, 'game');
  assert.equal(vars.game, 'sproto');
  assert.equal(vars.ranked, '0');
  assert.equal(vars.sid, res.sid);
  assert.match(String(res.sid), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  const wrote = mod.nk.sqlCalls.slice(sqlBefore).map((row) => row.sql);
  assert.deepEqual(wrote, [], `issuance SQL: ${wrote.join(' | ')}`);
});

check('hub scope is required; game scope is rejected and not counted', () => {
  const { mod, minted } = open();
  const user = uid(3);
  assert.equal(call(mod, ctx('', null)).error, 'unauthorized');
  assert.equal(call(mod, ctx(user, null)).error, 'wrong_scope');
  assert.equal(call(mod, ctx(user, {})).error, 'wrong_scope');
  const game = call(mod, ctx(user, { scope: 'game', game: 'sproto', sid: uid(4), ranked: '1' }), { app: APP });
  assert.equal(game.error, 'wrong_scope');
  assert.equal(game.token, undefined);
  for (let i = 0; i < 15; i += 1) {
    assert.equal(call(mod, ctx(user, { scope: 'game', game: 'sproto-fighter', sid: uid(4) }), { app: APP }).error, 'wrong_scope');
    assert.equal(call(mod, ctx(user, { scope: 'hub' }), { app: 'nope' }).error, 'bad_app');
  }
  assert.equal(minted.length, 0);
  assert.equal(mod.nk.localcache.size, 0);
  for (let i = 0; i < 10; i += 1) assert.equal(typeof call(mod, ctx(user, { scope: 'hub' }), { app: APP }).token, 'string');
  assert.equal(call(mod, ctx(user, { scope: 'hub' }), { app: APP }).error, 'rate_limited');
  assert.equal(minted.length, 10, 'fifteen bad calls did not consume the ten good slots');
});

check('device bucket is shared across accounts and a full bucket does not mint', () => {
  const { mod, minted } = open();
  const a = uid(10);
  const b = uid(11);
  const c = uid(12);
  const e = uid(13);
  const f = uid(14);
  bind(mod, a, 'ann', ['shared-device']);
  bind(mod, b, 'bob', ['shared-device']);
  bind(mod, c, 'cy', ['other-device']);
  bind(mod, e, 'eve', ['shared-device', 'fresh-device']);
  bind(mod, f, 'fay', ['fresh-device']);
  for (let i = 0; i < 10; i += 1) {
    const res = call(mod, ctx(a, { scope: 'hub' }), { app: APP });
    assert.equal(typeof res.token, 'string', `device call ${i}`);
  }
  const blocked = call(mod, ctx(b, { scope: 'hub' }), { app: APP });
  assert.equal(blocked.error, 'rate_limited');
  assert.equal(blocked.token, undefined, 'the shared device does not issue an 11th token');
  const other = call(mod, ctx(c, { scope: 'hub' }), { app: APP });
  assert.equal(typeof other.token, 'string', 'a different device is its own bucket');
  const both = call(mod, ctx(e, { scope: 'hub' }), { app: APP });
  assert.equal(both.error, 'rate_limited', 'one full device rejects the whole call');
  const fresh = call(mod, ctx(f, { scope: 'hub' }), { app: APP });
  assert.equal(typeof fresh.token, 'string', 'the rejected call did not consume the other device');
  assert.equal(minted.length, 12);
});

check('ip bucket stops at 40 and a rejected call does not consume the user bucket', () => {
  const { mod } = open();
  const ip = '203.0.113.10';
  for (let u = 0; u < 4; u += 1) {
    const user = uid(20 + u);
    for (let i = 0; i < 10; i += 1) {
      const res = call(mod, ctx(user, { scope: 'hub' }, ip), { app: APP });
      assert.equal(typeof res.token, 'string', `user ${u} call ${i}`);
    }
  }
  const fifth = uid(24);
  const blocked = call(mod, ctx(fifth, { scope: 'hub' }, ip), { app: APP });
  assert.equal(blocked.error, 'rate_limited');
  assert.equal(blocked.token, undefined);
  const sameUserNoIp = call(mod, ctx(fifth, { scope: 'hub' }), { app: APP });
  assert.equal(typeof sameUserNoIp.token, 'string', 'the IP rejection did not consume the user bucket');
});

if (failures.length) {
  console.error(`${failures.length} standalone session case(s) failed`);
  process.exit(1);
}
console.log('standalone session tests ok');
