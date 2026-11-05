# Second Hub World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the hub run a second themed world on the same accounts, Relics and movement rules, with the plaza unchanged.

**Architecture:** Split the client into a shared `core/` and per-page realm add-ons. Extend the existing `hub` match with a server realm table. Prove it with a plain gray `sandbox` realm before any art is made.

**Tech Stack:** TypeScript, Three.js, Vite, Nakama JS runtime, tsx-run assert tests.

**Spec:** `docs/superpowers/specs/2026-11-04-second-world-design.md`

## Global Constraints

- Plaza stays at `/hub/`, realms at `/realm/<id>/`.
- `packages/hub-sdk`, `GameId` and `RelicId` don't change, so no game repo re-sync is needed.
- `apps/hub/src/travel.ts` keeps its path and `parseReturnGame` export (`server/test/dup/same-tab.ts` reads the file).
- `hub.join` with no `realm` behaves exactly as today. The plaza's match label and room names don't change.
- Realm code never grants Relics, Tickets or Verse.
- Only plaza shard 1 is always on.
- Each PR passes `npm run lint`, `npm run typecheck`, `npm test` and `npm run build`, and another agent reviews it.
- Each refactor PR includes the plaza baseline comparison from Task 3.
- Add every new test file to the root `test` script in `package.json`.
- Nothing deploys and no production setting changes unless the owner asks.

## Review Focus

Each has a test in the task named.

1. Reloading or reconnecting inside a realm rejoins that realm, not the plaza (Task 9).
2. A session that expires inside a realm signs back in on the realm's page, and a guest stays a guest when crossing (Task 10).
3. Crossing quickly enough to hit the 6-a-minute `hub.join` limit shows a wait message, not "offline" (Task 9).
4. A stored match id from the other realm is ignored instead of placing the player across realms (Task 8).
5. A player returning from a game to `/hub/#from=<game>` after visiting a realm lands at that game's plaza portal (Task 10).

---

## Phase 1: Safe groundwork

### Task 1: Fix the missing Coin gem and pin Relic ids

**Files:**
- Modify: `apps/hub/src/m3/types.ts` (`RELIC_GEMS`)
- Test: `apps/hub/test/relics.test.ts`

- [ ] **Step 1: Write the failing test.** `relic_ids_all_have_gems`: `RELIC_GEMS` ids deep-equal `RELIC_IDS`. `relic_ids_all_have_sockets`: `SOCKETS` ids deep-equal `RELIC_IDS`. `server_knows_all_relics`: the text of `server/modules/src/hub_match.ts` contains every id.
- [ ] **Step 2: Run** `npx tsx apps/hub/test/relics.test.ts`. Expected: FAIL on `breakwater_coin`.
- [ ] **Step 3: Add the entry:** `{ id: 'breakwater_coin', gem: 'gem_coin', socket: 'socket_orbit', color: '#3ec6ff', radius: 0.66, height: 0.3, speed: 0.6, phase: 5.6 }`. Gems are colored instances, so this needs no art. If the entry's types restrict `gem`, widen them.
- [ ] **Step 4: Run the test.** Expected: PASS. Sign in with a Coin owner in dev, or use the dev stubs, and confirm a sixth gem orbits.
- [ ] **Step 5: Commit** as `fix: show Breakwater Coin as an orbit gem`.

### Task 2: Lock the movement values

**Files:**
- Create: `apps/hub/src/core/movement.ts`
- Modify: `apps/hub/src/physics.ts:6-13,67`, `apps/hub/src/config.ts:57-72`, `apps/hub/src/main.ts:51-52,100,283-285,376,425`
- Test: `apps/hub/test/movement.test.ts`

**Interfaces:**
- Produces: `MOVEMENT`, a frozen object with every value named below. `config.ts` re-exports its old names so existing imports keep working.

