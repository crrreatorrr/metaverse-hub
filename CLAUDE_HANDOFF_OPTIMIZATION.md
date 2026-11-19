# Claude Code Implementation Handoff — `metaverse-hub`

**Branch:** `claude/architecture-load-optimization-handoff`  
**Scope:** Central hub load-time optimization (Caddy edge caching/Brotli, plaza 3D boot & Bar waterfalls, render double-pass fix), Nakama Goja hot-path & scalability fixes, `@metaverse/hub-sdk` v0.9 bug fixes & modularization, multi-game Node/V8 replay verifier promotion, and cross-game trust-boundary hardening.

---

## 0. Context & Cross-Repo Invariants

`metaverse-hub` is the central orchestration layer for all 8 interconnected portal games (`hpos10i`, `nobu`, `peoples-bitcoin`, `sproto` / `sproto-duel`, `sproto-shooter`, `sproto-fighter`, `sproto-arcade`, `sproto-coop-battle`).

**Hard Rules (`AGENTS.md`):**
- Do **not** run production deploys or commit real keys.
- Before picking any new SQL migration number in `server/modules/src/schema.ts` or `server/modules/src/games/*.ts`, inspect `docs/migration-allocations.md` and open GitHub PRs (unmerged reservations count).
- Whenever `packages/hub-sdk/` changes, bump its version, rebuild ESM + IIFE (`scripts/build-sdk-iife.mjs`), and explicitly list which game repos need `scripts/vendor-sdk.mjs` re-sync (and note `Sproto-Fighter` / `Sproto-Arcade` use custom vendor scripts, and `HPOS10I` pins SDK line numbers in `tools/qa/originality_allow.txt`).
- Never push directly to `main`; open a PR after running all checks.

---

## 1. P0 — Immediate High-Impact Wins (Edge Caching, SDK Bug, Render Double-Pass)

### 1.1 Fix Caddy Precompression & Immutable Caching for Hub `/world/*` and All 8 Games
- **Files:** `deploy/Caddyfile` (lines `34–48`, `80–126`), `deploy/scripts/lib.sh` (lines `53–67`), `deploy/scripts/deploy-hub.sh`, `deploy/scripts/deploy-game.sh`
- **Current Problem:**
  1. `deploy-hub.sh` runs `precompress_tree` to generate `.br` and `.gz` files, **but `{$DOMAIN}` in `deploy/Caddyfile:80-126` omits `precompressed br gzip` from `file_server`** (only `play.{$DOMAIN}` has it) and only runs dynamic `encode gzip` (no Brotli).
  2. `precompress_tree` (`deploy/scripts/lib.sh:64-66`) skips `*.glb` files, even though Meshopt-encoded GLBs compress an additional ~35–45% with gzip/Brotli (e.g., `wizard.glb`: 396 KB → 257 KB gzip).
  3. On `{$DOMAIN}`, all **87 MB of `/world/*`** (GLBs, `basis_transcoder.wasm`, textures) fall outside `/assets/*` and receive **`Cache-Control: public, max-age=300` (5 minutes)**. Any player spending >5 minutes in a portal game forces browser cache revalidation across dozens of GLBs upon returning to `/hub/`.
  4. On `play.{$DOMAIN}`, `@hashed` (`deploy/Caddyfile:47`) only matches `^(/<slug>)?/index\.[A-Za-z0-9_-]+\.(wasm|pck|js)$`. All Vite `/assets/*.js`, GLBs, WebPs, and sprite sheets across all 8 games fall back to **`max-age=300`**.
- **Exact Changes:**
  1. In `deploy/scripts/lib.sh:64-66`, include `*.glb` (and `*.gltf`, `*.wasm`, `*.json`, `*.svg`, `*.ttf`, `*.fnt`) in `precompress_tree` (skip already-compressed `.webp`, `.jpg`, `.png`, `.mp3`, `.ogg`, `.woff2`, `.gz`).
  2. In `deploy/Caddyfile` under `{$DOMAIN}`, add `precompressed br gzip` to all `file_server` blocks (matching `play.{$DOMAIN}`).
  3. Add immutable cache headers for content-hashed assets on **both** hosts:
     - On `play.{$DOMAIN}`, expand `@hashed` to match Vite hashed chunks (`^/[a-z0-9-]+/assets/.*-[A-Za-z0-9_-]{8,}\.(js|css|wasm|png|webp|jpg|glb|mp3|ogg|woff2)$`) AND `?v=<24-hex>` cache-busted assets (used by `Sproto-Coop-Battle`), setting `Cache-Control: public, max-age=31536000, immutable`.
     - For `/world/*` on `{$DOMAIN}` (and unhashed game asset paths), either version the `/world/` URL prefix per release (e.g., `/world/<release-hash>/...` rewritten in Caddy or built via `VITE_WORLD_PREFIX`) with `max-age=31536000, immutable`, OR serve with `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` + strong ETags until release-versioned paths are wired.
  4. Keep `index.html` and `asset-manifest.json` at `Cache-Control: no-cache` so deploys take effect immediately.
