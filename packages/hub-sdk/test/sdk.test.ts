import assert from 'node:assert/strict';
import {
  HubEvent,
  HubSdkError,
  VERSE_DAILY_CAP,
  createHubSdk,
  memoryKeyValue,
  mintMockTicket,
  verifyMockTicket,
  type GameId,
  type HubSdkEnv,
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
    const h = harness('pb');
    const expired = await mintMockTicket({
      game: 'pb',
      playerId: 'player-1',
      now: NOW - 120_000,
      ttlSeconds: 60,
    });
    h.setHash(`#t=${expired}`);
    await assert.rejects(() => h.sdk.init('pb'), (error: unknown) => {
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
    const grant = await h.sdk.reportEvent(HubEvent.GameBeaten, {}, 'beat-1');
    assert.deepEqual(grant, { granted: 'tinubu_crown' });
    const replay = await h.sdk.reportEvent(HubEvent.GameBeaten, {}, 'beat-1');
    assert.deepEqual(replay, { granted: 'tinubu_crown' });
    const second = await h.sdk.reportEvent(HubEvent.SprotoBossDefeated, { boss: 'tinubu', elapsed: 12 }, 'tinubu');
    assert.deepEqual(second, {});
    assert.deepEqual(JSON.parse(h.local.getItem('hub:relics') ?? '[]'), ['tinubu_crown']);
    await assert.rejects(
      () => h.sdk.reportEvent(HubEvent.GameBeaten, { relicId: 'other' }, 'beat-1'),
      (error: unknown) => error instanceof HubSdkError && error.code === 'idempotency_mismatch',
    );
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
    const h = harness('pb');
    h.setHash(`#t=${await ticket('pb')}`);
    await h.sdk.init('pb');
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
    await h.sdk.submitScore('sproto_wins', 1);
    assert.equal(h.local.getItem('hub:score:player-1:sproto_wins'), null);
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
    await h.sdk.submitScore('sproto_wins', 1, { match: 'a' });
    await h.sdk.submitScore('sproto_wins', 1, { match: 'b' });
    assert.equal(h.local.getItem('hub:score:player-1:sproto_wins'), '2');
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

  console.log('hub-sdk tests ok');
}

function TICKETS_FOR_CAP(): number {
  return VERSE_DAILY_CAP * 10;
}

await main();
