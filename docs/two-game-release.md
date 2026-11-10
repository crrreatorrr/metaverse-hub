# Two-game release readiness (H5)

This is a readiness record for Sproto Coop Battle and Sproto Shooter. It does not deploy, buy a server, or turn a public flag on. Public launch stays closed until Ken says otherwise.

Parent hub `main` when this record merged: `8753d1c` (plaza controller, hub #123). H4-S `d7065e1` is an ancestor. The squash is `dcc8e6b` (hub #122).

## Decision

**Ready for an owner decision to keep both games dark.** Not public live.

Named blockers before any public flag, purchase, or production deploy:

1. **No staging host.** This repo has no configured staging environment. The drills below ran on local Docker Nakama (`server/docker-compose.yml`, image `heroiclabs/nakama:3.41.0`, Postgres `16.8`). They are not a measurement of a public edge.
2. **No live HTTPS hostname.** `deploy/Caddyfile` terminates TLS and proxies `/ws`. This run proved the file's header rules and a local HTTP Caddy on `127.0.0.1:8080` (CORS preflight `204`, WebSocket connect). It did not fetch `https://` or `wss://` from a real name.
3. **Owner gates still open.** Operational, legal, and economy approval for entries, authoritative play, boss rewards, and wagers. Ken already accepted Ticket transfer through Shooter wagers (Nov 7, 2026). That does not turn the flags on. `shooter_pvp` off stops new free queues and new free rooms as well as, together with `shooter_pvp_wager`, new holds. Live matches still drain. Do not quote a CCU number from this VM.

## Coop gate

C5 is merged: `crrreatorrr/Sproto-Coop-Battle.` pull request **#7**, merge `2026-11-08T15:34:38Z`, "C5: Coop acceptance evidence and release pins". Later game commits through `ae9dd750878c4046d43825fff1724c129c4c1fdb` (Marina Anchor, #17) did not change the vendored bundle. `node scripts/check-coop-sim-version.mjs` passes: Coop `main`'s bundle still matches hub pin commit `9a0b5d9f97460617b4b2bb8445dae6849f163d51`. This phase does not rewrite the Coop pin.

C5 could not run its own Nakama restart step or the wallet-fault half, and its ten-match p95 missed 25 ms while a browser soak was on a core. Both are re-run below with the soak off.

## Pin matrix

| Piece | Value |
|---|---|
| Hub parent | `8753d1c` (hub #123). Squash `dcc8e6b` (hub #122) |
| Shooter `main` | `ce6f5f232c1abdf78bbde8f4ac65b1b475109c01` (through the L02 Sahil fight). Protocol 2, sim 2. Full re-vendor with `scripts/revendor-shooter-pvp.mjs` (no `--pvp-only`). The check is unchanged: the pin commit is shooter `main`. |
| Shooter free / wager bundle | sha256 `887c20aaf62b7404b415265081302a553fdbddc24ee0cd72deba62935bafddb4`, content `17d87c54`, loadout `4cdfab55`, golden tick 65 hash `6545ca0a`, global `SprotoShooterPvp` |
| Shooter campaign bundle | sha256 `dbdff8bfd63b69782c998235825753a144411de1c2d5ac1d62720947246364b1`, protocol 1, fingerprint `cea1f88b`, global `SprotoShooterSim` |
| Coop game `main` | `ae9dd750878c4046d43825fff1724c129c4c1fdb` |
| Coop hub pin | commit `9a0b5d9f97460617b4b2bb8445dae6849f163d51`, protocol 1, state 1, fingerprint `f8705ec4b68e5643e7ce7e3f0014308e9546ddf43d55a506f4805e4091b07f1e`, bundle `28f9236d0df78c62cf600ad08c9924f8dd260b6948d7a73baf60230936934fac` |
| Coop loop | 20 Hz, 3 substeps, 60 Hz sim, snapshot 10 Hz, reconnect 15 s, match `sproto_coop` |
| SDK | `@metaverse/hub-sdk` 0.6.4, IIFE `e7626595184dc132e72ffd707c87149b266c7b3933d40670e55eb2fb0a64eda6` |
| Nakama / Postgres | `heroiclabs/nakama:3.41.0`, `postgres:16.8-alpine` |
| Goja | `github.com/dop251/goja v0.0.0-20261107161106-d6eaa50db8bc` |
| Node | `>=22` (`v22.23.4` on the evidence VM) |

A client whose protocol, sim, or fingerprint does not match gets `version_mismatch` and is not seated. Both acceptance scripts saw that refusal (`coop.room_join` with `v: 0`, `shooter.room_create` with `v: 1`). The game client is responsible for the refresh line. This hub does not serve a stale match as if it were current.

Pages (`github.io`) is static practice hosting only. `scripts/fetch-game-web.mjs` has no Pages URL for Shooter or Coop. Online play needs this hub's Nakama.

## Flags

Separate switches. None of them is turned on by this change.

| Switch | Committed state | What it gates |
|---|---|---|
| `shooter_pvp` | `off` | New free queues, new free rooms, and (with the wager flag) escrow. A match already running is left to finish. |
| `shooter_pvp_wager` | `off` | New 10-Ticket holds. |
| `shooter_pvp_ranked` | `off` | Ranked Shooter. Not enabled by the drills. |
| Coop `ENABLED` | already true in the match module from H3-C | Authoritative `sproto_coop`. This phase does not edit that. |
| Boss rewards | server settlement, not a new public flag | Coop `srv_coop_boss_clear` and Shooter boss pay stay server-authored. |
| `GAME_COOP_*` in `deploy/.env` | `0` | SharedArrayBuffer headers for one static tree. Not a launch flag. |
| `SHOOTER_PVP_REPLAY` | unset in `deploy/nakama/config.yml` | Local compose sets it so suites can store a replay. Production leaves it unset. |

`deploy/scripts/check-env.sh` rejects `SHOOTER_PVP`, `SHOOTER_PVP_WAGER`, `SHOOTER_PVP_RANKED`, `PUBLIC_LAUNCH`, and `HUB_PUBLIC` in `deploy/.env`. Flags are rows in `game.server_flags`. The acceptance script allowlisted two accounts only in the local database, then wrote the three Shooter rows back to `off`. A query after the run returned `shooter_pvp=off`, `shooter_pvp_ranked=off`, `shooter_pvp_wager=off`.

## What ran

Evidence VM: Linux, Intel Xeon, 4 cores, 16,780,623,872 bytes reported by the OS, Node `v22.23.4`. No discrete GPU. No staging hostname.

| Drill | Result |
|---|---|
| `npx tsx scripts/load/coop-acceptance.ts` | passed |
| `npx tsx scripts/load/shooter-acceptance.ts` | passed |
| `server/test/dup/audit.sql` and `shooter_wager_audit.sql` after the rollback | passed |
| `node scripts/check-shooter-pvp-sim-version.mjs` | passed, pin is shooter `main` |
| `node scripts/check-shooter-sim-version.mjs` | passed |
| `node scripts/check-coop-sim-version.mjs` | passed, main bundle matches the pin |

CI also runs the existing duplication suite, realtime suite, `coop-bots.ts`, and `shooter-bots.ts`. Those gates are not loosened. The new acceptance scripts are additional.

### Coop, soak off

Six accounts, one seat each, one private room.

| Measurement | Value |
|---|---|
| Hello round trip | 30, 31, 60, 61, 61, 61 ms. p95 61 ms |
| All six ready to start | 61 ms |
| Ping round trip | 31–62 ms. p95 62 ms |
| Snapshots in the next second | 13 on each socket |
| Handler sample on that match | n 28, p50 1 ms, p95 2 ms, max 5 ms, rewards 0 |
| Reconnect | new socket got a resume inside 15 s, `rewards` 0, `hostTakeover` 0, `acceptClientState` 0 |
| Ten one-seat matches, 8 s, no browser soak | worst p95 **2 ms** (gate stays under 25 ms). Every match p95 2 ms, max 5–7 ms, `over25` 0, rewards 0 |
| Ten six-seat matches, 8 s, after a Nakama restart, soak off | all 10 started. worst handler p95 **1 ms**. Every match p95 1 ms, max 3–8 ms, `over25` 0, rewards 0, `hostTakeover` 0. The 25 ms gate held. This is one 4-core VM, not a capacity promise |
| Process restart | 8.5 s until sessions worked. `coop.resume` with client `hp` / `lives` returned `rejected`. The six-seat and bench balances stayed put |

Wallet fault, the case C5 did not run:

- A clear paid 20 once (`07-moonkeep-bigswole`).
- Restarting Nakama left the receipt at 20 Tickets. The same clear did not pay again.
- Arming `earn.after_wallet` aborted settlement (`fault_injected`). Credits, receipts, eligibility, and the balance stayed 0.
- Clearing the fault paid once. A repeat did not pay again. Balance 20.

### Shooter 1v1

Protocol 2 / sim 2, content `17d87c54`, bundle sha above. `wagerEnabled` was false at the start.

| Measurement | Value |
|---|---|
| Eight pings on one seat | 40–41 ms. p95 41 ms. The other seat received none of those pongs |
| Reconnect | new socket welcomed in under 10 s. Stake stayed 0 |
| Stale `v: 1` | `version_mismatch` |
| Ten live free matches, 4 s | worst handler p95 **1 ms** (gate stays under 25 ms; the match budget is 10 ms). `overBudget` 0, `ticketsMinted` 0, stake 0. Worst max in the set was 9 ms |

### Rollback drill

Two signed-in accounts, 20 Tickets each, funded in the local database only.

1. Allowlist `shooter_pvp` and `shooter_pvp_wager` for those two accounts. Not `state = 'on'`.
2. They opened a wager room and readied. Status `held`. Each balance 10. Pot 20. `game.shooter_wager_drift()` was 0.
3. Both flags set back to `off`. A new wager room returned `stakes_disabled`. The existing hold was not deleted.
4. `docker compose restart nakama`. The single-node boot sweep refunded the hold: status `refunded`, reason `expired`. Active locks for that match: 0. Held rows after the restart: 0. Both balances returned to 20. Drift 0.
5. Free-match balances did not move. The economy audit and `server/test/dup/shooter_wager_audit.sql` passed.
6. The three Shooter flag rows were `off` at the end.

`refunded` / `expired` is the boot sweep (`game.shooter_wager_expire` with a zero age). It is one refund, not a second mint. There is no down migration. `game.shooter_wager`, `game.tickets_ledger`, and Coop receipts stay.

## Escrow audit

`server/test/dup/audit.sql` now also fails when:

- `game.shooter_wager_drift()` is not 0 (Shooter wallets plus held pots versus the non-wager Shooter ledger)
- a `held` row does not have both active locks, or a lock has no `held` row
- Coop receipt count or ticket sum disagrees with `srv_coop_boss_clear` ledger rows of delta 20

`server/test/dup/shooter_wager_audit.sql` still runs and was not weakened. Fighter escrow is not part of the new check.

## Cache, transport, secrets

`deploy/Caddyfile`, checked by `scripts/load/shooter-acceptance.ts`:

- HTML (`index.html` and other `.html`) is `Cache-Control: no-cache`, including `/sproto-shooter/` and `/sproto-coop-battle/`.
- Fingerprinted `index.<hash>.wasm`, `.pck`, and `.js` are `public, max-age=31536000, immutable`.
- `.wasm` is `Content-Type: application/wasm`.
- `/v2` and `/ws` are `Cache-Control: no-store` and reverse-proxy Nakama on `127.0.0.1:7350`. `/ws` is the WebSocket.
- TLS uses the Cloudflare origin certificate. HSTS and `X-Content-Type-Options: nosniff` are set.

Local Caddy (`server/Caddyfile`, port 8080) answered `OPTIONS /v2/healthcheck` with `204` and `Access-Control-Allow-Origin: *`, and a hub realtime socket connected through it. That is HTTP on localhost, not the production certificate.

`deploy/scripts/check-dist-secrets.sh` refuses the dev credential literals (`defaultkey`, `localhttpkey`, `localdb`, and the rest of that list), a PEM or OpenSSH private key, and, when `deploy/.env` is present, the live HTTP key, console password, and console signing key. It does not treat the English words `password` and `changeme` as dist secrets: the login UI contains the field name `password`. `check-env.sh` still rejects a secret whose value is one of those words. `deploy-game.sh` does not write `game.server_flags`.

## Rollback operators

Do this in order. Do not drop tables.

1. Set `shooter_pvp_wager` to `off`, then `shooter_pvp` to `off`. That stops new holds. See `docs/shooter-wager-operations.md` for the ledger rules. There is no anomaly auto-ban: Ken declined pair caps and same-IP blocks.
2. Leave login, the cabinet, and practice up. `shooter_pvp` off stops new free queues and new free rooms. Matches that already started keep running until they end.
3. Let a live match finish, or restart one Nakama node only when you accept that every `held` row refunds. A rolling restart can refund a match that is still live on the other node: both seats get 10 back and the winner is not paid. No Tickets are created.
4. Holds older than 20 minutes are refunded by the sweep (`scripts/ops/sweep-shooter-wagers.mjs` and the in-process sweep). A `held` row after that is the thing to look at. The audit above fails while one exists without both locks.
5. Keep `game.shooter_wager`, `game.tickets_ledger`, `game.coop_receipt`, and `game.coop_eligibility`. A Coop receipt survives a process restart. A wallet fault during the credit leaves no partial row; the clear can pay once after the fault is gone.
6. Ship a build whose protocol, sim, fingerprint, and bundle sha match this matrix, or clients get `version_mismatch`.
7. Do not announce a public lobby and do not set any of the three Shooter flags to `on` in a committed or deployed config.

## Launch risks

A single L02 Sahil verify missed the 15 second wall-clock budget on the CI runner and came back `cpu_budget`, so it was not paid. Twenty concurrent verifies of that clear miss it too. A short clear (Broccoli, about 3k frames) still fits, including twenty at once. A real player on a busy or small node can submit a long clear and not be paid. That needs a capacity or queue fix before go-live. This release does not change the budget.

Nakama's default HTTP write timeout is 10 seconds. One Sahil verify can take longer than that, so the socket closed before the receipt was written. The hub config and the local compose stack now wait 30 seconds, which is above the 15 second verifier budget, so a single clear can return. That is the transport timeout, not the budget.

## Cost and alerts

Not measured on a staging host, so this does not state a CCU, a bill, or an alert that was not configured. Local observations only:

- One six-seat Coop match moved snapshots (about 22 KB across 14 snapshots in a short sample). The ten one-seat matches moved about 160–199 KB of snapshot payload each over 8 seconds. That is localhost JSON before WebSocket framing, not an egress invoice.
- Shooter's ten free matches each moved roughly 115–217 KB of snapshot payload in 4 seconds, with 322 bytes of input counted per match.
- CI cost of this phase is the existing duplication job plus the two acceptance scripts (each capped at 20 minutes). No new paid service was added.
