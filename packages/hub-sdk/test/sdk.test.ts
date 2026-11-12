import assert from 'node:assert/strict';
import {
  GAME_IDS,
  HubEvent,
  HubSdkError,
  LOCAL_NAKAMA,
  FOUR_LIGHTS_RELIC_IDS,
  RELIC_BY_GAME,
  RELIC_IDS,
  VERSE_DAILY_CAP,
  createHubSdk,
  createNakamaClient,
  memoryKeyValue,
  mintMockTicket,
  relicForEvent,
  encodeSave,
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

async function arcadeAndSaves(): Promise<void> {
  // Sproto Arcade's first story boss grants the Breakwater Coin; other bosses and games do not.
  assert.equal(relicForEvent('sproto-arcade', HubEvent.ArcadeBossDefeated, { boss: 'bront' }), 'breakwater_coin');
  assert.equal(relicForEvent('sproto-arcade', HubEvent.ArcadeBossDefeated, { boss: 'vela' }), undefined);
  assert.equal(relicForEvent('nobu', HubEvent.ArcadeBossDefeated, { boss: 'bront' }), undefined);
  assert.equal(relicForEvent('sproto-shooter', HubEvent.GameBeaten, {}), undefined);

  // Standalone: saves no-op.
  {
    const h = harness('sproto-arcade');
    await h.sdk.init('sproto-arcade');
    assert.deepEqual(await h.sdk.loadSave?.(), { data: null, updatedAt: 0 });
    assert.deepEqual(await h.sdk.writeSave?.({ v: 1 }), { data: null, updatedAt: 0 });
  }

  // Mock session: write, read back, the Coin is granted once, and bad saves throw.
  {
    const h = harness('sproto-arcade');
    h.setHash(`#t=${await ticket('sproto-arcade')}`);
    await h.sdk.init('sproto-arcade');
    const data = { v: 1, cleared: [0], unlocked: ['rivet'] };
    assert.deepEqual(await h.sdk.writeSave?.(data), { data, updatedAt: NOW });
    assert.deepEqual(await h.sdk.loadSave?.(), { data, updatedAt: NOW });
    const first = await h.sdk.reportEvent(HubEvent.ArcadeBossDefeated, { boss: 'bront' }, 'arcade:bront:1');
    assert.equal(first.granted, 'breakwater_coin');
    const again = await h.sdk.reportEvent(HubEvent.ArcadeBossDefeated, { boss: 'bront' }, 'arcade:bront:2');
    assert.equal(again.granted, undefined);
    assert.ok((await h.sdk.init('sproto-arcade')).relics.includes('breakwater_coin'));
    await assert.rejects(() => h.sdk.writeSave!([1] as unknown as Record<string, unknown>), (e: unknown) => e instanceof HubSdkError && e.code === 'bad_save');
    await assert.rejects(() => h.sdk.writeSave!({ blob: 'x'.repeat(5000) }), (e: unknown) => e instanceof HubSdkError && e.code === 'save_too_large');
  }
  assert.equal(encodeSave({ a: 1 }), '{"a":1}');
}

async function coopAndShooterRelics(): Promise<void> {
  assert.deepEqual(GAME_IDS.slice(0, 6), ['hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade']);
  assert.deepEqual(GAME_IDS.slice(6), ['sproto-shooter', 'sproto-coop-battle']);
  assert.deepEqual(RELIC_IDS.slice(6), ['marina_anchor', 'dragon_scale']);
  assert.deepEqual([...FOUR_LIGHTS_RELIC_IDS], ['hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown']);
  assert.equal(RELIC_BY_GAME['sproto-coop-battle'], 'marina_anchor');
  assert.equal(RELIC_BY_GAME['sproto-shooter'], 'dragon_scale');
  assert.equal(RELIC_BY_GAME.sproto, 'tinubu_crown');
  assert.equal(HubEvent.CoopStageClear, 'coop.stage_clear');
  assert.equal(HubEvent.ShooterWaveClear, 'shooter.wave_clear');
  assert.equal(Object.values(HubEvent).some((id) => id.endsWith('.boss_clear')), false, 'boss_clear names are server-only');

  // Stage 1 / wave 1 grant, God Mode included. Other stages, waves, events and games do not.
  assert.equal(relicForEvent('sproto-coop-battle', HubEvent.CoopStageClear, { stage: 1 }), 'marina_anchor');
  assert.equal(relicForEvent('sproto-coop-battle', HubEvent.CoopStageClear, { stage: 1, godMode: true, players: 3 }), 'marina_anchor');
  assert.equal(relicForEvent('sproto-coop-battle', HubEvent.CoopStageClear, { stage: 2 }), undefined);
  assert.equal(relicForEvent('sproto-coop-battle', HubEvent.CoopStageClear, { stage: '1' }), undefined);
  assert.equal(relicForEvent('sproto-coop-battle', HubEvent.CoopStageClear, {}), undefined);
  assert.equal(relicForEvent('sproto-coop-battle', 'coop.boss_clear', { stage: 1, boss: '01-marina-bront' }), undefined);
  assert.equal(relicForEvent('sproto-coop-battle', HubEvent.ShooterWaveClear, { wave: 1 }), undefined);
  assert.equal(relicForEvent('sproto-shooter', HubEvent.ShooterWaveClear, { wave: 1 }), 'dragon_scale');
  assert.equal(relicForEvent('sproto-shooter', HubEvent.ShooterWaveClear, { wave: 1, godMode: true }), 'dragon_scale');
  assert.equal(relicForEvent('sproto-shooter', HubEvent.ShooterWaveClear, { wave: 2 }), undefined);
  assert.equal(relicForEvent('sproto-shooter', 'shooter.boss_clear', { wave: 1 }), undefined);
  assert.equal(relicForEvent('sproto-shooter', HubEvent.CoopStageClear, { stage: 1 }), undefined);
  assert.equal(relicForEvent('sproto-shooter', HubEvent.SprotoBossDefeated, { boss: 'sahil' }), undefined);
  assert.equal(relicForEvent('sproto-coop-battle', HubEvent.ArcadeBossDefeated, { boss: 'bront' }), undefined);
  assert.equal(relicForEvent('sproto-arcade', HubEvent.CoopStageClear, { stage: 1 }), undefined);
  assert.equal(relicForEvent('sproto', HubEvent.SprotoBossDefeated, { boss: 'tinubu' }), 'tinubu_crown');

  const cases = [
    { game: 'sproto-coop-battle', event: HubEvent.CoopStageClear, miss: { stage: 2 }, hit: { stage: 1, godMode: true }, relic: 'marina_anchor' },
    { game: 'sproto-shooter', event: HubEvent.ShooterWaveClear, miss: { wave: 2 }, hit: { wave: 1, godMode: true }, relic: 'dragon_scale' },
  ] as const;
  for (const row of cases) {
    const h = harness(row.game);
    const standalone = await h.sdk.init(row.game);
    assert.equal(standalone.ranked, false);
    assert.ok(standalone.playerId.length > 0);
    assert.deepEqual(standalone.relics, []);
    assert.deepEqual(await h.sdk.reportEvent(row.event, row.hit, `${row.game}:standalone`), {});
    h.sdk.exit('return');
    assert.equal(h.assigned.length, 0);
    h.setHash(`#t=${await ticket(row.game)}`);
    const session = await h.sdk.init(row.game);
    assert.equal(session.playerId, 'player-1');
    assert.deepEqual(session.relics, []);
    assert.equal((await h.sdk.reportEvent(HubEvent.GameBeaten, { boss: 'sahil' }, `${row.game}:beaten`)).granted, undefined);
    assert.equal((await h.sdk.reportEvent(row.event, row.miss, `${row.game}:miss`)).granted, undefined);
    assert.equal((await h.sdk.reportEvent(row.event, row.hit, `${row.game}:hit:1`)).granted, row.relic);
    assert.equal((await h.sdk.reportEvent(row.event, row.hit, `${row.game}:hit:2`)).granted, undefined, 'earn-once');
    assert.ok((await h.sdk.init(row.game)).relics.includes(row.relic));
    h.sdk.exit('return');
    assert.equal(h.assigned.at(-1), `/hub/#from=${row.game}`);
  }
}

async function main(): Promise<void> {
  await coopAndShooterRelics();
  await arcadeAndSaves();
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
  await finalOutbox();
  await deadCachedSession();
  await drainOwnGame();
  await refreshCachedSession();
  await deadActiveSessionInDrain();
  await drainWarnings();
  await sharedRefresh();
  await refreshThrottled();
  await drainExpiryAndInventory();
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
        // What the server answers for a story boss that paid, with and without a Relic (0.7.1).
        if (data.key === 'boss-paid') return { granted_items: [], tickets: 20 } as T;
        if (data.key === 'boss-and-relic') return { granted: 'tinubu_crown', granted_items: [], tickets: 20 } as T;
        if (data.key === 'boss-zero') return { granted_items: [], tickets: 0 } as T;
        if (data.key === 'boss-rematch') return { granted_items: [] } as T;
        if (typeof data.key === 'string' && data.key.startsWith('boss-junk-')) {
          const junk: Record<string, unknown> = { 'boss-junk-text': '20', 'boss-junk-neg': -20, 'boss-junk-frac': 2.5, 'boss-junk-nan': Number.NaN, 'boss-junk-null': null, 'boss-junk-big': 2 ** 60 };
          return { tickets: junk[data.key] } as T;
        }
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
  assert.deepEqual(grant, { granted: 'tinubu_crown' }, 'no tickets key when the server sends none');
  // 0.7.1: the Tickets the server credited for the event come back, as an optional field.
  assert.deepEqual(await sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'sahil' }, 'boss-paid'), { tickets: 20 });
  assert.deepEqual(await sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu' }, 'boss-and-relic'), { granted: 'tinubu_crown', tickets: 20 });
  assert.deepEqual(await sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'sahil' }, 'boss-zero'), { tickets: 0 });
  assert.deepEqual(await sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'sahil' }, 'boss-rematch'), {}, 'a boss that paid nothing has no tickets key');
  for (const key of ['boss-junk-text', 'boss-junk-neg', 'boss-junk-frac', 'boss-junk-nan', 'boss-junk-null', 'boss-junk-big']) {
    assert.deepEqual(await sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'sahil' }, key), {}, `${key} is not a Ticket amount`);
  }
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

  // Other failures leave the row queued without failing init (0.6.3), and it lands later.
  hash = '#t=b';
  const live = open();
  await live.init('nobu');
  down = true;
  await assert.rejects(() => live.reportEvent(HubEvent.NobuBossDefeated, { boss: 'cone' }, 'cone-3'), isCode('rpc_failed'));
  closed.add(tokenOf('b'));
  hash = '#t=d';
  const stillDown = await open().init('nobu');
  assert.equal(stillDown.playerId, 'user-1');
  assert.equal(sent.filter((call) => call.key === 'cone-3').at(-1)?.token, tokenOf('d'), 'the row was retried on the new session');
  const tries = sent.filter((call) => call.key === 'cone-3').length;
  down = false;
  await open().init('nobu');
  assert.equal(sent.filter((call) => call.key === 'cone-3').length, tries + 1);
  assert.equal(sent.filter((call) => call.key === 'cone-3').at(-1)?.token, tokenOf('d'));
}

