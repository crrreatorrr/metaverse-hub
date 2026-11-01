# M6 server prep

Sproto pets: cosmetic item grants, the hub pet slot, and the `profile.get` pets helper. The pet RPCs and the item grant are not registered. No migration file is added, and no `schema_migrations` id is reserved. QA owns tests. This change adds none.

The runtime is the TypeScript Nakama module (`InitModule` in `server/modules/src/main.ts`). There is no Go plugin. `profile.get`, the item-grant paste, and `server/modules/src/schema.ts` stay as they are on main. This branch does not add `game.lock_open_session` and does not replace `game.apply_event`.

## Files

| File | Role |
| --- | --- |
| `server/modules/src/item_grant.ts` | `session.event` item grant. One statement, not an RPC |
| `server/modules/src/pets.ts` | `profilePets`, `loadout.set_hub`, `derivedOwned`, backfill statement (not executed) |
| `docs/m6-server-prep.md` | This wiring list |

Neither pet module is in the `files` array of `server/modules/tsconfig.json`, so `tsc` does not concatenate them into `server/modules/build/index.js`. `InitModule` does not register `loadout.set_hub` and does not run a grant or the backfill. Loading the pet modules, once they are compiled in, only checks the in-memory catalog. It does not open a session or write a row.

## Grant rule

Pets and other cosmetic items are granted only inside `session.event`, and only when a `game.item_rule` row matches. The match is the same subset test relics use (`item_rule.match <@ event data`), so extra fields such as `time` still match. The insert is `INSERT … ON CONFLICT (user_id, item_id) DO NOTHING`. A second grant for the same player and item adds no `item_owned` row and no second `item_ledger` row. The primary key is the one-per-player cap.

The statement does not credit Tickets, Verse, or Relics. It does not write `game.relic_claim` or `game.game_beaten`. It does not run from a purchase RPC, an exchange RPC, or any other direct RPC. `game_beaten` is rejected before the query and again inside the statement.

The session predicate in the grant statement is an inline copy of `game.apply_event`'s relic session check: the row is this session, this user, and this game, `state = 'open'`, `lease_until > now()`, and `ticket_redeemed_at IS NOT NULL`, locked with `FOR UPDATE`. A comment in `item_grant.ts` says that predicate must stay equal to `apply_event`. The game id is the server session, never a field on the client body. God-mode wins are granted, the same as Relics. The grant does not read a client `ranked` or `godMode` flag. No new event reason is added. `event_rule` is not altered, and `max_amount` is not added.

`granted_items` on a replay has to be the list from the first call. `nk.sqlQuery` cannot share `game.apply_event`'s transaction, so the statement has to be pasted into `game.apply_event` before the idempotency insert. Calling `HubItems.grantFromEvent` after `apply_event` returns would be a second transaction, and a replay of the same key would store an empty list. `HubItems.grantFromEvent` is the statement itself. It is not a registered RPC.

Canonical events the statement will grant on. Each one already has an `event_rule` row on main. This branch adds no event reason.

| Event | Session game |
| --- | --- |
| `hpos10i.level_complete` | `hpos10i` |
| `nobu.boss_defeated` | `nobu` |
| `sproto.boss_defeated` | `sproto` |
| `pb.quest_complete` | `peoples-bitcoin` |

These ids are never written to `item_owned`, even if an `item_rule` names them. Relics stay on `relic_claim`. The three relic summons stay derived:

`hpos10i_core`, `genesis_shard`, `cones_tip`, `tinubu_crown`, `pet_speed_sproto`, `pet_nobu`, `pet_duelist_sproto`.

An empty `item_rule.match` (`{}`) does not grant. Every seeded match below is a non-empty object.

## Item rules that grant

Seeded when the ledger entry is applied. Not applied in this branch.

| pet_id | game_id | event_type | match |
| --- | --- | --- | --- |
| `pet_honk_sproto` | `hpos10i` | `hpos10i.level_complete` | `{"zone":"z1_retro_rush_hills","act":2}` |
| `pet_spiral_sproto` | `hpos10i` | `hpos10i.level_complete` | `{"zone":"z2_wizard_academy","act":2}` |
| `pet_mecha_sproto` | `nobu` | `nobu.boss_defeated` | `{"boss":"bird"}` |
| `pet_conehead_sproto` | `nobu` | `nobu.boss_defeated` | `{"boss":"cat"}` |
| `pet_presidential_sproto` | `sproto` | `sproto.boss_defeated` | `{"boss":"obama"}` |
| `pet_moon_sproto` | `peoples-bitcoin` | `pb.quest_complete` | `{"questId":"quest_moonward"}` |
| `pet_sproto_pup` | `peoples-bitcoin` | `pb.quest_complete` | `{"questId":"quest_hatchery"}` |

