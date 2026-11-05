# sproto_arena: Sproto Duel online 1v1

Server side of Sproto Duel's online mode (game id `sproto`; repo `sproto-duel`, client in `src/net/`).
Code: `server/modules/src/games/sproto_arena.ts`. Tests: `server/test/games/sproto_arena.test.ts`.
It follows the realtime contract in `docs/realtime.md` (C1–C14).

## Model

The duel's simulation needs Rapier (WASM) and three.js, which Nakama's goja runtime can't run. So one
client, the **host** (picked at random per match), runs the fight, and this match **relays and referees**:

- guest `INPUT` goes only to the host, host `SNAPSHOT`s only to the guest (relayed unparsed, size-capped);
- the host reports each `ROUND`; both clients report a `RESULT` at the end;
- the match decides an `OUTCOME`. A verified or qualifying forfeit win is recorded on `sproto_wins` and does not mint Tickets (migration `0031_story_boss_tickets`).

## Opcodes

| Op | Name | Direction | Body |
|---|---|---|---|
| 1 | HELLO | c→s | `{v, staff}`; `v` ≠ `NET_VERSION` → CANCEL `version_mismatch` |
| 2 | START | s→each | `{seat, hostSeat, names, staffs, rules:"online1", seed}` once both said HELLO |
| 3 | SIGNAL | c→s→peer | opaque (reserved for WebRTC) |
| 10 | INPUT | guest→s→host | `{t, f}` packed intent frames; ≤ 2 KB |
| 11 | SNAPSHOT | host→s→guest | encoded snapshot; ≤ 8 KB |
| 12 | ROUND | host→s | `{round, winnerSeat, reason, wins}` |
| 13 | RESULT | c→s | `{winnerSeat, wins, rounds}` |
| 14 | OUTCOME | s→c | `{status, winnerSeat, reason, paid:{userId:n}, balances}` |
| 15 | CANCEL | s→c | `{reason, seat?}` before START (`version_mismatch`, `join_timeout`, `opponent_left`, `room_expired`) |
| 16 | PEER | s→c | `{seat, present, graceS}` |
| 17 | PING | c→s→c | `{c}` → `{c, s: tick}` |
| 18 | FORFEIT | c→s | `{}` |
| 19 | ACCEPT | c→s | `{v, staff?}`. Quick-match accept window only. `v` is required unless this seat already sent HELLO with the matching version; a bad `v` is CANCEL `version_mismatch`. `staff` is normalised the same way as HELLO. |
| 20 | DECLINE | c→s | `{}`. Accept window only. Ends the match (see below). |
| 21 | FOUND | s→one seat | `{acceptS: 10, seat, accepted: [boolean, boolean], names: [string, string]}`. Sent to a seat when it joins a quick match, and to both seats whenever one of them accepts. |
| 22 | ACCEPT_END | s→each present seat | `{status: "declined" \| "accept_timeout", bySeat: number \| null, next: "queue" \| "lobby"}`. `next` is that seat's own next step. Nothing is paid and nothing is written to `sproto_wins` or `sproto_pvp_result`. |
| 23 | REMATCH | c→s | `{yes: boolean}`. Only while a rematch window is open (see below). |
| 24 | REMATCH_STATE | s→both | One of: `{phase: "open", waitS: 15}`, `{phase: "offered", seat, waitS: 15}`, `{phase: "started", matchId, waitS: 0}`, `{phase: "closed", reason: "declined" \| "rematch_timeout", next: "lobby", waitS: 0}`. |

Opcodes are per match (C8). `NET_VERSION` is `"2"`. It must match `sproto-duel/src/net/protocol.ts`.

## Accept window (quick match only)

A matchmaker pair is created in phase `accept`, not `joining`. The 10 second clock (`ACCEPT_S`) starts when the match is created. Both seats must be present and must each send ACCEPT (and a matching version, via ACCEPT or an earlier HELLO) before the clock fires. When both have, the fight starts exactly as before: phase `playing`, and each seat gets START.

Private rooms and rematch matches skip this window. Both players already chose each other, so those matches stay on the old path: phase `joining`, both HELLO, then START. They do not send or expect FOUND / ACCEPT / ACCEPT_END.

| How it ends | `status` | Who gets `next: "queue"` | Who gets `next: "lobby"` |
|---|---|---|---|
| One seat sends DECLINE, or leaves | `declined` | the other seat | the seat that declined or left (`bySeat` is that seat) |
| 10 s elapses | `accept_timeout` | each seat that sent ACCEPT | each seat that did not (`bySeat` is `null`) |

