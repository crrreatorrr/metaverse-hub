// Sproto Shooter (crrreatorrr/sproto-shooter).
//
// No client Ticket earn and no client leaderboard. The client may redeem a portal ticket and read a balance.
// Clearing wave 1 of Wave Mode grants the Dragon Scale Relic (`shooter.wave_clear` with `{ wave: 1 }`,
// migration 0045 in games/stage_relics.ts). Online play is not registered here.
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