- **Acceptance Criteria:** `caddy validate --config deploy/Caddyfile` succeeds; curl/integration test confirms `Content-Encoding: br` on `.js`/`.glb`/`.wasm` from `{$DOMAIN}` and `immutable` caching on hashed game chunks from `play.{$DOMAIN}`.

### 1.2 Fix `packages/hub-sdk/src/live.ts` Dropping `granted_items`
- **File:** `packages/hub-sdk/src/live.ts:618-623` (and verify `packages/hub-sdk/src/types.ts:168`)
- **Current Problem:** `session.event` returns `granted_items` (e.g., cosmetic pets granted by `game.item_rule`), and `EventResult` declares `granted_items?: string[]`, **but `reportEvent()` only copies `answer.granted` and `answer.tickets` onto `out`**, silently dropping `granted_items`.
- **Exact Changes:**
  1. Copy `granted_items` (filtered to valid non-empty strings) from `answer` onto `out` in `reportEvent()`.
  2. Add a Vitest unit test in `packages/hub-sdk/` asserting `reportEvent()` returns `{ granted, tickets, granted_items }`.
  3. While in `packages/hub-sdk/src/live.ts`:
     - Cache the opened `IDBDatabase` handle for `hub-outbox` instead of opening/closing IndexedDB on every single read/write (`live.ts:110-121`).
     - Support `keepalive: true` on `save.put` (or add a dedicated `flushKeepalive()` method on `createProgressStore`) so `nobu` and `HPOS10I` stop losing pending cloud saves on `exitToHub()`.
     - Ensure `isRelicId` (`live.ts:68`) accepts all 8 canonical Relics (and logs/passes unknown future relic IDs instead of silently stripping them if a game's SDK lags a hub release).

### 1.3 Fix `engine.render(measure = true)` Double-Render Footgun & Global `preserveDrawingBuffer`
- **Files:** `apps/hub/src/core/engine.ts:31, 162-173`, `apps/hub/src/feedback/` (wherever screenshot capture runs)
- **Current Problem:**
  1. `engine.render(measure = true)` defaults `measure` to `true`, causing a **full redundant `renderer.render(scene, camera)` pass before `composer.render()`**. While `apps/hub/src/realms/plaza/content.ts:473` overrides `render()`, `apps/hub/src/realms/sandbox/index.ts` and any new realm silently double-render every frame in production.
  2. `WebGLRenderer` sets `preserveDrawingBuffer: true` (`engine.ts:31`), disabling GPU swap-chain buffer-flip optimizations globally solely for rare feedback screenshots.
- **Exact Changes:**
  1. Change default signature to `render(measure = false)` in `apps/hub/src/core/engine.ts:162`.
  2. Set `preserveDrawingBuffer: false` on `WebGLRenderer`, and in the feedback screenshot capture hook, synchronously trigger one `engine.render(false)` immediately before `canvas.toDataURL()` / `modern-screenshot` capture inside the same frame turn.

---

## 2. P1 — Plaza Cold-Start, Bar Interior & Portal Transition Speedups

### 2.1 Pipeline Hub Auth/WebSocket With 3D World Boot
- **Files:** `apps/hub/src/core/shell.ts:112-127, 1224, 1527`
- **Current Problem:** `shell.ts:1527` does not call `firstSession()` until *after* `await createEngine()` and `await definition.build()` finish. Then `openSession()` chains `gate.entry` → `authenticateDevice` → `profile.get` → `await content.onSession` (`verse.board` RPC!) → `startPlaza()` → `/ws` → `hub.join` → `match_join` → `OP_SNAPSHOT` → `channel_join` serially.
- **Exact Changes:**
  1. Kick off session restoration / `firstSession()` (auth + `profile.get` + `/ws` connect) **concurrently** with `createEngine()` and `definition.build()`.
  2. Do **not** `await` `verse.board` (`shell.ts:1224`) before calling `startPlaza()`; fire `verse.board` in the background and populate the leaderboard UI once it resolves.
  3. Add `<link rel="preconnect" href="https://play.<domain>" crossorigin>` in `apps/hub/hub/index.html` (or dynamically inject from `GAME_URLS` origin) so TLS handshake to `play.<domain>` is already warm when the player enters a portal.

### 2.2 Parallelize Building GLB Waterfalls & Stop Simultaneous LOD0 + LOD1 Fetches
- **Files:** `apps/hub/src/realms/plaza/buildings.ts:59-452`, `apps/hub/src/realms/plaza/club-interior.ts:132-138`, `apps/hub/src/realms/plaza/neon-sign.ts:18-21`, `apps/hub/src/v2/pets.ts:259`
- **Current Problem:**
  1. Every building builder in `buildings.ts` awaits parts **sequentially** instead of `Promise.all`: `castle()` (5 sequential awaits, lines 62–69), `whiteHouse()` (4, lines 77–87), `greenHill()` (4, lines 190–223), `club()` (5, lines 302–318), `kennel()` (3, lines 433–450).
  2. Entering the Bar (or returning from `#from=sproto-fighter`/`sproto-arcade`/`sproto-coop-battle`) blocks on **14.3 MB** because `club-interior.ts` and `neon-sign.ts` fetch **both LOD0 and LOD1 simultaneously** (`club-interior.glb` 6.4 MB + `club-interior-lod1.glb` 1.6 MB + `I9-neon-sign.glb` 4.1 MB + `I9-neon-sign-lod1.glb` 938 KB + `npc_sprotel_bitcoin.glb` 1.2 MB).
  3. `v2/pets.ts:259` eagerly fetches both `pet_pepe_bull.glb` (610 KB) AND `pet_pepe_bull-lod1.glb` (256 KB) on frame 1.
- **Exact Changes:**
  1. Refactor all 5 builders in `buildings.ts` to batch independent `part()`/`instanced()` calls inside `Promise.all([...])`.
  2. In `club-interior.ts` and `neon-sign.ts`, load **only LOD1 first** (2.5 MB total) so the Bar opens immediately, then stream LOD0 in the background—or drop LOD1 inside the enclosed Bar room if LOD0 is re-optimized. Re-compress/decimate `club-interior.glb` (6.4 MB → target <2.5 MB) and `I9-neon-sign.glb` (4.1 MB → target <1.0 MB) using `gltf-transform` meshopt + KTX2/WebP texture resizing (≤1024 px).
  3. In `v2/pets.ts:259`, load LOD0 only for the local player's pet (and LOD1 only for distant players' pets when needed).