People's Bitcoin session game id is `peoples-bitcoin`. The event type is `pb.quest_complete`, the event already on `game.event_rule`. There is no `pb.item_obtained` row and no new `event_rule` seed.

`pet_sproto_pup` is granted only when that quest match hits. A client cannot claim it by reporting an item id. It is not in the backfill, not granted at account creation, and not derived from a Relic. Until the seed exists and a session reports `pb.quest_complete` with `questId` `quest_hatchery`, the player does not own it.

These catalog ids have no `item_rule` in this prep:

| pet_id | Grant, when it is wired |
| --- | --- |
| `pet_baby_sproto` | Server-internal, inside the exchange transaction, when that insert is the user's first `exchange_tx` row. `INSERT … ON CONFLICT (user_id, item_id) DO NOTHING`, then `item_ledger` op `grant_item` only if the insert added a row. No event reason. |
| `pet_four_lights_sproto` | Server-internal, inside the relic-claim transaction, when `count(relic_claim)` for that user reaches 4. Same `ON CONFLICT DO NOTHING` plus `grant_item`. No event reason. |
| `pet_hopium_sproto` | M7 `store.purchase` only. 400 Verse. Not a `session.event`. |
| `pet_coom_sproto` | M7 `store.purchase` only. 600 Verse. Not a `session.event`. |
| `pet_speed_sproto` | Derived from `relic_claim.hpos10i_core`. Not stored. |
| `pet_nobu` | Derived from `relic_claim.cones_tip`. Not stored. |
| `pet_duelist_sproto` | Derived from `relic_claim.tinubu_crown`. Not stored. |

`genesis_shard` does not derive a hub pet. Four Lights is the separate "all four relics" pet. Baby Sproto and Four Lights get no `item_rule` and no `event_rule` row. Their live grants are the two server-internal inserts above, wired later. This branch does not edit `game.exchange_tickets` or the relic insert.

## `loadout.set_hub`

`HubPets.setHub` is the RPC handler. Register it later as `loadout.set_hub`. A hub session may call it. A game session (`scope` `game`) gets `not_hub_session`.

Payload `{ "v": 1, "pet": "<id>"|null, "seq": <positive integer> }`. `v` may be omitted. `pet` is required and is either `null` (unequip) or a catalog id. Any other id, including a forged one, is `not_owned` and writes nothing.

Ownership for the picker and for equip is the function `ownedSet` in `HubPets`. `profilePets` and `setHub` both call that function and no other ownership check. An `item_owned` row counts for every catalog pet that is not a relic summon. The three summons go through `HubPets.derivedOwned`: `pet_speed_sproto`, `pet_nobu`, and `pet_duelist_sproto` are owned when `relic_claim` has `hpos10i_core`, `cones_tip`, or `tinubu_crown`. Equipping does not insert `item_owned` and does not write `item_ledger`. M7 calls `derivedOwned` with the item id before it debits Verse.

`seq` is an integer from 1 through `2^53 - 1` and must be greater than the stored seq. The same seq with the same pet that is still owned returns `ok: true` and does not write again. A lower or equal seq with a different pet is `stale_seq`.

The stored object is Nakama storage collection `loadout`, key `hub`. That is `loadout/hub`. It is separate from `game.loadout` (the M3 per-game table, which has no `hub` row). `permission_read` is 1 (owner). `permission_write` is 0. The server builds `slots`. A client `slots` object on the payload is ignored. `seq` has to be higher than the stored seq before a write. `updated_at` is Postgres `now()` in UTC, not the client clock.

```json
{ "v": 1, "slots": { "pet": "pet_honk_sproto" }, "seq": 1, "updated_at": "2026-10-29T22:00:00Z" }
```

