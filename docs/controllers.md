# Sproto controller convention (shared by the hub and every game)

All games use the browser Gamepad API with the W3C "standard" mapping
(Xbox names; PlayStation / Switch equivalents work the same by position):

| Index | Button | Index | Button |
| --- | --- | --- | --- |
| 0 | A (bottom face) | 8 | View / Back / Select / Share |
| 1 | B (right face) | 9 | Menu / Start / Options |
| 2 | X (left face) | 10 | Left stick click |
| 3 | Y (top face) | 11 | Right stick click |
| 4 | LB | 12-15 | D-pad up, down, left, right |
| 5 | RB | 16 | Home / Guide (never bind: the OS/browser owns it) |
| 6 | LT (analog, pressed at > 0.5) | axes 0/1 | left stick x/y |
| 7 | RT (analog, pressed at > 0.5) | axes 2/3 | right stick x/y |

Rules every game follows, so a player can walk from the plaza into any game and back
without touching the keyboard:

1. **Poll, don't wait for events.** Read `navigator.getGamepads()` every frame. Browsers hide
   a pad on a freshly loaded page until a button is pressed there, so after the hub navigates
   to a game the pad appears on the first press. Hot-plug and unplug must work at any time.
2. **Latch on connect.** When a pad first appears (page load, hub → game travel, reconnect),
   ignore every button that is already held until it is released. Otherwise the A press that
   confirmed a portal in the hub also confirms the game's title screen.
3. **Menus:** D-pad and left stick move the focus (stick with a 0.5 threshold and key-repeat
   style auto-repeat: ~350 ms first delay, ~120 ms after), **A confirms, B goes back /
   cancels**. Every screen a keyboard player can reach — title, menus, settings, pause,
   game over, dialogs, the hub reward / return-to-hub UI — must be reachable and usable.
4. **Menu / Start pauses** (or opens the game's main menu where there is no pause) and
   resumes. **View / Back** opens the secondary screen if the game has one (map, scoreboard,
   inventory); otherwise it is unused. No action needs Home, and no action needs a
   two-button chord to get out of a screen.
5. **Return to the hub** is an item in the pause / main menu wherever the game already has a
   keyboard or mouse way to return. It is never a single accidental press.
6. **Sticks:** radial deadzone 0.2 on the left stick (rescaled so motion starts smoothly from
   0), 0.15 on the right stick. Movement accepts both the left stick and the D-pad.
   Camera (3D games) is on the right stick with frame-rate-independent speed; Y not inverted
   by default.
7. **Keyboard, mouse and touch keep working** exactly as before. The last device used decides
   which prompts are shown where the game shows control prompts (keyboard keys vs. A/B/X/Y).
8. **Map for playability, not by habit:** the most frequent action goes on A (jump in
   platformers, confirm in menus), the main attack on X or RT (RT in shooters, with LT to
   aim), secondary/defensive actions on B/Y/bumpers, rarely used actions on the bumpers or
   View. Nothing the player must do while moving needs the right thumb to leave the face
   buttons and the right stick at the same time unless the genre expects it (twin-stick).
9. **Local multiplayer:** controller 1 is player 1 and drives the menus; controller 2 is
   player 2. Keyboard stays available to both where it is today.
10. **Document** the layout in the game's README controls table and show it on the in-game
    controls/help screen if the game has one.

## The plaza

The plaza follows the same rules (`apps/hub/src/core/gamepad.ts`, `apps/hub/src/core/pad-focus.ts`,
tested in `apps/hub/test/gamepad.test.ts`), with inverted vertical camera control. By default,
the **left stick walks and the right stick turns the camera**. Menu → Items → Controller can swap
the sticks; the choice is saved in this browser (`hub:pad-move-stick`).
Below, "walking stick" and "camera stick" follow that setting. Keyboard and mouse are unchanged; any
key or click gives the prompts back to the keyboard.

| Action | Controller |
| --- | --- |
| Move (camera-relative) | Walking stick (left by default) or D-pad |
| Camera | Camera stick (right by default, vertically inverted) |
| Run | Hold B, or click the walking stick (stays on until you stop) |
| Use the prompt in front of you (arcade cabinet, Sprotel) | A ("Press E" prompts read "Press A"). X does the same |
| Jump | A, anywhere there is no prompt to use |
| Camera behind the avatar | Click the camera stick |
| Menu | Menu / Start. Inside: D-pad / walking stick move the focus ring, A presses, LB / RB change tab, camera stick turns the avatar preview, B or Menu closes |
| Chat | View opens the chat box (a device keyboard types), B or View closes it |
| Arcade picker | D-pad / walking stick choose, A plays, B steps away |
| Talking to Sprotel | D-pad / walking stick choose, A asks, B (or "See you.") leaves |
| Login gate | D-pad / walking stick move the focus ring, A presses (tabs, Continue as guest, submit). Text fields keep focus for a device keyboard |

The camera softens starts, stops, jumps, and manual look as well as turns. Quick direction
changes keep the view stable; automatic follow waits briefly for a steady heading. Large
reversals use a slower turn speed. Holding a movement direction keeps a
straight course while the camera turns behind the avatar. The camera stick, mouse, and Z / C
look left / right consistently. Manual camera input takes priority; follow resumes after a short
pause while moving. Stopping preserves the avatar's facing, and clicking the camera stick
smoothly recenters. Camera and movement inputs pause while a menu, chat, or dialog is open.

The arcade picker, Sprotel's panel and the chat chip show controller buttons while a pad is the last
device used, and A gives a short rumble where the browser supports it. The A that closes the login
gate is latched, so it does not also use the cabinet or jump. If a game cannot be opened, the error
stays on screen for five seconds instead of vanishing.

Portals need no button: walking into a ring travels, so the trip to a game is stick-only. The
game reads the pad on the first press on its page, with that press latched (rule 2).

## Keyboard convention

The keyboard follows one layout too, so a player who knows one Sproto game knows them all:

- **WASD and the arrow keys both move.** Local versus is the exception: P1 keeps WASD and P2
  takes the arrows, and the game says so on screen.
- The mouse looks or aims in 3D games (click to capture). Keyboard camera turning, where it
  exists, never uses WASD (the plaza uses Z / C to turn and R / F to lower and raise).
- Space jumps (or is the main action where there is no jump). Shift runs or dashes.
- E uses or interacts. R reloads in shooters.
- Menus: arrows and W / S move, Enter and Space confirm, Esc goes back or closes. Esc (or P)
  pauses gameplay. Number keys pick directly where a list is numbered (menu tabs, weapons, the
  arcade picker).
- Prompts, help screens and the README always name the keys the game really uses.

The plaza: WASD or arrows move, mouse looks, Z / C turn the camera, R / F lower and raise it,
Shift runs, Space jumps, E uses, Enter opens chat, Esc opens the menu (1–4 change its tab).
