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
| 16 actual Game/UI | Shooter [112](https://github.com/crrreatorrr/sproto-shooter/pull/112), merge `20057a4040f9b07fea5bc1102af5602b36478f29`, preserving `91bd4d7`; default off |
| 17 retention/recovery | Hub [159](https://github.com/crrreatorrr/metaverse-hub/pull/159), merge `3f69eaaf3113c737ce9533efdf658547816dc9c8` |
| 19 worker operations | Hub [160](https://github.com/crrreatorrr/metaverse-hub/pull/160), merge `7db01566ea5c3fb7897c4f3ed4b26edf831f00e5`, preserving `19f7a73`; default off |

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
- PR18's first actual container lane passed at `44d0a39`, Actions
  [42989051535](https://github.com/crrreatorrr/metaverse-hub/actions/runs/42989051535):
  13 literal PASS results, including all twelve complete traces through real
  public ingress/Nakama/PostgreSQL/network coordinator/offline replay container,
  full private-checkpoint parity with retained05f, 9634-frame clear/20 Tickets and
  24000-frame incomplete/zero Tickets. The extra abandoned-empty case closed via
  idle maintenance with no owner-status request or queued work. This proves that
  lane only; other lane evidence is recorded separately below.
- PR18's actual coordinator recovery lane passed at `4874274`, job
  [130425860361](https://github.com/crrreatorrr/metaverse-hub/actions/runs/42991693016/job/130425860361):
  three literal PASS results. A real container was killed while its result
  response was held after durable checkpoint commit; a fresh process recovered
  the same journal request/digest/ACK. With no runnable jobs or retained journal
  CP, proof-only repair recovered a wallet transaction failure and paid once;
  original-session expiry denied payment in the second case. Active SIGTERM
  during observed offline CPU work exited normally, and a fresh coordinator
  completed all 24000 frames with retained-checkpoint parity and zero payment.
- PR18's second-service restore lane passed at `3537364`, job
  [130428218376](https://github.com/crrreatorrr/metaverse-hub/actions/runs/42992408179/job/130428218376).
  An actual binary database dump after 4096 verified frames restored into fresh
  PostgreSQL; a second Nakama authenticated the original owner and a fresh
  coordinator/offline daemon completed all 9634 frames. Both independently
  continued databases matched the retained checkpoint and paid one 20-Ticket
  ledger event. Pre-backup ACK identities/timestamps and migration history were
  preserved; new post-backup financial UUIDs/timestamps were compared by their
  explicit financial meaning. Later additions broaden the pre-backup quota and
  wallet row checks and still require an exact-head rerun. No raw backup/CP or
  credential artifacts were uploaded.
- PR18's actual browser lane passed at `8a01b6c`, job
  [130434059347](https://github.com/crrreatorrr/metaverse-hub/actions/runs/42994190792/job/130434059347).
  Genuine public random-seed DOM input recorded 127 ticks and matched retained05f.
  The labeled trusted-server Sahil7 case completed all 9634 frames through the
  production Game/UI/renderer/native RAF/recorder/transport and isolated service,
  matched stateHash `3163be0c`, RNG/IDs/accounting and paid 20 once. Measured wall
  time was 1,038,834ms (about 17m19s), not 161 seconds or a 60Hz/human-feel claim.
  CI did not meet real-time wall cadence; intended-host validation remains a
  PR21 rollout gate.
  The final approved client revision and combined reviewed head must rerun;
  this passing sub-job does not hide the public fixture failure in that workflow.
- A native-OOM probe once returned exit 137 with Docker's OOMKilled flag false;
  an exact rerun reported 137/true. The original observation is retained, and a
  passing retry is not a claim that the startup-event race or capacity is solved.

## Work still in progress

| Stage | Reviewable work; remaining evidence |
| --- | --- |
| 18 full integration | Hub draft [162](https://github.com/crrreatorrr/metaverse-hub/pull/162), [integration design](integration-design.md). Full-corpus container, actual crash/drain/payment-repair, second-Nakama restore and actual A/C browser lanes have scoped passing evidence above. The corrected 26-case public-adversarial fixture, final client revision/review and exact-head combined reruns remain gates. Full PR18 completion is not claimed. |
| 20 benchmarks | Hub draft [161](https://github.com/crrreatorrr/metaverse-hub/pull/161). Method/schema and workload tooling; CI runs are advisory correctness/workload evidence, not intended-host capacity. |

## Policy and external gates

The original game session must be live at actual post-lock time for a new payment;
there is no 24-hour grace. The 45-minute input deadline closes admission, while
timely accepted work can finish/pay later if that original session remains live.
Observed session close/expiry is durable, and paid receipts remain final. Limits
remain 2 MiB frames text per batch and 64 MiB per run. Economy remains 20 Tickets,
one eligible canonical boss per account/game/issuance day, with the existing 200/session
and 1000/account/game/settlement-UTC-day caps.

The broad suite has an unresolved external PB assertion: main [147](https://github.com/crrreatorrr/metaverse-hub/pull/147)
sets Campaign Pistol buy 2 / sell 1, conflicting with an older generic resale≤45%
assertion. It has been reported separately; it is not a passing broad suite and
this feature does not silently alter that policy or weaken its test.

PR21 still requires intended-hardware measurements, hosting approval and an
explicit browser-provenance product decision. Legal protocol-only emulators are
accepted by design; this is not official-browser attestation. PR22 depends on 21.
No production resource limits, public activation or paid infrastructure decision
is inferred from CI timings or from merging code.

The retained private executable remains source
`05f7a0a245af921fc65a99588564175c19658e38`, SHA256
`797029721efe6124b718d84349cd255cd52529d3105b2da1d33e97da8d734aa9`,
fingerprint `cea1f88b` (engine 1 / upload 2 / API 2 / checkpoint 2 / economy 1). Current vendor
source `7960d8525627a56ef2415ba9ff70e7ffe7784465` is a separate identity and
does not silently replace private replay authority.