/**
 * Outbox rows over the real Nakama wire client. A final refusal in a 2xx `{error}` body
 * (amount_over_rule, a cap, idempotency_mismatch) is dropped and never blocks init again; the
 * caller that queued it still gets the error. An HTTP 5xx or a network failure stays queued.
 * A dead-session row on another player's token stays queued and does not fail init.
 */
async function finalOutbox(): Promise<void> {
  const tickets: Record<string, { user: string; sid: string }> = {
    a: { user: 'user-7', sid: 'sid-fa' },
    b: { user: 'user-7', sid: 'sid-fb' },
    c: { user: 'user-7', sid: 'sid-fc' },
    d: { user: 'user-8', sid: 'sid-fd' },
    e: { user: 'user-7', sid: 'sid-fe' },
    f: { user: 'user-8', sid: 'sid-ff' },
  };
  const tokenOf = (name: string) => fakeJwt(tickets[name]!.user, { sid: tickets[name]!.sid, ranked: '0', scope: 'game', game: 'hpos10i' });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  /** Per key: what the server answers to tickets.earn. */
  const answers = new Map<string, 'ok' | 'over' | 'mismatch' | 'down' | 'offline'>();
  const closed = new Set<string>();
  const sent: { key: string; token: string }[] = [];
  const client = createNakamaClient({
    serverUrl: 'http://nakama.test',
    fetchImpl: async (url, init) => {
      const href = String(url);
      if (href.includes('/authenticate/custom')) {
        const id = (JSON.parse(String(init?.body)) as { id: string }).id;
        return json({ token: tokenOf(id.slice(2)), refresh_token: `refresh-${id}` });
      }
      const token = ((init?.headers as Record<string, string>).Authorization ?? '').replace(/^Bearer /, '');
      if (href.includes('/rpc/profile.get')) return json({ relics: [], ticketsCapLeft: 100 });
      // Rows earlier cases left in the shared in-memory outbox are on their own closed sessions.
      if (!href.includes('/rpc/tickets.earn')) return json({ error: 'session_closed', message: 'session_closed' });
      const key = (JSON.parse(String(init?.body)) as { key: string }).key;
      const answer = answers.get(key) ?? 'ok';
      if (answer === 'offline') throw new TypeError('fetch failed');
      sent.push({ key, token });
      if (closed.has(token)) return json({ error: 'session_closed', message: 'session_closed' });
      if (answer === 'down') return new Response('upstream unavailable', { status: 503 });
      if (answer === 'over') return json({ error: 'amount_over_rule', message: 'amount_over_rule' });
      if (answer === 'mismatch') return json({ error: 'idempotency_mismatch', message: 'idempotency_mismatch' });
      return json({ balance: 20, capped: false });
    },
  });
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
  const sends = (key: string) => sent.filter((call) => call.key === key).length;

  // A final refusal on the first send reaches the caller and leaves nothing queued.
  hash = '#t=a';
  const first = open();
  await first.init('hpos10i');
  answers.set('over-now', 'over');
  await assert.rejects(() => first.earnTickets(25, 'level_end', 'over-now'), isCode('amount_over_rule'));
  answers.set('mismatch-now', 'mismatch');
  await assert.rejects(() => first.earnTickets(20, 'level_end', 'mismatch-now'), isCode('idempotency_mismatch'));

  // A write lost offline stays queued; when the server then refuses it for good, the next
  // init drops it and still reaches the hub.
  answers.set('over-later', 'offline');
  await assert.rejects(() => first.earnTickets(30, 'level_end', 'over-later'), TypeError);
  answers.set('over-later', 'over');
  hash = '#t=b';
  const second = await open().init('hpos10i');
  assert.equal(second.playerId, 'user-7');
  assert.equal(second.ticketsCapLeft, 100);
  assert.equal(sends('over-later'), 1);
  hash = '#t=c';
  await open().init('hpos10i');
  assert.equal(sends('over-now'), 1, 'a refused row was sent again');
  assert.equal(sends('mismatch-now'), 1, 'a refused row was sent again');
  assert.equal(sends('over-later'), 1, 'a refused row was sent again');

  // HTTP 5xx is retryable: the row stays queued until it lands, and init still succeeds (0.6.3).
  const live = open();
  await live.init('hpos10i');
  answers.set('boom', 'down');
  await assert.rejects(() => live.earnTickets(20, 'level_end', 'boom'), isCode('rpc_failed'));
  assert.equal((await open().init('hpos10i')).playerId, 'user-7');
  assert.equal(sends('boom'), 2);
  answers.set('boom', 'ok');
  await open().init('hpos10i');
  assert.equal(sends('boom'), 3);
  await open().init('hpos10i');
  assert.equal(sends('boom'), 3, 'a delivered row was sent again');

  // Another player's row on a closed session stays queued and does not fail this init.
  hash = '#t=d';
  const other = open();
  await other.init('hpos10i');
  closed.add(tokenOf('d'));
  await assert.rejects(() => other.earnTickets(20, 'level_end', 'dead-d'), isCode('session_closed'));
  hash = '#t=e';
  const mine = await open().init('hpos10i');
  assert.equal(mine.playerId, 'user-7');
  assert.equal(sent.filter((call) => call.key === 'dead-d').every((call) => call.token === tokenOf('d')), true);
  const deadSends = sends('dead-d');
  // That player's next session carries it.
  hash = '#t=f';
  await open().init('hpos10i');
  assert.equal(sends('dead-d'), deadSends + 1);
  assert.equal(sent.at(-1)?.token, tokenOf('f'));
  session.removeItem('hub:hpos10i:session');
}

