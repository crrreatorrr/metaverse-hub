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
npm run test:dup
```

They prove a Relic cannot be granted twice, and that exchanging Tickets for Verse cannot credit Verse twice, by replayed keys, concurrent requests, or a second device that restored the same guest. 10 Tickets become 1 Verse, at most 50 Verse per game per day. Lifetime Verse earned per game is what the Bar board ranks.