- [ ] **Step 1: Write the failing test.** `movement_values_are_locked` asserts gravity -28, jump 6.4, terminal -40, walk 7.8, sprint 16, camera arm 7.6, FOV 78, yaw rate 1.8, pitch rate 1.15, mouse 0.0017 and 0.0014, pitch limits -0.42 and 1.05, arm minimum 1.25, arm offset 0.28, capsule radius 0.34, capsule length 1.08, body scale 1.25, stand height 1.775. `capsule_rests_on_live_plaza_collider` uses `createPlayerController(buildPlazaCollider())`: rest height and jump band match `scripts/sim-capsule.ts:23,34`, and walking outward stops before radius 320.
- [ ] **Step 2: Run** `npx tsx apps/hub/test/movement.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Create `core/movement.ts`** and point physics, config and main at it. Values only, no behavior change.
- [ ] **Step 4: Run the test and `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** as `refactor: move movement values to one locked module`.

### Task 3: Record the plaza baseline

**Files:**
- Create: `docs/plaza-baseline.md`

**Interfaces:**
- Produces: the comparison every later refactor PR repeats.

- [ ] **Step 1: Write the walkthrough:** sign in, default spawn, return from each game with `#from=`, each portal's dwell and hint, club entry and exit, arcade picker, Sprotel prompt, bar boards, menu tabs, chat, emote, `?bots=99`.
- [ ] **Step 2: Add fixed comparison points:** six `?shot=` positions with draw calls and loaded asset count at each.
- [ ] **Step 3: Run it on current `main`** in the browser pane, and record the numbers. Keep screenshots outside git.
- [ ] **Step 4: Commit** as `docs: record plaza baseline for the realm refactor`.

## Phase 2: Split the client, with no visible change

### Task 4: Add the realm contract and split shared config

**Files:**
- Create: `apps/hub/src/core/realm.ts`, `apps/hub/src/realms/plaza/config.ts`, `apps/hub/src/realms/plaza/layout.ts`
- Modify: `apps/hub/src/config.ts`, `apps/hub/src/layout.ts`, `apps/hub/src/travel.ts`, `apps/hub/src/m3/livingPortals.ts`
- Test: `apps/hub/test/net.test.ts`, `scripts/sim-capsule.ts`

**Interfaces:**
- Produces: `RealmDefinition`, `RealmContext`, `RealmContent`, `SpawnPoint`, `Interaction` and `FrameState`, shaped as in the spec.
- Produces: `portalContaining(portals: readonly PortalConfig[], x: number, z: number): PortalConfig | null`.

- [ ] **Step 1: Update tests** to pass the portal list to `portalContaining`, and to import plaza values from their new paths.
- [ ] **Step 2: Run** `npx tsx scripts/sim-capsule.ts`. Expected: FAIL on the signature.
- [ ] **Step 3: Move plaza-only constants:** `config.ts:19-55` and `layout.ts:39-101`. Keep `portalPosition` and `BoxSpec` in `layout.ts`. Delete unused `PLAZA_RADIUS`. Default `livingPortals` placements to a required option.
- [ ] **Step 4: Run all checks and the baseline.** Expected: PASS, and baseline unchanged.
- [ ] **Step 5: Commit** as `refactor: separate shared config from plaza layout`.

### Task 5: Split `scene.ts` into engine and plaza content

**Files:**
- Create: `apps/hub/src/core/engine.ts`, `apps/hub/src/realms/plaza/content.ts`
- Modify: `apps/hub/src/scene.ts` (ends up removed or a thin re-export)
- Move to `apps/hub/src/realms/plaza/`: `plaza-collider.ts`, `collider.ts` legacy parts, `blockouts.ts`, `v2/buildings.ts`, `v2/club-interior*.ts`, `v2/interior.ts`, `v2/arcade*.ts` except `arcade-picker.ts`, `v2/billboard.ts`, `v2/neon-sign.ts`, `v2/sprotel-npc.ts`, `v2/plaza.ts`, `m3/hallOfChampions.ts`, `m3/barLeaderboard.ts`
- Test: `apps/hub/test/arcade.test.ts`, `apps/hub/test/net.test.ts`, `scripts/sim-capsule.ts`

