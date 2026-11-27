# sproto_racer: Sproto Racer online races

Server side of Sproto Racer's online races (game id `sproto-racer`; repo `Sproto-Racer`, wire format in
its `docs/online-netcode.md`). Code: `server/modules/src/games/racer_match.ts` and `racer_protocol.ts`.
Tests: `server/test/games/racer_match.test.ts` (offline) and the `racer:` cases in
`server/test/rt/realtime.test.ts` (real Nakama). A race grants nothing: no Tickets, no Relic, no score.
The only row it writes is a room code in storage collection `sproto_racer`, deleted when the room closes.

**It is off until the owner turns it on.** New rooms need the `racer_online` server flag, which has no
row in `game.server_flags`, and a missing row is off. The game has no menu entry for online races yet
either, so merging and deploying this changes nothing a player can reach.

## Model

The race is the vendored match host (`server/modules/vendor/racer-sim.js`): one simulation that every
player's game also runs. Players send their inputs a few ticks ahead. On each loop the host takes the
inputs for that tick, steps once and tells everyone which inputs it used; each game corrects itself
from that. The hub passes presences and messages through and decides who may join.

- **One room, one VM.** The host object lives in the match's own goja VM for the whole match. Nakama
  copies the match state to Go and back on every callback, 60 times a second, so the state is a dozen
  scalars and everything else stays beside the host. If the VM dies the race is gone.
- **Loop.** 60 Hz, one `host.tick()` per loop and never a catch-up loop. Nakama queues the loops a slow
  tick delays and closes the match if 256 are waiting (`match.call_queue_size`).
- **Grid.** Six karts. Up to six players; the AI drives every seat nobody holds. Three laps. The server
  picks the seed, and the circuit when nobody asked for one.
- **Who joins.** Only a `sproto-racer` game session. One account, one socket: a second socket takes
  over and the first is kicked. Messages from a socket that is not the account's current one are dropped.
- **Names.** The name other players see is the hub account's, through `HubMatch.cleanName`. The name a
  client puts in HELLO is replaced.
- **After the start.** Nobody new joins. An account that holds a seat may always come back: while it is
  away the AI drives its kart, and on return it is sent the whole race state in chunks of at most 4096 bytes.
- **Messages.** Every send names its presences. Binary messages go out as a fresh `ArrayBuffer`:
  Nakama 3.41 rejects a `Uint8Array`, and it keeps the buffer until the socket writes it.

## Rooms

| | Private room | Quick race |
|---|---|---|
| Made by | `racer.room_create` | two to six matched tickets (`properties.game:sproto-racer`) |
| Who gets in | the creator, and accounts that used the code (`racer.room_join`, at most 16) | anyone while it is in the lobby with a place free |
| Label | `open: false`, `private: true`, never the code | `open: true` with the player count, so the game's search finds it |
| Starts | when everyone in the lobby is ready | when everyone is ready, or 45 s after the first player is in |

A room closes when its lobby has been empty for 30 s, when its lobby has not started within 15 minutes,
when every player has been gone from the race for 30 s, 20 s after the race finishes, on a host error
and at shutdown. Players still connected get an `ERROR` message with the reason (`lobby_timeout`,
`server_error`, `server_shutdown`), except after a finished race.

Room codes are six characters from the game's alphabet, made from Nakama's CSPRNG. A code is an
invitation, not a password for the match id: knowing the match id does not get an account in.

## RPCs

All take a `sproto-racer` game session, except `racer.metrics`.

| RPC | Body | Answer |
|---|---|---|
| `racer.version` | `{}` | versions, the circuit ids, and `enabled`: whether this account may open a room or queue |
| `racer.room_create` | `{ version?, simVersion?, courseId?, mode?, maxSeats? }` | `{ matchId, code, maxSeats }` |
| `racer.room_join` | `{ code, version?, simVersion? }` | `{ matchId }` |
| `racer.online_count` | `{}` | `{ count, rooms }`: players in rooms, at most 3 s old |
| `racer.metrics` | `{ matchId }`, http key only | loop times and the host's counters for one room |

Errors are `{ error, message }`: `wrong_scope`, `version_mismatch`, `sim_version_mismatch`,
`invalid_course`, `bad_mode`, `online_off`, `maintenance`, `rate_limited`, `busy`, `room_not_found`.

