// Realtime routing and scope checks. Nakama allows one matchmaker hook, so
// main.ts registers hubMatchmakerMatched, which routes here by
// matches[0].properties.game through the HubGames registry (Contract C4).
namespace HubRt {
  function scopeOf(ctx: nkruntime.Context): string {
    return ctx.vars && ctx.vars.scope ? ctx.vars.scope : "";
  }

  /** Every entry must share properties.game; mixed or unknown games create nothing. */
  export function onMatched(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]): string | void {
    if (!matches || !matches.length) return undefined;
    var game = String(matches[0].properties && matches[0].properties["game"] !== undefined ? matches[0].properties["game"] : "");
    for (var i = 1; i < matches.length; i++) {
      var other = String(matches[i].properties && matches[i].properties["game"] !== undefined ? matches[i].properties["game"] : "");
      if (other !== game) {
        logger.warn("matchmaker mixed games " + game + " / " + other);
        return undefined;
      }
    }
    var fn = HubGames.matchmakerFor(game);
    if (!fn) {
      logger.warn("matchmaker no game " + game);
      return undefined;
    }
    return fn(ctx, logger, nk, matches);
  }

  /**
   * Game scope: properties.game must equal ctx.vars.game. Hub scope: only games
   * registered with hubScope (Sproto Fighter). Anything else is rejected.
   */
  export function beforeMatchmakerAdd(ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, envelope: nkruntime.Envelope): nkruntime.Envelope {
    var add = envelope.matchmakerAdd;
    if (!add || !ctx.userId) throw new Error("wrong_scope");
    var props = add.stringProperties || {};
    var target = typeof props.game === "string" ? props.game : "";
    var scope = scopeOf(ctx);
    var game = ctx.vars && ctx.vars.game ? ctx.vars.game : "";
    if (!target) throw new Error("bad_game");
    if (scope === "game" && game !== target) throw new Error("wrong_game");
    if (!HubGames.matchmakingAllowed(scope, game, target)) throw new Error("wrong_scope");
    return envelope;
  }

  /** Only authoritative matches exist; clients cannot create relayed ones. */
  export function beforeMatchCreate(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _envelope: nkruntime.Envelope): nkruntime.Envelope {
    throw new Error("match_create_disabled");
  }
}
