# Shooter wager operations

Shooter 1v1 can escrow **10 Tickets from each signed-in seat** (pot 20, no fee, no mint). The wallet is `sproto-shooter` only. Fighter escrow (`game.sproto_wager`) is not used and was not changed.

Ken’s decision on Nov 7, 2026: players may use these wagers to move Tickets between accounts. There is **no** cap of 5 matches per pair per day, **no** 200-Ticket daily winnings cap, and **no** anomaly flags for short, one-sided, ring, or forfeit loops.

## The flag stays off

`shooter_pvp` and `shooter_pvp_wager` are seeded `off` in `game.server_flags`. A match escrows only when **both** are on for **both** accounts. This change does not turn either flag on. Do not turn them on until the economy review says so.

Turning the flags off stops new holds. A hold that already exists still settles or refunds once. It is not deleted and it is not left in `held`.

There is no client RPC to settle, pick a winner, or refund. The Nakama match does that from the server director. `scripts/ops/sweep-shooter-wagers.mjs` only refunds stale holds.

## What a hold does

Both debits and the escrow insert commit together, or neither does. Accounts are locked in id order after a lock on the match id, so two holds cannot deadlock and cannot double-debit.

A hold is refused when:

- either account is a guest (no email) or the same account sits twice
- either account already has a Shooter hold (`game.shooter_wager_active`)
- either balance is under 10 (the other debit rolls back)
- the same match id is retried with different participants or a different rule hash

The rule hash is sha256 of the stake, pot, fee, mint, protocol, sim, content fingerprint, and loadout hash. It is stored on the row and not updated.

The accounting day is the UTC date of the hold. Settlement does not move it.

CPU matches are not a wager. This mode has two accounts and no CPU seat. Practice never reaches the match.

## How a hold ends

`held` becomes `settled` or `refunded` once. The receipt is stored on the row. A repeat is the same receipt with `repeat: true` and no second ledger line.

| Result | Ledger |
|---|---|
| Verified KO or time win | Winner is paid 20. Net +10 / −10. |
| Forfeit after both are ready and the replay agrees the other seat stalled for 10s | Same payout, reason `forfeit`. |
| Forfeit the replay does not confirm | Refund. |
| Draw, including double KO | Refund. |
| Both absent or both stalled | Refund (`both_absent`). |
| Ready timeout, or a disconnect before both are ready | No hold, or a refund if one was taken. |
| Server shutdown, version or pin mismatch, unverified KO | Refund. |

A later disconnect does not replace a result the director already recorded.

## Recovery

Nakama is one node. On boot, after migrations, every held Shooter row is refunded (`shooter_wager_expire(interval '0')`), because the match that owned it died with the process.

A match named `shooter_wager_sweep` runs for the life of the process and refunds holds older than **20 minutes** at most once every 5 minutes. The authoritative match itself lasts at most 10 minutes after both players are ready, so the extra 10 minutes is grace for a slow loop. The sweep does not wait for someone to queue.

Operators can run the same refund without a queue:

```bash
node scripts/ops/sweep-shooter-wagers.mjs --dry-run
node scripts/ops/sweep-shooter-wagers.mjs
```

Set `DATABASE_URL` when the database is not the local compose Postgres. The script does not print the URL.

## Conservation

`game.shooter_wager_drift()` is zero when sproto-shooter balances plus the pots of held rows equal the ledger entries that are not wager transfers (boss pays and other earns). `server/test/dup/shooter_wager_audit.sql` raises when that drift is nonzero, a stake is not 10, a settle paid anything other than 20, a refund paid anything other than 10 each, or a hold is missing either seat lock.

Wager credits use ledger reasons `shooter_payout` and `shooter_refund`. They are transfers, not earns, and they do not write `earn_window`.

## Rollback

1. Set `shooter_pvp_wager` (and, if you want the queue closed too, `shooter_pvp`) back to `off`.
2. Let live matches finish. The sweep and the boot refund close anything still `held`.
3. Leave the ledger and `game.shooter_wager` in place. Do not delete them and do not write a down migration.
