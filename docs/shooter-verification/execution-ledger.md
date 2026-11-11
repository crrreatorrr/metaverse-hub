# Campaign verification execution ledger

Updated November 11, 2026. This records implementation and evidence, not launch
authorization. The [evidence map](integration-evidence.md) links each requirement
to its source, execution mode and exact scoped Actions proof. Feature tests/builds run in GitHub Actions. This work has not
deployed production services, applied production migrations, provisioned production
credentials, bought hosting or enabled public reward cohorts/flags. The original
[implementation plan](implementation-plan.md) remains preserved verbatim.

## Merged work

| Plan stage | Merged pull requests |
| --- | --- |
| 00–01 baseline/contract | Hub [133](https://github.com/crrreatorrr/metaverse-hub/pull/133), [138](https://github.com/crrreatorrr/metaverse-hub/pull/138) |
| 02 corpus | Shooter [103](https://github.com/crrreatorrr/sproto-shooter/pull/103) |
| 03 snapshots | Shooter [105](https://github.com/crrreatorrr/sproto-shooter/pull/105), Hub companion [143](https://github.com/crrreatorrr/metaverse-hub/pull/143) |
| 04 incremental replay | Shooter [106](https://github.com/crrreatorrr/sproto-shooter/pull/106), Hub companion [146](https://github.com/crrreatorrr/metaverse-hub/pull/146) |
| 05 canonical commands | Shooter [107](https://github.com/crrreatorrr/sproto-shooter/pull/107), Hub companion [149](https://github.com/crrreatorrr/metaverse-hub/pull/149) |
| 06–08 schema/ingestion/fencing | Hub [141](https://github.com/crrreatorrr/metaverse-hub/pull/141), [144](https://github.com/crrreatorrr/metaverse-hub/pull/144), [150](https://github.com/crrreatorrr/metaverse-hub/pull/150) |
| 09–10 isolated replay/scoped gateway | Hub [148](https://github.com/crrreatorrr/metaverse-hub/pull/148), [152](https://github.com/crrreatorrr/metaverse-hub/pull/152) |
| 11 atomic checkpoint commit | Hub [153](https://github.com/crrreatorrr/metaverse-hub/pull/153), merge `c693bc3f460986e8e2f5a50df3ea12a078bdbad0` |
| 12 deferred settlement | Hub [155](https://github.com/crrreatorrr/metaverse-hub/pull/155), merge `0b13b6be0897e28cc250e38cf5c920836b0f2827` |
| 13/15 client transport/lifecycle | Shooter [109](https://github.com/crrreatorrr/sproto-shooter/pull/109), [111](https://github.com/crrreatorrr/sproto-shooter/pull/111); no Game/UI activation implied |
| 14 bounded recorder | Shooter [108](https://github.com/crrreatorrr/sproto-shooter/pull/108) |
| Required issuance/finish/expiry companion | Hub [156](https://github.com/crrreatorrr/metaverse-hub/pull/156), merge `a3d64f2cf2f5807edc2c1cf682d90654278ffadc` |
| 16 actual Game/UI | Shooter [112](https://github.com/crrreatorrr/sproto-shooter/pull/112), merge `20057a4040f9b07fea5bc1102af5602b36478f29`, preserving `91bd4d7`; pause-key follow-up [113](https://github.com/crrreatorrr/sproto-shooter/pull/113), merge `424a10b670b7ed081f1bad33c71e4a77ddfea340`, preserving `01087a45`; default off |
| 17 retention/recovery | Hub [159](https://github.com/crrreatorrr/metaverse-hub/pull/159), merge `3f69eaaf3113c737ce9533efdf658547816dc9c8` |
| 18 full integration | Hub [162](https://github.com/crrreatorrr/metaverse-hub/pull/162), merge `cfbc67ed48b2b67054d01e9234fe1bafd5c31b35`, preserving tested `c3d5cad` and approved client `91bd4d7` |
| Approved client-test pin | Hub [165](https://github.com/crrreatorrr/metaverse-hub/pull/165), merge `c582e4af1cee4b8430d19a294b00418c699505a7`, preserving `325bad0`; changes only browser checkout from `91bd4d7` to approved `01087a45`, not private replay authority |
| 19 worker operations | Hub [160](https://github.com/crrreatorrr/metaverse-hub/pull/160), merge `7db01566ea5c3fb7897c4f3ed4b26edf831f00e5`, preserving `19f7a73`; default off |
| 20 reproducible benchmark tooling | Hub [161](https://github.com/crrreatorrr/metaverse-hub/pull/161), normal merge `f97679a76d8bb465825ee196c03f0d7dec512c39`, preserving tested `f12fc3ab`; CI advisory only, failed primary-client proof retained |

Hub [154](https://github.com/crrreatorrr/metaverse-hub/pull/154) preserves the two
historical 0050 migration identities. Hub [158](https://github.com/crrreatorrr/metaverse-hub/pull/158)
updates generated vendor artifacts after external PvP changes. Unrelated existing
main changes are preserved.
Hub [163](https://github.com/crrreatorrr/metaverse-hub/pull/163) corrects only
historical test-fixture reconstruction; immutable migration IDs, bodies,
checksums and economy remain unchanged.

## Current evidence and limits

- The merged UI passed all five source workflows, including 837 full-CI tests
  plus one existing network skip; the known legacy Goja expected failure remains
  labeled. Those client checks do not replace PR18 retained-service evidence or
  intended-hardware/control-feel measurements.
- The integrated payment/lifecycle checks report **65 payment-matrix cases and
  20 lifecycle cases, zero failures**, with real reporter process canaries and
  an actual selected-empty-suite failure check. Earlier workflow conclusions
  masked failures because report categories were omitted; those false-green
  claims are retracted and are not evidence.
- Retention checks report seven retention cases plus three schema cases, with
  actual PostgreSQL dumps/restores, approved replay continuation through all
  9634 Sahil frames, cleanup/commit serialization and preserved financial facts.
  Their restored SQL/external-process path does not itself prove the stronger
  second-Nakama/container/browser path required by PR18.
- The frozen corpus covers every boss and preserves all twelve inputs, including
  full 9634 Sahil and 24000 Obama. Glowie/Tinubu attempted-success fixtures fail;
  no genuine issued fled trace exists. Old Obama recorder divergences and the
  legacy whole-run Goja 24000 CPU limitation remain labeled. Bounded isolated
  incremental completion is not a claim that legacy full Goja parity was fixed.
- PR18's final combined head `c3d5cad761a92390859be9755d4450e275a79b48` passed all
  six [e2e jobs](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43001446091),
  focused checks and general verify. At merge, broad CI was still pending; this
  ledger does not claim it passed. The run uses approved client `91bd4d7`,
  preserved by Shooter main `20057a4`, and the retained05f private executable.
- The final [actual container lane](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43001446091/job/130458292570) reports:
  13 literal PASS results, including all twelve complete traces through real
  public ingress/Nakama/PostgreSQL/network coordinator/offline replay container,
  full private-checkpoint parity with retained05f, 9634-frame clear/20 Tickets and
  24000-frame incomplete/zero Tickets. The extra abandoned-empty case closed via
  idle maintenance with no owner-status request or queued work. This proves that
  lane only; other lane evidence is recorded separately below.
- The final [actual coordinator recovery lane](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43001446091/job/130458292311) reports:
  three literal PASS results. A real container was killed while its result
  response was held after durable checkpoint commit; a fresh process recovered
  the same journal request/digest/ACK. With no runnable jobs or retained journal
  CP, proof-only repair recovered a wallet transaction failure and paid once;
  original-session expiry denied payment in the second case. Active SIGTERM
  during observed offline CPU work exited normally, and a fresh coordinator
  completed all 24000 frames with retained-checkpoint parity and zero payment.
- The final [second-service restore lane](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43001446091/job/130458292770) passed.
  An actual binary database dump after 4096 verified frames restored into fresh
  PostgreSQL; a second Nakama authenticated the original owner and a fresh
  coordinator/offline daemon completed all 9634 frames. Both independently
  continued databases matched the retained checkpoint and paid one 20-Ticket
  ledger event. Pre-backup ACK identities/timestamps and migration history were
  preserved; new post-backup financial UUIDs/timestamps were compared by their
  explicit financial meaning. Pre-backup quota/wallet/ledger checks also passed
  on this exact head. No raw backup/CP or credential artifacts were uploaded.
- The final [public adversarial lane](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43001446091/job/130458292752)
  reports 26 literal PASS cases, including forged public state/seed/outcome/artifact,
  wrong identities/rebinding, gaps, exact ACK/seal retries, changed-byte conflict,
  forbidden legacy bypass and actual full 1001 failed-input verification with zero
  payment. Time, caps and lock races remain separately labeled backend evidence.
- The final [actual browser lane](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43001446091/job/130458292756) passed both cases.
  Genuine public random-seed DOM input recorded 130 ticks/hash `ac57dfcf`, wall
  16,606ms/native 62 callbacks, and matched retained05f. The labeled trusted-server
  Sahil7 case completed all 9634 frames through production Game/UI/renderer/native
  RAF/recorder/transport and isolated service, matched stateHash `3163be0c`,
  RNG/IDs/accounting and paid 20 once. Measured C wall time was 1,204,314ms (about
  20m4s), with 2433 native RAF callbacks at 640x480. CI did not meet 60Hz real-time
  wall cadence; intended-host validation/human feel remain PR21 rollout gates.
  This remains correctness evidence for the earlier 91bd client, not browser
  attestation or evidence for another client revision.
- The separate [approved 01087a45 client rerun](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43006935064/job/130476634533)
  passed at pin head `325bad081843e5a4bc0f2ec8a41b97e8c7a0c71b`, preserved by
  merged PR165. A recorded 131 public DOM ticks/hash `7c16f5b4`, wall 18,352ms.
  C completed all 9634 frames/hash `3163be0c`, retained-service RNG/IDs/accounting
  parity and paid 20 once, wall 779,031ms (about 12m59s), 2081 native RAF callbacks.
  Source PR113 merged only after its exact 01087a45 candidate passed its required
  checks; this new approved-client evidence does not erase the earlier 91bd run
  or turn either software-rendering observation into a 60Hz/capacity claim.
- A native-OOM probe once returned exit 137 with Docker's OOMKilled flag false;
  an exact rerun reported 137/true. The original observation is retained, and a
  passing retry does not establish why the first flag differed or prove capacity.

## Benchmark method and retained results

PR20's primary client-under-load method has one additional actual public DOM
campaign client (the 21st campaign identity), twenty independently authenticated
protocol actors covering the required whole source traces, and ONE shared
background cohort of 20 Hub users/10 free PvP matches. The planned abandonment is
counted only by its actual submitted/verified prefix, never its whole source
length. The DOM prefix, protocol actors, Hub users and match observations remain
separate populations; sampling overlap does not prove that twenty rendered
clients were active on every frame. It does not replace the full 9634 Game proof.

The failed 20-simultaneous-renderer stress experiment at `31489b0` is retained as
a separate manual-only experiment. It is not the primary method, not passing
client evidence and not a target-host capacity result.

One historical bounded-V8 single-burst sub-job at
`31489b032a73db1398f78228f4a19f949a41e49a` genuinely passed:
[130477959903](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43007158079/job/130477959903).
It verified all 129314 submitted frames: 19 full-source actors plus one 120-frame
planned abandonment, 7 paid receipts, 140 successful observations and 1348 PvP
metrics. This is scoped `ci_advisory` correctness/workload evidence. The other
profiles in that workflow failed; the workflow as a whole is not green.

The earlier cold/warm and sustained fixtures provisioned 32 retained-checkpoint
reservation slots despite planning 40/60 fresh runs; the current fixture-only
configuration provisions 64. Production limits, traces and replay/read budgets
are unchanged. The historical 900-second failure logs lacked the per-actor
cause/report needed to establish every individual failure's cause; do not infer
that this fixture correction explains all historical deadlines.

The c004 candidate `c0048eb88fada7278b6a027feecaf0b19f4b77f6` is retained as
failed benchmark history, not final acceptance evidence:

- [Cold/warm lifecycle](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43012073286/job/130494297996)
  completed all 40 submitted prefixes: 258628 verified frames, 38 whole sources and
  14 paid, with an observed 2022ms cold-process startup and actual warm reuse.
  The profile remained RED: 68 exhausted 60-rematch telemetry errors, five real
  5-second read deadlines and one intentional-restart metric gap. This is not a
  passing lifecycle profile or proof of cold OS/page caches.
- [Sustained](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43012073286/job/130494297887)
  hit the actual 8MiB report guard. Frozen safe failure facts account for 60 actors:
  21 paid, 31 nonpayable, three abandoned and five censored, 387942 accepted frames
  versus 366246 observed verified frames. Neither accepted frames nor nominal
  source lengths may replace the verified numerator; this profile did not pass.
- The primary-client and retry-burst profiles hit an arbitrary 10-second
  synchronization barrier after all twenty inputs had been accepted. The
  later synchronization correction does not make this historical run pass;
  acceptance alone is not a passing client/concurrency/observer measurement.

The later a594 candidate `a594ec8c962bd0e3d7c727b4c02c2b9229389708` also
remained failed, despite completing more backend work. Its immutable reports
are retained in [backend run 43021428106](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43021428106):

- Retry burst verified 129314 frames, 19 whole sources plus the planned 120-frame
  abandonment, and paid seven. Its observer recorded 224 successes from 226
  attempts, one instrumentation failure and one censored read; the profile failed.
- Cold/warm verified 258628 frames across 40 submitted prefixes/38 whole sources,
  paying 14. It failed observation checks: 437 successful reads from 442 attempts,
  four instrumentation failures and one planned-restart unavailability.
- Sustained verified all 387942 submitted frames across 60 prefixes/57 whole
  sources, paying 21. Its two instrumentation failures from 500 observation
  attempts still make this a failed profile.
- Legacy full used the unchanged 15-second replay budget: ten of twenty actors
  durably verified (16903 frames), three paid and ten hit `cpu_budget`. Segmented
  legacy verified nine whole sources/29631 frames and paid three; eight CPU-budget
  timeouts and three transport failures remain failures. Neither result proves
  cumulative ranking equivalence with v2.

The independent read/RESULT correlation does not rewrite these outcomes. A
RESULT was already known before abort for one retry-burst read, six lifecycle
reads and two sustained reads, using a proven upper bound rather than the actual
WebSocket receive timestamp. Two lifecycle read timings remain unknown, and six
lifecycle reads were proved live after abort. The proposed exact-match RESULT
cancellation must affect only a still-pending read; it cannot explain or erase
those completed live 5-second deadline failures.

The [a594 primary browser run](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43021428048)
fixed the native selector and captured actual movement/fire, 60 recorded,
submitted and accepted DOM frames, and a finish ACK. Verification then stalled
through the 900-second observation window: DOM verified zero; the twenty protocol
actors verified only 7028 frames with 18 censored actors. Coordinator observations
showed four claims, two terminal results and one verified result, followed by 53
RPC failures; the final projection had 19 sealed/two terminal runs and one leased/
three completed jobs. No OOM, PID denial or quota exhaustion was observed. The
exact gateway failure cause is unavailable; neither selector correction nor
ended-match telemetry handling explains away the stalled verification.

The final PR161 tooling head `f12fc3ab3c15fc0508be33b05d21a04974481382`
was preserved by normal merge `f97679a76d8bb465825ee196c03f0d7dec512c39`.
All five [backend profile jobs](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43026923528)
passed their harness checks. V8 retry/lifecycle/sustained accounted for 20/40/60
actors, verified every submitted frame (129314/258628/387942), covered 19/38/57
whole sources plus the explicitly counted 120-frame abandonments, and paid
7/14/21. Their 228/324/476 successful observation samples had zero instrumentation
failures; sustained also had one window-censored sample. The 8/11/13 match-end
read censors retain exact same-match RESULT proof and their original timestamps;
they are not successful live reads or retroactive removal of deadline failures.
All hard traces, including 9634 and 24000, remain unchanged.

A passing legacy comparison harness records degraded legacy workloads honestly:
full replay verified 11822 frames/six whole sources and paid two, with eight CPU
budget timeouts and six transport failures; segmented legacy verified 29631
frames/nine whole sources and paid three, with eight CPU budget timeouts and three
transport failures. Neither passing harness status nor per-segment receipt timing
proves full-source acceptance or cumulative ranking parity with v2.

The separate [f12 primary browser run](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43026923507)
FAILED and remains red. It captured 60 actual native DOM frames, movement/fire,
60 submitted/accepted frames and a finish ACK, but zero DOM verified frames.
The twenty protocol actors reached three full-source completions/25088 verified
frames with 17 censored. It recorded 520 metrics and health observations each,
zero observer errors and one window censor, and closed the browser cleanly.
The journal remained submitting: repeated result RPCs timed out before headers
at about 10.01 seconds with `gateway_unavailable`; adjacent receipt HTTP 200
reported missing while ops/pending queries were prompt. The exact server-stage
cause is unproven. No quota exhaustion, OOM or PID denial was shown. These facts
are not a successful primary-client load result or a waived CI failure.

PR20 was merged as reproducible tooling under the original criterion, “Harness
is reproducible and does not claim capacity until run on the intended hardware.”
Independent review accepted that scope. It does not establish intended-host
capacity, resolve the failed primary lane or satisfy PR21. The final method and
evidence addendum is in the [evidence map](integration-evidence.md#final-benchmark-method-and-evidence-addendum).
Earlier failed histories above remain visible. This documentation changes no
benchmark source, workflow, simulator artifact or production setting.

## Owner-requested client settings

On 2026-11-11 the owner requested High/Mid/Low graphics settings for different
resolutions as the client-facing PR21 deliverable. The [preset companion](client-graphics-presets.md)
records delivered Shooter [114](https://github.com/crrreatorrr/sproto-shooter/pull/114),
normal merge `d8596be6c36f413f0fbb4d0d618d8764d1dd097c` preserving tested
`90f08b671927ffc91544426e3d3ee446d3732f9f`: all four source workflows passed,
including four graphics-policy cases and actual local browser pause/resize/save/
reload. These client controls did not require waiting for intended-host
measurements. Server capacity and operating limits remain unmeasured/deferred;
presets do not establish 60 FPS or resolve the failed primary result RPCs.

## Policy and external gates

The original game session must be live at actual post-lock time for a new payment;
there is no 24-hour grace. The 45-minute input deadline closes admission, while
timely accepted work can finish/pay later if that original session remains live.
Observed session close/expiry is durable, and paid receipts remain final. Limits
remain 2 MiB frames text per batch and 64 MiB per run. Economy remains 20 Tickets,
one eligible canonical boss per account/game/issuance day, with the existing 200/session
and 1000/account/game/settlement-UTC-day caps.

The full broad PR163 run completed FAIL solely on the external PB assertion:
[147](https://github.com/crrreatorrr/metaverse-hub/pull/147) sets Campaign Pistol
buy 2 / sell 1, conflicting with the older generic resale≤45% assertion. Its ten
migration cases and Shooter cases passed. The owner explicitly chose to keep
buy 2 / sell 1. [166](https://github.com/crrreatorrr/metaverse-hub/pull/166), normal
merge `afc2c6d6495aedcacc6014753f173598f298dad7` preserving `160432d`, documents
and tests that exact exception without changing prices. Verify and both artifact
guards passed. Its original full [duplication job](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43025978878/job/130540663818)
at exact `160432dd9fcd068785dfecc04a37bdf4022582f4` also completed successfully:
537 passed, zero failed and three existing pending cases. The literal Campaign
Pistol exception passed; wallet 38, Shooter backend 65, lifecycle 20, retention
seven and migration ten cases had no failures or pending cases. Downstream RT,
Coop authoritative, Shooter free, both H5 and economy-audit steps succeeded.
The three pending cases remain two PB HubFault hooks (`before_rpc`/`after_commit`)
and one Hub direct-join gate; none is claimed passed. The historical PR163 failure
is retained, and this exact-head proof does not automatically validate later heads.

On 2026-11-11 the owner explicitly accepted: “Accept server-verified legal
inputs, including bots/emulators.” The [provenance product decision](decisions.md#product-decision-before-public-activation)
is fulfilled for humans, legal bots and protocol-only emulators that satisfy
server verification; it makes no official-client attestation claim.

PR21 still requires authorized intended-host benchmark execution and hosting
approval. Host, region and specifications, together with authorization to run
that benchmark, remain pending. The earlier failed primary-client report remains
recorded above.
The [rollout preparation](rollout-preparation.md) records the existing control
matrix, unset dashboard fields, activation gates and the unexecuted full operator
drill alongside the executed core CI subset below.
It implements no shadow financial policy and does not complete PR21 or PR22.
The exact-head economic proof and its three existing pending cases above remain
scoped to that run. PR22 depends on PR21. This
acceptance authorizes no production deployment, public activation, hosting
purchase or production resource limits; CI timings and code merges supply no
such authorization.

The combined **core CI** rollout drill passed at exact
`e7d4200db7ef4641e4ac5fa371fc5c4201404223`,
[run 43068973510](https://github.com/crrreatorrr/metaverse-hub/actions/runs/43068973510/job/130691406543).
Three independent actors verified their full 2,959-frame Broccoli traces
(47,344 encoded frame-text bytes per actor); baseline/live/expired credits were
20/20/0. The single fixture
proved stop-new with continued append/finish, lost-ACK recovery, uncertain durable
RESULT proof recovery after real coordinator restart, payment pause/resume with
original-session expiry denial, stable history/financial evidence after another
restart, and clean fixture cleanup with new issuance stopped. Its bounded report is
retained as `shooter-core-rollout-drill`; elapsed fixture time was 46.93 seconds.
This does not execute the full eight-step operator drill or prove active renewal,
active SIGTERM in this fixture, permanent shadow semantics, target capacity,
alert thresholds or public activation. Earlier primary/benchmark failures and
their exact-head limitations remain unchanged. See the linked preparation for
the report method and remaining gates; PR21 and PR22 remain incomplete.

The retained private executable remains source
`05f7a0a245af921fc65a99588564175c19658e38`, SHA256
`797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9`,
fingerprint `cea1f88b` (engine 1 / upload 2 / API 2 / checkpoint 2 / economy 1). Current vendor
source `7960d8525627a56ef2415ba9ff70e7ffe7784465` is a separate identity and
does not silently replace private replay authority.
