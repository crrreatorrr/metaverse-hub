/**
 * Open `game_beaten` rules. Pending until migration 0004_drop_open_game_beaten_rules
 * is recorded. After that, a client-posted game_beaten grants nothing. The relic
 * comes from the real trigger: sproto.boss_defeated, hpos10i.level_complete,
 * nobu.boss_defeated, pb.quest_complete. Those same triggers are what the
 * existing Crown and Relic cases already post, on this head and on #12/#13.
 */
import assert from 'node:assert/strict';
import type { GateRunner } from './gated.ts';
import { repeatCount } from './cases.ts';
import {
  call,
  canonical,
  compose,
  login,
  mints,
  num,
  psql,
  relicClaims,
  sqlId,
  waitReady,
} from './harness.ts';

const MIGRATION = '0004_drop_open_game_beaten_rules';
const PENDING = 'waiting for migration 0004_drop_open_game_beaten_rules (client game_beaten grants nothing; real relic triggers remain)';
const SLUG = /^[A-Za-z0-9_.:-]{1,80}$/;

interface Trigger {
  game: string;
  eventId: string;
  data: Record<string, unknown>;
  relicId: string;
}

const TRIGGERS: Trigger[] = [
  {
    game: 'sproto',
    eventId: 'sproto.boss_defeated',
    data: { boss: 'tinubu', elapsed: 12 },
    relicId: 'tinubu_crown',
  },
  {
    game: 'hpos10i',
    eventId: 'hpos10i.level_complete',
    data: { zone: 'z1_retro_rush_hills', act: 1, time: 40.125 },
    relicId: 'hpos10i_core',
  },
  {
    game: 'nobu',
    eventId: 'nobu.boss_defeated',
    data: { boss: 'cone' },
    relicId: 'cones_tip',
  },
  {
    game: 'peoples-bitcoin',
    eventId: 'pb.quest_complete',
    data: { questId: 'quest_tutorial', tick: 3 },
    relicId: 'genesis_shard',
  },
];

function postedNames(): string[] {
  return TRIGGERS.map((trigger) => `client game_beaten on ${trigger.game} grants nothing`);
}

function triggerNames(): string[] {
  return TRIGGERS.map((trigger) => `${trigger.game} relic trigger grants once`);
}

export function openGameBeatenDropped(): boolean {
  if (psql(`SELECT to_regclass('game.schema_migrations') IS NOT NULL`) !== 't') return false;
  return num(`SELECT count(*) FROM game.schema_migrations WHERE id = '${MIGRATION}'`) === 1;
}

function slug(value: string, label: string): string {
  if (!SLUG.test(value)) throw new Error(`${label} is not a slug: ${value}`);
  return value;
}

function economy(userId: string, game: string): string {
  const id = sqlId(userId);
  const gameId = slug(game, 'game');
  return [
    num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${id}'`),
    num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${id}'`),
    num(`SELECT count(*) FROM game.relic_claim WHERE user_id = '${id}'`),
    num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${id}' AND game_id = '${gameId}'`),
  ].join(',');
}

function payloads(relicId: string): Array<{ label: string; data: object }> {
  return [
    { label: 'empty', data: {} },
    { label: 'named', data: { relicId } },
    { label: 'foreign', data: { relicId: 'hpos10i_core', itemId: relicId, amount: 99 } },
    {
      label: 'mixed',
      data: {
        boss: 'tinubu',
        zone: 'z1_retro_rush_hills',
        act: 1,
        questId: 'quest_tutorial',
        time: 40.125,
        elapsed: 12,
        amount: 1,
      },
    },
  ];
}

function gameBeatenRules(): number {
  return num(`SELECT count(*) FROM game.event_rule WHERE event_type = 'game_beaten'`);
}

function beaten(userId: string, game: string): { count: number; relic: string } {
  const id = sqlId(userId);
  const gameId = slug(game, 'game');
  const count = num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${id}' AND game_id = '${gameId}'`);
  const relic = psql(
    `SELECT coalesce((SELECT relic_id FROM game.game_beaten WHERE user_id = '${id}' AND game_id = '${gameId}'), '')`,
  );
  return { count, relic };
}

