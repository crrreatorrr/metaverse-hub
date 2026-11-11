# PR19 design proposal (no deployment)

Base: latest lifecycle0056 branch (001c4fa initially), incorporating11/12 and10f512.
Own standaloneclone /tmp/shooter-ops-pr19, branchcodex/shooter-worker-operations.
0057 belongs to retention/operator author; reserve0058 for claim-scoped aggregate
availability/metrics read only. No edits to0053/0054/0055/0056 applied bodies.

1. Offline replay daemon: fixed approved service-owned artifact and ReplayPool,
   Linuxprocess limits unchanged. NodeUnixsocket protocol uses4-byte length frame,
   exactversion/id/op/request, boundedowned framebuffer, finite read/chunk count,
   sockets/queue/deadlines. Health returns only approvedmanifest/readiness and
   counters; never CP, input or raw errors. Per-container clients/inflight bounded.
   Replay children get empty explicit env apart from Node-managed IPC plumbing.
   Network:none, readonly, capdrop, no-new-privileges, CPU/memory/PID constraints
   are enforced by the example/testcontainer profile. Only sharedUnixsocket volume
   is mounted. Credential/journal volumes are absent from replaycontainer.

2. Network coordinator: one bounded in-flight job per logicalworker initially,
   GatewayClient serviceJWT+scopedtoken from readonly0600 JSONcredentialfile, no
   adminHTTP/SQL/wallet key. It polls nonmutatingops availability before claiming,
   avoiding durable idleclaim receipts. Currentkey expiry comes from authenticated
   ops result plus JWT expiry/filemetadata; missing/expired/stale observations make
   readinessfalse and stopnewclaims. Currentexactartifact comes from local daemon
   health, no request-selected module/path/URL. Crosshost gateway remainsHTTPS with
   normalcertificate checks; literal-loopbackHTTPonly isunchanged.

3. Crash journal: fixedonecurrentfile plus oneatomictemporaryfile, eachbounded
   to20MiB+smallmetadata;0600/fsync/rename+directoryfsync. ClaimrequestID is durable
   BEFORE firstclaim call. A resultID and EXACT immutable resultbody are durable
   BEFORE firstresult POST; lostresponse/restart resends identical body+ID. Private
   resultCP may live in this boundedprivate journal (no credentials), because
   recomputation can yield a different timeoutboundary and cannot safely reuse an
   already-sent resultID. Journalvolume is separate from offline replay and logs;
   it never accumulates oneCP perrequest/run. Corruption quarantines readiness,
   never prints payload or deletes uncertain evidence. Clarify this interpretation
   of 'no CP/secret logs': CP is permitted in bounded private recoveryjournal,
   neverlogs. This boundedprivate recovery-state choice was approved; credentials and rawlogs remain excluded.

4. Renewal/drain: nonoverlappingperiodicrenewals on the coordinator eventloop,
   while CPUreplay executes remotely overUnixsocket. Derive interval from actual
   remaininglease withfinite configured min/max and at most32renewals/attempt.
   No unbounded taskspawn. SIGTERM stopsclaims immediately, allows at mostone
   in-flight result/renewal drain within fixedbudget; unacknowledged journal stays
   durable forrestart. Lease/fence/revision remainHubauthority. Afterpartial or
   staleproof, journalclears only after a durable/explicitly terminal operational
   acknowledgment; uncertainnetwork/capacity/auth failures retain exactrequest.
   Need11/12 ACK contract confirmation to distinguish those cases robustly.

5.0058workerops: `shooter.internal.ops` is an exactsmallbearerenvelope +body{},
   existingclaimscope grants ONLY this nonmutatingaggregate view. Durable preparse
   account/global rategate, currentprincipal/scope/expiry checkedunderrowlocks and
   afterboundedquery. No receipt, CP, rawinputs, IDs or operator mutations. Probe
   eligibleunplannedruns as well as queuedjobs (08lazyplanning); capscans and mark
   allcappedaggregate values approximate/truncated. Return eligible bool, queue
   depth/age, accepted-verified lag, pendingpayment count, currentauth expiry,
   serverasof/querywall measurement and writer/support readiness. DB/PvP latency
   notactually observed remainsnull/unmeasured. Operator0057scope is NOT granted.

6. Concrete logging boundary: separate exampleNakama image with NodePID1 wrapper
   spawning fixed/nakama/nakama with stdout/stderr PIPED. Force logger.stdout=true,
   logger.file='', logger.format=json AFTER any suppliedflags; reject unsafe log
   file/config overrides. No rawchildstream reaches Dockerstdout or files. Bounded
   fixedlinebuffer; oversizedline discardedWHOLE, unknown/nonJSON messages become
   constantcategories. Even validJSON emits only fixedallowlisted categories,
   enumlevel, currentwrapper timestamp and counters; query/args/error/stack/msg
   arbitrarycontents never emitted. Child/process errors are constantcategories.
   Wrapper forwardsSIGTERM, boundedstop+kill, no plaintextcredentialprinting.
   Profile is not installed into proddeploy files.

7. Actions proof: unitfaults for framedIPC/tinychunks/oversize/unknownkeys/journal
   crashes/signaldrain/stalehealth/redactor multiline/huge CP lines. Actual separate
   containers demonstrate Unixonly communication, offline TCPfailure, readonly
   homewrite failure, resourcekill/restart and credentialabsence. Realephemeral
   Nakama/Postgres with FILTEREDPID1 image: blockresult SQL onreceiptrow/trigger,
   terminateits DBbackend while actualprivateCPmarker is a bindarg, then assert
   filteredcontainerlogs containno marker/query/args/rawerror and aconstantdrop
   counter/event ispresent. Neveruploadrawlogs. Health/metrics/docs explicitly
   distinguish tests from productioncapacity/placement. No paidinfra, startup,
   productioncredentials, routes or flags are configured.

## Approved financial recovery refinement

The0058reservation also covers a small server-derived own-worker terminal-proof
pointer index: original immutable RESULT worker/requestID/op/SHA, keyed by
worker/run/terminalRevision, no CP or inputs. Receipt INSERT/run UPDATE triggers
and one-time backfill maintain ready from actual pending/fullverified server facts.
Bounded indexed own-only reads plus exact stored-proof repair reference permit
calling the existing0055settlement helper in a SEPARATE transaction; no0055body
change, arbitraryamount/runselector, crossworkertransfer or new paymentauthority.
The fullCPjournal clears after durable verification proof; financial pending state
survives coordinator restart on the server. Same logicalworker/account credentials
must not be permanently retired while their payments remain pending. A capped
approximate orphan metric and runbook expose that operational obligation.

Publication status: this initial draft publishes the approved design and migration
reservation only. Runtime implementation is work in progress and not claimed here.
Actual correctness, container isolation and driver-fault log proofs must run in
GitHub Actions before the feature PR is marked ready. No production configuration,
credential, service startup, host purchase or public activation is authorized.
