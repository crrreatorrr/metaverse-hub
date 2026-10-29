DROP TRIGGER IF EXISTS test_fault_grant_after_claim ON game.relic_claim;
DROP TRIGGER IF EXISTS test_fault_grant_after_mint ON game.item_ledger;
DROP TRIGGER IF EXISTS test_fault_exchange_after_wallet ON game.verse_wallet;
DROP TRIGGER IF EXISTS test_fault_earn_after_wallet ON game.tickets_balance;
DROP FUNCTION IF EXISTS game.test_fault_row();
