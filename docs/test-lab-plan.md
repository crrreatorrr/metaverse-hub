# Test Lab plan: Metaverse Hub

Status: this is a plan only; nothing has been built yet. It was written on 7 November 2026 from a read-only pass over `main` at `f14a1e1`.
Implementer: Cursor, working on branch `cursor/test-lab`.

## What the lab is for

The lab is a page at `/lab.html` on the hub app. It loads separately from the plaza and needs no Nakama. It shows:
- all 7 avatars in every combination of staff and look;
- pets, the Sprotel NPC and Relics;
- every animation clip;
- a neutral stage for viewing one entity at a time;
- a walkable copy of the real plaza and Bar, with collider wireframes, zone borders, the capsule and fake remote players;
- mocked profile, Relic, pet and ticket states.

The hub has no enemies, weapons or bosses. Those parts of the common rules do not apply here; "weapons" means the wielded staffs.

## Owner decisions (7 November 2026, the same for every game repo)

These answers came from the owner's Q&A and apply to every game. Repo-specific sections below may add to them, but never relax them.

1. **A separate page.** The lab is its own HTML entry, `lab.html`, at the root of the built site, with its own JS bundle. The game's `index.html` must not import, link to or preload anything from the lab.
   - Measure the game's load before and after: JS bytes, request count and time to first frame. Put both sets of numbers in the PR. The game's numbers must not change.
2. **A hidden URL in production.** The lab ships in the production build at `lab.html`, relative to the game's base path.
   - Nothing in the game links to it.
   - It has `<meta name="robots" content="noindex,nofollow">`.
   - It must pass every existing production check, including banned-string scans. The repo section lists them.
3. **Desktop browser only:** keyboard and mouse. No touch layout.
4. **Automated QA.** Expose a small automation API on `window.testLab`. Never reuse an existing debug handle name. It needs at least:
   - `list()`, which returns every entity with its id, kind and animations/attacks;
   - `select(id)`;
   - `play(clipOrAttack)`;
   - `step(n)`;
   - `state()`, which returns position, velocity, state, clip, frame and HP;
   - `ready`, a promise that resolves when the current view has finished loading and drawing.

   Add a headless script (Playwright or CDP) that opens `lab.html`, visits every entity and every animation, and fails on console errors, failed requests or a blank canvas. Wire it into the repo's checks where browser checks already exist.
5. **Interaction:**
   - **Playback controls:** play, pause, step ±1 frame or tick, speed from 0.1× to 4×, scrub and loop.
   - **Live sandbox:** drive the character with the game's own controls. Show a live readout of position, velocity, facing, state, current animation and frame.
   - **Overlays:** see item 8.
   - **Spawn and fire:** spawn any enemy or boss; force any boss phase or attack; set HP; freeze AI; give any weapon, item or power-up; fire any attack on demand.
6. **Extras:**
   - **Load-time panel.** For each asset show bytes, fetch ms, decode ms and whether it came from cache; show a total per character. Load each character only when it is selected, never the whole roster up front. Use `PerformanceResourceTiming` plus timing around decode.
   - **Side-by-side compare.** Two entities, or two phases or variants of one entity, on one shared clock.
   - **Share links.** Keep all view state in the URL hash, for example `#tab=anim&id=x&clip=y&frame=12`, so a reload restores the exact view. Add a "Save PNG" button.
7. **No sim edits.** The lab is lab-only code. Do not change gameplay or sim files, or anything that changes a sim fingerprint, server bundle, replay golden or gameplay hash.
   - If the lab needs a private value, such as a collision function the game does not export, mirror it in lab code.
   - Add a unit test that fails when the mirror drifts from the source, for example by comparing outputs on sample inputs.
8. **Overlays show the game's truth plus the art's bounds.** Draw exactly what gameplay uses (hit, hurt and collision shapes; anchors; muzzle and spawn points) in one colour, and the sprite or model bounds in another, so mismatches are obvious. Also draw a grid with world coordinates.
9. **Accepted art only.** The roster lists only art the game currently uses. Pending or archived art may appear only in a tab labelled "Archive (not in game)", never in the sandbox.
10. **Isolation.** The lab never writes the player's real save, never takes tab or writer locks, never initialises the hub and never sends scores or tickets. Use an in-memory save with everything unlocked.
11. **Free-form per repo.** Fit the layout to the game. There is no shared kit across repos.
12. **Branch and PR.** Work on `cursor/test-lab`. It was created from the latest `main` with this plan committed. Commit after each phase below, and open a PR into `main` when done. Never push to `main`. Run every repo check and report any you could not run. A different agent reviews the PR.

