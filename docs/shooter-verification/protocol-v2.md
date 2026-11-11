# Campaign reward verification protocol v2

Status: dormant implementation contract for PR 01. This document changes no RPC, SQL, reward amount, flag or deployed service. D01/D02 are recorded owner decisions in [decisions.md](decisions.md). Other resource ceilings below are proposed conservative admission bounds for review, not measured capacity recommendations. Legacy protocol 1 keeps its existing meaning and support; do not reinterpret its receipts or limits.

## Authority and versions

Client → authenticated Hub ingestion → durable queue → isolated verifier → fenced result commit → transactional settlement.

The client controls legal inputs, including bot inputs, and renders locally. Hub owns identity, issuance, start state, authorization, durable history and money. The authenticated verifier is trusted to simulate an approved artifact but has no wallet/SQL credentials. An authenticated browser protocol cannot attest official-client execution; see [threat-model.md](threat-model.md). Public activation remains gated on an explicit product decision.

Bind issuance to independent `uploadProtocol=2`, simulator protocol, checkpoint schema, economy-policy version, exact simulator SHA-256 and source commit. Do not assign an unbuilt artifact a fictional identity. PR 03/04 and generated companion pins must provide the real manifest before any v2 issuance. Fingerprint is a content check, not artifact identity. A run keeps its immutable manifest for its entire lifetime; a deploy cannot silently upgrade it. Unknown or unavailable supported artifacts cause an operational pending state, never client-selected fallback execution.

## Issuance and start

`shooter.run.issue` selects legacy versus v2 through server-owned configuration/cohort authorization. V2 requests may name only the v2 protocol, idempotency key and canonical boss. Reject extra properties. Account, game session, day, run ID, seed, policy, artifact and loadout are server-owned. Identical authorized issuance retries return the original issuance; a conflicting key is rejected. Keep legacy handling separate.

Retain the canonical authored boss-section/start-loadout contract in Shooter `src/server/runContract.js`: server seed, starter MG, no imported inventory, cheats/debug disabled, and the manifest's canonical section. V2 does not authorize full-campaign arbitrary checkpoints as rewarded starts. Bosses are `sahil`, `obama`, `broccoli`, `glowie`, `tinubu`; all Obama's parts count as one boss. Existing gun/splash last-hit, assisted/dead/fled eligibility rules remain unchanged. Humans and legitimate bots are treated equally.

Issuance returns server UTC timestamps, original session binding, immutable version manifest and explicit limits. Simulation starts only after issuance for rewarded mode; casual local play remains available. One unresolved v2 run per account/game is admitted at a time. Identical retries do not consume a new slot. An active row is released on a durable run close/expiry, not merely because a browser disappears. Global admission is default-off until an operator supplies a measured finite limit.

## Clock, upload and reconnect policy

Fixed simulation cadence is 60 ticks/s. Canonical quantized inputs are decoded before client simulation and the same bytes/actions are recorded. The server simulates every tick at that fixed cadence. Leaderboard time is the first authoritative terminal tick from the issued start, converted to milliseconds once; it never uses elapsed wall time, per-call frame counts or a client score.

Wall time only governs authorization, expiry and the live-input rate bound. Pause, hitstop or hidden-tab suspension produces no simulated tick and must not synthesize a time-scale, `dt` or skip instruction. The wall-clock upload/session deadline continues. A hidden tab can pause recording or resume from its current local state while the original session is valid; it cannot claim crash restoration. Client integration must demonstrate which game hitstop paths actually stop ticks. Any mismatch is an implementation failure, not permission to omit inputs.

Run upload deadline is the earlier of issuance + 45 wall-clock minutes and original session expiry/close/revocation. There is **no post-expiry upload or settlement grace**. A session extension made by an existing authorized mechanism while it is still valid may preserve that same session's live authorization, but does not extend the fixed run deadline or revive a closed run. Disconnect is not revocation. Within the still-valid original session and run deadline, retry immutable bytes and recover accepted/verified status; a new account/session cannot inherit the history. Access-token renewal must remain bound to the same underlying valid session.

Reject accepted cumulative ticks exceeding `floor((database_now-issued_at)*60)+120`; the two-second lead allowance bounds honest scheduling jitter, not proof of browser provenance. Reject too-fast uploads with an explicit retry time and no mutation rather than accusing cheating. Successful durable input acceptance stores its authorization evidence and time. Expired authorization refuses new input. Already accepted input may still verify to preserve an explanation/receipt, but cannot earn payment after ordinary session expiry.

## Public append envelope and canonical limits

`shooter.run.append` accepts exactly:

```json
{"protocol":2,"runId":"server-run-id","sequence":0,"tick0":0,"n":120,"frames":"canonical-base64","actions":[]}
```

