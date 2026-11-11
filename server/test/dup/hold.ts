/**
 * Interim hold (0033). The migration does not create `game.grant_pending`.
 * A row in `game.relic_claim_pending` or `game.item_owned_pending` is status
 * held (PK user + id, no status column). Promote deletes that row and writes
 * one live claim. init() is `profile.get`, which reads live tables only.
 *
 * Held: genesis_shard, pet_honk_sproto,
 * pet_spiral_sproto, pet_moon_sproto, pet_sproto_pup.
 * Live: cones_tip, tinubu_crown, pet_presidential_sproto, pet_mecha_sproto,
 * pet_conehead_sproto, breakwater_coin, hpos10i_core (live again since 0043),
 * marina_anchor, dragon_scale, tidebreaker_belt (live since 0050).
 */
import assert from 'node:assert/strict';
import {
  call,
  compose,
  login,
  mints,
  num,
  outboxSend,
  pendingItems,
  pendingRelics,
  psql,
  psqlAsync,
  relicClaims,
  sqlId,
  ticketBalance,
  verseBalance,
  waitReady,
  type RpcBody,
} from './harness.ts';

type TestFn = (category: string, name: string, fn: () => Promise<void>) => Promise<void>;

const HELD_IDS = [
  'genesis_shard',
  'pet_honk_sproto',
  'pet_spiral_sproto',
  'pet_moon_sproto',
  'pet_sproto_pup',
  'hub_life_medal',
] as const;

const SLUG = /^[a-z0-9_]+$/;
const GAME = /^[a-z0-9-]+$/;
const EVENT = /^[a-z0-9_.]+$/;

interface HeldPair {
  kind: 'relic' | 'item';
  game: string;
  eventId: string;
  id: string;
  data: Record<string, unknown>;
}

interface LivePair {
  game: string;
  eventId: string;
  data: Record<string, unknown>;
  kind: 'relic' | 'item';
  id: string;
}

const LIVE: LivePair[] = [
  { game: 'sproto-fighter', eventId: 'fighter.story_level_complete', data: { world: 1, stage: 'trenches', fighter: 'highsproto' }, kind: 'relic', id: 'tidebreaker_belt' },
  { game: 'nobu', eventId: 'nobu.boss_defeated', data: { boss: 'cone' }, kind: 'relic', id: 'cones_tip' },
  { game: 'sproto', eventId: 'sproto.boss_defeated', data: { boss: 'tinubu', elapsed: 12 }, kind: 'relic', id: 'tinubu_crown' },
  { game: 'sproto', eventId: 'sproto.boss_defeated', data: { boss: 'obama' }, kind: 'item', id: 'pet_presidential_sproto' },
  { game: 'nobu', eventId: 'nobu.boss_defeated', data: { boss: 'bird' }, kind: 'item', id: 'pet_mecha_sproto' },
  { game: 'nobu', eventId: 'nobu.boss_defeated', data: { boss: 'cat' }, kind: 'item', id: 'pet_conehead_sproto' },
  { game: 'sproto-arcade', eventId: 'arcade.boss_defeated', data: { boss: 'bront' }, kind: 'relic', id: 'breakwater_coin' },
  { game: 'hpos10i', eventId: 'hpos10i.level_complete', data: { zone: 'z1_retro_rush_hills', act: 1, time: 12 }, kind: 'relic', id: 'hpos10i_core' },
  { game: 'sproto-coop-battle', eventId: 'coop.stage_clear', data: { stage: 1, godMode: true }, kind: 'relic', id: 'marina_anchor' },
  { game: 'sproto-shooter', eventId: 'shooter.wave_clear', data: { wave: 1, godMode: true }, kind: 'relic', id: 'dragon_scale' },
];

interface PromoteBody {
  ok?: boolean;
  promoted?: boolean;
  reason?: string;
  kind?: string;
  id?: string;
}

function shardBody(key: string, data: Record<string, unknown> = { questId: 'quest_tutorial' }): object {
  return { eventId: 'pb.quest_complete', data, key };
}

function assertNoop(body: RpcBody, detail = JSON.stringify(body)): void {
  assert.equal(body.error, undefined, detail);
  assert.equal(body.granted, undefined, detail);
  assert.deepEqual((body as { granted_items?: unknown }).granted_items ?? [], [], detail);
  assert.equal((body as { tickets?: unknown }).tickets, undefined, detail);
  assert.equal('pending' in body, false, detail);
  assert.equal('held' in body, false, detail);
}

