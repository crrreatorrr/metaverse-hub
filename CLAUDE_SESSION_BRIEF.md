# Session brief: optimization handoff implementation

You are one of nine parallel Claude Code sessions implementing the load-time, security and multiplayer handoffs across the Sproto metaverse game repos. An orchestrating session coordinates the nine. It will read your pushed branch and your status file. Work only in this one repository.

## Setup
- You are on branch `claude/happy-pasteur-0dhfzp`, which is `main` plus the handoff doc `CLAUDE_HANDOFF_OPTIMIZATION.md` (from `claude/architecture-load-optimization-handoff`) and this brief, `CLAUDE_SESSION_BRIEF.md`. Do all work on this branch. Push only to it with `git push -u origin claude/happy-pasteur-0dhfzp`, retrying network failures with backoff. Never push to `main` or any other branch, never force-push and never rewrite history. Do not open a pull request; the owner will ask for those separately. This overrides any "open a PR" or "push to main" line in AGENTS.md or in the handoff.
- Before you change anything, read `AGENTS.md` (and any file it imports) and `CLAUDE_HANDOFF_OPTIMIZATION.md` in full. Where they conflict, the AGENTS.md hard rules win.

## How to treat the handoff
- Another agent wrote it from a static read. Line numbers, sizes and some claims may be stale or wrong. Verify each item against the code before acting on it. If an item is wrong, already done, unsafe, or would change gameplay, skip it and record why.
- Gameplay, balance, roster, levels, determinism and pinned hashes must not change unless a handoff item explicitly calls for the change and AGENTS.md allows it. Existing golden and replay tests must keep passing.
- Generate no new art: no Higgsfield and no image generators. You may re-encode existing assets (WebP, meshopt/KTX2, texture downscaling, decimation, audio transcoding) only when the result looks or sounds the same at game resolution. Spot-check before and after, for example with screenshots from the preinstalled Playwright Chromium.
- Do not delete archived authoring, reference or QA material from the git tree. Exclude it from builds and `dist/` instead, and list proposed repo-hygiene deletions in the status file for the owner to decide. You may delete runtime files only after proving they are unreferenced (grep, then build and tests).
- Make no production deploys and no changes to live infrastructure, and commit no real keys or secrets.
- Do not edit other repositories. Where an item needs work in another repo, build your side so it works whether or not the other side has landed (feature-detect, with a fallback), and record the dependency. You may read the other repos through the GitHub MCP tools (owner `crrreatorrr`). The other sessions push to `claude/happy-pasteur-0dhfzp` in their repos.
- Do not re-vendor `hub-sdk` from metaverse-hub in this pass. The hub's SDK changes are unmerged. Make game-side fixes that do not depend on them.

## Order of work
Work in phases. Commit and push at the end of each phase, so earlier phases land even if you run out of time.
- Phase 0: the P0 security fixes, bug fixes and quick wins listed below for this repo.
- Phase 1: the asset and cold-boot items.
- Phase 2: the multiplayer and online items.
- Phase 3: the remaining P2/P3 items, as far as they can be taken safely.
Commit each logical change separately, with a clear message. After each phase, run the repo's checks (the "Checks" section of AGENTS.md) and fix whatever you broke. If a check cannot run here (missing service, network or toolchain), record exactly which check and why. Measure before and after for every load-time claim, such as `dist/` byte counts and the number of requests at boot through Playwright, and record the numbers.

## Status file
Keep `CLAUDE_HANDOFF_STATUS.md` at the repo root and commit it with each phase. Give every handoff item one line marked done (with the commit sha), partial (with what remains), skipped (with why) or blocked (with which repo or what it waits on). Also include the check results with their commands, the before/after measurements, and a "Cross-repo follow-ups" section listing things like a hub re-vendor or re-pin, or an SDK re-sync.

## Finish
When you are done, or can go no further, review your full diff against `main` (use /code-review if it is available) and fix the real findings. Then push, and end with a short summary: which phases are complete, which items are done, skipped or blocked, the check results, and the follow-ups.

# Repository: crrreatorrr/metaverse-hub (handoff branch claude/architecture-load-optimization-handoff)

## Phases for this repo
- Phase 0, handoff §1:
  - §1.1 Caddy precompression and immutable caching. Validate with `caddy validate --config deploy/Caddyfile`; if `caddy` is not installed, use a pinned Caddy release binary or `docker run caddy:<pinned version>`. Write a small test that serves a sample tree with the deploy Caddyfile and checks `Content-Encoding: br` and the `Cache-Control` headers. Keep `index.html` and `asset-manifest.json` at `no-cache`.
  - §1.2 SDK `granted_items`, with a Vitest test. Also the cached IndexedDB handle, a keepalive flush for saves, and `isRelicId` accepting all canonical Relics without stripping unknown future ids.
  - §1.3 the render double-pass and `preserveDrawingBuffer`. Keep feedback screenshots working.
  - `packages/hub-sdk` is at 0.8.0, and the games vendor 0.7.2. Bump the SDK version once for this pass, rebuild ESM and IIFE (`scripts/build-sdk-iife.mjs`), and list in the status file which game repos must re-sync, noting the custom vendor scripts in Fighter and Arcade and HPOS10I's `tools/qa/originality_allow.txt` line pins. Do not re-vendor into the games.
