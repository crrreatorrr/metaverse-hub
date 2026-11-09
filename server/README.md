# Server

Nakama, Postgres, and Caddy for the hub. Economy RPCs live in the TypeScript runtime under `modules/`, compiled into the Nakama image.

| Service | Image | Host port | Role |
| --- | --- | --- | --- |
| Postgres | `postgres:16.8-alpine` | 5432 | Nakama plus the `game` schema (relics, ledger, recovery codes). |
| Nakama | built from `Dockerfile` (`heroiclabs/nakama:3.41.0`) | 7349 gRPC, 7350 HTTP, 7351 console | Device and username auth, portal tickets, relic grants. |
| Caddy | `caddy:2.10.2-alpine` | 8080 | `/v2` proxy with CORS for a game on another port. |

The database password is `localdb`. The Nakama server key is `defaultkey`. The HTTP key is `localhttpkey`. Those are local dev values, not production secrets. The HTTP key stays on the Nakama process. Game and hub bundles do not contain it. A portal ticket is redeemed with custom authentication and the server key. Write RPCs reject a call that has no user id.

People's Bitcoin has an owner godmode: accounts in `game.godmode_user` get their `peoples-bitcoin` Ticket wallet raised to a set amount on every balance read (`modules/src/games/pb_godmode.ts`, migration `0044_pb_godmode`). Only `deploy/scripts/godmode.sh` adds accounts; see `deploy/README.md`. Locally: `docker compose exec -T postgres psql -U postgres -d nakama -c "INSERT INTO game.godmode_user (user_id, tickets) SELECT id, 333333333 FROM users WHERE username = '<name>'"`.

## Accounts

The hub opens on a sign-up / log-in page. Accounts use Nakama's email auth with a username:

- **Sign up** authenticates this device's guest, then calls `account.claim` with `{ username, email, password }`. That sets the username, links the email and password, and unlinks the guest's devices, so the Relics and Verse the guest already had stay on the account and the device id no longer opens it. If the guest already has a password, the client creates a fresh account with `authenticate/email?create=true&username=…` instead.
- **Log in** is `authenticate/email?create=false&username=…` with an empty email and the password.
- Usernames are 3–20 of `a-z 0-9 _ -`, lowercased. Passwords are 8–128 characters. The email is a backup address and is **not verified** yet.
- `account.claim` returns `bad_username`, `bad_email`, `bad_password`, `username_taken`, `email_taken`, or `account_claimed`.
- A before-hook on email auth forces `vars.scope = "hub"`, the same rule as device auth, so a client cannot mint itself a game-scoped session.
- The hub keeps the refresh token in `localStorage` and refreshes on load, so a game round trip does not ask again. Compose sets `session.refresh_token_expiry_sec` to 30 days. The refresh before-hook writes `vars` at the top level of the refresh request.

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

The suite lives in `server/test/dup/`. `cases.ts` is the only table you add to. M1 covers `session.event` for Tinubu's Crown (`sproto.boss_defeated` → `tinubu_crown`) and `tickets.exchange` (10 Tickets = 1 Verse, 50 Verse per game per UTC day). `FIGHTER_FLOWS` covers Sproto Fighter (migration 0009): `fighter.story_level_complete` with world 1 → `tidebreaker_belt`, and a `fighter_win` exchange. `ARCADE_FLOWS` covers the Breakwater Coin, and `COOP_SHOOTER_FLOWS` covers migration 0045: `coop.stage_clear` with stage 1 → `marina_anchor` and `shooter.wave_clear` with wave 1 → `dragon_scale` (both live, God Mode included, no Tickets). Append a relic or exchange row to `M2_FLOWS`, or a `{ kind: 'purchase', defId, priceVerse }` row to `M7_FLOWS`, and the same idempotency, race, forged-request, wallet, and fault cases run for it. Purchases call `store.buy` with `{ defId, key }` and need `HubFault.apply` at `purchase.before_rpc` and `purchase.after_commit`.

`server/test/dup/audit.sql` must return no rows. The suite runs it after every case. CI runs it again after the job. `HUB_FAULT_INJECT=1` in this compose file arms nothing by itself; only rows in `game.fault_arm` (inserted by the suite) pause or abort a grant. Leave that flag unset on a production deploy.

Three groups in `server/test/dup/gated.ts` stay pending until the matching code is present, then they run and must pass:

