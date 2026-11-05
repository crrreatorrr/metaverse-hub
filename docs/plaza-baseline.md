# Plaza baseline for realm refactors

Reference: `origin/main` at `b8636ee7b222cc39f2a4e18b1ce944276299e52d` (2026-11-05).
The reference includes the merged NOBU expanded trial boards, newer than the design audit.

## Repeatable capture

Use Chromium, 960 × 540 CSS pixels, device scale 1, a clean browser context, and the Vite dev
server. Enter as a guest with no equipped pet and no bots. Wait for all five buildings and
near-distance LOD upgrades to finish. Development enables the same ten Relic stub anchors and
sample boards on both versions. Keep screenshots outside git.

Open `/hub/?shot=<name>` for each comparison. Only `aerial` and `portal` have built-in camera
positions today; the other names suppress the normal camera, and a browser-only instrument sets
the camera position and look target below. No capture hooks are shipped in the app. For the
measured run, use `?shot=baseline` and set each position in order without reloading: this keeps
asset loading and LOD selection consistent. Draw counts are the scene-only `sceneDraws` /
`data-plaza-draws`, excluding bloom passes. Loaded assets count completed resource requests
ending in `.glb`, `.ktx2`, `.png`, `.webp`, `.ttf`, `.woff2`, or `.wasm`; count requests once per
page. This definition excludes dev source modules so moving source files does not change it.

| `shot` | Camera position | Look target | Main draws | Main loaded assets |
| --- | --- | --- | ---: | ---: |
| spawn | (0, 5, 49) | (0, 1.6, 42) | 97 | 40 |
| aerial | (0, 220, 310) | (0, 6, -20) | 122 | 40 |
| portal | (9, 3.3, -78) | (0, 4.1, -96) | 48 | 40 |
| kennel | (55, 5, 77) | (56.43, 4, 77.67) | 35 | 40 |
| castle | (-82, 5, -23) | (-91.3, 4, 29.67) | 42 | 40 |
| club | (98, 5, -25) | (91.3, 4, -29.67) | 82 | 40 |

Do not compare wall-clock FPS from software rendering. Animated gems, text and the randomized
skyline texture also prevent exact pixel equality; inspect geometry, framing, materials and UI.
The Coin adds an instance to the existing gem draw and requires no additional downloaded art.

## Walkthrough to repeat on every refactor

1. Open `/hub/` without saved state. Verify login/sign-up tabs, field errors, guest entry and
   loading progress. With a local test account, sign in, reload and check the account persists.
2. Verify default south spawn `(0, 1.775, 42)`, facing the monument. Walk with arrows, sprint with
   Shift, jump with Space, turn with WASD and mouse, and check camera collision and pitch limits.
3. Open `/hub/#from=hpos10i`, `#from=nobu`, `#from=peoples-bitcoin`, and `#from=sproto`.
   Verify each spawn faces its own ring, 7.5 m short of the portal at radius 96. Open
   `#from=sproto-fighter` and `#from=sproto-arcade`: both return to the Bar cabinet after loading.
4. At each of the four game rings, check the nearby hint and one-second continuous dwell.
   Leave before one second and verify reset; hold inside and verify one entry only. Check the
   mature-game prompt for People's Bitcoin. Use local games or intercept navigation for this check.
5. Approach the Bar door: check hint, loading and entry. Exit through the entrance, facing the
   plaza without immediately re-entering. The back EXIT beside the cabinet remains scenery.
6. At the cabinet, press E. Check Arcade/Fighter options, arrows, 1/2, Enter and Escape.
   At Sprotel, check the E prompt; the cabinet wins in its smaller interaction circle.
7. Inspect Bar boards, tab cycling and NOBU classic / v2 / expanded variants. Check local stub
   data in dev and live boards with Nakama; hidden exterior board tabs stay hidden indoors.
8. Open Esc menu. Check all tabs, avatar/staff customization, Relic visibility toggles, pet
   choices, and return to play. Capture login and menu screenshots as well as the six views.
9. With local Nakama, use two accounts: send nearby and room chat, verify overhead text and an
   emote, reconnect and check the room label. Guest/offline cases should show the existing copy.
10. Open `/hub/?bots=99`. Verify near/far remote tiers, moving avatars and remote gems, and no
    uncaught errors. Record draws separately; the six fixed shots use zero bots.

## Existing behavior and allowed changes

- Task 1 adds the missing sixth Coin orbit gem. Task 7 may correct pedestal colors. Every other
  plaza appearance and behavior must match this reference with the sandbox gate flag off.
- The live boundary is polygonal: northward sprint stops at radius 316.575 m; east/west contacts
  can reach about 321.441 m. Task 2 does not change the collider to impose a new circular wall.
- Existing `scripts/sim-capsule.ts` covers the legacy collider. The new movement test additionally
  checks the live plaza collider (rest 1.77499 m, jump rise 0.7175 m, northward boundary below 320 m).

## Verification record

Main six-view browser capture completed with no uncaught page errors. Screenshots and raw capture
results are retained outside git in `/tmp/second-world-evidence/main-*` and `main.json`.

Task 2 comparison: all six draw and loaded-asset counts match main exactly; browser page errors: none.
Independent review of tasks 1–3 found no blocking findings. All four required checks passed for
both code tasks and this documentation task. The local realtime Docker suite also passed.

The reference walkthrough used a newly created local account (no production account): sign-up,
account persistence in storage, south spawn, all six return parser/layout results, one-second
portal dwell/reset/held behavior, Bar loading and cabinet return, arcade picker, Sprotel prompt,
menu tabs and a real local chat send passed with no uncaught page errors. Browser instrumentation
stopped the animation loop after its first frame and stepped content directly for interaction
checks; it does not substitute for a human end-to-end playthrough of every fetched game.
The local games were not fetched, so actual game launch/return gameplay was not exercised.
Reference screenshots include the menu. Font loading was awaited after fixing the detached
worktree's Vite filesystem allow-list; that capture-only setup is outside git.

The reference `?bots=99` browser run displayed 6 near + 93 far remotes, 177 scene draws and no
uncaught page errors. This already exceeds the 150-draw warning threshold on main; it is an
existing load-profile result, not a new realm regression. The six zero-bot comparison views
remain below that threshold.

Task 4: repeated all six views; draws 97/122/48/35/42/82 and assets 40 at every point,
matching main. No uncaught browser errors. Plaza layout moved without changing its values.
Task 4 also repeated the signed-in light walkthrough (return layout/parser, dwell, Bar loading,
cabinet return, picker, Sprotel prompt, menu and local chat); no page errors.

Task 5: six-view baseline repeated, with draws 97/122/48/35/42/82 and 40 loaded assets at
each point, matching main. An initial extraction changed actor request timing (41 resources);
deferring actor attachment until initial realm geometry is loaded restored the reference count.
The signed-in light walkthrough passed again with no page errors. Independent review found no
blocking issue; moved implementation files were identical after normalizing import paths.
