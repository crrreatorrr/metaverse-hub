namespace HubShop {
  // TODO: replace server/data/shop_price.peoples-bitcoin.json with the PB agent's real table.
  // Rows are stored under game id peoples-bitcoin. Re-running this upsert changes prices without a code change.
  export var GAME = "peoples-bitcoin";

  export function seedSql(): string {
    return "INSERT INTO game.shop_price (game, item_id, price, sell_price) VALUES ('peoples-bitcoin', 'placeholder_cap', 25, 5), ('peoples-bitcoin', 'placeholder_poster', 40, 8), ('peoples-bitcoin', 'placeholder_sold_out', NULL, 12) ON CONFLICT (game, item_id) DO UPDATE SET price = EXCLUDED.price, sell_price = EXCLUDED.sell_price";
  }
}
