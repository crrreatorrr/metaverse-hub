# Campaign verification decisions and gates

Status: **PR 00 baseline; PR 01 contract not approved.** See [baseline](baseline.md) and the [full handoff](implementation-plan.md).

The owner's implementation request authorizes development and GitHub PRs. It does not authorize deployment, public activation, purchasing hosting, creating production credentials or applying production migrations. New paths remain default-off. Each security-sensitive PR needs independent review. Required long-run tests must not be shortened, validation weakened or timeouts increased to pass.

## Decisions required before dependent feature work

| ID | Decision | Proposal / current behavior | Status |
| --- | --- | --- | --- |
| D01 | Ordinary session expiry while valid accepted work is queued | Proposal: accept gameplay only with valid original authorization, retain original session accounting, allow settlement for up to 24 hours after ordinary expiry; revocation/fraud are distinct. Current SQL requires a live session at settlement. The authorization event and grace deadline must be durably stored, not inferred from client time. | Awaiting owner decision; no policy change implemented |
| D02 | Encoded input and whole-run size | Proposal: 2 MiB per immutable batch and 64 MiB cumulative per run, separately bounded actions/batches and existing 45-minute frame ceiling. Alternative: retain 2 MiB whole-run limit and explicitly accept its earlier input ceiling. These are safety ceilings, not measured operating cadence/capacity recommendations. | Awaiting owner decision; no limits changed |
| D03 | Midnight accounting | Preserve existing split: boss/day uniqueness uses issuance UTC day; shared daily Ticket cap uses settlement UTC day; original session cap stays attached to issuance session. Delayed payment must remain transactional and idempotent. | Existing behavior to preserve; any change needs explicit approval |

After D01/D02, PR 01 must also make the full lifecycle unambiguous: canonical boss-section start/loadout, fixed tick cadence and first terminal tick, post-terminal handling, pause/hitstop/hidden-tab rules, reconnect authorization, upload grace/run expiry, active-run bounds, artifact support lifetime, request/action/batch totals and operational timeout classification. These are not implicitly approved by this baseline. Do not start dependent PRs by inventing missing economic behavior.

## Product decision before public activation

**Browser actions are not proof that the official client ran.** Authenticated live sessions and legal replayed inputs can be imitated by a protocol-only emulator. Client hashes, Origin, WebAssembly, JavaScript secrets and timing do not attest provenance. Humans and bots controlling legal client inputs remain supported; reward eligibility is server-owned. Do not describe this architecture as secure official-client-only rewards.

Before public activation, the owner must explicitly accept server-verified gameplay with that limitation, or redirect to a separate hosted-client/native-attestation design. No acceptance has been inferred. Development may prepare dormant functionality after contract gates; public rollout remains blocked.

## Measurement and operational gates

PRs 20–21 require authorized deployment-equivalent measurements, including twenty independent users, long and failed runs, bursts/retries, cold/warm workers and concurrent Hub/PvP traffic. CI timing is not capacity evidence. Host specification, region, cost increase, safe concurrency and reward delay remain unmeasured. Paid infrastructure tests and hosting placement/purchases require approval. PR 22 rollout depends on measured limits and explicit provenance/hosting decisions, not merely green CI.

Stop-new-runs and drain/retain accepted work must be separate controls. Rollback must retain receipts, ledger, accepted input and version-compatible execution; never undo legitimate payments, drop additive schema or automatically send long jobs back into Goja.

## Completion reporting

Track each PR/commit, exact tested artifacts, current-main compatibility, independent reviews, migration upgrade results, correctness/fault matrix, skipped/failed/unrun checks and unmeasured capacity claims. PR 00 does not complete PRs 01–22. Publication of a development environment is unrelated to deploying this reward system.