/**
 * HUB-W-1-07b: a cached session the server reports dead (session_closed, 401, not a game
 * session) falls back to standalone instead of looking live. A transient failure keeps it.
 */
async function deadCachedSession(): Promise<void> {
  const token = fakeJwt('user-31', { sid: 'sid-31', ranked: '1', scope: 'game', game: 'sproto-fighter' });
  let profile: 'ok' | 'closed' | 'expired' | 'down' | 'offline' = 'ok';
  const sent: string[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-31' };
    },
    async authenticateCustom() {
      return { token, refreshToken: 'refresh-31', userId: 'user-31' };
    },
    async rpc<T>(id: string, body: object): Promise<T> {
      if (id === 'profile.get') {
        if (profile === 'closed') throw new HubSdkError('session_closed', 'Session is closed');
        if (profile === 'expired') throw new HubSdkError('rpc_failed', 'unauthorized', 401);
        if (profile === 'down') throw new HubSdkError('rpc_failed', 'bad gateway', 502);
        if (profile === 'offline') throw new TypeError('fetch failed');
        return { playerId: 'user-31', relics: [], ticketsCapLeft: 50, ranked: true } as T;
      }
      if (id === 'tickets.earn') {
        sent.push((body as { key: string }).key);
        return { balance: 1, capped: false } as T;
      }
      // Rows other cases left in the shared in-memory outbox are on their own closed sessions.
      throw new HubSdkError('session_closed', 'Session is closed');
    },
  };
  let hash = '#t=f31';
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
  const launched = await open().init('sproto-fighter');
  assert.equal(launched.playerId, 'user-31');
  assert.ok(session.getItem('hub:sproto-fighter:session'), 'the launch caches its session');

  // A reload while the session is still open resumes it.
  const resumed = open();
  assert.equal((await resumed.init('sproto-fighter')).ranked, true);
  assert.equal(resumed.getSession?.()?.token, token);

  // Transient failures keep the cached session: the next init can load the profile.
  for (const failure of ['down', 'offline'] as const) {
    profile = failure;
    const sdk = open();
    const result = await sdk.init('sproto-fighter');
    assert.equal(result.playerId, 'user-31', `${failure} keeps the cached session`);
    assert.equal(sdk.getSession?.()?.token, token);
  }

  // A dead session does not look live: standalone, the cache is dropped, writes no-op.
  for (const failure of ['closed', 'expired'] as const) {
    hash = '#t=f31';
    profile = 'ok';
    await open().init('sproto-fighter');
    profile = failure;
    const sdk = open();
    const result = await sdk.init('sproto-fighter');
    assert.equal(result.ranked, false, `cached_dead_session_falls_back_to_standalone (${failure})`);
    assert.notEqual(result.playerId, 'user-31');
    assert.equal(sdk.getSession?.(), null);
    assert.equal(session.getItem('hub:sproto-fighter:session'), null, 'the dead session is not cached any more');
    assert.deepEqual(await sdk.earnTickets(5, 'win', `after-${failure}`), { balance: 0, capped: false });
    assert.equal(sent.includes(`after-${failure}`), false);
    // The next init without a ticket stays standalone without asking the server again.
    profile = 'ok';
    assert.equal((await open().init('sproto-fighter')).ranked, false);
  }
}

