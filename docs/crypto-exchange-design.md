# $BITCOIN ⇄ Verse exchange: design

Status: design only. Nothing in this doc is built, registered, or migrated.

Players can trade Verse for HarryPotterObamaSonic10Inu `$BITCOIN` (cash-out), and buy in-game items with `$BITCOIN` (pay-in). In the backend every purchase is still a Verse purchase. The crypto side only adds Verse to or removes Verse from `game.verse_wallet`, through `game.verse_ledger`, the same way `game.exchange_tickets` does today.

In this doc, "$BITCOIN" always means the HPOS10I token, never BTC. The UI must say "HPOS10I $BITCOIN" and show the contract address next to every amount.

## Decisions recorded

| Topic | Decision |
| --- | --- |
| Token team | On board |
| Payout source | Own treasury plus `$BITCOIN` that players paid in |
| Exchange rate | Fixed; the operator changes it from an admin control |
| What can be cashed out | Earned Verse and bought Verse |
| Per-account cash-out limit | A second daily lock, separate from the earning cap, worth about $5 per day |
| Global cash-out limit | $500 per day across all accounts |
| Wallets | Players' own wallets. One wallet per chain per account. A player can replace a wallet; the old one is unlinked |
| Holding minimum | None |
| KYC | None. Players are told to report income under their own laws |
| Refunds | None |
| Player-to-player Verse trading | None |
| First chain for cash-out | Ethereum |
| Game clients | Built by the team, in other repos |

## Token addresses

| Chain | Address | Source |
| --- | --- | --- |
| Ethereum (ERC-20) | `0x72e4f9f808c49a2a61de9c5896298920dc4eeea9` | Team |
| Solana (SPL mint) | `CTgiaZUK12kCcB8sosn4Nt2NZtzLgtPqDwyQyr2syATC` | Team |

The services read `decimals` from the contract and the mint at startup. Nothing hardcodes them. Before launch, check both addresses on chain against the project's official channels. All token amounts are stored in base units as `numeric`, never as a float.

## The gap this has to close first

`tickets.earn` (`server/modules/src/rpcs.ts:448`) credits whatever `amount` the game client sends, up to the session cap and the 1000-per-game daily cap. A script with a guest device account can redeem a portal ticket, call `tickets.earn` with 1000, and exchange the result for 50 Verse per game in seconds. Guest accounts and wallets are free, and there is no holding minimum or KYC. So until earning is checked by the server, every bot account is worth the full per-account cash-out limit every day. The $500 global limit is then the only real cap on losses, and bots will usually reach it first.

The fix is in two parts:

