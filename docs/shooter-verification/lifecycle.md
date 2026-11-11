# Server-selected issuance, finish and expiry (0056)

This companion supplies the missing public lifecycle for the durable v2 pipeline.
It leaves every activation flag off and the sticky account cohort empty. It does
not deploy anything, create worker principals or change legacy payment economics.
Implementation checks run only in GitHub Actions against throwaway databases.

`shooter.run.issue` keeps `{key,canonicalBoss}`. An account outside the cohort gets
the existing legacy response. A cohort account can never opt into legacy through
an old client, a protocol field, or disabled new-run configuration. New issuance
requires explicitly enabled, finite admission, worker scheduler, gateway and
payment configurations. Otherwise it returns `pending_retryable`; it never falls
back to legacy. Cohort rows cannot be changed or deleted. Already-issued keys
retain their original version across cohort enrollment and configuration rollback.
An immutable historical issue acknowledgment grants no fresh admission or payment
authority, including when recovered after session expiry.

New issuance also refuses known saturated global/owner retained-job, attempt and
checkpoint budgets, exhausted global gateway receipt budgets, or absence of a
live registered worker key with claim/renew/retry/result scope and room for the
first claim/renew/result responses (three64KiB durable acknowledgment reservations,
using0053's receipt-budget helper). Private claim work is transient and separately
bounded by the20MiB network envelope. This is a non-reserving readiness snapshot. Other
consumers may use capacity before this run reaches a worker, and the owning
atomic helpers still enforce every limit. It does not reserve whole-run work,
promise payment or demonstrate hosting isolation/readiness. Snapshot reads do not
acquire scheduler/gateway locks under issuance's admission/session/run locks.

V2 issue response:

```json
{
  "protocol": 2,
  "state": "issued",
  "runId": "server-generated UUID",
  "issuance": "canonical v1 engine issuance object",
  "manifest": "exact retained worker manifest object",
  "issuedAt": "database timestamp",
  "uploadDeadline": "issuedAt plus 45 minutes",
  "sessionLeaseUntil": "original session lease snapshot at issuance",
  "limits": {
    "batchFramesTextBytes": 2097152,
    "runFramesTextBytes": 67108864,
    "bodyBytes": 2162688,
    "batchFrames": 28800,
    "runFrames": 162000,
    "batches": 4096,
    "batchActions": 32,
    "runActions": 131072,
    "depth": 12,
    "idLength": 80
  }
}
```

The actual `issuance` and `manifest` fields are objects, not the explanatory
strings above. The manifest is the independently retained executable used by the
worker: source `05f7a0a245af921fc65a99588564175c19658e38`, SHA256
`797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9`,
artifact `shooter-sim`, protocol1, fingerprint `cea1f88b`, uploadProtocol2,
replayApiVersion2, checkpointSchema2, economyPolicy1. Current vendored canonical
issuance generation is compatible with that exact artifact; Actions executes its
real `beginIncrementalReplay` on the returned canonical issuance. Clients must
validate support and must never substitute a different artifact or infer official
client provenance. `sessionLeaseUntil` is an immutable snapshot, not a claim that
the lease cannot be extended or revoked. Original live authorization remains
required independently of the fixed upload deadline.

Atomic issuance locks global admission, account admission, economy, issue key,
original session and run in that order. The additive legacy guard acquires economy
BEFORE its historical issue-key lock. Enrollment uses that same economy lock.
Neither historical migration bodies nor recorded migration IDs are edited. A
post-lock actual database clock checks original-session validity and canonical UTC
day; a day rollover returns `issuance_day_changed` for rebuilding on retry. Both
the legacy run and v2 metadata/full-run quota reservation commit together or roll
back together. Capacity cannot leave a legacy-only orphan.
The SQL issuer additionally binds the canonical issuance header to the exact
owner, original session, run, UTC day, boss, seed and fixed protocol/loadout policy.
The trusted engine builder and retained-artifact validation remain authoritative
for encounter content and the deterministic initial state.

`shooter.run.finish` accepts exactly
`{protocol:2,runId,lastSequence,lastTick}`. It requires the original live game
session and unexpired upload deadline after locks. Both counters must equal the
accepted highwater, including `-1/0` for an empty run. A conflict returns
`invalid/seal_conflict`; no client outcome, score, state or checkpoint is accepted.
The immutable acknowledgment is
`{protocol:2,state:"sealed",runId,lastSequence,lastTick,sealedAt}`. Valid retries
return that exact object while admission authorization remains live. Historic
`state:"sealed"` records successful sealing, not the current verification state.
Owner status exposes `issuanceAck` and `sealAck` (each nullable), alongside the
existing explicit public projection, even after gameplay-session expiry. It does
not expose private checkpoints, input frames or internal terminal hashes.

Session-before-run maintenance seals an expired or closed original session or
elapsed upload deadline, retains all accepted bytes and reserved capacity, and
releases the active-account slot. Observed session close/expiry is a durable
`session_invalidated_reason`, so later lease changes cannot revive that run.
`admission_closed_reason=upload_deadline` closes input only: previously accepted
work may verify and pay after45min while its original session remains live. There
is no payment grace after original-session expiry. Paid receipts remain final.
No trigger on session rows acquires quota, economy or scheduler locks.

Maintenance runs in separate short transactions on selected issuance, owner status
and successful scoped worker claim polling. It never carries run/session locks
into a worker scheduler transaction. At most16 candidates are visited per poll in
stable session/run order; locked candidates are skipped with `NOWAIT` so worker
claim acknowledgments are not held behind unrelated session/run locks. Existing predecessor-ready worker scheduling drains
accepted tails even without finish. Quarantined jobs and support reasons stay
intact. A fully resolved sealed/expired run without a simulator terminal closes as
`incomplete` and `ineligible`; this is a server closure fact, never an invented
private checkpoint `firstTerminal`. An empty run needs no simulator. Finish,
expiry and incomplete closure do not increment verification revision. Only actual
worker advancement does. Stopping new issuance preserves existing drain/status
and finish semantics.

Focused Actions covers version choice/enrollment races, retained-manifest startup,
same-key reservation deduplication, capacity rollback, empty and lost-seal recovery,
append/seal serialization, real worker incomplete closure, missing-finish expiry,
no revival/rebinding, post-lock authorization and stale-day rejection. Actual
authoritative clear receipts additionally prove that input expiry alone permits
payment while durable observed original-session expiry prevents later renewal
from restoring payment authority. Independent
review and passing exact-head Actions remain required before integration.