This storage object is not the M3 `game.loadout` row. That table is per game (`hpos10i`, `nobu`, `peoples-bitcoin`, `sproto`) and is added by #28. The hub pet stays on `loadout/hub` so it does not depend on that table and does not collide with People's Bitcoin `slots.summon`.

Response:

```json
{ "ok": true, "v": 1, "slots": { "pet": "pet_honk_sproto" }, "seq": 1, "updated_at": "2026-10-29T22:00:00Z" }
```

Failures that are not protocol errors use `ok: false` and `reason` `not_owned` or `stale_seq`, plus the current filtered slot. `unauthorized`, `bad_json`, and `not_hub_session` use `{ "error", "message" }`.

A stored pet the player no longer owns is returned as `null` from this RPC and from `profilePets`. The raw storage value is left in place until the next successful `setHub`. Presence should read `profilePets`, not the raw storage object.

## `profile.get` helper

`HubPets.profilePets(nk, userId)` returns `{ owned: string[], active: string|null }`. `owned` is sorted. `active` is `slots.pet` when that id is in `owned`, otherwise `null`. The helper does not write.

Wiring, inside `HubRpc.profile`, after `profileBody` is built and before `return ok(profileBody)`:

```ts
profileBody.pets = HubPets.profilePets(nk, userId);
```

That is the whole edit. This branch does not make it. The response shape gains:

```json
"pets": { "owned": ["pet_honk_sproto", "pet_speed_sproto"], "active": "pet_honk_sproto" }
```

`pet_speed_sproto` appears because `hpos10i_core` is claimed, not because an `item_owned` row exists.

## Backfill migration

The statement in `backfillSql` is not executed and there is no function to call. When it is wired, it becomes one ledger entry: the next free id in `game.schema_migrations` at that time. This branch does not reserve that id. The entry is inserts only (`item_owned` and `item_ledger`), idempotent through `ON CONFLICT (user_id, item_id) DO NOTHING`. It does not update Tickets, Verse, `exchange_tx`, or `relic_claim`.

| pet_id | Who gets a row |
| --- | --- |
| `pet_baby_sproto` | Any user with at least one `game.exchange_tx` row |
| `pet_four_lights_sproto` | Any user with all four of `hpos10i_core`, `genesis_shard`, `cones_tip`, `tinubu_crown` on `game.relic_claim` |

Source is `migration`. The `item_ledger` op is `grant_item`. `ref_id` is the new ledger `event_id`. A second apply grants nothing. `pet_sproto_pup` is not in the statement. Boss, quest, and act pets are not backfilled: those payloads are not stored, and the player earns them again by repeating the event.

Live grants for Baby Sproto and Four Lights are separate from this migration. They are the server-internal inserts described above, wired later into the exchange transaction and the relic-claim transaction. They are not event reasons and they are not this backfill.

## Statement to paste into `game.apply_event`

Declare `v_items json` next to the other variables. After the relic block updates `v_response`, and before the idempotency insert, run the statement `HubItems.grantFromEvent` runs. With the constants spliced in, that statement is:

```sql
WITH sess AS (
  -- MUST equal game.apply_event's relic session check.
  SELECT event_seq FROM game.game_session
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND game_id = p_game_id
    AND state = 'open'
    AND lease_until > now()
    AND ticket_redeemed_at IS NOT NULL
  FOR UPDATE
),
eligible AS (
  SELECT r.item_id FROM game.item_rule r
  WHERE EXISTS (SELECT 1 FROM sess)
    AND (
      (p_game_id = 'hpos10i' AND p_event_id = 'hpos10i.level_complete')
      OR (p_game_id = 'nobu' AND p_event_id = 'nobu.boss_defeated')
      OR (p_game_id = 'sproto' AND p_event_id = 'sproto.boss_defeated')
      OR (p_game_id = 'peoples-bitcoin' AND p_event_id = 'pb.quest_complete')
    )
    AND r.game_id = p_game_id AND r.event_type = p_event_id
    AND r.event_type <> 'game_beaten'
    AND r.match <> '{}'::jsonb
    AND r.match <@ COALESCE(p_data, '{}'::jsonb)
    AND r.item_id NOT IN (
      'hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown',
      'pet_speed_sproto', 'pet_nobu', 'pet_duelist_sproto'
    )
    AND EXISTS (
      SELECT 1 FROM game.event_rule e
      WHERE e.game_id = r.game_id AND e.event_type = r.event_type
        AND e.event_type <> 'game_beaten'
    )
),
ins AS (
  INSERT INTO game.item_owned (user_id, item_id, source, ref_id)
  SELECT p_user_id, item_id, 'event', gen_random_uuid() FROM eligible
  ON CONFLICT (user_id, item_id) DO NOTHING
  RETURNING item_id, ref_id
),
led AS (
  INSERT INTO game.item_ledger (event_id, user_id, op, item_id, source, ref_id)
  SELECT ref_id, p_user_id, 'grant_item', item_id, 'event', ref_id FROM ins
  RETURNING item_id
)
SELECT COALESCE(json_agg(item_id ORDER BY item_id), '[]'::json) INTO v_items FROM led;

v_response := COALESCE(v_response, '{}'::jsonb)
  || jsonb_build_object('granted_items', COALESCE(v_items, '[]'::json));
```