- Phase 1, §2: plaza boot pipelining, `Promise.all` in the building builders, LOD1-first Bar loading, GLB re-compression with visual checks, portal delay trims, and the stale copy. Before correcting the copy, check current level, boss and player counts in the Arcade and Coop repos through GitHub.
- Phase 2, §3:
  - §3.1 Remove synchronous DB and storage I/O from the `hub_match` hot path.
  - §3.2 AOI culling for `OP_DELTA`. Do not raise `js_max_count` without a measurement. If Docker works here, bring up `server/docker-compose.yml` and run `npm run load:plaza` plus `npm run test:dup`, and record the RAM per VM. Otherwise record it as blocked.
  - §3.3 Build the `sproto_arcade_coop` match and RPCs exactly to the contract below, with tests in the style of the existing coop/shooter match tests.
  - Item 2, `claude/sproto-online-duels`: that branch no longer exists on the remote, and `main.ts` already registers `sproto_duel`. Verify what is actually missing for Sproto-Fighter online duels compared with the Fighter handoff, and finish only the server-side gaps.
  - Item 3, sproto-duel guest input hashing: read sproto-duel's `OP.LOG` format in that repo before you build it, and keep it tolerant of clients that do not yet send what you add.
  - Item 4, `pb_world` HostIO parity: `HostIO` is defined in peoples-bitcoin `src/server/host.ts`. That session is adding optional `getRelics`, `loadProfile`, `reportEvent` and `submitScore` on its branch. Implement the hub adapter for them, and keep it working with the currently vendored pb bundle that lacks them.
  - Item 5, `shooter.version`: return `isGuest` and `wagerEligible` booleans.
- Phase 3, §4:
  - §4.3 trust hardening. Every change must stay tolerant of games that do not yet send new fields, so that no live game's reward flow breaks. Where a rule would reject current clients, ship it behind a server config flag that defaults off, and record that.
  - §4.2 the SDK sub-paths and the `effects` decision. Document the decision; don't break the existing IIFE global `HubSDK`.
  - §4.1 the shared replay-verifier pool. It is large, so do it last and only as far as it is solid.
- Before choosing any migration number, check `docs/migration-allocations.md` and the open PRs (GitHub MCP `list_pull_requests`), and reserve the number in the allocations doc.
- Do not change `server/modules/vendor/` game bundles or pins. The Coop, shooter and pb re-vendors follow later merges in those repos.

## Arcade 2P co-op protocol v1 (shared contract with the other repo, keep it exact)
The Sproto-Arcade session builds the client and the metaverse-hub session builds the server match. Both build to this contract. If you must deviate, keep the deviation backward-compatible and record it under "Contract deviations" in the status file.
- Nakama match module `sproto_arcade_coop`, game id `sproto-arcade`, 2 seats (seat 0 and seat 1), `v: 1`. Every payload is JSON.
- RPCs, mirroring how `sproto_arcade.ts` and the coop/shooter matchmaking modules are written:
  - `arcade.coop_create {level, pilot}` returns `{match_id, code}`. `code` is 5 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
  - `arcade.coop_join {code}` returns `{match_id}`, or the error `not_found` or `full`.
  - `arcade.coop_quick {level, pilot}` returns `{match_id}`.
- Opcodes:
  - 1 `OP_HELLO`, client to server: `{v, pilot, level}`
  - 2 `OP_LOBBY`, server to clients: `{code, level, seats:[{seat, name, pilot, present}]}`
  - 3 `OP_START`, server to clients, once both seats have sent HELLO: `{levelIndex, pilots:[p0, p1], seed, seat, names}`. `seed` is a server-issued uint32.
  - 4 `OP_READY`, client to server, after `loadFor()` finishes.
  - 5 `OP_GO`, server to clients, once both seats are READY. The sim starts at tick 0.
  - 10 `OP_INPUT`, client to server to peer: `{seat, from, frames:[int,...]}`. `frames` are the 10-bit replay InputFrames for ticks `from..from+n-1`, sent every 2 ticks, with 4-tick input delay and a 6-tick jitter buffer on the client. The server relays them to the other seat, adds `seat` from the sender's presence (it does not trust the client's value), and counts the sender's non-zero frames for the AFK check.
  - 11 `OP_HASH`, client to server, every 60 ticks: `{tick, hash}`. The server compares the two seats' hashes for the same tick.
  - 12 `OP_DESYNC`, server to clients: `{tick, count}`. Seat 0 then sends `OP_SNAPSHOT`. After 3 desyncs the server ends the match unrewarded.
  - 13 `OP_SNAPSHOT`, seat 0 to server to seat 1: `{tick, state}`
  - 14 `OP_RESULT`, client to server: `{status:"clear"|"wipe"|"abort", level, tick, god}`
  - 15 `OP_OUTCOME`, server to clients: `{status, reason?, rewards:{tickets, relics:[...]}}`
  - 16 `OP_PEER`, server to clients: `{seat, present, graceS}`. A 15 s reconnect grace applies.
  - 17 `OP_SEAT_DROP`, server to clients: `{seat, tick}`. Sent when the grace expires, with a deterministic tick at least 10 ticks ahead of the latest relayed input. Clients then call `rescaleBossForSeats(..., 1)` at that tick.
  - 18 `OP_PING`, client to server to the same client: `{c}` returns `{c, s}`
  - 19 `OP_CANCEL`, server to clients: `{reason}`
- Rewards are settled only by the server, once per match. A "clear" pays only if all of these hold: the seats still present agree on `clear` and `level`, hashes agreed through the last checked tick, `god` is false, and the participant passes the AFK check. The AFK check uses the server's own count: non-zero input frames are at least 0.5 times the combat ticks relayed. Each such account gets 20 Tickets as `arcade_clear` for levels 1 to 14, and the `breakwater_coin` Relic on level 1, granted exactly as the existing single-player arcade reward path grants them (same ledger, same idempotency keys, scoped per match and account).