### 2.3 Trim Artificial Hub ↔ Game Portal Delays
- **Files:** `apps/hub/src/travel.ts:7`, `apps/hub/src/core/shell.ts:1068`, `apps/hub/src/login.ts:60`
- **Current Problem:** `PORTAL_ENTER_DWELL = 1000 ms` + `ENTER_FADE_MS = 700 ms` + `READY_BEAT_MS = 350 ms` adds **2.05 s of mandatory artificial delay** on every round-trip on top of actual network/decode time.
- **Exact Changes:**
  1. Fire `portal.enter` RPC as soon as portal entry starts (overlapping the fade animation instead of waiting for dwell → RPC → fade).
  2. Reduce `ENTER_FADE_MS` to `200–250 ms` and `READY_BEAT_MS` to `0 ms` on return trips (`#from=<game>`).
  3. Update stale game copy in `apps/hub/src/game-list.ts:28` (`"ten giant bosses"` → 14 levels / 12 bosses + chase + ascent) and Bar Coop cabinet copy (`"Six players across twelve stages"` → 4 players / 13 stages).

---

## 3. P2 — Nakama Goja Hot-Path, Scalability & Cross-Game Server Support

### 3.1 Remove Synchronous DB/Storage Writes from `hub_match.ts` Hot Path
- **Files:** `server/modules/src/hub_match.ts:298, 371`, `server/modules/src/pets.ts:221-226`
- **Current Problem:** `HubPets.profilePets()` executes 2 SQL queries + 2 storage reads + a **side-effecting `storageWrite`** (`pets.ts:221-226`) synchronously inside `matchJoin` per player AND inside the 10 Hz `matchLoop` whenever a client sends `OP_PROFILE`.
- **Exact Changes:**
  1. Remove the hidden `storageWrite` from `HubPets.ownedSet()`'s read path (`pets.ts:221-226`); mirror/backfill entitlements strictly during write RPCs (`session.event`, `loadout.set_hub`, migrations).
  2. Batch pet lookups in `matchJoin` (mirroring `lookupRelics` batch SQL query).
  3. Remove DB/storage polling from `OP_PROFILE` inside `matchLoop`; instead, have `loadout.set_hub` validate ownership and send a match signal (or attach signed/cached loadout change) so `matchLoop` does zero synchronous DB I/O.

