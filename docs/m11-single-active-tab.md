# M11 single active tab

Server pieces for one active tab per profile. Nothing here is registered or applied. Hub #12 and #13 edit `schema.ts`, `rpcs.ts`, `main.ts`, `tsconfig.json`, and the SDK, so this branch only adds files. Wire the pieces on main after those PRs merge. QA covers this in M12. This change adds no tests.

The runtime is the TypeScript Nakama module (`InitModule` in `server/modules/src/main.ts`). Postgres time is `now()` inside the migration. There is no Go plugin and no numbered migration on main, so this file is migration `0001`.

## Files

| File | Role |
| --- | --- |
| `server/modules/migrations/0001_play_lease.sql` | `game.play_lease` plus `game.claim_play_lease`, `game.heartbeat_play_lease`, and `game.require_lease` |
| `server/modules/src/play_lease.ts` | `HubLease.claim`, `HubLease.heartbeat`, and `HubLease.RequireLease` |
| `docs/m11-single-active-tab.md` | This wiring list |

`play_lease.ts` is not in the `files` array of `server/modules/tsconfig.json`, so `tsc` does not concatenate it into `server/modules/build/index.js`. `InitModule` does not register the RPCs. `HubSchema.apply` does not run the migration. `nakama migrate up` does not read `server/modules/migrations/`.

## Behavior already implemented

`game.play_lease` is one row per profile: `user_id` primary key, `lease_id uuid`, `surface text`, `claimed_at timestamptz`, `heartbeat_at timestamptz`. `surface` is `hub`, `hpos10i`, `nobu`, `peoples-bitcoin`, or `sproto`.

`session.claim` (`HubLease.claim`) runs after the ticket swap. A game token claims that game. Any other session claims `hub`. An omitted `surface` uses that session surface. A different `surface` returns `bad_surface` and writes nothing. A valid call takes the play-lease advisory lock, mints a new `lease_id` with `gen_random_uuid()`, and upserts `claimed_at` and `heartbeat_at` to the same `now()`. The response is `{ leaseId, surface, claimedAt, heartbeatAt, previousLeaseId, superseded, heartbeatSeconds: 15, ttlSeconds: 45 }`.

When a previous row existed, the module sends a non-persistent notification to that user's sockets:

| Field | Value |
| --- | --- |
| Subject | `session_superseded` |
| Code | `1001` (`HubLease.SESSION_SUPERSEDED_CODE`) |
| Content | `{ leaseId, previousLeaseId, surface }` of the new lease |

The winning tab ignores a notification whose `leaseId` is the lease it just stored. The first claim for a profile sends no notification.

`session.heartbeat` (`HubLease.heartbeat`) takes `{ leaseId }` (or `lease_id`). The update runs only when that lease is still inside 45 seconds of `heartbeat_at`. A miss changes zero rows and returns `{ error: "session_superseded", message: "session_superseded" }`. A hit sets `heartbeat_at = now()`. The server does not store a client timestamp and does not enforce the 15 second cadence. Fifteen seconds is the client schedule that stays inside the 45 second TTL.

`HubLease.RequireLease(ctx, db, userID, leaseID)` is the helper write RPCs call. `db` is the Nakama SQL handle (`nkruntime.Nakama`). It returns `null` when the lease is current. It returns `{ error: "session_superseded", message: "session_superseded" }` when the lease id is not a uuid or `game.require_lease` raises. It returns `{ error: "unauthorized", message: "unauthorized" }` when `userID` is not `ctx.userId`. The SQL function locks the profile row and writes no lease row. A raise uses `ERRCODE` `P0001` and the message `session_superseded`.

`nk.sqlQuery` is one auto-committed statement. `RequireLease` cannot hold its row lock across a later write. The stale path writes no row only when `PERFORM game.require_lease(...)` runs inside the same plpgsql function as the ledger insert, or when the inline statement calls `game.require_lease` in the same query. Do that in the follow-up below.

## Wiring after #12 and #13 merge

