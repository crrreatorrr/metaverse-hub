# PR18: independent end-to-end campaign verification evidence

Design only; no implementation or execution yet. Root requested this while
PR16/17/19 interfaces are being finished. Implementation starts on an isolated
Hub branch after those interfaces are reviewed. All execution is GitHub Actions,
with disposable Nakama/PostgreSQL/worker/browser services. No production access,
backup, migration application, deployment, paid infrastructure or activation.

## Goal and authority

Exercise the actual public lifecycle and financial authority through real Nakama
and PostgreSQL, the PR19 isolated replay daemon, and the PR16 actual Game/browser
control flow. Expected simulation comes from the **retained approved executable**,
not a newly built copy of the client's current engine. A client and a current
Node build agreeing with each other is insufficient evidence.

Current retained identity, independently checked over actual bytes before use:

- artifact `shooter-sim`
- source `05f7a0a245af921fc65a99588564175c19658e38`
- SHA256 `797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9`
- engine protocol 1 / upload 2 / replay API 2 / checkpoint 2 / economy policy 1
- content fingerprint `cea1f88b`

Read this identity from the server-owned approved registry and assert the exact
reviewed value; never infer it from Shooter main or the current vendored pin.
The current vendor 796/PIN158 work maintains the backend guard after external PvP
changes; it does not upgrade the approved private artifact. Record exact Hub,
Shooter browser, corpus and worker image/source identities in a bounded result
manifest. Artifact identity mismatch is an operational failure, never permission
to substitute another executable or bless new expected hashes.

No new public seed/state/outcome/settlement override is introduced. Public
`shooter.run.issue` always chooses its seed and protocol server-side. Trusted CI
fixed-seed issuance rows are explicitly internal fixtures, never evidence that
the public issuer accepts client seeds or that the official browser executed an
arbitrary submitted trace.

## Three complementary lanes

### A. Real browser, public issuer, ordinary controls

Use the actual PR16 entry control and Game instance, a real generic SDK/Nakama
transport and server-selected issuance for a disposable enrolled account. The
request is exactly `{key,canonicalBoss}`; assert no seed, inventory, protocol,
private state or artifact selector is sent. Its random seed is kept unchanged.
Drive real DOM KeyW/mouse controls in headless Chromium, not an alternate Node
simulation. Observe a bounded run prefix, flush its real final partial tail,
finish, and wait for real worker verification and owner status. A short prefix
normally closes incomplete; a legitimately observed earlier terminal must agree
with the approved oracle rather than be overwritten by an assumed outcome.

Capture actual canonical frame bytes at the existing Game seam, and actual
off-loop HTTP append wire. The existing order is buildCommand -> canonical
encode/decode -> frozen observer -> synchronous recorder acceptance -> simulate
the same decoded command. Do not mutate the frozen command or state in the
observer/recorder. Do not reconstruct a different log from raw controls later.
Bound the test capture explicitly by case frame/byte budgets; it is test evidence,
not a second unbounded production upload queue.

At selected simulation boundaries, pause outside Game.step and take a bounded,
read-only JSON projection of actual deterministic Game state plus its reported
hash, RNG and nextId. Compare this state with the approved worker checkpoint at
the same verified/simulation tick. Use the quantization/hash algorithm from
the retained 05f source for the comparison, not the current client's hash module
as both expected and actual. Its corresponding retained bundle performs the
actual simulation. Compare canonical quantized state excluding only the reviewed
events field, exact RNG/ID counters, parts, and the independent cursors. Do not
drop unexplained fields to make parity pass. Terminal hashes must also equal the
retained artifact's actual terminal hash. Private state is inspected only inside
the disposable test stack and is never submitted as public payment authority.

This lane proves real browser input/canonical recording/transport/approved replay
agreement. It does not prove a human supplied the inputs or attest the browser.

### B. Fixed-seed corpus and legal protocol-only emulator

Use all twelve **stored input envelopes**, never regenerate bot decisions or
reroll seeds. Verify fixture byte/input hashes before replay. Create canonical
fixed-seed issuance with the retained approved builder through trusted CI database
setup, preserving the exact owner/session/day/seed/boss binding and active limits.
Label every such setup `internal_fixed_seed_fixture`. Time-aged issuance used to
avoid waiting400 seconds on the live lead limit is also trusted fixture setup;
ordinary public issuance tests retain real clocks and random seeds.

The protocol-only emulator submits legal frame/action envelopes using the public
append/finish/status endpoints and real game authentication. The real scheduler,
PR19 isolated daemon, fenced commit and deferred payment perform all advancement.
Accepting these legal inputs is expected and explicitly **not official-client
attestation**. It demonstrates the stated server security boundary.

