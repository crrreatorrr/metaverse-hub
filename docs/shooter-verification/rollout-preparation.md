# Rollout preparation: controls and staging drill

Status: **core CI subset executed; full operator drill unexecuted; public activation blocked.**
This prepares PR22 without completing PR21 or PR22. It changes no production
runtime, configuration, schema, financial policy or deployment. The [original plan](implementation-plan.md)
requires intended-host measurements before selecting operating limits and a
staging demonstration before rollout. Running that demonstration against an
external host, deploying, applying production migrations, creating production
credentials and public activation still require explicit authorization.

The owner accepted server-verified legal inputs, including bots/emulators. This
does not attest official-client provenance. The owner rejected settlement grace:
the original session must remain live at payment. The accepted input ceilings
remain 2 MiB per batch and 64 MiB per run, with separate frame/action/batch limits.
Those ceilings are not measured upload cadence or capacity recommendations.

## Existing operator control matrix

These are existing control names and effects, not instructions to enable them.
Use the reviewed operator process for the target environment; there is no new
public configuration RPC in this preparation.

| Control | Existing effect | Rollback caution |
| --- | --- | --- |
| Client build `VITE_SHOOTER_REWARDED` | Exposes the default-off rewarded UI when explicitly enabled. Server selection/readiness remains authoritative. | Hiding a new client entry point does not close already issued runs or replace the server stop switch. |
| `game.shooter_verification_cohort` | Server selects v2 for enrolled accounts; enrollment is sticky and rows cannot be changed/deleted. Historical issue keys retain their original version. | Gradual enrollment can use small reviewed account batches. Do not remove cohort rows or route enrolled accounts to legacy when v2 is stopped. |
| `game.shooter_verification_admission.new_runs_enabled` | Default-off new-run admission, subject to finite configured global/account budgets and readiness. | Set stop-new independently of processing controls. Existing accepted inputs, authorized append/finish and owner status must remain recoverable. |
| `game.shooter_verification_scheduler.claims_enabled` | Stops new claims when disabled. Current bounded attempts can still renew/resolve under their original deadlines. | A full backlog drain needs new claims enabled; disabling this is a processing pause, not completed drain. |
| `game.shooter_verification_gateway.enabled` | Gates authenticated worker operations. | Turning it off can block result/renewal/proof recovery. It is not the normal stop-new switch. Preserve uncertain journals and accepted work. |
| `game.shooter_verification_payment_config.payments_enabled` | Default-off settlement gate. Eligible committed work may return retryable `payments_disabled`; receipts already paid remain authoritative. | This is a payment pause, not permanent no-pay shadow mode. Later repair may pay while original authorization remains live. Never label pending work as permanently unpaid or reverse legitimate payment. |
| Coordinator SIGTERM / offline-daemon shutdown | Existing bounded graceful drain stops new work and retains uncertain private recovery state for restart. | Do not delete journals to recover readiness. Keep their original logical worker/account identity and approved artifact available. |
| Retained artifact allowlist and version binding | Accepted work remains bound to its issued manifest and retained executable. | Keep supported old artifacts for unresolved/quarantined work. Never substitute the current vendor or fall back to long Goja replay. |

New v2 issuance currently requires admission, claims, gateway and payments to be
enabled, an enrolled account, live original-session authorization and finite
readiness. A prior issue acknowledgment does not grant fresh authority. A normal
stop-and-drain therefore stops **new issuance** while keeping the authorized
worker/payment path available for existing work. If operators must pause that
path too, they must retain evidence and report the backlog and expiry risk.

## Staging-only rollback drill specification

**Full eight-step operator drill unexecuted.** The executed core CI subset below
does not complete this specification. Obtain explicit authorization before
execution against an external staging target. Use disposable accounts and the
actual public APIs/coordinator/offline worker. Do not run these steps on
production by copying this document. Record exact source/image/artifact hashes,
configuration snapshots, original session bindings and bounded sanitized results.
Never retain tokens, private checkpoints, input logs, SQL arguments or raw errors
in an operator report.