The example is a shape, not a valid encoded frame payload. Server derives caller identity, original session and immutable run manifest. `sequence` starts at 0 and increases by one. `tick0` must equal accepted tick; `n` is a positive safe integer. Actions are the codec's strict ordered `[frameOffset, actionId]` records; initially only `transitionDone` is allowed. No raw commands, state, health, inventory, seed override, checkpoint, score, outcome, payment amount or arbitrary object properties are accepted. Reject malformed/noncanonical base64, unknown action IDs, duplicate offsets, out-of-range offsets, nonfinite values and unsafe numbers before replay.

| Limit | V2 contract |
| --- | --- |
| Encoded input per batch | 2097152 UTF-8 bytes of canonical base64 `frames` text |
| Cumulative encoded input per run | 67108864 bytes of distinct accepted `frames` text |
| Complete append JSON wire body | 2162688 UTF-8 bytes; enforce before JSON parse |
| Tick count per batch | 1–28800; remains subject to encoded byte bound |
| Cumulative ticks per run | 162000, including every accepted range once |
| Distinct batches per run | 4096 |
| Actions per batch / run | 32 / 131072, subject to frame-offset uniqueness |
| Identifier/idempotency key length | 80 ASCII characters; run ID additionally follows issued format |
| Request structural depth | 12; exact field/type schemas still apply |

Both bytes and frame ceilings apply. At the existing 12 bytes/frame, 162000 frames need 2592000 base64 bytes, now possible across batches. JSON/actions have their own finite limits and do not consume the `frames` allowance. Strong request digests include protocol, run ID, sequence, tick range, canonical encoded bytes and actions; canonicalize the validated envelope before hashing. Client digests, if added later, are hints only.

Transport retries do not increment cumulative bytes, ticks, batches or action accounting. Counters are durable per-run accepted/verified counters, never reset per call/checkpoint/reconnect. Reject over-limit acceptance atomically. Upload batches and internal verifier slices are different units: workers may verify smaller ranges with complete checkpoints, without changing public acknowledgment identity or weakening whole-run caps.

Global/account retained-byte limits, request-rate tokens, job concurrency and work-slice duration must be explicit finite configuration before new issuance. Default absent/invalid configuration disables admission. Apply rate/size/auth checks before decoding or database-heavy work. This contract does not claim a safe public concurrency or select operational cadence from CI timings.

## Durable receipt and status semantics

Batch insertion, cumulative accepted accounting and immutable acknowledgment commit in one transaction. Identical authorized retry of `(runId,sequence)` returns the original acknowledgment; different validated bytes at an occupied sequence conflict. Gaps and overlapping tick ranges do not mutate accepted history. A lost response is recovered from status or the same request, not a replacement history.

`shooter.run.status` is owner-authenticated and bounded. It reports run state/revision, accepted sequence/tick, verified sequence/tick, first terminal result when present, payment status/reason and retry guidance. It never exposes private checkpoints, full input logs, worker credentials or another account's data. Owners may read stable status with ordinary account authentication after the original game session expires; that read permission cannot append or pay. Stable batch acknowledgments remain historical facts even after authorization expires.

`shooter.run.finish` seals the accepted tail after all append receipts are durable, naming the expected final sequence/tick. It cannot supply a client outcome or force settlement. A new seal requires the same live original game-session authorization and unexpired run upload deadline as append. Finish retries during that authorization are idempotent; a conflicting tail fails. After expiry, recover the historical seal/result through owner-authenticated status; no new seal or append is permitted. Expiry closes admission durably and queues any already accepted tail for verification without needing a client finish, so accepted work cannot be stranded by a missing final RPC. A lost/missing final upload cannot be replaced by a completed-log settlement endpoint. Finish can leave verification/payment pending. Once sealed, no new inputs are accepted.

| State | Required meaning |
| --- | --- |
| received | Inputs durably stored; not yet replayed or payable |
| verified | Server replay accepted this range; not necessarily terminal |
| terminal_verified | First server-observed terminal result retained durably |
| payment_pending | Eligible terminal result exists; settlement has not committed and live authorization is still required |
| paid | Ledger/receipt/cap/ranking transaction committed; retries return stable receipt |
| ineligible | Valid replay yielded assisted/failed/fled or another explicit existing gameplay eligibility result |
| authorization_denied | `session_expired`, `session_closed` or `revoked`; distinct from cheating and infra failure |
| pending_retryable | Queue capacity, artifact availability, execution timeout, crash or database issue; no authoritative invalid-play decision |
| invalid | Deterministic protocol/history/gameplay validation rejected the range, with bounded reason category |

Model input/run state and payment state separately. A `terminal_verified` run can retain a payment denial; a single `ok` flag cannot erase that distinction. Never display “earned/paid” based on receipt or local clear alone.

## First terminal tick and checkpoints