| Fixture | Frames | Stored legacy outcome (incremental latch checked independently) |
| --- | ---: | --- |
| sahil-success-7 | 9634 | clear |
| sahil-success-11 | 6550 | clear |
| sahil-fail-7 | 1001 | fail |
| sahil-assisted-9 | 9347 | assisted |
| obama-success-7 | 24000 | incomplete |
| obama-success-11 | 5049 | clear |
| broccoli-success-7 | 2959 | clear |
| broccoli-success-11 | 2701 | clear |
| glowie-success-7 | 1676 | fail |
| glowie-success-11 | 1812 | fail |
| tinubu-success-7 | 1120 | fail |
| tinubu-success-11 | 7425 | fail |

These legacy outcome observations do not supply v2 first-terminal ticks/hashes;
the retained incremental executable independently establishes those facts.
The historical `success` filename names an attempted strategy, not a successful
clear. Obama recorder hashes in the old corpus diverge from its verifier; keep
that observation visible, and use the approved incremental replay's actual first
terminal and full-state result as authority. Never copy recorder terminalTick or
recorderStateHash into a server receipt. The full 24000-frame Obama input and full
9634-frame Sahil input remain present and are actually processed. Do not shorten
either, raise budgets, override the simulation clock, or replace them with easier
traces to obtain green checks.

Compare real committed checkpoints against an independent retained 05f oracle at
every work boundary and at final closure, including canonical state/hash, RNG,
nextId, parts/side state, accepted/verified/simulation cursors and byte/action/
batch counters. Run one-full-public-batch,120-frame cadence and terminal±1
boundary variants from identical bytes where legal. To test accepted terminal
tails, pause workers before accepting the bounded full input; the client cannot
extend admission after the authoritative terminal latch. The long incomplete
case exercises fixed-budget completion rather than a fabricated source terminal.

### C. Required full Sahil7 actual Game capture

Root approved this as required: the complete 9634-frame Sahil seed 7 trace must run
through actual Game.step/render/record/transport at ordinary 60 Hz simulation and
real wall cadence (about 161 seconds), not a shortened success or fast-forward.
CI's trusted server setup creates a canonical fixed-seed run and idempotency key
through the actual SQL issuer and approved builder, with the browser's real owner
and original game session. Immediately before the actual PR16 start click, an
isolated-page one-shot crypto.randomUUID stub supplies only that issue key.
Restore the original UUID generator after that call and fail if another caller
consumes it. The public issue request still has only key/boss; real Nakama returns
the original stored acknowledgment. There is no mocked issued DTO, client state
import, public seed override, health nerf or special inventory in this lane.

The bot input adapter returns the full stored commands through actual
input.buildCommand before canonicalization, indexed by actual simulation tick;
it does not use mutable bot AI helpers such as _sweep. It reads only state and
the reviewed reward-active/start signal. Actual captured frame bytes must equal
all 9634 original frames, and first terminal/hash/tick/RNG/counters must agree
with retained 05f and real Hub/PR19 processing. The required controller buffers,
upload, final partial tail, finish/status and rendering remain the production
paths. No network/hash/persistence await is added to Game.step or its recorder.

Stable Game snapshots/hash comparisons occur outside the input callback, with
the actual final terminal world stopped by the reviewed PR16 lifecycle. The
per-work-boundary checkpoint comparisons remain in lane B; do not add heavy
per-tick hashing/cloning to the hot loop merely to obtain test observations.
This lane is explicitly a trusted fixed-seed CI fixture and does not show that
the public issuer allows seed choice. Lane A independently exercises unmodified
public random-seed issuance and native controls. No claim is made that all twelve
fixed-seed traces ran through the UI; every full trace runs in lane B.

## Adversarial and recovery matrix

Use fresh isolated identities/runs or drain a case fully before the next one.
Each negative case asserts the relevant accepted/verified/revision/job/receipt
and financial snapshots are unchanged, rather than merely checking HTTP status.
Operational faults must retain accepted input and pending recovery state; they
must not be relabeled invalid gameplay. All payment assertions derive from actual
immutable verified work plus the authoritative receipt, never a synthetic clear
result injected into a server row.

Retain the full existing 20-case authoritative backend lifecycle matrix as a
separate required strict gate, including its exact financial/expiry/readiness
checks. Its approved in-process oracle helpers are not evidence of container
isolation. Lanes B/C additionally exercise the actual PR19 coordinator and
offline daemon; do not relabel the old helper as the deployment-equivalent worker.

