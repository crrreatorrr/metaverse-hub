# Sproto Fighter online duels

Server side of Sproto Fighter's online 1v1 (game repo: `crrreatorrr/Sproto-Fighter`,
`docs/MULTIPLAYER-PLAN.md`). Every wagered duel stakes **10 Tickets** per player;
the winner takes the 20-Ticket pot. Tickets have no real-money value.

## Pieces

| File | Role |
| --- | --- |
| `server/modules/src/sproto_duel.ts` | `sproto_duel` match handler and the matchmaker hook |
| `server/modules/src/schema.ts` (`0010_sproto_fighter_wagers`) | Escrow table `game.sproto_wager` and its SQL functions |
| `server/modules/vendor/sproto-sim.js` | The game's simulation, generated in the game repo |
| `server/modules/append-vendor.mjs` | Appends vendor files to `build/index.js` after `tsc` |
| `server/modules/src/sproto_sim.d.ts`, `sproto_nakama.d.ts` | Declarations for the above and for Nakama match APIs |

## Flow

1. Each client opens a Nakama socket with its hub session and adds a matchmaker
   ticket with properties `game=sproto-fighter`, `wager=1|0`, `sim=<fingerprint>`
   (2 players, same wager setting, same simulation build).
2. `SprotoDuel.onMatched` creates a `sproto_duel` match for the pair and expires
   any escrow a crashed match left behind.
3. Both join and send `HELLO {fighter, stage, sim}`. When both have, a wagered
   match calls `game.sproto_wager_hold`; on any error both get `CANCEL {reason, seat}`
   and nothing is held. Otherwise each gets `START {seat, fighters, stage, names, wager}`.
4. Peers connect over WebRTC; `SIGNAL` messages are relayed between them. If no
   direct connection forms, input packets travel as `RELAY` through the match.
5. **Each client streams its own inputs** (`INPUTS {start, masks}`). The match runs
   the game's simulation frame by frame as both streams arrive, so the server sees
   the KO itself and calls `sproto_wager_settle` for the winner (or refunds a
   double KO). No client reports a result: a loser cannot withhold one, and a
   player can only speak for their own inputs.
6. Everyone gets `OUTCOME {status, winnerSeat, reason, deltas}`.

| Opcode | Direction | Body |
| --- | --- | --- |
| 1 `HELLO` | client → server | `{fighter, stage, sim}` |
| 2 `START` | server → each client | `{seat, fighters, stage, names, wager}` |
| 3 `SIGNAL` | client → server → peer | WebRTC offer/answer/ICE, opaque |
| 4 `RELAY` | client → server → peer | base64 input packet (fallback transport) |
| 6 `OUTCOME` | server → clients | `{status, winnerSeat, reason, wager, stake, deltas}` |
| 7 `CANCEL` | server → clients | `{status: "cancelled", reason, seat}` |
| 8 `INPUTS` | client → server | `{start, masks}`, this player's own inputs |

## Outcomes

| Situation | Result |
| --- | --- |
| Server simulation reaches a KO | Winner paid the pot (`verified`) |
| Double KO | Both refunded (`draw`) |
| A player leaves and doesn't return within 10 s | Opponent paid (`forfeit`) |
| A player's input stream stalls 10 s while the other's continues | Opponent paid (`forfeit`) |
| Both leave | Refund (`both_left`) |
| No result after 15 minutes of play | Refund (`timeout`) |
| A player can't cover the stake, isn't eligible, or hits a limit | `CANCEL`, nothing held |
| Server shutdown mid-match | Refund (`server_shutdown`) |
| Escrow still held after 15 minutes | Refunded by `sproto_wager_expire` (`expired`) |

## Escrow

`game.sproto_wager` rows are `held`, then `settled` or `refunded`, all keyed by
match id. `sproto_wager_hold`, `_settle` and `_refund` are idempotent and lock both
players' `economy:` advisory locks in a fixed order. Moves write `tickets_ledger`
rows with kinds `duel_stake`, `duel_payout` and `duel_refund`, referenced to the
wager id. They move existing Tickets and never touch `earn_window` or the session
earn cap.

Abuse limits, passed by the match (`SprotoDuel` constants):

| Limit | Value |
| --- | --- |
| CPU wins (`fighter_win` earns) before a first wager | 3 |
| Wagered matches per pair of players per UTC day | 5 |
| Net Tickets won from wagers per player per UTC day | 200 |

## Updating the simulation

The game repo regenerates the bundle and its fingerprint:

```sh
node scripts/build-sim-bundle.mjs --out ../metaverse-hub/server/modules/vendor/sproto-sim.js
```

Clients with a different fingerprint never match each other, and a `HELLO` with
a fingerprint other than the server's is cancelled (`sim_mismatch`).

## Local testing

`sproto.dev_replay` replays a match log and answers only when Nakama runs with
`--runtime.env SPROTO_DEV_RPCS=1`. Leave it unset in production. With a local
stack running, from the game repo:

```sh
NAKAMA_URL=http://127.0.0.1:7350 node scripts/hub-replay-smoke.mjs
NAKAMA_URL=http://127.0.0.1:7350 HUB_DATABASE_URL=postgres://postgres:...@127.0.0.1:5432/nakama node scripts/hub-duel-smoke.mjs
```

The first checks the server replays logs to exactly the browser's states. The
second plays wagered duels end to end (payout, forfeit by leaving, forfeit by a
stalled stream, insufficient balance).
