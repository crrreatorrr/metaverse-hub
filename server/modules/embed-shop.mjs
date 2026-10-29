import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(dir, '../data/shop_price.peoples-bitcoin.json'),
  join(dir, 'data/shop_price.peoples-bitcoin.json'),
];

let raw = '';
for (const path of candidates) {
  try {
    raw = readFileSync(path, 'utf8');
    break;
  } catch {
    raw = '';
  }
}
if (!raw) throw new Error('shop_price.peoples-bitcoin.json was not found');

const rows = JSON.parse(raw);
if (!Array.isArray(rows) || rows.length === 0) throw new Error('shop price file must be a non-empty array');

const game = 'peoples-bitcoin';
const values = rows.map((row) => {
  if (!row || typeof row !== 'object') throw new Error('shop price row must be an object');
  const item = row.item_id;
  if (typeof item !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(item)) {
    throw new Error(`bad item_id ${String(item)}`);
  }
  const sell = row.sell_price;
  const price = row.price;
  if (typeof sell !== 'number' || !Number.isInteger(sell) || sell < 0) throw new Error(`bad sell_price for ${item}`);
  if (price !== null && (typeof price !== 'number' || !Number.isInteger(price) || price < 0)) {
    throw new Error(`bad price for ${item}`);
  }
  if (price !== null && sell >= price) throw new Error(`sell_price must be below price for ${item}`);
  const priceSql = price === null ? 'NULL' : String(price);
  return `('${game}', '${item}', ${priceSql}, ${sell})`;
});

const sql =
  'INSERT INTO game.shop_price (game, item_id, price, sell_price) VALUES ' +
  values.join(', ') +
  ' ON CONFLICT (game, item_id) DO UPDATE SET price = EXCLUDED.price, sell_price = EXCLUDED.sell_price';

const source = `namespace HubShop {
  // TODO: replace server/data/shop_price.peoples-bitcoin.json with the PB agent's real table.
  // Rows are stored under game id peoples-bitcoin. Re-running this upsert changes prices without a code change.
  export var GAME = "${game}";

  export function seedSql(): string {
    return ${JSON.stringify(sql)};
  }
}
`;

writeFileSync(join(dir, 'src/shop_seed.ts'), source);