1. **Games report events, not amounts.** The game repos send `session.event` with a typed event (`sproto.boss_defeated`, `pb.quest_complete`, …). The server looks up `game.event_rule` and credits Tickets from the row. `event_rule.tickets` already exists but is `NULL` in every seed row, and nothing credits from it today. Wiring it into `game.apply_event` is the server half of this change.
2. **Only server-credited Verse can be cashed out.** See [Withdrawable Verse](#withdrawable-verse). Raw `tickets.earn` keeps working for Verse that can only be spent, so the games can switch over one at a time.

Each game repo also owns its own plausibility checks: minimum match length, score bounds, and an event rate per minute. The server enforces the `event_rule` limits (`session_limit`, `day_limit`).

## Limits

Every limit is stored in Verse in one config row, and every change is logged. The admin page shows the implied dollar value using a reference price the operator enters with the rate.

| Lock | Scope | Window | Where it is counted |
| --- | --- | --- | --- |
| Earn cap (exists) | Account × game | UTC day | `game.earn_window` bucket `verse:<game>` |
| Cash-out lock | Account | UTC day | `game.earn_window` bucket `withdraw` |
| Global cash-out lock | All accounts | UTC day, released hourly | `game.payout_window` |
| Pay-in | None by default | — | — |

- With the current earn caps an account can earn up to 200 Verse a day. The cash-out lock is set on its own so it is worth about $5 at the configured rate.
- **Hourly release.** The global $500 is released in 24 equal slices, about $20.83 an hour, and unused budget rolls forward within the day. If the whole budget opens at 00:00 UTC, the fastest bots take all of it in the first minute.
- **Price drift.** Since the rate is fixed in tokens, a jump in the `$BITCOIN` price raises the real dollar value of every limit. An optional price check (a DEX quote) only alerts, or pauses withdrawals, when the implied value of the global limit goes past a threshold the operator sets, for example $750. It never changes the rate itself.

## Wallet linking

- **Proof of ownership.** The player signs a server nonce with their wallet: EIP-4361 (Sign-In With Ethereum) on Ethereum, and an ed25519 message signature on Solana. The server checks the signature before it writes a link. Since only the owner can sign, linking someone else's address is impossible.
- **One wallet per chain per account.** `game.wallet_link` has primary key `(user_id, chain)` and is unique on `(chain, address)`. An address is linked to at most one account at a time.
- **Replacing a wallet.** The new address goes through the same signing flow. The old link is deleted and an `unlink` row goes to `game.wallet_link_log`. The old address is then free.
- **Takeover hold.** Withdrawals stay blocked for 72 hours after any wallet link or change. Device and recovery-code accounts can be taken over (`recovery.redeem`), and this hold stops a hijacker from immediately pointing payouts at their own wallet.
- **Guest accounts.** A guest device account can link a wallet. The 72-hour hold, the per-account lock, and the global lock all apply as usual.
- **Account merges and recovery.** Every path that moves or merges accounts (recovery, the custom-auth paths, migrations like the `pb` merge) has to decide what happens to `wallet_link` rows and to the `withdraw` window. The default: links are dropped on merge and must be signed again, and windows are summed. The duplication suite gets cases for both.

## Exchange rate

- `game.verse_rate (version, chain, tokens_per_verse, ref_usd_per_verse, effective_at, set_by)`, append-only. The current rate for a chain is its highest version that has taken effect.
- Both chains use the same `tokens_per_verse`. A different rate on each chain would let players buy Verse on the cheap chain and cash out on the other.
- Every deposit, purchase intent, and withdrawal stores the `rate_version` it used.
- **Rate changes and bought Verse.** Since bought Verse can be cashed out at the same fixed rate, buying and then cashing out with no rate change is a round trip that only costs the player gas. A rate change is different: raising `tokens_per_verse` gives every Verse holder more tokens at cash-out. That exposure is bounded by the two cash-out locks. To keep it small, pause withdrawals for an hour around a change, or announce changes ahead of time.
- **Admin control.** An RPC that accepts only the Nakama server key (`http_key`), called from a CLI script or a small admin page behind Caddy auth. It sets the rate, the limits, and the kill switches. Every call writes `game.economy_config_log`.

## Pay-in: `$BITCOIN` → Verse → item

There is one treasury deposit address per chain: the multisig itself, not the hot wallet.

Matching is by sender. Each account has at most one linked wallet per chain, so any `$BITCOIN` transfer **from a linked wallet to the deposit address** is credited to that account. No memo, reference key, or payment contract is needed.

- **Ethereum.** Watch `Transfer(from, to = treasury, value)` logs on the token contract. The dedupe key is `(chain, tx_hash, log_index)`. Credit the logged `value` (what was actually received), and only after the block is `finalized`.
- **Solana.** Watch transfers into the treasury's associated token account. The sender is the owner of the source token account. The dedupe key is `(chain, signature, instruction_index)`. Credit at `finalized` commitment.
- **Conversion.** `verse = floor(amount / tokens_per_verse)`. The remainder is kept per account and chain in `game.deposit_dust` and added to the next deposit.
- **Ledger.** `game.verse_ledger` gets `source = 'deposit:<chain>'`. Deposits never write `game.verse_earned`, so bought Verse does not count on the Bar scoreboard.
- **Unmatched deposits.** A transfer from an address that is not linked is stored with status `unmatched`. If that address is linked later, the signature proves ownership, so the deposit is credited to that account at that point.
- **Wrong token or wrong chain.** It is not watched and not credited. The UI says so before the player sends anything.

**Buying an item with `$BITCOIN`:**

1. Checkout writes `game.purchase_intent (intent_id, user_id, item_id, verse_price, chain, token_amount, rate_version, expires_at)`. Since the rate is fixed, `token_amount` is exact.
2. The player sends `token_amount` from their linked wallet.
3. When the deposit is credited, the same transaction looks for an open intent from that account and chain whose `token_amount` is less than or equal to the credited amount. If it finds one, it runs the M7 `store.purchase` debit with the intent id as the idempotency key.
4. If no intent matches, it has expired, or the item is already owned (`HubPets.derivedOwned` or `game.item_owned`), the Verse just stays in the wallet. There are no refunds.

## Cash-out: Verse → `$BITCOIN` (Ethereum first)

**Mechanism for v1: the server sends from a hot wallet.**

- The hot wallet holds at most about two days of the global limit (about $1,000 of `$BITCOIN`) plus ETH for gas. It is refilled by hand from the multisig (Safe on Ethereum, Squads on Solana). If the key leaks, the loss is capped at that amount.
- The operator pays the gas. An optional flat fee in Verse per withdrawal can cover it. Gas can be a real share of a $5 withdrawal, so check current prices before choosing the fee.
- The signing key lives in a KMS that supports secp256k1 (AWS KMS and Google Cloud KMS both do). It is never in the Nakama environment, `.env`, or the repo.
- A claim contract with server-signed vouchers, where the player pays gas and the contract enforces the global limit on chain, is the v2 option. It needs a contract audit, so it is not the first step.

**Flow:**

1. `wallet.withdraw` RPC with an idempotency key and a Verse amount.
2. `game.withdraw_verse(...)`, a Postgres function built the same way as `game.exchange_tickets`: it takes the `economy:<user>` advisory lock and runs the idempotency check. It then checks:
   - the account has a linked wallet on that chain, and the 72-hour hold has passed;
   - the amount is within `withdrawable` (see below);
   - the per-account `withdraw` window and the global `payout_window` have room;
   - the address passes the sanctions check (recommended, below);
   - the kill switch for that chain is off.

   If all pass, it debits Verse (`source = 'withdraw:<chain>'`), adds to both windows, and inserts `game.withdrawal` with status `queued`. Everything happens in one transaction.
3. **Payout worker.** It claims `queued` rows one at a time and gives each a nonce from the hot wallet's nonce sequence. It signs through the KMS and stores the raw signed transaction and its hash on the row **before** broadcasting (`signed`), then broadcasts (`sent`).
4. **Confirmation.** The watcher marks the row `confirmed` once the block is finalized.
5. **Failures.**
   - A dropped transaction is rebroadcast from the stored raw transaction, or replaced at the same nonce with a higher fee.
   - A reverted transaction becomes `failed`. Its Verse is credited back (`source = 'withdraw_refund'`), and both windows are reduced by the same amount.
   - A row is never signed twice at different nonces. One withdrawal maps to one nonce, and that rule is what stops a double payout when the worker restarts.

Withdrawal states: `queued → signed → sent → confirmed`, or `→ failed → refunded`. All changes go to an append-only `game.withdrawal_log`.

Solana cash-out comes later with the same flow. Only the worker's signing and broadcast step changes.

## Withdrawable Verse

`game.verse_wallet` gets a `withdrawable bigint NOT NULL DEFAULT 0` column, with `CHECK (0 <= withdrawable AND withdrawable <= balance)`.

| Movement | `balance` | `withdrawable` |
| --- | --- | --- |
| Exchange of server-credited Tickets (from `event_rule`) | + | + |
| Exchange of raw `tickets.earn` Tickets | + | unchanged |
| Deposit | + | + |
| Store purchase | − | reduced only by what the spend-only part cannot cover |
| Withdrawal | − | − |
| Withdrawal refund | + | + |

- Balances from before launch are spend-only. `withdrawable` starts at 0 for everyone.
- To tell server-credited Tickets from raw ones, `game.tickets_balance` and `game.tickets_ledger` get a `kind` (`verified` or `raw`). The exchange spends `verified` first.
- Once every game sends events and `tickets.earn` is turned off outside dev, every new Verse is withdrawable and the `kind` split stops mattering.

## Proposed tables

All tables go through the schema migration ledger as new entries. No existing id is edited.

| Table | Purpose |
| --- | --- |
| `game.wallet_link` | `(user_id, chain)` PK, `address` unique per chain, `linked_at` |
| `game.wallet_link_log` | Append-only link and unlink history |
| `game.link_nonce` | Single-use nonces for the signing messages |
| `game.verse_rate` | Append-only, versioned rate |
| `game.economy_config` / `_log` | Limits, kill switches, reference price; append-only log |
| `game.deposit` | One row per credited or unmatched transfer, unique chain key |
| `game.deposit_dust` | Token remainder per account and chain |
| `game.purchase_intent` | Checkout intents for buying an item with `$BITCOIN` |
| `game.withdrawal` / `_log` | Withdrawal state machine |
| `game.payout_window` | Global cash-out counter per day and chain |
| `game.chain_cursor` | Last finalized block or slot each watcher has processed |

`verse_ledger`, `deposit`, `withdrawal_log`, and both config logs get the same `reject_mutation` append-only triggers as the existing ledgers.

## Proposed RPCs

| RPC | Caller |
| --- | --- |
| `wallet.nonce` | Player. Returns a signing message |
| `wallet.link` | Player. Checks the signature and links or replaces the wallet |
| `wallet.status` | Player. Linked wallets, hold expiry, both windows, `withdrawable` |
| `store.intent` | Player. Creates a `$BITCOIN` purchase intent |
| `wallet.withdraw` | Player. Queues a withdrawal |
| `economy.admin` | Server key only. Rate, limits, kill switches |
| `chain.credit` | Server key only. The watcher reports a finalized deposit |
| `chain.payout_update` | Server key only. The worker reports withdrawal state changes |

## Services

These are new containers in `server/docker-compose.yml`. The Nakama runtime cannot hold long-running chain listeners or sign with a KMS.

- **chain-watcher.** One process per chain. It follows finalized blocks or slots from `game.chain_cursor` and reports deposits and payout confirmations. Each report is idempotent on its chain key, so replaying a range is safe. It needs an RPC provider per chain, with a fallback provider.
- **payout-worker.** It takes queued withdrawals and signs and broadcasts them. Only one instance runs at a time, enforced by an advisory lock, so nonces stay in order.

## Operations

- **Kill switches** per chain for deposits and withdrawals, with a global pause.
- **Alerts:**
  - the hot wallet balance falls below one day of the limit;
  - the global window is used up before 18:00 UTC;
  - the implied dollar value goes past the threshold;
  - the watcher falls behind;
  - a withdrawal stays in `sent` for too long;
  - a single address appears on more than one account over time.
- **Daily reconciliation.** Sum of deposits minus sum of confirmed withdrawals, compared against the actual movement in the treasury and the hot wallet.

## Compliance notes

- **KYC.** None is required by decision. Telling players to report income covers their own taxes, not the operator's obligations. A small daily limit does not by itself put the service outside money-transmission rules. Recommended: a one-time review with a crypto lawyer before cash-out launches.
- **Sanctions screening (recommended).** Check addresses against published sanctions lists at link time and before each withdrawal. It needs no player identity. Free screening APIs and on-chain sanctions oracles exist for this.
- **Age gate.** The People's Bitcoin is 18+. Decide whether the cash-out screen needs the same gate.

## Changes in the game repos

1. Send typed events through `session.event` instead of Ticket amounts through `tickets.earn`. Each event type needs an `event_rule` row with `tickets`, `session_limit`, and `day_limit` set.
2. Add each game's own plausibility checks: minimum session or match length, score bounds, and event rate.
3. Once all four games are switched, `tickets.earn` returns an error outside dev.

## QA cases to add to `server/test/dup/`

- Two withdrawals with the same idempotency key, and two different keys sent at once from two tabs.
- A withdrawal that would cross the per-account or the global lock, by one Verse.
- The worker crashes between `signed` and `sent`, and between `sent` and `confirmed`.
- A deposit reported twice. A deposit inside a range the watcher replays.
- A rate change between the purchase intent and the deposit.
- A wallet change followed by a withdrawal attempt inside the 72-hour hold.
- Account recovery and merge with linked wallets and open withdrawals.
- A store purchase spends spend-only Verse before `withdrawable`.

## Build order

1. Wallet linking, `wallet.status`, admin rate and limits, kill switches.
2. Ethereum pay-in (watcher, deposits, purchase intents).
3. Server-credited Tickets (`event_rule.tickets`, the `kind` split, `withdrawable`) plus the game repo changes.
4. Ethereum cash-out (payout worker, KMS, hot wallet, both locks with hourly release).
5. Solana pay-in, then Solana cash-out.
6. Optional: claim contract (v2), price-drift alert.

## Open questions

1. Is there a flat gas fee in Verse on Ethereum withdrawals, or does the operator absorb gas?
2. Should Verse bought on one chain be cashable on the other? The default is yes. That makes the hub a small bridge, and the per-chain hot wallets need balancing.
3. Can cash-out launch before all four games send server-checked events, given that only server-credited Verse is withdrawable?
4. Should the per-account lock reset at UTC midnight, or run on a rolling 24 hours?
