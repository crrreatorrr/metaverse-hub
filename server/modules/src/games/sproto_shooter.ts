// Sproto Shooter (crrreatorrr/sproto-shooter).
//
// Dark registration: a portal ticket and a game session, nothing else.
// No plaza ring, no Relic, no Ticket earn, no leaderboard, no match.
// Migration 0039 also admits sproto-coop-battle. 0036 and 0038 stay unused.
namespace SprotoShooter {
  export var GAME_ID = "sproto-shooter";
}

HubGames.register({ game: SprotoShooter.GAME_ID });

HubSchema.register({
  id: "0039_dark_game_ids",
  statements: [
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle'))",
    "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
    "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter', 'sproto-coop-battle'))",
  ],
});
