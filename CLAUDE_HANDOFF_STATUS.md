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

## Checks

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass except `server/test/games/shooter_runs.test.ts`, which needs Go ≥ 1.26 (container has 1.24.7, `GOTOOLCHAIN=local`). It passes with `GOTOOLCHAIN=auto npx tsx server/test/games/shooter_runs.test.ts`. Environment only. |
| `VITE_NAKAMA_SERVER_KEY=ci-build-placeholder-not-a-server-key npm run build` | pass (same placeholder CI uses) |
| `npm run test:dup` | blocked: the Docker daemon is not running in this container and starting it was not permitted, so Nakama from `server/docker-compose.yml` cannot come up. |
| `caddy validate --config deploy/Caddyfile` | The raw file needs `/etc/caddy/cloudflare-proxies.caddy` and the origin cert on disk, so it cannot validate outside the VPS. The test validates and runs it with only those lines and the site addresses swapped. |

## Measurements

Plaza cold boot, `node scripts/measure-plaza-boot.mjs` against `vite preview` of the build, headless Chromium, cache disabled, no Nakama (boots to the gate with the plaza ready behind it):

| Build | ready ms | requests | transfer bytes | GLB requests | GLB bytes |
|---|---|---|---|---|---|
| after Phase 0 (7de1f60) | 948 | 47 | 1,882,273 | 8 | 795,778 |

`apps/hub/dist`: 92,616,208 bytes, 220 files (`world/` 90,419,840, `assets/` 2,175,797).

## Cross-repo follow-ups

- Re-sync `@metaverse/hub-sdk` 0.9.0 (after this branch merges) into every game: hpos10i, nobu, peoples-bitcoin, sproto-duel, sproto-shooter (`node scripts/vendor-sdk.mjs` from the hub); Sproto-Fighter and Sproto-Arcade use their own vendor scripts; Sproto-Coop-Battle loads the IIFE (`HubSDK`, pin in `packages/hub-sdk/SOURCE.pin.json`); HPOS10I pins SDK line numbers in `tools/qa/originality_allow.txt`, which will need updating. Not re-vendored in this pass, per the brief.
- nobu and HPOS10I: call `store.flushKeepalive()` before `exitToHub()` once on 0.9.0.

## Proposed repo-hygiene deletions

None yet.
