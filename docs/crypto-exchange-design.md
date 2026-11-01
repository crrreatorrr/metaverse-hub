# $BITCOIN ⇄ Verse exchange: design

Status: design only. Nothing in this doc is built, registered, or migrated.

Players can trade Verse for HarryPotterObamaSonic10Inu `$BITCOIN` (cash-out), and buy in-game items with `$BITCOIN` (pay-in). In the backend every purchase is still a Verse purchase. The crypto side only adds Verse to or removes Verse from `game.verse_wallet`, through `game.verse_ledger`, the same way `game.exchange_tickets` does today.

Trading happens at an arcade cabinet in the Bar. The player walks up to it and the exchange options open (see [The exchange machine](#the-exchange-machine)).

In this doc, "$BITCOIN" always means the HPOS10I token, never BTC. The UI must say "HPOS10I $BITCOIN" and show the contract address next to every amount.

## Decisions recorded

| Topic | Decision |
| --- | --- |
| Token team | On board |
| Chains | **Ethereum only for now.** Solana is later work |
| Payout source | Own treasury plus `$BITCOIN` that players paid in |
| Treasury pools | One pool per chain, kept separate |
| Exchange rate | Fixed; the operator changes it from an admin control |
| What can be cashed out | All Verse, earned or bought |
| Per-account cash-out limit | A second daily lock, separate from the earning cap, worth about $5 per day |
| Global cash-out limit | $500 per day across all accounts |
| Daily reset | Midnight UTC |
| Gas | The player pays gas, for deposits and for claims |
| Wallets | Players' own wallets. One wallet per chain per account. A player can replace a wallet; the old one is unlinked |
| Holding minimum | None |
| KYC | None. Players are told to report income under their own laws |
| Refunds | None |
| Player-to-player Verse trading | None |
| Bot farming | Accepted risk. The daily locks are the control |
| Trading location | An arcade cabinet in the Bar; options open when the player is near it |
| Smart contract | Written by a smart contract engineer and reviewed for exploits by a separate smart contract security QA expert |
| Game clients | Built by the team, in other repos |

## Token address

| Chain | Address | Source |
| --- | --- | --- |
| Ethereum (ERC-20) | `0x72e4f9f808c49a2a61de9c5896298920dc4eeea9` | Team |
| Solana (SPL mint, later) | `CTgiaZUK12kCcB8sosn4Nt2NZtzLgtPqDwyQyr2syATC` | Team |

The services read `decimals` from the contract at startup. Nothing hardcodes them. Before launch, check the address on chain against the project's official channels. All token amounts are stored in base units as `numeric`, never as a float.

## Accepted risk: bot farming

`tickets.earn` (`server/modules/src/rpcs.ts:448`) credits whatever `amount` the game client sends, up to the session cap and the 1000-per-game daily cap. A script with a free guest account can earn the full Verse cap without playing. There is no holding minimum or KYC, so each bot account can take the full per-account cash-out lock every day. The $500 global lock caps the total loss per day.

This risk is accepted. The plan does not gate cash-out on server-checked earning. It does recommend these to the game repos as hardening, and nothing in the cash-out design depends on them:

1. Send typed events through `session.event` (`sproto.boss_defeated`, `pb.quest_complete`, …) instead of Ticket amounts through `tickets.earn`. The server then credits Tickets from `game.event_rule`. `event_rule.tickets` already exists but is `NULL` in every seed row, and nothing credits from it today.
2. Add each game's own plausibility checks: minimum match length, score bounds, event rate per minute.
3. Hourly release of the global lock (below) stops the first scripts after midnight from taking the whole day's budget.

## Limits

Every limit is stored in Verse in one config row, and every change is logged. The admin page shows the implied dollar value using a reference price the operator enters with the rate. Every daily window resets at **00:00 UTC**.

| Lock | Scope | Where it is counted | Enforced on chain |
| --- | --- | --- | --- |
| Earn cap (exists) | Account × game | `game.earn_window` bucket `verse:<game>` | No |
| Cash-out lock | Account | `game.earn_window` bucket `withdraw` | No |
| Global cash-out lock | All accounts | `game.payout_window` | Yes, by the claim contract |
| Pay-in | None by default | — | — |

- With the current earn caps an account can earn up to 200 Verse a day. The cash-out lock is set on its own so it is worth about $5 at the configured rate.
- **Hourly release (default; can be turned off).** The global $500 opens in 24 equal slices, about $20.83 an hour. Unused budget rolls forward until midnight UTC.
- **Price drift.** Since the rate is fixed in tokens, a jump in the `$BITCOIN` price raises the real dollar value of every limit. An optional price check (a DEX quote) only alerts, or pauses withdrawals, when the implied value of the global limit goes past a threshold the operator sets. It never changes the rate itself.

## Wallet linking

- **Proof of ownership.** The player signs a server nonce with their wallet using EIP-4361 (Sign-In With Ethereum). The server checks the signature before it writes a link. Since only the owner can sign, linking someone else's address is impossible.
- **One wallet per chain per account.** `game.wallet_link` has primary key `(user_id, chain)` and is unique on `(chain, address)`. An address is linked to at most one account at a time.
- **Replacing a wallet.** The new address goes through the same signing flow. The old link is deleted and an `unlink` row goes to `game.wallet_link_log`. The old address is then free.
- **Takeover hold.** New vouchers are blocked for 72 hours after any wallet link or change. Device and recovery-code accounts can be taken over (`recovery.redeem`), and this hold stops a hijacker from immediately pointing payouts at their own wallet. Vouchers that already exist stay bound to the address they were issued to.
- **Account merges and recovery.** Every path that moves or merges accounts (recovery, the custom-auth paths, migrations like the `pb` merge) has to decide what happens to `wallet_link` rows and to the `withdraw` window. The default: links are dropped on merge and must be signed again, and windows are summed. The duplication suite gets cases for both.

## Exchange rate

- `game.verse_rate (version, chain, tokens_per_verse, ref_usd_per_verse, effective_at, set_by)`, append-only. The current rate is the highest version that has taken effect.
- Every deposit, purchase intent, and voucher stores the `rate_version` it used.
- **Rate changes and bought Verse.** Since bought Verse can be cashed out at the same fixed rate, buying and then cashing out with no rate change gains the player nothing and costs them gas. A rate change is different: raising `tokens_per_verse` gives every Verse holder more tokens at cash-out. That exposure is bounded by the two cash-out locks. To keep it small, pause voucher issuing for an hour around a change, or announce changes ahead of time.
- **Admin control.** An RPC that accepts only the Nakama server key (`http_key`), called from a CLI script or a small admin page behind Caddy auth. It sets the rate, the limits, and the kill switches. Every call writes `game.economy_config_log`.

## Pay-in: `$BITCOIN` → Verse → item

The deposit address is the Ethereum treasury multisig (Safe) itself. Pay-in uses no custom contract.

Matching is by sender. Each account has at most one linked Ethereum wallet, so any `$BITCOIN` transfer **from a linked wallet to the deposit address** is credited to that account. No memo, reference key, or payment contract is needed. The player pays the gas for the transfer.

- **Watching.** Watch `Transfer(from, to = treasury, value)` logs on the token contract. The dedupe key is `(chain, tx_hash, log_index)`. Credit the logged `value` (what was actually received), and only after the block is `finalized`.
- **Conversion.** `verse = floor(amount / tokens_per_verse)`. The remainder is kept per account in `game.deposit_dust` and added to the next deposit.
- **Ledger.** `game.verse_ledger` gets `source = 'deposit:eth'`. Deposits never write `game.verse_earned`, so bought Verse does not count on the Bar scoreboard.
- **Unmatched deposits.** A transfer from an address that is not linked is stored with status `unmatched`. If that address is linked later, the signature proves ownership, so the deposit is credited to that account at that point.
- **Wrong token or wrong chain.** It is not watched and not credited. The machine says so before the player sends anything.

**Buying an item with `$BITCOIN`:**

1. Checkout writes `game.purchase_intent (intent_id, user_id, item_id, verse_price, chain, token_amount, rate_version, expires_at)`. Since the rate is fixed, `token_amount` is exact.
2. The player sends `token_amount` from their linked wallet.
3. When the deposit is credited, the same transaction looks for an open intent from that account whose `token_amount` is less than or equal to the credited amount. If it finds one, it runs the M7 `store.purchase` debit with the intent id as the idempotency key.
4. If no intent matches, it has expired, or the item is already owned (`HubPets.derivedOwned` or `game.item_owned`), the Verse just stays in the wallet. There are no refunds.

## Cash-out: Verse → `$BITCOIN` through a claim contract

The player pays gas, so cash-out uses a claim contract. The server never sends tokens itself and holds no hot wallet. It signs vouchers, and the player submits them to the contract from their linked wallet.

### Claim contract (`VerseCashout`)

Written by the smart contract engineer, reviewed by the security QA expert (see [Smart contract team and review](#smart-contract-team-and-review)). Required behaviour:

- It holds a float of `$BITCOIN`, about two days of the global lock, refilled by hand from the Safe. The Safe is the owner.
- `claim(voucher, signature)` and `claimBatch(vouchers[], signatures[])` transfer tokens to the voucher's `recipient`. With batching, a player can save up several days of vouchers and pay gas once.
- A voucher is EIP-712 typed data: `id`, `recipient`, `amount`, `expiry`. The signing domain includes the chain id and the contract address, so a voucher can't be replayed on another chain or contract.
- Each `id` can be claimed exactly once. A claim after `expiry` reverts.
- **On-chain daily cap** in tokens, by UTC day (`block.timestamp / 86400`). This is the second defense. If the signing key leaks, the loss is capped at one day's on-chain cap until someone pauses the contract. The cap leaves room for vouchers issued on one day and claimed on a later day.
- `pause()` can be called by the Safe or a guardian key. `unpause()`, signer rotation, cap changes, and withdrawing the float back to the Safe are Safe only.
- Not upgradeable. A new version is a new deployment, with the old one drained to the Safe.
- Tokens move with `SafeERC20`. The reviewer confirms how the `$BITCOIN` token behaves (return values, fees, blocklists, pausing) before launch.
- Emits `Claimed(id, recipient, amount)`.

The signing key is a secp256k1 key in a KMS (AWS KMS and Google Cloud KMS both support it). It is never in the Nakama environment, `.env`, or the repo. The key can only sign vouchers. It cannot move funds, and on-chain limits bound what its vouchers can claim.

### Flow

1. At the machine, the player chooses a Verse amount and calls the `wallet.withdraw` RPC with an idempotency key.
2. `game.withdraw_verse(...)`, a Postgres function built the same way as `game.exchange_tickets`, takes the `economy:<user>` advisory lock and runs the idempotency check. It then checks:
   - the account has a linked wallet and the 72-hour hold has passed;
   - the Verse balance is enough;
   - the per-account `withdraw` window and the global `payout_window` have room;
   - the address passes the sanctions check (recommended, below);
   - the kill switch is off.

   If all pass, it debits Verse (`source = 'withdraw:eth'`), adds to both windows, and inserts `game.withdrawal` with a new voucher `id`, `recipient`, the token amount, `expiry` (default 30 days), and status `issued`. Everything happens in one transaction.
3. The voucher signer service signs the voucher through the KMS and stores the signature on the row (`signed`). The signer only signs rows in `issued`, and only once.
4. The machine shows every signed, unclaimed voucher. The player claims one or all of them in one transaction from their wallet.
5. The watcher sees `Claimed` in a finalized block and marks the row `claimed`.
6. **Expiry.** A voucher that was never claimed becomes `expired` only once a finalized block has a timestamp past `expiry` and no `Claimed` event exists for its `id`. Only then is the Verse credited back (`source = 'withdraw_refund'`). Because the contract rejects expired vouchers, a refund can never pay out twice. The daily windows are not given back on expiry.

Withdrawal states: `issued → signed → claimed`, or `signed → expired → refunded`. All changes go to an append-only `game.withdrawal_log`.

The player needs ETH in the linked wallet for gas. The machine checks this and says so before showing the Claim button.

## The exchange machine

The Bar interior already has two `I7-arcade` cabinets (`apps/hub/src/v2/interior.ts:285` and `:289`). One of them becomes the exchange machine. The default is `arcade` at `(1.4, 0, 5.7)`; see the open questions.

- **Look.** The cabinet gets an emissive "EXCHANGE" marquee and a screen texture, so players can spot it from across the Bar.
- **Proximity.** Inside the Bar, when the player is within about 1.6 m of the cabinet's front, the hint line shows `Press E to use the exchange machine`. E is not bound today. Moving away hides the hint. This follows the same pattern as `updateHint` in `apps/hub/src/main.ts`.
- **Open.** Pressing E releases pointer lock and opens an overlay styled as the cabinet screen. Movement keys are ignored while it is open. Esc or walking away closes it.
- **Screens on the machine:**
  - **Wallet**: link or replace the Ethereum wallet (MetaMask or WalletConnect), show the linked address and the 72-hour hold.
  - **Buy Verse**: the rate, the deposit address, the exact amount, and pending and credited deposits.
  - **Cash out**: Verse balance, today's room on the per-account lock, the global room for the current hour, the amount picker, and the vouchers waiting to be claimed with a Claim all button.
  - **History**: deposits, vouchers, claims, refunds.
- **Offline.** With no Nakama session, the machine shows "Exchange offline" and nothing else.
- **Bundle.** The wallet libraries (viem/wagmi, WalletConnect) load only when the machine opens, never in the main hub bundle. `scripts/check-prod-bundle.mjs` should check this.
- **Buying items with `$BITCOIN`.** This uses the same wallet flow. Whether it is offered at store checkout as well, or only at the machine, is an open question.

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
| `game.deposit_dust` | Token remainder per account |
| `game.purchase_intent` | Checkout intents for buying an item with `$BITCOIN` |
| `game.withdrawal` / `_log` | Voucher state machine |
| `game.payout_window` | Global cash-out counter per UTC day and hour |
| `game.chain_cursor` | Last finalized block each watcher has processed |

`verse_ledger`, `deposit`, `withdrawal_log`, and both config logs get the same `reject_mutation` append-only triggers as the existing ledgers.

## Proposed RPCs

| RPC | Caller |
| --- | --- |
| `wallet.nonce` | Player. Returns a signing message |
| `wallet.link` | Player. Checks the signature and links or replaces the wallet |
| `wallet.status` | Player. Linked wallet, hold expiry, both windows, open vouchers |
| `store.intent` | Player. Creates a `$BITCOIN` purchase intent |
| `wallet.withdraw` | Player. Debits Verse and issues a voucher |
| `economy.admin` | Server key only. Rate, limits, kill switches |
| `chain.credit` | Server key only. The watcher reports a finalized deposit |
| `chain.claim_update` | Server key only. The watcher reports claims and expiries |
| `voucher.sign` | Server key only. The signer stores a voucher signature |

## Services

These are new containers in `server/docker-compose.yml`. The Nakama runtime cannot hold long-running chain listeners or sign with a KMS.

- **chain-watcher.** Follows finalized Ethereum blocks from `game.chain_cursor` and reports deposits, `Claimed` events, and voucher expiries. Each report is idempotent on its chain key, so replaying a range is safe. It needs an RPC provider plus a fallback provider.
- **voucher-signer.** Signs `issued` vouchers through the KMS. Only one instance runs at a time, enforced by an advisory lock. It never broadcasts transactions and holds no ETH.

## Smart contract team and review

The developer and the reviewer are **different people**. The reviewer's job is to break the contract, not to confirm it.

**Smart contract engineer (builds it)**
- Writes the spec for `VerseCashout` from this doc: roles, limits, voucher format, events, failure cases.
- Builds it in Solidity with Foundry. This includes unit tests, fuzz tests, and invariant tests, for example: total claimed in a UTC day ≤ the cap; an `id` is never claimed twice; only the Safe can move the float.
- Writes the off-chain voucher signing code together with the backend, so the EIP-712 domain, types, and encoding match exactly.
- Deploys to Sepolia, then mainnet, using deploy scripts and a checklist: owner = Safe, signer = KMS address, caps set, verified on Etherscan.

**Smart contract security QA expert (looks for exploits)**
- **Review scope:** the contract, the voucher format and signing code, the watcher's handling of `Claimed` and expiry, the refund rule, and how the `$BITCOIN` token itself behaves.
- **Methods:** manual line-by-line review, static analysis (Slither), their own fuzz and invariant campaigns (Echidna or Medusa), plus attack scenarios:
  - replaying a voucher, or reusing it on another chain or contract;
  - signature malleability;
  - reentrancy through the token;
  - griefing `claimBatch` with one bad voucher;
  - the cap rolling over at the UTC day boundary;
  - a claim and a refund racing at the moment of expiry;
  - a leaked signer key;
  - a mistake by an owner or guardian.
- **Deliverable:** a findings report with a severity for each finding. The engineer fixes them, and the QA expert re-checks every fix. Launch is blocked on any open critical or high finding.

**Launch steps after review**
1. A full end-to-end run on Sepolia with the real hub, watcher, and signer.
2. Mainnet with low caps, for example a $50 global lock for the first week. Then raise the caps.
3. Optional: a public bug bounty, and a third-party audit if the float grows.

## Operations

- **Kill switches:** separate switches for deposits and voucher issuing, plus the contract's `pause()`.
- **Alerts:**
  - the contract float falls below the open vouchers plus one day of the limit;
  - the global window is used up early;
  - the implied dollar value goes past the threshold;
  - the watcher falls behind;
  - a `Claimed` event arrives with no matching `withdrawal` row (that means the signer is compromised: pause at once);
  - a single address appears on more than one account over time.
- **Daily reconciliation.** Sum of deposits minus sum of claims, compared against the actual movement in the Safe and the contract.

## Compliance notes

- **KYC.** None is required by decision. Telling players to report income covers their own taxes, not the operator's obligations. A small daily limit does not by itself put the service outside money-transmission rules. Recommended: a one-time review with a crypto lawyer before cash-out launches.
- **Sanctions screening (recommended).** Check addresses against published sanctions lists at link time and before each voucher is issued. It needs no player identity.
- **Age gate.** The People's Bitcoin is 18+. Decide whether the exchange machine needs the same gate.

## QA cases to add to `server/test/dup/`

- Two withdrawals with the same idempotency key, and two different keys sent at once from two tabs.
- A withdrawal that would cross the per-account or the global lock by one Verse, including across the hourly release and at 00:00 UTC.
- The signer crashes after storing a signature, and before storing one.
- A deposit reported twice. A deposit inside a range the watcher replays.
- A claim in the same block as the voucher's expiry. No refund before a finalized block past expiry.
- A `Claimed` event for an id the database doesn't have.
- A rate change between the purchase intent and the deposit.
- A wallet change followed by a withdrawal attempt inside the 72-hour hold.
- Account recovery and merge with linked wallets and open vouchers.

## Build order

1. Wallet linking, `wallet.status`, admin rate and limits, kill switches, and the exchange machine shell (proximity, E prompt, overlay, Wallet screen).
2. Ethereum pay-in: watcher, deposits, purchase intents, Buy Verse screen.
3. Claim contract: engineer builds it, QA expert reviews it, fixes and re-review, Sepolia.
4. Ethereum cash-out: voucher signer, KMS, both locks with hourly release, Cash out screen, end-to-end on Sepolia.
5. Mainnet with low caps, then raise them.

## Later: Solana

Solana uses its own treasury pool (a Squads multisig) and its own float, and the same rate as Ethereum. Verse is one balance, so Verse bought on one chain can be cashed out on the other. The operator rebalances the two pools by hand. Pay-in matches by sender, the same as on Ethereum. Cash-out needs its own claim program, built and reviewed by the same team-and-review process.

## Open questions

1. Which Bar cabinet becomes the exchange machine: `arcade` at `(1.4, 0, 5.7)`, `arcade2` at `(9.3, 0, -1.6)`, or both?
2. Is buying items with `$BITCOIN` offered only at the machine, or at store checkout as well?
3. Voucher expiry: is 30 days right?
4. Are the engineer and the QA expert people you hire, or AI agent passes? For a contract that holds funds, at least the final exploit review should be a human with an audit track record.
