/**
 * Crash points for the duplication suite. Inert unless the runtime env
 * HUB_FAULT_INJECT=1 and the test harness has armed game.fault_arm for this
 * user and point. Production deploys leave the env unset, so apply() returns
 * before it touches the database.
 */
namespace HubFault {
  function enabled(ctx: nkruntime.Context): boolean {
    return ctx.env !== undefined && ctx.env.HUB_FAULT_INJECT === "1";
  }

  function consume(ctx: nkruntime.Context, nk: nkruntime.Nakama, userId: string, point: string): string {
    if (!enabled(ctx) || !userId) return "";
    var rows = nk.sqlQuery(
      "UPDATE game.fault_arm SET remaining = remaining - 1 WHERE user_id = $1::uuid AND point = $2 AND remaining > 0 RETURNING mode",
      [userId, point],
    );
    if (!rows || !rows.length) return "";
    var mode = rows[0].mode;
    return typeof mode === "string" ? mode : "";
  }

  /** Raise or sleep after the arm row is consumed. Sleep keeps the process in the RPC so a test can kill it. */
  export function apply(ctx: nkruntime.Context, nk: nkruntime.Nakama, userId: string, point: string): void {
    var mode = consume(ctx, nk, userId, point);
    if (mode === "") return;
    if (mode === "sleep") {
      nk.sqlQuery("SELECT set_config('application_name', $1, true), pg_sleep(45)", ["hf:" + userId + ":" + point]);
      return;
    }
    throw new Error("fault_injected:" + point);
  }
}
