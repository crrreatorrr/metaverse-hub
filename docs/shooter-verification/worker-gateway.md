# Dormant scoped worker gateway (PR10)

The four `shooter.internal.claim`, `.renew`, `.retry`, `.result` RPCs have no
production principals and the additive0053 gateway defaults disabled. They do
not accept the broad Nakama HTTP/admin key as service authorization. Dedicated
ordinary service-account JWT transport **and** an independently scoped bearer
credential are required. JWT vars cannot grant service authority.

No production account, token, key, route, deployment configuration or access
change is created here. Development fixtures provision ephemeral principals only
inside the GitHub Actions database. Persistent provisioning requires separate
approval. A service account retains ordinary platform account RPC permissions;
this is not a platform-wide sandbox. Use a dedicated account without human game
sessions, purchases or wallet secrets. The extra credential authorizes only these
internal operations; it grants no administrative, SQL or generic payment access.

## Authorization and rotation

An immutable `game.shooter_verification_worker` registry binds each logical worker ID to exactly one owning service account; principal rows reference that pair. Concurrent attempts to provision another account under the same worker ID fail. Replacing a service account requires a new worker ID and letting old leases expire; only key rotation within its owning account preserves logical request identity.

Server-owned `game.shooter_verification_principal` binds account UUID, worker ID,
key ID, SHA-256 of `shooter-worker-token-v1\n` plus a cryptographically random
32-byte base64url token, explicit scopes, not-before, expiry and revocation.
Only its hash is stored; raw tokens never enter SQL or logs. Dedicated account
allowlist lookup and durable global/account60-second attempt-window admission precede large JSON parsing. Every admitted attempt is charged, including malformed bodies, wrong credentials, conflicting retries and duplicates; key rotation cannot reset the owning account rate window. Unknown accounts create no rate-counter row. Explicit finite attempt limits are required before enabling the gateway; temporary saturation reports rate_limited with a retry time. After envelope validation, a cheap
hash/scope preflight precedes checkpoint traversal. Neither preflight confers
mutation authority.

The atomic SQL operation locks principal -> gateway configuration -> scheduler
-> account -> run -> job. It checks credentials/scope and current database time
inside that transaction. If a downstream lock wait crosses key expiry, a final
`clock_timestamp()` check raises inside a subtransaction, rolling back claim,
attempt, renewal/retry/result-hook changes and receipt together. Revocation
updates lock the principal row exclusively, so authorization and revocation have
an explicit serialization point. The immutable receipt returned on an authorized
retry is historical; revocation/expiry still denies receipt access through this
service interface.

Provision a new unique key ID for rotation; do not repurpose an existing key ID.
Explicitly bounded overlap may authorize both keys; revoke the old row to stop
its subsequent claim/renew/result access. Retain old rows and receipts for audit.
After revocation a stale process cannot renew or commit; another authorized
worker recovers after the finite existing lease expires. No secret value appears
in an example. An approved provisioning process must generate high-entropy tokens,
place them only in the coordinator's secret store, and insert scoped fingerprints
with expiry into the server-owned principal table. Revoke before deleting the
underlying service account. No replay child inherits coordinator credentials.

## Exact transport and durable history

The request envelope contains exactly `workerId`, `keyId`, `token`, `requestId`,
`body`. RPC method selects operation; no request can select arbitrary SQL, URL,
module, payment amount or worker identity. Claim body is empty; renew names job,
fence and expected revision; retry additionally selects an allowlisted operational
reason. Result body is exactly `{manifest,result}`, where the result is the PR09
`kind`, `binding`, `privateCheckpoint`, `publicResult` object. Unknown fields are
refused, including reward amounts. Small operations are at most4096 UTF8 bytes;
results at most20MiB before JSON parse, plus bounded depth/nodes/arrays/strings.
Private checkpoint validation here is deliberately transport/schema-level; PR11
must validate complete critical state, hashes, versions and monotonic counters.

