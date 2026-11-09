// Shooter 1v1 escrow. Fixed 10 Tickets a seat, pot 20, no mint and no fee.
// The wallet is sproto-shooter only. Fighter escrow is not called and not changed.
//
// Ken (Nov 7 2026): moving Tickets between accounts with these wagers is allowed.
// There is no pair-per-day cap, no daily winnings cap, and no anomaly flag.
// What stays: signed-in accounts, no guests, no CPU seat, one active hold per
// account, both debits and the hold in one transaction, immutable participants
// and rule hash, authoritative KO, a forfeit only after both are ready and a
// valid 10s stall, refunds for a draw / both absent / server or version
// mismatch / ready timeout, and held -> settled|refunded exactly once.
//
// shooter_pvp and shooter_pvp_wager both stay off (migration 0042). A match
// escrows only when both are on for both accounts. Turning them off stops new
// holds. Rows already held still settle or refund once.
//
// Recovery does not wait for a new queue. Boot refunds every held row (one
// Nakama node: a restart killed the match). A 1 Hz sweep match, and
// scripts/ops/sweep-shooter-wagers.mjs, refund rows older than 20 minutes
// (10 minute match max plus 10 minutes of grace).

namespace ShooterWagers {
  export var STAKE = 10;
  export var POT = 20;
  export var GAME_ID = "sproto-shooter";
  export var FLAG_PVP = "shooter_pvp";
  export var FLAG_WAGER = "shooter_pvp_wager";
  /** 10 minute authoritative match plus 10 minutes of grace. Longer than a live hold. */
  export var EXPIRE_AGE = "1200 seconds";
  export var SWEEP_EVERY_MS = 5 * 60 * 1000;
  export var SWEEP_MATCH = "shooter_wager_sweep";
  /** Wagers cap rewind at the pin's max RTT. Free matches leave the ceiling unset. */
  export var RTT_CEILING_MS = 1000;
  var SWEEP_KEY = "shooter:wager_sweep:last";

  export interface MoneyPlan {
    op: string;
    reason: string;
    winnerSeat: number | null;
  }

  /** Both launch flags, for this account. A missing row or a failed read is off. */
  export function enabled(nk: nkruntime.Nakama, userId: string, logger: nkruntime.Logger): boolean {
    if (!userId) return false;
    return Flags.on(nk, FLAG_PVP, userId, logger) && Flags.on(nk, FLAG_WAGER, userId, logger);
  }

  /** The text whose sha256 is stored on the hold. A changed pin is a different rule. */
  export function ruleText(): string {
    return ShooterProto.GAME_ID
      + "|wager|v1|stake=10|pot=20|fee=0|mint=0|protocol=" + String(ShooterProto.PROTOCOL)
      + "|sim=" + String(ShooterProto.SIM)
      + "|content=" + ShooterProto.FINGERPRINT
      + "|loadout=" + ShooterProto.LOADOUT_HASH;
  }

  export function ruleHash(nk: nkruntime.Nakama): string {
    return nk.sha256Hash(ruleText());
  }

