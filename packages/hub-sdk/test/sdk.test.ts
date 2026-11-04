import assert from 'node:assert/strict';
import {
  HubEvent,
  HubSdkError,
  LOCAL_NAKAMA,
  VERSE_DAILY_CAP,
  createHubSdk,
  createNakamaClient,
  memoryKeyValue,
  mintMockTicket,
  userIdFromToken,
  verifyMockTicket,
  type GameId,
  type HubSdk,
  type HubSdkEnv,
  type NakamaClient,
} from '../src/index';

const NOW = Date.parse('2026-10-29T12:00:00Z');

function harness(game: GameId = 'sproto') {
  const local = memoryKeyValue();
  const session = memoryKeyValue();
  let hash = '';
  const assigned: string[] = [];
  let pointer = 0;
  let beforeUnload = 1;
  const env: HubSdkEnv = {
    hubUrl: '/hub/',
    local,
    session,
    now: () => NOW,
    readHash: () => hash,
    writeHash: (next) => {
      hash = next;
    },
    assign: (url) => {
      assigned.push(url);
    },
    releasePointer: () => {
      pointer += 1;
    },
    clearBeforeUnload: () => {
      beforeUnload = 0;
    },
  };
  return {
    sdk: createHubSdk(env),
    local,
    session,
    assigned,
    setHash: (value: string) => {
      hash = value;
    },
    getHash: () => hash,
    pointer: () => pointer,
    beforeUnload: () => beforeUnload,
    game,
  };
}

async function ticket(game: GameId, extra?: { ranked?: boolean; expOffset?: number; playerId?: string }) {
  return mintMockTicket({
    game,
    playerId: extra?.playerId ?? 'player-1',
    ranked: extra?.ranked ?? false,
    now: NOW + (extra?.expOffset ?? 0),
    ttlSeconds: extra?.expOffset ? 1 : 60,
  });
}