async function postedGameBeaten(trigger: Trigger): Promise<void> {
  const session = await login(trigger.game);
  const before = economy(session.hub.userId, trigger.game);
  assert.equal(before, '0,0,0,0');
  for (const payload of payloads(trigger.relicId)) {
    const key = `gb-${trigger.game}-${payload.label}`;
    const body = { eventId: 'game_beaten', data: payload.data, key };
    const first = await call('session.event', body, session.gameToken);
    assert.equal(first.body.granted, undefined, `${payload.label} ${JSON.stringify(first.body)}`);
    assert.equal(economy(session.hub.userId, trigger.game), before, payload.label);
    const replay = await call('session.event', body, session.gameToken);
    assert.equal(replay.body.granted, undefined, `${payload.label} replay ${JSON.stringify(replay.body)}`);
    assert.equal(canonical(replay.body), canonical(first.body), payload.label);
    assert.equal(economy(session.hub.userId, trigger.game), before, `${payload.label} replay`);
  }
  assert.equal(mints(session.hub.userId, trigger.relicId), 0);
  assert.equal(relicClaims(session.hub.userId, trigger.relicId), 0);
}

async function realTrigger(trigger: Trigger): Promise<void> {
  assert.equal(
    num(`SELECT count(*) FROM pg_constraint WHERE conrelid = 'game.relic_claim'::regclass AND contype = 'p'`),
    1,
    'game.relic_claim has no primary key',
  );
  const session = await login(trigger.game);
  const width = repeatCount('concurrent');
  const raced = await Promise.all(Array.from({ length: width }, (_, index) => (
    call('session.event', {
      eventId: trigger.eventId,
      data: trigger.data,
      key: `relic-race-${index}`,
    }, session.gameToken)
  )));
  const winners = raced.filter((item) => item.body.granted === trigger.relicId && !item.body.error);
  assert.equal(winners.length, 1, JSON.stringify(raced.map((item) => item.body)));
  assert.equal(relicClaims(session.hub.userId, trigger.relicId), 1);
  assert.equal(mints(session.hub.userId, trigger.relicId), 1);
  const flag = beaten(session.hub.userId, trigger.game);
  assert.equal(flag.count, 1);
  assert.equal(flag.relic, trigger.relicId);
  const winIndex = raced.findIndex((item) => item.body.granted === trigger.relicId);
  const replay = await call('session.event', {
    eventId: trigger.eventId,
    data: trigger.data,
    key: `relic-race-${winIndex}`,
  }, session.gameToken);
  assert.equal(canonical(replay.body), canonical(raced[winIndex]?.body));
  assert.equal(replay.body.granted, trigger.relicId);
  const again = await call('session.event', {
    eventId: trigger.eventId,
    data: trigger.data,
    key: 'relic-after',
  }, session.gameToken);
  assert.equal(again.body.granted, undefined, JSON.stringify(again.body));
  assert.equal(relicClaims(session.hub.userId, trigger.relicId), 1);
  assert.equal(mints(session.hub.userId, trigger.relicId), 1);
  assert.equal(beaten(session.hub.userId, trigger.game).count, 1);
}

export async function runGameBeaten(runner: GateRunner): Promise<void> {
  if (!openGameBeatenDropped()) {
    for (const name of postedNames()) runner.pending('forged', name, PENDING);
    runner.pending('wallet', 'game_beaten event rules stay absent after a second boot', PENDING);
    for (const name of triggerNames()) runner.pending('idempotency', name, PENDING);
    return;
  }
  for (const trigger of TRIGGERS) {
    await runner.test('forged', `client game_beaten on ${trigger.game} grants nothing`, () => postedGameBeaten(trigger));
  }
  await runner.test('wallet', 'game_beaten event rules stay absent after a second boot', async () => {
    assert.equal(gameBeatenRules(), 0);
    const others = num(`SELECT count(*) FROM game.event_rule WHERE event_type <> 'game_beaten'`);
    assert.ok(others > 0, 'event_rule lost the real triggers before the second boot');
    compose(['restart', 'nakama']);
    await waitReady();
    assert.equal(gameBeatenRules(), 0, 'a second boot re-seeded game_beaten event rules');
    assert.equal(
      num(`SELECT count(*) FROM game.event_rule WHERE event_type <> 'game_beaten'`),
      others,
      'a second boot changed the non-game_beaten rules',
    );
    assert.equal(num(`SELECT count(*) FROM game.schema_migrations WHERE id = '${MIGRATION}'`), 1);
  });
  for (const trigger of TRIGGERS) {
    await runner.test('idempotency', `${trigger.game} relic trigger grants once`, () => realTrigger(trigger));
  }
}
