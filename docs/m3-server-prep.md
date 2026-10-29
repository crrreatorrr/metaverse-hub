# M3 server prep

Hub match, ranked leaderboards, and loadout RPCs. Nothing here is registered or applied. #12, #13, and #25 edit `main.ts`, `rpcs.ts`, `schema.ts`, `nakama.d.ts`, `tsconfig.json`, and the SDK, so this branch only adds files. Wire it after those PRs merge. #24's ledger is not on main; do not edit `0002_baseline` or any applied migration. QA owns tests. This change adds none.

The runtime is the TypeScript Nakama module (`InitModule` in `server/modules/src/main.ts`). There is no Go plugin.

## Files

| File | Role |
| --- | --- |
| `server/modules/src/hub_match.ts` | Authoritative hub match, 10 players, 15 Hz |
| `server/modules/src/leaderboard.ts` | Four game boards, the meta board, ranked rules |
| `server/modules/src/loadout.ts` | `loadout/<game>` read and `equip_change` |
| `docs/m3-server-prep.md` | This wiring list |

None of the TypeScript files are in the `files` array of `server/modules/tsconfig.json`, so `tsc` does not concatenate them into `server/modules/build/index.js`. `InitModule` does not register the match or the RPCs. No migration file is added.

## Match

`HubMatch.handler` is the Nakama match named `hub`.

| Constant | Value |
| --- | --- |
| `TICK_RATE` | 15 |
| `MAX_PLAYERS` | 10 |
| `OP_POSE` | 1, client to server |
| `OP_SNAPSHOT` | 2, server to everyone |

The architecture's later cap is 100 players. This module's cap is the current 10-player test. Raise `MAX_PLAYERS` in this file when that load test is the work. A second instance is later.

Join past 10 is rejected with `hub_full`. A second presence for the same user is `already_joined`. The label is `{"name":"hub","players":n,"max":10}`.

Each snapshot player carries:

| Field | Source |
| --- | --- |
| `position` | `{x,y,z}` meters. The first pose inside the plaza bounds is accepted. Later poses must stay within sprint slack of the server pose. |
| `rotation` | Quaternion `{x,y,z,w}`. A bad quaternion keeps the previous one. |
| `animation` | `idle`, `walk`, `run`, `jump`, `wave`, `dance`, or `cheer`. Anything else is ignored. |
| `name` | Account username, sanitized. The client does not choose it. |
| `relics` | Owned Relic ids from `game.relic_claim`, in socket order, for orbit gems. Refreshed on join and every 75 ticks (5 seconds). |
| `game` | `""` while they are just in the hub, or `hpos10i`, `nobu`, `peoples-bitcoin`, `sproto`. |

Horizontal slack is the hub sprint (7.8 m/s times 1.8) over three ticks. Vertical slack is 3 meters per tick. Bounds are x/z within ±140 and y within −4 to 40. A rejected pose keeps the last server pose. Clients interpolate the 15 Hz snapshots.

Spawn before the first pose is `(0, 1.775, 42)`.

The match's own SQL is one `SELECT` on `game.relic_claim`. It does not insert, update, or delete. It does not credit Tickets, Verse, Relics, or items. `matchSignal` and `matchTerminate` write nothing.

Every 4500 ticks (five minutes at 15 Hz) the loop calls `HubBoards.onHubTick`. That rollup writes `game.ranked_score` only. A failure is logged and the match keeps running.

## Leaderboards

`HubBoards.submit` is the ranked replacement for `score.submit`. `HubBoards.top` is the read. `HubBoards.recomputeMeta` writes the meta board.

| Board | Game | Mode | Ranked by |
| --- | --- | --- | --- |
| `hpos10i_act_time` | `hpos10i` | `asc` | Best (lowest) time |
| `nobu_trial_time` | `nobu` | `asc` | Best (lowest) time |
| `pb_total_xp` | `peoples-bitcoin` | `desc` | Best (highest) total |
| `sproto_wins` | `sproto` | `incr` | Added wins |
| `meta` | server only | `desc` | Recomputed total |

Modes match the `score.submit` already on main. A client post to `meta` returns `{ accepted: false, reason: "server_board" }` and writes nothing. A board from the wrong game returns `bad_board` and writes nothing. Values are `Math.round` of a non-negative number, same as today's RPC.

Ranked is `game.game_session.ranked` on the open, redeemed session. The client flag is not trusted.

| Session | Result |
| --- | --- |
| Not open, expired, or not redeemed | `session_closed`, no row |
| `ranked = false` | `{ accepted: false, reason: "unranked" }`, no row |
| `godMode` or `god_mode` true on the body, or `god` / `godMode` / `god_mode` true on `meta` | `{ accepted: false, reason: "god_mode" }`, no row |
| Ranked, not god mode | Upsert `game.ranked_score` |

