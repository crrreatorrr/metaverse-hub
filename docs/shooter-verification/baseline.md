# Campaign verifier baseline

Inspected November 10, 2026. This is source evidence, not a production audit or capacity result.
The original handoff is in [implementation-plan.md](implementation-plan.md); open policy gates are in [decisions.md](decisions.md).

## Exact source and ownership

| Repository | Inspected main | Handoff reference |
| --- | --- | --- |
| crrreatorrr/metaverse-hub | `e38b46d79176588f4eb6b14da31d8211004e0b1c` | `ee019d183f0ef2452b132a2e66812fa1eb891631` |
| crrreatorrr/sproto-shooter | `5c86661d1cc658337cb9e888ce15df41c4b03ebc` | `57e52c37d449903fd840b9617e7ce1f918de7a92` |

Read both repositories' AGENTS.md. Use separate branches and PRs, never main pushes. Existing cloud checkouts are isolated; do not create worktrees unless requested. This task does not resume a separate Shooter session.

Open PR inventory at inspection: Shooter had none. Hub [#130](https://github.com/crrreatorrr/metaverse-hub/pull/130) changes drain RPCs/default-off Duel wagers, including main registration, flags, matchmaking, CI and migrations tests. Hub [#126](https://github.com/crrreatorrr/metaverse-hub/pull/126) adds follower pets and also touches Shooter reward constants, protocol, main registration, pin tooling, CI and load tests. Those PRs overlap future implementation: refresh ownership and main before each dependent branch. This documentation PR does not alter those files.

## Approved-artifact evidence

Both vendored pin files identify Shooter source commit `9c7a47df0d8af657dd09a57f3d4211788d1533e4`. SHA-256 was independently computed over the vendored bytes:

| Artifact | SHA-256 | Protocol / content |
| --- | --- | --- |
| Campaign `server/modules/vendor/shooter-sim.js` | `7f8e30905b5d088349937a0d4333a35cfbc409e64a239344c57af30c3a97c23c` | 1 / `cea1f88b` |
| PvP `server/modules/vendor/shooter-pvp-sim.js` | `c071cafba91eed9ed7c903498e724a4be24716944b1f440667b0cbde1a74cc89` | 2 / `b33eada6` |

Sources: [campaign pin](../../server/modules/vendor/shooter-sim.pin.json), [PvP pin](../../server/modules/vendor/shooter-pvp-sim.pin.json), [campaign guard](../../scripts/check-shooter-sim-version.mjs), [main comparison](../../scripts/shooter-main-pin.mjs).

The current guard permits Shooter main to be a descendant of the pinned commit only if no guarded source changed. Guarded paths are `src/sim/`, `src/server/`, `src/net/`, `src/data/`, `src/core/` and `scripts/build-server-sim.mjs`. An unrelated history, guarded edit or truncated compare fails closed. Do not rely on older prose saying every unrelated commit requires a re-vendor. Snapshot and incremental replay changes will require generated companion pins; never hand-edit bundles or weaken the guard. Supported legacy campaign protocol is 1; v2 upload/checkpoint/worker protocols do not exist yet. Fingerprints alone are not artifact identities.

## Economy and session invariants

[ShooterRewards](../../server/modules/src/games/shooter_rewards.ts) fixes payment at **20 Tickets**, once per account/game/canonical boss/**issuance UTC day**, for `sahil`, `obama`, `broccoli`, `glowie`, `tinubu`. Obama is one canonical boss, not two payments. Only the server settlement can mint; simulator receipts must report zero minted Tickets. Eligibility requires every boss part to have the player’s gun/splash last hit; assisted, failed and fled outcomes must not be made payable by this project. The forbidden `agent`/`glowieAgent` aliases cannot stand in for glowie. Wager policy and PvP are out of scope.

Issuance and settlement require an open, redeemed game session with `lease_until > now()`. Settlement binds owner, original session, run, boss, issuance day, digest, protocol and fingerprint. Existing SQL serializes economy changes and retains authoritative receipts. Shared Ticket credit enforces the **200 per-session** and **1000 per-account/game/UTC-day** caps. Critically, [take_ticket_credit](../../server/modules/src/schema.ts) currently charges its daily cap to **settlement-time UTC day**, while Shooter's boss bucket uses **issuance day**. The asynchronous contract must state this split explicitly; changing it requires a separate decision. No amounts/caps are changed here.

## Migrations and registration

[main.ts](../../server/modules/src/main.ts) registers legacy `shooter.run.issue` and `shooter.run.submit`. There is no durable v2 append/status/finish queue or worker gateway. [schema.ts](../../server/modules/src/schema.ts) merges numeric migrations with root-level `HubSchema.register` calls, sorts them and rejects duplicate numbers/IDs.

Relevant IDs: `0039_sproto_shooter_coop` in `games/sproto_shooter.ts`; `0040_shooter_boss_receipt` and `0048_shooter_campaign_fingerprint` in `games/shooter_rewards.ts`; `0041_coop_boss_receipt`, `0042_server_flags`, `0043_hpos10i_core_live`, `0044_pb_godmode`, `0045_coop_shooter_relics`, `0046_shooter_wager_escrow`, `0047_duel_relic_staves`. Highest observed ID is 0048, **not a reservation of 0049**. Re-enumerate current main, including root-registered modules, when PR 06 begins. Preserve applied checksums. The old fingerprint in 0040 is intentional: additive migration 0048 updates the installed SQL function.

## Known replay and persistence risks

These are code-inspection findings to cover with PR 02 regressions, not claims of production exploitation:

- Shooter `src/sim/campaign/campaign.js` keeps rewind snapshots in a module `WeakMap`. `src/server/verify.js` clones JSON state for checkpoints, which cannot serialize that side state. Fresh-process import must restore it explicitly.
- Replay resets `total` per invocation; the frame check compares against that invocation's total. `frames` in the receipt is per-call, and Hub `ShooterRuns.submit` derives ranking milliseconds from it. Whole-run cumulative limits and timing need separate accounting.
- Classification happens after replaying all supplied frames, rather than latching the first terminal tick. Batch-boundary equivalence is not established.
- `save_shooter_checkpoint` locks the run but has no expected revision/predecessor comparison. `close_shooter_run` likewise has no revision/fencing token. Row locking alone does not prevent a stale result advancing or closing a newer logical history.
- `ShooterRuns.seen` loads all account digests and closed run IDs. New ingestion should use indexed run-specific operations and bounded admission.
- Legacy protocol uses 12 raw bytes/frame, an overall 2 MiB base64-text limit and 162000 frames (45 minutes at 60 Hz). Those frames require 2592000 base64 characters before JSON/actions. Both maxima cannot be reached together. Legacy limits must remain unchanged; v2 needs an explicit independent size contract.
- CPU work currently executes in the Nakama RPC. The 15000 ms simulator CPU budget is not an isolated worker or a capacity guarantee. Do not increase it to hide failures.

## Observed checks and infrastructure limits

Earlier onboarding at Shooter `57e52c37d449903fd840b9617e7ce1f918de7a92`: lint, typecheck, build, assets and budgets passed; full local tests reported 579 passed, 5 failed, 1 skipped. Four failures were blocked Playwright downloads; one compared current built transfer bytes 4062473 with pinned 3761311. After network access changed, focused browser/Goja/PvP retry reported 10 passed and one screenshot-directory failure (`/opt/cursor/artifacts` inaccessible); matching Chromium title-screen smoke and profile check passed. These are **local historical checks of that old commit**, not current-main validation or GitHub Actions results for implementation.

For this documentation PR, validate local links, baseline paths and artifact hashes, obtain an independent invariant review, and run existing GitHub Actions after opening the PR. Do not present unrun Hub suites or CI checks as passed. The owner requested GitHub-only execution for implementation checks: do not replace Actions with local implementation benchmarks.

[CI](../../.github/workflows/ci.yml) runs lint/typecheck/unit/build, simulation pin guards, real Nakama/Postgres duplication/realtime/load/economy checks. Container definitions in `server/docker-compose.yml` and `deploy/` are examples of repository configuration, **not evidence of deployed hosts, region, capacity or cost**. Production infrastructure, production failures and capacity are unknown; no production credentials or access were requested. No implementation benchmark, migration application, deployment, public flag, hosting purchase or production credential provisioning is part of PR 00.
