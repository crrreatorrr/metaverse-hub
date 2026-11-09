// Two live Relics for the Bar's newer games (owner decision, November 2026).
//
//   marina_anchor  Sproto Coop Battle (sproto-coop-battle). Clearing stage 1, Tidebreak Marina
//                  (boss 01-marina-bront). The client reports `coop.stage_clear` with
//                  `{ "stage": 1 }` from local and hosted games. The authoritative Coop match also
//                  grants it to each human account at a banked stage-1 clear (CoopMatch.applyPay).
//   dragon_scale   Sproto Shooter (sproto-shooter). Clearing wave 1 of Wave Mode. The client reports
//                  `shooter.wave_clear` with `{ "wave": 1 }`. There is no server evidence for Wave
//                  Mode, so this is a client report only.
//
// Both are live grants (grant_hold = false), like the Breakwater Coin. God Mode counts: the rule is a
// subset match, so extra fields such as `godMode` do not block it. Neither pays Tickets, counts toward
// the Four Lights, the Hall of Champions or the Four Lights pet, or unlocks an item in another game.
// `coop.boss_clear` and `shooter.boss_clear` stay server-only (CoopRewards / ShooterRewards).
//
// Migration 0045 follows main's 0042_server_flags (0043 and 0044 are claimed by open PRs). It widens the Relic checks and
// game_beaten (claim_event_relic writes a game_beaten row on a live grant) and adds the two rules.
namespace StageRelics {
  export var COOP_GAME = "sproto-coop-battle";
  export var COOP_RELIC = "marina_anchor";
  export var COOP_EVENT = "coop.stage_clear";
  export var COOP_STAGE = 1;
  /** Canonical boss of Coop stage 1 (CoopRewards.BOSSES[0]). */
  export var COOP_BOSS = "01-marina-bront";

  export var SHOOTER_GAME = "sproto-shooter";
  export var SHOOTER_RELIC = "dragon_scale";
  export var SHOOTER_EVENT = "shooter.wave_clear";
  export var SHOOTER_WAVE = 1;

  /**
   * Server grant for a banked Coop stage-1 clear. Same SQL path as a client report
   * (game.claim_event_relic), so it is earn-once per account: relic_claim, one grant_relic
   * item_ledger row and game_beaten on the first clear, nothing on later ones. No Tickets.
   * Returns the Relic id when this call granted it, or "" when the account already had it.
   */
  export function grantCoopClear(nk: nkruntime.Nakama, userId: string, sessionId: string): string {
    var rows = nk.sqlQuery(
      "SELECT COALESCE(game.claim_event_relic($1::uuid, $2::uuid, $3::text, $4::text, $5::jsonb), '') AS relic",
      [userId, sessionId, COOP_GAME, COOP_EVENT, JSON.stringify({ stage: COOP_STAGE, banked: true })],
    );
    if (!rows || !rows.length) return "";
    var relic = rows[0].relic;
    return typeof relic === "string" ? relic : "";
  }
}

HubSchema.register({
  id: "0045_coop_shooter_relics",
  statements: [
    "ALTER TABLE game.relic_claim DROP CONSTRAINT IF EXISTS relic_claim_known",
    "ALTER TABLE game.relic_claim ADD CONSTRAINT relic_claim_known CHECK (relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown', 'tidebreaker_belt', 'breakwater_coin', 'marina_anchor', 'dragon_scale'))",
    "ALTER TABLE game.relic_claim_pending DROP CONSTRAINT IF EXISTS relic_claim_pending_known",
    "ALTER TABLE game.relic_claim_pending ADD CONSTRAINT relic_claim_pending_known CHECK (relic_id IN ('hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown', 'tidebreaker_belt', 'breakwater_coin', 'marina_anchor', 'dragon_scale'))",
    "ALTER TABLE game.game_beaten DROP CONSTRAINT IF EXISTS game_beaten_game",
    "ALTER TABLE game.game_beaten ADD CONSTRAINT game_beaten_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto', 'sproto-fighter', 'sproto-arcade', 'sproto-shooter', 'sproto-coop-battle'))",
    `INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount, rule_key, grant_hold)
     VALUES
       ('sproto-coop-battle', 'coop.stage_clear', 'marina_anchor', NULL, NULL, NULL, '{"stage":1}'::jsonb, NULL, '', false),
       ('sproto-shooter', 'shooter.wave_clear', 'dragon_scale', NULL, NULL, NULL, '{"wave":1}'::jsonb, NULL, '', false)
     ON CONFLICT (game_id, event_type, rule_key) DO NOTHING`,
  ],
});
