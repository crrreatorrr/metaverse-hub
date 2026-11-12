# Durable input ingestion (PR 07)

This stacked change depends on schema PR 06/migration 0050 and adds 0051. It registers `shooter.run.append` and `shooter.run.status`, but **does not implement or enable public v2 issuance**. Existing `shooter.run.issue` remains legacy. A future reviewed issuer must choose upload version server-side, bind an approved incremental artifact, and obey the same admission/locking contract. A client must not opt out of a v2 cohort into legacy full replay. Stopping new v2 issuance must not silently enable new legacy issuance. This PR does not establish complete Nakama verifier isolation while new legacy runs remain possible.

## Default-off resource reservation

The singleton `shooter_verification_admission` row starts with new runs disabled and no operating limits. Explicit finite global/account run, batch and byte limits and append rates must be configured before v2 metadata can be created. This is not a recommendation for public capacity; tests use throwaway values only.

A metadata insertion reserves one retained run, **64 MiB of frame-input allowance** and 4096 batch slots. Actual accepted frame-text bytes and batch counts are charged separately. Reserved capacity permits an already issued run to continue appending when the stop-new-runs switch is off; retries do not charge twice. Expired runs retain their reservations/evidence until a future reviewed retention operation can safely release them. Config/account rows are durable, not per-node caches, so tiny expired runs cannot grow metadata without finite retained-row limits.

These counters are **not complete database memory/disk accounting**. Private checkpoints, job rows/results, acknowledgments and indexes need their own bounded storage/operating reservations in PRs 08/11/17–21. Store the current complete private checkpoint once; do not duplicate full snapshots in every job/history row. No public capacity claim follows from these bounds or CI timing.

## Ingestion transaction

The handler checks authenticated Shooter game claims, cheap per-node rate ceilings and exact UTF-8 body length before parsing, then exact public fields/types. An indexed SQL preflight validates ownership/original session and durable per-account/global request rates before frame decoding. Canonical 12-byte input frames and strictly ordered `[offset,1]` transition actions are validated. Request identity is exactly the approved simulator's `SHA256(stableStringify(validatedBatch))`, with sorted object keys and **no prefix**; it is neither raw JSON property order nor a client digest.

The append SQL function locks global admission, account admission, original session and the verification run, then samples `clock_timestamp()`. It rechecks live redeemed original-session ownership and the run upload deadline after lock waits. It returns the original immutable acknowledgment for identical validated input, rejects changed history at an occupied sequence, and accepts only contiguous ranges within all cumulative tick/byte/action/batch limits and the live-timing allowance. Inserting the batch, advancing accepted counters and charging actual retained input occur atomically. Verification revision/cursors and payment stay unchanged. Accepted rows are durable pending work; job construction/claims are PR 08, not an in-RPC replay fallback.

No post-expiry append or settlement grace is introduced. Session expiry and upload expiry are authorization results, not accusations of cheating. Historical acknowledgments can be read through owner status after the game session expires.

## Legacy bypass protection and lock order

The legacy submit RPC cheaply refuses metadata-backed v2 runs. That alone is insufficient against a v1 request already replaying when version binding starts, so 0051 additively installs guards in the existing close/checkpoint/settlement SQL functions after their economy-user advisory lock. Historical 0040/0048/0050 statements and v1 reward amounts, eligibility, caps and UTC accounting are unchanged. An unexpected legacy SQL signature/guard anchor fails migration rather than silently omitting protection.

Metadata binding takes the quota prefix locks, then the same economy-user advisory lock and original legacy run lock **before** foreign-key row locks. It refuses a settled/closed/checkpointed/digested/receipted legacy run. Concurrent version selection is serialized: either v2 binding commits first and legacy mutation returns `wrong_protocol`, or legacy progress commits first and v2 binding fails. The reservation trigger charges only an actual inserted row; idempotent `ON CONFLICT DO NOTHING` cannot charge again. Future issuer/result/cleanup transactions must preserve the documented lock hierarchy; append never locks the legacy row or calls legacy simulation/payment.

## Bounded owner status

Status permits authenticated account-owner reads after the original game session expires, independently of the new-run switch. Other game-scoped tokens and other account owners cannot read this history. It constructs an explicit projection of lifecycle, accepted/verified counters, simulation tick, terminal tick/outcome, canonical boss, authorization and payment status. Private checkpoints, raw terminal JSON, input frames, worker credentials and error logs are not forwarded. An optional sequence lookup returns only that batch's bounded received acknowledgment. A `paid` response requires the authoritative receipt; metadata alone yields an operational `receipt_unavailable` state.

## Validation and remaining dependencies

Unit cases cover strict envelopes, canonical request hashing, noncanonical frames/actions, predecode rate denial, UTF-8 byte limits and owner status. Real Nakama/Postgres cases cover duplicate/conflicting races, contiguous counters, injected authority, wrong owner, status after expiry, private-state redaction, finite reservations, stop-new-runs draining, durable rate denial, dropped responses after commit and lease expiry during a lock wait. Two-connection cases exercise both version-choice orderings against legacy close/checkpoint/settlement. The legacy-settlement race uses trusted SQL test fixtures on the throwaway stack, not client payout authority.

The pre-v2 upgrade fixture reconstructs the database before all migrations numbered 0050 and later, retaining populated historical receipt/ledger/balance evidence. It does not edit applied migration bodies. All implementation checks run in GitHub Actions; no local implementation test or benchmark is implied.

An independent canonical-byte vector checks the Hub digest against Node crypto and the PIN04 artifact's actual `beginIncrementalReplay`/`acceptReplayBatch` accepted-record boundary; a prefixed incompatible hash is rejected. The worker's JSON bridge must parse inputs inside the artifact's V8 realm. Host objects passed directly through a Node `vm` boundary have foreign prototypes and are correctly rejected by checkpoint validation. Do not relax that validation or add test-only artifact exports to make integration pass.

Remaining work includes approved incremental-artifact issuance, finishing/sealing, job leases/fencing, authoritative terminal high-water capture, atomic verified-result commits and exactly-once deferred settlement. In particular, accepted batches preceding a terminal latch must be identified by a frozen accepted-sequence/tick high-water mark in the terminal commit. Never trust a client boolean or worker timestamp alone to authorize trailing input. Worker claimed-prefix accounting is not a replacement for Hub's authoritative durable accepted history.