**Interfaces:**
- Consumes: `RealmContent` from Task 4.
- Produces: `createEngine(opts: EngineOptions): Engine`, owning renderer (`scene.ts:155-166`), sky shader, bloom and tone mapping (`:302-320`), avatar rig and shadow (`:279-300`), pets, gems, LOD pass, render and resize. `EngineOptions` carries sky colors, fog, lights and bloom strengths.
- Produces: `createPlazaContent(ctx: RealmContext): Promise<RealmContent>`.

- [ ] **Step 1: Add a guard to `relics.test.ts`:** `core_has_no_realm_imports` scans `apps/hub/src/core/` and fails on any import from `realms/`.
- [ ] **Step 2: Move files in a first commit with imports fixed and no logic change.** Run all checks.
- [ ] **Step 3: Extract the engine,** passing the plaza's current values as options.
- [ ] **Step 4: Run all checks and the baseline.** Expected: same draw calls and asset counts at each point.
- [ ] **Step 5: Commit** as `refactor: separate the render engine from plaza content`.

### Task 6: Split `main.ts` into shell and plaza entry

**Files:**
- Create: `apps/hub/src/core/shell.ts`, `apps/hub/src/realms/plaza/index.ts`
- Modify: `apps/hub/src/main.ts`, `apps/hub/src/boot.ts`, `apps/hub/hub/index.html:135`

**Interfaces:**
- Consumes: `createEngine`, `createPlazaContent`, `MOVEMENT`.
- Produces: `startRealm(definition: RealmDefinition): Promise<void>`, owning input, spring arm and preview (`main.ts:232-286,379-395,409-463`), overhead chat, session and token refresh (`:719-885`), Relic HUD (`:623-635,704-717`) and net and chat (`:887-956`).
- Produces: `boot(load: () => Promise<unknown>, failureText: string): void`.

- [ ] **Step 1: Move plaza branches** behind `RealmContent`: `cameraFloor` replaces `main.ts:307,456`; `interactions` replaces the arcade, Sprotel and club prompts; `update` takes monument spin and bar tabs.
- [ ] **Step 2: Keep portal logic generic in `core/`,** driven by a `portals` list the plaza supplies.
- [ ] **Step 3: Reduce `main.ts`** to importing the plaza definition and calling `startRealm`.
- [ ] **Step 4: Run all checks and the full baseline.** Expected: unchanged. This is the riskiest PR, so request an adversarial review.
- [ ] **Step 5: Commit** as `refactor: run the plaza through the realm shell`.

### Task 7: Make Relic display realm-independent

**Files:**
- Create: `apps/hub/src/core/relics.ts`
- Modify: `apps/hub/src/config.ts:158-172`, `apps/hub/src/core/engine.ts`, `apps/hub/src/realms/plaza/content.ts`, `apps/hub/src/menu.ts:167,334,437`, `apps/hub/hub/index.html:25`, `apps/hub/src/realms/plaza/plaza.ts:259`
- Test: `apps/hub/test/relics.test.ts`

**Interfaces:**
- Produces: `RELICS`, with id, name and color. `SOCKETS` keeps monument angles and moves to the plaza, built from `RELICS`.
- Consumes: `RealmContent.onRelicsChanged`, which takes Hall, belt plinth and pedestal behavior.

- [ ] **Step 1: Write the failing tests.** `pedestal_colors_match_relics`. `four_relic_check_uses_four_lights`: the menu fallback owns the reward with the four `FOUR_LIGHTS_RELIC_IDS` and not with three.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement,** and replace the stale "0 of 4" and "0/4" starting text and the menu's monument wording.
- [ ] **Step 4: Run all checks and the baseline.** Pedestal colors are the one expected visual change. Note it in the PR.
- [ ] **Step 5: Commit** as `refactor: share Relic display across realms`.

## Phase 3: Server and test realm

### Task 8: Add the server realm table

**Files:**
- Create: `server/modules/src/hub_realms.ts`
- Modify: `server/modules/src/hub_rpcs.ts:48-67`, `server/modules/src/hub_match.ts:44,100-109,144-146,279-286,521`, `server/modules/src/hub_games.ts:21`, build file lists as needed
- Test: `server/test/unit/hub_match.test.ts`, `server/test/unit/chat.test.ts`

