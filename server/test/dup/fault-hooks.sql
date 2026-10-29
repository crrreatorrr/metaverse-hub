SET client_min_messages = warning;
-- Installed by the duplication suite for the fault category, then dropped.
-- game.fault_at no-ops unless game.fault_arm has a row for that user and point.
-- A raise aborts the surrounding grant/exchange transaction.

CREATE OR REPLACE FUNCTION game.test_fault_row() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_point text;
  v_points text[];
BEGIN
  IF TG_TABLE_NAME = 'relic_claim' THEN
    v_points := ARRAY['grant.after_claim'];
  ELSIF TG_TABLE_NAME = 'item_ledger' THEN
    IF NEW.op IS DISTINCT FROM 'grant_relic' THEN
      RETURN NEW;
    END IF;
    v_points := ARRAY['grant.after_mint'];
  ELSIF TG_TABLE_NAME = 'verse_wallet' THEN
    v_points := ARRAY['exchange.after_wallet', 'purchase.after_wallet'];
  ELSIF TG_TABLE_NAME = 'tickets_balance' THEN
    -- spend.after_wallet is armed only by the PB shop cases. Unarmed calls no-op.
    v_points := ARRAY['earn.after_wallet', 'exchange.after_debit', 'spend.after_wallet'];
  ELSE
    RETURN NEW;
  END IF;
  FOREACH v_point IN ARRAY v_points LOOP
    PERFORM game.fault_at(NEW.user_id, v_point);
  END LOOP;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS test_fault_grant_after_claim ON game.relic_claim;
CREATE TRIGGER test_fault_grant_after_claim
  AFTER INSERT ON game.relic_claim
  FOR EACH ROW EXECUTE FUNCTION game.test_fault_row();

DROP TRIGGER IF EXISTS test_fault_grant_after_mint ON game.item_ledger;
CREATE TRIGGER test_fault_grant_after_mint
  AFTER INSERT ON game.item_ledger
  FOR EACH ROW EXECUTE FUNCTION game.test_fault_row();

DROP TRIGGER IF EXISTS test_fault_exchange_after_wallet ON game.verse_wallet;
CREATE TRIGGER test_fault_exchange_after_wallet
  AFTER INSERT OR UPDATE ON game.verse_wallet
  FOR EACH ROW EXECUTE FUNCTION game.test_fault_row();

DROP TRIGGER IF EXISTS test_fault_earn_after_wallet ON game.tickets_balance;
CREATE TRIGGER test_fault_earn_after_wallet
  AFTER INSERT OR UPDATE ON game.tickets_balance
  FOR EACH ROW EXECUTE FUNCTION game.test_fault_row();
