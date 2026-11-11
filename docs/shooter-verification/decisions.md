# Campaign verification decisions and gates

Status: **Owner decisions D01/D02 and browser-provenance acceptance recorded.** See the [current execution ledger](execution-ledger.md) for merged implementation and scoped evidence, alongside [baseline](baseline.md), [protocol v2](protocol-v2.md), [threat model](threat-model.md) and the [full handoff](implementation-plan.md).

The owner's implementation request authorizes development and GitHub PRs. It does not authorize deployment, public activation, purchasing hosting, creating production credentials or applying production migrations. New paths remain default-off. Each security-sensitive PR needs independent review. Required long-run tests must not be shortened, validation weakened or timeouts increased to pass.

## Decisions required before dependent feature work

| ID | Decision | Proposal / current behavior | Status |
| --- | --- | --- | --- |
| D01 | Ordinary session expiry while valid accepted work is queued | **No settlement grace.** Owner rejected the 24-hour proposal. Settlement must require the original session to remain open, redeemed and unexpired under the existing SQL rule. Accepted input and verified results remain durable; expiry is a separately reported authorization failure, not cheating. No replacement session can inherit a run or its cap accounting. | Owner answered **NO**; contract only, runtime unchanged |
| D02 | Encoded input and whole-run size | **2 MiB per immutable batch; 64 MiB cumulative per run**, with separately bounded actions/batches and the existing 45-minute frame ceiling. These are safety ceilings, not measured operating cadence/capacity recommendations. | Owner answered **yes**; contract only, runtime unchanged |
| D03 | Midnight accounting | Preserve existing split: boss/day uniqueness uses issuance UTC day; shared daily Ticket cap uses settlement UTC day; original session cap stays attached to issuance session. Delayed payment must remain transactional and idempotent. | Existing behavior to preserve; any change needs explicit approval |

The protocol now specifies canonical boss-section start/loadout, fixed tick cadence and first terminal tick, post-terminal handling, pause/hitstop/hidden-tab rules, reconnect authorization, no expiry grace, active-run bounds, artifact support lifetime, request/action/batch totals and operational timeout classification. Numerical resource ceilings are dormant proposed defaults for review and later measurement, not a public capacity promise. Do not change economic policy during implementation.

### Consequence of D01

Timely acceptance does **not** reserve a future payment or bypass the live-session settlement predicate. A queued run can verify successfully after its original session expires and receive **no payment**. The client must explain this before rewarded play and show `session_expired`, distinct from `invalid_gameplay`, `revoked` and a retryable infrastructure failure. Preserve terminal evidence even when payment is denied. No hidden grace, automatic rebind or retroactive renewal is authorized. Ordinary token refresh is permitted only while the original underlying session remains valid; it cannot revive an expired run.

This supersedes the original handoff's proposed ability to finish payment after ordinary expiry. The owner explicitly chose live-session settlement. PR 12 must test this denial path and the boundary race transactionally; the implementation must not claim every timely accepted valid run is guaranteed payment. Deployment-equivalent measurements must quantify the risk of sessions expiring in the queue before rollout approval.

## Product decision before public activation

**Browser actions are not proof that the official client ran.** Authenticated live sessions and legal replayed inputs can be imitated by a protocol-only emulator. Client hashes, Origin, WebAssembly, JavaScript secrets and timing do not attest provenance. Humans and bots controlling legal client inputs remain supported; reward eligibility is server-owned. Do not describe this architecture as secure official-client-only rewards.

On **2026-11-11**, the owner explicitly decided: **“Accept server-verified legal inputs, including bots/emulators.”** This fulfills the browser-provenance product decision for humans, legal bots and protocol-only emulators whose inputs satisfy server verification. It does not attest that the official client ran, authorize production deployment/public activation or approve hosting purchases. Intended-host measurements, hosting approval and the remaining rollout gates still apply; public rollout remains blocked.

## Measurement and operational gates

PRs 20–21 require authorized deployment-equivalent measurements, including twenty independent users, long and failed runs, bursts/retries, cold/warm workers and concurrent Hub/PvP traffic. CI timing is not capacity evidence. Host specification, region, cost increase, safe concurrency and reward delay remain unmeasured. Paid infrastructure tests and hosting placement/purchases require approval. PR 22 rollout depends on measured limits and explicit provenance/hosting decisions, not merely green CI.

Stop-new-runs and drain/retain accepted work must be separate controls. Rollback must retain receipts, ledger, accepted input and version-compatible execution; never undo legitimate payments, drop additive schema or automatically send long jobs back into Goja.

## Completion reporting

Track each PR/commit, exact tested artifacts, current-main compatibility, independent reviews, migration upgrade results, correctness/fault matrix, skipped/failed/unrun checks and unmeasured capacity claims. PR 00 does not complete PRs 01–22. Publication of a development environment is unrelated to deploying this reward system.
