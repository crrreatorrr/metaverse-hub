import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const dataDir = [join(dir, '../data'), join(dir, 'data')].find((path) => {
  try {
    readFileSync(join(path, 'pb_shop_prices.csv'));
    return true;
  } catch {
    return false;
  }
});
if (!dataDir) throw new Error('pb_shop_prices.csv was not found');

const game = 'peoples-bitcoin';
const packs = { item_rounds: 100, item_coom: 100 };

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      if (row.some((item) => item !== '')) rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((item) => item !== '')) rows.push(row);
  }
  const [header, ...body] = rows;
  return body.map((values) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = values[index] ?? '';
    });
    return record;
  });
}

function itemId(value) {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(value)) throw new Error(`bad item_id ${value}`);
  return value;
}

const seen = new Set();
const rows = [];

for (const record of parseCsv(readFileSync(join(dataDir, 'pb_shop_prices.csv'), 'utf8'))) {
  const id = itemId(record.item_id);
  if (seen.has(id)) throw new Error(`duplicate item_id ${id}`);
  seen.add(id);
  const packSize = packs[id] ?? 1;
  const price = Number(record.ticket_price);
  const sellTickets = Number(record.sell_price);
  if (!Number.isInteger(price) || price < 1) throw new Error(`bad ticket_price for ${id}`);
  if (!Number.isInteger(sellTickets) || sellTickets < 0) throw new Error(`bad sell_price for ${id}`);
  if (sellTickets * 100 % packSize !== 0) throw new Error(`sell_price does not divide into centi for ${id}`);
  const sellCenti = (sellTickets * 100) / packSize;
  if (packSize * sellCenti >= price * 100) throw new Error(`sell value is not below price for ${id}`);
  rows.push({ id, packSize, price, sellCenti });
}

for (const record of parseCsv(readFileSync(join(dataDir, 'pb_sell_only_prices.csv'), 'utf8'))) {
  const id = itemId(record.item_id);
  if (seen.has(id)) throw new Error(`duplicate item_id ${id}`);
  seen.add(id);
  const sellCenti = Number(record.sell_centitickets_per_unit);
  if (!Number.isInteger(sellCenti) || sellCenti < 0) throw new Error(`bad sell_centi for ${id}`);
  rows.push({ id, packSize: 1, price: null, sellCenti });
}

rows.sort((a, b) => a.id.localeCompare(b.id));

const values = rows.map((row) => {
  const priceSql = row.price === null ? 'NULL' : String(row.price);
  return `('${game}', '${row.id}', ${row.packSize}, ${priceSql}, ${row.sellCenti})`;
});
const idList = rows.map((row) => `'${row.id}'`).join(', ');
const insert =
  'INSERT INTO game.shop_price (game, item_id, pack_size, price, sell_centi) VALUES ' +
  values.join(', ') +
  ' ON CONFLICT (game, item_id) DO UPDATE SET pack_size = EXCLUDED.pack_size, price = EXCLUDED.price, sell_centi = EXCLUDED.sell_centi';
const prune =
  `DELETE FROM game.shop_price WHERE game = '${game}' AND item_id NOT IN (${idList})`;

const source = `namespace HubShop {
  // Built from server/data/pb_shop_prices.csv and pb_sell_only_prices.csv.
  // Replacing those files and redeploying updates prices. No code change.
  export var GAME = "${game}";

  export function pruneSql(): string {
    return ${JSON.stringify(prune)};
  }

  export function seedSql(): string {
    return ${JSON.stringify(insert)};
  }
}
`;
writeFileSync(join(dir, 'src/shop_seed.ts'), source);

const catalog = rows
  .map((row) => `  ${row.id}: { packSize: ${row.packSize}, price: ${row.price === null ? 'null' : row.price}, sellCenti: ${row.sellCenti} },`)
  .join('\n');
const sdk = `/** Generated from the People's Bitcoin price CSVs. Do not edit by hand. */
export interface PbShopRow {
  packSize: number;
  price: number | null;
  sellCenti: number;
}

export const PB_SHOP: Record<string, PbShopRow> = {
${catalog}
};
`;
const sdkPath = join(dir, '../../packages/hub-sdk/src/pbShop.ts');
try {
  writeFileSync(sdkPath, sdk);
} catch (error) {
  if (!error || error.code !== 'ENOENT') throw error;
}
console.log(`shop seed ${rows.length} rows`);
