/**
 * People's Bitcoin shop. `tickets.spend` and `tickets.sell` take
 * `{game:'peoples-bitcoin', shop_id, item_id, packs, key}`. Cases stay pending
 * until `game.shop_price` is seeded with those columns. A zero credit sell must
 * return `zero_value` with no ledger and no idempotency row. The earn of 1000
 * regression lives in the suite and is not gated. Nothing here is weakened to pass early.
 */
declare module 'fake-indexeddb/auto';

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createHubSdk,
  createNakamaClient,
  memoryKeyValue,
  type HubSdkEnv,
} from '../../../packages/hub-sdk/src/index.ts';
import { M2_SHOP, TICKET_DAILY_CAP, repeatCount } from './cases.ts';
import type { GateRunner } from './gated.ts';
import {
  arm,
  assertConflict,
  call,
  canonical,
  disarm,
  earn,
  ensureNakama,
  faulted,
  guest,
  installFaultHooks,
  openGame,
  killDuringSleep,
  login,
  note,
  num,
  psql,
  sqlId,
  ticketBalance,
  verseBalance,
  type RpcResult,
} from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GAME = 'peoples-bitcoin';
const SPEND_REASON = 'waiting for RPC tickets.spend and game.shop_price(game, shop_id, item_id, pack_size, ticket_price) seeded for peoples-bitcoin';
const SELL_REASON = 'waiting for RPC tickets.sell and game.shop_price.sell_price (ledger shop_sell)';
const OUTBOX_REASON = "waiting for tickets.spend in the hub-sdk outbox (packages/hub-sdk/src/live.ts)";
const HOOK_REASON = 'waiting for HubFault.apply at spend.before_rpc and spend.after_commit';
const SLUG = /^[A-Za-z0-9_.:-]{1,80}$/;

const SPEND_CASES: Array<[string, string]> = [
  ['idempotency', 'pb.tickets_spend replay charges once'],
  ['idempotency', 'pb.tickets_spend same key different item or qty is a conflict'],
  ['race', 'pb.tickets_spend racing another spend stays non-negative'],
  ['race', 'pb.tickets_spend racing an exchange stays non-negative'],
  ['wallet', 'pb.tickets_spend over balance does not charge'],
  ['wallet', 'pb.tickets_spend under session and daily caps'],
  ['forged', 'pb.tickets_spend ignores a client price'],
  ['forged', 'pb.tickets_spend rejects zero, negative, non-integer, huge, and unknown items'],
  ['forged', 'pb and peoples_bitcoin match no shop price, earn, or event'],
  ['wallet', 'pb seeded shop prices match Hopium Soda and item_rounds'],
  ['wallet', 'pb same item is charged each shop price'],
  ['forged', 'item_blue_sproto_coffee cannot mint a ghost item'],
  ['wallet', 'pb sell_price is at most 45 percent of the cheapest buy'],
  ['wallet', 'pb shop_price matches pb_shop_prices.csv row for row'],
  ['fault', 'pb.tickets_spend after_wallet rolls back'],
  ['fault', 'pb.tickets_spend kill_before_commit'],
];

const SELL_CASES: Array<[string, string]> = [
  ['wallet', 'pb buy then sell never nets tickets'],
  ['wallet', 'pb sell of Hopium Soda is zero_value and does not stick'],
  ['wallet', 'pb sell whose credit is at least 1 succeeds'],
  ['wallet', 'pb sell over the session cap is rejected whole'],
];

const OUTBOX_CASES: Array<[string, string]> = [
  ['outbox', 'pb.tickets_spend reload drains the lost response once'],
];

const HOOK_CASES: Array<[string, string]> = [
  ['fault', 'pb.tickets_spend before_rpc rolls back'],
  ['fault', 'pb.tickets_spend after_commit stays charged'],
];

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), 'utf8');
}

function registered(name: string): boolean {
  const main = source('server/modules/src/main.ts');
  return main.includes(`"${name}"`) || main.includes(`'${name}'`);
}

function shopColumns(): string[] {
  if (psql(`SELECT to_regclass('game.shop_price') IS NOT NULL`) !== 't') return [];
  const raw = psql(
    `SELECT coalesce(string_agg(column_name, ','), '') FROM information_schema.columns WHERE table_schema = 'game' AND table_name = 'shop_price'`,
  );
  return raw.split(',').filter(Boolean);
}

function priceColumn(cols: string[]): string {
  if (cols.includes('ticket_price')) return 'ticket_price';
  if (cols.includes('price')) return 'price';
  return '';
}

export function spendLanded(): boolean {
  const cols = shopColumns();
  const need = ['game', 'shop_id', 'item_id', 'pack_size'];
  return registered('tickets.spend') && need.every((name) => cols.includes(name)) && priceColumn(cols) !== '';
}

function sellRpc(): string | null {
  const main = source('server/modules/src/main.ts');
  const names = [...main.matchAll(/registerRpc\("([^"]*sell[^"]*)"/g)].map((match) => match[1] ?? '');
  return names.find((name) => name === 'tickets.sell') ?? names[0] ?? null;
}

function sellLanded(): boolean {
  return spendLanded() && shopColumns().includes('sell_price') && sellRpc() !== null;
}

function spendSdkMethod(): string | null {
  const live = source('packages/hub-sdk/src/live.ts');
  if (!live.includes('tickets.spend')) return null;
  const match = live.match(/async (spend\w*)\s*\(/);
  return match?.[1] ?? null;
}

function hookLanded(point: string): boolean {
  const rpcs = source('server/modules/src/rpcs.ts');
  return rpcs.includes(`"${point}"`) || rpcs.includes(`'${point}'`);
}

interface PricedItem {
  shopId: string;
  itemId: string;
  name: string;
  packSize: number;
  price: number;
  sellPrice: number | null;
}

function loadItems(): PricedItem[] {
  const cols = shopColumns();
  const price = priceColumn(cols);
  if (!price) return [];
  const sell = cols.includes('sell_price') ? "coalesce(sell_price::text, '')" : "''";
  const name = cols.includes('name') ? "coalesce(name, '')" : "''";
  const raw = psql(
    `SELECT shop_id || '|' || item_id || '|' || pack_size::text || '|' || ${price}::text || '|' || ${sell} || '|' || ${name} FROM game.shop_price WHERE game = '${GAME}' ORDER BY ${price} ASC, item_id ASC, shop_id ASC`,
  );
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const [shopId, itemId, packRaw, priceRaw, sellRaw, itemName] = line.split('|');
    if (!shopId || !SLUG.test(shopId) || !itemId || !SLUG.test(itemId)) {
      throw new Error(`shop_price id is not a slug: ${line}`);
    }
    const price = Number(priceRaw);
    const packSize = Number(packRaw);
    if (!Number.isSafeInteger(price) || price < 0) throw new Error(`ticket_price is not a safe integer: ${line}`);
    if (!Number.isSafeInteger(packSize) || packSize <= 0) throw new Error(`pack_size is not a positive integer: ${line}`);
    const sellPrice = sellRaw ? Number(sellRaw) : null;
    return {
      shopId,
      itemId,
      name: itemName ?? '',
      packSize,
      price,
      sellPrice: sellPrice !== null && Number.isFinite(sellPrice) ? sellPrice : null,
    };
  });
}

function cheapest(): PricedItem {
  const item = loadItems().find((row) => row.price > 0);
  if (!item) throw new Error(`game.shop_price has no ${GAME} row with ticket_price > 0`);
  const cap = num('SELECT game.session_ticket_cap()');
  if (item.price > cap) throw new Error(`${item.itemId} costs ${item.price}, over the session cap ${cap}`);
  return item;
}

function spendBody(shopId: string, itemId: string, packs: number, key: string, extra: object = {}, game = GAME): object {
  return { game, shop_id: shopId, item_id: itemId, packs, key, ...extra };
}