The Node claim helper requires a caller-supplied request ID; it refuses a missing ID before any HTTP request. The coordinator must durably save that ID before sending and reuse it after timeouts/lost responses, including credential rotation. Never generate a replacement claim ID merely because a response was lost. Explicitly retained IDs are also recommended for renew/retry/result retries.

Request digest is SHA256(operation + newline + stable sorted-key JSON body),
excluding credential/request ID. Request IDs are namespaced by logical worker ID,
independently of rotating keys within its fixed owning account. Original issuing
account/key remain immutable audit fields. A currently authorized replacement key
can recover the same receipt after old-key revocation. Identical authorized
request IDs return the original immutable acknowledgment; conflicting bodies or
operations reject. Claim and its **small acknowledgment** (state, exact claim and
initial lease metadata) commit together, so a lost response cannot lease another
job. No private checkpoint, batch or frames are stored in gateway receipts.

After that commit the claim RPC makes a separate authenticated SQL work read,
passing only service identity, credential fingerprint and immutable request
reference/digest. It locks principal/config/scheduler/account/run/job, checks
current scope/revocation/expiry, and projects private work **only** for the same
currently live fence, predecessor revision and continuation cursor. It rechecks
authorization and lease time after downstream waits. A key revoked between the
acknowledgment and work read cannot receive a checkpoint. The projection uses
server-owned canonical issuance, immutable accepted batch/digest, retained exact
manifest and authoritative predecessor checkpoint. The wire response adds
transient `work`, `workState`, `workReason`; those fields are not part of the stored
immutable acknowledgment. After progress, lease expiry or reassignment it returns
`work:null` and explicit stale status, without substituting another checkpoint or
claiming new work. Repeating a lost claim cannot silently follow a newer revision.

All durable gateway acknowledgments are at most **64KiB**. The immutable SQL
helper `game.shooter_verification_gateway_receipt_budget()` returns65536; quota
reservation and readiness checks use that value. Each new receipt reserves64KiB
globally and against its original principal; recovering an existing receipt under
a rotated key adds no reservation. Network request/private-work response limits
remain20MiB. This separates bounded metadata history from the one authoritative
checkpoint slot. It avoids copying a large checkpoint into every claim receipt.
Explicit finite attempt rates, retained counts and byte budgets are required to
enable the gateway. Reservations are not measured physical database/RAM usage or
hosting capacity. At capacity new operations return pending without deleting
evidence; no garbage collection is introduced here.

Stored checkpoint integrity uses SHA256 of PostgreSQL JSONB text, matching PR11.
Corrupt or unavailable projection retains the already-committed claim reference,
then releases its exact failed fence through bounded PR08 database_issue backoff;
finite exhaustion quarantines evidence. It neither forwards corrupt state nor
rolls back the scheduler's fairness turn forever. Credential expiry during that
read rolls back the read transaction's mutation, while the earlier legitimately
committed small claim acknowledgment remains historical.

The client must renew the exact claim before executing transient work. It does
not reject solely because the **initial** lease timestamp in an old acknowledgment
has passed: the same live fence may have been renewed. A missing/stale private
work projection is refused. PR11 still rechecks the current fence and revision at
result commit. Workers receive one immutable planned range, initial revision and
continuation plus the original full-batch digest; partial slices create no new
public batches or payout authority. Terminal-tail permission uses PR11's terminal
accepted high-water; if absent, terminal work projection fails closed.

## Result dependency and network boundary

PR10 result RPC checks live owner/fence/revision/digest/range/manifest binding,
then explicitly returns `pending_retryable/result_commit_unavailable` and
`pendingDependency:PR11`. It stores **no supplied checkpoint**, advances no run,
completes no job and pays nothing. Its SQL `commit_worker_result` hook is replaced
by additive0054 in PR11; the same outer authorization lock, expiry recheck and
atomic immutable receipt surround that hook. The scoped retry operation can
release operational work to PR08 backoff; no long v2 work falls back into Goja.

