// Load-time registry of the games' server pieces (Contract C4). A game file in
// src/games/ calls HubGames.register(...) at top level; this runs in every JS VM
// (RPC, match and matchmaker VMs), so every lookup sees every game.
namespace HubGames {
  export interface GameReg {
    /** Contract C1 game id: nobu, sproto, sproto-fighter, peoples-bitcoin, hpos10i. */
    game: string;
    /** Called by the single hub matchmaker dispatcher when every matched entry has properties.game === game. */
    matchmaker?: (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, matches: nkruntime.MatchmakerResult[]) => string | void;
    /** Channel rooms game-scope sessions of this game may join. None for sproto/PB in the MVP. */
    chatRooms?: RegExp[];
    /**
     * Hub-scope sessions may add matchmaker tickets for this game. Only for games
     * that run on the hub session (Sproto Fighter); everything else matchmakes
     * with its game-scope session.
     */
    hubScope?: boolean;
  }

  /** Plaza rooms: hub.<shard>. */
  export var HUB_ROOM = { test: HubRealms.isRoom };

  var regs: { [game: string]: GameReg } = {};
  var order: string[] = [];

  /** Call at top level of the game file. A duplicate game id throws. */
  export function register(reg: GameReg): void {
    if (!reg || typeof reg.game !== "string" || !reg.game) throw new Error("hub_games_bad_registration");
    if (regs[reg.game]) throw new Error("hub_games_duplicate " + reg.game);
    regs[reg.game] = reg;
    order.push(reg.game);
  }

  export function matchmakerFor(game: string): GameReg["matchmaker"] | null {
    var reg = regs[game];
    return reg && reg.matchmaker ? reg.matchmaker : null;
  }

  /** Whether a session of this scope/game may add a matchmaker ticket with properties.game === target. */
  export function matchmakingAllowed(scope: string, sessionGame: string, target: string): boolean {
    var reg = regs[target];
    if (!reg || !reg.matchmaker) return false;
    if (scope === "game") return sessionGame === target;
    if (scope === "hub" || scope === "") return reg.hubScope === true;
    return false;
  }

  /**
   * Whether a session may join a channel room. Hub scope (or a session with no
   * scope var) may join hub.<shard>; game scope only the rooms its game registered.
   */
  export function roomAllowed(scope: string, game: string, room: string): boolean {
    if (typeof room !== "string" || !room || room.length > 64) return false;
    if (scope === "hub" || scope === "") return HUB_ROOM.test(room);
    if (scope !== "game") return false;
    var reg = regs[game];
    if (!reg || !reg.chatRooms) return false;
    for (var i = 0; i < reg.chatRooms.length; i++) {
      reg.chatRooms[i].lastIndex = 0;
      if (reg.chatRooms[i].test(room)) return true;
    }
    return false;
  }

  /** Registered game ids, in registration order. */
  export function list(): string[] {
    return order.slice();
  }
}