There is no god-mode column on the session. A client that omits the flag is treated as not god mode. Unranked is enforced from the session row either way. God-mode and unranked calls do not write `game.score_best`, Tickets, Verse, Relics, or items.

Meta, recomputed every five minutes from the four game boards:

`meta = Σ round(1000 × (N − rank + 1) / N)`

`N` is the number of ranked rows on that board. A board with no rows adds 0. `rank()` shares a place on ties. A player with no ranked rows loses their meta row on the next rollup.

`leaderboard.top` returns the top 10 plus `me` for the caller. Usernames come from `users`.

## Loadout

Logical key `loadout/<game>` is one `game.loadout` row per user and game. It stores equipped item ids only. It is not an item grant. Matrix items are not rows anywhere else. Owned ids are computed from `game.relic_claim` plus the Sproto starter staff.

Catalog version is 1. Thirteen ids: the twelve matrix rewards, plus `duel_staff_sproto`.

| Game | Slots | Default |
| --- | --- | --- |
| `nobu` | `head`, `neck`, `back`, `body` | all null |
| `sproto` | `staff` | `duel_staff_sproto` |
| `hpos10i` | `skin`, `cape` | both null |
| `peoples-bitcoin` | `summon` | null |

One id per slot. Equipping a neck item replaces the other neck item. Equipping a staff, summon, or skin replaces the previous one in that slot. Back and body stay empty until an item exists for them. A Relic has no item in the game that awarded it. The starter staff is the only id with no Relic.

| Item | Game | Slot | Relic |
| --- | --- | --- | --- |
| `nobu_wizard_hat` | nobu | head | `tinubu_crown` |
| `nobu_golden_collar` | nobu | neck | `genesis_shard` |
| `nobu_clown_collar` | nobu | neck | `hpos10i_core` |
| `duel_staff_sproto` | sproto | staff | starter |
| `duel_staff_momentum` | sproto | staff | `hpos10i_core` |
| `duel_staff_moonward` | sproto | staff | `genesis_shard` |
| `duel_staff_nobu` | sproto | staff | `cones_tip` |
| `hpos_skin_golden` | hpos10i | skin | `genesis_shard` |
| `hpos_skin_nobu` | hpos10i | skin | `cones_tip` |
| `hpos_cape_duelist` | hpos10i | cape | `tinubu_crown` |
| `pb_summon_speed` | peoples-bitcoin | summon | `hpos10i_core` |
| `pb_summon_nobu` | peoples-bitcoin | summon | `cones_tip` |
| `pb_summon_duelist` | peoples-bitcoin | summon | `tinubu_crown` |

HPOS skin and cape ids, and the People's Bitcoin summon ids, are this server catalog. The NOBU and Duel ids match the equip spec.

### `loadout/<game>`

Register one RPC per game. The wrapper pins the game so the body cannot switch it.

```ts
function rpcLoadoutNobu(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
  return guard(HubLoadout.read, ctx, logger, nk, "{\"game\":\"nobu\"}");
}
```

Same for `loadout/hpos10i`, `loadout/peoples-bitcoin`, and `loadout/sproto`.

A game session can read only its game. A hub session can read any of the four. Missing row: defaults, `seq` 0, no insert. An equipped id whose Relic is gone is removed from the response. Duel's staff falls back to `duel_staff_sproto`. That cleaned object is written back only when a row already exists, and `seq` does not change. The read does not grant a Relic or an item.

```json
{ "v": 1, "game": "nobu", "slots": { "head": null, "neck": null, "back": null, "body": null },
  "owned": [], "seq": 0, "updated_at": null, "catalogVersion": 1 }
```

`owned` is derived. It is not a column.

### `equip_change`

Game session only. Payload `{ v: 1, game, slot, item_id, seq }`. `item_id` may be null. `itemId` is accepted as an alias. `seq` has to be an integer greater than the stored seq.

The statement checks, in order: open redeemed session for this user and game, slot legal for the game, item in the catalog for that slot, Relic owned (or starter), then seq. A null staff is stored as `duel_staff_sproto`. A retry of the same seq that already stored that item returns `ok: true` and does not write again.

Failures use `not_owned`, `bad_slot`, `stale_seq`, or `session_closed`, and include the server loadout. `seq` in the response is the stored seq. A wrong game id is `bad_game`. No write touches `game.relic_claim`, `game.item_ledger`, Tickets, or Verse.

## Schema to number later

No migration file is in this PR. #24 (not on main) already uses `0001_schema_migrations`, `0002_baseline`, and `0003_merge_pb_into_peoples_bitcoin`, and reserves `0004` upward for #12 and #13. #17's play-lease migration also has to take a free id from that ledger.