A seat that never joined does not get ACCEPT_END. If it joins after the window, `matchJoinAttempt` rejects with `declined` or `accept_timeout` (not `match_over`). Treat `declined` as "re-queue if you did not send DECLINE". Treat `accept_timeout` as lobby if you never accepted.

CANCEL is unchanged for `version_mismatch`, `join_timeout`, `opponent_left`, and `room_expired`. Those are not accept-window results.

## Rematch

After any finished outcome except `server_shutdown`, if both sockets are still in the match, the server sends REMATCH_STATE `{phase: "open", waitS: 15}`. Either seat may then:

- `{yes: true}` with no offer yet: that seat offers. Both get `{phase: "offered", seat, waitS: 15}` and the 15 s clock restarts.
- `{yes: true}` from the other seat: the server creates **one** new `sproto_arena` match (host rolled again, new seed, same two players, same seat order) and sends `{phase: "started", matchId, waitS: 0}`. A repeat yes sends the same `matchId` and does not create another match. The new match skips the accept window (`rematch: "1"`). Both join it and HELLO, then START, as a private room does. Creating the rematch mints no Tickets.
- `{yes: false}`, or either seat leaving: `{phase: "closed", reason: "declined", next: "lobby", waitS: 0}`.
- Nobody offers, or the offer is not accepted, within 15 s: `{phase: "closed", reason: "rematch_timeout", next: "lobby", waitS: 0}`.

The old match then lingers 2 s and ends. A shutdown does not open a rematch window.

## Queue leave and one match per pair

Quick match is still `addMatchmaker` / `removeMatchmaker` on the socket (2 players, `+properties.game:sproto +properties.v:2`, string properties `{game: "sproto", v: "2"}`). Leaving the queue is Nakama's `MatchmakerRemove` with the ticket the add returned. The server's `MatchmakerRemove` before-hook drops that session's queue row so the same player can search again.

`MatchmakerAdd` for `game: "sproto"` is rejected, after the usual scope check, with:

- `already_queued` — this user already has a sproto queue row for a socket that is still connected. The same session is always rejected. A different session is rejected only while `streamUserGet` still finds it on the notifications stream (mode 0, subject = that user), which is the stream every socket joins and leaves when the socket drops. A row whose session is absent is replaced by this ticket. Two live sockets that add together are serialised by the storage version: one write wins, the other reads that row and is rejected. Nakama 3.41's JavaScript runtime has no session-end hook, so the row is cleared on the next add rather than at the instant of the disconnect. There is no timed hold.
- `already_in_match` — this user is seated in a live `sproto_arena` match (quick match, private room, or a rematch that was just created).

Nakama 3.41 does not pass the matchmaker ticket into the JavaScript matched hook. The pair key is `sha256` of the sorted `t:<ticket>` values when a ticket is present, otherwise `p:<userId>:<sessionId>`. A second matched call for that key, while the match still exists, returns the same match id and does not call `matchCreate` again. If either user is already seated in a different live match, the hook creates nothing.

Joining a match while seated in a different live one is rejected with `already_in_match`.

## Online count

`sproto.online_count` with an empty payload. Caller must be a `sproto` game session (guests included); otherwise `wrong_scope`.

Response: `{online: number, queued: number, ageMs: number}`.

- `online` is the sum of `size` over at most 100 authoritative matches with `+label.kind:sproto_arena` (players already in a match, including the accept window).
- `queued` is this node's count of sproto queue rows.
- The handler recomputes at most once every 3 seconds per node. A call inside that window returns the cached counts and a non-zero `ageMs`. The RPC only reads.

## Joining

- **Quick match:** `addMatchmaker({query: "+properties.game:sproto +properties.v:2", minCount: 2, maxCount: 2,
  stringProperties: {game: "sproto", v: "2"}})`. `HubGames` routes `game: "sproto"` to `SprotoArena.onMatched`, which
  pairs two different users of the same version and starts the accept window above.
