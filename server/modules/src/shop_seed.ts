namespace HubShop {
  // TODO: replace server/data/shop_price.peoples-bitcoin.json with the PB agent's real table.
  // Rows are stored under game id pb. peoples-bitcoin is the play slug, not a second game id.
  export var GAME = "pb";

  export function seedSql(): string {
    return "INSERT INTO game.shop_price (game, item_id, price, sell_price) VALUES ('pb', 'placeholder_cap', 25, 5), ('pb', 'placeholder_poster', 40, 8), ('pb', 'placeholder_sold_out', NULL, 12) ON CONFLICT (game, item_id) DO UPDATE SET price = EXCLUDED.price, sell_price = EXCLUDED.sell_price";
  }
}