/**
 * HUB-W-1-07 review: a cached session whose access token expired (2 h) while its refresh
 * token (7 days) and lease (6 h) still hold is refreshed, not dropped. A 401 drops it only
 * when the refresh itself is refused, or there is nothing to refresh with.
 */
async function refreshCachedSession(): Promise<void> {
  const tokenAt = (n: number) => fakeJwt('user-51', { sid: 'sid-51', ranked: '1', scope: 'game', game: 'nobu', n: String(n) });
  let minted = 1;
  let current = tokenAt(minted);
  let refreshAnswer: 'ok' | 'refused' | 'offline' = 'ok';
  let refreshes = 0;
  let profileAfterRefresh: 'ok' | 'closed' = 'ok';
  const profiles: string[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-51' };
    },
    async authenticateCustom() {
      return { token: current, refreshToken: 'refresh-51', userId: 'user-51' };
    },
    async sessionRefresh(refreshToken) {
      refreshes += 1;
      assert.equal(refreshToken, 'refresh-51');
      if (refreshAnswer === 'offline') throw new TypeError('fetch failed');
      if (refreshAnswer === 'refused') throw new HubSdkError('auth_failed', 'Refresh token invalid', 401);
      minted += 1;
      current = tokenAt(minted);
      return { token: current, refreshToken: 'refresh-51' };
    },
    async rpc<T>(id: string, _body: object, opts?: { token?: string }): Promise<T> {
      if (id === 'profile.get') {
        profiles.push(opts?.token ?? '');
        if (opts?.token !== current) throw new HubSdkError('rpc_failed', 'token expired', 401);
        if (profileAfterRefresh === 'closed') throw new HubSdkError('session_closed', 'Session is closed');
        return { playerId: 'user-51', relics: [], ticketsCapLeft: 7 } as T;
      }
      throw new HubSdkError('session_closed', 'Session is closed');
    },
  };
  let hash = '#t=r51';
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
  const launch = async () => {
    minted += 1;
    current = tokenAt(minted);
    hash = '#t=r51';
    refreshAnswer = 'ok';
    profileAfterRefresh = 'ok';
    await open().init('nobu');
  };
  const cachedToken = () => (JSON.parse(session.getItem('hub:nobu:session') ?? '{}') as { token?: string }).token;

  // The access token expires: init refreshes, persists the new token and retries profile.get once.
  await launch();
  const stale = current;
  current = 'expired-server-side';
  const revived = open();
  const result = await revived.init('nobu');
  assert.equal(result.playerId, 'user-51', 'expired_access_token_is_refreshed_not_dropped');
  assert.equal(result.ticketsCapLeft, 7);
  assert.equal(refreshes, 1);
  assert.notEqual(revived.getSession?.()?.token, stale);
  assert.equal(revived.getSession?.()?.token, current);
  assert.equal(cachedToken(), current, 'the refreshed token is cached');
  assert.deepEqual(profiles.slice(-2), [stale, current], 'profile.get is retried once with the new token');

  // The refresh is refused (refresh token expired or revoked): standalone.
  await launch();
  current = 'expired-server-side';
  refreshAnswer = 'refused';
  const refused = open();
  assert.equal((await refused.init('nobu')).ranked, false, 'refused_refresh_falls_back_to_standalone');
  assert.equal(refused.getSession?.(), null);
  assert.equal(session.getItem('hub:nobu:session'), null);

  // The refresh fails offline: keep the cached session for the next init.
  await launch();
  const kept = current;
  current = 'expired-server-side';
  refreshAnswer = 'offline';
  const offline = open();
  assert.equal((await offline.init('nobu')).playerId, 'user-51', 'offline_refresh_keeps_the_session');
  assert.equal(offline.getSession?.()?.token, kept);

  // Refreshed, but the session itself is closed: standalone.
  await launch();
  current = 'expired-server-side';
  profileAfterRefresh = 'closed';
  const closedAfter = open();
  assert.equal((await closedAfter.init('nobu')).ranked, false);
  assert.equal(closedAfter.getSession?.(), null);
  session.removeItem('hub:nobu:session');
}

/**
 * HUB-W-1-07 review: profile.get does not report a closed session today, so the drain is the
 * real signal. A row sent on the active session's token that comes back dead ends that
 * session: standalone, cache cleared, no more rows sent on that token.
 */
