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
tested in `apps/hub/test/gamepad.test.ts`). Keyboard and mouse are unchanged; any key or click
gives the prompts back to the keyboard.

| Action | Controller |
| --- | --- |
| Move (camera-relative) | Left stick or D-pad |
| Camera | Right stick (not inverted) |
| Run | Hold B, or click the left stick (stays on until you stop) |
| Jump | A |
| Use the prompt in front of you (arcade cabinet, Sprotel) | X ("Press E" prompts read "Press X") |
| Camera behind the avatar | Right stick click |
| Menu | Menu / Start. Inside: D-pad / left stick move the focus ring, A presses, LB / RB change tab, right stick turns the avatar preview, B or Menu closes |
| Chat | View opens the chat box (a device keyboard types), B or View closes it |
| Arcade picker | D-pad / left stick choose, A plays, B steps away |
| Login gate | D-pad / left stick move the focus ring, A presses (tabs, Continue as guest, submit). Text fields keep focus for a device keyboard |

Portals need no button: walking into a ring travels, so the trip to a game is stick-only. The
game reads the pad on the first press on its page, with that press latched (rule 2).