### 3.2 Benchmark & Raise `js_max_count` + Optimize Plaza Broadcasts
- **Files:** `deploy/nakama/config.yml:23`, `server/modules/src/hub_match.ts:442-538`, `apps/hub/src/net/protocol.ts`
- **Current Problem:** `js_max_count: 64` caps total Goja VMs across all matches (`hub`, `pb_world`, `sproto_arena`, `sproto_duel`, `sproto_coop`, `sproto_shooter_free`, `shooter_wager_sweep`) + RPCs, while each VM parses a **2.5 MB** bundle. At 90–100 moving plaza players, `OP_DELTA` sends all players in the zone without AOI culling (~32–42 KB/s per client).
- **Exact Changes:**
  1. Add spatial grid / radius AOI culling (e.g., 45–60 m full-rate 10 Hz, >60 m 2 Hz far-capsule update) in `hub_match.ts` `OP_DELTA`.
  2. Run `npm run load:plaza` + concurrent multi-game match load tests to measure RAM per Goja VM, then raise `js_max_count` (e.g., `128–256` tuned to VPS RAM) and document the CCU ceiling.
  3. Keep heavy game sims lazily instantiated (`__sprotoShooterSim()` pattern) across all vendored bundles (`pb-sim.js`, `sproto-sim.js`, `coop-sim.js`) so RPC/plaza VMs don't pay full sim initialization cost.

### 3.3 Register `sproto_arcade_coop` Match + Merge `sproto_duel` + Wire `pb_world` Hub Parity
- **Files:**
  - `server/modules/src/games/sproto_arcade.ts` (+ new `sproto_arcade_coop.ts`)
  - Branch `claude/sproto-online-duels` (merge `sproto_duel` + migration `0010_sproto_fighter_wagers` for `Sproto-Fighter`)
  - `server/modules/src/games/sproto_arena.ts` (for `sproto-duel` anti-cheat)
  - `server/modules/src/games/pb_world.ts` (or equivalent `HostIO` adapter for `peoples-bitcoin`)
  - `server/modules/src/games/sproto_shooter_free.ts` (return guest eligibility in `shooter.version` so client stops opening a WS on title screen)
- **Exact Changes:**
  1. **`Sproto-Arcade` 2P Co-op (`sproto_arcade.ts` + `sproto_arcade_coop.ts`):** Register Nakama lockstep relay match `sproto_arcade_coop` (2 seats, room-code create/join + quick-match RPCs, server-issued RNG `seed`, `OP_READY` start barrier, `OP_INPUT` 20–30 Hz relay, 60-tick `OP_HASH` desync check + Seat-0 `OP_SNAPSHOT` recovery, 15 s disconnect grace, and server-side co-op clear reward settlement awarding `breakwater_coin` on L01 + 20 Tickets on L01–L14 with AFK participation gating).
  2. **`Sproto-Fighter` Online (`sproto_duel`):** Rebase and merge `claude/sproto-online-duels` into `main` (verifying migration number against `docs/migration-allocations.md`), and document TURN server (`coturn` / `VITE_ICE_SERVERS`) deployment.
  3. **`sproto-duel` (`sproto_arena`):** Hash guest `OP.INPUT` frames server-side during relay and compare against the host's uploaded `OP.LOG.inputs[guestSeat]` before accepting PvP outcomes so a cheating host cannot fabricate guest inputs.
  4. **`peoples-bitcoin` (`HostIO`):** Expose `getRelics`/`loadProfile`, `reportEvent('pb.quest_complete', ...)`, and `submitScore('pb_total_xp', ...)` on `HostIO` so online MMO worlds have full hub parity.
  5. **`sproto-shooter` (`shooter.version`):** Include `isGuest` / `wagerEligible` in the REST `shooter.version` response so `sproto-shooter` stops opening a WebSocket + sending a dummy matchmaker probe on the title screen.