async function main(): Promise<void> {
  const signed = await mintMockTicket({ game: 'hpos10i', playerId: 'p', now: NOW, jti: 'j1' });
  const claims = await verifyMockTicket(signed);
  assert.equal(claims?.game, 'hpos10i');
  assert.equal(claims?.playerId, 'p');
  assert.equal(await verifyMockTicket(`${signed}x`), null);
  assert.equal(await verifyMockTicket('nope'), null);

  {
    const h = harness();
    const init = await h.sdk.init('sproto');
    assert.equal(init.ranked, false);
    assert.deepEqual(init.relics, []);
    assert.equal(init.ticketsCapLeft, 0);
    await h.sdk.reportEvent(HubEvent.GameBeaten, {}, 'k');
    assert.equal(h.local.getItem('hub:relics'), null);
    const earned = await h.sdk.earnTickets(10, 'win', 'e');
    assert.deepEqual(earned, { balance: 0, capped: false });
    h.sdk.exit('menu');
    assert.deepEqual(h.assigned, []);
  }

  {
    const h = harness('sproto');
    const tok = await ticket('sproto');
    h.setHash(`#t=${tok}`);
    const init = await h.sdk.init('sproto');
    assert.equal(init.playerId, 'player-1');
    assert.equal(init.ranked, false);
    assert.equal(h.getHash(), '');
    const again = await h.sdk.init('sproto');
    assert.equal(again.playerId, 'player-1');
    h.setHash(`#t=${tok}`);
    await assert.rejects(() => h.sdk.init('sproto'), (error: unknown) => {
      assert.ok(error instanceof HubSdkError);
      assert.equal(error.code, 'ticket_used');
      return true;
    });
  }

  {
    const h = harness('nobu');
    h.setHash(`#t=${await ticket('sproto')}`);
    await assert.rejects(() => h.sdk.init('nobu'), (error: unknown) => {
      assert.ok(error instanceof HubSdkError);
      assert.equal(error.code, 'ticket_game');
      return true;
    });
  }

  {
    const h = harness('peoples-bitcoin');
    const expired = await mintMockTicket({
      game: 'peoples-bitcoin',
      playerId: 'player-1',
      now: NOW - 120_000,
      ttlSeconds: 60,
    });
    h.setHash(`#t=${expired}`);
    await assert.rejects(() => h.sdk.init('peoples-bitcoin'), (error: unknown) => {
      assert.ok(error instanceof HubSdkError);
      assert.equal(error.code, 'ticket_expired');
      return true;
    });
  }

  {
    const h = harness('sproto');
    h.setHash(`#t=${await ticket('sproto')}`);
    await h.sdk.init('sproto');
    const first = await h.sdk.reportEvent(HubEvent.Ready, {}, 'ready-1');
    assert.deepEqual(first, {});
    const claimed = await h.sdk.reportEvent(HubEvent.GameBeaten, {}, 'beat-1');
    assert.deepEqual(claimed, {}, 'game_beaten grants nothing');
    assert.equal(h.local.getItem('hub:relics'), null);
    const grant = await h.sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu', elapsed: 12 }, 'tinubu');
    assert.deepEqual(grant, { granted: 'tinubu_crown' });
    const replay = await h.sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu', elapsed: 12 }, 'tinubu');
    assert.deepEqual(replay, { granted: 'tinubu_crown' });
    const second = await h.sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu', elapsed: 9 }, 'tinubu-2');
    assert.deepEqual(second, {});
    assert.deepEqual(JSON.parse(h.local.getItem('hub:relics') ?? '[]'), ['tinubu_crown']);
    await assert.rejects(
      () => h.sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu', elapsed: 99 }, 'tinubu'),
      (error: unknown) => error instanceof HubSdkError && error.code === 'idempotency_mismatch',
    );
  }

  {
    // Sproto Fighter: the Tidebreaker Belt is Story World 1 only, and only for this game.
    const h = harness('sproto-fighter');
    h.setHash(`#t=${await ticket('sproto-fighter')}`);
    await h.sdk.init('sproto-fighter');
    const wrongWorld = await h.sdk.reportEvent(HubEvent.FighterStoryLevelComplete, { world: 2, stage: 'bar' }, 'fighter-w2');
    assert.deepEqual(wrongWorld, {}, 'World 2 grants nothing');
    const otherGame = await h.sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu' }, 'fighter-tinubu');
    assert.deepEqual(otherGame, {}, "another game's trigger grants nothing here");
    const belt = await h.sdk.reportEvent(HubEvent.FighterStoryLevelComplete, { world: 1, stage: 'yacht' }, 'fighter-w1');
    assert.deepEqual(belt, { granted: 'tidebreaker_belt' });
    const again = await h.sdk.reportEvent(HubEvent.FighterStoryLevelComplete, { world: 1, stage: 'yacht' }, 'fighter-w1-b');
    assert.deepEqual(again, {}, 'earn-once');
    assert.deepEqual(JSON.parse(h.local.getItem('hub:relics') ?? '[]'), ['tidebreaker_belt']);
  }

  {
    const h = harness('hpos10i');
    h.setHash(`#t=${await ticket('hpos10i')}`);
    await h.sdk.init('hpos10i');
    const miss = await h.sdk.reportEvent(HubEvent.Hpos10iLevelComplete, { zone: 'other', act: 1 }, 'a');
    assert.deepEqual(miss, {});
    const hit = await h.sdk.reportEvent(
      HubEvent.Hpos10iLevelComplete,
      { zone: 'z1_retro_rush_hills', act: 1, time: 42 },
      'b',
    );
    assert.deepEqual(hit, { granted: 'hpos10i_core' });
  }

  {
    const h = harness('peoples-bitcoin');
    h.setHash(`#t=${await ticket('peoples-bitcoin')}`);
    await h.sdk.init('peoples-bitcoin');
    const hit = await h.sdk.reportEvent(HubEvent.PbQuestComplete, { questId: 'quest_tutorial', tick: 3 }, 'q');
    assert.equal(hit.granted, 'genesis_shard');
  }

  {
    const h = harness('nobu');
    h.setHash(`#t=${await ticket('nobu')}`);
    await h.sdk.init('nobu');
    const miss = await h.sdk.reportEvent(HubEvent.NobuBossDefeated, { boss: 'mini' }, 'n1');
    assert.deepEqual(miss, {});
    const hit = await h.sdk.reportEvent(HubEvent.NobuBossDefeated, { boss: 'cone' }, 'n2');
    assert.equal(hit.granted, 'cones_tip');
  }

  {
    const h = harness('sproto');
    h.setHash(`#t=${await ticket('sproto', { ranked: false })}`);
    await h.sdk.init('sproto');
    assert.deepEqual(await h.sdk.submitScore('hpos10i_act_time', 1000), { accepted: false, reason: 'unranked' });
    assert.equal(h.local.getItem('hub:score:player-1:hpos10i_act_time'), null);
    await assert.rejects(() => h.sdk.submitScore('not_a_board', 1), (error: unknown) => {
      assert.ok(error instanceof HubSdkError);
      assert.equal(error.code, 'bad_board');
      return true;
    });
  }

  {
    const h = harness('sproto');
    h.setHash(`#t=${await ticket('sproto', { ranked: true })}`);
    await h.sdk.init('sproto');
    // sproto_wins is server-only: the match writes it (Contract C6).
    assert.deepEqual(await h.sdk.submitScore('sproto_wins', 1, { match: 'a' }), { accepted: false, reason: 'server_board' });
    assert.equal(h.local.getItem('hub:score:player-1:sproto_wins'), null);
    await h.sdk.submitScore('hpos10i_act_time', 50);
    await h.sdk.submitScore('hpos10i_act_time', 42);
    await h.sdk.submitScore('hpos10i_act_time', 48);
    assert.equal(h.local.getItem('hub:score:player-1:hpos10i_act_time'), '42');
    await h.sdk.submitScore('pb_total_xp', 100);
    await h.sdk.submitScore('pb_total_xp', 80);
    assert.equal(h.local.getItem('hub:score:player-1:pb_total_xp'), '80');
  }

  {
    const h = harness('sproto');
    h.setHash(`#t=${await ticket('sproto')}`);
    await h.sdk.init('sproto');
    const first = await h.sdk.earnTickets(40, 'win', 'earn-1');
    assert.equal(first.balance, 40);
    assert.equal(first.capped, false);
    const replay = await h.sdk.earnTickets(40, 'win', 'earn-1');
    assert.deepEqual(replay, first);
    const exchanged = await h.sdk.exchange(25, 'ex-1');
    assert.equal(exchanged.verse, 2);
    assert.equal(exchanged.ticketsLeft, 20);
    const same = await h.sdk.exchange(25, 'ex-1');
    assert.equal(same.receiptId, exchanged.receiptId);
    assert.equal(h.local.getItem('hub:tickets:sproto'), '20');
    await h.sdk.earnTickets(TICKETS_FOR_CAP(), 'grind', 'earn-cap');
    const filled = await h.sdk.exchange(500, 'ex-fill');
    assert.equal(filled.verse, 2 + (VERSE_DAILY_CAP - 2));
    await assert.rejects(() => h.sdk.exchange(10, 'ex-over'), (error: unknown) => {
      assert.ok(error instanceof HubSdkError);
      assert.equal(error.code, 'verse_cap');
      return true;
    });
  }

  {
    const h = harness('sproto');
    h.setHash(`#from=sproto&t=${await ticket('sproto')}`);
    await h.sdk.init('sproto');
    assert.equal(h.getHash(), '#from=sproto');
    h.sdk.exit('done');
    assert.deepEqual(h.assigned, ['/hub/#from=sproto']);
    assert.equal(h.pointer(), 1);
    assert.equal(h.beforeUnload(), 0);
    assert.equal(h.session.getItem('hub:sproto:session'), null);
  }

  await liveSdk();
  await staleOutbox();
  await nakamaClientWire();
  await scoresAndSession();
  await refreshWire();
  console.log('hub-sdk tests ok');
}