| Area | Required real cases and evidence |
| --- | --- |
| Public schema and identity | Seed/state/HP/inventory/checkpoint/outcome/amount/artifact injection; extra keys; wrong account/run/original session; replacement session; another game's token; unauthenticated and broad HTTP-key attempts. No public path mints from these fields. |
| Canonical input/history | Gaps, overlaps, reordering, noncanonical base64/quantized values, unsupported actions, duplicate action offsets, changed duplicate bytes/actions, equivalent JSON property order, exact retry recovery. Sequence and digest conflicts cannot replace history. |
| Bounds | Per-body UTF8,2 MiB batch text,64 MiB retained run text,28800 batch/162000 run frames,4096 batches,32 batch/131072 run actions, depth/ID/counter overflow. Large authenticated hostile bodies never produce a job or payment. Use bounded hostile data, not an unbounded resource attack. |
| Issuance/version | Default-off legacy remains unchanged; sticky cohort cannot opt out; same-key/version races, finite readiness saturation, atomic quota rollback, actual random public seed, stale canonical day after lock wait, original-key historical receipt. Current client code cannot choose/upgrade the retained artifact. |
| Command/Game failure | Real W movement and frozen canonical bytes; unsupported action; recorder rejection, observer/error handler/simulation crash latch before another rewarded tick; no second world command is simulated after rejected evidence. Rendering/input status controls remain responsive while the background worker is paused. |
| Client lifecycle | Received is not verified/paid. Final partial tail; one request/timer pipeline; lost issue/append/finish replies; status exact-ACK recovery; stale browser completion/account switch; same-session token refresh; no original-session rebind; bounded offline/backpressure/deadline behavior; local clear with pending or denied server payment. |
| Lease/fence/checkpoint | Worker crash before/after claim response; retry after partial progress; stale fence/revision/input hash; old checkpoint and changed self-signed hash; artifact bytes/manifest mismatch; resource timeout/OOM with operational retry; corrupt predecessor fairness and bounded quarantine. No old owner advances or closes a newer history. |
| Commit boundaries | Fault before durable append, after append/lost reply, before fenced result, after result commit/lost reply, before/after separate financial commit, lost finish reply, duplicate payment retry. Compare immutable stored receipts and exact money snapshots on every retry. |
| Terminal/economy | Gun/splash eligibility; assisted/fail/incomplete zero; Obama one canonical boss; forbidden agent/glowieAgent/part aliases; per-boss issuance-day uniqueness,200/session and1000/current-game settlement-day cap; refund non-cap bypass; duplicate settlement; leaderboard milliseconds from authoritative first terminal tick. |
| Time/authorization | Actual clock after held session/economy/wallet/day-row locks; UTC crossing (issuance-day boss bucket, settlement-day ticket bucket); fixed upload expiry retains input and can coexist with later paid receipt while original session is live; ordinary session expiry/close has no grace; durable observed expiry cannot revive after lease rewrite; already-paid receipt remains final. |
| Retention/recovery | Missing finish eventual closure; quarantine reason retained; bounded audited extra-attempt grants without resetting max/attempt/fence/history; expired run plus newer active account run; no session/payment revival; duplicate/conflicting/unauthorized maintenance calls; partly/unverified/uncertified payload cannot retire; exact ACK recovery for retired input; changed duplicate conflict. |
| Upgrade/rollback/restore | Populate legacy/economy plus real v2 pending/terminal/denied work; forward upgrade and repeat boot preserve IDs/checksums/applied_at/history; stop-new defaults do not fall back to legacy for cohort or destroy existing drain/status; exact manifest remains retained. Actual backup/restore/continuation comparison and cleanup-vs-commit are described below. |

There is no genuine authored issued `fled` trace in the corpus. Preserve the
source PR04 synthetic shared-classifier policy regression as clearly synthetic;
do not advertise an end-to-end issued flee case or fabricate a playable clear
for Glowie/Tinubu. Coverage reports distinguish all-five-boss execution from
successful clear coverage and identify this specific gap.

## Actual backup and restore proof

Coordinate PR17's stable maintain bodies before implementation. Its current
design has no public operator RPC. Exercise its narrow account-bound SQL helper
through trusted test setup, plus its runtime-envelope unit boundary; do not invent
a browser maintenance API. The scopes are inspect/reap/requeue/certify/retire.
Certificates are explicit trusted operator attestations, not cryptographic proof
that a backup happened. PR18 supplies an actual disposable restore experiment.

1. Produce a real approved private checkpoint covering a complete prefix, retain
   an accepted unverified suffix, and record immutable batch/attempt/result facts.
2. Dump the actual disposable PostgreSQL database to a private temporary file;
   compute its SHA without publishing the backup or credentials.
3. Restore into a separate throwaway database and boot a second Nakama instance
   against it with the reviewed test-only transport profile. Recreate/rotate only
   ephemeral worker credentials as needed; preserve original run/session identity.