- SDK outbox: export `HUB_OUTBOX_DB` (`hub-outbox`) and use `indexedDB` in `packages/hub-sdk/src/live.ts`.
- Seq rejects: table `game.event_rule`.
- Per-session Ticket cap: SQL function `game.session_ticket_cap()`.
- Mock daily buckets: `serverNow` on `HubSdkEnv`, read by the mock in `createHubSdk.ts`.

## Realtime

The module also runs the plaza and the games' online pieces. The full guide, including how a game adds its match, RPCs and migrations, is [docs/realtime.md](../docs/realtime.md).

| Piece | Where |
| --- | --- |
| Plaza match `hub` (100 per shard, 10 Hz, zone deltas, 20 s rejoin grace); shard 1 starts at boot | `modules/src/hub_match.ts` |
| `hub.join` (least-full placement, 6/min), `chat.report` (10/h) | `modules/src/hub_rpcs.ts`, `shards.ts` |
| Chat guard on `ChannelJoin` / `ChannelMessageSend` (rooms `hub.<shard>`, validation, mute, filter, rate limit); edits and removals rejected | `modules/src/chat_guard.ts`, `chat_words.ts` |
| Single matchmaker hook routing by `properties.game`; `MatchmakerAdd` scope check; client `MatchCreate` rejected | `modules/src/rt_hooks.ts`, `hub_games.ts` |
| Public boards: `score.submit` → `HubBoards.submit`, `leaderboard.top` (NOBU per level in ms, from unranked sessions) | `modules/src/leaderboard.ts` |
| Ticket calls for match handlers (`srv_*` reasons; `tickets.earn` rejects them from clients) | `modules/src/server_economy.ts` |
| Game files (Sproto Duel `sproto_arena`, PB `pb_world`), compiled through tsconfig `include` | `modules/src/games/*.ts` |

Migrations `0011_ranked_scores` (`game.ranked_score`, `game.win_record`) and `0012_chat_moderation` (`game.chat_mute`, `game.chat_report`) are the hub's, and so is `0030_m6_item_grants` (`game.item_owned`, `game.item_rule`, the `grant_item` ledger op, and the `session.event` pet grant in `game.apply_event`; see `docs/m6-server-prep.md`). Game files register theirs with `HubSchema.register` in their reserved ranges (PB 0013–0019, Sproto 0020–0024, Sproto Arcade 0025–0029). The runner refuses an unapplied id below the highest recorded one, so deploy in id order.

Moderation is SQL for now:

```sql
-- mute a user for a day
INSERT INTO game.chat_mute (user_id, until, reason) VALUES ('<uuid>', now() + interval '1 day', 'spam');
-- newest reports
SELECT created_at, reporter, target, channel_id, text, reason FROM game.chat_report ORDER BY created_at DESC LIMIT 50;
```

Feature flags are rows in `game.server_flags` (migration `0042_server_flags`), read through `Flags.on(nk, key, userId, logger?, { onReadError? })` in `modules/src/flags.ts`. A flag's `state` is `off`, `allowlist` (the `allowlist` uuids), `percent` (a stable per-key bucket of the user below `percent`, plus the allowlist) or `on`. A missing row is off. A failed read returns `onReadError`, which defaults to false: readers of `maint` must pass `{ onReadError: true }` so a database outage keeps maintenance on. Buckets are independent per key, so a nested rollout (`shooter_pvp_wager` inside `shooter_pvp`) must check both flags. Each node caches a row for 5 s. The launch flags (`shooter_pvp`, `shooter_pvp_wager`, `shooter_pvp_ranked`, `hub_exchange`, `verse_store`, `relic_unhold`, `diagnostics_prompt`, `maint`) are seeded `off`, and nothing reads them yet. Turning a flag off is the first rollback:

```sql
UPDATE game.server_flags SET state = 'allowlist', allowlist = '{<uuid>}', updated_at = now() WHERE key = 'shooter_pvp';
UPDATE game.server_flags SET state = 'percent', percent = 10, updated_at = now() WHERE key = 'shooter_pvp';
UPDATE game.server_flags SET state = 'off', updated_at = now() WHERE key = 'shooter_pvp';
```

Tests: `npm test` builds the module and runs `server/test/unit/*.test.ts` and `server/test/games/*.test.ts` in `node:vm` against a fake `nk` (no Docker). Against this compose stack, `npm run test:rt` drives real sockets (plaza, chat, matchmaker scope, NOBU boards) next to `npm run test:dup`.

Runtime knobs in `deploy/nakama/config.yml` (and the dev compose flags): `runtime.js_max_count 64`, `socket.max_message_size_bytes 8192`, `socket.outgoing_queue_size 256`, `match.input_queue_size 256`, `match.call_queue_size 256`.