The coordinator `GatewayClient` has a server-configured default literal loopback
URL. Plain HTTP is allowed only for literal127.0.0.1 or::1; cross-host transport
requires HTTPS with standard certificate/hostname validation. Embedded URL
credentials/query/fragments, redirects, unbounded bodies and missing deadlines
are refused. Responses permit at most4096 stream fragments, including zero-byte fragments; the reader is canceled on either fragment or byte overflow, bounding coordinator metadata independently of byte count. No insecure TLS option exists. No production URL/configuration is
installed. Private routing/TLS configuration remains separately approved.
Replay processes retain PR09 network-none, read-only and resource-limit contract;
networked coordination is a distinct component, never a reason to give simulator
children network access or wallet/DB secrets.

Actions tests exercise real PostgreSQL/Nakama auth, scope/rotation/revocation,
wrong users/admin-key-only callers, lost-response/stale receipts, conflicts,
finite reservations, source-bound private work and unchanged reward state.
Key-expiry and revocation races assert real database lock waits before evaluating
refusal. Node tests exercise exact credentials, literal-loopback policy, redirects,
self-signed TLS refusal, response bounds and deadlines. All execution is in
GitHub Actions; no production credentials or deployment are authorized. Public
activation, provenance, hosting capacity and live-session settlement gates remain.

The exact Nakama3.41 transport defaults to256KiB HTTP requests, which is below
late measured checkpoints. CI alone sets `NAKAMA_TEST_MAX_REQUEST_BYTES=23068672`
in its ephemeral `server/.env`; the local-stack default remains262144 and restart
helpers preserve that test-only env setting. This finite22MiB outer bound lets
tests exercise the stricter20MiB internal RPC bound. No production configuration
is changed. Activation requires separately approved private routing and transport
size configuration, with tighter public route bounds; raising a global public
Nakama limit is not authorized by these tests. A full frozen24,000-frame Obama
fixture produces a late22,000-frame complete predecessor and network-replays the
entire remaining suffix, measuring actual checkpoint request/response bytes.

The shared-host Node-client integration test proves protocol/credential separation
and bounded child-process replay, not network-namespace/read-only isolation. Its
local ReplayPool children share the host network/filesystem. A production pool
adapter must preserve the separately offline, read-only PR09 container contract;
no production adapter/service wiring is installed here.

The copied `services/shooter-verifier/test/obama-success-7.json` is byte-for-byte
source05f's frozen fixture (fileSHA256290305879564ca056728554accb52d3469f1185bd2b3c68574929635767b5e77).
Its original generator provenance is retained. Only test-time issuance bindings
are regenerated for ephemeral account/session UUIDs, retaining exact input bytes.

Nakama3.41's SQL adapter logs SQL arguments when a query returns an error. The
SQL gateway catches server-side failures, rolls back all mutation and returns a
sanitized operational response; a real checkpoint plus forced receipt-trigger SQL
error is tested against actual Nakama logs. Application logs never stringify
exceptions or payloads and raw service tokens are never SQL arguments. However,
connection failures or driver cancellation before/around function execution can
still trigger Nakama's own argument logging. Production activation therefore
requires approved runtime argument-redaction/log-access controls and a separate
connection-fault review; this PR installs none and makes no unconditional private
snapshot-log secrecy claim. SQL-only catching is not a cure for driver logging.

Exact upstream evidence: Nakama3.41 commit
[`cab8af584947ff0d7ebee91d6c33e67d87fd3e47`](https://github.com/heroiclabs/nakama/blob/cab8af584947ff0d7ebee91d6c33e67d87fd3e47/server/runtime_javascript_nakama.go#L764)
logs `query`, `args` and error in the SQL adapter;
[config.go:904](https://github.com/heroiclabs/nakama/blob/cab8af584947ff0d7ebee91d6c33e67d87fd3e47/server/config.go#L904)
sets the256KiB request default. PR19 must provide and fault-test a concrete
runtime/logging profile that redacts private arguments before raw logs are
persisted, including connection loss/cancellation; successful SQL catch tests
alone do not clear that activation gate.
