# Client graphics presets

On 2026-11-11 the owner requested High, Mid and Low settings for different
resolutions as the client-facing PR21 deliverable. These controls can be
implemented independently of selecting a server host or authorizing a host
benchmark. The original implementation plan remains preserved.

## Source and delivery status

Shooter [114](https://github.com/crrreatorrr/sproto-shooter/pull/114) merged
normally as `d8596be6c36f413f0fbb4d0d618d8764d1dd097c`, preserving tested source
`90f08b671927ffc91544426e3d3ee446d3732f9f`. All four exact-head Actions
workflows passed. This delivers the requested client settings; it is not a
measured FPS or server-capacity result.

| Stored `graphicsPreset` | Pause-menu label under “Graphics resolution” | Long-edge cap | Short-edge cap | Implied pixel ceiling |
| --- | --- | --- | --- | --- |
| `low` | Low — up to 720p | 1280 | 720 | 1280 × 720 |
| `mid` | Mid — up to 1080p | 1920 | 1080 | 1920 × 1080 |
| `high` | High — up to 1440p | 2560 | 1440 | 2560 × 1440 |

High is the default for older profiles and invalid values. The renderer preserves
CSS aspect ratio and fits both edges of a rotatable bounding box, including
portrait and ultrawide layouts. The scale is the minimum of native DPR, the
existing mode DPR cap, long-edge cap / longest CSS edge and short-edge cap /
shortest CSS edge. For example, Low at 1280 × 960 fits 960 × 720, and Low at
1920 × 1200 fits 1152 × 720. These are ceilings rather than a forced
resolution: output never exceeds native device-pixel ratio, and existing
campaign DPR 1.5 / PvP DPR 1 maxima remain. Portrait orientation rotates the cap
meaning; a smaller viewport can render below the named tier.

The existing local and non-economic cloud profile paths persist the setting.
It applies at initial load, cloud-profile load, pause-menu changes and live
viewport/DPR changes. Campaign, Wave and all arena creation paths use the current
setting, including practice, mock, free and wager modes. FX quality, shake and
screen FX remain separate controls.

## Exact-head validation

- [General CI](https://github.com/crrreatorrr/sproto-shooter/actions/runs/43041478727/job/130594120427):
  95 files, 832 passed and one existing network skip. Graphics policy passed four
  cases, including portrait/ultrawide, 4:3/16:10, invalid/default profiles and
  native DPR. Local gameplay passed five cases; the actual browser exercised Low
  at 1280 × 720 in a 1920 × 1080 viewport, live resize to 640 × 360 and persisted
  save/reload. Build, assets, budgets and profile checks passed with zero profile
  problems. Actual cloud/PvP browser execution is not separately claimed;
  their wiring is covered by static review and shared policy tests.
- [Canonical replay](https://github.com/crrreatorrr/sproto-shooter/actions/runs/43041478740/job/130594121204):
  20/20 passed and build artifacts were produced.
- [Reward UI](https://github.com/crrreatorrr/sproto-shooter/actions/runs/43041478838/job/130594122430):
  59/59 passed, including the full 1001-frame trace/hash `7f20ec2c`, recorded in
  78728.2ms under the unchanged 90-second bound.
- [Incremental replay](https://github.com/crrreatorrr/sproto-shooter/actions/runs/43041478899/job/130594124557):
  80/80 passed, retaining complete 9634/24000 traces and cross-runtime checkpoint
  semantics. Some Goja slices exceeded 15 seconds; this semantic proof is not a
  production 15-second throughput claim.

Earlier source attempts failed before feature tests on Ubuntu APT DNS resolution,
including two attempts at the original head. The final four-workflow bootstrap
change removed `--with-deps` while retaining browser downloads, all tests and
deadlines; it did not turn those infrastructure failures into feature passes.

The change is outside guarded simulator source paths, so no simulator vendoring
or bundle-pin update is needed. Existing 010 client and f12 benchmark evidence
retain their original identities; they are not relabeled as full 9634 or
under-load browser proof for this source.

## Scope and remaining measurements

The settings control client rendering resolution. They do not select server
worker concurrency, queue capacity, admission limits or reward delay. Server
operating limits and intended-host measurements remain unmeasured and deferred;
this client deliverable does not require waiting for them to be implemented.

No preset promises 60 FPS or establishes human-control feel on a particular
GPU/browser. The failed PR20 primary-client result, including result RPCs timing
out before headers around ten seconds with an unproven server-stage cause,
remains recorded in the [execution ledger](execution-ledger.md). Graphics presets
do not resolve that failure.

Reward rules, simulation cadence and physics, replay work-slice limits, original
session settlement authorization, and the 2 MiB batch / 64 MiB run ceilings stay
unchanged. The owner’s acceptance of server-verified legal inputs, including
bots/emulators, remains in effect and makes no official-client attestation
claim. No production deployment, public activation or hosting purchase is
authorized by this client change.
