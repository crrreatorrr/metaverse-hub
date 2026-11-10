-- Duel escrow conservation. A wager never mints: a hold is two stakes that sum
-- to minus twice the stake, a settle is one payout of twice the stake, a refund
-- is two refunds that sum to twice the stake, and every row nets to zero.
-- Shooter rows are not part of this check.

DO $$
DECLARE
  r record;
  n integer := 0;
  msg text := '';
BEGIN
  IF EXISTS (
    SELECT 1 FROM game.tickets_ledger
    WHERE kind IN ('duel_stake', 'duel_payout', 'duel_refund')
      AND game_id <> 'sproto-fighter'
  ) THEN
    n := n + 1;
    msg := msg || 'duel_kind_on_other_game' || E'\n';
  END IF;

  FOR r IN
    SELECT w.wager_id, w.status, w.stake,
      (SELECT count(*) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'duel_stake') AS stakes,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'duel_stake') AS stake_sum,
      (SELECT count(*) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'duel_payout') AS payouts,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'duel_payout') AS payout_sum,
      (SELECT count(*) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'duel_refund') AS refunds,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'duel_refund') AS refund_sum,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id) AS net
    FROM game.sproto_wager w
  LOOP
    IF r.stakes <> 2 OR r.stake_sum <> -2 * r.stake THEN
      n := n + 1;
      msg := msg || 'hold|' || r.wager_id::text || E'\n';
    ELSIF r.status = 'held' AND (r.payouts <> 0 OR r.refunds <> 0 OR r.net <> -2 * r.stake) THEN
      n := n + 1;
      msg := msg || 'held|' || r.wager_id::text || E'\n';
    ELSIF r.status = 'settled' AND (r.payouts <> 1 OR r.payout_sum <> 2 * r.stake OR r.refunds <> 0 OR r.net <> 0) THEN
      n := n + 1;
      msg := msg || 'settled|' || r.wager_id::text || E'\n';
    ELSIF r.status = 'refunded' AND (r.refunds <> 2 OR r.refund_sum <> 2 * r.stake OR r.payouts <> 0 OR r.net <> 0) THEN
      n := n + 1;
      msg := msg || 'refunded|' || r.wager_id::text || E'\n';
    END IF;
  END LOOP;

  IF n <> 0 THEN
    RAISE EXCEPTION 'duel escrow audit returned % row(s): %', n, msg;
  END IF;
END $$;
