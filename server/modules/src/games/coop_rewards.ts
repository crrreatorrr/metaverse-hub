// Server-only Coop boss settlement. The match calls this when a banked stage
// clears. It pays 20 Tickets once per account, game, canonical boss, and the
// UTC day of that terminal clear, under the existing 200-per-session and
// 1000-per-account-per-game-per-day caps. Twelve stages have two phases each.
// Those phases are one clear. Slot count is not a multiplier.
//
// A client cannot name this payout through tickets.earn, session.event, or
// score.submit. No event_rule pays Tickets for this game (0045 adds only the
// Marina Anchor Relic rule, see StageRelics). HubEconomy.earn refuses the
// reason too, so a match cannot mint it outside this function.
namespace CoopRewards {
  export var GAME_ID = "sproto-coop-battle";
  export var BANKED_REASON = "srv_coop_boss_clear";
  export var BANKED_EVENT = "coop.boss_clear";
  export var BOARD_ID = "coop_stage_clear_ms_v1";
  export var PAY = 20;
  export var PROTOCOL = 1;
  // The fingerprint written into game.settle_coop_clear by 0041, which refuses any other.
  // It is not CoopProto.FINGERPRINT (the vendored sim); changing it needs a new migration.
  export var FINGERPRINT = "f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e";
  export var AFK_ALIVE = 300;
  export var SESSION_CAP = 200;
  export var DAILY_CAP = 1000;
  /** 12 bosses * 20. The 200 session cap stops a single session at 10 awards. */
  export var SWEEP = 240;
  export var BOSSES = [
    "01-marina-bront",
    "02-last-light-vela",
    "03-mudline-crapto",
    "04-ranch-zephyr",
    "05-neon-sproto102",
    "06-circuit-rune",
    "07-moonkeep-bigswole",
    "08-crown-alpha777",
    "09-hatchery-highsproto",
    "10-verse-sprotosales",
    "11-rooftop-sproto1668",
    "12-codebreak-sproto3106",
  ];

  export function clientBlocked(name: string): boolean {
    return name === BANKED_REASON || name === BANKED_EVENT || name === BOARD_ID;
  }

  export function allowedBoss(id: string): boolean {
    for (var i = 0; i < BOSSES.length; i++) if (BOSSES[i] === id) return true;
    return false;
  }

  export interface PresenceRow {
    accountId: string;
    slots: number;
    presentAtStart: number;
    nonNeutral: number;
    neutralAlive: number;
    downTicks: number;
  }

  export interface Gates {
    practice: boolean;
    god: boolean;
    stageSelect: boolean;
    released: boolean;
    knownBoss: boolean;
  }

  /**
   * Encounter-start presence, then not AFK. AFK is zero non-neutral inputs and
   * AFK_ALIVE neutral ticks while up. Down ticks are not neutral and are not a
   * damage threshold. Reconnect grace is applied by the match before this runs:
   * it freezes neutralAlive, and CPU takeover arrives as released.
   */
  export function decide(row: PresenceRow, gates: Gates, afkAlive: number): { eligible: boolean; reason: string } {
    if (gates.practice) return { eligible: false, reason: "practice" };
    if (gates.god) return { eligible: false, reason: "god_mode" };
    if (gates.stageSelect) return { eligible: false, reason: "stage_select" };
    if (!gates.knownBoss) return { eligible: false, reason: "unknown_boss" };
    if (gates.released) return { eligible: false, reason: "cpu_takeover" };
    if (row.presentAtStart !== 1 || row.slots < 1) return { eligible: false, reason: "late_join" };
    var alive = afkAlive > 0 ? afkAlive : AFK_ALIVE;
    if (row.nonNeutral <= 0 && row.neutralAlive >= alive) return { eligible: false, reason: "afk" };
    return { eligible: true, reason: "clear" };
  }

  export function queryJson(nk: nkruntime.Nakama, sql: string, args: unknown[]): { [key: string]: unknown } {
    var rows = nk.sqlQuery(sql, args);
    if (!rows || !rows.length || rows[0].result === undefined || rows[0].result === null) return { error: "empty_result" };
    var raw = rows[0].result;
    if (typeof raw === "string") return JSON.parse(raw) as { [key: string]: unknown };
    if (typeof raw === "object") return raw as { [key: string]: unknown };
    return { error: "bad_json_cell" };
  }

