# PR17 recovery and retention draft (0057)

## Boundary

All new operational/cleanup controls default OFF with finite explicit quotas. No production cleanup, backup access, credentials or deployment occurs. Existing applied0050–0056 bodies/IDs/checksums stay unchanged. Operator actions have narrow account-bound credentials/scopes and append-only audit, not a generic SQL/pay endpoint or administrator HTTP-key authority. Initially unused SQL/module helpers are acceptable; no public operator RPC is registered by this PR.

## Preserve evidence and exact identities

Never delete run/batch/job/attempt/terminal/receipt/ledger rows, an unresolved artifact, current complete checkpoint, or immutable worker request acknowledgments. Retained row/receipt/checkpoint quotas remain hard backpressure, so this PR does not promise indefinite issuance on a finite database. PR10 now retains only small immutable claim acknowledgments (at most64KiB); private checkpoint/input work is a separate transient live-only projection, never copied into request receipts. Every immutable acknowledgment and request-ID binding remains retained. No namespace/tombstone protocol change is introduced.

Only redundant raw input payload may retire, after all of: complete committed checkpoint covers the full immutable batch, immutable verified range acknowledgment exists, stored checkpoint SHA/manifest/cursors are valid, an authenticated immutable backup/restore/replay certificate covers that checkpoint/range, and an explicitly configured minimum retention interval elapsed. Unverified payload (even an expired session/run), uncertain history, and batches only partly covered by a checkpoint never retire. Pending payment and terminal denial facts remain untouched; a retired verified prefix is not payment authority.

Add nullable frames/actions plus retired_at to the batch table through0057 alterations, retaining original encoded_bytes/action_count/digest/range/received_ack. Replace its immutable trigger additively with one narrowly authorized nulling transition backed by an immutable retirement audit/certificate; every other update/delete still fails. Cleanup is idempotent and transactional; global/account retained frame/action payload counters decrement exactly once, while run accepted/verified counters and retained metadata/batch slots remain historical and unchanged. Reserved input/checkpoint/request budgets are not spuriously released while their retained objects still exist.

An identical append retry against a retired batch must still recover its original received_ack after the same live original-session/run authorization checks. A new wrapper derives canonical strong digest in the existing trusted runtime and compares digest plus immutable metadata; changed bytes conflict. The original0051 migration body is not edited. Worker continuation selects only the current unverified batch, whose payload remains intact;0054's cumulative action accounting already uses the authoritative predecessor and current batch, not deleted old payloads.

## Restore certificates

A bounded immutable certificate binds backup identifier+SHA, restore/replay receipt SHA, run/owner/session, artifact manifest, complete checkpoint SHA/revision/verified tick and its immutable committed acknowledgment. Only a scoped trusted restore operator may certify; this is an explicit operator attestation, not cryptographic proof that a backup exists. The runbook requires actual isolated PostgreSQL restore and approved-artifact continuation before certification. Production enabling/provisioning remains separately approved. Cleanup cannot use a certificate beyond its verified range or from a different run/artifact/checkpoint branch.

CI performs the actual proof: persist a real approved checkpoint and unverified suffix, dump the database to a throwaway file, restore into an isolated database, resume the approved simulator from restored private checkpoint plus preserved suffix, compare final state/counters/terminal/receipt evidence with a control. Then retire the redundant verified prefix in the original and test continued replay, duplicate cleanup and cleanup-vs-commit serialization. No raw backup is published as an artifact; bounded receipt hashes/results suffice for review.

## Bounded recovery without erasing attempts

Original max_attempts, attempts, fencing token, original input range/digest/initial revision and all attempt evidence never reset. Add a bounded additive recovery_budget and recovery_grants, backed by append-only operator grants, with an absolute cumulative hard ceiling (proposal: at most4 grants, at most8 additional attempts each, at most32 extra attempts/job). Existing attempts count against the total. No operator may raise the original max_attempts or replace the job with an equivalent fresh range to evade history.

An explicit expected-revision/current-cursor grant can requeue only quarantined operational work whose predecessor remains authoritative; it cannot overturn deterministic invalid gameplay or first terminal evidence. A currently quarantined active run is conservatively sealed at its accepted highwater before requeue (no new upload is revived); expired/terminal lifecycle stays released, avoiding active-account collisions. No session/deadline is extended, no payment is issued, and existing settlement always rechecks original live-session authorization with no grace.