Inside `apply_event` the relic path has already locked that same session row. The paste repeats the predicate so this branch does not replace `apply_event`. Always store `granted_items`, including `[]`. A relic response becomes `{ "granted": "<relic_id>", "granted_items": [] }` when the event grants a Relic and no item. An item-only event becomes `{ "granted_items": ["pet_honk_sproto"] }`. `pb.quest_complete` with `questId` `quest_hatchery` grants `pet_sproto_pup`. The same event with `questId` `quest_moonward` grants `pet_moon_sproto`. The relic row for that event type still matches `quest_tutorial` only.

The TypeScript function binds the same statement as `$1` user, `$2` session, `$3` game, `$4` event type, `$5` data jsonb, and returns `{ error, granted_items }`. Use the plpgsql form above until the shared helper below lands. Keep `CANONICAL` in `item_grant.ts` in step with this list.

## Shared session helper, in the wiring PR

This branch does not create `game.lock_open_session` and does not edit `game.apply_event`.

After #12, #25, and #13 are on main, the M6 wiring PR adds one numbered ledger entry. The id is the next free id in `game.schema_migrations` at that time. This branch does not reserve it. That entry is reviewed under rule (b). It contains:

1. `CREATE OR REPLACE FUNCTION game.lock_open_session(p_session_id uuid, p_user_id uuid, p_game_id text)` with the relic session check: `state = 'open'`, `lease_until > now()`, `ticket_redeemed_at IS NOT NULL`, and `FOR UPDATE`. `event_seq` 0 is an open session. No row returns NULL, which is today's `NOT FOUND` / `session_closed`.
2. `CREATE OR REPLACE FUNCTION game.apply_event` so the relic path calls `game.lock_open_session` instead of inlining that predicate. Relic grant behaviour stays the same.

After that function is applied, switch the grant statement's `sess` CTE from the inline copy to `SELECT game.lock_open_session(p_session_id, p_user_id, p_game_id)`. Until that migration, the inline predicate in `item_grant.ts` must stay equal to `apply_event`.

## Schema to number later

No migration file is in this branch. #24 (not on main) records `0001_schema_migrations`, `0002_baseline`, and `0003_merge_pb_into_peoples_bitcoin`. Its notes reserve later ids for #12 and #13. #17 and #28 also need free ids. This branch does not pick or reserve one.

When this is wired, put the statements below in one new ledger entry. The id is the next free id in `game.schema_migrations` at that time. Do not edit `0002_baseline` or any id already stored. A changed checksum fails startup. Do not append these statements to the `HubSchema` list on today's main if the ledger is what boots the database.

`game.item_ledger` and `game.event_rule` already exist. This entry is the only definition of `game.item_owned` and the only widening of `item_ledger_op`. M7 depends on both. M7 does not create `game.item_owned` and does not replace the op check. The columns are `user_id`, `item_id`, `source` checked to exactly `event`, `meta`, `store`, and `migration`, `ref_id`, and `acquired_at`, with primary key `(user_id, item_id)`. The ledger ops are exactly `grant_relic`, `grant_item`, `purchase`, and `admin_revoke`. This entry does not add a column to `event_rule` and it does not insert an event reason. It does not recreate the ledger.

