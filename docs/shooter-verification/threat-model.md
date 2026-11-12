# Campaign verifier threat model

Scope: proposed [protocol v2](protocol-v2.md), default-off until implementation, review and rollout approval. This document is not a security certification or evidence of deployment.

## Trust boundaries

Browser, local storage, network timing and all submitted fields are untrusted. Legal human or bot inputs may be submitted by a custom emulator: accepting independently simulated legal actions is not official-client attestation. Origin, hashes, WebAssembly and embedded JavaScript secrets cannot repair this boundary. The product decision before public activation remains open.

Hub authenticates account/original game session and owns issuance, durable ordering, versions, policy, queue metadata and payments. PostgreSQL constraints/transactions are authoritative for monotonic progress and exactly-once economic effects. Workers are trusted simulator components, separately authenticated, with no database/wallet credentials; a compromised worker can lie about replay and must therefore be isolated and revocable. A SHA pin detects artifact mismatch, not a malicious approved service. Node `vm` is not a hostile-code security boundary: use bounded processes/container CPU/memory/PID limits.

| Threat | Required control | Evidence required |
| --- | --- | --- |
| Forged health/loadout/seed/outcome/reward | Exact public field allowlists; server-issued start; no client checkpoint ingestion | Negative RPC/schema tests and real integration |
| Another account/session submits history | Authenticated owner/original-session binding on writes and immutable issuance | Cross-account/run/session tests |
| Protocol emulator impersonates official client | No false provenance claim; accept only legal replayed inputs; explicit product gate | Emulator acceptance test and documentation |
| Input tampering/retry forks/gaps | Canonical encoding, immutable sequence/digest, contiguous ticks, atomic receipt insertion | Conflicting retries, dropped responses and concurrent append tests |
| Per-call cap resets or accelerated play | Durable cumulative accounting; fixed simulation cadence; server-time lead bound | Multi-call limit tests, reconnect/hidden-tab/timing cases |
| False terminal/assisted reward | Latch first server-observed outcome and existing per-part eligibility; ignore post-terminal gameplay changes | All-boss long/assisted/dead/fled boundary corpus |
| Checkpoint omits rewind/RNG/counters | Versioned complete export/import; schema/artifact binding; no recursive snapshots | Fresh-process JSON round-trips and arbitrary split parity |
| Old worker commits after reclaim | Lease owner + increasing fence + expected revision/digest/predecessor checked atomically | Concurrent/stale success and failure, crash-before/after-commit tests |
| Worker credentials leak or are broadly privileged | Scoped gateway, private routing/TLS, no wallet/SQL authority, bounded bodies, credential-redacted logs | Auth-negative tests, rotation/revocation and logging review |
| Malicious or mismatched simulator | Approved server manifest and exact SHA/source/protocol/schema/economy identity; no request-selected URL/module | Manifest mismatch/unknown version refusal and parity tests |
| Replay monopolizes Nakama or coordinator | Warm bounded replay processes outside coordinator event loop; finite queues/admission/rates/memory/CPU | Host-equivalent concurrency/memory/latency/fault measurements |
| Expired session receives new payment | Transactional original-session live predicate; no grace or rebind; separate expiry reason | Queue-past-expiry and session-close/settlement race tests |
| Expired valid work is called cheating or disappears | Persist accepted/terminal evidence and distinguish authorization from gameplay validity | Status/UI/retention tests and before-start disclosure |
| Duplicate settlement or cap bypass | Atomic receipt/ledger/cap/rank transaction; original-session cap; explicit issuance/settlement UTC split | Real SQL duplicate/crash/cap/UTC matrix |
| Cleanup loses sole evidence | Only prune with safe checkpoint/receipt replacement; preserve unresolved work/artifacts | Cleanup-versus-commit, backup restore and rollback tests |

## Operational failure classification

Timeout, worker crash, database outage, unknown available artifact and overload are operational pending/retryable states, not cheating findings. A bounded retry exhaustion quarantines evidence rather than manufacturing an invalid verdict. An ordinary session expiry can deny payment even for valid accepted play because the owner explicitly rejected grace; this risk must be visible before a rewarded run. Do not claim eventual guaranteed payment under arbitrary queue delay. Revocation is distinct from ordinary expiry.

Do not expose private checkpoints, full inputs or service credentials in public status/logs. Permit bounded owner reads after session expiry using account authentication without granting upload/settlement authority. Recovered paid receipts stay authoritative after expiry. Existing receipts/ledger survive rollback.

## Remaining launch gates

Security-sensitive PRs require independent agent review and exact-artifact tests. Hosting limits and safe concurrency are unmeasured until PRs 20–21 run on authorized target hardware with normal multiplayer traffic. Merging code, passing CI or publishing the development environment does not authorize production service startup, migrations, credential creation or public activation. Stop-new-runs must preserve/drain accepted work without a Goja overload fallback or reversed legitimate payments.
