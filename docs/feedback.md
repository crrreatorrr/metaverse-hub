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

## Check

**Check** at the top of the panel starts the agent on every note that is not resolved yet.

1. The panel calls `feedback.admin.check`. The server queues one run in `game.feedback_run`
   (migration `0064_feedback_check`). A unique index allows one queued-or-running run, so a second
   press, or a press in another tab, shows the run already in flight instead of starting another.
2. The worker on the owner's computer claims the queued run and starts Claude Code headless with
   `docs/feedback-check.md`, the playbook. Start it once and leave it running:

   ```bash
   HUB_URL=https://<domain> NAKAMA_SERVER_KEY=<client key> node scripts/feedback-worker.mjs
   ```

   Until a worker runs, the panel says the run is waiting for the worker. On the local dev server
   (`npm run dev`, `http://127.0.0.1:5173/admin/`) the panel has a **Start worker** / **Stop
   worker** control with the worker's log instead: the dev server starts the worker in the
   background (`apps/hub/feedback-worker-dev.ts`), writing to `~/.feedback-worker/worker.log`.
   Production serves the panel without that control.
3. The agent marks each note `in_progress`, fixes them with one subagent per game repo, each on
   its own branch and pull request, and marks them `fixed`. A separate verifier subagent then checks
   each fix against the note. A note becomes `resolved` only when the fix is verified and merged to
   `main`, with the evidence as its verification note. A verified fix whose PR is still open stays
   `fixed` with the evidence in its history, and the next Check after the merge resolves it. Notes
   it cannot fix go back to `open` with a comment saying what the owner needs to decide.
4. The worker sends a heartbeat every minute. The panel shows the run's state and, at the end,
   the agent's summary. A run whose heartbeat stops for 30 minutes is marked failed, so a crashed
   worker does not block the next Check. **Cancel** in the panel stops the agent at its next
   heartbeat. Notes keep the status they had reached. Every note change the agent makes names its
   run, and the server refuses it once the run is canceled or over, so a stopped agent changes
   nothing more. If the worker itself is killed, its next start stops the agent it left behind.

### Pull request state

Each note can carry the pull request with its fix (the agent sets it; the panel's form edits it).
The list and the note show its status next to the PR's state: open, draft, merged or closed. The
worker keeps those current: every two minutes it asks GitHub (`gh pr view`, with the `gh` login
on that computer) about the PR of every unresolved note and reports the answers with
`feedback.admin.prstate`. A change of state goes into the note's history. The panel refreshes the
list every 30 seconds, so a merge shows on its own. `FEEDBACK_PR_SYNC_SECONDS` changes the
interval; `0` turns the sync off. Without a running worker the states stop updating.

The worker never merges, deploys or pushes to `main`. Its log for each run is in
`~/.feedback-worker/run-<id>.log`. `--dry-run` claims and closes runs without starting the
agent, to test the wiring; `--once` works one run and exits. While the agent works, the worker
prints each step (and each subagent's steps, labelled with the subagent) to its terminal and the
run log, and the panel's run bar shows the latest one. The raw stream is kept in
`~/.feedback-worker/run-<id>.jsonl`.

## RPCs

| RPC | Caller | Purpose |
|---|---|---|
| `feedback.can` | any session | May this player send feedback? |
| `feedback.submit` | signed-in account | Store one note. The game comes from the session. 6 per ten minutes, 40 per day. |
| `feedback.admin.login` | any session | `{user, pass}` → admin token |
| `feedback.admin.list` | admin token | Notes, counts per game and status |
| `feedback.admin.get` | admin token | One note with its screenshot and history |
| `feedback.admin.update` | admin token | Status, resolution, verification, fixing commit, pull request link |
| `feedback.admin.prstate` | admin token | The worker reports each linked PR's state from GitHub |
| `feedback.admin.check` | admin token | Queue a check run over every unresolved note, or return the one in flight |
| `feedback.admin.runs` | admin token | The run in flight and the latest runs |
| `feedback.admin.claim` | admin token | The worker takes the queued run |
| `feedback.admin.run` | admin token | The worker's heartbeat and result; the panel's cancel |

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

## From a terminal

`scripts/feedback-admin.mjs` lists, reads and updates notes through the same RPCs as the panel.
Agents use it to pick up open notes and to record a fix:

```bash
HUB_URL=https://<domain> NAKAMA_SERVER_KEY=<client key> node scripts/feedback-admin.mjs list --status open
```

Mark a note `fixed` when the change is made, and `resolved` only after the fix has been checked in
a build, with `--verification` saying how.
