# Handoff status: metaverse-hub (optimization pass)

Branch `claude/happy-pasteur-0dhfzp`. Handoff: `CLAUDE_HANDOFF_OPTIMIZATION.md`; brief: `CLAUDE_SESSION_BRIEF.md`.
No pull request opened, no deploy, no production change. Status per item: done (sha), partial, skipped, blocked.

## Phase 0 (handoff §1)

| Item | Status | Notes |
|---|---|---|
| §1.1.1 precompress glb/gltf/bin/fonts | done f103ecd | `deploy/scripts/lib.sh` `precompress_tree` adds `*.glb *.gltf *.bin *.ttf *.otf *.fnt` (wasm/json/svg were already there). Already-compressed formats (webp, png, jpg, mp3, ogg, woff2, ktx2) stay skipped. |
| §1.1.2 `precompressed br gzip` on `{$DOMAIN}` | done f103ecd | All three hub `file_server` blocks, with the play host's 206 workaround (`status 200`, `-Content-Range`). `encode gzip` stays as fallback. |
| §1.1.3 immutable hashed chunks on play | done f103ecd | `@hashed` now also matches `assets/<name>-<8 char hash>.<ext>`; an 8-letter all-lowercase tail (`boss-defeated.mp3`) is excluded as a word, not a hash. `?v=<24 hex>` (Coop-Battle) is immutable except on HTML/manifest. |
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
| §2.2.2 Bar LOD1 first, LOD0 streamed | done c8b3a57 | `club-interior.ts` and `neon-sign.ts` build on LOD1 and add LOD0 at distance 0 when it lands. Until then the room has no punctual lights (only LOD0 carries them), so it is slightly darker for that moment. |
| §2.2.2 GLB re-compression | partial c8b3a57 | `club-interior.glb` 6,677,432 → 4,823,760 B (textures to WebP q88, same resolution), `I9-neon-sign.glb` 4,346,112 → 1,161,720 B (4096 → 2048 px, WebP q90). Meshopt kept in lossless quantize mode; bounds, primitive counts and lights unchanged. Texture PSNR at display size ≥ 38.6 dB (alpha-weighted), Bar screenshot PSNR 56.1 dB over the room. The handoff's < 2.5 MB / < 1 MB targets would need 1024 px atlases or decimation, which would visibly soften the room's art atlas and mural; not done. |
| §2.2.3 pet LOD0 only for the local pet | done c8b3a57 | `createPetFollower(..., { nearOnly: true })` for the local pet (it never leaves LOD0 range). Remote pets keep both levels. |
| §2.3.1 fire `portal.enter` at dwell start | skipped | `portal.enter` is rate limited (`claim_portal_rate`) and opens a game session (`open_portal`), so firing it speculatively when a player brushes a gate would spend the rate limit and could close a live session. The RPC already runs during the wipe. |
| §2.3.2 `ENTER_FADE_MS`, `READY_BEAT_MS` | done c8b3a57 | Fade wait 700 → 400 ms, not 200-250: the wipe's CSS fade is 380 ms, so leaving earlier would freeze a half-faded frame. Ready beat 350 → 0 ms on `#from=` returns. The 1 s gate dwell is a design rule ("a shorter visit does not enter") and is kept. |
| §2.3.3 stale copy | done c8b3a57 | Checked in the game repos (Sproto-Arcade `aa0f6bab` `levels.js`: 14 levels, 12 boss encounters plus Rooftop Breakaway and Codebreak Ascent; Coop-Battle README: up to four players, 13 stages). Now "twelve giant bosses" and "Up to four players across thirteen stages". |

## Checks

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass, run with `GOTOOLCHAIN=auto` (the container has Go 1.24.7 and `server/test/games/shooter_runs.test.ts` needs ≥ 1.26). That file's goja `cpu_budget` check is timing-sensitive on this 4-core VM: it failed once in the full run after Phase 1 and passed on the rerun alone; the code it covers is untouched. |
| `VITE_NAKAMA_SERVER_KEY=ci-build-placeholder-not-a-server-key npm run build` | pass (same placeholder CI uses) |
| `npm run test:dup` | blocked: the Docker daemon is not running in this container and starting it was not permitted, so Nakama from `server/docker-compose.yml` cannot come up. |
| `caddy validate --config deploy/Caddyfile` | The raw file needs `/etc/caddy/cloudflare-proxies.caddy` and the origin cert on disk, so it cannot validate outside the VPS. The test validates and runs it with only those lines and the site addresses swapped. |

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

- Re-sync `@metaverse/hub-sdk` 0.9.0 (after this branch merges) into every game: hpos10i, nobu, peoples-bitcoin, sproto-duel, sproto-shooter (`node scripts/vendor-sdk.mjs` from the hub); Sproto-Fighter and Sproto-Arcade use their own vendor scripts; Sproto-Coop-Battle loads the IIFE (`HubSDK`, pin in `packages/hub-sdk/SOURCE.pin.json`); HPOS10I pins SDK line numbers in `tools/qa/originality_allow.txt`, which will need updating. Not re-vendored in this pass, per the brief.
- nobu and HPOS10I: call `store.flushKeepalive()` before `exitToHub()` once on 0.9.0.

## Proposed repo-hygiene deletions

None yet.
