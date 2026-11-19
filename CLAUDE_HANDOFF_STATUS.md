# Handoff status: metaverse-hub (optimization pass)

Branch `claude/happy-pasteur-0dhfzp`. Handoff: `CLAUDE_HANDOFF_OPTIMIZATION.md`; brief: `CLAUDE_SESSION_BRIEF.md`.
Draft PR #196 (opened by the orchestrating session). No deploy, no production change. Status per item: done (sha), partial, skipped, blocked.

## Phase 0 (handoff §1)

| Item | Status | Notes |
|---|---|---|
| §1.1.1 precompress glb/gltf/bin/fonts | done f103ecd | `deploy/scripts/lib.sh` `precompress_tree` adds `*.glb *.gltf *.bin *.ttf *.otf *.fnt` (wasm/json/svg were already there). Already-compressed formats (webp, png, jpg, mp3, ogg, woff2, ktx2) stay skipped. |
| §1.1.2 `precompressed br gzip` on `{$DOMAIN}` | done f103ecd | All three hub `file_server` blocks, with the play host's 206 workaround (`status 200`, `-Content-Range`). `encode gzip` stays as fallback. |
| §1.1.3 immutable hashed chunks on play | done f103ecd, 2a3c833 | `@hashed` also matches Vite code chunks `assets/<name>-<8 char hash>.js|mjs|css|wasm` (immutable). Hash-looking media under `assets/` gets `max-age=3600, stale-while-revalidate=86400` instead: a game's `public/` can put hand-named files there (`boss-intro_01.mp3`) that an 8-character tail cannot tell from a Vite hash (review finding). An 8-letter all-lowercase tail is never taken for a hash. `?v=<24 hex>` (Coop-Battle) is immutable except on HTML/manifest. |
| §1.1.3 `/world/*` caching | done f103ecd | Chose the non-versioned option: `public, max-age=3600, stale-while-revalidate=86400` (handoff suggested 86400 + 7 d SWR; an hour keeps a stale GLB after a deploy to at most one hour plus one background revalidation). Release-versioned `/world/<hash>/` left as a follow-up. |
| §1.1.4 `index.html`, `asset-manifest.json` no-cache | done f103ecd | Both hosts. |
| §1.1 acceptance test | done f103ecd | `scripts/caddy-headers.test.mjs` (in `npm test`) serves a sample tree with the deploy Caddyfile and checks Content-Encoding and Cache-Control on 14 paths; skips when no caddy binary. Ran here with Caddy v2.10.2 release binary (`CADDY_BIN`). |
| §1.2 `granted_items` from `reportEvent` | done f735804 | Test in `packages/hub-sdk/test/sdk.test.ts` (repo uses tsx scripts, not Vitest). |
| §1.2 cached IndexedDB handle | done f735804 | One handle per page, dropped on close/versionchange/open failure; test counts `indexedDB.open` (fake-indexeddb). |
| §1.2 keepalive save | done f735804 | `writeSave(data, { keepalive: true })` and `ProgressStore.flushKeepalive()`; tests in sdk/progress tests. Games must call it (nobu, HPOS10I) after re-vendor. |
| §1.2 `isRelicId` | done f735804 | It already accepted all 8 canonical Relics. Unknown well-formed ids are now kept in `InitResult.otherRelics` / `EventResult.grantedOther` with one warning, instead of being stripped; `relics` stays typed. |
| SDK version bump + IIFE | done f735804 | 0.8.0 → 0.9.0, `SOURCE.pin.json` rebuilt (`node scripts/build-sdk-iife.mjs --write`). |
| §1.3 `render(measure = false)` | done 7de1f60 | The plaza still measures once for `data-plaza-draws`. |
| §1.3 `preserveDrawingBuffer: false` | done 7de1f60 | `installFeedback({ beforeCapture: () => world.render() })` draws a frame in the capture task. Live screenshot check in the plaza needs a signed-in session (Nakama), so it was checked by code path only (the SDK calls `beforeCapture` then copies the canvas synchronously). |