## Facts this plan relies on

- **Build.** Vite multi-page (`apps/hub/vite.config.ts:166-170`) already has three inputs: `hub/`, `realm/sandbox/` and `play/sproto/`.
  - `realmPages()` (`vite.config.ts:70`) lists every `/realm/<id>/` page for deploy and Caddy. **Do not put the lab under `realm/` or `src/realms/`.** `check-realm-assets.mjs:30-33` would treat it as a realm, and `realm.test.ts:28` would require realm DOM ids. Use `apps/hub/lab/index.html` (served at `/lab/`) or `apps/hub/lab.html`, and lab code under `apps/hub/src/lab/`.
- **Banned strings.** `scripts/check-prod-bundle.mjs:18` fails the build if dist contains `__hub`, `__nobu` or `__duel`. Use `window.testLab` only.
- **Bundle budget.** The same script fails if all dist JS together exceeds 800 KB gzip. The lab's chunks count toward that budget, so keep the lab lean: reuse shared three chunks and lazy-load the panels.
- **Reusable pieces.** Do not reuse `startRealm`/`core/shell.ts`: it pulls in login, chat, net and menu. Compose these instead:
  - `createEngine` (`core/engine.ts:23`)
  - `createAvatarRig` (`avatar.ts`)
  - `createPetFollower` (`v2/pets.ts`)
  - `createSprotelController` (`realms/plaza/sprotel-npc.ts`)
  - `createPlayerController(bvh)` (`physics.ts:44`, a pure kinematic capsule)
  - the plaza, Bar and sandbox colliders
  - `MOVEMENT` (`core/movement.ts`)
- **Roster and items:**
  - `CHARACTERS` (`config.ts:59-67`): wizard, sahil, obama, midget, broccoli, agent, tinubu.
  - `STAFFS` (`config.ts:80-86`): none, sproto, momentum, moonward, nobu. The unlisted `staff_fighters_might.glb` goes in the Archive tab only.
  - Looks are in `src/look.ts`. Pets are in `src/v2/pets.json`; about 12 menu items, many without a GLB.
  - Sprotel clips: idle, greet, talk, wipe_glass.
  - Relics: `src/core/relics.ts` and SDK `types.ts:6-23`.
- **Clips.** Avatars have idle, jog (falls back to run) and dash. Staffs have `*_idle`. Pets have idle, follow_walk, follow_run, sit_enter, sit, emote_happy, emote_dance, spawn_poof and an additive parts clip. The wire enum also has walk, jump, wave, dance and cheer, though not every rig has them; the lab should show which ones are missing.
- **Mock data.** `createHubSdk()` with no server (or `useMock: true`) returns an in-memory mock (`packages/hub-sdk/src/createHubSdk.ts:78-95`). `createMockRealtimeServer()` mocks realtime. Fake remotes: `net/bots.ts`, `remotes.ts` and `net/interp.ts`.
- **Existing debug tools.** In DEV there is a `#debug` overlay with draw calls and fps, plus `?bots=N`, `?shot=` and `?pet=`. The draw-call budget is 150.

## Owner decisions applied here

- **Characters and wielded items first.** Any avatar × any staff × any look preset × height × Relic aura, shown with its `socket_staff` mount point and the clip for each state.
- **Neutral stage and real plaza, both.**
- **Mock profile and Relics.** A panel toggles owned Relics, pets, tickets and Verse in the mock SDK, so you can see how the avatar, orbit gems, aura and monuments react.
- **Overlay "game truth":**
  - the capsule (radius 0.34, height 1.08 × 1.25)
  - BVH collider wireframes
  - zone borders from `zoneOf` (plaza, Bar, void)
  - interact radii (Sprotel 2.5 m, portals)
  - remote-player interpolation ghosts at the 150 ms delay
  - the impostor and full-render ring at 30 m

  **Art bounds:** model `Box3`.

## Tabs

