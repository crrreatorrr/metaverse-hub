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

Opcodes are per match (C8). `NET_VERSION` here and in `sproto-duel/src/net/protocol.ts` must match.

## Joining

- **Quick match:** `addMatchmaker({query: "+properties.game:sproto +properties.v:<V>", minCount: 2, maxCount: 2,
  stringProperties: {game: "sproto", v}})`. `HubGames` routes `game: "sproto"` to `SprotoArena.onMatched`, which
  pairs two different users of the same version.
- **Private room:** `sproto.room_create {v}` → `{matchId, code}` (6 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`).
  `sproto.room_join {code, v}` → `{matchId}` via `+label.kind:sproto_arena +label.code:<code> +label.open:T`, or
  `room_not_found` / `version_mismatch`. The creator joins its match id directly (listings lag about 1 s).
- Only game-scope sessions of `sproto` may join (`wrong_scope` otherwise); `ctx.vars.sid` is kept per player
  for Ticket grants, and `ctx.vars.ranked` is kept so a `"0"` session pays nothing. Label:
  `{"game":"sproto","kind":"sproto_arena","v":"1","open":bool,"code":""|"ABC234"}`.

## Standalone session (no portal ticket)

A visitor who never entered the plaza portal still gets a session this match accepts, and only for 0-Ticket play. The portal `t:` custom-auth path is unchanged.

1. Device or email auth, as today. `beforeAuthenticateDevice` / email auth forces `{scope:"hub"}` and drops client vars.
2. That hub session calls `sproto.standalone_session` with `{"app":"sproto-duel"}`. `app` is a public marker, not a secret. Any other field is ignored. The client does not choose `scope`, `game`, `sid`, or `ranked`.
3. The server mints a token with `nk.authenticateTokenGenerate`. Its vars are exactly `{scope:"game", game:"sproto", sid:<server uuid>, ranked:"0"}`. The reply is `{token, exp, sid}`. There is no refresh token; the access token lasts `token_expiry_sec` (7200). Open the socket with this token. Refreshing the original hub refresh token stays scope `hub`.

Nakama stores those vars in the session JWT (`vrs`). Match join, `sproto.room_create`, `sproto.room_join`, and the matchmaker read `ctx.vars` from it, the same way they read a portal game token.

Rate limits are storage counters (one row per bucket, claimed with the row version so concurrent calls cannot share a slot), counted only after the marker and the hub-scope check:

| Bucket | Limit | Window |
| --- | --- | --- |
| user id | 10 | 10 minutes |
| each linked device id | 10 | 10 minutes |
| client IP (`ctx.clientIp`), when Nakama set one | 40 | 10 minutes |

A full bucket answers `{error:"rate_limited"}` and does not mint. Other errors: `unauthorized`, `wrong_scope`, `bad_json`, `bad_app`, `mint_failed`.

`ranked:"0"` does not wager and does not earn Tickets from this match: a verified or forfeit win still calls `HubBoards.recordWin` (`sproto_wins`) and skips `HubEconomy.earn` and the paid-cap row. The standalone `sid` is not a `game.game_session` row, so `tickets.earn`, `session.event`, `tickets.spend`, `tickets.sell`, and `tickets.exchange` come back `session_closed` from SQL. `save.put` does not mint Tickets, Relics, or items. Sproto Fighter wagers stay on the hub session. This token's game is `sproto`, so a Fighter matchmaker ticket is `wrong_game` and never reaches `sproto_wager_hold`.

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

Host gone means the match is over (no host migration in v1): the guest wins by forfeit under the same rules. Tickets are paid only when the winner's session var `ranked` is the explicit marker `"1"`; missing, empty, `"0"`, or anything else pays 0 T.

## Tickets and the board

On a verified win, or a forfeit after at least one finished round and 15 seconds, one SQL statement inserts
`game.sproto_pvp_result (match_id PK, winner, loser, day, status, paid)`. The `paid` column is still the old
pair/daily cap decision (fewer than 5 paid rows for the pair today and fewer than 10 for the winner, UTC).
It no longer causes a Ticket mint. `HubBoards.recordWin(winner, "sproto_wins", matchId)` still runs for every
verified or forfeit win. `payout` does not call `HubEconomy.earn`.
A joiner whose session var `ranked` is not the explicit marker `"1"` skips the paid-cap insert. The board post still runs. Standalone device auth uses `ranked` `"0"`.

Migration `0020_sproto_pvp` created `('sproto','srv_pvp_win', max_amount 20)`. Migration `0031_story_boss_tickets`
sets that `max_amount` to 0, so a leftover earn of any positive amount returns `amount_over_rule`. `tickets.earn`
still refuses `srv_*` reasons from clients.

## Honest limits

The guest's game is a replica of the host's snapshots, so "both RESULTs agree" catches a modified guest and
quick-quit farming, **not** a modified host. The host is random (a cheater hosts about half the time). An online
win no longer mints Tickets, so that path does not add to the 1000/day game cap.

## Tuning (server constants)

`TICK_RATE 30`, `JOIN_TIMEOUT_S 30`, `ROOM_TIMEOUT_S 300`, `RECONNECT_S 10`, `STALL_S 10`, `MAX_PLAY_S 480`,
`MIN_PLAY_S 15`, `LINGER_S 2`, `RESULT_WAIT_S 5`, `MIN_ROUND_S 2`, `MAX_MSGS_PER_TICK 4`, `PVP_WIN_TICKETS 0`,
`PVP_PAIR_DAILY 5`, `PVP_DAILY_PAID_WINS 10`.

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