  function asObject(value: unknown): { [key: string]: unknown } {
    if (typeof value === "string") {
      try {
        var parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === "object") return parsed as { [key: string]: unknown };
      } catch (_e) {
        return { error: "bad_receipt" };
      }
    }
    if (value && typeof value === "object") return value as { [key: string]: unknown };
    return { error: "bad_receipt" };
  }

  function call(nk: nkruntime.Nakama, query: string, args: unknown[]): { [key: string]: unknown } {
    var rows = nk.sqlQuery(query, args);
    var value = rows && rows.length ? rows[0]["r"] : null;
    if (value === null || value === undefined) return { error: "bad_receipt" };
    return asObject(value);
  }

  export function hold(nk: nkruntime.Nakama, matchId: string, a: string, b: string, hash: string): { [key: string]: unknown } {
    return call(nk, "SELECT game.shooter_wager_hold($1, $2::uuid, $3::uuid, $4)::text AS r", [matchId, a, b, hash]);
  }

  /** Seat 0 is player_a and seat 1 is player_b. SQL maps the seat; the caller does not pass an account. */
  export function settle(nk: nkruntime.Nakama, matchId: string, seat: number, reason: string): { [key: string]: unknown } {
    return call(nk, "SELECT game.shooter_wager_settle($1, $2::int, $3)::text AS r", [matchId, seat, reason]);
  }

  export function refund(nk: nkruntime.Nakama, matchId: string, reason: string): { [key: string]: unknown } {
    return call(nk, "SELECT game.shooter_wager_refund($1, $2)::text AS r", [matchId, reason]);
  }

  /**
   * What the ledger may do with a director result. A draw, a cancel, or an
   * unverified KO refunds. A forfeit pays only when the replay says the 10s
   * stall is consistent (settle_director) and only the match layer calls this
   * after both players were ready. Terminal evidence wins: the caller invokes
   * this once, then ignores a later disconnect.
   */
  export function plan(outcome: string, reason: string, winner: number | null, policy: string, verified: boolean): MoneyPlan {
    if (outcome === "draw") {
      return { op: "refund", reason: reason === "both_stall" ? "both_absent" : "draw", winnerSeat: null };
    }
    if (!outcome || outcome === "cancel") {
      var why = reason === "ready_timeout" ? "ready_timeout"
        : (reason === "no_combat_seed" || reason === "version" || reason === "version_mismatch") ? "version_mismatch"
        : "server_shutdown";
      return { op: "refund", reason: why, winnerSeat: null };
    }
    var winnerOk = winner === 0 || winner === 1;
    if (verified && outcome === "forfeit" && reason === "stall" && winnerOk && policy === "settle_director") {
      return { op: "settle", reason: "forfeit", winnerSeat: winner };
    }
    if (verified && outcome === "ko" && reason === "ko" && winnerOk && policy === "settle") {
      return { op: "settle", reason: "ko", winnerSeat: winner };
    }
    if (verified && outcome === "time" && reason === "time" && winnerOk && policy === "settle") {
      return { op: "settle", reason: "time", winnerSeat: winner };
    }
    if (policy === "review") return { op: "refund", reason: "replay_review", winnerSeat: null };
    return { op: "refund", reason: "replay_refuse", winnerSeat: null };
  }

  function expireHeld(nk: nkruntime.Nakama, age: string): number {
    var rows = nk.sqlQuery("SELECT game.shooter_wager_expire(interval '" + age + "') AS n", []);
    return rows && rows.length ? Number(rows[0]["n"]) || 0 : 0;
  }

  /**
   * Once from InitModule, after HubSchema.apply. Single-node: no Shooter match
   * is still running, so every held row belongs to a match that died.
   */
  export function expireAllHeldAtBoot(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    try {
      var n = expireHeld(nk, "0");
      logger.info("shooter wager boot sweep refunded " + String(n) + " held wager(s)");
    } catch (e) {
      logger.error("shooter wager boot sweep failed " + String(e));
    }
  }

  /** At most one periodic refund per SWEEP_EVERY_MS on this node. The SQL is safe to repeat. */
  export function maybeSweep(nk: nkruntime.Nakama, logger: nkruntime.Logger, nowMs: number): boolean {
    var last = Number(nk.localcacheGet(SWEEP_KEY) || 0);
    if (!last) {
      nk.localcachePut(SWEEP_KEY, nowMs, 0);
      return false;
    }
    if (nowMs - last < SWEEP_EVERY_MS) return false;
    nk.localcachePut(SWEEP_KEY, nowMs, 0);
    var n = expireHeld(nk, EXPIRE_AGE);
    if (n > 0) logger.info("shooter wager sweep refunded " + String(n) + " held wager(s)");
    return true;
  }

  export interface SweepState { on: number }

  /** Always-on match. Nobody can join. The loop is the schedule, not a queue. */
  export var sweepHandler: nkruntime.MatchHandler<SweepState> = {
    matchInit: function () {
      return { state: { on: 1 }, tickRate: 1, label: JSON.stringify({ kind: SWEEP_MATCH }) };
    },
    matchJoinAttempt: function (_ctx, _logger, _nk, _d, _tick, state) {
      return { state: state, accept: false, rejectMessage: "not_a_player" };
    },
    matchJoin: function (_ctx, _logger, _nk, _d, _tick, state) {
      return { state: state };
    },
    matchLeave: function (_ctx, _logger, _nk, _d, _tick, state) {
      return { state: state };
    },
    matchLoop: function (_ctx, logger, nk, _d, _tick, state) {
      try {
        maybeSweep(nk, logger, Date.now());
      } catch (e) {
        logger.warn("shooter wager sweep failed " + String(e));
      }
      return { state: state };
    },
    matchTerminate: function (_ctx, _logger, _nk, _d, _tick, state) {
      return { state: state };
    },
    matchSignal: function (_ctx, _logger, _nk, _d, _tick, state) {
      return { state: state, data: "" };
    },
  };
}

function bootShooterWagers(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
  ShooterWagers.expireAllHeldAtBoot(nk, logger);
}

function shooterWagerSweepInit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: { [key: string]: unknown }) {
  return ShooterWagers.sweepHandler.matchInit(ctx, logger, nk, params);
}
function shooterWagerSweepJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterWagers.SweepState, presence: nkruntime.Presence, metadata: { [key: string]: unknown }) {
  return ShooterWagers.sweepHandler.matchJoinAttempt(ctx, logger, nk, d, tick, state, presence, metadata);
}
function shooterWagerSweepJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterWagers.SweepState, presences: nkruntime.Presence[]) {
  return ShooterWagers.sweepHandler.matchJoin(ctx, logger, nk, d, tick, state, presences);
}
function shooterWagerSweepLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterWagers.SweepState, presences: nkruntime.Presence[]) {
  return ShooterWagers.sweepHandler.matchLeave(ctx, logger, nk, d, tick, state, presences);
}
function shooterWagerSweepLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterWagers.SweepState, messages: nkruntime.MatchMessage[]) {
  return ShooterWagers.sweepHandler.matchLoop(ctx, logger, nk, d, tick, state, messages);
}
function shooterWagerSweepTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterWagers.SweepState, grace: number) {
  return ShooterWagers.sweepHandler.matchTerminate(ctx, logger, nk, d, tick, state, grace);
}
function shooterWagerSweepSignal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, d: nkruntime.MatchDispatcher, tick: number, state: ShooterWagers.SweepState, data: string) {
  return ShooterWagers.sweepHandler.matchSignal(ctx, logger, nk, d, tick, state, data);
}
