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
| 18 full integration | Hub [162](https://github.com/crrreatorrr/metaverse-hub/pull/162), merge `cfbc67ed48b2b67054d01e9234fe1bafd5c31b35`, preserving tested `c3d5cad` and approved client `91bd4d7` |
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
  This is correctness evidence, not browser attestation. Independent unmerged
  follow-up113 is not a dependency of the tested approved 91bd client; any later
  client-pin update requires its own A/C rerun.
- A native-OOM probe once returned exit 137 with Docker's OOMKilled flag false;
  an exact rerun reported 137/true. The original observation is retained, and a
  passing retry does not establish why the first flag differed or prove capacity.

## Work still in progress

| Stage | Reviewable work; remaining evidence |
| --- | --- |
| Independent UI follow-up | Shooter draft [113](https://github.com/crrreatorrr/sproto-shooter/pull/113), pause-key lifecycle follow-up; it does not alter PR18's approved 91bd evidence. Any later client pin needs separate A/C checks. |
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