async function deadActiveSessionInDrain(): Promise<void> {
  const tokens: Record<string, string> = {
    h1: fakeJwt('user-61', { sid: 'sid-h1', ranked: '0', scope: 'game', game: 'hpos10i' }),
    h2: fakeJwt('user-61', { sid: 'sid-h2', ranked: '0', scope: 'game', game: 'hpos10i' }),
  };
  const closed = new Set<string>();
  let offline = false;
  const sent: { key: string; token?: string }[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-61' };
    },
    async authenticateCustom(id) {
      return { token: tokens[id.slice(2)]!, refreshToken: `refresh-${id}`, userId: 'user-61' };
    },
    async rpc<T>(id: string, body: object, opts?: { token?: string }): Promise<T> {
      if (id === 'profile.get') return { playerId: 'user-61', relics: [], ticketsCapLeft: 9 } as T;
      const key = (body as { key?: string }).key ?? '';
      if (!key.startsWith('act-')) throw new HubSdkError('session_closed', 'Session is closed');
      if (offline) throw new TypeError('fetch failed');
      sent.push({ key, token: opts?.token });
      if (opts?.token && closed.has(opts.token)) throw new HubSdkError('session_closed', 'Session is closed');
      return { balance: 1, capped: false } as T;
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

  hash = '#t=h1';
  const first = open();
  await first.init('hpos10i');
  offline = true;
  await assert.rejects(() => first.earnTickets(5, 'level_end', 'act-1'), TypeError);
  await assert.rejects(() => first.earnTickets(5, 'level_end', 'act-2'), TypeError);
  offline = false;
  // Another tab's portal closes h1; profile.get still answers (it does not check the session).
  closed.add(tokens.h1!);
  const reload = open();
  const result = await reload.init('hpos10i');
  assert.equal(result.ranked, false, 'dead_active_token_in_drain_goes_standalone');
  assert.equal(reload.getSession?.(), null);
  assert.equal(session.getItem('hub:hpos10i:session'), null, 'the dead session is not cached');
  assert.equal(sent.filter((call) => call.token === tokens.h1).length, 1, 'no more rows are sent on the dead token');
  // The rows stay queued and the player's next session carries both.
  hash = '#t=h2';
  await open().init('hpos10i');
  assert.deepEqual(sent.filter((call) => call.token === tokens.h2).map((call) => call.key).sort(), ['act-1', 'act-2']);
  session.removeItem('hub:hpos10i:session');
}

/**
 * HUB-W-1-07c (revised in review): every game shares the hub-outbox IndexedDB on one origin.
 * init also delivers other games' rows, but only with each row's own stored token: never
 * re-pointed at this session, dropped only on that row's own final refusal, and a failure
 * never affects this game's init. One row failing for a non-final reason stays queued
 * without failing init or blocking the rest.
 */
async function drainOwnGame(): Promise<void> {
  const tickets: Record<string, { game: GameId; sid: string }> = {
    a1: { game: 'sproto-arcade', sid: 'sid-g-a1' },
    a2: { game: 'sproto-arcade', sid: 'sid-g-a2' },
    a3: { game: 'sproto-arcade', sid: 'sid-g-a3' },
    b1: { game: 'peoples-bitcoin', sid: 'sid-g-b1' },
    b2: { game: 'peoples-bitcoin', sid: 'sid-g-b2' },
  };
  const tokenOf = (name: string) => fakeJwt('user-41', { sid: tickets[name]!.sid, ranked: '0', scope: 'game', game: tickets[name]!.game });
  /** Per key: how the server answers. */
  const answers = new Map<string, 'ok' | 'refuse' | 'down' | 'offline' | 'closed'>();
  const sent: { key: string; token?: string }[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-41' };
    },
    async authenticateCustom(id) {
      return { token: tokenOf(id.slice(2)), refreshToken: `refresh-${id}`, userId: 'user-41' };
    },
    async rpc<T>(id: string, body: object, opts?: { token?: string }): Promise<T> {
      if (id === 'profile.get') return { relics: [], ticketsCapLeft: 100 } as T;
      const key = (body as { key?: string }).key ?? '';
      // Rows other cases left in the shared in-memory outbox.
      if (!key.startsWith('own-')) throw new HubSdkError('session_closed', 'Session is closed');
      const answer = answers.get(key) ?? 'ok';
      if (answer === 'offline') throw new TypeError('fetch failed');
      sent.push({ key, token: opts?.token });
      if (answer === 'down') throw new HubSdkError('rpc_failed', 'bad gateway', 502);
      if (answer === 'refuse') throw new HubSdkError('amount_over_rule', 'amount_over_rule');
      if (answer === 'closed') throw new HubSdkError('session_closed', 'Session is closed');
      return { balance: 1, capped: false } as T;
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
  const sends = (key: string) => sent.filter((call) => call.key === key);

  // The arcade queues three writes it could not deliver.
  hash = '#t=a1';
  const arcade = open();
  await arcade.init('sproto-arcade');
  for (const key of ['own-arcade-1', 'own-arcade-2', 'own-arcade-3']) {
    answers.set(key, 'offline');
    await assert.rejects(() => arcade.earnTickets(10, 'boss', key), TypeError);
  }

  // People's Bitcoin (same player, same origin) launches. It sends the arcade's rows on the
  // arcade's own token, never its own. A 5xx, a final refusal and a closed arcade session
  // none of them affect PB's init or PB's session.
  answers.set('own-arcade-1', 'down');
  answers.set('own-arcade-2', 'refuse');
  answers.set('own-arcade-3', 'closed');
  hash = '#t=b1';
  const pbSdk = open();
  const pb = await pbSdk.init('peoples-bitcoin');
  assert.equal(pb.playerId, 'user-41', 'other_games_row_failures_do_not_fail_init');
  assert.equal(pbSdk.getSession?.()?.token, tokenOf('b1'), 'another game\'s dead row does not end this session');
  for (const key of ['own-arcade-1', 'own-arcade-2', 'own-arcade-3']) {
    assert.deepEqual(sends(key).map((call) => call.token), [tokenOf('a1')], `other_games_rows_keep_their_own_token (${key})`);
  }

  // Next PB launch: the 5xx row lands on its own token; the refused row was dropped; the
  // closed-session row stays queued and is not re-pointed at PB's session.
  answers.set('own-arcade-1', 'ok');
  hash = '#t=b2';
  await open().init('peoples-bitcoin');
  assert.deepEqual(sends('own-arcade-1').map((call) => call.token), [tokenOf('a1'), tokenOf('a1')], 'delivered for a game the player did not relaunch');
  assert.equal(sends('own-arcade-2').length, 1, 'a final refusal dropped the other game\'s row');
  assert.ok(sends('own-arcade-3').every((call) => call.token === tokenOf('a1')));

  // The arcade's own next launch re-points its closed-session row at its new session.
  answers.set('own-arcade-3', 'ok');
  hash = '#t=a2';
  await open().init('sproto-arcade');
  assert.equal(sends('own-arcade-3').at(-1)?.token, tokenOf('a2'));
  const delivered = sends('own-arcade-3').length;
  await open().init('sproto-arcade');
  assert.equal(sends('own-arcade-1').length, 2, 'a delivered row is not sent again');
  assert.equal(sends('own-arcade-3').length, delivered);

  // One row failing with a retryable error stays queued and does not fail init or block the next row.
  const live = open();
  await live.init('sproto-arcade');
  answers.set('own-arcade-bad', 'offline');
  answers.set('own-arcade-good', 'offline');
  await assert.rejects(() => live.earnTickets(10, 'boss', 'own-arcade-bad'), TypeError);
  await assert.rejects(() => live.earnTickets(10, 'boss', 'own-arcade-good'), TypeError);
  answers.set('own-arcade-bad', 'down');
  answers.set('own-arcade-good', 'ok');
  hash = '#t=a3';
  const next = await open().init('sproto-arcade');
  assert.equal(next.playerId, 'user-41', 'drain_row_error_does_not_fail_init');
  assert.equal(sends('own-arcade-bad').length, 1);
  assert.equal(sends('own-arcade-good').length, 1, 'a failing row does not block the rows after it');
  answers.set('own-arcade-bad', 'ok');
  await open().init('sproto-arcade');
  assert.equal(sends('own-arcade-bad').length, 2, 'the failed row stayed queued and lands later');
  await open().init('sproto-arcade');
  assert.equal(sends('own-arcade-bad').length, 2);
  assert.equal(sends('own-arcade-good').length, 1);
  session.removeItem('hub:sproto-arcade:session');
}

/** Review: drain never hides a non-server error silently, and an unreadable outbox does not fail init. */
async function drainWarnings(): Promise<void> {
  const token = fakeJwt('user-71', { sid: 'sid-71', ranked: '0', scope: 'game', game: 'sproto-shooter' });
  let answer: 'offline' | 'bug' | 'ok' = 'offline';
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-71' };
    },
    async authenticateCustom() {
      return { token, refreshToken: 'refresh-71', userId: 'user-71' };
    },
    async rpc<T>(id: string, body: object): Promise<T> {
      if (id === 'profile.get') return { playerId: 'user-71', relics: [], ticketsCapLeft: 3 } as T;
      if ((body as { key?: string }).key !== 'warn-1') throw new HubSdkError('session_closed', 'Session is closed');
      if (answer === 'offline') throw new TypeError('fetch failed');
      if (answer === 'bug') throw new RangeError('a programming error');
      return { balance: 1, capped: false } as T;
    },
  };
  let hash = '#t=w71';
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
  const warned: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warned.push(String(args[0]));
  };
  const globals = globalThis as { indexedDB?: unknown };
  try {
    const sdk = open();
    await sdk.init('sproto-shooter');
    await assert.rejects(() => sdk.earnTickets(1, 'win', 'warn-1'), TypeError);
    answer = 'bug';
    assert.equal((await open().init('sproto-shooter')).playerId, 'user-71');
    assert.ok(warned.some((line) => line.includes('warn-1')), 'drain_warns_on_non_hub_errors');

    // An outbox that cannot be opened (blocked storage) does not fail init.
    globals.indexedDB = {
      open() {
        const request: { error?: Error; onerror?: () => void } = {};
        queueMicrotask(() => {
          request.error = new Error('storage blocked');
          request.onerror?.();
        });
        return request;
      },
    };
    const blocked = await open().init('sproto-shooter');
    assert.equal(blocked.playerId, 'user-71', 'unreadable_outbox_does_not_fail_init');
    assert.ok(warned.some((line) => line.includes('could not read the outbox')));
  } finally {
    console.warn = originalWarn;
    delete globals.indexedDB;
  }
  answer = 'ok';
  await open().init('sproto-shooter');
  session.removeItem('hub:sproto-shooter:session');
}

