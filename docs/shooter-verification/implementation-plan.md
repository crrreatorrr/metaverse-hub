# Campaign reward verification implementation handoff

Implementation is underway; see the [execution ledger](execution-ledger.md) for merged work, evidence and remaining gates. The owner requested implementation on November 10, 2026; the original planning-only authorization statement below describes the document’s preparation, not that later request. Explicit decision gates and the prohibition on deployment, credentials, hosting purchases and production changes remain in effect.

Start with the historical [baseline](baseline.md), accepted [decisions](decisions.md), and current [execution ledger](execution-ledger.md). Current source evidence supersedes stale source assumptions in the original handoff.

The supplied handoff is preserved verbatim below for traceability.

```text
Shooter campaign reward verification: detailed PR-by-PR implementation plan
Planning deliverable only. No implementation, benchmark, deployment or hosting purchase is authorized by this document.

Prepared November 10, 2026. This is a coding-agent handoff, not a claim that the system is already implemented.
1. Purpose
Implement reliable campaign reward verification that:
- Lets humans or bots control the game.
- Never trusts a client’s claim that a goal was reached.
- Keeps movement, aiming, firing and rendering responsive.
- Runs expensive verification outside the Nakama runtime pool serving online matches.
- Saves verified progress safely and pays an eligible reward exactly once.
- Supports a modest hosting increase if measurements show that isolation requires another small server.
- Preserves existing reward amounts, eligibility rules and economic caps.
- Has a staged, reversible rollout.
Important unresolved requirement
The user wants play to occur through the actual game client.

The proposed browser architecture can require authenticated live sessions and independently validate every submitted action. It cannot prove that the official browser client produced those actions. A custom program could imitate its protocol.

Do not label client hashes, Origin headers, WebAssembly, JavaScript secrets or live timing as proof of official-client execution. Record this limitation in the first architecture PR. Obtain an explicit product decision before public activation. A hosted-client or native-attestation solution would require a separate plan.
2. Verified repository baseline
Inspected GitHub main branches:
- crrreatorrr/sproto-shooter: 57e52c37d449903fd840b9617e7ce1f918de7a92
- crrreatorrr/metaverse-hub: ee019d183f0ef2452b132a2e66812fa1eb891631
These are reference points, not instructions to ignore newer work. Rebase the plan against current main before implementation.

Relevant verified source paths:

Shooter
- src/server/verify.js
- src/server/protocol.js
- src/server/runContract.js
- src/sim/campaign/campaign.js
- src/sim/hash.js
- src/data/serverManifest.js
- src/game/Game.js
- src/hub/link.js
- src/ui/ui.js
- scripts/build-server-sim.mjs
- tests/server-sim.test.js
- tests/bossLog.js
- tests/fixtures/boss-goldens.json
- docs/shooter-server-contract.md
Hub
- server/modules/src/main.ts
- server/modules/src/schema.ts
- server/modules/src/games/shooter_runs.ts
- server/modules/src/games/shooter_rewards.ts
- server/modules/src/games/shooter_sim.d.ts
- server/modules/vendor/shooter-sim.js
- server/modules/vendor/shooter-sim.pin.json
- scripts/check-shooter-sim-version.mjs
- scripts/revendor-shooter-pvp.mjs
- server/test/games/shooter_runs.test.ts
- server/test/games/shooter_review.test.ts
- server/test/dup/shooter_rewards.ts
- server/test/dup/migrations.ts
- server/test/unit/run.ts
- packages/hub-sdk/src/createHubSdk.ts
- packages/hub-sdk/src/types.ts
- server/docker-compose.yml
- deploy/compose.yml
- deploy/nakama/config.yml
- .github/workflows/ci.yml
- docs/two-game-release.md
Paths introduced below are proposed new paths, not claims that they already exist. Adapt their placement to current repository conventions while keeping the stated responsibilities separate.
3. Instructions for the coding agent
1. Read the latest AGENTS.md in both repositories.
2. Inspect current main, open PRs and ownership before editing.
3. Use separate branches and GitHub PRs; never push directly to main.
4. Keep all deliverables on GitHub. Use GitHub Actions for the user’s GitHub-only execution preference.
5. Do not resume the separately stopped Shooter implementation session.
6. Do not deploy, enable production flags, purchase hosting, create production credentials or apply production migrations without explicit approval.
7. Do not change PvP rules, wager policy, reward values, boss health or unrelated rendering.
8. Do not raise a timeout or weaken validation merely to make tests green.
9. Do not replace long-run acceptance tests with shorter successful cases.
10. Have another agent review each security-sensitive PR.
11. Report the exact tested commit, failed/skipped checks and unmeasured claims.
12. Stop at each explicit decision gate; planning and successful CI are not deployment authorization.
4. Core architecture
Client → authenticated Hub ingestion → durable queue → isolated V8 worker → fenced result commit → transactional settlement
Ownership
Client
- Runs the visible game immediately.
- Records the exact canonical inputs it simulates.
- Uploads bounded, ordered batches in the background.
- Holds no authority over game state, eligibility or payment.
Hub
- Authenticates users and sessions.
- Issues server-owned start state, seed and version binding.
- Validates inexpensive request constraints.
- Stores accepted batches durably.
- Controls job leases and authoritative run revisions.
- Accepts only properly bound worker results.
- Owns reward and ledger transactions.
Verifier
- Runs the approved simulator from server-owned state.
- Verifies every tick once.
- Has no wallet credentials or arbitrary database access.
- Returns private checkpoints and verification results.
- Is a trusted service component and must be authenticated and isolated.
Latency promise
The implementation may promise no network or reward-verification wait in the gameplay input/render path.

It must not promise:
- Elimination of normal online latency.
- Literally zero client CPU overhead.
- Unchanged infrastructure cost without measurement.
- Instant rewards under arbitrary overload.
A reward may remain pending while play continues.
5. Contract to establish before feature implementation
Use separate versions for:
- Upload protocol.
- Simulator protocol.
- Checkpoint schema.
- Exact simulator artifact SHA-256 and source commit.
- Economy/eligibility policy where necessary.
Do not use content fingerprint alone as artifact identity.
Proposed public operations
Final RPC names may follow existing conventions, but responsibilities must remain:
- shooter.run.issue
- shooter.run.append
- shooter.run.status
- shooter.run.finish
- Optional explicit reconnect/resume authorization operation.
Proposed internal operations
Available only to the verifier service:
- Claim eligible work.
- Renew a job lease if supported.
- Submit a result or retryable failure.
- Obtain the approved artifact manifest, if not provisioned directly.
Do not expose a generic “pay this user” internal operation.
Suggested upload envelope
Public fields should be limited to:
- Protocol version.
- Run ID.
- Sequence.
- Starting tick and frame count.
- Encoded input frames.
- Allowlisted actions.
- Digest/chain metadata if required.
Server derives account, session authorization, issuance, policy, artifact and authoritative checkpoint.

Reject fields such as client state, health, inventory, score, checkpoint snapshot, reward amount, seed override and outcome claim.
Distinct acknowledgments
- Received: inputs durably stored.
- Verified: server simulation accepted the input range.
- Terminal verified: server observed a final result.
- Paid: ledger transaction committed.
- Pending/retryable: capacity or operational issue.
- Invalid/ineligible: gameplay or policy result.
Do not use a single ok flag to blur these states.
PR sequence
There are 23 principal PRs below. Some Shooter PRs require a separate generated-artifact companion PR in Hub. Those companions are mandatory whenever the current pin guard requires them.
PR 00 — Record baseline, scope and open decisions
Repository: Hub
Dependencies: None
Purpose: Give later agents a stable execution specification.
Changes
Add proposed:
- docs/shooter-verification/implementation-plan.md
- docs/shooter-verification/baseline.md
- docs/shooter-verification/decisions.md
Record:
- Current main SHAs and active overlapping PRs.
- Simulator artifact hashes and supported versions.
- Existing migration IDs and registration locations.
- Current campaign reward and session caps.
- Current failure evidence, distinguishing CI/local observations from production.
- Known checkpoint, timing and retry defects.
- Actual deployed infrastructure, if independently accessible; otherwise mark unknown.
- Unresolved official-client provenance requirement.
Non-goals
No code, flags, schema or runtime changes.
Checks
- Validate links and referenced paths.
- Independently review the documented invariants against code.
- Confirm no secrets or user-specific credentials are included.
Merge criterion
The plan accurately describes current code and lists unresolved decisions instead of silently choosing new economic behavior.
Deployment/rollback
Documentation only; independently mergeable and reversible.
PR 01 — Define protocol, lifecycle and threat model
Repository: Hub, with a coordinated documentation-only Shooter contract update if needed
Dependencies: PR 00
Changes
Add proposed:
- docs/shooter-verification/protocol-v2.md
- docs/shooter-verification/threat-model.md
Define:
- Canonical rewarded start, retaining the existing boss-section/start-loadout contract initially.
- Success, assisted completion, failure and flee.
- First authoritative terminal tick.
- Treatment of post-terminal input.
- Simulation time versus wall-clock time.
- Pause, hitstop, hidden-tab and reconnect behavior.
- Upload grace, run expiry and active-run policy.
- Issuance-day bucket and late settlement.
- Supported simulator version lifetime.
- Per-request and cumulative limits.
- Browser-provenance limitation.
- Live-session timing policy and its limitations.
Required decision: session expiry and pending rewards
The current settlement checks a live session. An asynchronous worker may finish after that session expires.

Do not silently lose earned rewards or silently bypass session rules. Specify a durable authorization model:
- Eligibility/session validity checked when the relevant input is accepted.
- Original run/session accounting retained.
- Pending valid work may complete within a defined settlement grace.
- Revocation and fraud/invalidity remain distinct from ordinary expiry.
- SQL implements the approved policy explicitly.
Required decision: size limits
Reconcile the existing 2 MiB encoded input limit with the 45-minute frame limit. State whether each limit applies to one batch or the whole run.
Merge criterion
Protocol and economic semantics have no unresolved ambiguity that would force the coding agent to invent behavior.
Deployment/rollback
Documentation only. No public activation.
PR 02 — Build deterministic regression corpus
Repository: Shooter
Dependencies: PR 01
Purpose: Capture failure cases before changing the engine.
Changes
Extend:
- tests/server-sim.test.js
- tests/bossLog.js
- tests/fixtures/boss-goldens.json
Add proposed:
- tests/server/checkpoint-corpus.test.js
- tests/fixtures/replay-corpus/
- scripts/build-replay-corpus.mjs
Include:
- All five bosses.
- Multiple seeds, including difficult long runs.
- Failed and assisted runs.
- Obama part transitions.
- Lockdown rewind and void rescue.
- Pickups, projectiles, transition actions.
- Terminal events at batch boundaries.
- Real mouse/controller input recordings when permitted.
Record fixture provenance and expected eligibility, terminal tick and version. Do not search seeds only until an easy short clear is found without reporting that bias.
Checks
- Existing goldens remain unchanged unless a reviewed correction explicitly requires it.
- Fixtures reproduce across supported runtimes.
- Known-bug regression cases are documented clearly; do not leave the primary suite permanently failing.
Merge criterion
The corpus can expose the known problems and is reproducible.
Deployment/rollback
Tests/tooling only. No gameplay change.
PR 03 — Add complete, versioned snapshot export/import
Repository: Shooter
Dependencies: PR 02
Changes
Modify:
- src/sim/campaign/campaign.js
- Relevant state/hash helpers.
Add proposed:
- src/server/checkpoint.js
- tests/server/checkpoint-serialization.test.js
Create explicit export/import functions for:
- Complete simulation state.
- RNG state.
- Entity/ID counters.
- Boss-part history.
- Rewind snapshots currently held outside JSON state.
- Relevant pending events/state required by future ticks.
Use a bounded checkpoint envelope with schema version and artifact identity. Prevent recursive snapshot nesting.

Do not switch the public reward flow yet.
Checks
- JSON round-trip into a fresh process preserves behavior.
- Rewind after restore behaves like uninterrupted play.
- Snapshot size/depth bounds.
- Malformed snapshot rejection at the trusted-service boundary.
- Pure simulation architecture tests.
- Canonical state hashes before/after restore.
Merge criterion
Every supported corpus run behaves identically after serialization at representative and randomized split points.
Deployment/rollback
Helpers remain unused by legacy issuance unless explicitly enabled later.

Companion Hub pin PR: required if guarded simulator inputs change.
PR 04 — Implement a versioned incremental replay API
Repository: Shooter
Dependencies: PR 03 and its pin companion
Changes
Modify:
- src/server/verify.js
- src/server/protocol.js
- src/server/runContract.js
- scripts/build-server-sim.mjs
Introduce a private versioned replay interface that:
- Accepts only server-owned issuance/resume state.
- Replays an input range.
- Returns complete private checkpoint state.
- Reports per-batch and cumulative accounting separately.
- Preserves a first authoritative terminal result.
- Distinguishes execution timeout from invalid gameplay.
Keep legacy behavior available for legacy runs. Do not silently reinterpret protocol 1 receipts.
Correctness requirements
- Total frame cap covers the entire run.
- Cumulative byte/action/batch limits cannot reset at each call.
- Terminal outcome cannot change solely because a batch boundary moved.
- Leaderboard time uses the approved cumulative terminal tick.
- Public JSON serialization still omits private state.
- No new payout authority in the simulator.
Checks
- Whole replay versus arbitrary segmented replay.
- Exact terminal tick and assisted rules.
- Max limits across multiple calls.
- Unsupported version/schema.
- Timeout/retry classification.
- Cross-runtime parity.
- Legacy fixture compatibility.
Merge criterion
Equivalent supported inputs yield equivalent outcomes and cumulative timing in whole and segmented execution.
Deployment/rollback
New entrypoint is dormant until new issuance is enabled.

Companion Hub pin PR: mandatory.
PR 05 — Canonicalize reward-mode input execution
Repository: Shooter
Dependencies: PR 04
Changes
Modify:
- src/game/Game.js
- Input codec integration.
Add proposed:
- src/server/canonicalCommand.js
- tests/server/client-command-parity.test.js
For reward-enabled play:
1. Read the player/bot command.
2. Quantize it.
3. Decode that exact representation.
4. Simulate the decoded representation.
5. Record the same canonical bytes/actions.
Do not record raw input while simulating a different representation.
Checks
- Mouse and controller aim.
- Held versus pressed buttons.
- Weapon selection, wheel and transition actions.
- Legitimate bot commands.
- No incidental changes to casual or PvP paths.
- Frame-time and control-feel baseline.
- Replay of actual client input.
Merge criterion
Reward-mode client simulation and verifier consume equivalent commands; casual/PvP regressions are absent.
Deployment/rollback
Keep the new mode behind a default-off client capability/configuration gate.

Pin companion: apply if current guards require it.
PR 06 — Add durable verification schema
Repository: Hub
Dependencies: PR 01; may proceed in parallel with PRs 02–05
Changes
Add proposed:
- server/modules/src/games/shooter_verification_schema.ts
Register through current schema/main conventions.

Create additive structures for:

Run verification metadata
- Run and owner binding.
- Exact artifact identity.
- Revision.
- Accepted and verified sequence/tick.
- Cumulative accounting.
- Lifecycle and terminal metadata.
- Expiry/grace timestamps.
Immutable batches
- Unique (run_id, sequence).
- Tick range, encoded input and actions.
- Strong request digest.
- Stored receipt.
- Acceptance timestamp.
Jobs
- Run/batch range.
- Expected revision.
- Queue/lease state.
- Lease owner/deadline.
- Fencing token.
- Retry counters and next-attempt time.
Requirements
- Allocate migration IDs from current main.
- Never edit applied migration contents/checksums.
- Add indexes for bounded claim/status/cleanup queries.
- Store no credentials in schema defaults.
- Keep existing reward tables authoritative.
Checks
- Fresh database.
- Upgrade from existing populated database.
- Repeated migration application.
- Migration discovery/checksum tests, including root-registered modules.
- Unique constraints and indexes.
- Preservation of existing receipts and balances.
Merge criterion
Schema is backward-compatible and unused by existing flows.
Deployment/rollback
Additive only. Roll back application use, not historical receipt data.
PR 07 — Implement atomic batch ingestion and status
Repository: Hub
Dependencies: PR 06
Changes
Add proposed:
- server/modules/src/games/shooter_verification_rpc.ts
- server/test/games/shooter_verification_ingest.test.ts
- server/test/dup/shooter_verification_ingest.ts
Extend registration and approved type declarations.
Behavior
- Authenticate account/game session before work.
- Validate run/version, sequence, tick range and payload limits.
- Use server-derived identity and issuance.
- Store a batch and acknowledgment atomically.
- Return the original acknowledgment for identical retries.
- Reject changed bytes for an already occupied sequence.
- Enforce contiguous accepted history.
- Reject client state/outcome fields.
- Return bounded status without exposing private checkpoints.
Admission
- Active-run and retained-byte limits.
- Per-account and global bounds.
- Cheap rate limiting before expensive decoding.
- Live-session/grace checks from PR 01.
- Replace unbounded historical lookups with indexed run-specific operations for the new path.
Checks
Malformed payloads, unauthorized requests, duplicates, conflicting retries, gaps, overlapping ticks, expired uploads, wrong identity and dropped responses.
Merge criterion
“Received” always means durable storage; retries never create duplicate work or mutate accepted history.
Deployment/rollback
RPCs registered behind a default-off new-issuance gate. Existing runs unchanged.
PR 08 — Implement durable job claiming and fencing
Repository: Hub
Dependencies: PR 07
Changes
Add proposed:
- server/modules/src/games/shooter_verification_jobs.ts
- server/test/dup/shooter_verification_leases.ts
Behavior
- Claim only work whose predecessor is verified.
- One logical active verification chain per run.
- Fair scheduling across users.
- Global concurrency/admission bounds.
- Finite lease and attempt budget.
- Monotonically increasing fencing token.
- Reclaim expired leases safely.
- Durable backoff for retryable errors.
Use transactions only for queue decisions, never for simulation execution.
Checks
- Two workers claim concurrently.
- Lease expires while old worker still runs.
- Worker dies before completion.
- Repeated lease renewal.
- Fairness under one noisy account.
- Stale completion cannot commit.
- Queue saturation remains bounded.
Merge criterion
No duplicate authoritative advancement despite multiple attempts or worker crashes.
Deployment/rollback
Dormant without workers/new issuance. Existing queue rows retained on rollback.
PR 09 — Add the isolated verifier runtime
Repository: Hub
Dependencies: PR 04 artifact available; independent of public client work
Changes
Add proposed:
- services/shooter-verifier/package.json
- services/shooter-verifier/src/artifacts.ts
- services/shooter-verifier/src/process-pool.ts
- services/shooter-verifier/src/replay.ts
- services/shooter-verifier/test/
- services/shooter-verifier/Dockerfile
Runtime
- Load only pinned approved bundles.
- Verify SHA-256/source/protocol/checkpoint schema/economy identity.
- Warm bounded execution processes.
- CPU-heavy replay outside the network coordinator’s event loop.
- Hard memory, process and execution limits.
- No arbitrary module/URL loading from requests.
- No database/wallet credentials.
- No production network access by default.
A Node vm context is not a security boundary. Use process/container controls for hostile resource consumption.
Checks
- Artifact mismatch/refusal.
- Malformed inputs.
- Worker timeout/crash.
- Memory exhaustion.
- Unknown version.
- Full private checkpoint output.
- Public output redaction.
- Golden parity against the approved simulator.
Merge criterion
The service reliably executes bounded replay and cannot select payment amounts or access wallet operations.
Deployment/rollback
Build/test artifact only; do not start production service.
PR 10 — Add authenticated worker gateway
Repository: Hub
Dependencies: PRs 08–09
Changes
Add proposed:
- server/modules/src/games/shooter_verification_internal.ts
- Worker claim/result client.
- Internal authorization tests.
- Example configuration without secrets.
Controls
- Private/loopback access where possible.
- Scoped service authentication.
- TLS for cross-host transport.
- Bind claim/result to job, run, account/session, batch digest, expected revision, artifact and fencing token.
- Bound request/response size.
- Reject arbitrary reward amounts and unsupported result fields.
- Redact credentials and private snapshots from logs.
- Document credential rotation/revocation procedure.
Do not reuse a broadly privileged administrator key casually. Persistent access configuration requires its own approval.
Checks
Forged requests, wrong worker identity, stale credential, wrong artifact, changed digest, replayed completion, oversized result and unauthorized endpoint access.
Merge criterion
Only a properly scoped worker can claim/complete its assigned work.
Deployment/rollback
No production credentials are created by this PR. Interfaces remain dormant.
PR 11 — Commit verified checkpoints atomically
Repository: Hub
Dependencies: PRs 08–10
Changes
Extend verification persistence and result handling.
Transaction
On completion:
1. Check job ownership and fencing token.
2. Lock the run.
3. Compare expected revision and predecessor.
4. Validate bound artifact/input range.
5. Advance checkpoint and cumulative accounting.
6. Store immutable verified acknowledgment.
7. Complete the job.
8. Queue the next eligible range.
All steps commit together.

Apply revision checks to failure/close transitions too. A stale failure must not close a newer successful run.
Checks
- Reordered completion.
- Conflicting branches.
- Duplicate results.
- Crash immediately before/after commit.
- Stale close after checkpoint.
- Stale clear after failure.
- Checkpoint state/schema rejection.
- No checkpoint regression.
Merge criterion
Authoritative progress is monotonic and each accepted range is committed at most once.
Deployment/rollback
No payments yet. New runs can remain shadow/test-only.
PR 12 — Integrate deferred exactly-once settlement
Repository: Hub
Dependencies: PR 11 and PR 01’s approved expiry policy
Changes
Modify:
- shooter_rewards.ts through additive migration/function versioning.
- New result/settlement handlers.
- Unit and real PostgreSQL duplication tests.
Behavior
- Persist terminal verified result separately from payment success.
- Retry payment without replaying the fight.
- Preserve fixed amount and current economic caps.
- Use cumulative terminal time for ranking.
- Atomically commit ledger, receipt, cap usage and ranking.
- Handle an ordinary session expiry after timely accepted gameplay according to the documented policy.
- Distinguish “valid but cap exhausted” from invalid gameplay and operational error.
- Never allow client-callable generic credit.
Checks
- Two completion workers.
- Duplicate terminal requests.
- Wallet failure.
- Crash after commit before response.
- Session expiry during verification.
- Revoked/invalid session versus ordinary expiry.
- UTC boundary.
- Boss/day and session/account caps.
- Assisted/fled/failed runs.
- Original ledger totals unchanged by retries.
Merge criterion
Exactly one eligible credit; every retry returns the stable authoritative result.
Deployment/rollback
Default-off. Preserve payout-pending and receipt rows across rollback.
PR 13 — Add supported client API
Repository: Hub
Dependencies: PRs 07 and 12
Changes
If required, add narrow typed methods in:
- packages/hub-sdk/src/createHubSdk.ts
- packages/hub-sdk/src/types.ts
- SDK test files.
Methods should expose issuance, append, status, finish and authorized recovery, not internal worker operations.
Requirements
- Typed status/error distinctions.
- Bounded retry guidance.
- No embedded service credentials.
- Backward-compatible additions.
- Document exact consumers needing re-vendor.
If existing generic RPC support is adequate, avoid gratuitous SDK expansion and document the chosen adapter instead.
Checks
Mock transport, auth failures, stable duplicate responses, pending states, version mismatch and API compatibility.
Merge criterion
Client code does not need to infer settlement from transport success.
Deployment/rollback
SDK addition alone changes no game behavior.

Companion: Shooter SDK re-vendor PR with source/pin/manifest together.
PR 14 — Add the client recorder and bounded storage
Repository: Shooter
Dependencies: PR 05 and SDK companion if needed
Changes
Add proposed:
- src/hub/campaignRewards/recorder.js
- src/hub/campaignRewards/storage.js
- src/hub/campaignRewards/encoder.worker.js
- Recorder/storage tests.
Behavior
- Record the canonical inputs already used by reward-mode gameplay.
- Bounded active and upload buffers.
- Immutable batches.
- Local persistence for unacknowledged inputs if enabled.
- Account/run separation.
- Safe cleanup after stable receipt.
- Optional Worker-based encoding when measurements justify it.
Checks
Buffer rollover, storage quota, crash/reload, logout/account switch, malformed persisted data, pressure on low-memory devices and frame-time impact.
Merge criterion
No network await or large avoidable serialization in the control/render loop.
Deployment/rollback
Recorder disabled by default. No uploads yet.
PR 15 — Add background upload and recovery controller
Repository: Shooter
Dependencies: PRs 07, 13–14
Changes
Add proposed:
- src/hub/campaignRewards/controller.js
- src/hub/campaignRewards/transport.js
- Network fault tests.
Behavior
- One ordered upload stream with bounded pipelining.
- Retry identical bytes with backoff and jitter.
- Track accepted and verified progress separately.
- Status recovery after lost acknowledgment.
- Continue recording while verification is running.
- Final-tail flush.
- Bounded offline/grace behavior.
- Never fall back to arbitrary completed-log settlement.
Checks
Packet loss, duplicated response, slow server, request timeout, reordered network completion, browser suspend, expired grace, worker outage and reconnect.
Merge criterion
A slow verifier does not freeze gameplay or cause silent input loss; invalid history cannot be overwritten on retry.
Deployment/rollback
Feature gated. Preserve stored pending inputs when disabled.
PR 16 — Wire rewarded start and honest UI
Repository: Shooter
Dependencies: PR 15 and settlement available in test environment
Changes
Modify:
- src/hub/link.js
- src/game/Game.js
- Relevant menu/UI modules.
Add clear states for:
- Starting authenticated run.
- Recording and uploading.
- Server received.
- Verifying.
- Reward pending.
- Paid.
- Ineligible.
- Connection/grace/limit problem.
Requirements
- Start from server-issued canonical state.
- No import of arbitrary client inventory into a rewarded run.
- Explain eligibility before the run.
- Bot-controlled client remains eligible.
- No false “reward earned” before server confirmation.
- Keep casual/offline play available as explicitly unranked/unrewarded where appropriate.
- Do not claim crash restoration unless the actual game state restore path is implemented.
Checks
Repeated Start clicks, Back/Close, login interruption, session renewal, final clear during outage, pending reward after returning to menu, duplicate result display and accessibility.
Merge criterion
UI reflects authoritative status and does not change economic policy.
Deployment/rollback
Default-off cohort gate; no public enablement.
PR 17 — Add recovery, retention and operational cleanup
Repository: Hub
Dependencies: PRs 11–12
Changes
Add proposed:
- server/modules/src/games/shooter_verification_cleanup.ts
- Recovery/reaper tooling.
- Retention/runbook documentation.
Policies
- Retry expired job leases.
- Preserve accepted-but-unverified input until its documented resolution window.
- Preserve terminal receipts and ledger evidence according to existing retention.
- Remove redundant payloads only after safe checkpoint/receipt retention conditions.
- Quarantine repeatedly failing jobs without treating them as cheating.
- Prevent queue rows from growing without bound.
- Provide bounded operator inspection and requeue tools.
Checks
Cleanup concurrent with worker commit, expired sessions, pending settlement, duplicate cleanup and restoration from a database backup.
Merge criterion
Cleanup cannot delete the only evidence needed to finish or explain a pending reward.
Deployment/rollback
No destructive production cleanup without approved retention/deployment configuration.
PR 18 — Full integration and adversarial test matrix
Repository: Hub, with companion Shooter test PR if needed
Dependencies: PRs 12 and 16–17
Changes
Add real Nakama/Postgres/worker integration suites.

Cover:
- Every supported boss.
- Real client input and legitimate bot input.
- Wrong account/run/session.
- Forged state, health, inventory and outcome.
- Gaps/overlaps/reordered chunks.
- Changed duplicate payload.
- Stale leases and checkpoints.
- Worker crash and wrong artifact.
- Lost responses at every commit boundary.
- Caps and session/UTC policy.
- Duplicate settlement.
- Long runs and hostile payload bounds.
- Upgrade/rollback compatibility.
Explicitly test a protocol-only emulator and document that accepting legal inputs is not official-client attestation.
Merge criterion
The full correctness matrix passes against exact built artifacts. No skipped security cases disguised as success.
Deployment/rollback
CI/test tooling only, unless accompanied by explicitly dormant integration wiring.
PR 19 — Add observability and deployment manifests
Repository: Hub
Dependencies: PRs 09–12
Changes
Add:
- Worker container/service configuration.
- CPU/memory/process limits.
- Health/readiness checks.
- Private routing example.
- Graceful shutdown/drain behavior.
- Metrics and structured logging.
- Example environment configuration without secrets.
Track:
- Queue age/depth.
- Accepted/verified tick lag.
- CPU and wall time separately.
- Retry/timeout/error counts.
- Artifact mismatch.
- Worker restarts.
- Settlement pending time.
- Invalid result reason categories.
- Online match latency and database latency.
Checks
Graceful shutdown, resource limit enforcement, health failure, stale readiness, restart recovery, secret scanning and logging redaction.
Merge criterion
Operators can distinguish backlog, invalid play and payment failure without reading private input logs.
Deployment/rollback
Manifests only. No host provisioning or production service start.
PR 20 — Add deployment-equivalent capacity benchmarks
Repository: Hub
Dependencies: PRs 18–19
Changes
Add proposed:
- scripts/load/shooter-campaign-verification.ts
- docs/shooter-verification/benchmark-method.md
- Machine-readable benchmark output schema.
Workloads
- All bosses and varied seeds.
- Long Sahil and failed/abandoned runs.
- Twenty independent users/runs, not one duplicated run.
- Synchronized finish and upload bursts.
- Reconnect/retry storms.
- Normal Hub/PvP traffic at the same time.
- Cold and warm workers.
- Sustained runs sufficient to expose queue growth.
Compare:
- Existing full replay.
- Segmented Goja where supported.
- Same-host bounded V8.
- Small isolated same-region worker, if authorized.
Metrics
CPU seconds, queue growth, memory/GC, SQL time, snapshot size, reward delay, client frame time and match tick latency.
Merge criterion
Harness is reproducible and does not claim capacity until run on the intended hardware.
Deployment/rollback
Benchmark tooling only. Paid infrastructure tests require approval.
PR 21 — Record measurements and choose operating limits
Repository: Hub
Dependencies: PR 20 plus authorized benchmark execution
Deliverables
- Actual host/region/specification.
- Baseline versus candidate measurements.
- Upload cadence and internal work-slice size.
- Worker concurrency.
- Queue/admission limits.
- Resource reservations for Nakama/Postgres.
- Recommended host placement.
- Estimated monthly increase with assumptions.
- Supported concurrency and expected reward delay.
- Known overload behavior.
Gates
- No valid supported run permanently fails because of ordinary verifier capacity.
- Stable bounded queue and memory.
- No material multiplayer/client performance regression.
- All economic and correctness tests remain green.
- Hosting proposal approved.
- Browser-provenance limitation explicitly accepted or project redirected.
Do not select limits from CI wall-clock observations alone.
Deployment/rollback
Configuration recommendation only until separately authorized.
PR 22 — Add rollout, shadow mode and rollback controls
Repository: Hub, with client configuration companion if required
Dependencies: PR 21
Controls
- Default-off new issuance.
- Test/cohort allowlist.
- Shadow verification with no second payment path.
- Gradual new-run admission.
- Stop-new-runs switch.
- Preserve/drain existing accepted work.
- Artifact-version compatibility.
- Dashboard/alert thresholds.
- Explicit public activation checklist.
Rollback
1. Stop issuing new v2 runs.
2. Preserve accepted input and verified terminal results.
3. Drain or pause jobs safely.
4. Continue version-compatible processing for supported existing runs.
5. Retain receipts and ledger data.
6. Do not route long jobs automatically back to Goja.
7. Do not undo legitimate payments.
8. Do not drop additive schema as ordinary rollback.
Merge criterion
A staging operator can demonstrate rollout and rollback without losing accepted runs or duplicating rewards.
Deployment
Still requires explicit approval. Merging this PR is not launch authorization.
Mandatory generated-artifact companion PRs
After every Shooter PR that changes guarded simulation/server inputs:
1. Review current Hub pin guard behavior.
2. Build both required simulator artifacts from the exact approved Shooter commit.
3. Open a separate Hub pin PR containing only generated artifacts, pin metadata and required compatibility/type updates.
4. Run hash, protocol, fingerprint, economics and current-main guards.
5. Run relevant Hub tests against those exact bytes.
6. Preserve old artifact versions where required for supported in-flight runs.
7. Do not hand-edit generated bundles.
8. Do not bypass a failing pin guard.
Suggested names:
- PIN-03: snapshot helper artifact integration.
- PIN-04: incremental verifier artifact integration.
- PIN-05: canonical input changes, if guarded.
- Later pin companions whenever shared simulation code changes.
Prepare each pair before merging upstream work. Freeze deployment during any brief cross-repository pin transition. If the repository’s current workflow supports a safer staged artifact/version approach, document it first.

SDK changes likewise require a separate Shooter re-vendor PR with matching source pin and manifest.
Common checks for every applicable PR
Shooter
- npm run lint
- npm run typecheck
- npm test
- npm run build
- npm run assets:check
- npm run budgets
- npm run profile:check
- npm run build:server-sim
- New focused regression/parity/performance tests.
Hub
- npm run lint
- npm run typecheck
- npm test
- npm run build
- npm run test:dup
- npm run test:rt
- Existing simulation guards, H5/match capacity and economy checks.
- New worker, migration, queue and fault tests.
Use the current repository commands and CI definitions if these change. Report focused versus full-suite results accurately.
Overall dependency order
- Contract: 00 → 01
- Simulation: 01 → 02 → 03 → PIN-03 → 04 → PIN-04 → 05
- Persistence: 01 → 06 → 07 → 08
- Worker: 04 → 09; 08 + 09 → 10 → 11 → 12
- Client: 05 + 13 → 14 → 15 → 16
- Recovery: 11 + 12 → 17
- Integration: 12 + 16 + 17 → 18
- Operations: 09–12 → 19
- Measurement: 18 + 19 → 20 → 21
- Rollout controls: 21 → 22
Schema and simulation foundation work may proceed in parallel. Do not parallelize overlapping files without explicit ownership.
Definition of implementation completion
The coding agent should return:
- Every PR and commit link.
- Exact artifacts and tested SHAs.
- Contract/product decisions and unresolved points.
- Schema/migration upgrade results.
- Compatibility and rollback evidence.
- Correctness/security matrix.
- Capacity results and host details.
- Hosting recommendation with assumptions.
- Independent review results.
- Explicit remaining failures, skipped checks and unmeasured claims.
- Confirmation that no deployment, production activation, credential provisioning or hosting purchase occurred without approval.
Do not declare “secure official-client-only rewards” complete. The deliverable is secure server-verified rewarded gameplay with documented browser provenance limitations, unless the user separately approves a stronger trusted-client architecture.
```