Do this on a branch from main after those PRs are in. Hub #16 also edits `schema.ts`. Base the wiring on the main that contains the schema you are actually shipping. Leave #12, #13, #14, and #15 rebase-free.

### 1. Apply migration 0001

Append each statement from `server/modules/migrations/0001_play_lease.sql` as its own string at the end of `STATEMENTS` in `server/modules/src/schema.ts` (the `HubSchema.apply` loop). Keep `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE FUNCTION` so every Nakama boot can run them again.

Statements, in order:

1. `CREATE SCHEMA IF NOT EXISTS game`
2. `CREATE TABLE IF NOT EXISTS game.play_lease (...)`
3. `game.claim_play_lease`
4. `game.heartbeat_play_lease`
5. `game.require_lease`

### 2. Compile the module

In `server/modules/tsconfig.json`, insert `"src/play_lease.ts"` immediately before `"src/main.ts"`. The namespace has to exist before `InitModule` calls it.

### 3. Register the RPCs

In `server/modules/src/main.ts`, add wrappers next to the other `guard` calls and register them from `InitModule`:

```ts
function rpcSessionClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubLease.claim, ctx, logger, nk, payload);
}

function rpcSessionHeartbeat(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubLease.heartbeat, ctx, logger, nk, payload);
}
```

```ts
initializer.registerRpc("session.claim", rpcSessionClaim);
initializer.registerRpc("session.heartbeat", rpcSessionHeartbeat);
```

`HubRpc.mapError` already maps `unauthorized`. Step 4 adds `session_superseded` so a raised lease failure takes the same path. `claim` and `heartbeat` return that JSON themselves for lease failures.

### 4. Map `session_superseded`

Add `"session_superseded"` to the `codes` array in `HubRpc.mapError` (`server/modules/src/rpcs.ts`). A `game.require_lease` raise then becomes the JSON error instead of a 500.

### 5. Add `leaseId` to each write RPC

Canonical JSON field is `leaseId`, matching `eventId` and `boardId`. `HubLease.heartbeat` and `RequireLease` also accept `lease_id`. Column name stays `lease_id`. Responses use `leaseId`.

Keep `leaseId` out of the idempotency hash. A takeover resends the same key and the same economic body. Today's hashes stay:

| RPC | Hash input |
| --- | --- |
| `session.event` | `eventId`, `data`, and `seq` when present |
| `tickets.earn` | `amount`, `reason` |
| `tickets.exchange` | `tickets` |

Spend and sell, once #12 is on main, keep whatever hash they already use and add `leaseId` only as a separate SQL argument.

In each write handler, before any other SQL:

```ts
var leaseError = HubLease.RequireLease(ctx, nk, session.userId, text(body, "leaseId") || text(body, "lease_id"));
if (leaseError) return HubRpc.fail(leaseError.error, leaseError.message);
```

Inside each plpgsql write function, immediately after the advisory lock and before the `game.idempotency` read:

```sql
PERFORM game.require_lease(p_user_id, p_lease_id);
```

Add `p_lease_id uuid` to the function and pass it from the handler. `earn_tickets` and `exchange_tickets` catch only `unique_violation`, so this raise still propagates. Leave those handlers that way.

The `PERFORM` is the statement that makes a stale call write no ledger row. `RequireLease` is the early typed error. A stale call must not insert an idempotency row either, or the live tab's resend would replay `session_superseded`.

Write RPCs on main:

| RPC | Where the write lives | Lease |
| --- | --- | --- |
| `session.event` | `game.apply_event` | yes |
| `tickets.earn` | `game.earn_tickets` | yes |
| `tickets.exchange` | `game.exchange_tickets` | yes |
| `score.submit` | `INSERT` in `HubRpc.scoreSubmit` | yes |
| `session.close` | `UPDATE` in `HubRpc.sessionClose` | yes |

After #12 is on main, also gate `tickets.spend` (`game.spend_tickets`) and `tickets.sell` (`game.sell_tickets`). `tickets.balance` is a read and stays ungated.