/** A game token with an `exp` claim (seconds), as Nakama issues them. */
function expJwt(userId: string, vars: Record<string, string>, expSec: number): string {
  return `e30.${Buffer.from(JSON.stringify({ uid: userId, vrs: vars, exp: expSec })).toString('base64url')}.sig`;
}

/**
 * Re-review 1: init() and refreshSession() share one in-flight refresh, so a rotating
 * server never sees the same refresh token twice. A refresh refused because another path
 * already rotated the token keeps the newer session instead of dropping it.
 */
async function sharedRefresh(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const vars = { sid: 'sid-81', ranked: '1', scope: 'game', game: 'sproto' };
  let serial = 0;
  const mint = (expSec: number) => {
    serial += 1;
    return expJwt('user-81', { ...vars, n: String(serial) }, expSec);
  };
  // The server rotates refresh tokens: each one works once.
  let liveAccess = mint(nowSec + 60);
  let liveRefresh = 'refresh-81-0';
  const refreshCalls: string[] = [];
  const waiting: (() => void)[] = [];
  const started = async () => {
    for (let i = 0; i < 50 && waiting.length === 0; i += 1) await new Promise((r) => setTimeout(r, 0));
    assert.ok(waiting.length > 0, 'a refresh started');
  };
  const releaseAll = () => {
    for (const go of waiting.splice(0)) go();
  };
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-81' };
    },
    async authenticateCustom() {
      return { token: liveAccess, refreshToken: liveRefresh, userId: 'user-81' };
    },
    async sessionRefresh(refreshToken) {
      refreshCalls.push(refreshToken);
      await new Promise<void>((resolve) => waiting.push(resolve));
      if (refreshToken !== liveRefresh) throw new HubSdkError('auth_failed', 'Refresh token invalid', 401);
      liveAccess = mint(nowSec + 7200);
      liveRefresh = `refresh-81-${serial}`;
      return { token: liveAccess, refreshToken: liveRefresh };
    },
    async rpc<T>(id: string, _body: object, opts?: { token?: string }): Promise<T> {
      if (id === 'profile.get') {
        if (opts?.token !== liveAccess) throw new HubSdkError('rpc_failed', 'token expired', 401);
        return { playerId: 'user-81', relics: [], ticketsCapLeft: 4, ranked: true } as T;
      }
      throw new HubSdkError('session_closed', 'Session is closed');
    },
  };
  let hash = '#t=s81';
  const session = memoryKeyValue();
  const make = () => createHubSdk({
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
  const sdk = make();
  await sdk.init('sproto');
  const firstAccess = liveAccess;

  // The access token lapses server-side; a re-init and the realtime refresh race.
  liveAccess = 'expired-server-side';
  const reinit = sdk.init('sproto');
  const refresh = sdk.refreshSession!();
  await started();
  await new Promise((r) => setTimeout(r, 0));
  releaseAll();
  const [result, info] = await Promise.all([reinit, refresh]);
  assert.deepEqual(refreshCalls, ['refresh-81-0'], 'concurrent_refreshes_send_the_refresh_token_once');
  assert.equal(result.ranked, true, 'the re-init stays live');
  assert.equal(info?.token, liveAccess);
  assert.notEqual(sdk.getSession?.()?.token, firstAccess);
  assert.equal(sdk.getSession?.()?.token, liveAccess);

  // Another SDK instance in the tab already rotated the token while this one's refresh, made
  // with the old refresh token, was in flight. The server refuses it; the newer cached
  // session is kept, not dropped.
  const staleCache = session.getItem('hub:sproto:session')!;
  liveAccess = 'expired-server-side';
  const rotate = sdk.init('sproto');
  await started();
  releaseAll();
  await rotate;
  const rotated = session.getItem('hub:sproto:session')!;
  assert.notEqual(rotated, staleCache);
  session.setItem('hub:sproto:session', staleCache);
  const stale = make();
  const staleInit = stale.init('sproto');
  await started();
  session.setItem('hub:sproto:session', rotated);
  releaseAll();
  const kept = await staleInit;
  assert.equal(kept.ranked, true, 'refused_refresh_keeps_a_newer_cached_token');
  assert.equal(stale.getSession?.()?.token, (JSON.parse(rotated) as { token: string }).token);
  session.removeItem('hub:sproto:session');
}

/** Re-review 3: 408 and 429 on refresh are transient: the cached session is kept. */
async function refreshThrottled(): Promise<void> {
  const token = fakeJwt('user-82', { sid: 'sid-82', ranked: '0', scope: 'game', game: 'nobu' });
  let profileOk = true;
  let refreshStatus = 429;
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-82' };
    },
    async authenticateCustom() {
      return { token, refreshToken: 'refresh-82', userId: 'user-82' };
    },
    async sessionRefresh() {
      throw new HubSdkError('auth_failed', 'try later', refreshStatus);
    },
    async rpc<T>(id: string): Promise<T> {
      if (id === 'profile.get') {
        if (!profileOk) throw new HubSdkError('rpc_failed', 'token expired', 401);
        return { playerId: 'user-82', relics: [], ticketsCapLeft: 2 } as T;
      }
      throw new HubSdkError('session_closed', 'Session is closed');
    },
  };
  let hash = '#t=t82';
  const session = memoryKeyValue();
  const open = () => createHubSdk({ client, hubUrl: '/hub/', local: memoryKeyValue(), session, readHash: () => hash, writeHash: (next) => { hash = next; }, assign: () => undefined });
  await open().init('nobu');
  profileOk = false;
  for (const status of [408, 429]) {
    refreshStatus = status;
    const sdk = open();
    assert.equal((await sdk.init('nobu')).playerId, 'user-82', `refresh_${status}_is_transient`);
    assert.equal(sdk.getSession?.()?.token, token);
  }
  refreshStatus = 400;
  assert.equal((await open().init('nobu')).ranked, false, 'a 400 refresh is still a refusal');
  session.removeItem('hub:nobu:session');
}