- **Private room:** `sproto.room_create {v}` → `{matchId, code}` (6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`).
  `sproto.room_join {code, v}` → `{matchId}` via `+label.kind:sproto_arena +label.code:<code> +label.open:T`, or
  `room_not_found` / `version_mismatch`. The creator joins its match id directly (listings lag about 1 s).
- Only game-scope sessions of `sproto` may join (`wrong_scope` otherwise); `ctx.vars.sid` is kept per player
  for Ticket grants. Label: `{"game":"sproto","kind":"sproto_arena","v":"2","open":bool,"code":""|"ABC234"}`.
  Private rooms do not use the accept window.

## Referee

| Situation | Outcome | Paid |
|---|---|---|
| Both RESULTs equal, winner has 2 wins, matching the recorded ROUNDs, elapsed ≥ 15 s | `verified` | no (recorded on `sproto_wins`) |
| RESULTs differ, or implausible (rounds out of order, too quick, wins don't add up) | `disputed` | no |
| Both report no winner | `draw` | no |
| FORFEIT, or a player gone > 10 s (RECONNECT), or a stall (no INPUT / no SNAPSHOT for 10 s while the other streams) | `forfeit` to the other | no; the win is recorded after ≥ 1 finished round and ≥ 15 s |
| One RESULT and the other player gone for 5 s | `forfeit` to the reporter | same recording rule, no Ticket mint |
| One RESULT, the other present but silent for 15 s | `disputed` | no |
| Both gone | `both_left` | no |
| Over 8 minutes | `timeout` | no |
| matchTerminate | `server_shutdown` | no |

Host gone means the match is over (no host migration in v1): the guest wins by forfeit under the same rules.

## Tickets and the board

On a verified win, or a forfeit after at least one finished round and 15 seconds, one SQL statement inserts
`game.sproto_pvp_result (match_id PK, winner, loser, day, status, paid)`. The `paid` column is still the old
pair/daily cap decision (fewer than 5 paid rows for the pair today and fewer than 10 for the winner, UTC).
It no longer causes a Ticket mint. `HubBoards.recordWin(winner, "sproto_wins", matchId)` still runs for every
verified or forfeit win. `payout` does not call `HubEconomy.earn`.
Guest matches use that same path: a verified RESULT still posts the winner to `sproto_wins`.
An accept-window ending (`declined`, `accept_timeout`) posts nothing and writes no ledger row.
A rematch creates no Ticket grant.

Migration `0020_sproto_pvp` created `('sproto','srv_pvp_win', max_amount 20)`. Migration `0031_story_boss_tickets`
sets that `max_amount` to 0, so a leftover earn of any positive amount returns `amount_over_rule`. `tickets.earn`
still refuses `srv_*` reasons from clients.

## Honest limits

The guest's game is a replica of the host's snapshots, so "both RESULTs agree" catches a modified guest and
quick-quit farming, **not** a modified host. The host is random (a cheater hosts about half the time). An online
win no longer mints Tickets, so that path does not add to the 1000/day game cap.

## Tuning (server constants)

`TICK_RATE 30`, `ACCEPT_S 10`, `REMATCH_S 15`, `JOIN_TIMEOUT_S 30`, `ROOM_TIMEOUT_S 300`, `RECONNECT_S 10`,
`STALL_S 10`, `MAX_PLAY_S 480`, `MIN_PLAY_S 15`, `LINGER_S 2`, `RESULT_WAIT_S 5`, `MIN_ROUND_S 2`,
`MAX_MSGS_PER_TICK 4`, `PVP_WIN_TICKETS 0`, `PVP_PAIR_DAILY 5`, `PVP_DAILY_PAID_WINS 10`.
The menu count is cached for `COUNT_CACHE_S` 3. A queue row is reusable as soon as its socket is gone from the notifications stream.

## Verified live (2026-11-04, before migration 0031)

This note describes the build that still minted 20 T per verified online win. Migration `0031_story_boss_tickets` stops that mint.

Against Nakama 3.41.0 + Postgres 16.8 (own containers on port 7360) with this module: migration
`0020_sproto_pvp` applied, the RPCs and match registered, and two bot accounts through the real
portal flow (device auth → `portal.enter {game:"sproto"}` → custom auth with the ticket) driving the
sproto-duel client's `OnlineSession` + `HubLobby` over the SDK realtime client: quick match, START,
about 500 snapshots and 1000 input frames relayed, PINGs, two ROUNDs, agreeing RESULTs →
`verified`, exactly one `srv_pvp_win:20` ledger row; the public `tickets.earn` with `srv_pvp_win`
answers `server_reason`; a private room joined by its lowercase code, and a quick FORFEIT paid
nothing. The payout statement was also run directly: repeat → no second row, the 6th paid win of a
pair in a day → `paid = false`, a new pair → paid.