Latch the first authoritative success, assisted completion, failure or flee at the simulation tick where it occurs, with boss-part history and eligibility. Never overwrite it due to later bytes or a different segmentation. Validate accepted trailing bytes structurally and account for them, but do not simulate ticks after terminal or use them to change the result/ranking. Keep three separate cursors: accepted input tick (end of durably stored history), verified input tick (end of input resolved by committed verification), and simulation tick (last simulated tick, frozen at terminal). Before terminal they agree at each verified boundary; after terminal the verified input cursor advances over structurally validated trailing ranges without advancing the simulation tick. Resolve every previously accepted trailing batch with an immutable acknowledgment bound to the same terminal result and its actual input range; do not use the frozen simulation tick as the next input offset. Count those ranges toward accepted/verified bytes, frames, actions and batches exactly once. Only simulation tick determines the terminal time/ranking. Once terminal is committed, refuse new distinct batches and return terminal status. If the accepted sealed tail has no terminal, close as incomplete without payment; finishing is not proof of success.

Checkpoint schema includes complete simulation state, RNG/counters, boss-part history, rewind side state, cumulative replay counters, manifest identity and terminal latch. Import into a fresh process must preserve future behavior; prevent recursive snapshots and enforce schema/size/depth limits at the trusted-service boundary. Worker results are private and checkpoints cannot be supplied through public endpoints. PR 03 must establish measured checkpoint size bounds using the regression corpus before this API is enabled.

## Internal execution and monotonic commit

Only scoped authenticated verifier workers may claim/renew/complete jobs. Bind every result to job/run/owner/original session, predecessor revision, input digest/range, manifest and monotonically increasing fencing token. One logical active chain per run; expired leases can retry, but stale success **and failure** cannot commit. Never hold SQL transactions during replay.

An atomic completion transaction validates ownership/fence/predecessor, advances checkpoint/cumulative counters/revision, records immutable verified acknowledgment, completes the job and makes the next predecessor-ready work eligible. Retryable runtime failures consume bounded attempt/backoff budgets, never classify gameplay as invalid. Exhausted operational attempts quarantine work with visible pending support state, retaining evidence. CPU and wall-clock budgets are distinct. No raising legacy timeouts or running overloaded v2 work back in Nakama as a fallback.

## Settlement with no expiry grace

Preserve 20 Tickets once per canonical boss/account/game/issuance UTC day, original-session 200 cap and shared account/game 1000 cap on settlement UTC day. Preserve existing atomic ledger/receipt/cap/ranking semantics and existing eligibility policy; no partial client-chosen payment. A capped valid clear is distinct from invalid play.

Separate verified terminal state from settlement. Repeated worker results or settlement retries cannot duplicate credit or replay the fight. In the settlement transaction, lock/recheck the original session and require it to be open, redeemed, owner/game-bound and unexpired against database time, together with authoritative run revision/terminal/policy. Here `database_now` is an actual current database timestamp sampled after acquiring the required locks (for example PostgreSQL `clock_timestamp()`), not transaction-start `now()` captured before a lock wait. Test a transaction blocked on a lock across the lease deadline. Expiry wins when `lease_until <= database_now`; a client request sent before expiry confers no settlement reservation. Coordinate concurrent session-close/revocation and settlement locks consistently so the linearization point is explicit. A paid receipt remains stable even if its session subsequently expires.

If queued verification or payment fails to complete before expiry, retain the verified result and report zero payment with `session_expired`. This is the explicit owner-selected tradeoff; **timely input acceptance does not guarantee a payout**. Do not silently rebind, revive or grant grace, and do not mark expiry as cheating. Show this risk before rewarded start and report queue delay separately. Retry transient payment failures only while original live authorization holds. No generic internal/public “credit user” operation exists.

## Retention, version support and rollout

Retain accepted input until a corresponding complete committed checkpoint and immutable acknowledgment safely replace it, or terminal verification resolves it. Unverified/uncertain work cannot be deleted solely because a lease, session or run deadline expired. Preserve terminal denials, receipts and ledger evidence under the existing retention rules. Quarantine operational failures; no destructive cleanup is enabled until PR 17 defines and tests retention with backup restoration.

Retain each issued manifest/bundle until all bound accepted work is terminally resolved; quarantined work remains unresolved and retains its manifest/bundle through recovery; do not remove it just because its upload deadline passed. No new issuance for retired manifests. Deleting artifacts required by unresolved work is not ordinary rollback. PR 21 must measure backlog and expiry-related payment denials, and PR 22 must demonstrate stop-new-runs/drain without losing evidence. Public activation, host spending, production credentials and production migrations still require separate approval.

## Acceptance matrix

PRs 02–18 must demonstrate whole/segmented cross-runtime equivalence at arbitrary split points, fresh-process rewind, first terminal tick, cumulative limits, legacy parity, strict public schemas, conflicting duplicate rejection, lost responses, unauthorized rebind, expired session at input/settlement, session-close races, stale worker success/failure, artifact mismatch, exactly-once credit, cap/UTC boundaries and valid protocol emulation without official-client attestation. Preserve difficult long runs; no shortened acceptance replacements. GitHub Actions must exercise exact committed artifacts and real PostgreSQL/Nakama integration where required. Unrun/failed/skipped checks remain explicit.