Effective attempt ceiling is original max_attempts + audited recovery_budget. New0057 function versions must consistently use that ceiling in claim/expiry/retry/partial-progress quarantine decisions, preserving0054/55/56 hooks and lock order. Prefer explicit reviewed wrappers/function definitions; if exact-body anchor installation is used, require unique known anchors/counts and fail closed on any drift. This needs independent security review and real cumulative-bound tests.

## Locks and tests

Operator principal/config/audit admission -> input admission/account -> scheduler/account -> run -> batch/job. Never acquire economy/session/legacy locks after the verification run. Worker commit remains principal/gateway/scheduler/account/run/job. Input cleanup serializes with append and commit; no simulation or backup I/O occurs under database locks. Inspection is bounded, indexed, allowlisted and redacts inputs/checkpoints/tokens.

Required real PostgreSQL cases: expiry/reclaim/backoff; exhausted job grants without reset/fence regression; duplicate/conflicting operator requests; hard cumulative grant/attempt/audit quotas; unauthorized/scopeless/expired/revoked operators; old expired run plus newer open account slot; no automatic expiry/payment revival; partial/unverified/uncertified payload refusal; pending payment and terminal denial evidence preservation; exact received retry after retirement; duplicate cleanup counters; cleanup vs commit; populated restart counters/audit; actual backup restoration plus approved replay continuation and immutable receipt proof. Tests/builds run only in GitHub Actions. Full older PR integration is not canceled.

## Operational contract and runbook

`ShooterVerificationCleanup.operate` is an unused server helper, with no registered public/operator RPC. Its exact envelope is `{operatorId,keyId,token,requestId,body}`; account identity comes from authenticated runtime context. SQL authorization uses a separate immutable operator/account registry and current scoped key, never the broad Nakama HTTP administrator key. Supported bodies are:

| Operation | Exact body |
| --- | --- |
| inspect | `{runId}` |
| reap | `{limit}` (1–32) |
| requeue | `{jobId,expectedRevision,expectedTick,extraAttempts}` (1–8) |
| certify | `{runId,expectedRevision,checkpointSha256,backupId,backupSha256,restoreReceiptSha256}` |
| retire | `{runId,sequence,expectedRevision,proofId}` |

Every durable action records its original bounded acknowledgment and canonical digest under the logical operator/request ID. Conflicting reuse fails. Auth/rate/capacity/precondition refusals make no destructive transition; callers use a fresh ID after changing prerequisites. Current authorization is checked again after downstream locks. All attempts, grants, immutable input metadata and financial evidence remain retained. The only accepted batch update nulls frames/actions once, matching an immutable retirement record backed by a restore certificate; no batch DELETE is permitted. The historical append implementation is preserved behind a private alias, with a wrapper that preserves original receipt recovery and tracks actual action payload bytes. Migration0057 changes decision functions only at validated known effective-budget anchors, and fails closed on drift.

Before enabling production cleanup, obtain the separate deployment/retention approval, provision narrowly scoped operator keys through the approved secret-management process, and select explicit finite quotas/retention age from measurements. No production key or principal is created here. For each candidate, inspect the exact run/revision and immutable verification acknowledgment, take a database backup, record its strong digest, restore it into an isolated approved environment, and resume the retained approved artifact from the restored checkpoint plus unverified tail. Compare complete counters, terminal/state hash, digest history and financial receipt/ledger evidence with a control. Only then may the trusted restore operator attest the bounded receipt hashes and certify that exact checkpoint. An operator attestation is not cryptographic evidence that a backup exists. Retain that backup under the approved evidence policy; the application never fetches a caller-selected backup URL or path.

The GitHub-only restore fixture is guarded by `GITHUB_ACTIONS=true` and `HUB_RECOVERY_FIXTURE=retention-restore`. It never replaces an existing database: it creates named disposable restore databases, checks pre/post-retirement continuation through credential-free bounded verifier processes, and removes those databases and private dump files afterward. Raw dumps are never uploaded as artifacts. Pending settlement, terminal denial, paid receipt and ledger rows are not cleanup targets. Restoring an actual production database, changing its history, or provisioning infrastructure remains outside this PR.
