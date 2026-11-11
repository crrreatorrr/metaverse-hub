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

Server-owned `game.shooter_verification_principal` binds account UUID, worker ID,
key ID, SHA-256 of `shooter-worker-token-v1\n` plus a cryptographically random
32-byte base64url token, explicit scopes, not-before, expiry and revocation.
Only its hash is stored; raw tokens never enter SQL or logs. Dedicated account
allowlist lookup precedes large JSON parsing. After envelope validation, a cheap
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

Request digest is SHA256(operation + newline + stable sorted-key JSON body),
excluding credential/request ID. Request IDs are namespaced by logical worker ID, independently of rotating key/account IDs; the original issuing account/key remain immutable audit fields. A currently authorized replacement key for that same worker can recover the original receipt after old-key revocation. Identical authorized request IDs return the
original immutable receipt; conflicting operation/body rejects. Claim and its
full server-owned private work acknowledgment are stored **in the same SQL
transaction**, so a lost response cannot claim another job. The projection uses
legacy canonical issuance, immutable accepted full public batch/digest, exact
retained manifest and authoritative checkpoint. It never reads a client snapshot.
A missing original issuance/manifest/predecessor yields operational pending,
rolling back the attempted claim.

Stored full acknowledgments may retain a16MiB checkpoint and batch. Each receipt
reserves a conservative **20MiB** globally and per principal before mutation,
regardless of actual acknowledgment size; SQL checks its actual JSONB UTF8 text
size before commit. Explicit finite count **and byte** limits must all exist to
enable the gateway. Reservations are not measured physical database/RAM usage or
hosting capacity. Even renewals and pending responses consume a receipt slot;
new issuance/benchmarks must account for this deliberately conservative tradeoff.
At capacity new operations return pending without deleting evidence. No receipt,
input, checkpoint or ledger garbage collection is introduced here.

The saved claim, fence and checkpoint are historical and can become stale.
The Node client renews the **same exact fence** before executing a saved claim;
it never substitutes a newer checkpoint or silently claims a different job.
PR11 must recheck current fence/revision again at result commit. Workers receive
one immutable planned range, initial revision, mutable predecessor revision and
continuation, plus the original full-batch digest. Partial work does not invent
new public batches, acknowledgments or payout authority. Terminal-tail permission
must use the terminal accepted high-water added by PR11; if unavailable, terminal
work projection fails closed. Current accepted counters are not an alternative.

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
are refused. No insecure TLS option exists. No production URL/configuration is
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