**Interfaces:**
- Produces: namespace `HubRealms`, with `REALMS`, `get(id: string): Realm | null` and `Realm { id, kind, roomPrefix, bounds, zones, spawn, alwaysOn }`.
- Plaza: kind `hub`, prefix `hub`, today's bounds, zones and spawn, `alwaysOn: true`. Sandbox: kind `hub_sandbox`, prefix `hub.sandbox`, |x|,|z| ≤ 140 m, y -4..40 m, one zone, spawn `[0,178,0]`, `alwaysOn: false`.
- Produces: `hub.join` accepts `{ prefer?, realm? }` and returns the same shape. Unknown realm fails with `bad_realm`.

- [ ] **Step 1: Write the failing tests:** `join_without_realm_is_plaza` (kind `hub`, room `hub.1`, label unchanged); `join_unknown_realm_fails` (`bad_realm`, and no match is created); `join_sandbox_places_separately` (kind `hub_sandbox`, room `hub.sandbox.1`); `prefer_from_other_realm_is_ignored`; `sandbox_shard_one_closes_when_empty`; `plaza_shard_one_stays_open`; `sandbox_bounds_reject_interior_band` (y -300 m refused in sandbox, allowed in plaza); `chat_accepts_realm_rooms` (`hub.sandbox.1` accepted, `hub.other.1` and `hub.sandbox.x` refused).
- [ ] **Step 2: Run** `npx tsx server/test/unit/hub_match.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `matchInit` reads `params.realm` and defaults to plaza, and the pose checks read the match's realm. The plaza's label stays byte-identical.
- [ ] **Step 4: Run all checks, plus `npm run test:rt` against local Nakama.** `test:dup` runs in CI. Expected: PASS.
- [ ] **Step 5: Commit** as `feat(server): place players by realm`.

### Task 9: Connect the client by realm

**Files:**
- Modify: `apps/hub/src/net/plaza.ts:7,84-86,122,126,135,148-152,169`, `apps/hub/src/net/protocol.ts:75-79`, `apps/hub/src/core/shell.ts`, `packages/hub-sdk/src/realtime/mock.ts` only if its parser needs it, without changing the SDK's public types
- Test: `apps/hub/test/net.test.ts`

**Interfaces:**
- Produces: `connectPlaza(opts)` gains `realm: RealmId`. Session key becomes `hub:plaza:match` for the plaza and `hub:plaza:match:<realm>` for others.

- [ ] **Step 1: Write the failing tests:** `reconnect_keeps_realm` (every re-placement sends the realm); `session_key_is_per_realm`; `rate_limited_shows_wait_message` (status isn't offline, and it retries after the limit window).
- [ ] **Step 2: Run** `npx tsx apps/hub/test/net.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Omit `realm` from the plaza's request, so its calls stay identical. Compare client and server zones per realm.
- [ ] **Step 4: Run all checks and the baseline.** Expected: PASS.
- [ ] **Step 5: Commit** as `feat: connect the hub client by realm`.

### Task 10: Build the gray `sandbox` realm and its gates

**Files:**
- Create: `apps/hub/realm/sandbox/index.html`, `apps/hub/src/realms/sandbox/index.ts`
- Modify: `apps/hub/vite.config.ts:125-128`, `apps/hub/src/travel.ts`, `apps/hub/src/realms/plaza/content.ts`, `apps/hub/src/boot.ts`, `apps/hub/src/login.ts` if its redirect assumes `/hub/`
- Test: `apps/hub/test/realm.test.ts`

**Interfaces:**
- Produces: `parseRealmArrival(hash: string): RealmId | null` in `travel.ts`, separate from `parseReturnGame`.
- Consumes: `startRealm`, `buildPortal` (moved to shared code, with its `portal-gate.glb`).
- The plaza gate shows only when `VITE_REALM_GATE_SANDBOX=1`. It's off in production builds.

