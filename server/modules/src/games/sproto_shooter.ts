// Sproto Shooter (crrreatorrr/sproto-shooter). Plaza ring, same portal ticket as the other games.
//
// No Relic and no Ticket earn in this registration. The client redeems `#t=` and can
// read the Ticket balance. Online co-op is not registered here yet.
namespace SprotoShooter {
  export var GAME_ID = "sproto-shooter";
}

HubGames.register({ game: SprotoShooter.GAME_ID });

HubSchema.register({
  id: "0038_sproto_shooter",
  statements: [
    "ALTER TABLE game.game_session DROP CONSTRAINT IF EXISTS game_session_game",
    "ALTER TABLE game.game_session ADD CONSTRAINT game_session_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter'))",
    "ALTER TABLE game.game_beaten DROP CONSTRAINT IF EXISTS game_beaten_game",
    "ALTER TABLE game.game_beaten ADD CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter'))",
    "ALTER TABLE game.auth_ticket DROP CONSTRAINT IF EXISTS auth_ticket_game",
    "ALTER TABLE game.auth_ticket ADD CONSTRAINT auth_ticket_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'vcoin', 'sproto-shooter'))",
  ],
});
