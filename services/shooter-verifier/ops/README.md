# Dormant worker operations profile

This profile is an example and a test artifact. It creates no production keys,
principals, routes, services or configuration. Public verification remains gated
by the implementation plan, provenance decision and benchmark/activation review.

`compose.example.yml` starts nothing unless its explicit profile is selected.
The offline replay container has no network, a read-only root filesystem, dropped
capabilities, no new privileges, 512 MiB memory, two CPUs and 32 PIDs. Only its
private Unix socket directory is shared with the coordinator. It never mounts
credentials or the recovery journal. Node VM contexts are not a security boundary.
The networked coordinator reads a fixed 0600 credential file with exactly
`url,workerId,keyId,token,accountToken`; normal TLS certificate validation applies
outside literal loopback. No wallet, database or administrator key belongs here.

Create the example private directories as UID1000 with mode0700 and the credential
file mode0600. Keep the journal on durable private storage. `flock` allows only one
coordinator per journal. The current file and atomic temporary file are each at
most20 MiB plus4096 bytes, contain no credentials, and may contain a private
checkpoint as recovery state. Never collect them as logs or CI artifacts. A
symlink, invalid permissions, corrupt/truncated file or leftover uncertain temp
file quarantines execution. Preserve the evidence for private operator recovery;
never delete it merely to make readiness green.

The coordinator persists the claim request ID before leasing and exact result or
retry body/request ID before sending. On restart it retries only that request and
clears the journal only after an authenticated exact own-worker receipt lookup
confirms the stored operation/digest. The immutable small ACK and transient live
claim work remain distinct. Expired/stale work cannot silently lease another job.
Renewals run outside replay CPU work, do not overlap and stop after32 renewals.
SIGTERM stops new claims; a bounded40-second drain preserves uncertain evidence.
The offline daemon drains at most25 seconds. Example cgroup values are tested
resource bounds, not a measured production operating envelope.

After a durable terminal checkpoint ACK the journal can clear even while payment
is pending. An indexed server-owned metadata pointer keeps the original RESULT
request ID/digest. The coordinator periodically reads only its own bounded pages
and repairs by that proof in a separate transaction through the existing0055
settlement function. No checkpoint, amount, outcome or run selector is accepted
by repair. Key rotation within the same account/logical worker is supported.
Do not permanently retire a logical worker/account while its pending payments
remain. Restore credentials for that same identity to repair orphaned payments;
no cross-worker impersonation or proof transfer is provided. Original-session
expiry has no grace period and can produce a durable authorization denial.

The coordinator publishes only loopback `/health`, `/ready` and `/metrics` on9476,
with no Compose host port. Readiness requires a fresh approved offline manifest,
fresh authenticated server observation, scoped key/account-token expiry and the
checkpoint writer. Metrics contain fixed counters and capped approximate queue,
lag/payment/orphan observations; truncation flags are explicit. A truncated
eligibility sample is unknown, never an authoritative negative: the coordinator
probes the actual scheduler with5-second exponential backoff capped60 seconds.
These speculative small ACKs remain subject to existing finite receipt quotas.
The live-lease sample10001 exceeds the supported max_leased10000, so capacity
cannot be undercounted below its configured limit. CPU/wall/RSS are
observed separately. GC and unrelated online match latency remain null/unobserved.
There are no run/account IDs, checkpoints, inputs or credentials in metrics/logs.
A successful metrics test is not an online PvP latency or production capacity claim.

New internal read endpoints reuse the exact bounded scoped worker envelope:

- `ops`: claim scope, body{}, aggregate availability only, no durable receipt.
- `maintenance`: claim scope, body{}, existing0056 bounded16/NOWAIT reaper in a
  separate authenticated transaction, count only, no receipt; once/minute even idle.
- `receipt`: original operation scope, exact operation/requestId/requestSha256;
  own logical worker only, found/missing/conflict and small immutable ACK only.
- `pending`: result scope, body{} or exact afterCreatedAt/afterRequestId cursor;
  at most4 own proof references plus an explicit truncation/next cursor. Failed
  wallets advance through pages so later healthy references remain reachable.
- `repair`: result scope, exact resultRequestId/requestSha256; separately invokes
  existing0055 policy and financial authority, no new durable gateway ACK.

Every call charges the existing durable pre-parse account/global attempt gate;
current principal/scope/expiry are checked again in SQL under locks. Pointer rows
contain metadata only and cannot exceed retained result receipts. The64 KiB
receipt reservation is a conservative logical budget, not measured physical DB
bytes. Reads create no receipts or new pointer rows.

The Nakama filtered PID1 example is a separate required deployment boundary:
ordinary Nakama's SQL adapter can log bind arguments on driver/connection errors.
A JavaScript catch cannot remove those upstream logs. Do not activate a worker
against an unfiltered production runtime. See the filtered profile and its actual
Actions driver-fault proof; deployment review must preserve stdout/stderr piping,
file-log refusal and whole-line filtering before any log persistence. Existing
production deploy files are intentionally unchanged.

`compose.ci.yml` is the disposable integration overlay after
`server/docker-compose.yml`. It requires an explicit absolute
`SHOOTER_OPS_CI_DIRECTORY` and the profile. Its coordinator shares only Nakama's
network namespace and uses literal loopback HTTP; replay still has network none.
The fixture author must create socket/journal directories0700 ownedUID1000 and
credential JSON0600 before starting, then remove the disposable volumes privately.
Health9476 remains loopback and can be sampled through a fixed bounded Node
reader via Docker exec. Never print the credential file or journal. Applying this
CI overlay does not authorize an equivalent production cleartext route.