/**
 * Re-review 2 and 4: another game's row whose stored token has expired is kept queued and
 * not sent (only its own game's rebind can deliver it); a fresh foreign row still goes. A
 * session ended by the drain stops showing its items and gates.
 */
async function drainExpiryAndInventory(): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  const own = fakeJwt('user-91', { sid: 'sid-91', ranked: '0', scope: 'game', game: 'hpos10i' });
  // A different player's nobu row, so the other nobu launch below does not rebind it.
  const foreignExpired = expJwt('user-92', { sid: 'sid-91x', ranked: '0', scope: 'game', game: 'nobu' }, nowSec - 60);
  const foreignFresh = expJwt('user-91', { sid: 'sid-91y', ranked: '0', scope: 'game', game: 'nobu' }, nowSec + 3600);
  let current = own;
  let ownClosed = false;
  let offline = false;
  const sent: { key: string; token?: string }[] = [];
  const client: NakamaClient = {
    async authenticateDevice() {
      return { token: 'hub', userId: 'user-91' };
    },
    async authenticateCustom() {
      return { token: current, refreshToken: 'refresh-91', userId: userIdFromToken(current) };
    },
    async rpc<T>(id: string, body: object, opts?: { token?: string }): Promise<T> {
      if (id === 'profile.get') {
        return { playerId: userIdFromToken(opts?.token ?? ''), relics: [], ticketsCapLeft: 5, items: ['pet_a'], gates: [{ gateId: 'g1', unlocked: true, actionType: 'walk' }] } as T;
      }
      const key = (body as { key?: string }).key ?? '';
      if (!key.startsWith('exp-')) throw new HubSdkError('session_closed', 'Session is closed');
      if (offline) throw new TypeError('fetch failed');
      sent.push({ key, token: opts?.token });
      if (ownClosed && opts?.token === own) throw new HubSdkError('session_closed', 'Session is closed');
      return { balance: 1, capped: false } as T;
    },
  };
  let hash = '';
  const session = memoryKeyValue();
  const open = () => createHubSdk({ client, hubUrl: '/hub/', local: memoryKeyValue(), session, readHash: () => hash, writeHash: (next) => { hash = next; }, assign: () => undefined });

  // nobu queues one row on an expired session and one on a fresh session. The offline
  // drains in between warn by design; keep them out of the test log.
  const originalWarn = console.warn;
  console.warn = () => undefined;
  offline = true;
  for (const [tok, key] of [[foreignExpired, 'exp-old'], [foreignFresh, 'exp-new']] as const) {
    current = tok;
    hash = '#t=n';
    const nobu = open();
    await nobu.init('nobu');
    await assert.rejects(() => nobu.earnTickets(3, 'boss', key), TypeError);
  }
  // HPOS10I queues one row on its own session.
  current = own;
  hash = '#t=h';
  const hpos = open();
  await hpos.init('hpos10i');
  await assert.rejects(() => hpos.earnTickets(3, 'level_end', 'exp-own'), TypeError);
  offline = false;
  console.warn = originalWarn;

  // HPOS10I reloads; its own session has been closed elsewhere.
  ownClosed = true;
  const reload = open();
  const result = await reload.init('hpos10i');
  assert.equal(sent.some((call) => call.key === 'exp-old'), false, 'expired_foreign_row_is_not_sent');
  assert.deepEqual(sent.filter((call) => call.key === 'exp-new').map((call) => call.token), [foreignFresh], 'fresh_foreign_row_is_sent');
  assert.equal(reload.getSession?.(), null, 'the drain ended the dead session');
  assert.equal(result.items, undefined, 'dropped_session_shows_no_items');
  assert.equal(result.gates, undefined, 'dropped_session_shows_no_gates');

  // That player's own next nobu launch still carries the expired row via rebind.
  current = expJwt('user-92', { sid: 'sid-91z', ranked: '0', scope: 'game', game: 'nobu' }, nowSec + 3600);
  hash = '#t=n2';
  await open().init('nobu');
  assert.deepEqual(sent.filter((call) => call.key === 'exp-old').map((call) => call.token), [current]);
  session.removeItem('hub:nobu:session');
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
  for (const [variant, floor] of [['4', 24000], ['6', 30000], ['5', 21000]] as const) {
    assert.equal(await h.sdk.submitScore('nobu_trial_time', floor, { level: variant }), undefined);
    assert.deepEqual((await h.sdk.getLeaderboard?.('nobu_trial_time', { variant }))?.rows, []);
  }
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
    [20000, { level: 9 }, 'bad_variant'],
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
  for (const [variant, floor] of [['1v2', 25700], ['2v2', 26000], ['3v2', 20600]] as const) {
    const posted = await h.sdk.submitScore('nobu_trial_time', floor, { level: variant, layout: 2 });
    assert.deepEqual(posted, { accepted: true, posted: true, value: floor, order: 'asc' });
    assert.equal(h.local.getItem(`hub:score:player-1:nobu_trial_time:${variant}`), String(floor));
    await assert.rejects(() => h.sdk.submitScore('nobu_trial_time', floor - 1, { level: variant }),
      (error: unknown) => error instanceof HubSdkError && error.code === 'implausible_score');
    const page = await h.sdk.getLeaderboard?.('nobu_trial_time', { variant });
    assert.equal(page?.variant, variant); assert.equal(page?.rows[0]?.value, floor);
  }
  const noGrantKeys = ['hub:tickets:nobu', 'hub:verse', 'hub:relics'];
  const economy = noGrantKeys.map(key => h.local.getItem(key));
  for (const [variant, floor] of [['4', 24000], ['6', 30000], ['5', 21000]] as const) {
    assert.deepEqual(await h.sdk.submitScore('nobu_trial_time', floor + 1, { level: variant }), { accepted: true, posted: true, value: floor + 1, order: 'asc' });
    assert.deepEqual(await h.sdk.submitScore('nobu_trial_time', floor, { level: Number(variant) }), { accepted: true, posted: true, value: floor, order: 'asc' });
    assert.equal((await h.sdk.submitScore('nobu_trial_time', 1_800_000, { level: variant }))?.value, floor, 'inclusive ceiling preserves the faster best');
    for (const [value, code] of [[floor - 1, 'implausible_score'], [1_800_001, 'implausible_score'], [floor + .5, 'bad_score']] as const) {
      await assert.rejects(() => h.sdk.submitScore('nobu_trial_time', value, { level: variant }),
        (error: unknown) => error instanceof HubSdkError && error.code === code);
    }
    assert.deepEqual(await h.sdk.submitScore('nobu_trial_time', floor, { level: variant, godMode: true }), { accepted: false, reason: 'god_mode' });
    const page = await h.sdk.getLeaderboard?.('nobu_trial_time', { variant });
    assert.equal(page?.variant, variant); assert.equal(page?.me?.value, floor);
    assert.equal(h.local.getItem(`hub:score:player-1:nobu_trial_time:${variant}`), String(floor));
  }
  assert.deepEqual(noGrantKeys.map(key => h.local.getItem(key)), economy, 'new score variants grant no economy or relics');
  assert.equal(h.local.getItem('hub:score:player-1:nobu_trial_time:1'), '20000', 'Classic best stays separate');
  for (const variant of ['4v2', '5v2', '6v2', 'toString', 'constructor', '__proto__']) {
    await assert.rejects(() => h.sdk.submitScore('nobu_trial_time', 100000, { level: variant }),
      (error: unknown) => error instanceof HubSdkError && error.code === 'bad_variant');
    await assert.rejects(async () => h.sdk.getLeaderboard?.('nobu_trial_time', { variant }),
      (error: unknown) => error instanceof HubSdkError && error.code === 'bad_variant');
  }
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
  for (const [variant, floor] of [['1v2', 25700], ['2v2', 26000], ['3v2', 20600]] as const) {
    await sdk.submitScore('nobu_trial_time', floor, { level: variant, layout: 2 });
    assert.deepEqual(calls.at(-1)?.body, { boardId: 'nobu_trial_time', value: floor, meta: { level: variant, layout: 2 }, godMode: false });
    await sdk.getLeaderboard?.('nobu_trial_time', { variant });
    assert.deepEqual(calls.at(-1)?.body, { boardId: 'nobu_trial_time', variant });
  }
  for (const [variant, floor] of [['4', 24000], ['6', 30000], ['5', 21000]] as const) {
    await sdk.submitScore('nobu_trial_time', floor, { level: variant });
    assert.deepEqual(calls.at(-1)?.body, { boardId: 'nobu_trial_time', value: floor, meta: { level: variant }, godMode: false });
    await sdk.getLeaderboard?.('nobu_trial_time', { variant });
    assert.deepEqual(calls.at(-1)?.body, { boardId: 'nobu_trial_time', variant });
  }
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
