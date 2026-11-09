-- Shooter escrow conservation. Wallets plus held pots equal the non-wager
-- sproto-shooter ledger (boss pays and test funds). A wager never mints and
-- never takes a fee: each hold is two -10 stakes, a settle is one +20 payout,
-- a refund is two +10 refunds, and a held row still has both seats locked.
-- Fighter rows are not part of this check.

DO $$
DECLARE
  r record;
  n integer := 0;
  msg text := '';
  drift bigint;
BEGIN
  drift := game.shooter_wager_drift();
  IF drift <> 0 THEN
    n := n + 1;
    msg := msg || 'drift|' || drift::text || E'\n';
  END IF;

  IF EXISTS (
    SELECT 1 FROM game.tickets_ledger
    WHERE kind IN ('shooter_stake', 'shooter_payout', 'shooter_refund')
      AND game_id <> 'sproto-shooter'
  ) THEN
    n := n + 1;
    msg := msg || 'shooter_kind_on_other_game' || E'\n';
  END IF;

  FOR r IN
    SELECT w.match_id, w.status, w.stake, w.pot,
      (SELECT count(*) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'shooter_stake') AS stakes,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'shooter_stake') AS stake_sum,
      (SELECT count(*) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'shooter_payout') AS payouts,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'shooter_payout') AS payout_sum,
      (SELECT count(*) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'shooter_refund') AS refunds,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id AND l.kind = 'shooter_refund') AS refund_sum,
      (SELECT count(*) FROM game.shooter_wager_active a WHERE a.match_id = w.match_id) AS active,
      (SELECT COALESCE(sum(l.delta), 0) FROM game.tickets_ledger l WHERE l.ref_id = w.wager_id) AS net
    FROM game.shooter_wager w
  LOOP
    IF r.stake <> 10 OR r.pot <> 20 THEN
      n := n + 1;
      msg := msg || 'stake|' || r.match_id || E'\n';
    END IF;
    IF r.stakes <> 2 OR r.stake_sum <> -20 THEN
      n := n + 1;
      msg := msg || 'debits|' || r.match_id || ' stakes=' || r.stakes::text || ' sum=' || r.stake_sum::text || E'\n';
    END IF;
    IF r.status = 'held' AND (r.payouts <> 0 OR r.refunds <> 0 OR r.active <> 2 OR r.net <> -20) THEN
      n := n + 1;
      msg := msg || 'held|' || r.match_id || E'\n';
    END IF;
    IF r.status = 'settled' AND (r.payouts <> 1 OR r.payout_sum <> 20 OR r.refunds <> 0 OR r.active <> 0 OR r.net <> 0) THEN
      n := n + 1;
      msg := msg || 'settled|' || r.match_id || ' payouts=' || r.payouts::text || ' net=' || r.net::text || E'\n';
    END IF;
    IF r.status = 'refunded' AND (r.payouts <> 0 OR r.refunds <> 2 OR r.refund_sum <> 20 OR r.active <> 0 OR r.net <> 0) THEN
      n := n + 1;
      msg := msg || 'refunded|' || r.match_id || ' refunds=' || r.refunds::text || E'\n';
    END IF;
    IF r.status NOT IN ('held', 'settled', 'refunded') THEN
      n := n + 1;
      msg := msg || 'status|' || r.match_id || E'\n';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM game.shooter_wager_active) <> (SELECT count(*) * 2 FROM game.shooter_wager WHERE status = 'held') THEN
    n := n + 1;
    msg := msg || 'active_locks' || E'\n';
  END IF;

  IF n > 0 THEN
    RAISE EXCEPTION 'shooter wager audit failed (%): %', n, msg;
  END IF;
END $$;