1. Establish baseline identities and state: one accepted partial run, one sealed
   pending run, one verified terminal/payment-pending run and one paid receipt.
   Include a historical legacy issue key. Use real supported fixtures and keep
   live-session and intentionally expired-session cases separate. Record received
   versus verified cursors and immutable acknowledgment/receipt digests.
2. Stop new v2 issuance using the admission switch. A fresh key for an enrolled
   account must be refused/pending without a legacy fallback or quota mutation;
   a historical key must preserve its version and original acknowledgment.
3. Continue the previously issued live run through ordinary append and finish.
   Retry one exact immutable request after a lost response and recover its
   acknowledgment/status. Account for each accepted byte once. Do not substitute
   a full-log submission, new session or guessed history.
4. Keep the authorized worker path enabled and drain accepted work. Check exact
   manifest/fence/revision/cursors, terminal immutability and stable receipts.
   Exercise graceful coordinator restart with an uncertain request; require
   exact-request proof recovery and no duplicate financial effects.
5. Separately pause new claims while a real attempt exists. Verify renew/result
   handling stays bounded by its original attempt deadline and that unclaimed
   work remains durable. Resume claims and prove continuation from committed
   progress. A pause must not be reported as a completed drain.
6. Separately demonstrate the payment pause on eligible committed work, with
   new issuance still stopped. Observe retryable pending payment and unchanged
   wallet/ledger/ranking while disabled. Restore the normal gate only under the
   approved staging fixture; a still-live original session can settle once.
   An expired/closed original session must instead be denied with no grace or
   rebind. Previously paid receipts remain stable through either case.
7. Compare pre/post retained-history facts, acknowledgments, terminal revisions,
   receipt/ledger effects and artifact bindings. Require no lost accepted ranges,
   no duplicate reward, no reversed legitimate payment and no additive-schema
   removal. Reconcile unresolved/quarantined work explicitly before any artifact
   or logical-worker retirement.
8. Finish with new issuance stopped. Publish bounded pass/fail evidence for every
   step, including unknown/unexecuted cases. Preserve failures and operator
   interventions; do not call the rollout drill passed from unit tests alone.

## Executed core CI subset

At exact head `e7d4200db7ef4641e4ac5fa371fc5c4201404223`, the
[combined core drill](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43068973510/job/130691406543)
passed in one isolated Actions fixture, using
[`shooter-rollout-drill.test.ts`](../../server/test/shooter-rollout-drill.test.ts).
Three independent actors each verified the full frozen Broccoli trace of 2,959
frames / 47,344 encoded frame-text bytes through the actual coordinator/offline
worker and retained05f oracle. The fixture took 46.93 seconds; this is not a
capacity or target-host timing result.

The sequence proved an already-paid baseline, stop-new with retained v2 issue-key
recovery and continued public append/finish, exact lost-append acknowledgment
recovery, and a real uncertain committed RESULT followed by coordinator kill and
restart. Its original request digest/immutable acknowledgment survived, with one
observed journal recovery. Payment pause preserved financial state; resuming
paid the original live-session actor 20 once and denied the expired-session actor
with zero. The baseline remained paid 20. A second restart preserved accepted
history, verification/terminal/artifact and financial digests; cleanup passed
with new issuance stopped.

The run retains `shooter-core-rollout-drill`, containing the closed report with
phase completion, binding/proof digests and 20/20/0 credit outcomes. It contains
no raw input, private checkpoint, journal, credential or raw error. Evidence is
scoped to that exact head; it is not an automatic proof of later candidates.
This fixture does not demonstrate active-lease renewal while claims are disabled,
active SIGTERM drain, the historical legacy-key case, permanent shadow policy,
external operator rollout, measured alert thresholds or intended-host capacity.
The complete operator checklist remains open; PR21 and PR22 are not complete.