function spend(token: string, item: PricedItem, packs: number, key: string, extra: object = {}): Promise<RpcResult> {
  return call('tickets.spend', spendBody(item.shopId, item.itemId, packs, key, extra), token);
}

function dbItem(shopId: string, itemId: string): PricedItem {
  const item = loadItems().find((row) => row.shopId === shopId && row.itemId === itemId);
  if (!item) throw new Error(`no seeded row ${shopId}/${itemId}`);
  return item;
}

function spendLabel(): string {
  const kind = psql(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'game' AND table_name = 'tickets_ledger' AND column_name = 'kind')`,
  ) === 't';
  return kind ? `(reason = 'spend' OR kind = 'spend')` : `reason = 'spend'`;
}

function spendLedger(userId: string): number {
  return num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND ${spendLabel()}`);
}

function spendDebit(userId: string): number {
  return num(
    `SELECT COALESCE(sum(-delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND ${spendLabel()}`,
  );
}

function unchanged(userId: string, tickets: number, verse: number, ledger: number): void {
  assert.equal(ticketBalance(userId, GAME), tickets);
  assert.equal(verseBalance(userId), verse);
  assert.equal(spendLedger(userId), ledger);
}

function assertUnits(body: RpcResult['body'], userId: string, itemId: string, expected: number): void {
  const record = body as Record<string, unknown>;
  for (const key of ['units', 'unitCount', 'quantity', 'qty']) {
    if (typeof record[key] === 'number') {
      assert.equal(record[key], expected, JSON.stringify(body));
      return;
    }
  }
  if (!SLUG.test(itemId)) throw new Error(`item id is not a slug: ${itemId}`);
  const tables = psql(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'game' AND column_name = 'item_id' AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'game' AND column_name = 'user_id')`,
  );
  for (const table of tables.split('\n').filter(Boolean)) {
    if (!/^[a-z_]+$/.test(table)) continue;
    const qtyCol = psql(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'game' AND table_name = '${table}' AND column_name IN ('qty', 'quantity', 'units') LIMIT 1`,
    );
    if (!qtyCol) continue;
    const held = num(
      `SELECT COALESCE(sum(${qtyCol}), 0) FROM game.${table} WHERE user_id = '${sqlId(userId)}' AND item_id = '${itemId}'`,
    );
    assert.equal(held, expected, `${table}.${qtyCol}`);
    return;
  }
  throw new Error(`spend did not report ${expected} units for ${itemId}: ${JSON.stringify(body)}`);
}

function itemSnapshot(userId: string): string {
  const tables = psql(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'game' AND column_name = 'item_id' AND table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema = 'game' AND column_name = 'user_id')`,
  );
  return tables.split('\n').filter((table) => /^[a-z_]+$/.test(table)).map((table) => (
    psql(`SELECT count(*)::text FROM game.${table} WHERE user_id = '${sqlId(userId)}'`)
  )).join(',');
}

function idempotencyRows(userId: string, key: string): number {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) throw new Error(`bad key ${key}`);
  return num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(userId)}' AND key = '${key}'`);
}

function dayTickets(userId: string): number {
  return num(
    `SELECT COALESCE((SELECT amount FROM game.earn_window WHERE user_id = '${sqlId(userId)}' AND bucket = 'tickets:${GAME}'), 0)`,
  );
}

function sessionEarned(userId: string, sessionId: string): number {
  return num(
    `SELECT COALESCE(sum(delta), 0) FROM game.tickets_ledger WHERE user_id = '${sqlId(userId)}' AND ref_id = '${sqlId(sessionId)}' AND delta > 0`,
  );
}

/** Integer prices use sell_price * packs. Non-integers follow round/floor/ceil if the sell SQL says so. */
function sellCredit(sellPrice: number, packs: number): number {
  const src = source('server/modules/src/schema.ts');
  const product = sellPrice * packs;
  if (!Number.isInteger(sellPrice) || !Number.isInteger(packs)) {
    if (/round\([^)]*sell_price/i.test(src)) return Math.round(product);
    if (/ceil\([^)]*sell_price/i.test(src)) return Math.ceil(product);
    if (/floor\([^)]*sell_price/i.test(src)) return Math.floor(product);
  }
  return product;
}

interface CsvPrice {
  game: string;
  shopId: string;
  itemId: string;
  name: string;
  packSize: number;
  pbPrice: string;
  ticketPrice: number;
  sellPrice: number;
}

const SHOP_CSV = path.join(ROOT, 'server/test/dup/pb_shop_prices.csv');

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else current += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      cells.push(current);
      current = '';
    } else current += char;
  }
  cells.push(current);
  return cells;
}

function loadShopCsv(): CsvPrice[] | null {
  if (!existsSync(SHOP_CSV)) return null;
  const lines = readFileSync(SHOP_CSV, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const header = parseCsvLine(lines[0] ?? '');
  const expected = ['game', 'shop_id', 'item_id', 'name', 'pack_size', 'pb_price', 'ticket_price', 'sell_price'];
  if (header.join(',') !== expected.join(',')) {
    throw new Error(`pb_shop_prices.csv header is ${header.join(',')} not ${expected.join(',')}`);
  }
  return lines.slice(1).map((line) => {
    const [game, shopId, itemId, name, packSize, pbPrice, ticketPrice, sellPrice] = parseCsvLine(line);
    return {
      game: game ?? '',
      shopId: shopId ?? '',
      itemId: itemId ?? '',
      name: name ?? '',
      packSize: Number(packSize),
      pbPrice: pbPrice ?? '',
      ticketPrice: Number(ticketPrice),
      sellPrice: Number(sellPrice),
    };
  });
}

function csvByName(rows: CsvPrice[], name: string, shopId: string): CsvPrice {
  const row = rows.find((item) => item.name === name && item.shopId === shopId);
  if (!row) throw new Error(`pb_shop_prices.csv has no ${name} at ${shopId}`);
  return row;
}

function differingShopPair(rows: CsvPrice[]): { itemId: string; cheap: CsvPrice; dear: CsvPrice } | null {
  const groups = new Map<string, CsvPrice[]>();
  for (const row of rows) {
    const list = groups.get(row.itemId) ?? [];
    list.push(row);
    groups.set(row.itemId, list);
  }
  for (const [itemId, list] of groups) {
    const prices = new Set(list.map((row) => row.ticketPrice));
    if (prices.size < 2) continue;
    const ordered = [...list].sort((a, b) => a.ticketPrice - b.ticketPrice);
    const cheap = ordered[0];
    const dear = ordered[ordered.length - 1];
    if (cheap && dear) return { itemId, cheap, dear };
  }
  return null;
}

function sessionPurse(): number {
  return num('SELECT game.session_ticket_cap()');
}

const PB_EARN_REASONS = ['pb_drop', 'pb_lobby', 'pb_sell', 'pb_quest'] as const;

async function fund(token: string, amount: number, key: string): Promise<void> {
  const cap = sessionPurse();
  if (amount > cap) {
    throw new Error(`earn ${amount} exceeds session cap ${cap}; amounts >= 1000 are not a bypass`);
  }
  await earn(token, amount, 'pb_drop', key);
}

async function runAmountRule(runner: GateRunner): Promise<void> {
  const name = 'pb earn above event_rule max_amount returns amount_over_rule';
  const hasMax = psql(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'game' AND table_name = 'event_rule' AND column_name = 'max_amount')`,
  ) === 't';
  if (!hasMax) {
    runner.pending('wallet', name, 'waiting for game.event_rule.max_amount');
    return;
  }
  await runner.test('wallet', name, async () => {
    const raw = psql(
      `SELECT game_id || '|' || event_type || '|' || max_amount::text FROM game.event_rule WHERE max_amount IS NOT NULL AND max_amount > 0 ORDER BY game_id LIMIT 1`,
    );
    if (!raw) throw new Error('event_rule.max_amount exists but no positive row is seeded');
    const [gameId, , maxRaw] = raw.split('|');
    if (!gameId || !SLUG.test(gameId)) throw new Error(`event_rule game_id is not a slug: ${raw}`);
    const maxAmount = Number(maxRaw);
    const session = await login(gameId);
    const before = ticketBalance(session.hub.userId, gameId);
    const ledger = num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(session.hub.userId)}'`);
    const over = await call('tickets.earn', { amount: maxAmount + 1, reason: 'pb_drop', key: 'over-rule' }, session.gameToken);
    assert.equal(over.body.error, 'amount_over_rule', JSON.stringify(over.body));
    assert.equal(ticketBalance(session.hub.userId, gameId), before);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(session.hub.userId)}'`), ledger);
  });
}