4. Resume the retained approved artifact through the isolated worker and real
   restored gateway. Compare final state/cursors/first terminal and exact receipt,
   ledger, balance, boss/day buckets, idempotency and leaderboard with a control
   continuation. Do not normalize away duplicate or missing financial rows.
   Pre-dump rows, including their IDs/timestamps/checksums, must survive exactly.
   Independently generated post-restore ledger UUIDs/timestamps may differ from
   the control only where explicitly identified as nondeterministic. Compare
   every financial amount/reason/reference/bucket/count/balance and uniqueness
   invariant; deterministic receipt/evidence/idempotency content must agree.
5. In the original database, certify only that exact backed-up checkpoint/range,
   retire a fully verified redundant payload prefix after the configured test
   age, then continue the retained unverified suffix. Metadata/digests/counts/
   received ACKs remain immutable; reserved/retained counters change only as PR17
   explicitly permits. Verify no loss of payment denial or pending evidence.
6. Race cleanup with commit and repeat cleanup/requeue/certification. Refuse stale
   revisions, wrong run/artifact/backup proofs and out-of-range certificates.

If17's first implementation proves restore through the isolated simulator plus
scratch PostgreSQL rather than a second Nakama instance, report that exact scope
and retain the second-stack integration as a concrete PR18 requirement. No raw
private checkpoint, frame log, SQL parameter log or backup is uploaded as a CI
artifact; sanitized hashes/counts and bounded policy outcomes are sufficient.

## Proposed files and test layout

- Hub `server/test/dup/shooter_verification_end_to_end.ts`: public lifecycle,
  financial, adversarial and recovery assertions on actual services.
- Hub `services/shooter-verifier/test/integration-stack.mjs`: reviewed PR19
  coordinator/socket profile launcher/client helpers, never a substitute in-process
  replay path; bounded fault controls operate only in the disposable test profile.
- Companion Shooter test if needed: `tests/hub/campaign-full-stack-browser.test.js`
  and a test HTML harness around actual Game/PR16; no production seed hook.
- `.github/workflows/shooter-verification-e2e.yml`: explicit exact revisions,
  browser build from the reviewed Shooter head, retained worker bytes, real DB,
  isolated replay profile, strict reporter and bounded sanitized evidence upload.
- `docs/shooter-verification/integration-matrix.md` and a versioned bounded JSON
  evidence schema mapping each required case to exact artifacts and actual results.

Keep corpus/full-work cases split by fixture or bounded group so every complete
trace runs within existing per-work and test budgets. Do not repeatedly execute
the full corpus in every workflow or raise deadlines to mask a capacity failure.
These are correctness checks, not PR20 capacity benchmarks. A timeout remains an
operational failure to resolve, not a skipped security success. The old legacy
Goja 24000-frame CPU limitation stays separately labeled; isolated retained worker
completion is the PR18 execution path, not a claim that legacy full Goja parity
was fixed.

## Evidence and merge gate

Use the corrected actual reporter: every observed failed outcome counts even for
new categories; each selected required category must have a PASS; unknown or empty
selection must fail. Keep a real CLI negative canary for empty selection and the
existing process canaries for unregistered failure/pending/expected-fail policy.
Read and record literal per-case results, not just the workflow conclusion.

Required evidence is exact revision/byte provenance, every required case's
pass/fail/pending/expected-regression classification, actual frame counts including
9634 and 24000, actual browser captured-byte digest and retained replay result,
real committed database/financial invariants, and sanitized isolation/restore
facts. New expected outcomes require independent review; tests never regenerate
or automatically bless fixtures. No required security case is skipped or treated
as expected failure to make the primary matrix green. Known unsupported coverage
is named and remains a gate where the original plan requires it.

Independent root/security review and passing exact-head Actions precede merge.
PR20 benchmarks and PR21 hardware/provenance decisions remain separate; no host
capacity, production isolation, official-client provenance or deployment claim
is inferred from a successful disposable integration stack.

## Interfaces still required before code

- PR16 reviewed entry/control API, default-off configuration and safe test
  bootstrap; current actual Game canonical capture seam is available.
- PR17 final maintenance schemas, auth/fault seams and backup/restore receipt
  format; current design and operator bodies were supplied by its author.
- PR19 offline UNIX-socket daemon/coordinator profile, readiness/drain/fault
  controls and stable metrics/health formats. No shared-host-only substitute.
- Root approved lanes A/B and required lane C's complete 9634-frame actual UI run.
  The remaining prerequisite is PR16's reviewed start/active/terminal signals for
  the one-shot CI issue-key stub and read-only stored-command input adapter.
