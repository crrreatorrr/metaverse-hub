# Deferred campaign settlement

PR12 adds additive migration `0055_shooter_verification_settlement`. It remains
disabled: `game.shooter_verification_payment_config.payments_enabled` defaults to
false. No public payment endpoint, issuer, production credential or deployment is
introduced. The approved simulator still mints zero Tickets.

An eligible PR11 terminal is durable independently of payment. After the result
SQL query returns and commits, the internal RPC may make a **second SQL query**.
That transaction authenticates the current scoped worker principal and resolves
the target from its immutable committed result receipt. Caller outcome/amount
fields and echoed run IDs cannot select the credit. It waits for verification of
the complete accepted high-water captured by the first terminal, including tails.
The latest checkpoint revision, cursor and strong hash must match an immutable
completed attempt/job receipt. Committed issuance must still match legacy
boss/day/seed and exact run/account/session identity before new credit.

The worker RPC continues returning its original immutable verification
acknowledgment. It never turns transport success or `terminal_verified` into a
paid claim. Owner status derives `paid` from the authoritative financial receipt;
pending/capped, ineligible and authorization-denied facts remain separate.
Identical result retries can retry payment without replaying the fight.

## Locks, expiry and policy

Payment locks current principal/gateway authorization, payment configuration,
`economy:user`, original game session, legacy run and verification run. It does
not acquire scheduler/admission locks or nest under the checkpoint transaction.
Wallet, cap, ranking and idempotency rows/unique slots are prepared in a
rollbackable subtransaction before the final clock sample. Wager wallet updates
use different locks, so checking only before the wallet wait would be unsafe.

The linearization point is the final live-session predicate after these locks:
original session, correct owner/game, redeemed ticket, open state, and
`lease_until > clock_timestamp()`. Equality expires. A session close serializes
through the held session row. This does not promise that wall-clock durability or
response delivery happens before expiry. Denial rolls back even zero wallet/cap,
ranking-placeholder and idempotency initialization; no financial rows change.
The actual post-lock UTC day selects the shared cap bucket; a bounded retry locks
the actual bucket if midnight passes during preparation.
The private zero-argument `shooter_verification_payment_now()` is SQL VOLATILE
and defaults exactly to `SELECT clock_timestamp()`. It accepts no caller time,
environment/configuration override or table value. Ledger/receipt/idempotency
timestamps use the same final post-lock settlement timestamp.

Payment does not retain the global gateway scheduling lock while waiting for one
account's wallet. It rechecks gateway enablement at its final authorization
boundary; a disable can linearize before or after that read. Payment configuration
and principal/session locks still serialize the corresponding stop/revoke/close.

There is no grace, replacement session or revival of a recorded denial. Current
`game_session` has open/closed/expired states: ordinary expiry is
`session_expired`, while the existing close/invalid-session representation is
`session_closed`. This code does not invent a separate user-session revocation
signal or claim to check independent Nakama JWT revocation. Service principal
revocation/expiry is checked separately and remains an operational payment issue.
Optional lifecycle facts from 0056 preserve observed original-session expiry or
closure against later revival. The independent 45-minute **input** deadline alone
does not deny payment for already accepted work while the original session is live.

The fixed policy is preserved: 20 Tickets or zero, once per canonical boss and
account/game/issuance UTC day, original-session 200 cap, and shared account/game
1000 cap on settlement UTC day. Positive ledger/refund exclusions, original
session references, ledger reason/kind, receipt uniqueness, idempotency and best
cumulative terminal-time ranking retain their existing meanings. A new additive
function copies this fixed policy; applied legacy migration/function bodies are
unchanged, and the guarded legacy settlement cannot settle v2 runs.

Payment never increments verification revision or changes checkpoints, cursors,
terminal result or terminal revision. Ledger, balance, both cap windows, receipt,
ranking, legacy financial status and payment state commit atomically. Paid
receipts remain authoritative after original-session expiry or payment disablement.
Caps produce valid-gameplay `payment_pending/cap_exhausted`, with a bounded
internal `capReason`; a daily-cap retry may succeed on a later UTC day only while
the same original session is still live. Boss/day already paid is a final zero
`ineligible/already_paid`. Assisted/failed/fled terminals remain ineligible.

One bounded payment acknowledgment and first-denial fact are retained per run,
not an unbounded record per retry. Financial receipts/ledgers are not deleted.
The existing input quotas are not claims about total database or RAM capacity.
Retention/cleanup and measured activation limits remain later plan gates.

## Validation

GitHub Actions only: real Nakama/PostgreSQL tests use the retained exact approved
simulator and complete frozen corpus bytes. The 9634-frame Sahil clear is replayed
in bounded jobs, ranks cumulative terminal time, and tests an accepted suffix.
Broccoli clears exercise duplicate workers, response loss after checkpoint or
payment commit, wallet rollback, original-session queue/lock expiry, session close,
current service-key rotation, cap races and stable receipts. Assisted/failure
traces receive zero. A historical issuance-day fixture checks the issuance versus
current settlement bucket split. A separate disposable PostgreSQL test temporarily
replaces the private clock function, holds the A-day cap row at simulated
23:59:59, advances to B-day 00:00:01, then proves the payment waits for B's cap row
after A releases. Exactly one fixed credit charges B, with no additional A usage.
Both sessions/principals stay live in that model. Finally it releases both holder
transactions, restores the exact real-clock function and drops fixture tables.
This exercises real SQL locks with simulated wall-clock values, not physical
midnight. The simulator/verifier clock and execution budgets are unchanged.
Existing fault points are inert without the CI-only runtime environment and armed
database rows. Unit tests check bounded logging and receipt-derived payment target
arguments. No local implementation tests or builds run.

Actual exact-head outcomes, skips and independent review are recorded in the PR.
CI is not hosting-capacity, human control-feel, official-client provenance or
guaranteed-payout evidence. Production migration/activation remains unauthorized.
