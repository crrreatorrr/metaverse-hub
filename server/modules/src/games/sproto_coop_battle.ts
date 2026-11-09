// Sproto Coop Battle (crrreatorrr/Sproto-Coop-Battle. — the trailing dot is the repo name).
//
// Bar cabinet game, the same kind as Sproto Fighter and Sproto Arcade. It has no plaza
// portal. No client Ticket earn and no client leaderboard. Clearing stage 1 (Tidebreak Marina)
// grants the Marina Anchor Relic: `coop.stage_clear` with `{ stage: 1 }` from the client, and
// the banked online match grants it server-side (migration 0045 in games/stage_relics.ts).
// Session and auth-ticket scope are widened by 0039_sproto_shooter_coop.
namespace SprotoCoopBattle {
  export var GAME_ID = "sproto-coop-battle";
  export var ENTRY = "cabinet";
}

HubGames.register({ game: SprotoCoopBattle.GAME_ID });