function fakeJwt(userId: string, vars?: Record<string, string>): string {
  const payload: { uid: string; vrs?: Record<string, string> } = { uid: userId };
  if (vars) payload.vrs = vars;
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `e30.${part}.sig`;
}

async function liveSdk(): Promise<void> {
  const calls: { id: string; token?: string; keepalive?: boolean; body: object }[] = [];
  const custom: { id: string; create?: boolean; vars?: Record<string, string> }[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-1' };
    },
    async authenticateCustom(id, create, vars) {
      custom.push({ id, create, vars });
      if (id === 't:spent') throw new HubSdkError('ticket_used', 'spent');
      return {
        token: fakeJwt('user-1', { sid: 'sid-1', ranked: '1', scope: 'game', game: 'sproto' }),
        refreshToken: 'refresh-1',
        userId: 'user-1',
      };
    },
    async rpc<T>(id: string, body: object, opts?: { token?: string; keepalive?: boolean }): Promise<T> {
      calls.push({ id, token: opts?.token, keepalive: opts?.keepalive, body });
      if (id === 'profile.get') {
        return {
          playerId: 'user-1',
          relics: ['tinubu_crown'],
          gameBeaten: ['sproto'],
          scope: 'game',
          ranked: true,
          effects: { staff: 'momentum' },
          ticketsCapLeft: 0,
        } as T;
      }
      if (id === 'session.event') {
        const data = body as { key?: string; data?: { godMode?: boolean } };
        if (data.key === 'bad') throw new HubSdkError('idempotency_mismatch', 'mismatch');
        assert.equal(data.data?.godMode, true);
        return { granted: 'tinubu_crown' } as T;
      }
      if (id === 'session.close') return { ok: true } as T;
      if (id === 'tickets.earn') return { balance: 20, capped: false } as T;
      if (id === 'tickets.exchange') return { verse: 2, ticketsLeft: 0, receiptId: 'r1' } as T;
      if (id === 'score.submit') return { accepted: false, stub: true } as T;
      throw new Error(`unexpected rpc ${id}`);
    },
  };
  const local = memoryKeyValue();
  const session = memoryKeyValue();
  let hash = '#t=ticket-1';
  const assigned: string[] = [];
  const sdk = createHubSdk({
    client,
    hubUrl: '/hub/',
    local,
    session,
    readHash: () => hash,
    writeHash: (next) => {
      hash = next;
    },
    assign: (url) => {
      assigned.push(url);
    },
  });
  const init = await sdk.init('sproto');
  assert.equal(init.playerId, 'user-1');
  assert.equal(init.ranked, true);
  assert.equal(init.effects.staff, 'momentum');
  assert.equal(hash, '');
  assert.equal(custom[0]?.id, 't:ticket-1');
  assert.equal(custom[0]?.create, false);
  assert.deepEqual(custom[0]?.vars, { game: 'sproto' });
  const refreshed = await sdk.init('sproto');
  assert.deepEqual(refreshed.relics, ['tinubu_crown']);
  const grant = await sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu', elapsed: 4, godMode: true }, 'beat');
  assert.deepEqual(grant, { granted: 'tinubu_crown' });
  const earned = await sdk.earnTickets(20, 'win', 'e1');
  assert.deepEqual(earned, { balance: 20, capped: false });
  const traded = await sdk.exchange(20, 'x1');
  assert.equal(traded.verse, 2);
  assert.equal(traded.receiptId, 'r1');
  await sdk.submitScore('sproto_wins', 1);
  assert.equal(calls.some((call) => call.id === 'score.submit'), true);
  sdk.exit('done');
  assert.deepEqual(assigned, ['/hub/#from=sproto']);
  assert.equal(calls.some((call) => call.id === 'session.close' && call.keepalive === true), true);
  assert.equal(session.getItem('hub:sproto:session'), null);

  hash = '#t=spent';
  await assert.rejects(() => sdk.init('sproto'), (error: unknown) => {
    assert.ok(error instanceof HubSdkError);
    assert.equal(error.code, 'ticket_used');
    return true;
  });
  assert.equal(hash, '');
  assert.equal(custom.at(-1)?.id, 't:spent');
  assert.equal(custom.at(-1)?.create, false);
}