  export function serverDay(nk: nkruntime.Nakama): string {
    var rows = nk.sqlQuery("SELECT to_char((now() AT TIME ZONE 'utc')::date, 'YYYY-MM-DD') AS day", []);
    if (!rows || !rows.length || typeof rows[0].day !== "string") return "";
    return rows[0].day;
  }

  export function settle(
    nk: nkruntime.Nakama,
    userId: string,
    sessionId: string,
    matchId: string,
    encounterId: string,
    boss: string,
    day: string,
    terminalTick: number,
    clearMs: number,
    eligible: boolean,
    reason: string,
    slots: number,
    assistance: string,
    reqHash: string,
  ): { [key: string]: unknown } {
    return queryJson(
      nk,
      "SELECT game.settle_coop_clear($1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::date, $7::bigint, $8::bigint, $9::smallint, $10::text, $11::integer, $12::integer, $13::text, $14::text, $15::text)::text AS result",
      [
        userId,
        sessionId,
        matchId,
        encounterId,
        boss,
        day,
        terminalTick,
        clearMs,
        eligible ? 1 : 0,
        reason,
        slots,
        PROTOCOL,
        FINGERPRINT,
        assistance,
        reqHash,
      ],
    );
  }
}

HubSchema.register({
  id: "0041_coop_boss_receipt",
  statements: [
    `CREATE TABLE IF NOT EXISTS game.coop_eligibility (
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      match_id text NOT NULL,
      encounter_id text NOT NULL,
      canonical_boss text NOT NULL,
      session_id uuid NOT NULL,
      accounting_day date NOT NULL,
      terminal_tick bigint NOT NULL,
      eligible boolean NOT NULL,
      reason text NOT NULL,
      slots integer NOT NULL,
      protocol integer NOT NULL,
      fingerprint text NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, match_id, encounter_id),
      CONSTRAINT coop_eligibility_game CHECK (game_id = 'sproto-coop-battle'),
      CONSTRAINT coop_eligibility_boss CHECK (canonical_boss IN ('01-marina-bront', '02-last-light-vela', '03-mudline-crapto', '04-ranch-zephyr', '05-neon-sproto102', '06-circuit-rune', '07-moonkeep-bigswole', '08-crown-alpha777', '09-hatchery-highsproto', '10-verse-sprotosales', '11-rooftop-sproto1668', '12-codebreak-sproto3106')),
      CONSTRAINT coop_eligibility_slots CHECK (slots >= 0 AND slots <= 6)
    )`,
    `CREATE TABLE IF NOT EXISTS game.coop_receipt (
      user_id uuid NOT NULL,
      game_id text NOT NULL,
      canonical_boss text NOT NULL,
      day date NOT NULL,
      match_id text NOT NULL,
      encounter_id text NOT NULL,
      session_id uuid NOT NULL,
      terminal_tick bigint NOT NULL,
      clear_ms bigint NOT NULL CHECK (clear_ms >= 0 AND clear_ms <= 2700000),
      tickets bigint NOT NULL CHECK (tickets = 20),
      slots integer NOT NULL CHECK (slots >= 1 AND slots <= 6),
      protocol integer NOT NULL,
      fingerprint text NOT NULL,
      assistance text NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, game_id, canonical_boss, day),
      UNIQUE (user_id, match_id, encounter_id),
      CONSTRAINT coop_receipt_game CHECK (game_id = 'sproto-coop-battle'),
      CONSTRAINT coop_receipt_boss CHECK (canonical_boss IN ('01-marina-bront', '02-last-light-vela', '03-mudline-crapto', '04-ranch-zephyr', '05-neon-sproto102', '06-circuit-rune', '07-moonkeep-bigswole', '08-crown-alpha777', '09-hatchery-highsproto', '10-verse-sprotosales', '11-rooftop-sproto1668', '12-codebreak-sproto3106')),
      CONSTRAINT coop_receipt_assist CHECK (assistance IN ('all_human', 'cpu_assisted'))
    )`,
    "CREATE INDEX IF NOT EXISTS coop_receipt_match ON game.coop_receipt (match_id, encounter_id)",
    "ALTER TABLE game.ranked_score DROP CONSTRAINT IF EXISTS ranked_score_board",
    "ALTER TABLE game.ranked_score ADD CONSTRAINT ranked_score_board CHECK (board_id IN ('hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins', 'meta', 'shooter_story_clear_ms_v1', 'coop_stage_clear_ms_v1'))",
    `CREATE OR REPLACE FUNCTION game.settle_coop_clear(
      p_user_id uuid, p_session_id uuid, p_match_id text, p_encounter_id text,
      p_boss text, p_day date, p_terminal_tick bigint, p_clear_ms bigint,
      p_eligible smallint, p_reason text, p_slots integer, p_protocol integer,
      p_fingerprint text, p_assistance text, p_req_hash text
    ) RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE
      v_response jsonb;
      v_credit jsonb;
      v_balance bigint;
      v_applied bigint;
      v_used bigint;
      v_bucket text;
      v_idem_key text;
      v_rows integer;
      v_reason text;
      v_assist text;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtextextended('economy:' || p_user_id::text, 0));
      SELECT response INTO v_response FROM game.coop_eligibility
      WHERE user_id = p_user_id AND match_id = p_match_id AND encounter_id = p_encounter_id;
      IF FOUND THEN
        RETURN v_response;
      END IF;
      IF p_boss NOT IN ('01-marina-bront', '02-last-light-vela', '03-mudline-crapto', '04-ranch-zephyr', '05-neon-sproto102', '06-circuit-rune', '07-moonkeep-bigswole', '08-crown-alpha777', '09-hatchery-highsproto', '10-verse-sprotosales', '11-rooftop-sproto1668', '12-codebreak-sproto3106') THEN
        RETURN jsonb_build_object('ok', false, 'paid', false, 'sealed', true, 'tickets', 0, 'ticketsMinted', 0, 'reason', 'unknown_boss', 'canonicalBoss', p_boss);
      END IF;
      SELECT response INTO v_response FROM game.coop_receipt
      WHERE user_id = p_user_id AND game_id = 'sproto-coop-battle' AND canonical_boss = p_boss AND day = p_day;
      IF FOUND THEN
        v_response := jsonb_build_object(
          'ok', true, 'paid', false, 'sealed', true, 'replay', false, 'tickets', 0, 'ticketsMinted', 0,
          'reason', 'already_paid', 'canonicalBoss', p_boss, 'canonicalCount', 1,
          'day', to_char(p_day, 'YYYY-MM-DD'), 'matchId', p_match_id, 'encounterId', p_encounter_id,
          'phasesAreOneClear', 1, 'slots', p_slots
        );
        INSERT INTO game.coop_eligibility (
          user_id, game_id, match_id, encounter_id, canonical_boss, session_id, accounting_day,
          terminal_tick, eligible, reason, slots, protocol, fingerprint, response
        ) VALUES (
          p_user_id, 'sproto-coop-battle', p_match_id, p_encounter_id, p_boss, p_session_id, p_day,
          COALESCE(p_terminal_tick, 0), false, 'already_paid', GREATEST(COALESCE(p_slots, 0), 0),
          COALESCE(p_protocol, 0), COALESCE(p_fingerprint, ''), v_response
        );
        RETURN v_response;
      END IF;
      v_reason := COALESCE(p_reason, '');
      v_assist := CASE WHEN p_assistance = 'all_human' THEN 'all_human' ELSE 'cpu_assisted' END;
      IF p_protocol IS DISTINCT FROM 1 OR p_fingerprint IS DISTINCT FROM 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e' THEN
        v_reason := 'bad_version';
      ELSIF p_clear_ms IS NULL OR p_clear_ms < 0 OR p_clear_ms > 2700000 OR p_terminal_tick IS NULL OR p_terminal_tick < 0 THEN
        v_reason := 'malformed';
      ELSIF p_slots IS NULL OR p_slots < 1 OR p_slots > 6 THEN
        v_reason := 'late_join';
      ELSIF p_eligible IS DISTINCT FROM 1 OR v_reason IS DISTINCT FROM 'clear' THEN
        IF v_reason = '' THEN v_reason := 'ineligible'; END IF;
      ELSE
        v_reason := 'clear';
      END IF;
      IF v_reason IS DISTINCT FROM 'clear' THEN
        v_response := jsonb_build_object(
          'ok', true, 'paid', false, 'sealed', true, 'replay', false, 'tickets', 0, 'ticketsMinted', 0,
          'reason', v_reason, 'canonicalBoss', p_boss, 'canonicalCount', 1,
          'day', to_char(p_day, 'YYYY-MM-DD'), 'matchId', p_match_id, 'encounterId', p_encounter_id,
          'phasesAreOneClear', 1, 'slots', GREATEST(COALESCE(p_slots, 0), 0), 'terminalTick', COALESCE(p_terminal_tick, 0)
        );
        INSERT INTO game.coop_eligibility (
          user_id, game_id, match_id, encounter_id, canonical_boss, session_id, accounting_day,
          terminal_tick, eligible, reason, slots, protocol, fingerprint, response
        ) VALUES (
          p_user_id, 'sproto-coop-battle', p_match_id, p_encounter_id, p_boss, p_session_id, p_day,
          COALESCE(p_terminal_tick, 0), false, v_reason, GREATEST(COALESCE(p_slots, 0), 0),
          COALESCE(p_protocol, 0), COALESCE(p_fingerprint, ''), v_response
        );
        RETURN v_response;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM game.game_session
        WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = 'sproto-coop-battle'
          AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
      ) THEN
        v_response := jsonb_build_object(
          'ok', false, 'paid', false, 'sealed', true, 'replay', false, 'tickets', 0, 'ticketsMinted', 0,
          'error', 'session_closed', 'reason', 'session_closed', 'canonicalBoss', p_boss,
          'day', to_char(p_day, 'YYYY-MM-DD'), 'matchId', p_match_id, 'encounterId', p_encounter_id,
          'phasesAreOneClear', 1, 'slots', p_slots
        );
        INSERT INTO game.coop_eligibility (
          user_id, game_id, match_id, encounter_id, canonical_boss, session_id, accounting_day,
          terminal_tick, eligible, reason, slots, protocol, fingerprint, response
        ) VALUES (
          p_user_id, 'sproto-coop-battle', p_match_id, p_encounter_id, p_boss, p_session_id, p_day,
          p_terminal_tick, false, 'session_closed', p_slots, p_protocol, p_fingerprint, v_response
        );
        RETURN v_response;
      END IF;
      v_bucket := 'boss:sproto-coop-battle:' || p_boss;
      SELECT amount INTO v_used FROM game.earn_window
      WHERE user_id = p_user_id AND bucket = v_bucket AND day = p_day;
      IF COALESCE(v_used, 0) >= 1 THEN
        v_response := jsonb_build_object(
          'ok', true, 'paid', false, 'sealed', true, 'replay', false, 'tickets', 0, 'ticketsMinted', 0,
          'reason', 'already_paid', 'canonicalBoss', p_boss, 'canonicalCount', 1,
          'day', to_char(p_day, 'YYYY-MM-DD'), 'matchId', p_match_id, 'encounterId', p_encounter_id,
          'phasesAreOneClear', 1, 'slots', p_slots
        );
        INSERT INTO game.coop_eligibility (
          user_id, game_id, match_id, encounter_id, canonical_boss, session_id, accounting_day,
          terminal_tick, eligible, reason, slots, protocol, fingerprint, response
        ) VALUES (
          p_user_id, 'sproto-coop-battle', p_match_id, p_encounter_id, p_boss, p_session_id, p_day,
          p_terminal_tick, false, 'already_paid', p_slots, p_protocol, p_fingerprint, v_response
        );
        RETURN v_response;
      END IF;
      v_credit := game.take_ticket_credit(p_user_id, p_session_id, 'sproto-coop-battle', 20, 'srv_coop_boss_clear', 'earn', false);
      IF v_credit ? 'error' THEN
        RETURN v_credit || jsonb_build_object('ok', false, 'paid', false, 'sealed', false, 'tickets', 0, 'ticketsMinted', 0, 'reason', v_credit->>'error', 'canonicalBoss', p_boss);
      END IF;
      v_applied := COALESCE((v_credit->>'applied')::bigint, 0);
      IF v_applied IS DISTINCT FROM 20 THEN
        RAISE EXCEPTION 'coop_pay_not_20';
      END IF;
      v_balance := (v_credit->>'balance')::bigint;
      INSERT INTO game.earn_window (user_id, bucket, day, amount)
      VALUES (p_user_id, v_bucket, p_day, 1)
      ON CONFLICT (user_id, bucket, day) DO UPDATE
        SET amount = game.earn_window.amount + 1
        WHERE game.earn_window.amount < 1;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows <> 1 THEN
        RAISE EXCEPTION 'coop_boss_bucket';
      END IF;
      v_response := jsonb_build_object(
        'ok', true,
        'paid', true,
        'sealed', true,
        'replay', false,
        'tickets', 20,
        'ticketsMinted', 0,
        'balance', v_balance,
        'canonicalBoss', p_boss,
        'canonicalCount', 1,
        'phasesAreOneClear', 1,
        'slots', p_slots,
        'day', to_char(p_day, 'YYYY-MM-DD'),
        'matchId', p_match_id,
        'encounterId', p_encounter_id,
        'terminalTick', p_terminal_tick,
        'clearMs', p_clear_ms,
        'score', p_clear_ms,
        'boardId', 'coop_stage_clear_ms_v1',
        'assistance', v_assist,
        'protocol', 1,
        'fingerprint', 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e',
        'reason', 'clear'
      );
      INSERT INTO game.ranked_score (user_id, board_id, variant, value, meta, session_id, updated_at)
      VALUES (
        p_user_id, 'coop_stage_clear_ms_v1', p_boss, p_clear_ms,
        jsonb_build_object(
          'protocol', 1,
          'fingerprint', 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e',
          'matchId', p_match_id,
          'encounterId', p_encounter_id,
          'assistance', v_assist,
          'slots', p_slots,
          'phasesAreOneClear', 1,
          'version', 1
        ),
        p_session_id, now()
      )
      ON CONFLICT (user_id, board_id, variant) DO UPDATE
        SET value = LEAST(game.ranked_score.value, EXCLUDED.value),
            meta = EXCLUDED.meta,
            session_id = EXCLUDED.session_id,
            updated_at = now()
        WHERE game.ranked_score.value > EXCLUDED.value;
      INSERT INTO game.coop_receipt (
        user_id, game_id, canonical_boss, day, match_id, encounter_id, session_id,
        terminal_tick, clear_ms, tickets, slots, protocol, fingerprint, assistance, response
      ) VALUES (
        p_user_id, 'sproto-coop-battle', p_boss, p_day, p_match_id, p_encounter_id, p_session_id,
        p_terminal_tick, p_clear_ms, 20, p_slots, 1, 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e', v_assist, v_response
      );
      INSERT INTO game.coop_eligibility (
        user_id, game_id, match_id, encounter_id, canonical_boss, session_id, accounting_day,
        terminal_tick, eligible, reason, slots, protocol, fingerprint, response
      ) VALUES (
        p_user_id, 'sproto-coop-battle', p_match_id, p_encounter_id, p_boss, p_session_id, p_day,
        p_terminal_tick, true, 'clear', p_slots, 1, 'f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e', v_response
      );
      v_idem_key := 'cclr:' || md5(p_user_id::text || '|' || p_match_id || '|' || p_encounter_id);
      INSERT INTO game.idempotency (user_id, key, rpc, req_hash, response)
      VALUES (p_user_id, v_idem_key, 'tickets.earn', decode(p_req_hash, 'hex'), v_response);
      RETURN v_response;
    EXCEPTION WHEN unique_violation THEN
      SELECT response INTO v_response FROM game.coop_eligibility
      WHERE user_id = p_user_id AND match_id = p_match_id AND encounter_id = p_encounter_id;
      IF FOUND THEN
        RETURN v_response;
      END IF;
      SELECT response INTO v_response FROM game.coop_receipt
      WHERE user_id = p_user_id AND game_id = 'sproto-coop-battle' AND canonical_boss = p_boss AND day = p_day;
      IF FOUND THEN
        RETURN v_response;
      END IF;
      RETURN jsonb_build_object('error', 'idempotency_mismatch', 'ok', false, 'paid', false, 'sealed', true, 'tickets', 0, 'ticketsMinted', 0);
    END;
    $fn$`,
  ],
});