const NOBU_LEVEL_REASON = 'waiting for a nobu event_rule max_amount of 110 on level_end (error amount_over_rule)';
const BALANCE_REASON = 'waiting for tickets.balance sessionCapLeft and dailyCapLeft (hub SDK 0.2.0)';
const PB_ID_REASON = "waiting for the hub to accept game id 'peoples-bitcoin' (rename / SDK after 0.1.0)";

function nobuLevelMax(): number | null {
  const cols = psql(
    `SELECT coalesce(string_agg(column_name, ','), '') FROM information_schema.columns WHERE table_schema = 'game' AND table_name = 'event_rule'`,
  );
  if (!cols.split(',').includes('max_amount')) return null;
  const raw = psql(
    `SELECT max_amount::text FROM game.event_rule WHERE game_id = 'nobu' AND max_amount IS NOT NULL ORDER BY max_amount ASC LIMIT 1`,
  );
  if (!raw) return null;
  const max = Number(raw);
  return Number.isFinite(max) ? max : null;
}

function capFieldsLanded(): boolean {
  const blob = source('server/modules/src/main.ts')
    + source('server/modules/src/rpcs.ts')
    + source('packages/hub-sdk/src/live.ts')
    + source('packages/hub-sdk/src/types.ts');
  return blob.includes('sessionCapLeft') && blob.includes('dailyCapLeft');
}

function peoplesBitcoinHub(): boolean {
  return source('server/modules/src/rpcs.ts').includes('peoples-bitcoin');
}

async function runNobuLevelEnd(runner: GateRunner): Promise<void> {
  const name = 'nobu level_end above 110 is amount_over_rule';
  const max = nobuLevelMax();
  if (max === null) {
    runner.pending('wallet', name, NOBU_LEVEL_REASON);
    return;
  }
  await runner.test('wallet', name, async () => {
    assert.equal(max, 110, `nobu event_rule max_amount is ${max}, expected 110`);
    const session = await login('nobu');
    const accepted = await call('tickets.earn', { amount: 110, reason: 'level_end', key: 'nobu-110' }, session.gameToken);
    assert.equal(accepted.body.error, undefined, JSON.stringify(accepted.body));
    assert.equal(ticketBalance(session.hub.userId, 'nobu'), 110);
    assert.equal(dayTicketsFor(session.hub.userId, 'nobu'), 110);
    const over = await call('tickets.earn', { amount: 111, reason: 'level_end', key: 'nobu-111' }, session.gameToken);
    assert.equal(over.body.error, 'amount_over_rule', JSON.stringify(over.body));
    assert.equal(ticketBalance(session.hub.userId, 'nobu'), 110);
    assert.equal(dayTicketsFor(session.hub.userId, 'nobu'), 110);
    const fresh = await login('nobu');
    const three = await call('tickets.earn', { amount: 300, reason: 'level_end', key: 'nobu-300' }, fresh.gameToken);
    assert.equal(three.body.error, 'amount_over_rule', `300 is over the rule and the session cap; got ${JSON.stringify(three.body)}`);
    assert.equal(ticketBalance(fresh.hub.userId, 'nobu'), 0);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(fresh.hub.userId)}'`), 0);
    assert.equal(dayTicketsFor(fresh.hub.userId, 'nobu'), 0);
  });
}

function dayTicketsFor(userId: string, game: string): number {
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(game)) throw new Error(`bad game ${game}`);
  return num(
    `SELECT COALESCE((SELECT amount FROM game.earn_window WHERE user_id = '${sqlId(userId)}' AND bucket = 'tickets:${game}'), 0)`,
  );
}

async function runTicketBalance(runner: GateRunner): Promise<void> {
  const name = 'tickets.balance reports sessionCapLeft and dailyCapLeft';
  if (!capFieldsLanded()) {
    runner.pending('wallet', name, BALANCE_REASON);
    return;
  }
  await runner.test('wallet', name, async () => {
    const session = await login('sproto');
    const cap = sessionPurse();
    const first = await call('tickets.balance', { game: 'sproto' }, session.gameToken);
    assert.equal(first.body.error, undefined, JSON.stringify(first.body));
    const body = first.body as Record<string, unknown>;
    assert.equal(body.sessionCapLeft, cap);
    assert.equal(body.dailyCapLeft, TICKET_DAILY_CAP);
    await earn(session.gameToken, 40, 'win', 'bal-earn');
    const afterEarn = await call('tickets.balance', { game: 'sproto', sessionCapLeft: 99999, dailyCapLeft: 99999 }, session.gameToken);
    const earned = afterEarn.body as Record<string, unknown>;
    assert.equal(earned.sessionCapLeft, cap - 40);
    assert.equal(earned.dailyCapLeft, TICKET_DAILY_CAP - 40);
    const traded = await call('tickets.exchange', { tickets: 10, key: 'bal-ex' }, session.gameToken);
    assert.equal(traded.body.error, undefined, JSON.stringify(traded.body));
    const afterEx = await call('tickets.balance', { game: 'sproto' }, session.gameToken);
    const exchanged = afterEx.body as Record<string, unknown>;
    assert.equal(exchanged.sessionCapLeft, cap - 40, 'exchange is not a Ticket credit');
    assert.equal(exchanged.dailyCapLeft, TICKET_DAILY_CAP - 40);
    psql(`UPDATE game.earn_window SET day = day - 1 WHERE user_id = '${sqlId(session.hub.userId)}' AND bucket = 'tickets:sproto'`);
    const rolled = await call('tickets.balance', { game: 'sproto' }, session.gameToken);
    const nextDay = rolled.body as Record<string, unknown>;
    assert.equal(nextDay.dailyCapLeft, TICKET_DAILY_CAP);
    const tooMuch = await call('tickets.earn', {
      amount: cap,
      reason: 'win',
      key: 'bal-lie',
      sessionCapLeft: 99999,
      dailyCapLeft: 99999,
    }, session.gameToken);
    assert.equal(tooMuch.body.error, 'session_ticket_cap', JSON.stringify(tooMuch.body));
    assert.equal(ticketBalance(session.hub.userId, 'sproto'), 30);
  });
}

