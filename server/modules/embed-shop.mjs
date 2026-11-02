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

function ident(value, label) {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(value)) throw new Error(`bad ${label} ${value}`);
  return value;
}

const rows = [];
const seen = new Set();
for (const record of parseCsv(readFileSync(join(dataDir, 'pb_shop_prices.csv'), 'utf8'))) {
  const game = ident(record.game, 'game');
  const shopId = ident(record.shop_id, 'shop_id');
  const itemId = ident(record.item_id, 'item_id');
  const key = `${game}:${shopId}:${itemId}`;
  if (seen.has(key)) throw new Error(`duplicate shop row ${key}`);
  seen.add(key);
  const packSize = Number(record.pack_size);
  const price = Number(record.ticket_price);
  const sellPrice = Number(record.sell_price);
  if (!Number.isInteger(packSize) || packSize < 1) throw new Error(`bad pack_size for ${key}`);
  if (!Number.isInteger(price) || price < 1) throw new Error(`bad ticket_price for ${key}`);
  if (!Number.isInteger(sellPrice) || sellPrice < 0 || sellPrice >= price) {
    throw new Error(`sell_price must be below price for ${key}`);
  }
  rows.push({ game, shopId, itemId, packSize, price, sellPrice });
}
rows.sort((a, b) => a.shopId.localeCompare(b.shopId) || a.itemId.localeCompare(b.itemId));

const values = rows.map(
  (row) => `('${row.game}', '${row.shopId}', '${row.itemId}', ${row.packSize}, ${row.price}, ${row.sellPrice})`,
);
const keys = rows.map((row) => `('${row.game}', '${row.shopId}', '${row.itemId}')`).join(', ');
const insert =
  'INSERT INTO game.shop_price (game, shop_id, item_id, pack_size, price, sell_price) VALUES ' +
  values.join(', ') +
  ' ON CONFLICT (game, shop_id, item_id) DO UPDATE SET pack_size = EXCLUDED.pack_size, price = EXCLUDED.price, sell_price = EXCLUDED.sell_price';
const prune =
  `DELETE FROM game.shop_price WHERE (game, shop_id, item_id) NOT IN (${keys})`;

const source = `namespace HubShop {
  // Built from server/data/pb_shop_prices.csv. Replace that file and redeploy to rebalance.
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
  .map(
    (row) =>
      `  '${row.shopId}:${row.itemId}': { shopId: '${row.shopId}', itemId: '${row.itemId}', packSize: ${row.packSize}, price: ${row.price}, sellPrice: ${row.sellPrice} },`,
  )
  .join('\n');
const sdk = `/** Generated from server/data/pb_shop_prices.csv. Do not edit by hand. */
export interface PbShopRow {
  shopId: string;
  itemId: string;
  packSize: number;
  price: number;
  sellPrice: number;
}

export const PB_SHOP: Record<string, PbShopRow> = {
${catalog}
};

export function pbShopRow(shopId: string, itemId: string): PbShopRow | undefined {
  return PB_SHOP[shopId + ':' + itemId];
}
`;
const sdkPath = join(dir, '../../packages/hub-sdk/src/pbShop.ts');
try {
  writeFileSync(sdkPath, sdk);
} catch (error) {
  if (!error || error.code !== 'ENOENT') throw error;
}
console.log(`shop seed ${rows.length} rows`);