```sql
CREATE TABLE game.item_owned (
  user_id uuid NOT NULL,
  item_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('event', 'meta', 'store', 'migration')),
  ref_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE game.item_rule (
  game_id text NOT NULL,
  event_type text NOT NULL,
  item_id text NOT NULL,
  match jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (game_id, event_type, item_id),
  CONSTRAINT item_rule_game CHECK (game_id IN ('hpos10i', 'nobu', 'peoples-bitcoin', 'sproto')),
  CONSTRAINT item_rule_not_game_beaten CHECK (event_type <> 'game_beaten')
);

ALTER TABLE game.item_ledger DROP CONSTRAINT item_ledger_op;
ALTER TABLE game.item_ledger ADD CONSTRAINT item_ledger_op
  CHECK (op IN ('grant_relic', 'grant_item', 'purchase', 'admin_revoke'));

INSERT INTO game.item_rule (game_id, event_type, item_id, match)
VALUES
  ('hpos10i', 'hpos10i.level_complete', 'pet_honk_sproto', '{"zone":"z1_retro_rush_hills","act":2}'::jsonb),
  ('hpos10i', 'hpos10i.level_complete', 'pet_spiral_sproto', '{"zone":"z2_wizard_academy","act":2}'::jsonb),
  ('nobu', 'nobu.boss_defeated', 'pet_mecha_sproto', '{"boss":"bird"}'::jsonb),
  ('nobu', 'nobu.boss_defeated', 'pet_conehead_sproto', '{"boss":"cat"}'::jsonb),
  ('sproto', 'sproto.boss_defeated', 'pet_presidential_sproto', '{"boss":"obama"}'::jsonb),
  ('peoples-bitcoin', 'pb.quest_complete', 'pet_moon_sproto', '{"questId":"quest_moonward"}'::jsonb),
  ('peoples-bitcoin', 'pb.quest_complete', 'pet_sproto_pup', '{"questId":"quest_hatchery"}'::jsonb)
ON CONFLICT (game_id, event_type, item_id) DO NOTHING;
```

Do not change the relic rows for `hpos10i.level_complete`, `nobu.boss_defeated`, `sproto.boss_defeated`, or `pb.quest_complete`. The Pup and Moonward rows are `item_rule` matches on the quest event that already exists. They are not new `event_rule` rows.

`source` allows `store` so M7 can insert a purchase. M7's `item_ledger` op is `purchase`, which this check already allows. This branch writes only `source = 'event'` (live quest, boss, and act grants) and `source = 'migration'` (the backfill entry above). Hopium and COOM wait for M7 `store.purchase`. This branch does not write `purchase`.

M7's pre-debit reject calls `HubPets.derivedOwned(nk, userId, itemId)`. That is the same relic-summon check `ownedSet` uses for `pet_speed_sproto`, `pet_nobu`, and `pet_duelist_sproto`. True means the player already has that summon from `relic_claim`, so the store returns `already_owned` and does not debit Verse or insert `item_owned`. Any other id returns false. M7 still checks `game.item_owned` itself for rows it or M6 stored. M7 does not copy the relic-to-pet map.

## Audit

Add these to the duplication audit when the tables exist. Each query must return 0 rows. This branch does not edit `server/test/dup/audit.sql`.

```sql
SELECT o.user_id, o.item_id
FROM game.item_owned o
WHERE o.ref_id IS NULL
   OR NOT EXISTS (
     SELECT 1 FROM game.item_ledger l
     WHERE l.user_id = o.user_id
       AND l.item_id = o.item_id
       AND l.ref_id = o.ref_id
       AND l.op IN ('grant_item', 'purchase')
   );

SELECT user_id, item_id, count(*)
FROM game.item_ledger
WHERE op = 'grant_item'
GROUP BY user_id, item_id
HAVING count(*) > 1;

SELECT user_id, item_id
FROM game.item_owned
WHERE item_id IN ('pet_speed_sproto', 'pet_nobu', 'pet_duelist_sproto',
                  'hpos10i_core', 'genesis_shard', 'cones_tip', 'tinubu_crown');
```

The third query is the derived-pet rule: those ids are not `item_owned` rows. `item_ledger` rows for `grant_relic` stay on the relic path and are not part of the `grant_item` count.

## Wiring after the ledger is on main

Do this on a branch from the main that contains #24. Leave #12, #13, #25, #28, and #29 rebase-free.

### 1. Number the tables

