# Server placeholder

Nakama, Postgres, and Caddy for the metaverse hub. **Nothing in M0 starts this stack or talks to it.** The plaza runs entirely in the browser. Mock tickets and the hub-sdk stand in for the RPCs until M1.

## What is here

| Service | Image | Host port | Role |
| --- | --- | --- | --- |
| Postgres | `postgres:16.8-alpine` | 5432 | Nakama's database. The `game` schema from the architecture doc is not migrated yet. |
| Nakama | `heroiclabs/nakama:3.41.0` | 7349 gRPC, 7350 HTTP, 7351 console | Auth, hub match, and economy RPCs. No Go module is mounted. |
| Caddy | `caddy:2.10.2-alpine` | 8080 | Stand-in reverse proxy. It does not serve the hub. |

The database password is `localdb`, the same value as Nakama's own local compose example. It is not a production secret. Do not expose this compose file on a public host.

## Start it later

```bash
docker compose -f server/docker-compose.yml up
```

Nakama's console is then at `http://127.0.0.1:7351`. The hub at `npm run dev` will still ignore it.

## What M1 wires up

- Guest device auth (device id already reserved in the client as `hub:deviceId`) and an optional one-time recovery code
- The Go module: `portal.enter`, `session.redeem`, `session.event`, `tickets.earn`, `tickets.exchange`, `score.submit`, `session.close`
- A real signed ticket in place of the mock `#t=` fragment
- The Sproto Duel round trip and the first earn-once Relic (Tinubu's Crown)
