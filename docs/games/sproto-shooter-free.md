# sproto_shooter_free: Sproto Shooter online 1v1 (free)

Server side of Sproto Shooter's free online 1v1 (game id `sproto-shooter`; repo `sproto-shooter`,
contract in its `docs/shooter-pvp-protocol.md`). Code: `server/modules/src/games/shooter_match.ts`,
`shooter_matchmaking.ts`, `shooter_protocol.ts`. Tests: `server/test/games/shooter_match.test.ts`,
`shooter_review.test.ts`. No Tickets move: the bundle cannot mint, and this match never stakes.

## Model

The match runs the vendored director (`server/modules/vendor/shooter-pvp-sim.js`, protocol 2 / sim 2)
in its own goja VM. The director owns the seats, the input jitter buffer, lag compensation, the result
and the replay record. The hub routes, rate-limits and keeps the clock.

- **Seeds.** `spawnSeed` is public (WELCOME). The combat seed is 256 bits from `nk.uuidv4()` + sha256,
  made in `matchInit`, held only by the director, committed by sha256 at start and revealed in RESULT.
  It is never logged, labelled, signalled or put in Nakama match state.
- **Routing.** Each director message has `to`: null goes to every present seat; otherwise only to the
  sender (REJECT, PONG) or to the stored presence (with its node) of that user and session, else it is
  dropped. Snapshots are per seat, so a seat's private state never reaches the other seat.
- **Traffic.** Messages from a session that is not the account's current presence are dropped. At most
  56 messages per sender per loop. At most one REJECT per sender and reason per loop.
- **Clock.** The match clock follows wall time between loops (a late loop catches up, up to the
  director's 4 ticks per advance), never runs backwards, and moves at most 250 ms per loop on a jump.
- **Lifecycle.** "done" is sticky: nothing reopens a finished match. A seated account may rejoin during
  the 10 s linger for WELCOME, the final snapshot and a copy of RESULT. `matchTerminate` sends
  `cancel/server_shutdown` if the director had no RESULT yet, and every grace loop after it only
  cleans up. A director exception ends the match the same way.
- **Flag.** `shooter_pvp` stays `off` in `game.server_flags`. Off refuses a new free queue (`pvp_off`) and a new free room. A match that already exists keeps running, including reconnect, until it ends. `shooter_pvp_wager` is a second flag: a hold still needs both. Turning only the wager flag off stops new holds and leaves free play up.
- **Private rooms.** `shooter.room_create` codes are 12 characters from the CSPRNG. Only the host and
  accounts admitted by `shooter.room_join` (which signals `admit:<uid>`, at most 8) may join; the
  label carries `private: true`. A queued account cannot create or join a room (`already_queued`).
- **Metrics.** `shooter.metrics` answers the server (http key) for any match, and a game session only
  for a match it holds a seat in.

## Replay records (`SHOOTER_PVP_REPLAY`)

With the runtime env `SHOOTER_PVP_REPLAY=1`, after the director's RESULT has gone out, a later loop
runs `replayJSON(director.replayRecord())` and stores the record write-once, server-only, in storage
collection `sproto_shooter_replay` (key = match id, system user, permissions 0/0). A mismatch is
logged without the record. A lobby cancel (no sim) and a match shut down before its RESULT store
nothing.

- **Off by default.** A full replay costs about 0.5 s of goja CPU on the match goroutine and a record
  is about 110 KB. Free play settles nothing, so production leaves the flag unset
  (`deploy/nakama/config.yml`); the compose stack sets it so the suites cover it. Wagers will require it.
- **Retention.** Records older than 30 days are deleted by a sweep that runs after a store, at most
  once an hour per node, over at most 1000 records per run.

## Re-vendoring

The pin is checked by `scripts/check-shooter-pvp-sim-version.mjs`. The pin commit must be shooter
`main` or an ancestor of it with no later sim-source change. To move to a new shooter commit:

```bash
node scripts/revendor-shooter-pvp.mjs <sproto-shooter main sha>
node scripts/check-shooter-pvp-sim-version.mjs && node scripts/check-shooter-sim-version.mjs
```

The script builds that commit in a scratch clone with a scrubbed environment, refuses any contract
change, checks the golden and a hosted-director replay, and re-pins the campaign verifier when only
its baked commit moved. `node scripts/revendor-shooter-pvp.test.mjs` covers it offline.

## Live-Nakama checklist (before enabling)

`npm run test:dup`, `npm run test:rt` and `npx tsx scripts/load/shooter-bots.ts` against the compose
stack, then check by hand:

1. Two clients see only their own `you` block in snapshots; PONG reaches only the pinger.
2. Reconnect on a new socket: HELLO rebinds; the old socket's traffic is ignored.
3. Rejoin after RESULT (within 10 s) gets WELCOME, the final snapshot and RESULT.
4. RESULT's `combatSeed` hashes to the WELCOME `combatCommit`; nothing earlier carries it.
5. A stranger with the match id from ListMatches cannot join a private room.
6. `docker compose restart nakama` mid-match: one `server_shutdown` RESULT, no snapshots after it, no
   replay record for that match.
7. With `SHOOTER_PVP_REPLAY=1`: a finished match has a `sproto_shooter_replay` row (verified) and the
   metrics `replay.status` is `done`; without it, `off` and no row.
8. Loop p95 under 10 ms with 10 live matches (`shooter-bots.ts`), and the clock keeps up when the node
   is loaded (snapshot `tick` tracks wall time).
