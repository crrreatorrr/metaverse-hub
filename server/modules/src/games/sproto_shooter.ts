// Sproto Shooter (crrreatorrr/sproto-shooter).
//
// No Relic, no Ticket earn, and no leaderboard. The client may redeem a portal ticket and read a balance.
// Online play is not registered here.
//
// One migration covers both new ids. 0036 stays reserved for NOBU. 0038 stays
// unregistered because an unmerged patch proposed it. This id is the next free one.
namespace SprotoShooter {
  export var GAME_ID = "sproto-shooter";
  export var ENTRY = "ring";
}

HubGames.register({ game: SprotoShooter.GAME_ID });

HubSchema.register({
  id: "0039_sproto_shooter_coop",
  statements: [
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle'))",
    "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
    "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle'))",
  ],
});