---

## 4. P3 — Shared Node/V8 Replay Verifier Pool, SDK v0.9 & Trust Hardening

### 4.1 Generalize `services/shooter-verifier/` into a Shared Node/V8 Verifier Pool
- **Files:** `services/shooter-verifier/`, `server/modules/src/games/{sproto_shooter,sproto_arena,sproto_arcade}.ts`, `deploy/compose.yml`
- **Current Problem:** Running deterministic replay verification inside Nakama Goja misses latency targets by 5×–1000× (`sproto-duel` 1.5–55 s vs 50 ms target; `Sproto-Arcade` 500–830 ms vs 100 ms target) and risks starving match loops. `services/shooter-verifier/` already implements a Node/V8 `ReplayPool` worker service but is currently dormant.
- **Exact Changes:**
  1. Generalize `services/shooter-verifier/` into `services/replay-verifier/` supporting pluggable content-addressed bundles (`shooter-sim.js`, `duel-sim.server.js`, `arcade-sim.server.js`).
  2. Wire async verification endpoints into Nakama via internal Docker network (Docker Compose service, non-public port) so Nakama enqueues replay proofs and settles Tickets/Relics/Wagers once V8 returns (`10–400 ms` instead of `0.5–55 s`).
  3. Add server-issued challenge nonces/seeds for single-player rewarded runs (`sproto-duel` Gauntlet, `Sproto-Arcade` Story, `sproto-shooter` Campaign) so replays cannot be pre-computed offline.

### 4.2 Modularize `@metaverse/hub-sdk` v0.9.0 & Resolve Dead `effects` Contract
- **Files:** `packages/hub-sdk/`, `server/modules/src/rpcs.ts:450`, `server/modules/src/loadout.ts`, `server/modules/tsconfig.json`
- **Exact Changes:**
  1. Split `@metaverse/hub-sdk` exports into lean sub-paths (`core`, `realtime`, `feedback` [lazy-loading `modern-screenshot.js`], `progress`, `pb-shop`) and exclude `mock.js` (23 KB) from production IIFE/ESM bundles. Standardize global name (`HubSDK`) across all repos.
  2. Either compile and register `server/modules/src/loadout.ts` in `tsconfig.json`/`main.ts` so `HubEffects.resolve()` returns real server-resolved effects, OR formally deprecate `effects` in `docs/CONTRACTS.md` and `InitResult` so all 8 games rely on `relics` + `items` cleanly.
  3. Add `https://play.<domain>/shared-assets/sproto/` static mount in `deploy/Caddyfile` (`immutable`) to host the ~10+ MB of GLB character rigs and stage packs shared between `sproto-duel` and `sproto-shooter`.

### 4.3 Close Trust-Boundary Spoofing on Relics & Client-Reported Tickets
- **Files:** `server/modules/src/schema.ts`, `server/modules/src/rpcs.ts`, `server/modules/src/play_lease.ts`, `server/modules/src/stage_relics.ts`
- **Exact Changes:**
  1. Wire `play_lease.ts` into `tsconfig.json` and `main.ts` for single-active-tab session fencing.
  2. Enforce server-side `event_seq` monotonicity and minimum realistic elapsed session duration on client-reported `session.event` / `tickets.earn` (until each game migrates to async Node/V8 replay verification).
  3. Reject `godMode: true` for Ticket awards (and clarify/enforce policy on Relics consistently across server + all 8 clients).
  4. Validate `character` against an explicit allowlist in `HubMatch.applyProfile` (`hub_match.ts:291-305`) instead of accepting any regex string.

---

## 5. Verification Checklist

Run before opening PR (from `AGENTS.md`):
```bash
npm run lint
npm run typecheck
npm test
npm run build
# With server/docker-compose.yml running:
npm run test:dup
caddy validate --config deploy/Caddyfile
```
Also document in the PR description:
- Any new migration numbers reserved in `docs/migration-allocations.md`.
- Every game repo that must run `node scripts/vendor-sdk.mjs` after `@metaverse/hub-sdk` updates (and `HPOS10I`'s `tools/qa/originality_allow.txt` line pins).