## Limits

| Limit | Value | Why |
|---|---|---|
| Players in a room | 6 | Twelve karts cost three times as much and had single ticks over the 16.7 ms budget in the game's own goja measurement. Raise `MAX_HUMANS` and `SEATS` after measuring twelve on the production host. |
| Rooms on the node | 12 | Each room is a VM stepping 60 times a second. `busy` beyond that. |
| Rooms one account creates | 5 a minute | |
| Code lookups by one account | 8 in 10 s | So codes cannot be guessed in bulk. |
| Messages | the host's own budgets | 72 inputs a second with a burst of 240, 5 control messages a second with a burst of 10. Over that, input is dropped and counted. |

`maint.begin` refuses new rooms and tickets, and `maint.live` counts a room with players as a hard
match, so a deploy drain waits for races.

## Turning it on

```sql
INSERT INTO game.server_flags (key, state) VALUES ('racer_online', 'on')
ON CONFLICT (key) DO UPDATE SET state = 'on', updated_at = now();
```

`allowlist` and `percent` work as for every flag (`server/README.md`). Turning the flag off stops new
rooms and tickets; a room that exists runs to its end. A change is seen within five seconds.

## Measured

On an Apple M5 Pro, Nakama 3.41.0 in Docker (`server/docker-compose.yml`), 27 November 2026.

One full race: Test Track 01, three laps, six karts. Three were players running the game's own
client (`src/net/rollback-client.js` at Sproto-Racer `7855a8c`, steered by the AI's decision code)
over real sockets through the hub SDK; three were the server's AI. One player's socket was dropped
for three seconds, twenty seconds in.

| | |
|---|---|
| Race length | 19,356 ticks (5 min 23 s) |
| Client and server agreement | The clients compared their state with the server's 646, 646 and 640 times. None differed. All three ended on the server's result, and its hash equalled the hash of each client's own final state. |
| The dropped player | Came back with one state message of 5,692 bytes (two chunks) and stayed in agreement to the end. The AI drove the kart meanwhile. |
| Match loop: Nakama's copy of the state, the hub's routing and the host's tick, 19,480 loops | Mean 2.41 ms of the 16.7 ms a loop has. Of the last 600 loops half took 2 ms or less, 95% 3 ms or less, 99% 4 ms or less (`Date.now()` counts whole milliseconds). Ten loops took more than 8 ms. |
| Slowest loop | 58 to 87 ms over three runs: the loop in which everyone is ready and the host builds the circuit. It comes once, two seconds before the race starts, and Nakama runs the few loops it delays straight after. |
| Input from the players | 28,949 messages carrying 57,891 input frames. 26 arrived late (around the drop), one was refused (sent before the returning player had said HELLO), none was malformed or over the rate. |

The game's own measurement of the same host in bare goja on the same machine is 1.33 ms a tick
(its `docs/online-netcode.md`); the rest of the 2.41 ms is Nakama and Docker.

Not measured: the production host, twelve karts, and a real network (the clients ran on the same machine).

## Re-vendoring

A client whose simulation version differs from the bundle's is refused at HELLO
(`sim_version_mismatch`), and the version changes whenever anything under the game's `src/sim` or its
match host changes. The game build players load and this bundle therefore go live together.

```bash
node scripts/revendor-racer.mjs <path to a Sproto-Racer checkout>
npx tsx server/test/games/racer_match.test.ts
```

The script copies `build/racer-sim.js`, writes `vendor/racer-sim.pin.json` and rewrites the pinned
constants in `racer_protocol.ts`. The test fails when the file, the pin and the constants disagree, and
it runs the game's own 240-tick smoke race to the hash in the pin.

## Not built

- The game's menu entry and lobby screen. The game has the client (`src/net/hub-lobby.js`,
  `src/net/online-runner.js`) and a developer-only test race, nothing a player can open.
- Car and character unlocks. The host accepts every car and driver in the roster, which is right while
  the game's unlock table is empty. When it is filled, the hub has to pass the account's Relics in.
- A countdown for the forced start of a quick race: the race starts and the clients are told, but
  nothing announces the 45 s beforehand.
- One quick-race room per matched group is not guaranteed if Nakama repeats a match callback: a second
  room would sit empty and close after 30 s.
- A replay log, results kept anywhere, a rematch.
