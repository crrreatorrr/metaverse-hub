// Sproto Arcade (the Bar cabinet's second game, crrreatorrr/Sproto-Arcade).
//
// Story mode reports `arcade.boss_defeated` with `{ boss: "bront" }` when the first story boss
// (Fat Head Dave, Tidebreak Marina) falls, god mode included. The server grants the
// Breakwater Coin once. Boss clears outside god mode earn at most 20 Tickets each (`arcade_clear`).
// Progress and unlocked Sprotos use the generic save.get / save.put RPCs.
//
// Migration range for this game: 0025-0029 (Contract C4). Online co-op will register its match
// and matchmaker here; there is none yet.
namespace SprotoArcade {
  export var GAME_ID = "sproto-arcade";
  export var RELIC_ID = "breakwater_coin";
  export var BOSS_EVENT = "arcade.boss_defeated";
  export var CLEAR_REASON = "arcade_clear";
  export var TICKETS_PER_CLEAR = 20;
}

HubGames.register({ game: SprotoArcade.GAME_ID });

HubSchema.register({
  id: "0025_sproto_arcade",
  statements: [
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade'))",
    "ALTER TABLE game.game_beaten DROP CONSTRAINT IF EXISTS game_beaten_game",
    "ALTER TABLE game.game_beaten ADD CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade'))",
    "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
    "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade'))",
    "ALTER TABLE game.relic_claim DROP CONSTRAINT IF EXISTS relic_claim_known",
    "ALTER TABLE game.relic_claim ADD CONSTRAINT relic_claim_known CHECK (relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown', 'tidebreaker_belt', 'breakwater_coin'))",
    `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount)
     VALUES
       ('sproto-arcade', 'arcade.boss_defeated', 'breakwater_coin', NULL, NULL, NULL, '{"boss":"bront"}'::jsonb, NULL),
       ('sproto-arcade', 'arcade_clear', NULL, NULL, NULL, NULL, '{}'::jsonb, 20)
     ON CONFLICT (game_id, event_type) DO NOTHING`,
  ],
});