1. **Avatars:** turntable view with avatar, staff, look, height and aura pickers. Clip list with playback controls, bone and socket axes, and missing-clip warnings.
2. **Pets:** each pet with every clip, including the additive parts clip. A follow test makes the pet follow a moving target.
3. **NPC:** Sprotel with each clip and the head-aim look-at target, which you can drag.
4. **Relics and items:** every Relic as an orbit gem, monument socket and Hall entry. A mock-ownership toggle, a portal list and the arcade cabinet targets resolved by `src/games.ts`.
5. **Walk: neutral:** a grid floor where you drive the avatar with real controls and `MOVEMENT`, with a live readout of position, velocity, grounded, speed and clip.
6. **Walk: plaza and Bar:** the real colliders and environment, with overlays on. Teleport to points of interest and spawn N fake remotes (the bots code) to check interpolation and impostors. No Nakama connection.
7. **Compare:** two avatar/staff/look setups on one clock.
8. **Loading:** the load-time panel; meshopt and LOD1 versus LOD0 cost per GLB.

## Files

- Add:
  - `apps/hub/lab/index.html` or `apps/hub/lab.html` (outside `realm/`)
  - `apps/hub/src/lab/**`
  - `apps/hub/test/lab.test.ts` (tsx): lab state hash round-trip; every `CHARACTERS` and `STAFFS` id resolves to a file; the clip coverage table
  - `scripts/lab-smoke.mjs`
- Edit:
  - `apps/hub/vite.config.ts`: add the lab input
  - root `package.json`: add the lab test to `npm test`
  - `README.md` and `docs/`: a short note
- Do not touch: `server/**`, `deploy/**`, `packages/hub-sdk/src/**` (the SDK contract), `core/shell.ts` behaviour, or the realm list. **No SDK change means no game repo needs to re-sync.**

## Phases

1. Skeleton entry outside `realm/`; engine plus avatar rig on the neutral stage; check-prod-bundle passes; record the plaza load numbers before and after.
2. Avatars, Pets, NPC and Relics tabs, with the mock SDK panel.
3. Walk tabs (neutral, then plaza and Bar), with overlays and fake remotes.
4. Compare, Loading, PNG export, hash state, `window.testLab`, the smoke script and the PR.

## Acceptance

- `npm run build` passes, including `check-realm-assets` and `check-prod-bundle` (banned strings and the 800 KB gzip budget). `realm-pages.txt` is unchanged.
- The lab opens with no Nakama running and makes no request to `/v2` or `/ws`.
- Every avatar, staff and pet renders every clip it has. Missing clips are listed, not thrown. (`avatar.ts:429` throws on missing clips, so the lab checks first.)
- `npm run lint`, `typecheck` and `test` pass. Deploys and production are untouched.

## Cursor prompt

The owner pastes this into Cursor:

```text
You are working in the Metaverse Hub repo (crrreatorrr/metaverse-hub). Check out the existing branch `cursor/test-lab`. It was created from the latest `main` and already contains `docs/test-lab-plan.md`.

1. Read `AGENTS.md`, `README.md` and `handoff.md`, then read `docs/test-lab-plan.md` in full. That plan is the spec. It records the owner's answers, so follow it exactly and don't re-ask anything it already settles.
2. Build the Test Lab phase by phase as the plan lays out, and commit after each phase. The lab is a separate, unlinked `lab.html` page with `noindex` and its own bundle. It loads each character only when that character is selected. It ships hidden in the production build.
3. Repo-specific hard rules:
   - Put the lab outside `realm/` and `src/realms/` (use `apps/hub/lab/` and `apps/hub/src/lab/`), so the realm checks and `realm-pages.txt` don't pick it up.
   - Never put `__hub`, `__nobu` or `__duel` in the lab. Keep total dist JS under the 800 KB gzip budget that `scripts/check-prod-bundle.mjs` enforces.
   - Don't reuse `startRealm` or `core/shell.ts`. Compose `createEngine`, the avatar rig, the pet follower, the Sprotel controller, `createPlayerController` and the colliders yourself.
   - No Nakama: use the hub-sdk mock (`createHubSdk()` with no server). Don't change `packages/hub-sdk/src`, `server/` or `deploy/`. Never deploy.
4. Never write the real save, never take tab or writer locks, and never initialise the hub. Use `window.testLab` as the automation handle.
5. When done, run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and the new `scripts/lab-smoke.mjs`. Then open a PR from `cursor/test-lab` into `main` titled "Add Test Lab (lab.html)". In the PR, report:
   - the game page's load numbers (JS bytes, request count, time to first frame) before and after;
   - the result of every check, and any check you could not run, with the reason;
   - every place you mirrored private code, and the drift test that guards it.
6. If part of the plan can only be done by breaking one of these rules, stop and ask me rather than editing a protected file.
```