function assertShardHeld(userId: string, body: RpcBody): void {
  assertNoop(body);
  assert.equal(relicClaims(userId, 'genesis_shard'), 0);
  assert.equal(mints(userId, 'genesis_shard'), 0);
  assert.equal(pendingRelics(userId, 'genesis_shard'), 1);
  assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(userId)}' AND game_id = 'peoples-bitcoin'`), 0);
  assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}'`), 0);
  assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(userId)}'`), 0);
  assert.equal(ticketBalance(userId, 'peoples-bitcoin'), 0);
  assert.equal(verseBalance(userId), 0);
  assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`), 0);
}

function heldPairs(): HeldPair[] {
  const raw = psql(`
    SELECT kind, game_id, event_type, id, match::text
    FROM (
      SELECT 'relic' AS kind, game_id, event_type, relic_id AS id, match
      FROM game.event_rule WHERE grant_hold AND relic_id IS NOT NULL
      UNION ALL
      SELECT 'item', game_id, event_type, item_id, match
      FROM game.item_rule WHERE grant_hold
    ) s
    ORDER BY (id = 'genesis_shard') DESC, id
  `);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const [kind, game, eventId, id, ...rest] = line.split('|');
    if (kind !== 'relic' && kind !== 'item') throw new Error(`bad hold kind ${line}`);
    if (!GAME.test(game ?? '') || !EVENT.test(eventId ?? '') || !SLUG.test(id ?? '')) {
      throw new Error(`bad hold row ${line}`);
    }
    return {
      kind,
      game,
      eventId,
      id,
      data: JSON.parse(rest.join('|')) as Record<string, unknown>,
    };
  });
}

async function promote(userId: string, kind: 'relic' | 'item', id: string): Promise<PromoteBody> {
  if (!SLUG.test(id)) throw new Error(`bad id ${id}`);
  const raw = await psqlAsync(
    `SELECT game.promote_pending_grant('${sqlId(userId)}', '${kind}', '${id}')::text`,
  );
  return JSON.parse(raw) as PromoteBody;
}

function seedLiveShard(userId: string, sessionId: string): string {
  const eventId = psql('SELECT gen_random_uuid()');
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error(`bad event id ${eventId}`);
  psql(`
    INSERT INTO game.relic_claim (user_id, relic_id, session_id, event_id)
    VALUES ('${sqlId(userId)}', 'genesis_shard', '${sqlId(sessionId)}', '${eventId}');
    INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
    VALUES ('${eventId}', '${sqlId(userId)}', 'grant_relic', 'genesis_shard', 'peoples-bitcoin', '${sqlId(sessionId)}');
    INSERT INTO game.game_beaten (user_id, game_id, relic_id)
    VALUES ('${sqlId(userId)}', 'peoples-bitcoin', 'genesis_shard')
  `);
  return eventId;
}

export async function runHold(test: TestFn): Promise<void> {
  await test('hold', '0050 lets a third Level 1 clear grant the Belt and preserves existing ownership', async () => {
    const owned = await login('sproto-fighter');
    const waiting = await login('sproto-fighter');
    const shard = await login('peoples-bitcoin');
    const eventId = seedLiveShard(shard.hub.userId, shard.sessionId);
    // Keep an unrelated live claim and an unrelated held claim on separate users.
    const pendingShard = await login('peoples-bitcoin');
    await call('session.event', shardBody('migration-shard'), pendingShard.gameToken);
    const existing = await call('session.event', {
      eventId: 'fighter.story_level_complete', data: { world: 1 }, key: 'migration-owned',
    }, owned.gameToken);
    assert.equal(existing.body.granted, 'tidebreaker_belt');
    const beltEvent = psql(`SELECT event_id::text FROM game.relic_claim
      WHERE user_id = '${sqlId(owned.hub.userId)}' AND relic_id = 'tidebreaker_belt'`);
    try {
      // Restore the pre-0050 state, then let Nakama's real boot run the new migration.
      psql(`UPDATE game.event_rule SET grant_hold = true WHERE relic_id = 'tidebreaker_belt'`);
      for (const key of ['migration-first-win', 'migration-second-win']) {
        const result = await call('session.event', {
          eventId: 'fighter.story_level_complete', data: { world: 1 }, key,
        }, waiting.gameToken);
        assertNoop(result.body);
      }
      assert.equal(pendingRelics(waiting.hub.userId, 'tidebreaker_belt'), 1);
    } finally {
      psql("DELETE FROM game.schema_migrations WHERE id = '0050_fighter_belt_live'");
      compose(['restart', 'nakama']);
      compose(['up', '-d', '--no-recreate', '--no-build', '--wait', '--wait-timeout', '90', 'nakama']);
      await waitReady();
    }
    assert.equal(pendingRelics(waiting.hub.userId, 'tidebreaker_belt'), 0);
    assert.equal(relicClaims(waiting.hub.userId, 'tidebreaker_belt'), 0);
    assert.equal(psql(`SELECT event_id::text FROM game.relic_claim
      WHERE user_id = '${sqlId(owned.hub.userId)}' AND relic_id = 'tidebreaker_belt'`), beltEvent);
    assert.equal(psql(`SELECT event_id::text FROM game.relic_claim
      WHERE user_id = '${sqlId(shard.hub.userId)}' AND relic_id = 'genesis_shard'`), eventId);
    assert.equal(pendingRelics(pendingShard.hub.userId, 'genesis_shard'), 1);
    const granted = await call('session.event', {
      eventId: 'fighter.story_level_complete', data: { world: 1 }, key: 'migration-third-win',
    }, waiting.gameToken);
    assert.equal(granted.body.granted, 'tidebreaker_belt');
    const replay = await call('session.event', {
      eventId: 'fighter.story_level_complete', data: { world: 1 }, key: 'migration-fourth-win',
    }, waiting.gameToken);
    assertNoop(replay.body);
    assert.equal(relicClaims(waiting.hub.userId, 'tidebreaker_belt'), 1);
    assert.equal(mints(waiting.hub.userId, 'tidebreaker_belt'), 1);
  });

  await test('hold', 'new genesis_shard is held with 0 T and 0 V', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    const result = await call('session.event', shardBody('shard-new'), session.gameToken);
    assertShardHeld(user, result.body);
    const profile = await call('profile.get', {}, session.hub.token);
    const relics = (profile.body as { relics?: string[] }).relics ?? [];
    const beaten = (profile.body as { gameBeaten?: string[] }).gameBeaten ?? [];
    assert.equal(relics.includes('genesis_shard'), false, JSON.stringify(profile.body));
    assert.equal(beaten.includes('peoples-bitcoin'), false, JSON.stringify(profile.body));
    assert.equal('pending' in profile.body, false, JSON.stringify(profile.body));
    assert.equal('held' in profile.body, false, JSON.stringify(profile.body));
  });

  await test('hold', 'a live genesis_shard is not revoked or shadowed', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    const eventId = seedLiveShard(user, session.sessionId);
    const result = await call('session.event', shardBody('shard-live'), session.gameToken);
    assertNoop(result.body);
    assert.equal(relicClaims(user, 'genesis_shard'), 1);
    assert.equal(mints(user, 'genesis_shard'), 1);
    assert.equal(pendingRelics(user, 'genesis_shard'), 0);
    assert.equal(
      psql(`SELECT event_id::text FROM game.relic_claim WHERE user_id = '${sqlId(user)}' AND relic_id = 'genesis_shard'`),
      eventId,
    );
    assert.equal(ticketBalance(user, 'peoples-bitcoin'), 0);
    assert.equal(verseBalance(user), 0);
    const profile = await call('profile.get', {}, session.hub.token);
    assert.equal(((profile.body as { relics?: string[] }).relics ?? []).includes('genesis_shard'), true);
  });

  await test('hold', 'NULL shard tickets stay +0 T and do not revoke a live claim', async () => {
    const fresh = await login('peoples-bitcoin');
    const held = await call('session.event', shardBody('shard-null'), fresh.gameToken);
    assertShardHeld(fresh.hub.userId, held.body);
    const owned = await login('peoples-bitcoin');
    seedLiveShard(owned.hub.userId, owned.sessionId);
    const again = await call('session.event', shardBody('shard-null-live'), owned.gameToken);
    assertNoop(again.body);
    assert.equal(ticketBalance(owned.hub.userId, 'peoples-bitcoin'), 0);
    assert.equal(relicClaims(owned.hub.userId, 'genesis_shard'), 1);
    assert.equal(pendingRelics(owned.hub.userId, 'genesis_shard'), 0);
  });

  await test('hold', 'profile.get omits a held shard and pays nothing', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    await call('session.event', shardBody('shard-init'), session.gameToken);
    const profile = await call('profile.get', {}, session.hub.token);
    assert.equal(((profile.body as { relics?: string[] }).relics ?? []).includes('genesis_shard'), false);
    assert.equal(pendingRelics(user, 'genesis_shard'), 1);
    assert.equal(relicClaims(user, 'genesis_shard'), 0);
    assert.equal(ticketBalance(user, 'peoples-bitcoin'), 0);
    assert.equal(verseBalance(user), 0);
    const reread = await call('profile.get', {}, session.hub.token);
    assert.equal(pendingRelics(user, 'genesis_shard'), 1);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(((reread.body as { relics?: string[] }).relics ?? []).join(','), ((profile.body as { relics?: string[] }).relics ?? []).join(','));
  });

  await test('hold', 'replaying a held shard keeps one pending row', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    const first = await call('session.event', shardBody('shard-replay'), session.gameToken);
    const replay = await call('session.event', shardBody('shard-replay'), session.gameToken);
    const again = await call('session.event', shardBody('shard-replay-2'), session.gameToken);
    assertShardHeld(user, first.body);
    assertNoop(replay.body);
    assertNoop(again.body);
    assert.equal(pendingRelics(user, 'genesis_shard'), 1);
    assert.equal(mints(user, 'genesis_shard'), 0);
  });

  await test('hold', 'two tabs hold one genesis_shard row', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    const [a, b] = await Promise.all([
      call('session.event', shardBody('shard-tab-a'), session.gameToken),
      call('session.event', shardBody('shard-tab-b'), session.gameToken),
    ]);
    assertNoop(a.body);
    assertNoop(b.body);
    assert.equal(pendingRelics(user, 'genesis_shard'), 1);
    assert.equal(relicClaims(user, 'genesis_shard'), 0);
    assert.equal(mints(user, 'genesis_shard'), 0);
    assert.equal(ticketBalance(user, 'peoples-bitcoin'), 0);
    assert.equal(verseBalance(user), 0);
  });

  await test('hold', 'a retried held shard pays 0 T and 0 V', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    const result = await outboxSend('session.event', shardBody('shard-retry'), session.gameToken, { loseFirst: true });
    assertShardHeld(user, result.body);
    const retry = await call('session.event', shardBody('shard-retry'), session.gameToken);
    assertNoop(retry.body);
    assert.equal(pendingRelics(user, 'genesis_shard'), 1);
  });

  await test('hold', 'promote_pending_grant moves a shard once', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    await call('session.event', shardBody('shard-promote'), session.gameToken);
    const first = await promote(user, 'relic', 'genesis_shard');
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.promoted, true, JSON.stringify(first));
    assert.equal(relicClaims(user, 'genesis_shard'), 1);
    assert.equal(mints(user, 'genesis_shard'), 1);
    assert.equal(pendingRelics(user, 'genesis_shard'), 0);
    assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = 'genesis_shard'`), 1);
    assert.equal(ticketBalance(user, 'peoples-bitcoin'), 0);
    assert.equal(verseBalance(user), 0);
    const second = await promote(user, 'relic', 'genesis_shard');
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(second.promoted, false, JSON.stringify(second));
    assert.equal(second.reason, 'already_live', JSON.stringify(second));
    assert.equal(relicClaims(user, 'genesis_shard'), 1);
    assert.equal(mints(user, 'genesis_shard'), 1);

    const other = await login('peoples-bitcoin');
    await call('session.event', shardBody('shard-race'), other.gameToken);
    const [left, right] = await Promise.all([
      promote(other.hub.userId, 'relic', 'genesis_shard'),
      promote(other.hub.userId, 'relic', 'genesis_shard'),
    ]);
    const wins = [left, right].filter((row) => row.promoted === true);
    assert.equal(wins.length, 1, JSON.stringify([left, right]));
    assert.equal(relicClaims(other.hub.userId, 'genesis_shard'), 1);
    assert.equal(mints(other.hub.userId, 'genesis_shard'), 1);
    assert.equal(pendingRelics(other.hub.userId, 'genesis_shard'), 0);

    const honk = await login('hpos10i');
    const granted = await call('session.event', {
      eventId: 'hpos10i.level_complete',
      data: { zone: 'z1_retro_rush_hills', act: 2, time: 12 },
      key: 'honk-promote',
    }, honk.gameToken);
    assertNoop(granted.body);
    assert.equal(pendingItems(honk.hub.userId, 'pet_honk_sproto'), 1);
    const moved = await promote(honk.hub.userId, 'item', 'pet_honk_sproto');
    assert.equal(moved.promoted, true, JSON.stringify(moved));
    assert.equal(pendingItems(honk.hub.userId, 'pet_honk_sproto'), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(honk.hub.userId)}' AND item_id = 'pet_honk_sproto'`), 1);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(honk.hub.userId)}' AND item_id = 'pet_honk_sproto' AND op = 'grant_item'`), 1);
    const movedAgain = await promote(honk.hub.userId, 'item', 'pet_honk_sproto');
    assert.equal(movedAgain.promoted, false, JSON.stringify(movedAgain));
    assert.equal(movedAgain.reason, 'already_live');
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(honk.hub.userId)}' AND item_id = 'pet_honk_sproto' AND op = 'grant_item'`), 1);
  });

  await test('hold', 'each grant_hold pair is pending and the live list is not', async () => {
    const pairs = heldPairs();
    const ids = pairs.map((pair) => pair.id).sort();
    assert.deepEqual(ids, [...HELD_IDS].sort(), `SQL hold list ${ids.join(',')}`);
    assert.equal(pairs[0]?.id, 'genesis_shard');
    for (const pair of pairs) {
      const session = await login(pair.game);
      const user = session.hub.userId;
      const result = await call('session.event', {
        eventId: pair.eventId,
        data: pair.data,
        key: `hold-${pair.id}`,
      }, session.gameToken);
      assertNoop(result.body, `${pair.id} ${JSON.stringify(result.body)}`);
      assert.equal(ticketBalance(user, pair.game), 0, pair.id);
      assert.equal(verseBalance(user), 0, pair.id);
      assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}'`), 0, pair.id);
      if (pair.kind === 'relic') {
        assert.equal(pendingRelics(user, pair.id), 1, pair.id);
        assert.equal(relicClaims(user, pair.id), 0, pair.id);
        assert.equal(mints(user, pair.id), 0, pair.id);
        assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = '${pair.id}'`), 0, pair.id);
      } else {
        assert.equal(pendingItems(user, pair.id), 1, pair.id);
        assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}'`), 0, pair.id);
      }
    }
  });

  await test('hold', 'Cone, Tinubu, presidential, mecha, conehead, Breakwater, HPOS10I Core, Anchor, Scale, and Belt stay live', async () => {
    for (const pair of LIVE) {
      const session = await login(pair.game);
      const user = session.hub.userId;
      const beforeTickets = ticketBalance(user, pair.game);
      const result = await call('session.event', {
        eventId: pair.eventId,
        data: pair.data,
        key: `live-${pair.id}`,
      }, session.gameToken);
      const detail = `${pair.id} ${JSON.stringify(result.body)}`;
      assert.equal(result.body.error, undefined, detail);
      assert.equal(pendingRelics(user, pair.kind === 'relic' ? pair.id : 'cones_tip'), 0, detail);
      assert.equal(pendingItems(user, pair.kind === 'item' ? pair.id : 'pet_mecha_sproto'), 0, detail);
      if (pair.kind === 'relic') {
        assert.equal(result.body.granted, pair.id, detail);
        assert.equal(relicClaims(user, pair.id), 1, detail);
        assert.equal(mints(user, pair.id), 1, detail);
        assert.equal(num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = '${pair.id}'`), 1, detail);
      } else {
        assert.deepEqual((result.body as { granted_items?: string[] }).granted_items, [pair.id], detail);
        assert.equal(num(`SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}'`), 1, detail);
        assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}' AND item_id = '${pair.id}' AND op = 'grant_item'`), 1, detail);
      }
      const bossTickets = pair.game === 'sproto' ? 20 : 0;
      assert.equal((result.body as { tickets?: number }).tickets ?? 0, bossTickets, detail);
      assert.equal(ticketBalance(user, pair.game), beforeTickets + bossTickets, detail);
      assert.equal(verseBalance(user), 0, detail);
    }
  });

  await test('hold', 'a forged event outside the hold list mints nothing and writes no pending row', async () => {
    const session = await login('sproto');
    const user = session.hub.userId;
    const tickets = ticketBalance(user, 'sproto');
    const verse = verseBalance(user);
    const result = await call('session.event', {
      eventId: 'sproto.not_a_real_event',
      data: { boss: 'tinubu', relicId: 'genesis_shard', itemId: 'pet_honk_sproto' },
      key: 'forged-outside',
    }, session.gameToken);
    assert.equal(result.body.granted, undefined, JSON.stringify(result.body));
    assert.equal((result.body as { granted_items?: string[] }).granted_items?.length ?? 0, 0, JSON.stringify(result.body));
    assert.equal(num(`SELECT count(*) FROM game.relic_claim_pending WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_owned_pending WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(user)}'`), 0);
    assert.equal(ticketBalance(user, 'sproto'), tickets);
    assert.equal(verseBalance(user), verse);
  });
}