**Intended number: `0006_loadout_ranked_score`.** Use it only when `0004` and `0005` are the two migrations #24 assigns to #12 and #13 and no other id is inserted first. If play-lease or anything else lands earlier, take the next free id. Do not edit `0002_baseline` or any id already stored in `game.schema_migrations`. A changed checksum fails startup.

Append one new entry on the ledger. Statements:

```sql
CREATE TABLE game.loadout (
  user_id uuid NOT NULL,
  game_id text NOT NULL,
  slots jsonb NOT NULL,
  seq bigint NOT NULL CHECK (seq >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id),
  CONSTRAINT loadout_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto')),
  CONSTRAINT loadout_slots_object CHECK (jsonb_typeof(slots) = 'object')
);

CREATE TABLE game.ranked_score (
  user_id uuid NOT NULL,
  board_id text NOT NULL,
  value bigint NOT NULL CHECK (value >= 0),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  session_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id),
  CONSTRAINT ranked_score_board CHECK (board_id IN (
    'hpos10i_act_time', 'nobu_trial_time', 'pb_total_xp', 'sproto_wins', 'meta'
  ))
);

CREATE INDEX ranked_score_board_value ON game.ranked_score (board_id, value);
```

`game.loadout.slots` is equipped item ids or JSON null. `game.ranked_score` is the only board this module writes. Meta rows use `board_id = 'meta'` and a null `session_id`. Do not backfill `game.score_best`. That table stays on the unranked path until `score.submit` is switched.

## Wiring after #12, #13, and #25 merge

Do this on a branch from the main that contains those PRs and the #24 ledger. Leave those branches rebase-free.

### 1. Compile the modules

In `server/modules/tsconfig.json`, insert these immediately before `"src/main.ts"`, in this order:

1. `src/leaderboard.ts`
2. `src/loadout.ts`
3. `src/hub_match.ts`

`HubMatch` calls `HubBoards`, so the leaderboard file has to be first.

### 2. Extend the Nakama types

In `server/modules/src/nakama.d.ts`, add:

```ts
matchCreate(module: string, params: { [key: string]: string }): string;
```

on `Nakama`, and on `Initializer`:

```ts
registerMatch(name: string, handler: { [key: string]: unknown }): void;
```

### 3. Register

In `server/modules/src/main.ts`, inside `InitModule`, after the existing RPC registrations:

```ts
initializer.registerMatch("hub", HubMatch.handler);
nk.matchCreate("hub", {});

initializer.registerRpc("loadout/hpos10i", rpcLoadoutHpos);
initializer.registerRpc("loadout/nobu", rpcLoadoutNobu);
initializer.registerRpc("loadout/peoples-bitcoin", rpcLoadoutPb);
initializer.registerRpc("loadout/sproto", rpcLoadoutSproto);
initializer.registerRpc("equip_change", rpcEquipChange);
initializer.registerRpc("leaderboard.top", rpcLeaderboardTop);
```

Pin each loadout id with a wrapper that calls `guard(HubLoadout.read, ..., "{\"game\":\"<id>\"}")`. `equip_change` calls `guard(HubLoadout.equip, ...)`. `leaderboard.top` calls `guard(HubBoards.top, ...)`.

Do not register a second score RPC. Replace the body of `HubRpc.scoreSubmit` in `server/modules/src/rpcs.ts` with `return HubBoards.submit(ctx, logger, nk, payload);`. Until that replacement, the live `score.submit` still writes `game.score_best` and does not apply these ranked rules.

`nk.matchCreate` runs once per process. One Nakama node is one hub instance.

### 4. Number the tables

Add the SQL above as the next ledger migration. Do not append it to the old `HubSchema` statement list if the ledger is what boots the database. Do not change the text of `0002_baseline`.

## Files wiring has to touch

| File | Change |
| --- | --- |
| `server/modules/tsconfig.json` | Add the three modules to `files` |
| `server/modules/src/nakama.d.ts` | `registerMatch` and `matchCreate` |
| `server/modules/src/main.ts` | Register the match, `matchCreate`, and the RPCs |
| `server/modules/src/rpcs.ts` | `score.submit` delegates to `HubBoards.submit` |
| `server/modules/src/schema.ts` | One new ledger entry after #24 is on main. Not an edit of `0002` |

The hub client and SDK are a later change, after #12 and #25, because those PRs already edit them. They are not part of registration:

| File | Change |
| --- | --- |
| `packages/hub-sdk/src/types.ts` | `equip` and the loadout types |
| `packages/hub-sdk/src/live.ts` | Call `equip_change`. Send `godMode: true` if a god-mode session still posts a score |
| `packages/hub-sdk/src/createHubSdk.ts` | Same calls on the mock |
| `packages/hub-sdk/src/index.ts` | Export the new types |
| `apps/hub/src/main.ts` | Join match `hub` and apply snapshots |

`server/modules/src/schema.ts` on today's main has no ledger. Wait until #24 has merged before adding the migration entry.