/**
 * A queued write keeps the token it was first sent with. When that session is closed,
 * the same player's next session for the same game sends it, and a row nobody here
 * can carry never fails init.
 */
async function staleOutbox(): Promise<void> {
  const tickets: Record<string, { user: string; sid: string }> = {
    a: { user: 'user-1', sid: 'sid-a' },
    b: { user: 'user-1', sid: 'sid-b' },
    c: { user: 'user-2', sid: 'sid-c' },
    d: { user: 'user-1', sid: 'sid-d' },
  };
  const tokenOf = (name: string) => fakeJwt(tickets[name]!.user, { sid: tickets[name]!.sid, ranked: '0', scope: 'game', game: 'nobu' });
  const closed = new Set<string>();
  let down = false;
  const sent: { key: string; token?: string }[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-1' };
    },
    async authenticateCustom(id) {
      const name = id.slice(2);
      return { token: tokenOf(name), refreshToken: `refresh-${name}`, userId: tickets[name]!.user };
    },
    async rpc<T>(id: string, body: object, opts?: { token?: string }): Promise<T> {
      if (id === 'profile.get') return { relics: [], ticketsCapLeft: 0 } as T;
      if (opts?.token && closed.has(opts.token)) throw new HubSdkError('session_closed', 'Session is closed');
      if (id === 'session.event') {
        const key = (body as { key: string }).key;
        sent.push({ key, token: opts?.token });
        if (down) throw new HubSdkError('rpc_failed', 'bad gateway', 502);
        return { granted: 'cones_tip' } as T;
      }
      throw new Error(`unexpected rpc ${id}`);
    },
  };
  let hash = '';
  const session = memoryKeyValue();
  const open = () => createHubSdk({
    client,
    hubUrl: '/hub/',
    local: memoryKeyValue(),
    session,
    readHash: () => hash,
    writeHash: (next) => {
      hash = next;
    },
    assign: () => undefined,
  });
  const isCode = (code: string) => (error: unknown) => {
    assert.ok(error instanceof HubSdkError);
    assert.equal(error.code, code);
    return true;
  };

  // Session a is closed by another portal before the Cone win reaches the hub.
  hash = '#t=a';
  const first = open();
  await first.init('nobu');
  closed.add(tokenOf('a'));
  await assert.rejects(() => first.reportEvent(HubEvent.NobuBossDefeated, { boss: 'cone' }, 'cone-1'), isCode('session_closed'));

  // The next launch of the same player resolves and sends it on the new session.
  hash = '#t=b';
  const second = await open().init('nobu');
  assert.deepEqual(second.relics, ['cones_tip']);
  assert.deepEqual(sent.filter((call) => call.key === 'cone-1').map((call) => call.token), [tokenOf('b')]);

  // Another player's dead row is never sent on this player's session, and does not fail init.
  hash = '#t=c';
  const other = open();
  await other.init('nobu');
  closed.add(tokenOf('c'));
  await assert.rejects(() => other.reportEvent(HubEvent.NobuBossDefeated, { boss: 'cone' }, 'cone-2'), isCode('session_closed'));
  hash = '#t=b';
  await open().init('nobu');
  assert.equal(sent.some((call) => call.key === 'cone-2' && call.token !== tokenOf('c')), false);

  // A standalone launch with that dead row still in the outbox runs standalone.
  hash = '';
  session.removeItem('hub:nobu:session');
  const alone = await open().init('nobu');
  assert.equal(alone.ranked, false);

  // Other failures still reject init, as before.
  hash = '#t=b';
  const live = open();
  await live.init('nobu');
  down = true;
  await assert.rejects(() => live.reportEvent(HubEvent.NobuBossDefeated, { boss: 'cone' }, 'cone-3'), isCode('rpc_failed'));
  closed.add(tokenOf('b'));
  hash = '#t=d';
  await assert.rejects(() => open().init('nobu'), isCode('rpc_failed'));
  down = false;
  await open().init('nobu');
  assert.equal(sent.filter((call) => call.key === 'cone-3').at(-1)?.token, tokenOf('d'));
}

