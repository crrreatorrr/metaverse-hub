# Migration allocations

Check current main **and open pull requests** before allocating a numeric prefix.
A reserved prefix belongs to its linked work even before merge. Update this list
when merging; do not edit an applied migration's ID or statement body.

| Prefix | Allocation |
| --- | --- |
| 0050 | Historical independent pair: `0050_pb_campaign_pistol_price` (#147) and `0050_shooter_verification_queue` (#141), both merged |
| 0051 | Verification ingestion, #144 |
| 0052 | Verification jobs and leases, #150 |
| 0053 | Scoped worker gateway, #152 |
| 0054 | Atomic verification commits, #153 |
| 0055 | Deferred settlement, #155 |
| 0056 | Verification issuance/finish lifecycle companion, #156 |
| 0057 | Recovery, retention and operational cleanup, #159 |
| 0058 | Worker observations/own-proof recovery, #160 |
| 0059 | In-game feedback notes, screenshots, history and the admin row (`games/hub_feedback.ts`) |
| 0060 | `0060_hub_exchange`: hub-scope Ticket exchange function `game.exchange_tickets_hub` (gameplay plan B1), branch `claude/trusting-ramanujan-63h582` |
| 0061 | `0061_relic_unhold`: releases the held Genesis Block Shard, Tidebreaker Belt and four held pets and promotes their pending claims (gameplay plan B3), branch `claude/trusting-ramanujan-63h582`. PR #140 (Belt wording and tests) carries no migration: its Belt release is this one |
| 0062 | `0062_hub_exchange_open`: turns the `hub_exchange` server flag on, so the plaza Wallet exchange (`verse.exchange`) is open; an operator can still set it off by hand. Branch `claude/open-plaza-exchange` |
| 0063 | `0063_coop_settle_fingerprint`: rewrites the fingerprint literal inside `game.settle_coop_clear` from 0041's `f8705ec4…` to the vendored Coop sim's `fb9f2679…` (`CoopRewards.FINGERPRINT`); stored receipts and payouts are untouched. Branch `claude/open-plaza-exchange` |
| 0064 | `0064_feedback_check`: `game.feedback_run`, the queue behind the feedback admin panel's Check button (one queued-or-running run at a time), and each note's pull request link and state (`pr_url`, `pr_state`, `pr_checked_at`), #184 |
| 0065 | `0065_shooter_campaign_fingerprint`: rewrites the fingerprint literal inside `game.settle_shooter_clear` from 0048's `cea1f88b` to the vendored campaign sim's `73c6eb0f` (`ShooterRewards.FINGERPRINT`); stored receipts and payouts are untouched. Branch `claude/feedback-check-trigger` |
| 0066 | `0066_shooter_campaign_artifact`: moves the live verification allowlist (`issue_shooter_verification_run`, `shooter_verification_private_work`, `settle_shooter_verified_result`) onto the vendored campaign bundle `2215995f` / `4968fa64…` / `73c6eb0f`. Stored rows and the 20 Ticket amount stay. Branch `claude/feedback-check-trigger` |
| 0067 | `0067_shooter_campaign_bundle`: moves that allowlist from `2215995f` / `4968fa64…` onto the shared-gameplay campaign bundle `7137f558` / `ae9ede47…` (fingerprint stays `73c6eb0f`). The Arena pin in the same re-vendor is fingerprint `e749d2fd`, commit `7137f558`, sha256 `e8091d14…`. Stored rows, the 20 Ticket amount, and wager settlement stay. Branch `cursor/revendor-shooter-main-81ca` |

The two 0050 migrations merged independently. Their full IDs are ledger keys;
renumbering either could orphan recorded history or replay an already applied
body. The runner permits only those two exact identities to share that prefix,
ordered PB then Shooter. Their SQL concerns independent shop-price and queue
objects. Every other duplicate full ID or numeric prefix remains an error.

The existing checksum, missing-code, advisory-lock and out-of-order checks are
unchanged. Fresh databases apply both. A database with either 0050 recorded and
no later migration can apply its missing sibling while preserving recorded
checksums and `applied_at`. A database with a later recorded migration but a
missing 0050 sibling still fails closed; this patch does not authorize history
rewrites or production recovery operations. Investigate and prepare a separate
reviewed recovery before changing such a database.

All compatibility validation uses disposable GitHub Actions databases. No
production database inspection, migration application or deployment is implied.