Later write RPCs use the same two calls: `store.buy`, `pet.set`, and `loadout_set`.

These stay ungated. They run before a lease exists, or they are not a play-tab write: `portal.enter`, `session.redeem`, `session.claim`, `session.heartbeat`, `profile.get`, `verse.board`, `healthcheck`, `recovery.create`, `recovery.redeem`.

`score.submit` and `session.close` write from TypeScript. Fold the check into that same statement so a claim cannot land between the helper and the write:

```sql
WITH lease AS (
  SELECT game.require_lease($user::uuid, $lease::uuid) AS ok
)
UPDATE game.game_session
   SET state = 'closed'
 WHERE session_id = $sid::uuid
   AND user_id = $user::uuid
   AND state = 'open'
   AND EXISTS (SELECT 1 FROM lease)
```

Use the same `WITH lease AS (SELECT game.require_lease(...))` in front of the `score_best` insert. A raise aborts the statement, so zero rows change.

### 6. SDK

`packages/hub-sdk` and the hub client stay unchanged in this prep. After the RPCs are registered:

1. In `createLiveHubSdk` `init` (`packages/hub-sdk/src/live.ts`), call `session.claim` after a successful `session.redeem` and again when a cached game session is adopted. Store `leaseId` in the live session.
2. In `openSession` (`apps/hub/src/main.ts`), call `session.claim` after `authenticateDevice` with the hub token. Surface resolves to `hub` on the server.
3. While the tab holds a lease, call `session.heartbeat` with `{ leaseId }` every `heartbeatSeconds` (15). Stop the timer on `exit` and on `session_superseded`.
4. Pass `leaseId` on `session.event`, `tickets.earn`, `tickets.exchange`, `tickets.spend`, `tickets.sell`, `score.submit`, and `session.close`.
5. Treat notification subject `session_superseded` code `1001`, an RPC body `{ error: "session_superseded" }`, and a dropped socket as the same takeover. `client.rpc` already throws `HubSdkError` when `parsed.error` is set, and `transmit` only forgets an outbox row after that call resolves. Keep that, so a superseded send leaves the IndexedDB row in `hub-outbox` / `writes`.
6. On the claim response, adopt `leaseId` before handling the notification. Ignore `session_superseded` when its `leaseId` equals the lease just stored. The Play here button calls `session.claim` again.
7. Drain the outbox under the new lease. At send time, set `leaseId` from the current session over the stored body. Leave the stored key and economic body alone so idempotency still matches. `submitScore` in `live.ts` calls `score.submit` directly and is outside the outbox. Move it into the same outbox so a takeover resends it under the new lease. That closes the three low-risk outbox gaps: two tabs clobbering an unacked earn, a dead earn resending on each init, and `submitScore` sitting outside the outbox.

### 7. Config

In the Nakama command in `server/docker-compose.yml`, add `--session.single_socket true` next to the other `--session.*` flags. Use the same flag on the VPS. It is account-wide: the new socket disconnects the previous one, including a hub socket when a game connects.

With that flag on, the old socket may already be gone before `session.claim` notifies. The lease check on the write RPCs is the authority. The notification covers the period while two sockets are still up.

### 8. Client follow-ups

These are not in this prep.

**BroadcastChannel.** Same-origin tabs (two hub tabs, or two tabs of one game) listen on a `BroadcastChannel` and post the same payload as the notification: `{ type: "session_superseded", leaseId, previousLeaseId, surface }`. Hub (`<domain>/hub`) and a game (`play.<domain>/<game>`) are different origins, so the channel does not cross that boundary. The server lease is the authority there.

**Play here overlay.** Lore Master's working copy, until the final wording lands: body "You're playing in another tab", button "Play here". Full-screen on the tab that lost the lease. The tab pauses and writes nothing. Play here calls `session.claim`, stores the new `leaseId`, and drains the outbox.

**Outbox.** Resend under the new lease as in step 6. Keys still dedupe. A stale response writes no server row and stays queued.