## Phase 1 (handoff §2)

| Item | Status | Notes |
|---|---|---|
| §2.1.1 session work concurrent with world build | done f2f4844 | Gate entry, device auth and `profile.get` start before `createEngine`; `openSession` uses that result and falls back to a fresh attempt if it failed. The `/ws` connect still follows the session (it needs the plaza's remote world). |
| §2.1.2 `verse.board` off the critical path | done f2f4844 | Done in the plaza's `onSession` (the board paints when it arrives, one retry after 15 s), so the session resolves and the plaza socket opens without it. |
| §2.1.3 preconnect to `play.<domain>` | done f2f4844 | Injected at boot for each cross-origin game URL. Without `crossorigin`: a portal is a navigation, which uses the credentialed connection pool (the handoff's `crossorigin` would warm the wrong pool). |
| §2.2.1 `Promise.all` in the five builders | done c8b3a57 | castle, whiteHouse, greenHill, club, kennel. Placement maths and child order unchanged; the Kennel bones and Green Hill palms still wait for the size they are placed from. Aerial screenshot before/after matches (PSNR 39.4 dB over the plaza centre; the difference is animated sparkles). |
| §2.2.2 Bar LOD1 first, LOD0 streamed | done c8b3a57 | `club-interior.ts` and `neon-sign.ts` build on LOD1 and add LOD0 at distance 0 when it lands. LOD1 keeps its punctual lights until LOD0 arrives and takes them over (1875177, review finding), so the room is lit from the start and stays lit if LOD0 fails. |
| §2.2.2 GLB re-compression | partial c8b3a57 | `club-interior.glb` 6,677,432 → 4,823,760 B (textures to WebP q88, same resolution), `I9-neon-sign.glb` 4,346,112 → 1,161,720 B (4096 → 2048 px, WebP q90). Meshopt kept in lossless quantize mode; bounds, primitive counts and lights unchanged. Texture PSNR at display size ≥ 38.6 dB (alpha-weighted), Bar screenshot PSNR 56.1 dB over the room. The handoff's < 2.5 MB / < 1 MB targets would need 1024 px atlases or decimation, which would visibly soften the room's art atlas and mural; not done. |
| §2.2.3 pet LOD0 only for the local pet | done c8b3a57 | `createPetFollower(..., { nearOnly: true })` for the local pet (it never leaves LOD0 range). Remote pets keep both levels. |
| §2.3.1 fire `portal.enter` at dwell start | skipped | `portal.enter` is rate limited (`claim_portal_rate`) and opens a game session (`open_portal`), so firing it speculatively when a player brushes a gate would spend the rate limit and could close a live session. The RPC already runs during the wipe. |
| §2.3.2 `ENTER_FADE_MS`, `READY_BEAT_MS` | done c8b3a57 | Fade wait 700 → 400 ms, not 200-250: the wipe's CSS fade is 380 ms, so leaving earlier would freeze a half-faded frame. Ready beat 350 → 0 ms on `#from=` returns. The 1 s gate dwell is a design rule ("a shorter visit does not enter") and is kept. |
| §2.3.3 stale copy | done c8b3a57 | Checked in the game repos (Sproto-Arcade `aa0f6bab` `levels.js`: 14 levels, 12 boss encounters plus Rooftop Breakaway and Codebreak Ascent; Coop-Battle README: up to four players, 13 stages). Now "twelve giant bosses" and "Up to four players across thirteen stages". |

## Phase 2 (handoff §3)

| Item | Status | Notes |
|---|---|---|
| §3.1.1 no storage write on the read path | done b233841 | `ownedSet` materializes the `pets/owned` snapshot only on RPC paths (`profile.get`, `loadout.set_hub`); the plaza match never writes it. |
| §3.1.2 batched pet lookup in `matchJoin` | done b233841 | `HubPets.activePets`: one `item_owned` query and one storage read for the whole join, reusing the join's batched relic read. |
| §3.1.3 no DB I/O for `OP_PROFILE` in `matchLoop` | done b233841 | `loadout.set_hub` signals every hub shard (`{op:"pet"}`) and the shard sends the pet as a roster upd. The loop's 30 s staggered relic refresh (batched, a quarter of the slots) is unchanged. `follower-pets.test.ts` was adapted: its relic mock now answers the batched query's shape, and the recall is checked through the signal. |
| §3.2.1 AOI culling for `OP_DELTA` | done fda3f25 | 50 m grid cells per zone: the 3x3 neighbourhood every tick (≥ 50 m, the client rigs only 30 m), farther players at 2 Hz with only their latest row; a receiver that walks into a mover's neighbourhood after its last move gets that row on the next far tick (ed5914b, review finding, regression test). Message format unchanged. 100 spread movers: 24,438 → 9,834 delta bytes/s per client (`server/test/unit/hub_match.test.ts`). |
| §3.2.2 measure RAM per VM, raise `js_max_count` | blocked | Needs Nakama (`server/docker-compose.yml`): the Docker daemon is not running here and starting it was not permitted. `js_max_count` stays 64; not raised without a measurement, per the brief. |
| §3.2.3 lazy sims in vendored bundles | skipped | Not part of the bundle sync below: the vendored bytes are the game repos' builds, so laziness is a change in each game's build script. Shooter's and PB's bundles are already wrapped lazily. |
| §3.3.1 `sproto_arcade_coop` | done 995b08a | Built to the protocol v1 contract (below). 13 test groups in `server/test/games/arcade_coop.test.ts`. No migration: rewards use the existing `arcade_clear` reason and `arcade.boss_defeated` rule (0025). |
| §3.3.2 Fighter online duels | done 70f2f20 (docs) | `claude/sproto-online-duels` is gone and `main` already has `sproto_duel` (matchmaking, signaling, server-run sim, escrow). The Fighter handoff's READY barrier is peer to peer; the server's stall rule only forfeits a seat while the other streams, so a barrier needs no server change. Added TURN notes to `docs/sproto-online-duels.md` (no infra change). |
| §3.3.3 sproto-duel guest input hashing | blocked | sproto-duel's `OP.LOG` (opcode 25) carries range-coded per-seat records of what the sim read (move/held/press/facing/aim), not the guest's `OP.INPUT` frames, so comparing them needs the Duel sim's log decoder (`duel-sim.server.js`). It is not vendored in this repo and the brief forbids vendor changes in this pass; this server also ignores opcode 25 today. Needs: vendor `duel-sim.server.js`, then ingest `OP.LOG` chunks (≤ 64 KB) and compare the decoded guest stream with the relayed INPUTs, tolerant of hosts that send no log. |
| §3.3.4 `pb_world` HostIO parity | done 0df6104 | `loadProfile`, `getRelics`, `reportEvent` (session.event path), `submitScore` (score.submit checks, PB boards only). Optional in the typings, so the vendored bundle that lacks them is unaffected; `server/test/games/pb_hostio.test.ts`. |
| §3.3.5 `shooter.version` flags | done 6ea6f12 | `isGuest` (no email) and `wagerEligible` (wager flag on and not a guest). |

### Arcade co-op protocol v1: contract notes

No deviations. Choices where the contract leaves room, all backward compatible:
- `OP_START.levelIndex` is `level - 1` (the client's 0-based `LEVELS` index; `level` in the RPCs and in `OP_RESULT` is 1-14).
- Tick rate 30 Hz. `OP_INPUT` frames: 1-32 per message, each 0-1023; a resent tick is relayed but counted once for AFK.
- `OP_RESULT.god` must be `false` to pay; a missing field counts as god mode.
- Only seats still present when the match settles are paid (a dropped seat is not).
- A clear also fails when the last checked hash disagreed. A seat-0 `OP_SNAPSHOT` does not clear that; only a later matching hash does (24fe144, review finding).
- AFK: non-zero frames ≥ 0.5 × the distinct ticks actually received from that seat (a reconnect gap does not count against it).
- A rejoining seat gets `OP_START` again (and `OP_GO` in play); its next hash usually desyncs and the snapshot path brings it level.
- `OP_OUTCOME.rewards.tickets` is 20, or 0 when a cap held the credit back (`game.earn_tickets` does not report a partial amount).
- Lobby: a leave frees the seat; idle lobbies close after 10 min, a load that does not finish after 2 min (`OP_CANCEL`).
- Ticket and Relic keys: `arcade-coop:<sha256(matchId)[0:16]>:L<level>:clear` / `:coin`, per account.

## Phase 3 (handoff §4)

| Item | Status | Notes |
|---|---|---|
| §4.3.1 wire `play_lease.ts` | partial 3dbd82d | Compiled, `session.claim` / `session.heartbeat` registered, `session_superseded` mapped, migration `0074_play_lease` (reserved in `docs/migration-allocations.md`; no open PRs hold a number) with surfaces widened from 5 ids to every game id. Remaining (would change live behaviour): write RPCs calling `RequireLease`, and the SDK claiming and heartbeating a lease. |
| §4.3.2 `event_seq` and minimum session age | done f96b632 (flag off) | `trust_event_seq` makes `seq` required on `session.event` (monotonicity is already enforced in `game.apply_event` when sent). `trust_min_session` refuses `tickets.earn` within 20 s of the session opening. Both off until a `game.server_flags` row turns them on: current clients do not all send `seq`. |
| §4.3.3 `godMode` and Tickets | done f96b632 (flag off) | `trust_godmode_tickets` refuses `tickets.earn` with `godMode: true`. Relic policy left as is: Relics are granted in god mode by design in several games (for example Sproto Arcade's README: god-mode wins count for the Coin); changing that is a product decision for the owner. |
| §4.3.4 character allowlist | done f96b632 | `HubMatch.CHARACTERS` (26 ids) equals `apps/hub/src/config.ts` `CHARACTERS`, checked by `hub_match.test.ts`; an unknown id keeps the player's look. A new plaza character now needs the server list updated in the same change (the test fails otherwise). |
| §4.2.1 SDK sub-paths | done 61cb8a9 | `/core`, `/realtime` (no mock), `/mock`, `/feedback` (modern-screenshot was already lazy), `/progress`, `/pb-shop`. Root entry and IIFE unchanged (pin bytes `8eb127e0…` identical). Minified ESM: root 127,311 B, core 44,510, realtime 18,452, mock 28,417, feedback 50,438, progress 4,645, pb-shop 11,968. The global is `HubSDK` in the IIFE already; renaming the games' own globals is a game-repo change. |
| §4.2.2 `effects` | done 61cb8a9 (decision) | Kept: `portal.enter` resolves it from owned Relics (`effects.ts`, live). Only the M3 loadout (`loadout.ts`, slot choice) is unwired; documented in `docs/CONTRACTS.md` §6. Wiring it needs its own migration and an SDK call. |
| §4.2.3 `/shared-assets/sproto/` mount | done 72e12d8, 2a3c833 | Play host, `/srv/play/shared-assets/sproto/current`, precompressed, 1 h + SWR for everything (hand-picked names, so nothing immutable), CORS/CORP open; covered by `scripts/caddy-headers.test.mjs`. No deploy script fills it and no game uses it yet. |
| §4.1 shared replay-verifier pool | skipped | `services/shooter-verifier` is a deliberately dormant, staged design (its README: PR10 must authenticate worker claims, PR11 must validate and atomically commit progress; no payment authority). Generalizing it to other sims and wiring it into Nakama and `deploy/compose.yml` touches settlement and production infra and could not be made solid in this pass. Server-issued challenge seeds for single-player runs need client changes in each game. Suggested order: finish PR10/PR11 for the Shooter, then add `duel-sim.server.js` and `arcade-sim.server.js` as further approved artifacts. |

## Phase 3 bundle sync (pinned server-sim bundles)

Every bundle was built here from the named merged commit and its sha256 checked before vendoring.
`packages/hub-sdk` did not change, so no game needs an SDK re-sync for this.

| Game | Built from | Vendored | Status |
|---|---|---|---|
| Sproto-Coop-Battle. | `4f142a78` (main, #43), `node scripts/build-server-sim.mjs` | `coop-sim.js` sha256 `c4292eb9…af5d`, content `3fddedd1…` (was `b77aebc8…` / `9c1841f6…` from `3dad4f38`) | done 0a7f618. Migration `0075_coop_wire_fingerprint` re-pins `game.settle_coop_clear` (0073 replay-guard pattern). `CoopProto` and `CoopRewards.FINGERPRINT` updated, `FINGERPRINT_0073` kept. The seed-3 golden (`fdff232f…`, tick 10593) is unchanged: the bundle changes only the net layer. |
| Coop wire savings (hub) | contract "Optional: input batches and snapshot deltas" | `coop_match.ts`, `coop_protocol.ts` | done 0a7f618. `coop.version` returns `features: { inputBatch, snapshotDelta }`, each true only when the bundle exports `splitInputBatch` / `snapshotDelta`. A batch goes through `splitInputBatch` and each item through the single-input path (seq, 60/s rate in `acceptInput`, owner, frame window; an item keeps the 768 B single-input cap, the batch the 2048 B payload cap). Items count toward the 16-per-tick message cap. Sockets that join with `snapDelta: '1'` get deltas; a full envelope on join, resume, start, stage change, and at least every `snapshotKeyframeLoops` (60) loops. The delta base is a JSON copy of what was sent (the envelope shares objects with the live sim). `coop.metrics` adds `deltaBytes` / `deltaCount`. `server/test/games/coop_wire.test.ts`: deltas rebuild every full envelope exactly over 150 loops; a batch gets exactly the rejects and seq that the same items get as separate messages. |
| peoples-bitcoin | `a2eb7fa8` (#47), `node scripts/build-sim-bundle.mjs` | `pb-sim.js` sha256 `1d770c57…926d`, 836 KB, `SIM_VERSION` `0d77b686c8efbfd5` → `49699e030161ede6` | done 00179ce. HostIO signatures match `src/server/host.ts`. `pb_hostio.test.ts` now also runs a real `pb_world` join: `loadProfile` reaches WELCOME's `hub`, and a finished tutorial reports `pb.quest_complete` once. Goja `PbSim.benchWorld(100, 30, walk)` (goja `d6eaa50d`, go 1.26, 4-core Xeon 2.3 GHz), ms per 600 ms tick, old → new: walk 0: 42.1 → 40.0; walk 0.3: 99.0 → 99.1; walk 1: 147.7 → 134.7. |
| sproto-shooter | `3cf28f37` (main, after #155/#156); bundles bake `ccaa836d` | `shooter-sim.js` `bcfdba3e…`, `shooter-pvp-sim.js` `528ec266…` | done 85bd123. Byte-identical to the `1fd01820` bundles apart from the baked commit (fingerprints `73c6eb0f` / `e749d2fd`, Arena golden 180 `da423456`). Done with `node scripts/revendor-shooter-pvp.mjs ccaa836d…`, then the rest of the #191 pattern: migration `0076_shooter_campaign_boot_split` moves the live verification allowlist (0070 replay-note pattern), the verifier `MANIFEST` and service `APPROVED` move, the retained artifact is under `services/shooter-verifier/artifacts/bcfdba3e…/`, fixtures move, and the CI workflows check out the replay corpus at `ccaa836d` and the browser client at `3cf28f37` (the old client `0d604fe8` names the old bundle, which the new allowlist refuses). 0076 was not in the brief; it is reserved in `docs/migration-allocations.md` (no other open PR holds a number). |
| Sproto-Arcade | `9b6ec23b` (main, #38 merged), `node tools/build-server-sim.mjs` | none | not vendored. The fresh build matches the committed `dist/arcade-sim.server.js`: sha256 `2be4bbaa…1b64`, `ARCADE_SIM_VERSION` `9249bbf1047466f3` (was `3bc257947b2e427e`), with `ArcadeSim.coop`. The hub has never vendored it and nothing here pins its version: `sproto_arcade_coop` is a lockstep relay that compares the clients' hashes. Vendoring it would make every Nakama match VM evaluate an unused 1.2 MB script (the build appends every `vendor/*.js`). Recorded in `docs/CONTRACTS.md`. Vendoring it belongs with a server-side consumer (the replay verifier, §4.1). |
| sproto-duel, Sproto-Fighter | | | no action (`duel-sim.server.js` `e41e427f…` unchanged and not vendored; Fighter `SIM_VERSION` `21168f77260c4c3c` unchanged, `check-sproto-sim-version.mjs` passes). |

## Checks

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass, run with `GOTOOLCHAIN=auto` (the container has Go 1.24.7 and `server/test/games/shooter_runs.test.ts` needs ≥ 1.26). That file's goja `cpu_budget` check is timing-sensitive on this 4-core VM: it failed once in the full run after Phase 1 and passed on the rerun alone; the code it covers is untouched. |
| `VITE_NAKAMA_SERVER_KEY=ci-build-placeholder-not-a-server-key npm run build` | pass (same placeholder CI uses) |
| `npm test` after Phase 2 (05d2f3b) | pass, all 41 server test files (`GOTOOLCHAIN=auto`, `CADDY_BIN` set) |
| Final, after the review fixes: lint, typecheck, build, `npm test` | all pass (43 server test files; `GOTOOLCHAIN=auto`, `CADDY_BIN` set) |
| `npm run test:dup` | blocked: the Docker daemon is not running in this container and starting it was not permitted, so Nakama from `server/docker-compose.yml` cannot come up. |
| `caddy validate --config deploy/Caddyfile` | The raw file needs `/etc/caddy/cloudflare-proxies.caddy` and the origin cert on disk, so it cannot validate outside the VPS. The test validates and runs it with only those lines and the site addresses swapped. |
| After the bundle sync (85bd123 and the status commit): `npm run lint`, `npm run typecheck`, `npm test`, build | all pass. `npm test`: 44 server test files, `GOTOOLCHAIN=auto` (goja parity ran) and `CADDY_BIN` set to the checksum-verified Caddy v2.10.2 release (`caddy-headers` ran) |
| `npm run test:pg` | pass, 6 files, on a disposable local Postgres 16.15 cluster (includes the 0072→0075 and 0073→0075 upgrade and replay cases) |
| `check-coop-sim-version.mjs` | pass (Coop main `c4292eb9…` matches pin `4f142a78`) |
| `check-sproto-sim-version.mjs` | pass (Fighter `21168f77260c4c3c`) |
| `check-shooter-sim-version.mjs`, `check-shooter-pvp-sim-version.mjs` | local checks pass. The GitHub API answers 403 to anonymous calls from this container, so the upstream half was run with a test-only `fetch` shim serving those API calls from a local clone of sproto-shooter (main `3cf28f37`, confirmed by `git ls-remote`). Both PASS: main is ahead of `ccaa836d` with no sim-source changes, and `SUPPORTED_MANIFEST` names `ccaa836d` / `bcfdba3e…`. CI runs them for real with its token. |
| `services/shooter-verifier` `npm test` | 31 pass, 2 skipped, 0 fail |
| `shooter-integration-corpus.test.ts`, `shooter_integration_fixture_contract.test.ts` | pass against the corpus at `ccaa836d` |
| `npm run test:dup` | blocked: `sudo service docker start` failed (`ulimit: error setting limit (Operation not permitted)`), tried once as the brief says |

## Measurements

Plaza cold boot, `node scripts/measure-plaza-boot.mjs` against `npm run preview -w @metaverse/hub` of the build, headless Chromium, cache disabled. Without `--guest` it stops at the gate (plaza ready behind it, buildings not yet loaded):

| Build | ready ms | requests | transfer bytes | GLB requests | GLB bytes |
|---|---|---|---|---|---|
| after Phase 0 (7de1f60) | 948 | 47 | 1,882,273 | 8 | 795,778 |
| after Phase 1 (c8b3a57) | 1,010 | 46 | 1,881,404 | 7 | 795,778 |

With `--guest` (Nakama's HTTP API mocked in the page, "Continue as guest", socket refused so the plaza runs solo), until every building is placed (`data-plaza-draws`):

| Run | Phase 0 | Phase 1 |
|---|---|---|
| plaza, localhost: ms / requests / bytes | 32,021 / 123 / 11,156,825 | 23,195 / 119 / 10,894,747 |
| plaza, `--slow` (80 ms RTT, 20 Mbit/s): ms | 33,906 | 25,808 |
| return to the Bar (`#from=sproto-arcade`): ms / requests / bytes | 52,951 / 188 / 26,278,352 | 38,960 / 184 / 20,978,210 |

Times are SwiftShader in a 4-core VM and dominated by CPU; compare them only with each other.

`apps/hub/dist`: Phase 0 92,616,208 bytes, Phase 1 87,579,497 bytes (220 files both).

## Cross-repo follow-ups

- **Bundle sync: done** (section "Phase 3 bundle sync" below).

- Sproto-Arcade: the co-op client builds against `sproto_arcade_coop` as described in the contract notes above (`levelIndex = level - 1`, `god: false` required). The client must not also send `tickets.earn arcade_clear` or `arcade.boss_defeated` for a co-op clear; the server pays it.
- peoples-bitcoin: `pb-sim.js` re-vendored at `a2eb7fa8` (below); the PB client must be the same commit (`sim_mismatch` otherwise), so play.<domain> needs PB main deployed with this hub.
- Sproto-Coop-Battle: clients from `4f142a78` see `features` in `coop.version` and use batches and deltas; older clients are unaffected. Clients older than `4f142a78` are refused with `version_mismatch` (fingerprint), as with every Coop re-pin.
- sproto-shooter: the Shooter page must be main `3cf28f37` (or a descendant with the same `SUPPORTED_MANIFEST`) once this deploys: migration 0076 moves the verification allowlist to `ccaa836d` / `bcfdba3e…`.
- sproto-shooter: read `isGuest` / `wagerEligible` from `shooter.version` instead of the socket probe.
- sproto-duel: guest input hashing waits on vendoring `duel-sim.server.js` here (see §3.3.3).

- Operators: the three `trust_*` flags are off; turn each on per game once its clients send `seq`, stop sending `godMode: true` with earns, and never earn in the first 20 s.
- Re-sync `@metaverse/hub-sdk` 0.9.0 (after this branch merges) into every game: hpos10i, nobu, peoples-bitcoin, sproto-duel, sproto-shooter (`node scripts/vendor-sdk.mjs` from the hub); Sproto-Fighter and Sproto-Arcade use their own vendor scripts; Sproto-Coop-Battle loads the IIFE (`HubSDK`, pin in `packages/hub-sdk/SOURCE.pin.json`); HPOS10I pins SDK line numbers in `tools/qa/originality_allow.txt`, which will need updating. Not re-vendored in this pass, per the brief.
- nobu and HPOS10I: call `store.flushKeepalive()` before `exitToHub()` once on 0.9.0.

## Review

`/code-review` (medium) over the full diff against `main` reported 9 findings. Fixed: the co-op snapshot clearing a failed hash check (24fe144), AOI far rows skipping a receiver that arrived late (ed5914b), the Bar opening without lights (1875177), year-long immutable caching of possibly hand-named media and shared assets (2a3c833), the arcade registrations sitting in the Coop Battle block (ae46be5), the IndexedDB retry leaking a handle on errors other than InvalidStateError (1976e45), AFK counting reconnect gaps (24fe144), and the `gameOf` doc comment placement (ae46be5). Not changed: with `render(measure = false)` the `?debug` draw-call overlay in a production build shows the one-time plaza sample rather than a live count (dev builds still measure every frame); left as is because measuring every frame is the double render this pass removes.

## Proposed repo-hygiene deletions

None yet.