async function runPeoplesBitcoinHub(runner: GateRunner): Promise<void> {
  const names = [
    ['idempotency', 'peoples-bitcoin quest key pays once'],
    ['wallet', 'peoples-bitcoin earn reasons pb_drop pb_lobby pb_sell pb_quest'],
    ['idempotency', 'peoples-bitcoin quest_complete with tick grants genesis_shard'],
    ['forged', 'hub accepts game id peoples-bitcoin'],
  ] as const;
  if (!peoplesBitcoinHub()) {
    for (const [category, name] of names) runner.pending(category, name, PB_ID_REASON);
    return;
  }
  await runner.test('forged', 'hub accepts game id peoples-bitcoin', async () => {
    const session = await login(GAME);
    const earned = await call('tickets.earn', { amount: 10, reason: 'pb_drop', key: 'pb-id-ok' }, session.gameToken);
    assert.equal(earned.body.error, undefined, JSON.stringify(earned.body));
    assert.equal(ticketBalance(session.hub.userId, GAME), 10);
  });
  await runner.test('wallet', 'peoples-bitcoin earn reasons pb_drop pb_lobby pb_sell pb_quest', async () => {
    const session = await login(GAME);
    let expected = 0;
    for (const reason of PB_EARN_REASONS) {
      const result = await call('tickets.earn', { amount: 10, reason, key: `reason-${reason}` }, session.gameToken);
      assert.equal(result.body.error, undefined, `${reason} ${JSON.stringify(result.body)}`);
      expected += 10;
      assert.equal(ticketBalance(session.hub.userId, GAME), expected);
    }
  });
  await runner.test('idempotency', 'peoples-bitcoin quest key pays once', async () => {
    const session = await login(GAME);
    const key = 'pb:quest:quest_tutorial';
    const first = await call('tickets.earn', { amount: 10, reason: 'pb_quest', key }, session.gameToken);
    assert.equal(first.body.error, undefined, JSON.stringify(first.body));
    const replay = await call('tickets.earn', { amount: 10, reason: 'pb_quest', key }, session.gameToken);
    assert.equal(canonical(replay.body), canonical(first.body));
    assert.equal(ticketBalance(session.hub.userId, GAME), 10);
    assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(session.hub.userId)}' AND delta > 0`), 1);
  });
  await runner.test('idempotency', 'peoples-bitcoin quest_complete with tick grants genesis_shard', async () => {
    const session = await login(GAME);
    const granted = await call('session.event', {
      eventId: 'pb.quest_complete',
      data: { questId: 'quest_tutorial', tick: 3 },
      key: 'pb-relic-key',
    }, session.gameToken);
    assert.equal(granted.body.granted, 'genesis_shard', JSON.stringify(granted.body));
    const again = await call('session.event', {
      eventId: 'pb.quest_complete',
      data: { questId: 'quest_tutorial', tick: 9 },
      key: 'pb-relic-other',
    }, session.gameToken);
    assert.equal(again.body.granted, undefined, JSON.stringify(again.body));
    assert.equal(num(`SELECT count(*) FROM game.item_ledger WHERE user_id = '${sqlId(session.hub.userId)}' AND item_id = 'genesis_shard' AND op = 'grant_relic'`), 1);
    const wrong = await call('session.event', {
      eventId: 'pb.quest_complete',
      data: { questId: 'quest_other', tick: 3 },
      key: 'pb-relic-wrong',
    }, session.gameToken);
    assert.equal(wrong.body.granted, undefined, JSON.stringify(wrong.body));
  });
}