One new ledger id, the next free one, for `game.item_owned`, `game.item_rule`, and the `item_ledger` op widening. Then install the `apply_event` item paste. The `lock_open_session` migration is a separate later entry in the wiring PR. Neither id is reserved here.

### 2. Compile the modules

In `server/modules/tsconfig.json`, insert these immediately before `"src/main.ts"`:

1. `src/item_grant.ts`
2. `src/pets.ts`

`pets.ts` does not call `HubItems`. The order keeps the grant module in the bundle before the pet RPC.

`pets.ts` declares `storageRead` on `nkruntime.Nakama` and an optional `version` on `StorageWrite`, because `nakama.d.ts` (edited by #25) does not list them yet. When `nakama.d.ts` gains `storageRead`, keep the same signature or delete the `declare namespace` block in `pets.ts`. A conflicting merge will fail `tsc`.

### 3. Register one RPC

In `server/modules/src/main.ts`:

```ts
function rpcLoadoutSetHub(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubPets.setHub, ctx, logger, nk, payload);
}
```

Inside `InitModule`, with the other registrations:

```ts
initializer.registerRpc("loadout.set_hub", rpcLoadoutSetHub);
```

Do not register a grant RPC. Do not add a function that runs the backfill.

### 4. `profile.get` and `session.event`

In `server/modules/src/rpcs.ts`, one line in `HubRpc.profile`:

```ts
profileBody.pets = HubPets.profilePets(nk, userId);
```

In `server/modules/src/schema.ts`, paste the item statement into `game.apply_event` only after the wiring PR's ledger entry has replaced that function with one that calls `game.lock_open_session`. Do not also call `HubItems.grantFromEvent` from `HubRpc.sessionEvent`. Do not edit `schema.ts` on this branch.

### 5. Backfill is a migration

Copy `backfillSql` into its own ledger entry when Architect wires historical rows. Inserts only. Do not call it from `InitModule`. The id is whichever number is free then. This branch does not reserve it.

## Files wiring has to touch

| File | Change |
| --- | --- |
| `server/modules/tsconfig.json` | Add `item_grant.ts` and `pets.ts` to `files` |
| `server/modules/src/main.ts` | Register `loadout.set_hub` only |
| `server/modules/src/rpcs.ts` | `profile.get` adds `pets` from `HubPets.profilePets` |
| `server/modules/src/schema.ts` | In the wiring PR, after #12, #25, and #13: one unreserved ledger entry with `lock_open_session` and `CREATE OR REPLACE game.apply_event`, reviewed under rule (b). Then the item paste. Not this branch |

`server/modules/src/nakama.d.ts` needs no edit for this to typecheck while the `declare namespace` block remains. The hub client and SDK are a later change. #12 and #25 already edit them.

`server/modules/src/schema.ts` on today's main has no ledger. This branch does not change that file. Wait until #24 has merged, and until #12, #25, and #13 are on main, before the wiring PR adds the `lock_open_session` migration.

## Architect decisions recorded here

- The Pup is `item_rule ('peoples-bitcoin', 'pb.quest_complete', 'pet_sproto_pup', '{"questId":"quest_hatchery"}')`. There is no `pb.item_obtained` grant.
- Baby Sproto and Four Lights have no event reasons. Live grants are server-internal inserts, wired later. The historical rows are a one-time ledger migration, not a callable function.
- Hopium and COOM are granted only by M7 `store.purchase`.
- The three relic summons equip from `relic_claim` through `derivedOwned`, which `ownedSet` calls. `profilePets` and `setHub` both call `ownedSet`. M7 calls `HubPets.derivedOwned` before a store debit.
- `game.item_owned` and the `item_ledger` op check in this doc are the only definitions. M7 uses them and does not create a second table. The timestamp column is `acquired_at`. The ops are exactly `grant_relic`, `grant_item`, `purchase`, and `admin_revoke`.
- The session predicate in this branch is an inline copy of `game.apply_event`'s relic check. `lock_open_session` plus `CREATE OR REPLACE game.apply_event` is a later ledger migration in the wiring PR, after #12, #25, and #13, reviewed under rule (b). The grant then calls that helper. No id is reserved.
- The hub pet is Nakama storage `loadout/hub` (read 1, write 0, server-built slots, seq-guarded), separate from `game.loadout`.