async function nakamaClientWire(): Promise<void> {
  assert.equal(userIdFromToken(fakeJwt('11111111-1111-4111-8111-111111111111')), '11111111-1111-4111-8111-111111111111');
  const seen: string[] = [];
  const client = createNakamaClient({
    serverUrl: 'http://nakama.test/',
    serverKey: LOCAL_NAKAMA.serverKey,
    fetchImpl: async (url, init) => {
      seen.push(String(url));
      if (String(url).includes('/authenticate/device')) {
        return new Response(JSON.stringify({ token: fakeJwt('22222222-2222-4222-8222-222222222222') }), { status: 200 });
      }
      assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, 'Bearer game');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  const auth = await client.authenticateDevice('device-1');
  assert.equal(auth.userId, '22222222-2222-4222-8222-222222222222');
  assert.match(seen[0] ?? '', /^http:\/\/nakama\.test\/v2\/account\/authenticate\/device\?create=true$/);
  await client.rpc('profile.get', {}, { token: 'game' });
  assert.match(seen[1] ?? '', /\/v2\/rpc\/profile\.get\?unwrap=true$/);
}

/** NOBU trials are gear-free: unranked sessions post, per level, in integer ms (Contract C13). */
async function scoresAndSession(): Promise<void> {
  const h = harness('nobu');
  assert.equal(h.sdk.getSession?.(), null);
  assert.equal(await h.sdk.submitScore('nobu_trial_time', 20000, { level: 1 }), undefined);
  h.setHash(`#t=${await ticket('nobu', { ranked: false })}`);
  await h.sdk.init('nobu');
  const info = h.sdk.getSession?.();
  assert.equal(info?.game, 'nobu');
  assert.equal(info?.ranked, false);
  assert.ok((info?.expiresAt ?? 0) > NOW);
  const first = await h.sdk.submitScore('nobu_trial_time', 20000, { level: 1 });
  assert.deepEqual(first, { accepted: true, posted: true, value: 20000, order: 'asc' });
  const slower = await h.sdk.submitScore('nobu_trial_time', 25000, { level: 1 });
  assert.deepEqual(slower, { accepted: true, posted: false, value: 20000, order: 'asc' });
  await h.sdk.submitScore('nobu_trial_time', 40000, { level: 2 });
  assert.equal(h.local.getItem('hub:score:player-1:nobu_trial_time:1'), '20000');
  assert.equal(h.local.getItem('hub:score:player-1:nobu_trial_time:2'), '40000');
  assert.deepEqual(await h.sdk.submitScore('nobu_trial_time', 30000, { level: 1, godMode: true }), { accepted: false, reason: 'god_mode' });
  for (const [value, meta, code] of [
    [20000, { level: 4 }, 'bad_variant'],
    [20000.5, { level: 1 }, 'bad_score'],
    [100, { level: 1 }, 'implausible_score'],
    [1_800_001, { level: 3 }, 'implausible_score'],
  ] as const) {
    await assert.rejects(() => h.sdk.submitScore('nobu_trial_time', value, meta), (error: unknown) => {
      assert.ok(error instanceof HubSdkError);
      assert.equal(error.code, code);
      return true;
    });
  }
  const top = await h.sdk.getLeaderboard?.('nobu_trial_time', { variant: '1' });
  assert.equal(top?.order, 'asc');
  assert.equal(top?.rows[0]?.value, 20000);
  assert.equal((await h.sdk.refreshSession?.())?.playerId, 'player-1');

  // An old-style double without the optional members still satisfies HubSdk.
  const legacy: HubSdk = {
    redeemTicket: async () => ({ token: '', refreshToken: '' }),
    init: async () => ({ playerId: 'p', ranked: false, relics: [], effects: {}, ticketsCapLeft: 0, serverTime: 0 }),
    reportEvent: async () => ({}),
    submitScore: async () => undefined,
    earnTickets: async () => ({ balance: 0, capped: false }),
    exchange: async () => ({ verse: 0, ticketsLeft: 0, balance: 0, receiptId: '' }),
    spendTickets: async () => ({ shop_id: '', item_id: '', packs: 0, units: 0, spent: 0, balance: 0 }),
    sellItem: async () => ({ shop_id: '', item_id: '', packs: 0, units: 0, credited: 0, balance: 0 }),
    getTicketBalance: async () => ({ balance: 0, sessionCapLeft: 0, dailyCapLeft: 0, serverTime: 0 }),
    exit: () => undefined,
  };
  assert.equal(legacy.getSession, undefined);
}

/** Live SDK: unranked submits reach the server, leaderboard.top, and session refresh near expiry. */
async function refreshWire(): Promise<void> {
  const exp = Math.floor(NOW / 1000) + 120;
  const tokenWith = (n: number) => {
    const payload = { uid: 'user-9', exp: n, vrs: { sid: 'sid-9', ranked: '0', scope: 'game', game: 'nobu' } };
    return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
  };
  const calls: { id: string; body: object; token?: string }[] = [];
  const refreshed: string[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-9' };
    },
    async authenticateCustom() {
      return { token: tokenWith(exp), refreshToken: 'refresh-9', userId: 'user-9' };
    },
    async sessionRefresh(refreshToken) {
      refreshed.push(refreshToken);
      return { token: tokenWith(exp + 7200), refreshToken: 'refresh-10' };
    },
    async rpc<T>(id: string, body: object, opts?: { token?: string }): Promise<T> {
      calls.push({ id, body, token: opts?.token });
      if (id === 'profile.get') return { playerId: 'user-9', relics: [] } as T;
      if (id === 'score.submit') return { accepted: true, posted: true, value: 21000, order: 'asc' } as T;
      if (id === 'leaderboard.top') return { boardId: 'nobu_trial_time', variant: '1', order: 'asc', rows: [], me: null } as T;
      // Earlier cases may leave rows in the shared in-memory outbox; they drain here.
      return {} as T;
    },
  };
  let hash = '#t=ticket-9';
  const sdk = createHubSdk({
    client,
    local: memoryKeyValue(),
    session: memoryKeyValue(),
    now: () => NOW,
    readHash: () => hash,
    writeHash: (next) => {
      hash = next;
    },
  });
  await sdk.init('nobu');
  const result = await sdk.submitScore('nobu_trial_time', 21000, { level: 1 });
  assert.deepEqual(result, { accepted: true, posted: true, value: 21000, order: 'asc' });
  const sent = calls.find((c) => c.id === 'score.submit');
  assert.deepEqual(sent?.body, { boardId: 'nobu_trial_time', value: 21000, meta: { level: 1 }, godMode: false });
  await sdk.getLeaderboard?.('nobu_trial_time', { variant: '1', limit: 5 });
  assert.deepEqual(calls.find((c) => c.id === 'leaderboard.top')?.body, { boardId: 'nobu_trial_time', variant: '1', limit: 5 });
  assert.equal(sdk.getSession?.()?.expiresAt, exp * 1000);
  const next = await sdk.refreshSession?.();
  assert.deepEqual(refreshed, ['refresh-9']);
  assert.equal(next?.expiresAt, (exp + 7200) * 1000);
  assert.equal(sdk.getSession?.()?.token, tokenWith(exp + 7200));
  await sdk.refreshSession?.();
  assert.equal(refreshed.length, 1, 'no refresh while the token has more than 5 minutes left');
}

function TICKETS_FOR_CAP(): number {
  return VERSE_DAILY_CAP * 10;
}

await main();