export async function runShop(runner: GateRunner): Promise<void> {
  const shop = M2_SHOP.find((flow) => flow.game === GAME && flow.rpc === 'tickets.spend');
  if (!shop) throw new Error('M2_SHOP is missing pb.tickets_spend');
  await runAmountRule(runner);
  await runNobuLevelEnd(runner);
  await runTicketBalance(runner);
  await runPeoplesBitcoinHub(runner);
  if (!spendLanded()) {
    for (const [category, name] of SPEND_CASES) runner.pending(category, name, SPEND_REASON);
    for (const [category, name] of SELL_CASES) runner.pending(category, name, SELL_REASON);
    for (const [category, name] of OUTBOX_CASES) runner.pending(category, name, OUTBOX_REASON);
    for (const [category, name] of HOOK_CASES) runner.pending(category, name, HOOK_REASON);
    return;
  }

  await runner.test('idempotency', 'pb.tickets_spend replay charges once', async () => {
    const item = cheapest();
    const session = await login(GAME);
    await fund(session.gameToken, sessionPurse(), 'shop-fund-replay');
    const body = spendBody(item.shopId, item.itemId, 1, 'shop-replay');
    const first = await call('tickets.spend', body, session.gameToken);
    assert.equal(first.body.error, undefined, JSON.stringify(first.body));
    assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    assert.equal(spendLedger(session.hub.userId), 1);
    const results: RpcResult[] = [first];
    for (let i = 0; i < repeatCount('sequential'); i += 1) {
      results.push(await call('tickets.spend', body, session.gameToken));
    }
    const stored = canonical(first.body);
    for (const result of results) assert.equal(canonical(result.body), stored);
    assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    assert.equal(spendLedger(session.hub.userId), 1);
    assert.equal(verseBalance(session.hub.userId), 0);
  });

  await runner.test('idempotency', 'pb.tickets_spend same key different item or qty is a conflict', async () => {
    const items = loadItems();
    const item = items[0];
    if (!item) throw new Error('game.shop_price has no pb row with price > 0');
    const session = await login(GAME);
    await fund(session.gameToken, sessionPurse(), 'shop-fund-mismatch');
    const first = await spend(session.gameToken, item, 1, 'shop-mismatch');
    assert.equal(first.body.error, undefined, JSON.stringify(first.body));
    const otherQty = await spend(session.gameToken, item, 2, 'shop-mismatch');
    assertConflict(otherQty);
    const other = items.find((row) => row.itemId !== item.itemId || row.shopId !== item.shopId) ?? item;
    const otherPacks = other.itemId === item.itemId && other.shopId === item.shopId ? 2 : 1;
    const otherItem = await spend(session.gameToken, other, otherPacks, 'shop-mismatch');
    assertConflict(otherItem);
    const replay = await spend(session.gameToken, item, 1, 'shop-mismatch');
    assert.equal(canonical(replay.body), canonical(first.body));
    assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    assert.equal(spendLedger(session.hub.userId), 1);
  });

  await runner.test('race', 'pb.tickets_spend racing another spend stays non-negative', async () => {
    const item = cheapest();
    const session = await login(GAME);
    await fund(session.gameToken, sessionPurse(), 'shop-fund-race');
    const width = repeatCount('concurrent');
    const results = await Promise.all(Array.from({ length: width }, (_, index) => (
      spend(session.gameToken, item, 1, `shop-race-${index}`)
    )));
    const wins = results.filter((result) => !result.body.error && result.status < 400);
    const room = Math.floor(sessionPurse() / item.price);
    assert.equal(wins.length, Math.min(width, room), JSON.stringify(results.map((result) => result.body)));
    assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - wins.length * item.price);
    assert.ok(ticketBalance(session.hub.userId, GAME) >= 0);
    assert.equal(spendLedger(session.hub.userId), wins.length);
    assert.equal(verseBalance(session.hub.userId), 0);
  });

  await runner.test('race', 'pb.tickets_spend racing an exchange stays non-negative', async () => {
    const item = cheapest();
    const session = await login(GAME);
    await fund(session.gameToken, sessionPurse(), 'shop-fund-mix');
    const spends = Array.from({ length: 8 }, (_, index) => (
      spend(session.gameToken, item, 1, `shop-mix-${index}`)
    ));
    const exchanges = Array.from({ length: 6 }, (_, index) => (
      call('tickets.exchange', { tickets: 100, balance: 999999, price: 1, key: `shop-ex-${index}` }, session.gameToken)
    ));
    const results = await Promise.all([...spends, ...exchanges]);
    const balance = ticketBalance(session.hub.userId, GAME);
    const verse = verseBalance(session.hub.userId);
    assert.ok(balance >= 0, JSON.stringify(results.map((result) => result.body)));
    assert.ok(verse >= 0 && verse <= 50);
    const spent = spendDebit(session.hub.userId);
    const debited = num(
      `SELECT COALESCE(sum(-tickets), 0) FROM game.exchange_tx WHERE user_id = '${sqlId(session.hub.userId)}'`,
    );
    assert.equal(balance, sessionPurse() - spent - debited);
    assert.ok(spent + debited <= sessionPurse());
  });

  await runner.test('wallet', 'pb.tickets_spend over balance does not charge', async () => {
    const item = cheapest();
    const session = await login(GAME);
    const short = Math.min(item.price - 1, 200);
    if (short > 0) await fund(session.gameToken, short, 'shop-fund-short');
    const before = ticketBalance(session.hub.userId, GAME);
    const result = await spend(session.gameToken, item, 1, 'shop-broke');
    assert.equal(result.body.error, 'insufficient_tickets', JSON.stringify(result.body));
    unchanged(session.hub.userId, before, 0, 0);
    const replay = await spend(session.gameToken, item, 1, 'shop-broke');
    assert.equal(replay.body.error, 'insufficient_tickets', JSON.stringify(replay.body));
    unchanged(session.hub.userId, before, 0, 0);
  });

  await runner.test('wallet', 'pb.tickets_spend under session and daily caps', async () => {
    const item = cheapest();
    const cap = num('SELECT game.session_ticket_cap()');
    assert.ok(cap > 0 && cap < TICKET_DAILY_CAP);
    const session = await login(GAME);
    await fund(session.gameToken, cap, 'shop-cap-fill');
    const over = await call('tickets.earn', { amount: 1, reason: 'pb_drop', key: 'shop-cap-over' }, session.gameToken);
    assert.equal(over.body.error, 'session_ticket_cap', JSON.stringify(over.body));
    const before = ticketBalance(session.hub.userId, GAME);
    const boughtUnderCap = await spend(session.gameToken, item, 1, 'shop-under-cap');
    if (item.price <= before) {
      assert.equal(boughtUnderCap.body.error, undefined, JSON.stringify(boughtUnderCap.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), before - item.price);
    } else {
      assert.equal(boughtUnderCap.body.error, 'insufficient_tickets', JSON.stringify(boughtUnderCap.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), before);
    }
    const stillOver = await call('tickets.earn', { amount: 1, reason: 'pb_drop', key: 'shop-cap-still' }, session.gameToken);
    assert.equal(stillOver.body.error, 'session_ticket_cap', JSON.stringify(stillOver.body));
    const daily = await login(GAME);
    await fund(daily.gameToken, sessionPurse(), 'shop-day-0');
    for (let i = 1; i < TICKET_DAILY_CAP / sessionPurse(); i += 1) {
      const next = await openGame(daily.hub.token, GAME);
      await fund(next.gameToken, sessionPurse(), `shop-day-${i}`);
    }
    assert.equal(ticketBalance(daily.hub.userId, GAME), TICKET_DAILY_CAP);
    const cappedSession = await openGame(daily.hub.token, GAME);
    const capped = await call('tickets.earn', { amount: 10, reason: 'pb_drop', key: 'shop-day-over', day: '1999-01-01' }, cappedSession.gameToken);
    assert.equal(capped.body.capped, true, JSON.stringify(capped.body));
    assert.equal(ticketBalance(daily.hub.userId, GAME), TICKET_DAILY_CAP);
    const bought = await spend(cappedSession.gameToken, item, 1, 'shop-under-day');
    assert.equal(bought.body.error, undefined, JSON.stringify(bought.body));
    assert.equal(ticketBalance(daily.hub.userId, GAME), TICKET_DAILY_CAP - item.price);
    assert.equal(spendLedger(daily.hub.userId), 1);
  });

  await runner.test('forged', 'pb.tickets_spend ignores a client price', async () => {
    const item = cheapest();
    const session = await login(GAME);
    await fund(session.gameToken, sessionPurse(), 'shop-fund-forge');
    const result = await spend(session.gameToken, item, 1, 'shop-forge', {
      price: 1,
      cost: 1,
      tickets: 1,
      balance: 999999,
      amount: 1,
    });
    assert.equal(result.body.error, undefined, JSON.stringify(result.body));
    assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    assert.equal(spendLedger(session.hub.userId), 1);
    assert.equal(verseBalance(session.hub.userId), 0);
  });

  await runner.test('forged', 'pb.tickets_spend rejects zero, negative, non-integer, huge, and unknown items', async () => {
    const item = cheapest();
    const session = await login(GAME);
    await fund(session.gameToken, sessionPurse(), 'shop-fund-bad');
    const start = ticketBalance(session.hub.userId, GAME);
    const bad: Array<[string, number | string]> = [
      ['shop-zero', 0],
      ['shop-neg', -1],
      ['shop-huge', 1e20],
      ['shop-unknown', 1],
    ];
    for (const [key, qty] of bad) {
      const target = key === 'shop-unknown'
        ? { ...item, shopId: 'shop_nope', itemId: 'no_such_item' }
        : item;
      const result = key === 'shop-unknown'
        ? await call('tickets.spend', spendBody('shop_nope', 'no_such_item', 1, key), session.gameToken)
        : await spend(session.gameToken, target, Number(qty), key);
      if (key === 'shop-unknown') assert.equal(result.body.error, 'unknown_item', JSON.stringify(result.body));
      assert.ok(result.status >= 400 || result.body.error !== undefined, JSON.stringify(result));
      unchanged(session.hub.userId, start, 0, 0);
    }
    const fractional = await spend(session.gameToken, item, 1.5, 'shop-fraction');
    const balance = ticketBalance(session.hub.userId, GAME);
    if (fractional.body.error) {
      assert.equal(balance, start);
      assert.equal(spendLedger(session.hub.userId), 0);
    } else {
      const charged = start - balance;
      assert.ok(charged === item.price || charged === 0, `1.5 charged ${charged}, server price is ${item.price}`);
      assert.equal(spendLedger(session.hub.userId), charged === 0 ? 0 : 1);
    }
    assert.ok(ticketBalance(session.hub.userId, GAME) >= 0);
    assert.equal(verseBalance(session.hub.userId), 0);
    const afterBad = ticketBalance(session.hub.userId, GAME);
    const wrongShop = await call('tickets.spend', spendBody('shop_missing', item.itemId, 1, 'shop-wrong-shop'), session.gameToken);
    assert.equal(wrongShop.body.error, 'unknown_item', JSON.stringify(wrongShop.body));
    assert.equal(ticketBalance(session.hub.userId, GAME), afterBad);
  });

  const priceCsv = loadShopCsv();
  if (!priceCsv) {
    const missing = 'waiting for server/test/dup/pb_shop_prices.csv v3 (100 data rows)';
    runner.pending('wallet', 'pb seeded shop prices match Hopium Soda and item_rounds', missing);
    runner.pending('wallet', 'pb same item is charged each shop price', missing);
    runner.pending('forged', 'item_blue_sproto_coffee cannot mint a ghost item', missing);
  } else {
    await runner.test('wallet', 'pb seeded shop prices match Hopium Soda and item_rounds', async () => {
      assert.equal(priceCsv.length, 100, `csv has ${priceCsv.length} rows`);
      const terminalCsv = csvByName(priceCsv, 'Hopium Soda', 'shop_terminal');
      const staffCsv = csvByName(priceCsv, 'Hopium Soda', 'shop_staffwright');
      const roundsCsv = priceCsv.find((row) => row.itemId === 'item_rounds' && row.shopId === 'shop_terminal');
      if (!roundsCsv) throw new Error('csv has no item_rounds at shop_terminal');
      assert.equal(terminalCsv.ticketPrice, 4);
      assert.equal(staffCsv.ticketPrice, 4);
      assert.equal(terminalCsv.sellPrice, 0);
      assert.equal(staffCsv.sellPrice, 0);
      assert.equal(roundsCsv.ticketPrice, 3);
      assert.equal(roundsCsv.packSize, 100);
      const terminal = dbItem(terminalCsv.shopId, terminalCsv.itemId);
      const staff = dbItem(staffCsv.shopId, staffCsv.itemId);
      const rounds = loadItems().find((row) => row.itemId === 'item_rounds' && row.shopId === 'shop_terminal');
      if (!rounds) throw new Error('no seeded item_rounds at shop_terminal');
      assert.equal(terminal.price, terminalCsv.ticketPrice);
      assert.equal(staff.price, staffCsv.ticketPrice);
      assert.equal(terminal.sellPrice, 0);
      assert.equal(staff.sellPrice, 0);
      assert.equal(rounds.price, 3);
      assert.equal(rounds.packSize, 100);
      const session = await login(GAME);
      await fund(session.gameToken, sessionPurse(), 'shop-seed-fund');
      const sodaA = await spend(session.gameToken, terminal, 1, 'shop-hopium-terminal');
      assert.equal(sodaA.body.error, undefined, JSON.stringify(sodaA.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - terminal.price);
      const sodaB = await spend(session.gameToken, staff, 1, 'shop-hopium-staff');
      assert.equal(sodaB.body.error, undefined, JSON.stringify(sodaB.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - terminal.price - staff.price);
      const onePack = await spend(session.gameToken, rounds, 1, 'shop-rounds-1');
      assert.equal(onePack.body.error, undefined, JSON.stringify(onePack.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - terminal.price - staff.price - rounds.price);
      assertUnits(onePack.body, session.hub.userId, rounds.itemId, rounds.packSize);
      const twoPacks = await spend(session.gameToken, rounds, 2, 'shop-rounds-2');
      assert.equal(twoPacks.body.error, undefined, JSON.stringify(twoPacks.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - terminal.price - staff.price - rounds.price * 3);
      assertUnits(twoPacks.body, session.hub.userId, rounds.itemId, rounds.packSize * 3);
    });

    await runner.test('wallet', 'pb same item is charged each shop price', async () => {
      const pair = differingShopPair(priceCsv);
      if (!pair) {
        note('pb_shop_prices.csv v3 has no item whose ticket_price differs between shops. Hopium Soda is 4 at both shop_terminal and shop_staffwright.');
        const terminal = dbItem('shop_terminal', 'item_hopium_soda');
        const staff = dbItem('shop_staffwright', 'item_hopium_soda');
        assert.equal(terminal.price, staff.price);
        const session = await login(GAME);
        await fund(session.gameToken, terminal.price * 2, 'shop-same-fund');
        const first = await spend(session.gameToken, terminal, 1, 'shop-same-a');
        const second = await spend(session.gameToken, staff, 1, 'shop-same-b');
        assert.equal(first.body.error, undefined, JSON.stringify(first.body));
        assert.equal(second.body.error, undefined, JSON.stringify(second.body));
        assert.equal(ticketBalance(session.hub.userId, GAME), 0);
        return;
      }
      const cheap = dbItem(pair.cheap.shopId, pair.cheap.itemId);
      const dear = dbItem(pair.dear.shopId, pair.dear.itemId);
      assert.equal(cheap.itemId, dear.itemId);
      assert.notEqual(cheap.price, dear.price);
      assert.equal(cheap.price, pair.cheap.ticketPrice);
      assert.equal(dear.price, pair.dear.ticketPrice);
      const session = await login(GAME);
      await fund(session.gameToken, cheap.price + dear.price, 'shop-pair-fund');
      const low = await spend(session.gameToken, cheap, 1, 'shop-pair-cheap');
      const high = await spend(session.gameToken, dear, 1, 'shop-pair-dear');
      assert.equal(low.body.error, undefined, JSON.stringify(low.body));
      assert.equal(high.body.error, undefined, JSON.stringify(high.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), 0);
    });

    await runner.test('forged', 'item_blue_sproto_coffee cannot mint a ghost item', async () => {
      const listed = priceCsv.find((row) => row.itemId === 'item_blue_sproto_coffee');
      if (!listed) throw new Error('csv has no item_blue_sproto_coffee');
      const seeded = loadItems().find((row) => row.itemId === listed.itemId && row.shopId === listed.shopId);
      if (!seeded) throw new Error(`shop_price is missing ${listed.shopId}/${listed.itemId}`);
      assert.equal(seeded.price, listed.ticketPrice);
      const session = await login(GAME);
      const purse = Math.min(sessionPurse(), Math.max(seeded.price, 1));
      if (seeded.price > 0 && seeded.price <= purse) await fund(session.gameToken, purse, 'shop-coffee-fund');
      const before = ticketBalance(session.hub.userId, GAME);
      const held = itemSnapshot(session.hub.userId);
      const bought = await spend(session.gameToken, seeded, 1, 'shop-coffee-buy');
      const after = ticketBalance(session.hub.userId, GAME);
      if (bought.body.error) {
        assert.equal(after, before, JSON.stringify(bought.body));
        assert.equal(itemSnapshot(session.hub.userId), held);
        assert.equal(spendLedger(session.hub.userId), 0);
      } else {
        assert.equal(before - after, seeded.price, JSON.stringify(bought.body));
        assert.ok(after <= before);
        if (seeded.packSize > 0) assertUnits(bought.body, session.hub.userId, seeded.itemId, seeded.packSize);
      }
      const replay = await spend(session.gameToken, seeded, 1, 'shop-coffee-buy');
      assert.equal(ticketBalance(session.hub.userId, GAME), after, JSON.stringify(replay.body));
      if (sellLanded()) {
        const rpc = sellRpc();
        if (!rpc) throw new Error('sell RPC disappeared');
        const sold = await call(rpc, spendBody(seeded.shopId, seeded.itemId, 1, 'shop-coffee-sell'), session.gameToken);
        const afterSell = ticketBalance(session.hub.userId, GAME);
        if (sold.body.error === 'zero_value' || seeded.sellPrice === 0) {
          assert.equal(afterSell, after);
        } else if (!sold.body.error) {
          assert.ok(afterSell - after <= Math.max(0, seeded.sellPrice ?? 0), JSON.stringify(sold.body));
          assert.ok(afterSell <= before);
        } else {
          assert.equal(afterSell, after, JSON.stringify(sold.body));
        }
      }
    });
  }

  await runner.test('wallet', 'pb sell_price is at most 45 percent of the cheapest buy', async () => {
    if (!shopColumns().includes('sell_price')) throw new Error('game.shop_price has no sell_price column');
    const rows = loadItems();
    const byItem = new Map<string, PricedItem[]>();
    for (const row of rows) {
      const list = byItem.get(row.itemId) ?? [];
      list.push(row);
      byItem.set(row.itemId, list);
    }
    const mismatches: string[] = [];
    for (const [itemId, list] of byItem) {
      const buys = list.map((row) => row.price).filter((price) => price > 0);
      if (!buys.length) continue;
      const cheapestBuy = Math.min(...buys);
      for (const row of list) {
        if (row.sellPrice === null) continue;
        if (row.sellPrice * 100 > cheapestBuy * 45) {
          mismatches.push(`${itemId} @ ${row.shopId} sell ${row.sellPrice} > 45% of ${cheapestBuy}`);
        }
      }
    }
    assert.equal(mismatches.length, 0, mismatches.join('; '));
  });

  await runner.test('forged', 'pb and peoples_bitcoin match no shop price, earn, or event', async () => {
    const who = await guest();
    for (const game of ['pb', 'peoples_bitcoin']) {
      const before = ticketBalance(who.userId, GAME);
      const opened = await call('portal.enter', { game, ranked: false }, who.token);
      if (!opened.body.ticket || opened.body.error) {
        assert.ok(opened.body.error || opened.status >= 400, JSON.stringify(opened.body));
        assert.equal(ticketBalance(who.userId, GAME), before);
        continue;
      }
      const redeemed = await call('session.redeem', { ticket: opened.body.ticket, gameId: game });
      if (!redeemed.body.token || redeemed.body.error) {
        assert.ok(redeemed.body.error, JSON.stringify(redeemed.body));
        assert.equal(ticketBalance(who.userId, GAME), before);
        continue;
      }
      const earned = await call('tickets.earn', { amount: 10, reason: 'pb_drop', key: `alias-earn-${game}` }, redeemed.body.token);
      const spent = await call('tickets.spend', spendBody('shop_terminal', 'item_rounds', 1, `alias-spend-${game}`, {}, game), redeemed.body.token);
      const event = await call('session.event', {
        eventId: 'pb.quest_complete',
        data: { questId: 'quest_tutorial', tick: 1 },
        key: `alias-event-${game}`,
      }, redeemed.body.token);
      assert.notEqual(earned.body.balance, 10, JSON.stringify(earned.body));
      assert.ok(spent.body.error, JSON.stringify(spent.body));
      assert.notEqual(event.body.granted, 'genesis_shard', JSON.stringify(event.body));
      assert.equal(ticketBalance(who.userId, GAME), before);
      assert.equal(ticketBalance(who.userId, game), 0);
    }
  });

  await runner.test('fault', 'pb.tickets_spend after_wallet rolls back', async () => {
    installFaultHooks();
    const item = cheapest();
    const session = await login(GAME);
    await fund(session.gameToken, sessionPurse(), 'shop-fund-fault');
    const key = 'shop-fault-wallet';
    arm(session.hub.userId, 'spend.after_wallet', 'raise');
    try {
      const result = await spend(session.gameToken, item, 1, key);
      if (!faulted(result)) throw new Error(`spend.after_wallet did not fire: ${result.status} ${JSON.stringify(result.body)}`);
      unchanged(session.hub.userId, sessionPurse(), 0, 0);
    } finally {
      disarm(session.hub.userId);
    }
    const replay = await spend(session.gameToken, item, 1, key);
    assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
    assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    assert.equal(spendLedger(session.hub.userId), 1);
  });

  await runner.test('fault', 'pb.tickets_spend kill_before_commit', async () => {
    installFaultHooks();
    const item = cheapest();
    for (let index = 0; index < repeatCount('kill'); index += 1) {
      const session = await login(GAME);
      await fund(session.gameToken, sessionPurse(), `shop-fund-kill-${index}`);
      const key = `shop-kill-${index}`;
      arm(session.hub.userId, 'spend.after_wallet', 'sleep');
      try {
        const inflight = spend(session.gameToken, item, 1, key);
        const during = await killDuringSleep(
          inflight,
          session.hub.userId,
          'spend.after_wallet',
          () => spendLedger(session.hub.userId),
        );
        assert.equal(during, 0, 'spend was visible while the transaction was still open');
        assert.equal(spendLedger(session.hub.userId), 0);
        assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse());
      } finally {
        disarm(session.hub.userId);
        await ensureNakama();
      }
      const replay = await spend(session.gameToken, item, 1, key);
      assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
      assert.equal(spendLedger(session.hub.userId), 1);
      assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    }
  });

  if (!sellLanded()) {
    for (const [category, name] of SELL_CASES) runner.pending(category, name, SELL_REASON);
  } else {
    await runner.test('wallet', 'pb buy then sell never nets tickets', async () => {
      const rpc = sellRpc();
      if (!rpc) throw new Error('sell RPC disappeared');
      const item = loadItems().find((row) => row.sellPrice !== null && row.sellPrice > 0 && row.sellPrice < row.price);
      if (!item || item.sellPrice === null) {
        throw new Error('selling is registered but no pb row has sell_price below price');
      }
      const session = await login(GAME);
      await fund(session.gameToken, sessionPurse(), 'shop-fund-sell');
      const cycles = Math.max(1, Math.min(20, Math.floor(sessionPurse() / item.price)));
      let previous = ticketBalance(session.hub.userId, GAME);
      const start = previous;
      for (let i = 0; i < cycles; i += 1) {
        const bought = await spend(session.gameToken, item, 1, `shop-buy-${i}`);
        assert.equal(bought.body.error, undefined, JSON.stringify(bought.body));
        const afterBuy = ticketBalance(session.hub.userId, GAME);
        assert.equal(afterBuy, previous - item.price);
        const sold = await call(rpc, spendBody(item.shopId, item.itemId, 1, `shop-sell-${i}`), session.gameToken);
        assert.equal(sold.body.error, undefined, JSON.stringify(sold.body));
        const afterSell = ticketBalance(session.hub.userId, GAME);
        assert.ok(afterSell < previous, `cycle ${i} ended at ${afterSell}, started at ${previous}`);
        assert.ok(afterSell <= start);
        assert.equal(afterSell - afterBuy, sellCredit(item.sellPrice, 1));
        previous = afterSell;
      }
      assert.ok(ticketBalance(session.hub.userId, GAME) < start);
      assert.ok(verseBalance(session.hub.userId) >= 0);
    });

    await runner.test('wallet', 'pb sell of Hopium Soda is zero_value and does not stick', async () => {
      const rpc = sellRpc();
      if (!rpc) throw new Error('sell RPC disappeared');
      for (const shopId of ['shop_terminal', 'shop_staffwright']) {
        const soda = dbItem(shopId, 'item_hopium_soda');
        assert.equal(soda.price, 4, `${shopId} ticket_price`);
        assert.equal(soda.sellPrice, 0, `${shopId} sell_price`);
        assert.equal(sellCredit(soda.sellPrice ?? 0, 1), 0, `${shopId} sell_price`);
        const session = await login(GAME);
        await fund(session.gameToken, soda.price, `shop-zero-fund-${shopId}`);
        const bought = await spend(session.gameToken, soda, 1, `shop-zero-buy-${shopId}`);
        assert.equal(bought.body.error, undefined, JSON.stringify(bought.body));
        const balance = ticketBalance(session.hub.userId, GAME);
        const earned = sessionEarned(session.hub.userId, session.sessionId);
        const day = dayTickets(session.hub.userId);
        const held = itemSnapshot(session.hub.userId);
        for (const packs of [1, 4]) {
          const key = `shop-zero-${shopId}-${packs}`;
          const sold = await call(rpc, spendBody(soda.shopId, soda.itemId, packs, key), session.gameToken);
          assert.equal(sold.body.error, 'zero_value', JSON.stringify(sold.body));
          assert.equal(idempotencyRows(session.hub.userId, key), 0, key);
          const again = await call(rpc, spendBody(soda.shopId, soda.itemId, packs, key), session.gameToken);
          assert.equal(again.body.error, 'zero_value', JSON.stringify(again.body));
          assert.equal(idempotencyRows(session.hub.userId, key), 0, key);
        }
        assert.equal(ticketBalance(session.hub.userId, GAME), balance);
        assert.equal(spendLedger(session.hub.userId), 1);
        assert.equal(sessionEarned(session.hub.userId, session.sessionId), earned);
        assert.equal(dayTickets(session.hub.userId), day);
        assert.equal(itemSnapshot(session.hub.userId), held);
      }
    });

    await runner.test('wallet', 'pb sell whose credit is at least 1 succeeds', async () => {
      const rpc = sellRpc();
      if (!rpc) throw new Error('sell RPC disappeared');
      const item = loadItems().find((row) => row.sellPrice !== null && sellCredit(row.sellPrice, 1) >= 1 && row.price > 0 && row.price <= sessionPurse());
      if (!item || item.sellPrice === null) throw new Error('no seeded row sells for 1 or more Tickets');
      const credit = sellCredit(item.sellPrice, 1);
      const session = await login(GAME);
      const purse = Math.min(sessionPurse(), Math.max(item.price, item.price));
      await fund(session.gameToken, purse, 'shop-sell-one-fund');
      if (sessionEarned(session.hub.userId, session.sessionId) + credit > sessionPurse()) {
        throw new Error(`sell credit ${credit} does not fit the remaining session cap`);
      }
      const bought = await spend(session.gameToken, item, 1, 'shop-sell-one-buy');
      assert.equal(bought.body.error, undefined, JSON.stringify(bought.body));
      const afterBuy = ticketBalance(session.hub.userId, GAME);
      const sold = await call(rpc, spendBody(item.shopId, item.itemId, 1, 'shop-sell-one'), session.gameToken);
      assert.equal(sold.body.error, undefined, JSON.stringify(sold.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), afterBuy + credit);
      assert.ok(ticketBalance(session.hub.userId, GAME) < purse);
    });

    await runner.test('wallet', 'pb sell over the session cap is rejected whole', async () => {
      const rpc = sellRpc();
      if (!rpc) throw new Error('sell RPC disappeared');
      const item = loadItems().find((row) => row.sellPrice !== null && sellCredit(row.sellPrice, 1) >= 1 && row.price > 0 && row.price <= sessionPurse());
      if (!item || item.sellPrice === null) throw new Error('no seeded row sells for 1 or more Tickets');
      const session = await login(GAME);
      await fund(session.gameToken, sessionPurse(), 'shop-sell-cap-fund');
      const bought = await spend(session.gameToken, item, 1, 'shop-sell-cap-buy');
      assert.equal(bought.body.error, undefined, JSON.stringify(bought.body));
      const balance = ticketBalance(session.hub.userId, GAME);
      const held = itemSnapshot(session.hub.userId);
      const ledger = num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(session.hub.userId)}'`);
      const sold = await call(rpc, spendBody(item.shopId, item.itemId, 1, 'shop-sell-cap'), session.gameToken);
      assert.equal(sold.body.error, 'session_ticket_cap', JSON.stringify(sold.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), balance);
      assert.equal(num(`SELECT count(*) FROM game.tickets_ledger WHERE user_id = '${sqlId(session.hub.userId)}'`), ledger);
      assert.equal(idempotencyRows(session.hub.userId, 'shop-sell-cap'), 0);
      assert.equal(itemSnapshot(session.hub.userId), held);
    });
  }

  if (!spendSdkMethod()) {
    for (const [category, name] of OUTBOX_CASES) runner.pending(category, name, OUTBOX_REASON);
  } else {
    await runner.test('outbox', 'pb.tickets_spend reload drains the lost response once', () => spendOutbox());
  }

  if (!hookLanded('spend.before_rpc')) {
    runner.pending('fault', 'pb.tickets_spend before_rpc rolls back', HOOK_REASON);
  } else {
    await runner.test('fault', 'pb.tickets_spend before_rpc rolls back', async () => {
      const item = cheapest();
      const session = await login(GAME);
      await fund(session.gameToken, sessionPurse(), 'shop-fund-before');
      arm(session.hub.userId, 'spend.before_rpc', 'raise');
      try {
        const result = await spend(session.gameToken, item, 1, 'shop-before');
        if (!faulted(result)) throw new Error(`spend.before_rpc did not fire: ${JSON.stringify(result.body)}`);
        unchanged(session.hub.userId, sessionPurse(), 0, 0);
      } finally {
        disarm(session.hub.userId);
      }
      const replay = await spend(session.gameToken, item, 1, 'shop-before');
      assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
      assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    });
  }

  if (!hookLanded('spend.after_commit')) {
    runner.pending('fault', 'pb.tickets_spend after_commit stays charged', HOOK_REASON);
  } else {
    await runner.test('fault', 'pb.tickets_spend after_commit stays charged', async () => {
      const item = cheapest();
      const session = await login(GAME);
      await fund(session.gameToken, sessionPurse(), 'shop-fund-after');
      arm(session.hub.userId, 'spend.after_commit', 'raise');
      try {
        const result = await spend(session.gameToken, item, 1, 'shop-after');
        if (!faulted(result)) throw new Error(`spend.after_commit did not fire: ${JSON.stringify(result.body)}`);
        assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
        assert.equal(spendLedger(session.hub.userId), 1);
      } finally {
        disarm(session.hub.userId);
      }
      const replay = await spend(session.gameToken, item, 1, 'shop-after');
      assert.equal(replay.body.error, undefined, JSON.stringify(replay.body));
      assert.equal(spendLedger(session.hub.userId), 1);
      assert.equal(ticketBalance(session.hub.userId, GAME), sessionPurse() - item.price);
    });
  }

  const csvPath = path.join(ROOT, 'server/test/dup/pb_shop_prices.csv');
  if (!existsSync(csvPath)) {
    runner.pending(
      'wallet',
      'pb shop_price matches pb_shop_prices.csv row for row',
      'waiting for server/test/dup/pb_shop_prices.csv v3 (100 data rows: game, shop_id, item_id, name, pack_size, pb_price, ticket_price, sell_price)',
    );
  } else {
    await runner.test('wallet', 'pb shop_price matches pb_shop_prices.csv row for row', async () => {
      const csv = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
      const header = csv[0]?.split(',') ?? [];
      const expected = ['game', 'shop_id', 'item_id', 'name', 'pack_size', 'pb_price', 'ticket_price', 'sell_price'];
      assert.deepEqual(header, expected);
      assert.equal(csv.length - 1, 100, `csv has ${csv.length - 1} rows`);
      const seeded = new Map(loadItems().map((row) => [`${row.shopId}|${row.itemId}`, row]));
      assert.equal(seeded.size, 100, `shop_price has ${seeded.size} peoples-bitcoin rows`);
      for (const line of csv.slice(1)) {
        const [game, shopId, itemId, name, packSize, , ticketPrice, sellPrice] = line.split(',');
        assert.equal(game, GAME, line);
        const row = seeded.get(`${shopId}|${itemId}`);
        if (!row) throw new Error(`missing seed ${shopId}|${itemId}`);
        assert.equal(row.name, name, line);
        assert.equal(row.packSize, Number(packSize), line);
        assert.equal(row.price, Number(ticketPrice), line);
        assert.equal(row.sellPrice, Number(sellPrice), line);
      }
    });
  }
}

async function spendOutbox(): Promise<void> {
  const method = spendSdkMethod();
  const item = cheapest();
  if (!method) throw new Error('tickets.spend left the hub-sdk');
  await import('fake-indexeddb/auto');
  const calls: string[] = [];
  const dropOnce = new Set<string>();
  const client = createNakamaClient({
    serverUrl: 'http://127.0.0.1:7350',
    fetchImpl: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      const marker = '/v2/rpc/';
      const at = url.indexOf(marker);
      const rpc = at < 0 ? '' : decodeURIComponent(url.slice(at + marker.length).split('?')[0] ?? '');
      let key = '';
      if (typeof init?.body === 'string') {
        try {
          key = String((JSON.parse(init.body) as { key?: string }).key ?? '');
        } catch {
          key = '';
        }
      }
      const id = `${rpc}:${key}`;
      if (key) calls.push(id);
      const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20_000) });
      if (key && dropOnce.has(id)) {
        dropOnce.delete(id);
        await response.arrayBuffer();
        throw new TypeError(`response lost ${id}`);
      }
      return response;
    },
  });
  const who = await guest();
  const opened = await call('portal.enter', { game: GAME, ranked: false }, who.token);
  if (!opened.body.ticket) throw new Error(JSON.stringify(opened.body));
  let hash = `#t=${opened.body.ticket}`;
  const session = memoryKeyValue();
  const env: HubSdkEnv = {
    serverUrl: 'http://127.0.0.1:7350',
    client,
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
  };
  const sdk = createHubSdk(env);
  const profile = await sdk.init(GAME);
  if (!profile.playerId) throw new Error('init did not return a player');
  const fundAmount = item.price;
  await sdk.earnTickets(fundAmount, 'pb_drop', 'shop-outbox-fund');
  const key = 'shop-outbox-spend';
  dropOnce.add(`tickets.spend:${key}`);
  const spendFn = (sdk as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[method];
  if (!spendFn) throw new Error(`hub-sdk has no ${method}`);
  await assert.rejects(() => spendFn.call(sdk, item.shopId, item.itemId, 1, key));
  let hash2 = '';
  const again = createHubSdk({
    ...env,
    local: memoryKeyValue(),
    session,
    readHash: () => hash2,
    writeHash: (next: string) => {
      hash2 = next;
    },
  });
  await again.init(GAME);
  assert.ok(calls.filter((entry) => entry === `tickets.spend:${key}`).length >= 2);
  assert.equal(spendLedger(profile.playerId), 1);
  assert.equal(ticketBalance(profile.playerId, GAME), fundAmount - item.price);
  assert.equal(
    num(`SELECT count(*) FROM game.idempotency WHERE user_id = '${sqlId(profile.playerId)}' AND key = '${key}'`),
    1,
  );
}
