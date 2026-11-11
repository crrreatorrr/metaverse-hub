/**
 * PR #65 hub gates, V Coin, and the held Life Medal.
 *
 * SQL names on this branch: game.hub_gate, game.item_owned_pending,
 * game.relic_claim_pending, game.promote_pending_grant. The seeded arcade
 * session key is `vcoin`. The placeholder cabinet game id is `v-cabinet`.
 * checkGate is not an RPC; profile.get and init() are the client surfaces.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  createHubSdk,
  memoryKeyValue,
  type GameId,
  type HubGateView,
  type InitResult,
} from '../../../packages/hub-sdk/src/index.ts';
import {
  SERVER_KEY,
  call,
  canonical,
  guest,
  login,
  num,
  openGame,
  outboxSend,
  psql,
  relicClaims,
  sqlId,
  ticketBalance,
  verseBalance,
  type GameLogin,
  type Guest,
  type RpcBody,
  type RpcResult,
} from './harness.ts';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COMPOSE_FILE = path.join(ROOT, 'server/docker-compose.yml');
const NAKAMA_URL = process.env.NAKAMA_URL ?? 'http://127.0.0.1:7350';
const PASSWORD = 'correct-horse-1';

const HATCHERY = [
  'arc_the_remote',
  'duel_time_spirit_potion',
  'pb_space_goggles',
  'hub_v_coin',
  'hub_life_medal',
  'quantum_cell',
] as const;

const PLACEHOLDER_GAME_ID = 'v-cabinet';

interface Runner {
  test: (category: string, name: string, fn: () => Promise<void>) => Promise<void>;
  pending: (category: string, name: string, reason: string) => void;
}

interface ProfileBody {
  items?: string[];
  gates?: HubGateView[];
  relics?: string[];
  error?: string;
}

interface Purse {
  tickets: number;
  verse: number;
  ticketRows: number;
  verseRows: number;
}

interface DbGate {
  gateId: string;
  actionType: string;
  target: string;
  requireAll: boolean;
  required: string[];
  enabled: boolean;
  hint: string | null;
}

function slug(id: string): string {
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`bad id ${id}`);
  return id;
}

function bucket(id: string): string {
  if (!/^[a-z0-9:_-]+$/.test(id)) throw new Error(`bad bucket ${id}`);
  return id;
}

function sourceText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function jsonRows<T>(sql: string): T {
  const raw = psql(sql);
  return JSON.parse(raw || 'null') as T;
}

function seedOwned(userId: string, itemIds: readonly string[]): void {
  if (!itemIds.length) return;
  const items = itemIds.map((id) => `'${slug(id)}'`).join(', ');
  psql(`DO $seed$
    DECLARE
      v_item text;
      v_id uuid;
    BEGIN
      FOREACH v_item IN ARRAY ARRAY[${items}] LOOP
        v_id := gen_random_uuid();
        INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
        VALUES (v_id, '${sqlId(userId)}'::uuid, 'grant_item', v_item, 'migration', v_id);
        INSERT INTO game.item_owned (user_id, item_id, source, ref_id)
        VALUES ('${sqlId(userId)}'::uuid, v_item, 'migration', v_id);
      END LOOP;
    END
    $seed$;`);
}

function ownedCount(userId: string, itemId: string): number {
  return num(
    `SELECT count(*) FROM game.item_owned WHERE user_id = '${sqlId(userId)}' AND item_id = '${slug(itemId)}'`,
  );
}

function pendingCount(userId: string, itemId: string): number {
  return num(
    `SELECT count(*) FROM game.item_owned_pending WHERE user_id = '${sqlId(userId)}' AND item_id = '${slug(itemId)}'`,
  );
}

function relicPending(userId: string, relicId: string): number {
  return num(
    `SELECT count(*) FROM game.relic_claim_pending WHERE user_id = '${sqlId(userId)}' AND relic_id = '${slug(relicId)}'`,
  );
}

function itemGrants(userId: string, itemId: string): number {
  return num(
    `SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(userId)}' AND item_id = '${slug(itemId)}' AND op = 'grant_item'`,
  );
}

function emailOf(userId: string): string {
  return psql(`SELECT COALESCE(email, '') FROM users WHERE id = '${sqlId(userId)}'`);
}

function ownedIds(userId: string): string[] {
  return jsonRows<string[]>(
    `SELECT COALESCE(array_to_json(game.owned_item_ids('${sqlId(userId)}'::uuid))::text, '[]')`,
  );
}

function dbGates(): DbGate[] {
  return jsonRows<DbGate[]>(`SELECT COALESCE(json_agg(json_build_object(
    'gateId', gate_id,
    'actionType', action_type,
    'target', COALESCE(target, ''),
    'requireAll', require_all,
    'required', COALESCE(to_json(required_item_ids), '[]'::json),
    'enabled', enabled,
    'hint', locked_hint_pool
  ) ORDER BY gate_id), '[]'::json)::text FROM game.hub_gate`);
}

function purse(userId: string, game: string): Purse {
  return {
    tickets: ticketBalance(userId, game),
    verse: verseBalance(userId),
    ticketRows: num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}'`),
    verseRows: num(`SELECT count(*) FROM game.verse_ledger WHERE user_id = '${sqlId(userId)}'`),
  };
}

function economyTotals(): string {
  return [
    'items', num('SELECT count(*) FROM game.item_owned'),
    'ledger', num('SELECT count(*) FROM game.item_ledger'),
    'tickets', num('SELECT count(*) FROM game.tickets_ledger'),
    'verse', num('SELECT count(*) FROM game.verse_ledger'),
    'relics', num('SELECT count(*) FROM game.relic_claim'),
    'itemPending', num('SELECT count(*) FROM game.item_owned_pending'),
    'relicPending', num('SELECT count(*) FROM game.relic_claim_pending'),
  ].join(' ');
}

function windowAmount(userId: string, name: string, when: 'today' | 'yesterday' = 'today'): number {
  const day = when === 'today'
    ? `(now() AT TIME ZONE 'utc')::date`
    : `(now() AT TIME ZONE 'utc')::date - 1`;
  return num(
    `SELECT COALESCE((SELECT amount FROM game.earn_window WHERE user_id = '${sqlId(userId)}' AND bucket = '${bucket(name)}' AND day = ${day}), 0)`,
  );
}

function grantedItems(body: RpcBody): string[] {
  const raw = (body as { granted_items?: unknown }).granted_items;
  if (Array.isArray(raw)) return raw.map((id) => String(id));
  if (typeof raw === 'string') return (JSON.parse(raw) as unknown[]).map((id) => String(id));
  return [];
}

function ticketsOf(body: RpcBody): number | undefined {
  const value = (body as { tickets?: unknown }).tickets;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

const FORBIDDEN_KEYS = new Set([
  'missing',
  'required',
  'requiredItemIds',
  'required_item_ids',
  'requiredItems',
  'missingItems',
]);

function assertNoLeak(value: unknown, where = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoLeak(item, `${where}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assert.equal(FORBIDDEN_KEYS.has(key), false, `client payload has ${where}.${key}`);
    assertNoLeak(child, `${where}.${key}`);
  }
}

function assertGateShape(gates: HubGateView[] | undefined): asserts gates is HubGateView[] {
  assert.ok(Array.isArray(gates), 'client payload has no gates');
  const keys = ['actionType', 'gateId', 'lockedHintPool', 'target', 'unlocked'];
  for (const row of gates) {
    assert.deepEqual(Object.keys(row).sort(), keys, JSON.stringify(row));
    assert.equal(typeof row.unlocked, 'boolean');
  }
}

function resolveTarget(actionType: string, target: string): string | null {
  if (!target || target.includes('://') || target.includes('/') || target.includes('\\')) return null;
  if (actionType === 'portal') return target === 'hatchery' ? 'hatchery' : null;
  if (actionType === 'zone') return target === 'quantum_door' ? target : null;
  if (actionType === 'session') return target === 'vcoin' ? target : null;
  return null;
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id))];
}

function passes(requireAll: boolean, required: string[], owned: Set<string>): boolean {
  const need = unique(required);
  if (!need.length) return false;
  const missing = need.filter((id) => !owned.has(id));
  return requireAll ? missing.length === 0 : missing.length < need.length;
}

function assertMatchesCheck(body: ProfileBody | InitResult, userId: string): void {
  assertNoLeak(body);
  assertGateShape(body.gates);
  const guest = emailOf(userId) === '';
  const owned = ownedIds(userId);
  if (body.items) assert.deepEqual([...body.items].sort(), [...owned].sort());
  const expected = dbGates().filter((row) => row.enabled).map((row) => {
    const target = resolveTarget(row.actionType, row.target);
    return {
      gateId: row.gateId,
      unlocked: !guest && !!target && passes(row.requireAll, row.required, new Set(owned)),
      actionType: row.actionType,
      target,
      lockedHintPool: row.hint,
    };
  });
  assert.deepEqual(body.gates, expected);
}

function gateOf(body: ProfileBody | InitResult, gateId: string): HubGateView {
  const found = body.gates?.find((row) => row.gateId === gateId);
  assert.ok(found, `no ${gateId} in ${JSON.stringify(body.gates)}`);
  return found;
}

async function profileOf(token: string): Promise<ProfileBody> {
  const result = await call('profile.get', {}, token);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.error, undefined, JSON.stringify(result.body));
  return result.body as ProfileBody;
}

async function claimed(): Promise<Guest> {
  const who = await guest();
  const tag = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  const username = `u${tag}`;
  const result = await call('account.claim', {
    username,
    email: `${username}@example.com`,
    password: PASSWORD,
  }, who.token);
  assert.equal((result.body as { claimed?: boolean }).claimed, true, JSON.stringify(result.body));
  assert.notEqual(emailOf(who.userId), '', 'claim did not store an email, so checkGate stays on the guest path');
  return who;
}

async function fire(session: GameLogin, eventId: string, data: object, key = crypto.randomUUID()): Promise<RpcResult> {
  return call('session.event', { eventId, data, key }, session.gameToken);
}

function assertNoPay(result: RpcResult, userId: string, game: string, before: Purse): void {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.error, undefined, JSON.stringify(result.body));
  assert.equal(ticketsOf(result.body), undefined, JSON.stringify(result.body));
  assert.equal((result.body as { verse?: unknown }).verse, undefined, JSON.stringify(result.body));
  const after = purse(userId, game);
  assert.deepEqual(after, before, `${game} pay changed`);
}

async function initOf(token: string, game: GameId): Promise<InitResult> {
  const opened = await call('portal.enter', { game, ranked: false }, token);
  assert.ok(opened.body.ticket, `portal.enter ${game} ${JSON.stringify(opened.body)}`);
  let hash = `#t=${opened.body.ticket}`;
  const session = memoryKeyValue();
  const sdk = createHubSdk({
    serverUrl: NAKAMA_URL,
    serverKey: SERVER_KEY,
    local: memoryKeyValue(),
    session,
    hubUrl: '/hub/',
    now: () => Date.now(),
    readHash: () => hash,
    writeHash: (next: string) => {
      hash = next;
    },
    assign: () => undefined,
    releasePointer: () => undefined,
    clearBeforeUnload: () => undefined,
  });
  const first = await sdk.init(game);
  hash = '';
  const second = await sdk.init(game);
  assert.deepEqual(second.gates, first.gates, 'a second init changed gates');
  assert.deepEqual(second.items, first.items, 'a second init changed items');
  return second;
}

function promote(userId: string, id: string): string {
  return psql(`SELECT game.promote_pending_grant('${sqlId(userId)}'::uuid, 'item', '${slug(id)}')::text`);
}

async function promoteAsync(userId: string, id: string): Promise<string> {
  const { stdout } = await execFileAsync('docker', [
    'compose', '-f', COMPOSE_FILE, 'exec', '-T', 'postgres',
    'psql', '-U', 'postgres', '-d', 'nakama',
    '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A',
    '-c', `SELECT game.promote_pending_grant('${sqlId(userId)}'::uuid, 'item', '${slug(id)}')::text`,
  ], { cwd: ROOT });
  return stdout.trim();
}

async function wayOut(session: GameLogin, key = crypto.randomUUID()): Promise<RpcResult> {
  return fire(session, 'pb.quest_complete', { questId: 'quest_way_out' }, key);
}

export async function runHubGate(runner: Runner): Promise<void> {
  await runner.test('hub-gate', 'seeds the three gates and never hub_arcade_v_cabinet', async () => {
    const ids = jsonRows<string[]>(`SELECT COALESCE(json_agg(id ORDER BY id), '[]'::json)::text FROM game.schema_migrations`);
    for (const id of ['0031_story_boss_tickets', '0033_hold_client_relic_grants', '0034_hub_gate', '0035_hub_v_coin', '0037_hub_life_medal']) {
      assert.ok(ids.includes(id), `schema_migrations missing ${id}`);
    }
    assert.equal(ids.some((id) => id.startsWith('0036')), false, `0036 was applied: ${ids.filter((id) => id.startsWith('0036')).join(',')}`);
    const gates = dbGates();
    assert.deepEqual(gates.map((row) => row.gateId), ['hub_arcade_vcoin_game', 'hub_hatchery', 'hub_quantum_door']);
    const arcade = gates.find((row) => row.gateId === 'hub_arcade_vcoin_game');
    const hatch = gates.find((row) => row.gateId === 'hub_hatchery');
    const door = gates.find((row) => row.gateId === 'hub_quantum_door');
    assert.deepEqual(arcade, {
      gateId: 'hub_arcade_vcoin_game',
      actionType: 'session',
      target: 'vcoin',
      requireAll: true,
      required: ['hub_v_coin'],
      enabled: true,
      hint: null,
    });
    assert.equal(hatch?.actionType, 'portal');
    assert.equal(hatch?.target, 'hatchery');
    assert.equal(hatch?.requireAll, true);
    assert.deepEqual(hatch?.required, [...HATCHERY]);
    assert.deepEqual(door?.required, ['quantum_cell']);
    assert.equal(door?.actionType, 'zone');
    assert.equal(door?.target, 'quantum_door');
    assert.equal(psql(`SELECT count(*) FROM game.hub_gate WHERE gate_id = 'hub_arcade_v_cabinet'`), '0');
    assert.equal(
      psql(`SELECT COALESCE(grant_hold, false) FROM game.item_rule WHERE item_id = 'hub_v_coin'`),
      'f',
    );
    assert.equal(
      psql(`SELECT grant_hold::text || '|' || COALESCE(match->>'boss', '') FROM game.item_rule WHERE item_id = 'hub_life_medal'`),
      'true|deathbot',
    );
  });

  await runner.test('hub-gate', 'profile.get and init() expose unlocked bools and no required items', async () => {
    const who = await claimed();
    seedOwned(who.userId, HATCHERY.filter((id) => id !== 'quantum_cell'));
    const body = await profileOf(who.token);
    assertMatchesCheck(body, who.userId);
    assert.equal(gateOf(body, 'hub_hatchery').unlocked, false);
    assert.equal(gateOf(body, 'hub_quantum_door').unlocked, false);
    assert.equal(gateOf(body, 'hub_arcade_vcoin_game').unlocked, true);
    assert.equal(JSON.stringify(body).includes(PLACEHOLDER_GAME_ID), false);
    const init = await initOf(who.token, 'hpos10i');
    assertMatchesCheck(init, who.userId);
    assert.deepEqual(init.gates, body.gates);
    assert.deepEqual(init.items, body.items);
    assert.equal(init.items?.includes('hub_life_medal'), true);
    assert.equal(init.items?.includes('quantum_cell'), false);
  });

  await runner.test('hub-gate', 'a guest with all six items stays locked', async () => {
    const who = await guest();
    assert.equal(emailOf(who.userId), '');
    seedOwned(who.userId, [...HATCHERY]);
    const body = await profileOf(who.token);
    assertMatchesCheck(body, who.userId);
    assert.ok(body.gates?.every((row) => row.unlocked === false), JSON.stringify(body.gates));
    assert.ok(HATCHERY.every((id) => body.items?.includes(id)));
    const init = await initOf(who.token, 'sproto');
    assert.ok(init.gates?.every((row) => row.unlocked === false), JSON.stringify(init.gates));
    assertNoLeak(init);
  });

  await runner.test('hub-gate', 'starters alone do not open a gate', async () => {
    const who = await claimed();
    const body = await profileOf(who.token);
    assertMatchesCheck(body, who.userId);
    assert.deepEqual(body.items, ['duel_staff_sproto']);
    assert.ok(body.gates?.every((row) => row.unlocked === false), JSON.stringify(body.gates));
    assert.equal(body.gates?.some((row) => row.gateId === 'hub_arcade_v_cabinet'), false);
  });

  await runner.test('hub-gate', 'each five-of-six hatchery set stays closed', async () => {
    const problems: string[] = [];
    for (const omit of HATCHERY) {
      try {
        const who = await claimed();
        seedOwned(who.userId, HATCHERY.filter((id) => id !== omit));
        const body = await profileOf(who.token);
        assertMatchesCheck(body, who.userId);
        assert.equal(gateOf(body, 'hub_hatchery').unlocked, false, omit);
        assert.equal(gateOf(body, 'hub_arcade_vcoin_game').unlocked, omit !== 'hub_v_coin', omit);
        assert.equal(gateOf(body, 'hub_quantum_door').unlocked, omit !== 'quantum_cell', omit);
        assert.equal(body.items?.includes(omit), false, omit);
        assert.equal(ownedIds(who.userId).includes(omit), false, omit);
      } catch (error) {
        problems.push(`${omit}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    assert.equal(problems.length, 0, problems.join('\n'));
  });

  await runner.test('hub-gate', 'all six owned items open hatchery, the arcade, and the quantum door', async () => {
    const who = await claimed();
    seedOwned(who.userId, [...HATCHERY]);
    const body = await profileOf(who.token);
    assertMatchesCheck(body, who.userId);
    assert.equal(gateOf(body, 'hub_hatchery').unlocked, true);
    assert.equal(gateOf(body, 'hub_arcade_vcoin_game').unlocked, true);
    assert.equal(gateOf(body, 'hub_quantum_door').unlocked, true);
    const init = await initOf(who.token, 'peoples-bitcoin');
    assert.deepEqual(init.gates, body.gates);
    assert.equal(init.gates?.every((row) => row.unlocked === true), true, JSON.stringify(init.gates));
  });

  await runner.test('hub-gate', 'require_all false opens with one of two items', async () => {
    const who = await claimed();
    seedOwned(who.userId, ['qa_alpha']);
    psql(`DELETE FROM game.hub_gate WHERE gate_id = 'qa_any_one'`);
    try {
      psql(`INSERT INTO game.hub_gate (gate_id, action_type, target, required_item_ids, require_all, enabled)
        VALUES ('qa_any_one', 'session', 'vcoin', ARRAY['qa_alpha', 'qa_beta'], false, true)`);
      const open = await profileOf(who.token);
      assertMatchesCheck(open, who.userId);
      assert.equal(gateOf(open, 'qa_any_one').unlocked, true);
      psql(`DELETE FROM game.item_owned WHERE user_id = '${sqlId(who.userId)}' AND item_id = 'qa_alpha'`);
      const shut = await profileOf(who.token);
      assertMatchesCheck(shut, who.userId);
      assert.equal(gateOf(shut, 'qa_any_one').unlocked, false);
    } finally {
      psql(`DELETE FROM game.hub_gate WHERE gate_id = 'qa_any_one'`);
    }
  });

  await runner.test('hub-gate', 'a disabled gate is omitted and does not unlock', async () => {
    const who = await claimed();
    seedOwned(who.userId, [...HATCHERY]);
    try {
      psql(`UPDATE game.hub_gate SET enabled = false WHERE gate_id = 'hub_hatchery'`);
      const body = await profileOf(who.token);
      assertMatchesCheck(body, who.userId);
      assert.equal(body.gates?.some((row) => row.gateId === 'hub_hatchery'), false, JSON.stringify(body.gates));
      assert.equal(gateOf(body, 'hub_arcade_vcoin_game').unlocked, true);
    } finally {
      psql(`UPDATE game.hub_gate SET enabled = true WHERE gate_id = 'hub_hatchery'`);
    }
  });

  await runner.test('hub-gate', 'gate checks write no economy, item, or pending rows', async () => {
    const who = await claimed();
    seedOwned(who.userId, ['hub_v_coin']);
    const before = economyTotals();
    const mine = purse(who.userId, 'sproto');
    await profileOf(who.token);
    await Promise.all([profileOf(who.token), profileOf(who.token)]);
    assert.equal(economyTotals(), before);
    assert.deepEqual(purse(who.userId, 'sproto'), mine);
    assert.equal(ownedCount(who.userId, 'hub_v_coin'), 1);
    assert.equal(pendingCount(who.userId, 'hub_v_coin'), 0);
  });

  await runner.test('hub-gate', 'a forged portal target is refused and writes nothing', async () => {
    const who = await guest();
    const before = economyTotals();
    for (const game of ['hatchery', 'https://evil.example/hatchery', 'hatchery/../hub', 'quantum_door']) {
      const result = await call('portal.enter', { game, ranked: false }, who.token);
      assert.equal(result.body.ticket, undefined, `${game} ${JSON.stringify(result.body)}`);
      assert.equal(result.body.error, 'bad_game', `${game} ${JSON.stringify(result.body)}`);
    }
    assert.equal(economyTotals(), before);
  });

  await runner.test('hub-gate', 'vcoin session start without hub_v_coin is GATE_LOCKED', async () => {
    const who = await claimed();
    const body = await profileOf(who.token);
    assert.equal(gateOf(body, 'hub_arcade_vcoin_game').unlocked, false);
    const before = purse(who.userId, 'vcoin');
    const started = await call('portal.enter', { game: 'vcoin', ranked: false }, who.token);
    assert.equal(
      started.body.error,
      'GATE_LOCKED',
      `repro: claimed account with no hub_v_coin calls portal.enter {game:'vcoin'}. Expected GATE_LOCKED and no ticket. Got ${started.status} ${JSON.stringify(started.body)}`,
    );
    assert.equal(started.body.ticket, undefined);
    assert.deepEqual(purse(who.userId, 'vcoin'), before);
  });

  await runner.test('hub-gate', 'vcoin session start with hub_v_coin opens and debits nothing', async () => {
    const who = await claimed();
    seedOwned(who.userId, ['hub_v_coin']);
    const body = await profileOf(who.token);
    assert.equal(gateOf(body, 'hub_arcade_vcoin_game').unlocked, true);
    const before = purse(who.userId, 'vcoin');
    const started = await call('portal.enter', { game: 'vcoin', ranked: false }, who.token);
    assert.equal(
      started.body.error,
      undefined,
      `repro: claimed account owning hub_v_coin calls portal.enter {game:'vcoin'}. Expected a ticket and 0 T/0 V. Got ${started.status} ${JSON.stringify(started.body)}`,
    );
    assert.equal(typeof started.body.ticket, 'string');
    assert.deepEqual(purse(who.userId, 'vcoin'), before);
    assert.equal(ownedCount(who.userId, 'hub_v_coin'), 1);
    assert.equal(verseBalance(who.userId), 0);
  });

  const joinWired = sourceText('server/modules/src/hub_rpcs.ts').includes('HubGate.checkGate(');
  const matchWired = sourceText('server/modules/src/hub_match.ts').includes('HubGate.checkGate(');
  if (!joinWired || !matchWired) {
    runner.pending(
      'hub-gate',
      'direct hub.join and matchJoinAttempt refuse a locked gate',
      'checkGate is not called from hub.join or matchJoinAttempt yet (build-order B2). This PR returns unlocked bools from profile.get only.',
    );
  }

  await runner.test('v-coin', 'quest_way_out with goggles grants hub_v_coin once for 0 T and 0 V', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    seedOwned(user, ['pb_space_goggles']);
    const before = purse(user, 'peoples-bitcoin');
    const first = await wayOut(session);
    assertNoPay(first, user, 'peoples-bitcoin', before);
    assert.deepEqual(grantedItems(first.body), ['hub_v_coin'], JSON.stringify(first.body));
    assert.equal(first.body.granted, undefined, JSON.stringify(first.body));
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    assert.equal(pendingCount(user, 'hub_v_coin'), 0);
    assert.equal(relicClaims(user, 'hub_v_coin'), 0);
    assert.equal(relicPending(user, 'hub_v_coin'), 0);
    assert.equal(itemGrants(user, 'hub_v_coin'), 1);
    assert.equal(
      psql(`SELECT source FROM game.item_owned WHERE user_id = '${sqlId(user)}' AND item_id = 'hub_v_coin'`),
      'event',
    );
    const again = await wayOut(session);
    assertNoPay(again, user, 'peoples-bitcoin', before);
    assert.deepEqual(grantedItems(again.body), [], JSON.stringify(again.body));
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    assert.equal(itemGrants(user, 'hub_v_coin'), 1);
  });

  await runner.test('v-coin', 'way out without goggles grants nothing and the old event does not retro-grant', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    const before = purse(user, 'peoples-bitcoin');
    const key = crypto.randomUUID();
    const early = await wayOut(session, key);
    assertNoPay(early, user, 'peoples-bitcoin', before);
    assert.deepEqual(grantedItems(early.body), [], JSON.stringify(early.body));
    assert.equal(ownedCount(user, 'hub_v_coin'), 0);
    assert.equal(pendingCount(user, 'hub_v_coin'), 0);
    assert.equal(itemGrants(user, 'hub_v_coin'), 0);
    seedOwned(user, ['pb_space_goggles']);
    const replay = await wayOut(session, key);
    assert.equal(canonical(replay.body), canonical(early.body), 'replaying the pre-goggles event changed the stored response');
    assert.equal(ownedCount(user, 'hub_v_coin'), 0, 'the old event retro-granted hub_v_coin after the goggles arrived');
    assert.equal(itemGrants(user, 'hub_v_coin'), 0);
    const later = await wayOut(session);
    assertNoPay(later, user, 'peoples-bitcoin', before);
    assert.deepEqual(grantedItems(later.body), ['hub_v_coin'], JSON.stringify(later.body));
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    assert.equal(itemGrants(user, 'hub_v_coin'), 1);
  });

  await runner.test('v-coin', 'a replayed way-out event keeps one hub_v_coin', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    seedOwned(user, ['pb_space_goggles']);
    const key = crypto.randomUUID();
    const first = await wayOut(session, key);
    const replay = await wayOut(session, key);
    assert.equal(canonical(replay.body), canonical(first.body));
    assert.deepEqual(grantedItems(replay.body), ['hub_v_coin']);
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    assert.equal(itemGrants(user, 'hub_v_coin'), 1);
    assert.equal(pendingCount(user, 'hub_v_coin'), 0);
    assert.deepEqual(purse(user, 'peoples-bitcoin'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('v-coin', 'two tabs completing way out leave one hub_v_coin', async () => {
    // open_portal closes every other open session, so two tabs are two keys on the one live session.
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    seedOwned(user, ['pb_space_goggles']);
    const [left, right] = await Promise.all([wayOut(session), wayOut(session)]);
    assert.equal(left.status, 200, JSON.stringify(left.body));
    assert.equal(right.status, 200, JSON.stringify(right.body));
    assert.equal(left.body.error, undefined, JSON.stringify(left.body));
    assert.equal(right.body.error, undefined, JSON.stringify(right.body));
    const grants = [left, right].filter((result) => grantedItems(result.body).includes('hub_v_coin'));
    assert.equal(grants.length, 1, JSON.stringify([left.body, right.body]));
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    assert.equal(itemGrants(user, 'hub_v_coin'), 1);
    assert.equal(pendingCount(user, 'hub_v_coin'), 0);
    assert.deepEqual(purse(user, 'peoples-bitcoin'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('v-coin', 'a retried way-out grant keeps one hub_v_coin', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    seedOwned(user, ['pb_space_goggles']);
    const key = crypto.randomUUID();
    const retried = await outboxSend(
      'session.event',
      { eventId: 'pb.quest_complete', data: { questId: 'quest_way_out' }, key },
      session.gameToken,
      { loseFirst: true },
    );
    assert.deepEqual(grantedItems(retried.body), ['hub_v_coin'], JSON.stringify(retried.body));
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    assert.equal(itemGrants(user, 'hub_v_coin'), 1);
    assert.equal(pendingCount(user, 'hub_v_coin'), 0);
    assert.deepEqual(purse(user, 'peoples-bitcoin'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('v-coin', 'a forged source or game grants no hub_v_coin', async () => {
    const pb = await login('peoples-bitcoin');
    seedOwned(pb.hub.userId, ['pb_space_goggles']);
    const otherQuest = await fire(pb, 'pb.quest_complete', { questId: 'quest_not_way_out', source: 'admin' });
    assert.deepEqual(grantedItems(otherQuest.body), [], JSON.stringify(otherQuest.body));
    const named = await fire(pb, 'hub.claim_v_coin', { questId: 'quest_way_out', itemId: 'hub_v_coin' });
    assert.equal(ownedCount(pb.hub.userId, 'hub_v_coin'), 0, JSON.stringify(named.body));
    const claim = await call('hub.claim_v_coin', { itemId: 'hub_v_coin' }, pb.hub.token);
    assert.equal(ownedCount(pb.hub.userId, 'hub_v_coin'), 0, JSON.stringify(claim.body));
    assert.equal(itemGrants(pb.hub.userId, 'hub_v_coin'), 0);

    const sproto = await login('sproto');
    seedOwned(sproto.hub.userId, ['pb_space_goggles']);
    const crossed = await fire(sproto, 'pb.quest_complete', { questId: 'quest_way_out' });
    assert.equal(crossed.body.error, undefined, JSON.stringify(crossed.body));
    assert.equal(ownedCount(sproto.hub.userId, 'hub_v_coin'), 0, JSON.stringify(crossed.body));
    assert.equal(pendingCount(sproto.hub.userId, 'hub_v_coin'), 0);
    assert.deepEqual(purse(sproto.hub.userId, 'sproto'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('v-coin', 'selling or exchanging does not consume hub_v_coin', async () => {
    const session = await login('peoples-bitcoin');
    const user = session.hub.userId;
    seedOwned(user, ['pb_space_goggles']);
    await wayOut(session);
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    const sell = await call('tickets.sell', {
      game: 'peoples-bitcoin',
      shop_id: 'pb',
      item_id: 'hub_v_coin',
      packs: 1,
      key: crypto.randomUUID(),
    }, session.gameToken);
    assert.ok(sell.body.error, `selling hub_v_coin was accepted: ${JSON.stringify(sell.body)}`);
    const traded = await call('tickets.exchange', { tickets: 10, key: crypto.randomUUID() }, session.gameToken);
    assert.ok(traded.body.error, `exchange moved a zero balance: ${JSON.stringify(traded.body)}`);
    assert.equal(ownedCount(user, 'hub_v_coin'), 1);
    assert.equal(itemGrants(user, 'hub_v_coin'), 1);
    assert.deepEqual(purse(user, 'peoples-bitcoin'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('v-coin', 'removing hub_v_coin locks the arcade again and leaves relics', async () => {
    const who = await claimed();
    const pb = await openGame(who.token, 'peoples-bitcoin');
    seedOwned(who.userId, ['pb_space_goggles']);
    await wayOut(pb);
    const duel = await openGame(who.token, 'sproto');
    const crown = await fire(duel, 'sproto.boss_defeated', { boss: 'tinubu', elapsed: 12 });
    assert.equal(crown.body.granted, 'tinubu_crown', JSON.stringify(crown.body));
    const open = await profileOf(who.token);
    assert.equal(gateOf(open, 'hub_arcade_vcoin_game').unlocked, true);
    psql(`DELETE FROM game.item_owned WHERE user_id = '${sqlId(who.userId)}' AND item_id = 'hub_v_coin'`);
    const shut = await profileOf(who.token);
    assertMatchesCheck(shut, who.userId);
    assert.equal(gateOf(shut, 'hub_arcade_vcoin_game').unlocked, false);
    assert.equal(shut.items?.includes('hub_v_coin'), false);
    assert.equal(relicClaims(who.userId, 'tinubu_crown'), 1);
    const init = await initOf(who.token, 'sproto');
    assert.equal(gateOf(init, 'hub_arcade_vcoin_game').unlocked, false);
    assert.equal(init.relics?.includes('tinubu_crown'), true, JSON.stringify(init.relics));
  });

  await runner.test('v-coin', 'deathbot does not grant hub_v_coin', async () => {
    const session = await login('hpos10i');
    seedOwned(session.hub.userId, ['pb_space_goggles']);
    const before = purse(session.hub.userId, 'hpos10i');
    const result = await fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' });
    assertNoPay(result, session.hub.userId, 'hpos10i', before);
    assert.equal(grantedItems(result.body).includes('hub_v_coin'), false, JSON.stringify(result.body));
    assert.equal(ownedCount(session.hub.userId, 'hub_v_coin'), 0);
    assert.equal(pendingCount(session.hub.userId, 'hub_v_coin'), 0);
  });

  await runner.test('hub-gate', 'deathbot lands only in item_owned_pending and does not open the hatchery', async () => {
    const who = await claimed();
    seedOwned(who.userId, HATCHERY.filter((id) => id !== 'hub_life_medal'));
    const session = await openGame(who.token, 'hpos10i');
    const before = purse(who.userId, 'hpos10i');
    const result = await fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' });
    assertNoPay(result, who.userId, 'hpos10i', before);
    assert.deepEqual(grantedItems(result.body), [], JSON.stringify(result.body));
    assert.equal(result.body.granted, undefined, JSON.stringify(result.body));
    assert.equal(ownedCount(who.userId, 'hub_life_medal'), 0);
    assert.equal(pendingCount(who.userId, 'hub_life_medal'), 1);
    assert.equal(itemGrants(who.userId, 'hub_life_medal'), 0);
    assert.equal(
      psql(`SELECT game_id || '|' || event_type || '|' || COALESCE(data->>'boss', '') FROM game.item_owned_pending WHERE user_id = '${sqlId(who.userId)}' AND item_id = 'hub_life_medal'`),
      'hpos10i|hpos10i.boss_defeated|deathbot',
    );
    const body = await profileOf(who.token);
    assert.equal(body.items?.includes('hub_life_medal'), false, JSON.stringify(body.items));
    assert.equal(ownedIds(who.userId).includes('hub_life_medal'), false);
    assert.equal(gateOf(body, 'hub_hatchery').unlocked, false);
    const init = await initOf(who.token, 'hpos10i');
    assert.equal(init.items?.includes('hub_life_medal'), false, JSON.stringify(init.items));
    assert.equal(gateOf(init, 'hub_hatchery').unlocked, false);
    assertNoLeak(init);
  });

  await runner.test('hub-gate', 'any boss other than deathbot creates no life medal row', async () => {
    const session = await login('hpos10i');
    const user = session.hub.userId;
    const before = purse(user, 'hpos10i');
    for (const boss of ['captain', 'tinubu', 'midget', '']) {
      const result = await fire(session, 'hpos10i.boss_defeated', { boss });
      assertNoPay(result, user, 'hpos10i', before);
      assert.deepEqual(grantedItems(result.body), [], `${boss} ${JSON.stringify(result.body)}`);
    }
    assert.equal(pendingCount(user, 'hub_life_medal'), 0);
    assert.equal(ownedCount(user, 'hub_life_medal'), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_owned_pending WHERE user_id = '${sqlId(user)}'`), 0);
  });

  await runner.test('hub-gate', 'replaying deathbot keeps one pending life medal', async () => {
    const session = await login('hpos10i');
    const user = session.hub.userId;
    const key = crypto.randomUUID();
    const first = await fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' }, key);
    const replay = await fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' }, key);
    assert.equal(canonical(replay.body), canonical(first.body));
    assert.equal(pendingCount(user, 'hub_life_medal'), 1);
    assert.equal(ownedCount(user, 'hub_life_medal'), 0);
    assert.equal(itemGrants(user, 'hub_life_medal'), 0);
    assert.deepEqual(purse(user, 'hpos10i'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('hub-gate', 'two tabs defeating deathbot leave one pending life medal', async () => {
    const session = await login('hpos10i');
    const user = session.hub.userId;
    const [left, right] = await Promise.all([
      fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' }),
      fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' }),
    ]);
    assert.equal(left.body.error, undefined, JSON.stringify(left.body));
    assert.equal(right.body.error, undefined, JSON.stringify(right.body));
    assert.equal(pendingCount(user, 'hub_life_medal'), 1);
    assert.equal(ownedCount(user, 'hub_life_medal'), 0);
    assert.equal(itemGrants(user, 'hub_life_medal'), 0);
    assert.deepEqual(purse(user, 'hpos10i'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('hub-gate', 'promote_pending_grant moves the life medal once and then the hatchery opens', async () => {
    const who = await claimed();
    seedOwned(who.userId, HATCHERY.filter((id) => id !== 'hub_life_medal'));
    const session = await openGame(who.token, 'hpos10i');
    await fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' });
    assert.equal(gateOf(await profileOf(who.token), 'hub_hatchery').unlocked, false);
    const moved = JSON.parse(promote(who.userId, 'hub_life_medal')) as { ok?: boolean; promoted?: boolean };
    assert.equal(moved.ok, true, JSON.stringify(moved));
    assert.equal(moved.promoted, true, JSON.stringify(moved));
    assert.equal(ownedCount(who.userId, 'hub_life_medal'), 1);
    assert.equal(pendingCount(who.userId, 'hub_life_medal'), 0);
    assert.equal(itemGrants(who.userId, 'hub_life_medal'), 1);
    const again = JSON.parse(promote(who.userId, 'hub_life_medal')) as { ok?: boolean; promoted?: boolean; reason?: string };
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(again.promoted, false, JSON.stringify(again));
    assert.equal(again.reason, 'already_live', JSON.stringify(again));
    assert.equal(ownedCount(who.userId, 'hub_life_medal'), 1);
    assert.equal(itemGrants(who.userId, 'hub_life_medal'), 1);
    const body = await profileOf(who.token);
    assertMatchesCheck(body, who.userId);
    assert.equal(gateOf(body, 'hub_hatchery').unlocked, true);
    assert.equal(body.items?.includes('hub_life_medal'), true);
    const init = await initOf(who.token, 'hpos10i');
    assert.equal(gateOf(init, 'hub_hatchery').unlocked, true);
    assert.equal(init.items?.includes('hub_life_medal'), true);
    assert.deepEqual(purse(who.userId, 'hpos10i'), { tickets: 0, verse: 0, ticketRows: 0, verseRows: 0 });
  });

  await runner.test('hub-gate', 'a concurrent double promote moves the life medal once', async () => {
    const who = await claimed();
    seedOwned(who.userId, HATCHERY.filter((id) => id !== 'hub_life_medal'));
    const session = await openGame(who.token, 'hpos10i');
    await fire(session, 'hpos10i.boss_defeated', { boss: 'deathbot' });
    const [left, right] = await Promise.all([
      promoteAsync(who.userId, 'hub_life_medal'),
      promoteAsync(who.userId, 'hub_life_medal'),
    ]);
    const parsed = [left, right].map((raw) => JSON.parse(raw) as { ok?: boolean; promoted?: boolean; reason?: string });
    assert.equal(parsed.filter((row) => row.promoted === true).length, 1, JSON.stringify(parsed));
    assert.equal(ownedCount(who.userId, 'hub_life_medal'), 1, JSON.stringify(parsed));
    assert.equal(pendingCount(who.userId, 'hub_life_medal'), 0, JSON.stringify(parsed));
    assert.equal(itemGrants(who.userId, 'hub_life_medal'), 1, JSON.stringify(parsed));
    const body = await profileOf(who.token);
    assert.equal(gateOf(body, 'hub_hatchery').unlocked, true, JSON.stringify(body.gates));
    assert.equal(body.items?.includes('hub_life_medal'), true);
  });

  await runner.test('regress', 'tinubu pays 20 T once per UTC day and claim_event_relic fires once', async () => {
    const session = await login('sproto');
    const user = session.hub.userId;
    const key = crypto.randomUUID();
    const first = await fire(session, 'sproto.boss_defeated', { boss: 'tinubu', elapsed: 12 }, key);
    assert.equal(first.body.error, undefined, JSON.stringify(first.body));
    assert.equal(first.body.granted, 'tinubu_crown', JSON.stringify(first.body));
    assert.equal(ticketsOf(first.body), 20, JSON.stringify(first.body));
    assert.equal(ticketBalance(user, 'sproto'), 20);
    assert.equal(verseBalance(user), 0);
    assert.equal(relicClaims(user, 'tinubu_crown'), 1);
    assert.equal(relicPending(user, 'tinubu_crown'), 0);
    assert.equal(windowAmount(user, 'boss:sproto:tinubu'), 1);
    assert.equal(
      num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = 'tinubu_crown'`),
      1,
    );
    const replay = await fire(session, 'sproto.boss_defeated', { boss: 'tinubu', elapsed: 12 }, key);
    assert.equal(canonical(replay.body), canonical(first.body));
    assert.equal(ticketBalance(user, 'sproto'), 20);
    const second = await fire(session, 'sproto.boss_defeated', { boss: 'tinubu', elapsed: 4 });
    assert.equal(second.body.error, undefined, JSON.stringify(second.body));
    assert.equal(second.body.granted, undefined, JSON.stringify(second.body));
    assert.equal(ticketsOf(second.body), undefined, JSON.stringify(second.body));
    assert.equal(ticketBalance(user, 'sproto'), 20);
    assert.equal(relicClaims(user, 'tinubu_crown'), 1);
    assert.equal(windowAmount(user, 'boss:sproto:tinubu'), 1);
    psql(`UPDATE game.earn_window SET day = day - 1 WHERE user_id = '${sqlId(user)}' AND bucket = 'boss:sproto:tinubu' AND day = (now() AT TIME ZONE 'utc')::date`);
    assert.equal(windowAmount(user, 'boss:sproto:tinubu', 'yesterday'), 1);
    const nextDay = await fire(session, 'sproto.boss_defeated', { boss: 'tinubu', elapsed: 8 });
    assert.equal(ticketsOf(nextDay.body), 20, JSON.stringify(nextDay.body));
    assert.equal(nextDay.body.granted, undefined, JSON.stringify(nextDay.body));
    assert.equal(ticketBalance(user, 'sproto'), 40);
    assert.equal(relicClaims(user, 'tinubu_crown'), 1);
    assert.equal(windowAmount(user, 'boss:sproto:tinubu'), 1);
    assert.equal(verseBalance(user), 0);
  });

  await runner.test('regress', 'a second allowlisted boss pays 20 the same day, once under two tabs', async () => {
    const session = await login('sproto');
    const who = session.hub;
    const [left, right] = await Promise.all([
      fire(session, 'sproto.boss_defeated', { boss: 'sahil' }),
      fire(session, 'sproto.boss_defeated', { boss: 'sahil' }),
    ]);
    assert.equal(left.body.error, undefined, JSON.stringify(left.body));
    assert.equal(right.body.error, undefined, JSON.stringify(right.body));
    const paid = [left, right].filter((result) => ticketsOf(result.body) === 20);
    assert.equal(paid.length, 1, JSON.stringify([left.body, right.body]));
    assert.equal(ticketBalance(who.userId, 'sproto'), 20);
    assert.equal(windowAmount(who.userId, 'boss:sproto:sahil'), 1);
    assert.equal(verseBalance(who.userId), 0);
    assert.equal(num(`SELECT count(*) FROM game.item_owned_pending WHERE user_id = '${sqlId(who.userId)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.relic_claim_pending WHERE user_id = '${sqlId(who.userId)}'`), 0);
  });

  await runner.test('regress', 'fighter rivet pays 20 T once on the same UTC day', async () => {
    const session = await login('sproto-fighter');
    const user = session.hub.userId;
    const first = await fire(session, 'fighter.boss_defeated', { boss: 'rivet' });
    assert.equal(ticketsOf(first.body), 20, JSON.stringify(first.body));
    assert.equal(ticketBalance(user, 'sproto-fighter'), 20);
    const second = await fire(session, 'fighter.boss_defeated', { boss: 'rivet' });
    assert.equal(second.body.error, undefined, JSON.stringify(second.body));
    assert.equal(ticketsOf(second.body), undefined, JSON.stringify(second.body));
    assert.equal(ticketBalance(user, 'sproto-fighter'), 20);
    assert.equal(windowAmount(user, 'boss:sproto-fighter:rivet'), 1);
    assert.equal(verseBalance(user), 0);
  });

  await runner.test('regress', 'a boss that is not on the allowlist pays nothing', async () => {
    const fighter = await login('sproto-fighter');
    const captain = await fire(fighter, 'fighter.boss_defeated', { boss: 'captain' });
    assert.equal(captain.body.error, undefined, JSON.stringify(captain.body));
    assert.equal(ticketsOf(captain.body), undefined, JSON.stringify(captain.body));
    assert.equal(captain.body.granted, undefined, JSON.stringify(captain.body));
    assert.equal(ticketBalance(fighter.hub.userId, 'sproto-fighter'), 0);
    assert.equal(num(`SELECT count(*) FROM game.earn_window WHERE user_id = '${sqlId(fighter.hub.userId)}'`), 0);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(fighter.hub.userId)}'`), 0);
    assert.equal(relicClaims(fighter.hub.userId, 'tidebreaker_belt'), 0);

    const duel = await login('sproto');
    const midget = await fire(duel, 'sproto.boss_defeated', { boss: 'midget' });
    assert.equal(midget.body.error, undefined, JSON.stringify(midget.body));
    assert.equal(ticketsOf(midget.body), undefined, JSON.stringify(midget.body));
    assert.equal(midget.body.granted, undefined, JSON.stringify(midget.body));
    assert.equal(ticketBalance(duel.hub.userId, 'sproto'), 0);
    assert.equal(relicClaims(duel.hub.userId, 'tinubu_crown'), 0);
    assert.equal(verseBalance(duel.hub.userId), 0);
  });

  await runner.test('regress', 'the pairs 0060_relic_unhold released grant live once and pay 0', async () => {
    const pairs: { game: string; eventId: string; data: object; kind: 'relic' | 'item'; id: string }[] = [
      { game: 'sproto-fighter', eventId: 'fighter.story_level_complete', data: { world: 1 }, kind: 'relic', id: 'tidebreaker_belt' },
      { game: 'peoples-bitcoin', eventId: 'pb.quest_complete', data: { questId: 'quest_tutorial' }, kind: 'relic', id: 'genesis_shard' },
      { game: 'hpos10i', eventId: 'hpos10i.level_complete', data: { zone: 'z1_retro_rush_hills', act: 2, time: 12 }, kind: 'item', id: 'pet_honk_sproto' },
      { game: 'hpos10i', eventId: 'hpos10i.level_complete', data: { zone: 'z2_wizard_academy', act: 2, time: 12 }, kind: 'item', id: 'pet_spiral_sproto' },
      { game: 'peoples-bitcoin', eventId: 'pb.quest_complete', data: { questId: 'quest_moonward' }, kind: 'item', id: 'pet_moon_sproto' },
      { game: 'peoples-bitcoin', eventId: 'pb.quest_complete', data: { questId: 'quest_hatchery' }, kind: 'item', id: 'pet_sproto_pup' },
    ];
    const problems: string[] = [];
    for (const pair of pairs) {
      try {
        const session = await login(pair.game);
        const user = session.hub.userId;
        const before = purse(user, pair.game);
        const result = await fire(session, pair.eventId, pair.data);
        assertNoPay(result, user, pair.game, before);
        // A second qualifying clear with a new key grants nothing more.
        const again = await fire(session, pair.eventId, pair.data);
        assertNoPay(again, user, pair.game, before);
        if (pair.kind === 'relic') {
          assert.equal(result.body.granted, pair.id, JSON.stringify(result.body));
          assert.equal(again.body.granted, undefined, JSON.stringify(again.body));
          assert.equal(relicPending(user, pair.id), 0, pair.id);
          assert.equal(relicClaims(user, pair.id), 1, pair.id);
          assert.equal(
            num(`SELECT count(*) FROM game.game_beaten WHERE user_id = '${sqlId(user)}' AND relic_id = '${slug(pair.id)}'`),
            1,
            pair.id,
          );
        } else {
          assert.deepEqual(grantedItems(result.body), [pair.id], JSON.stringify(result.body));
          assert.deepEqual(grantedItems(again.body), [], JSON.stringify(again.body));
          assert.equal(pendingCount(user, pair.id), 0, pair.id);
          assert.equal(ownedCount(user, pair.id), 1, pair.id);
          assert.equal(itemGrants(user, pair.id), 1, pair.id);
        }
      } catch (error) {
        problems.push(`${pair.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    assert.equal(problems.length, 0, problems.join('\n'));
  });

  await runner.test('regress', 'a replayed belt and two tabs mint one live belt', async () => {
    const session = await login('sproto-fighter');
    const key = crypto.randomUUID();
    const first = await fire(session, 'fighter.story_level_complete', { world: 1 }, key);
    const replay = await fire(session, 'fighter.story_level_complete', { world: 1 }, key);
    assert.equal(canonical(replay.body), canonical(first.body));
    assert.equal(first.body.granted, 'tidebreaker_belt');
    assert.equal(relicPending(session.hub.userId, 'tidebreaker_belt'), 0);
    assert.equal(relicClaims(session.hub.userId, 'tidebreaker_belt'), 1);
    assert.equal(ticketBalance(session.hub.userId, 'sproto-fighter'), 0);

    const who = await guest();
    const tabs = await openGame(who.token, 'sproto-fighter');
    await Promise.all([
      fire(tabs, 'fighter.story_level_complete', { world: 1 }),
      fire(tabs, 'fighter.story_level_complete', { world: 1 }),
    ]);
    assert.equal(relicPending(who.userId, 'tidebreaker_belt'), 0);
    assert.equal(relicClaims(who.userId, 'tidebreaker_belt'), 1);
    assert.equal(ticketBalance(who.userId, 'sproto-fighter'), 0);
    assert.equal(verseBalance(who.userId), 0);
  });

  await runner.test('regress', 'nobu cone still grants cones_tip live', async () => {
    const session = await login('nobu');
    const user = session.hub.userId;
    const result = await fire(session, 'nobu.boss_defeated', { boss: 'cone' });
    assert.equal(result.body.error, undefined, JSON.stringify(result.body));
    assert.equal(result.body.granted, 'cones_tip', JSON.stringify(result.body));
    assert.equal(relicClaims(user, 'cones_tip'), 1);
    assert.equal(relicPending(user, 'cones_tip'), 0);
    assert.equal(ticketBalance(user, 'nobu'), 0);
    assert.equal(verseBalance(user), 0);
  });
}
