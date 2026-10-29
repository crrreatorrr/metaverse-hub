# Server

Nakama, Postgres, and Caddy for the hub. Economy RPCs live in the TypeScript runtime under `modules/`, compiled into the Nakama image.

| Service | Image | Host port | Role |
| --- | --- | --- | --- |
| Postgres | `postgres:16.8-alpine` | 5432 | Nakama plus the `game` schema (relics, ledger, recovery codes). |
| Nakama | built from `Dockerfile` (`heroiclabs/nakama:3.41.0`) | 7349 gRPC, 7350 HTTP, 7351 console | Device auth, portal tickets, relic grants. |
| Caddy | `caddy:2.10.2-alpine` | 8080 | `/v2` proxy with CORS for a game on another port. |

The database password is `localdb`. The Nakama server key is `defaultkey`. The HTTP key is `localhttpkey`. Those are local dev values, not production secrets. The HTTP key is embedded in the game client only so it can exchange a portal ticket before it has a session. Every other RPC rejects that call unless the player has a real session.

## Run it

```bash
docker compose up --build
```

From the repo root, `npm run dev` proxies `/v2` to port 7350. Open http://127.0.0.1:5173/hub/ and walk into the Castle. The mock arena is http://127.0.0.1:5173/play/sproto/.

Duplication tests, against this compose stack:

```bash
docker compose up --build -d
npm run test:dup
```

The suite lives in `server/test/dup/`. `cases.ts` is the only table you add to. M1 covers `session.event` for Tinubu's Crown (`sproto.boss_defeated` → `tinubu_crown`) and `tickets.exchange` (10 Tickets = 1 Verse, 50 Verse per game per UTC day). Append a relic or exchange row to `M2_FLOWS`, or a `{ kind: 'purchase', defId, priceVerse }` row to `M7_FLOWS`, and the same idempotency, race, forged-request, wallet, and fault cases run for it. Purchases call `store.buy` with `{ defId, key }` and need `HubFault.apply` at `purchase.before_rpc` and `purchase.after_commit`.

`server/test/dup/audit.sql` must return no rows. The suite runs it after every case. CI runs it again after the job. `HUB_FAULT_INJECT=1` in this compose file arms nothing by itself; only rows in `game.fault_arm` (inserted by the suite) pause or abort a grant. Leave that flag unset on a production deploy.

Three groups in `server/test/dup/gated.ts` stay pending until the matching code is present, then they run and must pass:

- SDK outbox: export `HUB_OUTBOX_DB` (`hub-outbox`) and use `indexedDB` in `packages/hub-sdk/src/live.ts`.
- Seq rejects: table `game.event_rule`.
- Per-session Ticket cap: SQL function `game.session_ticket_cap()`.
- Mock daily buckets: `serverNow` on `HubSdkEnv`, read by the mock in `createHubSdk.ts`.
