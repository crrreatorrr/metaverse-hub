// Owner godmode for The People's Bitcoin (owner request, 2026-11-09).
//
// An account listed in game.godmode_user has its peoples-bitcoin Ticket wallet raised to
// that row's target whenever its balance is read: tickets.balance (hub sessions) and
// HubEconomy.balance (pb_world online worlds). The raise is one tickets_ledger row with
// reason and kind 'godmode' and no session ref, so it skips the session and daily earn
// caps and the ledger still sums to the balance. No RPC writes game.godmode_user: the
// owner adds a row with deploy/scripts/godmode.sh, which needs shell access to the server.
namespace HubGodmode {
  /** The only game godmode touches. */
  export var GAME = "peoples-bitcoin";
  /** Default target for deploy/scripts/godmode.sh. */
  export var DEFAULT_TICKETS = 90000000000;

  /** Raises the wallet if `userId` is listed. A no-op for every other account and game. */
  export function topUp(nk: nkruntime.Nakama, userId: string, game: string): void {
    if (game !== GAME || !userId) return;
    nk.sqlExec("SELECT game.godmode_topup($1::uuid, $2::text)", [userId, game]);
  }
}

HubSchema.register({
  id: "0042_pb_godmode",
  statements: [
    "ALTER TABLE game.tickets_ledger DROP CONSTRAINT IF EXISTS tickets_ledger_kind",
    "ALTER TABLE game.tickets_ledger ADD CONSTRAINT tickets_ledger_kind CHECK (kind IS NULL OR kind IN ('earn', 'exchange', 'spend', 'shop_sell', 'duel_stake', 'duel_payout', 'duel_refund', 'godmode'))",
    `CREATE TABLE IF NOT EXISTS game.godmode_user (
      user_id uuid PRIMARY KEY,
      tickets bigint NOT NULL CHECK (tickets > 0),
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE OR REPLACE FUNCTION game.godmode_topup(p_user_id uuid, p_game_id text)
     RETURNS jsonb LANGUAGE plpgsql AS $fn$
     DECLARE
       v_target bigint;
       v_balance bigint;
     BEGIN
       IF p_game_id <> 'peoples-bitcoin' THEN RETURN NULL; END IF;
       SELECT tickets INTO v_target FROM game.godmode_user WHERE user_id = p_user_id;
       IF NOT FOUND THEN RETURN NULL; END IF;
       INSERT INTO game.tickets_balance (user_id, game_id, balance)
       VALUES (p_user_id, p_game_id, 0)
       ON CONFLICT (user_id, game_id) DO NOTHING;
       SELECT balance INTO v_balance FROM game.tickets_balance
       WHERE user_id = p_user_id AND game_id = p_game_id
       FOR UPDATE;
       IF v_balance >= v_target THEN
         RETURN jsonb_build_object('balance', v_balance, 'granted', 0);
       END IF;
       UPDATE game.tickets_balance SET balance = v_target
       WHERE user_id = p_user_id AND game_id = p_game_id;
       INSERT INTO game.tickets_ledger (event_id, user_id, game_id, delta, balance_after, reason, ref_id, kind)
       VALUES (gen_random_uuid(), p_user_id, p_game_id, v_target - v_balance, v_target, 'godmode', NULL, 'godmode');
       RETURN jsonb_build_object('balance', v_target, 'granted', v_target - v_balance);
     END;
     $fn$`,
  ],
});