- [ ] **Step 1: Write the failing tests:** `realm_arrival_parses` (`#realm=sandbox` gives sandbox; `#realm=nope` gives null); `game_return_ignores_realm_history` (`#from=nobu` resolves to the Kennel portal spawn regardless of stored realm state); `login_return_stays_on_page` (the sign-in path returns to the current page, not `/hub/`); `guest_flag_survives_crossing` (`hub:guest` in `sessionStorage` is read on the realm page).
- [ ] **Step 2: Run** `npx tsx apps/hub/test/realm.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Sandbox has a flat gray floor, a collider with an edge wall, one gate to `/hub/#realm=sandbox`, and uses the same DOM ids as `hub/index.html`. The plaza spawns arrivals beside its gate.
- [ ] **Step 4: Verify in the browser with local Nakama and two accounts.** Cross both ways. Movement matches. A player in each realm can't see or chat with the other. An account with all six Relics shows six gems in both, to itself and others. Then run the baseline with the flag off.
- [ ] **Step 5: Commit** as `feat: add the sandbox realm and gates behind a flag`.

### Task 11: Add realm asset checks

**Files:**
- Create: `scripts/check-realm-assets.mjs`
- Modify: root `package.json` `build` script

- [ ] **Step 1: Write the failing fixture test** in `apps/hub/test/realm.test.ts`: `realm_cannot_reference_other_realm` flags a source string naming `world/realms/other/`, and plaza code naming `world/realms/`.
- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement** the reference scan, plus a total-size check for `public/world/realms/<id>/`. Start the limit at 50 MB, matching the plaza's world art, until the owner sets another. Add a server check in `net.test.ts` that every client `RealmId` exists in `HubRealms`.
- [ ] **Step 4: Run `npm run build`.** Expected: PASS, printing each realm's size.
- [ ] **Step 5: Commit** as `chore: check realm asset separation in the build`.

### Task 12: Prepare deploy files, without deploying

**Files:**
- Modify: `deploy/Caddyfile:97,113`, `deploy/scripts/deploy-hub.sh:27`, `deploy/README.md:33,127-143`

- [ ] **Step 1: Change `@html`** to `(^/hub/?$|^/realm/[^/]+/?$|\.html$)`, and add a bare-path redirect for realm pages next to line 97.
- [ ] **Step 2: Make `deploy-hub.sh` fail** if a `realm/*/index.html` listed by the Vite inputs is missing. Keep the secrets check.
- [ ] **Step 3: Validate** with `caddy validate` if Caddy is available locally, or via the Caddy container. Report it in the PR if it can't be run.
- [ ] **Step 4: Commit** as `chore(deploy): serve realm pages with no-cache`. The owner decides when this reaches production.

### Task 13: Merge the UI palettes

**Files:**
- Create: `apps/hub/src/core/theme.css`
- Modify: `apps/hub/src/style.css:8-39,805-820,1825-1845`, `apps/hub/src/login.css:10-25`, image URLs in both

- [ ] **Step 1: Move tokens into `theme.css`,** with art URLs as variables defaulting to today's files. Convert the literal colors that repeat a token.
- [ ] **Step 2: Add a sandbox override** that changes only a few tokens, to prove a realm can reskin.
- [ ] **Step 3: Run all checks and the baseline, including login and menu screenshots.** Expected: plaza unchanged.
- [ ] **Step 4: Commit** as `refactor: use one theme file with per-realm overrides`.

## Phase 4: The real world

These depend on the owner's answers, listed under "Open for the owner" in the spec. They get their own detailed plan once answered, because their content isn't decided yet.

### Task 14: Asset pipeline and test run

Add a `gltf-transform` script producing `<name>.glb` and `<name>-lod1.glb` with meshopt and KTX2, and an environment-kit section in the Higgsfield guide. Then make one small walkable test scene, following the guide's approval and credit rules. Stop and report to the owner if it can't fit the 9.2 MB and 150 draw-call budgets.

### Task 15: Build the realm

Replace `sandbox` with the real realm id, on the server and client. Add its map, colliders, sky, UI theme, gate and features. Remove `sandbox` from the production allow-list. Any activity with saved progress or a reward gets its own server design first.

### Task 16: Launch checks

Run `npm run load:plaza` with players split across realms, against the agreed target and `handoff.md`'s network targets. Run the full walkthrough. Decide on the Cloudflare `.glb` rule. The owner then approves the deploy and turns on the plaza gate.
