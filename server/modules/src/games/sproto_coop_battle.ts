// Sproto Coop Battle (crrreatorrr/Sproto-Coop-Battle. — the trailing dot is the repo name).
//
// Bar cabinet game, the same kind as Sproto Fighter and Sproto Arcade. It has no plaza
// portal. The machine menu does not list it in this phase. No Relic, no Ticket earn,
// and no leaderboard. Session and auth-ticket scope are widened by 0039_sproto_shooter_coop.
namespace SprotoCoopBattle {
  export var GAME_ID = "sproto-coop-battle";
  export var ENTRY = "cabinet";
}

HubGames.register({ game: SprotoCoopBattle.GAME_ID });