Existing issuance, retention, financial and compatibility tests separately cover
individual invariants. See
[lifecycle](lifecycle.md), [settlement](deferred-settlement.md),
[retention](recovery-retention.md) and the [worker runbook](../../services/shooter-verifier/ops/README.md).

## Dashboard and alert fields awaiting measurement

All warning/stop thresholds, sampling windows and recovery targets below are
**UNMEASURED / UNSET**. Do not derive production values from CI wall time or
treat missing data as zero. PR21 must supply intended-host evidence, an owner for
each alert, its action, and an approved limit before activation.

| Field group | Required observations and response to define |
| --- | --- |
| Verification backlog | Queue depth/oldest age, accepted-minus-verified input, arrivals/completions and their time series; distinguish saturation, invalid play and a stuck worker. |
| Durable capacity | Retained runs/jobs/attempts, reserved input/checkpoint/receipt bytes versus configured budgets, actual storage growth and supported cleanup/restore state. Terminal completion does not imply reservation reclamation. |
| Worker health | Freshness, readiness, artifact match, journal phase, result/proof recovery, restart/timeout/CPU/RSS/cgroup pressure. Stale/unavailable/truncated observations remain explicit. |
| Payments | Eligible pending age/count, observed paid receipts, unpaid/censored counts, payment-repair failures/orphans and original-session expiry/close denials. Verification is not payment. |
| Online/client health | Before/after Hub/free-PvP latency and both-seat input coverage; actual client frame quantiles with viewport/preset/DPR/hardware and sample scope. Separate client, load-generator and verifier CPU. |
| Authorization/artifact lifetime | Scoped key expiry/rotation, original-session time remaining, supported manifest inventory and unresolved work requiring old logical-worker identities/artifacts. |

[PR170](https://github.com/crrreatorrr/metaverse-hub/pull/170)'s CI-only result-stage
tracing provides diagnostic evidence; it is not a production dashboard,
deployment instruction or measured alert threshold.

## Shadow mode remains a separate contract

The plan requires “Shadow verification with no second payment path”; it does not
mandate mirroring v1 and v2 simultaneously on live production accounts. No
permanent verify-only issuance policy is implemented by the controls above.
Turning payments off and later on can pay old pending work, so it cannot satisfy
that promise by itself.

Before implementing a live shadow mode, review its exact workload and immutable
financial classification, status/UI meaning, repair behavior and transition
rules. Prove no shadow run can later become payable through a flag change,
historical retry, repair or legacy path. Normal eligible v2 runs must retain
their existing payment contract. Any required runtime/schema change belongs in
an independently reviewed additive PR with a newly reserved migration number;
do not edit applied migration bodies. This document reserves no migration and
does not choose new financial semantics.

## Public activation checklist (all gates required)

- [ ] Resolve the observed result-RPC timeout with exact-head correctness and
  primary client-under-load evidence; retain earlier failed reports.
- [ ] Record authorized intended host/region/specifications, load placement,
  baseline/candidate measurements and supported workload envelope (PR21).
- [ ] Approve measured cadence/slices/concurrency/admission/resource reservations,
  queue/retention/expiry risk, alert thresholds and hosting cost/placement.
- [ ] Keep the accepted legal-input/bot/emulator provenance decision explicit;
  make no official-client attestation or guaranteed-late-payment claim.
- [ ] Complete the separately reviewed shadow contract and no-second-payment proof.
- [ ] Execute the combined staging rollout/rollback drill and retain reviewed evidence.
- [ ] Review exact deployed artifact compatibility, isolation/log filtering,
  private recovery storage, scoped credentials and rotation/recovery ownership.
- [ ] Recheck migrations/current-main compatibility and all required economic,
  replay, client and integration checks at the candidate head.
- [ ] Obtain explicit authorization for the particular production deployment,
  migration/configuration actions and gradual public activation. A merge or
  development-environment publication does not provide that authorization.
