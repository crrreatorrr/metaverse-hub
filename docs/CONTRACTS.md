# Cross-repo contracts

This page indexes what the hub and the eight games depend on each other for. It lists:

- the numbered contracts C1–C14 that code comments cite
- what each kind of change forces in other repos
- the migration id ranges
- the games and their server bundles
- names that are easy to mix up

It was checked against `main` of all nine repos on 2026-11-08. When code and this page disagree, the code wins: fix this page in the same PR.

## 1. Contracts C1–C14

The numbers come from the frozen "CONTRACT" section of the hub's realtime plan. That plan is not in this repo. [realtime.md](realtime.md) restates the rules without the numbers. The meanings below are taken from the comments that cite them. Every file path is in metaverse-hub unless a repo is named.

| # | Contract | Owner | Key files (where it is cited) |
|---|---|---|---|
| C1 | **Ids.** Game ids (`ctx.vars.game`, matchmaker `properties.game`, label `game`), match module names and RPC names. RPC ids added since the realtime contract are prefixed by their owner (`hub.`, `chat.`, `sproto.`, `pb.`, `coop.`, `shooter.`); older ones such as `profile.get`, `portal.enter` and `tickets.*` have no prefix ([realtime.md](realtime.md#ids)). | hub | `server/modules/src/hub_games.ts:6`, `games/pb_rpcs.ts:1`, `packages/hub-sdk/src/types.ts`; sproto-duel `src/net/protocol.ts:9` |
| C2 | **Unknown; cited nowhere.** Guess: file ownership, where game agents do not edit `tsconfig.json`, `append-vendor.mjs`, `package.json`, `nakama.d.ts`, `sproto_nakama.d.ts`, `schema.ts` or `rpcs.ts` ([realtime.md](realtime.md#adding-a-games-server-code)). | hub | none |
| C3 | **Build order and typings.** Game files in `server/modules/src/games/` compile after the hub files. `vendor/*.js` bundles are appended in alphabetical order. Extra Nakama typings go in `games/<game>_nakama.d.ts` by interface merging only. | hub | `server/modules/append-vendor.mjs:3`, `games/pb_nakama.d.ts:1` |
| C4 | **Game registry and migrations.** `HubGames.register({ game, matchmaker })` routes the one matchmaker hook and the RT hooks by game. `HubSchema.register` adds migrations inside the game's id range (§3). | hub | `hub_games.ts:1`, `main.ts:146`, `rt_hooks.ts:3`, `schema.ts:3345`, `games/sproto_arcade.ts:8`, `server/test/dup/migrations.ts:129`, `server/test/unit/scaffold.test.ts:82`, `docs/m6-server-prep.md:7` |
| C5 | **Registrations in `InitModule`.** A game adds `registerMatch` / `registerRpc` calls only between its `// >>> game:` markers in `main.ts`. Every handler is a top-level named function, because Nakama finds handlers by global name. | hub | `main.ts:259`, `games/pb_world.ts:327` |
| C6 | **Server-paid Tickets.** Matches credit Tickets only through `HubEconomy` with `srv_*` reasons and sealed, deterministic idempotency keys. `tickets.earn` rejects `srv_*`. `sproto_wins` is written by the server only. | hub | `server_economy.ts:1`, `rpcs.ts:598`, `packages/hub-sdk/test/sdk.test.ts:293` |
| C7 | **Labels and placement.** An authoritative label is JSON with `game` and `kind`. `HubShards.place` picks the least-full open instance. A new match shows in `matchList` about 1 s after `matchCreate`. | hub | `shards.ts:2`, `hub_rpcs.ts:2`, `games/pb_world.ts:1`, `games/pb_rpcs.ts:5`, `server/test/games/sproto_arena.test.ts:153`; sproto-duel `src/net/protocol.ts:245` |
| C8 | **Opcodes are per match.** Each match owns its whole opcode space. | hub | `docs/games/sproto-arena.md:39` |
| C9 | **SDK realtime API.** `realtimeFromSdk(sdk)` and `MatchHandle` (`joinMatch`, `joinViaRpc`, `addMatchmaker`, `rpc`). Game transports are adapters over `MatchHandle`. | hub (`packages/hub-sdk`) | peoples-bitcoin `src/net/hubTransport.ts:1`; sproto-duel `src/net/HubLobby.ts:2`, `src/net/transport.ts:196`; nobu `tests/sdk-vendor.test.js:113` |
| C10 | **Unknown; cited nowhere.** Guess: session scopes (`ctx.vars` `hub` vs `game`, [realtime.md](realtime.md#scopes)), the one rule section no other number covers. | hub | none |
| C11 | **Offline module harness.** `server/test/unit/harness.ts` runs `InitModule` in `node:vm` against a fake `nk`. Game agents add `server/test/games/*.test.ts`. | hub | `server/test/unit/harness.ts:1` |
| C12 | **goja runtime limits.** `localcachePut` takes scalars only. Each match VM evaluates the whole `index.js`, so vendor bundles build content lazily, on first use. | hub | `chat_guard.ts:151`, `games/pb_world.ts:233`; peoples-bitcoin `scripts/build-sim-bundle.mjs:10`, `src/server/host.ts:194` |
| C13 | **Public boards and the NOBU trial rules.** Gear-free trials that are always eligible, per-layout variants, integer ms, floors and ceiling, one submit per variant per 5 s. | hub | `leaderboard.ts:6`, `schema.ts:1828`, `rpcs.ts:581`, `docs/m3-server-prep.md:5`, `docs/realtime.md:168`, `packages/hub-sdk/src/createHubSdk.ts:326`, `packages/hub-sdk/src/types.ts:251`; nobu `src/config/trials.js:6`, `tests/trials-bounds.test.js:37` |
| C14 | **Plaza chat moderation.** `HubChat` RT before-hooks (validation, rate limit, mute, filter), `game.chat_mute` and `game.chat_report`. | hub | `chat_guard.ts:1`, `schema.ts:1857` |

`C3` and `C4` also appear in Sproto-Coop-Battle. docs and in this repo's Coop files (`games/coop_protocol.ts:7`, `games/coop_sim.d.ts:1`). Those are **Coop's own phase labels**, not these contracts (see §5).

## 2. Change matrix

### `packages/hub-sdk` changes → re-sync all 8 games

Every game keeps its own vendored copy in `vendor/hub-sdk`, which `VENDOR.md` describes. SDK changes are additive only: new fields and methods are optional, so old copies keep working. Release order: merge here first, then re-vendor from hub `main`, one game per PR.

In this repo:

- `npm run build:sdk-iife` refreshes `packages/hub-sdk/SOURCE.pin.json`. `npm test` runs `build-sdk-iife.mjs --check`.
- Bump the version in the root `README.md` and `packages/hub-sdk/README.md`.

Then in each game: `npm run vendor:sdk -- <game-repo>` (`scripts/vendor-sdk.mjs`). It copies `dist/`, the IIFE (global `HubSDK`), `README.md`, `package.json` and `SOURCE.pin.json`, and rewrites the header of `VENDOR.md`.

| Game | Extra steps after the vendor script |
|---|---|
| HPOS10I | `tools/qa/originality_allow.txt` pins the SDK lines that name another game's id (denylist term #425). Re-pin the moved line numbers, then run `tools/qa/originality_scan.sh .`. |
| NOBU | none |
| The People's Bitcoin | `tests/sdk-hash.test.ts` pins the SDK version and a sha256 over the vendored files. Update both. |
| Sproto Duel | none |
| Sproto Fighter | Not the vendor script. Run `npm run pack:sdk` here, unpack the tarball's `package/` into `vendor/hub-sdk`, delete `*.map`, copy `packages/hub-sdk/src` into `vendor/hub-sdk/src`, run `npm run build:hub-sdk` in Fighter, then update the commit in `VENDOR.md`. |
| Sproto Arcade | Not the vendor script. Run Arcade's own `node tools/vendor-hub-sdk.mjs <path-to-metaverse-hub>`. It builds one IIFE, `vendor/hub-sdk/hub-sdk.iife.js`, with global **`HubSdk`**, for `legacy.html`. |
| Sproto Shooter | the vendor script. The game imports the ESM build. Keep `VENDOR.md` and `SOURCE.pin.json` together. |
| Sproto Coop Battle | the vendor script. The game loads the IIFE (global `HubSDK`). `scripts/build.mjs` refuses a copy whose version or hash differs from `SOURCE.pin.json`, so update `scripts/build.mjs` and `docs/coop-hub.md` too. |

Game ids, Relic ids and events are additive too. An older SDK drops ids it does not know, so it hides newer Relics.

### Game simulation changes → rebuild, vendor, pin, check

When a hosted game's simulation changes:

1. Rebuild the bundle in the game repo and merge it there first.
2. Copy the bundle (and its pin) into `server/modules/vendor/`.
3. Update the constants the match compares against.
4. Run the hub's check script.

| Bundle (hub file) | Game | What changes the version | Rebuild in the game | Hub pin and check |
|---|---|---|---|---|
| `pb-sim.js` (global `PbSim`, `PB_SIM_VERSION`) | The People's Bitcoin | `scripts/simHash.mjs`: the first 16 hex of sha256 over every `.ts` and `.json` file under `src/sim`, `src/server`, `src/config`, `src/data` and `src/net/protocol.ts`, comments included | `npm run build:sim -- --out ../metaverse-hub/server/modules/vendor/pb-sim.js` | No pin file and no check script yet. The version is in the bundle header, `pb.worlds` reports it, and the world refuses a HELLO whose `sim` differs (peoples-bitcoin `src/server/host.ts:739`). |
| `sproto-sim.js` (global `SprotoSim`, `SPROTO_SIM_VERSION`) | Sproto Fighter | `scripts/build-sim-bundle.mjs:19-26`: sha256 of the esbuild output of `src/net/serverEntry.ts` and everything it imports (most of `src/sim`, plus `src/net/*`). Renames and file moves count. Comments and whitespace do not (`legalComments: 'none'`). | `node scripts/build-sim-bundle.mjs --out <hub>/server/modules/vendor/sproto-sim.js`. It also rewrites `src/net/simVersion.ts`, and Fighter's `--check` fails while that file is stale. | `server/modules/vendor/sproto-sim.pin.json` (`fighterCommit`, `simVersion`); `node scripts/check-sproto-sim-version.mjs` (workflow `sproto-sim-version.yml`: push, PR, daily) |
| `shooter-sim.js` (global `SprotoShooterSim`) | Sproto Shooter (campaign verifier) | **Every Shooter commit.** The bundle bakes in `git rev-parse HEAD`. The hub check passes when Shooter `main` is the pinned commit, or a descendant that changes no sim source (`src/sim/`, `src/server/`, `src/net/`, `src/data/`, `src/core/`, `scripts/build-server-sim.mjs`; `scripts/shooter-main-pin.mjs`). The content fingerprint `9ec1c6ea` (`src/data/serverManifest.js` `contentFingerprint(1)`: bosses, encounters, guns, qualities, manufacturers, parts, elements, spells, tuning) changes only with that content. | `npm run build:server-sim` (`build/shooter-sim.js` plus its pin) | `server/modules/vendor/shooter-sim.pin.json`, plus the `ShooterRewards` constants in `games/shooter_rewards.ts`; `node scripts/check-shooter-sim-version.mjs` (in `ci.yml`) |
| `shooter-pvp-sim.js` (global `SprotoShooterPvp`) | Sproto Shooter (Free 1v1, `sproto_shooter_free` match) | The commit baked in (sha256 changes every commit). PvP content fingerprint `f5949631` (`src/sim/pvp/rules.js`), loadout hash `9eb7cd63`, golden state hash `ce272de1` (`scriptedMatch(7, 180)`). Inputs: `src/sim/pvp/*`, `src/net/{inputCodec,protocol}.js` and the shared modules they import. | `npm run build:server-sim` (`build/shooter-pvp-sim.js` plus its pin) | `server/modules/vendor/shooter-pvp-sim.pin.json`, plus the `ShooterProto` constants in `games/shooter_protocol.ts`; `node scripts/check-shooter-pvp-sim-version.mjs` (in `ci.yml`), with the same Shooter `main` rule |
| `coop-sim.js` (globals `Sim`, `SproAI`, `CoopProtocol`, `MANIFEST`) | Sproto Coop Battle | Any byte of `public/js/{manifest,sim,ai,net-protocol}.js` changes the per-file and bundle sha256. `contentSha256` changes only when `CoopProtocol.contentManifest` output changes. The 40 goldens in `tests/fixtures/sim-goldens.json` guard behaviour. | `npm run build:server-sim` (`build/coop-sim.js`, `build/coop-sim.pin.json`) | `server/modules/vendor/coop-sim.pin.json`, plus the `CoopProto` constants in `games/coop_protocol.ts`; `node scripts/check-coop-sim-version.mjs` (in `ci.yml` and `coop-sim-version.yml`: push, PR, daily). It compares with Coop `main`. |

Bundles the hub does **not** host yet. Each game keeps its own version check:

| Bundle (game repo) | Game | What changes the version | Game-side guard |
|---|---|---|---|
| `dist/duel-sim.server.js` (`DuelSim`, `DUEL_SIM_VERSION`) | Sproto Duel | The first 16 hex of sha256 over the esbuild body of `src/sim-core/server.ts`: `src/sim-core` and the whole `CONFIG` it imports | `npm run check:server-sim`, 23 goldens in `tests/golden/` |
| `dist/arcade-sim.server.js` (`ArcadeSim`, `ARCADE_SIM_VERSION`) | Sproto Arcade | The first 16 hex of sha256 over the bundle body. `tools/build-server-sim.mjs` extracts it from `game.js` and the shared classic scripts in `legacy.html` load order (`density-attacks.js`, `phase-powerups.js`, `sprite-hitboxes.js`, `levels.js`, `arena-effects.js`, `codebreak.js`) plus `runtime/story/*` | `node tools/build-server-sim.mjs --check` (fails when the bundle or `runtime/story/sim-version.js` is stale), `qa/golden/story-*.json` |

Sproto Duel's online 1v1 is hosted, but as a relay and referee (`games/sproto_arena.ts`) that does not run `DuelSim`. Its contract is `NET_VERSION` `"2"`, which must equal `sproto-duel/src/net/protocol.ts`.

## 3. Migration id ranges

`schema.ts` (`MIGRATIONS`) and game files (`HubSchema.register`) share one numbered sequence. The runner refuses an unapplied id below the highest recorded id, so PRs merge and deploy in id order. Migrations are forward-only and additive. The source of truth is the comment at `server/modules/src/schema.ts:3344-3364`.

| Ids | Owner | Registered by | Used |
|---|---|---|---|
| 0001–0010 | hub base | `schema.ts` | 0001–0003, 0005–0010 (0004 reserved, never used) |
| 0011–0012 | hub (C4 range) | `schema.ts` | `0011_ranked_scores`, `0012_chat_moderation` |
| 0013–0019 | peoples-bitcoin | `games/pb_*.ts` | none yet |
| 0020–0024 | sproto (Sproto Duel) | `games/sproto_arena.ts` | `0020_sproto_pvp` |
| 0025–0029 | sproto-arcade | `games/sproto_arcade.ts` | `0025_sproto_arcade` |
| 0030–0035, 0037 | hub, above every reserved range | `schema.ts` | `0030_m6_item_grants` … `0035_hub_v_coin`, `0037_hub_life_medal` |
| 0036 | reserved for NOBU treats | none | unused |
| 0038 | proposed by an unmerged Shooter patch | none | unused, do not take |
| 0039 | sproto-shooter and sproto-coop-battle | `games/sproto_shooter.ts` | `0039_sproto_shooter_coop` |
| 0040 | sproto-shooter | `games/shooter_rewards.ts` | `0040_shooter_boss_receipt` |
| 0041 | sproto-coop-battle | `games/coop_rewards.ts` | `0041_coop_boss_receipt` |
| 0042 | hub | `schema.ts` | `0042_server_flags` (`game.server_flags`, read by `src/flags.ts`) |
| 0043 | hub | `schema.ts` | `0043_hpos10i_core_live` (takes the HPOS10I Core off the 0033 hold) |
| 0044 | peoples-bitcoin (owner godmode) | `games/pb_godmode.ts` | `0044_pb_godmode` (`game.godmode_user`, `game.godmode_topup`, the `godmode` ledger kind) |
| 0045+ | next free | | none; check open PRs before taking an id |

The game ranges (0013–0029) predate the runner's ordering rule. A game that needs a new migration now takes the next id above the highest recorded one, as 0039–0044 did.

## 4. The games

| Game | Game id | Hub entry (slug) | Repo | Server bundle | Hosted on the hub |
|---|---|---|---|---|---|
| HPOS10I | `hpos10i` | ring, Green Hill Zone (`hpos10i`) | crrreatorrr/HPOS10I | none | no game match; boards and Relics through the SDK |
| NOBU: Saviour Dog | `nobu` | ring, The Kennel (`nobu`) | crrreatorrr/nobu | none | no game match; trial boards (C13) |
| The People's Bitcoin | `peoples-bitcoin` | ring, The White House (`peoples-bitcoin`) | crrreatorrr/peoples-bitcoin | `pb-sim.js` | **yes**: `pb_world` match (100-player worlds), `pb.worlds` |
| Sproto Duel | `sproto` | ring, The Castle (`sproto-duel`) | crrreatorrr/sproto-duel | `duel-sim.server.js` (not vendored) | relay and referee only: `sproto_arena` match, `sproto.room_*` RPCs |
| Sproto Shooter | `sproto-shooter` | ring, The Range (`sproto-shooter`) | crrreatorrr/sproto-shooter | `shooter-sim.js`; `shooter-pvp-sim.js` | **yes**: campaign verifier (`shooter.run.issue` / `shooter.run.submit`) and the `sproto_shooter_free` match (authoritative free 1v1, no Tickets), `shooter.version`, `shooter.room_*`, `shooter.queue_cancel`, `shooter.resume`, `shooter.metrics` |
| Sproto Fighter | `sproto-fighter` | Bar cabinet (`sproto-fighter`) | crrreatorrr/Sproto-Fighter | `sproto-sim.js` | **yes**: `sproto_duel` match (online 1v1 with replay verification and wagers) |
| Sproto Arcade | `sproto-arcade` | Bar cabinet (`sproto-arcade`); the page with `#t=` is `legacy.html` | crrreatorrr/Sproto-Arcade | `arcade-sim.server.js` (not vendored) | no |
| Sproto Coop Battle | `sproto-coop-battle` | Bar cabinet (`sproto-coop-battle`) | crrreatorrr/Sproto-Coop-Battle. | `coop-sim.js` | **yes**: `sproto_coop` match (banked six-seat play), `coop.*` RPCs |

Portal pages are resolved in `apps/hub/src/games.ts`. The rings and cabinet choices are in `apps/hub/src/realms/plaza/config.ts`. `scripts/fetch-game-web.mjs` pulls the dev builds.

## 5. Naming traps

- **`sproto_duel.ts` is Sproto Fighter.** `server/modules/src/sproto_duel.ts` registers the `sproto_duel` match, which is Sproto Fighter's online 1v1.
- **The `SprotoDuel` namespace is Sproto Fighter too.** It is defined in `sproto_duel.ts`.
- **`sproto.dev_replay` is a Fighter RPC.** It is registered at `main.ts:230` and handled by `SprotoDuel.rpcReplay` in `sproto_duel.ts`. Every other `sproto.*` RPC (`sproto.room_create`, `sproto.room_join`, `sproto.online_count`, …) belongs to Sproto Duel.
- **`sproto_arena.ts` is Sproto Duel.** `server/modules/src/games/sproto_arena.ts` (match `sproto_arena`, game id `sproto`) is Sproto Duel's online duel.
- **Sproto Fighter's in-game title is "Sproto Arena".** Its `AGENTS.md` says so; it is not the `sproto_arena` match.
- **Sproto Duel's game id is `sproto`.** Its slug and repo are `sproto-duel`, but `sproto-duel` is never a game id.
- **SDK globals differ by one letter.** The hub's IIFE (Shooter, Coop) sets `HubSDK`. Arcade's own build sets `HubSdk`. `installHubSdk()` sets `window.hubSdk` for HPOS10I's JavaScriptBridge.
- **Arcade's hub mode lives in `legacy.html`.** It holds the hub link and story mode. `index.html` is the Machine Trials prototype, and it redirects any `#t=` ticket to `legacy.html`.
- **The Coop repo name ends in a dot; the game id does not.** The repo is `Sproto-Coop-Battle.` and the game id is `sproto-coop-battle`.
- **Labels that look like contract numbers but are not:**
  - Coop's phases C0–C5 (`docs/coop-*.md` there; `coop_protocol.ts:7` "C4 wire contract", `coop_sim.d.ts:1` "C3 server bundle")
  - hub phases H0, H1, H2-C, H3-C
  - Shooter phases S0–S5 and the plan's S1–S12 items
  - Shooter's `docs/codex/C-*.md` specs
  - HPOS10I QA ids such as `PHY-C2`
  - plaza model names such as `C1-mountain`
- **HPOS10I's copy of `docs/higgsfield-workflow-guide.md` differs on purpose.** One table row leaves out The People's Bitcoin, because HPOS10I's originality scan bans the word "bitcoin" (term #425). The owner chose to keep this difference (2026-11-09). When you sync the guide, skip that line in HPOS10I rather than adding an allowlist exception.
