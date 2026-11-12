# In-game feedback

Players press **N twice** in the hub or in any game. The game pauses, a small window opens, and the
note they send is stored on the hub server. The owner works the notes in the admin panel at
`/admin/`.

## What a player sees

- N twice within 400 ms opens the window. One N does nothing, and N is ignored while typing in a
  text field. The games never see the N key.
- The window has seven options (Something broke, Unclear what to do, Too hard, Too easy, Controls
  feel off, Performance issue, Other) and an optional note. Keys 1–7 pick, Enter sends, Esc closes.
- The screenshot is taken before the window appears. The player can draw on it.
- Closing the window resumes the game exactly where it was. Online matches cannot pause; there the
  window says the game keeps running.
- Sending closes the window at once and shows the note's id in a small toast. If the hub cannot be
  reached, the note waits in the browser and is sent later.
- After an uncaught error a toast offers "Send report", with the error attached.
- Only signed-in hub accounts can send. Guests and games opened outside the hub get a one-line
  message instead of the window.

## What is stored

Each note has an id per game (`SHOOTER-0042`, `HUB-0007`), the sender's username and user id, the
options, the note, a status and a history. It also carries:

- the player's clock and time zone, the server's receive time and the in-game time
- level, mode, player position and player state, as the game reports them
- game version, frame rate, recent errors, and the last 24 game events (breadcrumbs)
- browser, screen size, input devices and the page path
- the screenshot, a JPEG no wider than 960 px and under about 140 KB

Everything except the frame-rate counter is gathered only when the window opens.

Tables (migration `0059_feedback`, `server/modules/src/games/hub_feedback.ts`):
`game.feedback`, `game.feedback_image`, `game.feedback_event`, `game.feedback_seq` and
`game.feedback_admin`.

## Statuses

`open` → `in_progress` → `fixed` (changed, waiting to be verified) → `resolved`.

A note becomes `resolved` only with a resolution summary **and** a note saying how the fix was
verified. The server and a table constraint both refuse it otherwise. Resolving deletes the
screenshot. The note, its details, its history and its point on the position map stay.

## Admin panel

`https://<domain>/admin/`. User `333`, password `333`, as the owner asked. This login is easy to
guess, so anyone who finds the page can read the notes and screenshots and change statuses. To
change the password:

```sql
UPDATE game.feedback_admin
   SET pass_sha256 = encode(sha256(convert_to('hub-feedback-admin:' || 'NEW PASSWORD', 'UTF8')), 'hex')
 WHERE username = '333';
```

Logins are limited to 10 tries per device and 60 in total per ten minutes. A login lasts 12 hours.

The panel has one tab per game and one for the hub, filters by status and option, a search, a
position map per level, the note's screenshot and details, the status form, and JSON and CSV
export.

## RPCs

| RPC | Caller | Purpose |
|---|---|---|
| `feedback.can` | any session | May this player send feedback? |
| `feedback.submit` | signed-in account | Store one note. The game comes from the session. 6 per ten minutes, 40 per day. |
| `feedback.admin.login` | any session | `{user, pass}` → admin token |
| `feedback.admin.list` | admin token | Notes, counts per game and status |
| `feedback.admin.get` | admin token | One note with its screenshot and history |
| `feedback.admin.update` | admin token | Status, resolution, verification, fixing commit |

## Adding it to a game

The window lives in the SDK (`packages/hub-sdk/src/feedback.ts`), so each game only supplies an
adapter:

```ts
import { feedbackTransportFromSdk, installFeedback } from '@metaverse/hub-sdk';

const feedback = installFeedback({
  title: 'My Game',
  version: BUILD_ID,
  transport: feedbackTransportFromSdk(sdk),
  pause: () => game.pause(),          // return false when the game cannot pause
  resume: () => game.resume(),
  context: () => ({ level, mode, position: { x, y }, gameTime, player: { hp } }),
  theme: { font: '"Press Start 2P", monospace', accent: '#ffd23f' },
});
feedback.breadcrumb('level_start', { level });   // optional
pauseMenuButton.onclick = () => feedback.open(); // optional
```

A WebGL game whose loop stops while paused should render one frame in `beforeCapture`, or the
screenshot taken from the pause menu is blank.

The screenshot copies only canvases. A game whose menus or HUD are HTML passes `overlay`, which
returns a whole-viewport canvas of that HTML (transparent where the game shows through), drawn over
the canvases. It may be async; the window waits for it at most 3 s. Without it, an HTML main
menu is missing from the screenshot and only the background behind it shows.

## From a terminal

`scripts/feedback-admin.mjs` lists, reads and updates notes through the same RPCs as the panel.
Agents use it to pick up open notes and to record a fix:

```bash
HUB_URL=https://<domain> NAKAMA_SERVER_KEY=<client key> node scripts/feedback-admin.mjs list --status open
```

Mark a note `fixed` when the change is made, and `resolved` only after the fix has been checked in
a build, with `--verification` saying how.
