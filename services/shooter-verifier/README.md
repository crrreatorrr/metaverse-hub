# Dormant isolated campaign verifier (PR09)

This package is a build/test artifact. It starts no HTTP listener, public RPC or
production service. PR10 must authenticate scoped worker claims; PR11 must
validate every returned binding/fence/revision and atomically commit progress.
A returned `binding` is an echo, not authentication or authority to pay.
No database, wallet or Hub credentials are supplied to a replay process.

`ReplayPool.execute(text)` accepts only a bounded JSON string (20 MiB). Calls
select `begin`, `accept` or one `step`, with exact fields `operation`, `manifest`,
`issuance`, `checkpoint`, `batch`, `accepted`, `maxWorkFrames`, `claim`.
The manifest is the exact server-owned allowlist in `src/approved.mjs`.
`economyPolicy:1` names the unchanged initial policy (schema uses a positive
integer), not a new economic rule. Bundle economy declarations must remain
non-minting/zero/server authority; this package never chooses a payment amount.
New approved artifacts require explicit reviewed code and bundle updates; retain
old versions until their accepted work is resolved, including quarantined runs.
There is currently one supported manifest and no issuance of this API.

Claim fields are `jobId`, `runId`, `accountId`, `sessionId`, `inputSha256`, `fence`,
`initialRevision`, `expectedRevision`, `tick0`, `tickEnd`, `continuationTick`.
Transport uses camelCase; PR10 must explicitly map SQL columns. Immutable logical
range/full-public-batch digest survive attempts. The continuation/revision may
advance inside that range. `accept` records the original full public batch once;
subsequent `step` calls resume its private pending batch and verify at most 4096
frames or the remaining planned range, whichever is smaller. Every call returns
the echoed claim, full private checkpoint and source-whitelisted public result.
Partial retryable progress is not a completed range. PR11 must durably commit a
validated checkpoint/counters/revision and continuation on the same logical job,
or retry from the committed predecessor; no process memory is authoritative.
Server-derived `acceptedBeforeTerminal` must come from durable admission history,
never a client boolean. Source accepted/verified input cursors and frozen terminal
simulation tick remain distinct. No restart/reconnect grants a new cap or history.

The coordinator has finite 1–4 workers, 0–16 queued calls, bounded input/output,
a fixed maximum 20-second wall deadline and finite 5-second startup deadline.
Linux `/usr/bin/prlimit` enforces 120 cumulative CPU seconds per replay process
and 64 descriptors; V8 old-space is 192 MiB. Processes recycle after 16 calls.
There is no crash-loop respawn: a failed worker goes unavailable; explicit
coordinator recovery constructs a new pool. Every failure is operational pending,
not a cheating or payout verdict. Child environment is a new allowlist containing
only `NODE_ENV`, with no inherited secrets, loader flags or inspector settings.
No request can choose a path, module, URL, function or clock. Strict source object
validation is preserved by JSON parsing inside its realm.

Node `vm` separates names, **not hostile code**. Replay runs in separate OS
processes. V8 heap and CPU/wall limits do not bound native/Buffer memory alone.
The required launch contract in `compose.test.yml` enforces 512 MiB whole-container
memory, 32 PIDs, 2 CPU quota, read-only filesystem, dropped capabilities, no new
privileges and **network_mode:none**. Dockerfile alone cannot enforce these
controls. Do not run a production worker outside equivalent reviewed controls;
future gateway coordination needs a separately networked component and narrowly
scoped communication, never network access in replay children. No production
network routes or credentials are configured here.

GitHub Actions executes real warm-process replay, crash/stop/timeout, hard CPU and
heap limits, plus a native-memory cgroup OOM test and offline container tests.
A separate job uses all twelve immutable source fixtures, including the full
24,000-frame Obama trace, accepting each once and comparing every full private
checkpoint/public result with direct approved-bundle execution after each slice.
The source PR04 separately established Node/Chromium/Goja parity. Frozen names
ending `success` mean attempted success, not guaranteed clear; known recorder
hash discrepancies and legacy Goja budget refusal are documented in the corpus.
CI heartbeats demonstrate coordinator responsiveness, not deployment capacity,
production latency, browser provenance or safe hosting concurrency. Hosting and
public activation gates remain open; no deployment is authorized by passing tests.
