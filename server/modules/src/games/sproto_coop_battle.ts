// Sproto Coop Battle (crrreatorrr/Sproto-Coop-Battle., game id without the repo's trailing dot).
//
// Dark registration: a portal ticket and a game session, nothing else.
// No cabinet entry, no Relic, no Ticket earn, no leaderboard, no match.
// The shared allowlist migration is 0039_dark_game_ids in sproto_shooter.ts.
namespace SprotoCoopBattle {
  export var GAME_ID = "sproto-coop-battle";
}

HubGames.register({ game: SprotoCoopBattle.GAME_ID });
