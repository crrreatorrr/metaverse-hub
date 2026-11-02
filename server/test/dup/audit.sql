-- Economy audit. Must raise when any invariant is broken.
-- Run after every duplication test and as a CI step.
-- Purchase checks are included automatically once those tables exist.

DO $$
DECLARE
  r record;
  n integer := 0;
  msg text := '';
BEGIN
  FOR r IN
    SELECT kind, subject, detail FROM (
      SELECT 'duplicate_relic_grant'::text AS kind,
             user_id::text AS subject,
             item_id || ' x' || count(*)::text AS detail
      FROM game.item_ledger
      WHERE op = 'grant_relic'
      GROUP BY user_id, item_id
      HAVING count(*) > 1

      UNION ALL
      SELECT 'duplicate_relic_claim',
             user_id::text,
             relic_id || ' x' || count(*)::text
      FROM game.relic_claim
      GROUP BY user_id, relic_id
      HAVING count(*) > 1

      UNION ALL
      SELECT 'relic_claim_not_one_mint',
             c.user_id::text,
             c.relic_id || ' ledger=' || count(l.seq)::text
      FROM game.relic_claim c
      LEFT JOIN game.item_ledger l
        ON l.event_id = c.event_id AND l.op = 'grant_relic'
      GROUP BY c.user_id, c.relic_id
      HAVING count(l.seq) <> 1

      UNION ALL
      SELECT 'mint_without_claim',
             l.user_id::text,
             l.item_id || ' event=' || l.event_id::text
      FROM game.item_ledger l
      WHERE l.op = 'grant_relic'
        AND NOT EXISTS (
          SELECT 1 FROM game.relic_claim c WHERE c.event_id = l.event_id
        )

      UNION ALL
      SELECT 'grant_ledger_ne_claims',
             '',
             'ledger=' || (SELECT count(*) FROM game.item_ledger WHERE op = 'grant_relic')::text
               || ' claims=' || (SELECT count(*) FROM game.relic_claim)::text
      WHERE (SELECT count(*) FROM game.item_ledger WHERE op = 'grant_relic')
         <> (SELECT count(*) FROM game.relic_claim)

      UNION ALL
      SELECT 'tickets_balance_ne_ledger',
             b.user_id::text,
             b.game_id || ' balance=' || b.balance::text || ' ledger=' || COALESCE((
               SELECT sum(delta) FROM game.tickets_ledger l
               WHERE l.user_id = b.user_id AND l.game_id = b.game_id
             ), 0)::text
      FROM game.tickets_balance b
      WHERE b.balance <> COALESCE((
        SELECT sum(delta) FROM game.tickets_ledger l
        WHERE l.user_id = b.user_id AND l.game_id = b.game_id
      ), 0)

      UNION ALL
      SELECT 'verse_balance_ne_ledger',
             w.user_id::text,
             'balance=' || w.balance::text || ' ledger=' || COALESCE((
               SELECT sum(delta) FROM game.verse_ledger l WHERE l.user_id = w.user_id
             ), 0)::text
      FROM game.verse_wallet w
      WHERE w.balance <> COALESCE((
        SELECT sum(delta) FROM game.verse_ledger l WHERE l.user_id = w.user_id
      ), 0)

      UNION ALL
      SELECT 'negative_tickets',
             user_id::text,
             game_id || '=' || balance::text
      FROM game.tickets_balance
      WHERE balance < 0

      UNION ALL
      SELECT 'negative_verse',
             user_id::text,
             balance::text
      FROM game.verse_wallet
      WHERE balance < 0

      UNION ALL
      SELECT 'exchange_key_multi_effect',
             user_id::text,
             idem_key || ' x' || count(*)::text
      FROM game.exchange_tx
      GROUP BY user_id, idem_key
      HAVING count(*) > 1

      UNION ALL
      SELECT 'idempotency_key_multi_row',
             user_id::text,
             key || ' x' || count(*)::text
      FROM game.idempotency
      GROUP BY user_id, key
      HAVING count(*) > 1

      UNION ALL
      SELECT 'exchange_not_one_ledger_pair',
             x.user_id::text,
             x.receipt_id::text || ' key=' || x.idem_key
      FROM game.exchange_tx x
      WHERE (
        SELECT count(*) FROM game.tickets_ledger t
        WHERE t.ref_id = x.receipt_id AND t.delta = -x.tickets
      ) <> 1
      OR (
        SELECT count(*) FROM game.verse_ledger v
        WHERE v.ref_id = x.receipt_id AND v.delta = x.verse
      ) <> 1

      UNION ALL
      SELECT 'verse_earned_ne_exchanges',
             e.user_id::text,
             e.game_id || ' earned=' || e.lifetime::text
      FROM game.verse_earned e
      WHERE e.lifetime <> COALESCE((
        SELECT sum(verse) FROM game.exchange_tx x
        WHERE x.user_id = e.user_id AND x.game_id = e.game_id
      ), 0)

      UNION ALL
      SELECT 'verse_credits_ne_exchanges',
             s.user_id::text,
             'credits=' || s.credits::text || ' exchanges=' || s.exchanges::text
      FROM (
        SELECT u.user_id,
          (SELECT count(*) FROM game.verse_ledger l WHERE l.user_id = u.user_id AND l.delta > 0) AS credits,
          (SELECT count(*) FROM game.exchange_tx x WHERE x.user_id = u.user_id) AS exchanges
        FROM (
          SELECT user_id FROM game.verse_ledger
          UNION
          SELECT user_id FROM game.exchange_tx
        ) u
      ) s
      WHERE s.credits <> s.exchanges

      UNION ALL
      SELECT 'earn_ledger_exceeds_keys',
             s.user_id::text,
             'ledger=' || s.ledgers::text || ' keys=' || s.keys::text
      FROM (
        SELECT u.user_id,
          (SELECT count(*) FROM game.tickets_ledger l
            WHERE l.user_id = u.user_id AND l.delta > 0 AND l.reason <> 'exchange' AND l.reason <> 'shop_sell') AS ledgers,
          (SELECT count(*) FROM game.idempotency i
            WHERE i.user_id = u.user_id AND i.rpc = 'tickets.earn') AS keys
        FROM (SELECT DISTINCT user_id FROM game.tickets_ledger) u
      ) s
      WHERE s.ledgers > s.keys
    ) audit
  LOOP
    n := n + 1;
    msg := msg || r.kind || '|' || r.subject || '|' || r.detail || E'\n';
  END LOOP;

  IF to_regclass('game.purchase_tx') IS NOT NULL THEN
    FOR r IN EXECUTE $q$
      SELECT 'purchase_key_multi_effect'::text AS kind,
             user_id::text AS subject,
             idem_key || ' x' || count(*)::text AS detail
      FROM game.purchase_tx
      GROUP BY user_id, idem_key
      HAVING count(*) > 1
    $q$
    LOOP
      n := n + 1;
      msg := msg || r.kind || '|' || r.subject || '|' || r.detail || E'\n';
    END LOOP;
  END IF;

  IF to_regclass('game.cosmetic_owned') IS NOT NULL THEN
    FOR r IN EXECUTE $q$
      SELECT 'duplicate_cosmetic'::text AS kind,
             user_id::text AS subject,
             def_id || ' x' || count(*)::text AS detail
      FROM game.cosmetic_owned
      GROUP BY user_id, def_id
      HAVING count(*) > 1
    $q$
    LOOP
      n := n + 1;
      msg := msg || r.kind || '|' || r.subject || '|' || r.detail || E'\n';
    END LOOP;
  END IF;

  IF n <> 0 THEN
    RAISE EXCEPTION 'economy audit returned % row(s): %', n, msg;
  END IF;
END $$;
