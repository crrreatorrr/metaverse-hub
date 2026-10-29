# M6 server prep

Sproto pets: cosmetic item grants, the hub pet slot, and the `profile.get` pets helper. Nothing here is registered or applied. No migration file is added, and no `schema_migrations` id is reserved. QA owns tests. This change adds none.

The runtime is the TypeScript Nakama module (`InitModule` in `server/modules/src/main.ts`). There is no Go plugin. `server/modules/src/rpcs.ts` (`profile.get`, `session.event`) and `server/modules/src/schema.ts` stay as they are. Open PRs #12, #13, #18, #23, #24, #25, #27, #28, and #29 already edit those files or the files around them, so this branch only adds files.

## Files

| File | Role |
| --- | --- |
| `server/modules/src/item_grant.ts` | `session.event` item grant. One statement, not an RPC |
| `server/modules/src/pets.ts` | `profilePets`, `loadout.set_hub`, unwired backfill |
| `docs/m6-server-prep.md` | This wiring list |

Neither TypeScript file is in the `files` array of `server/modules/tsconfig.json`, so `tsc` does not concatenate them into `server/modules/build/index.js`. `InitModule` does not register `loadout.set_hub` and does not call the grant or the backfill. Loading the files, once they are compiled in, only checks the in-memory catalog. It does not open a session or write a row.

## Grant rule

Pets and other cosmetic items are granted only inside `session.event`, and only when a `game.item_rule` row matches. The match is the same subset test relics use (`item_rule.match <@ event data`), so extra fields such as `time` still match. The insert is `INSERT … ON CONFLICT (user_id, item_id) DO NOTHING`. A second grant for the same player and item adds no `item_owned` row and no second `item_ledger` row. The primary key is the one-per-player cap.

The statement does not credit Tickets, Verse, or Relics. It does not write `game.relic_claim` or `game.game_beaten`. It does not run from a purchase RPC, an exchange RPC, or any other direct RPC. `game_beaten` is rejected before the query and again inside the statement.

The session predicate is the one `game.apply_event` already uses for relics: the row is open, `game_id` is the session's game, `lease_until > now()`, and the portal ticket has been redeemed. The game id is the server session, never a field on the client body. God-mode wins are granted, the same as Relics. The grant does not read a client `ranked` or `godMode` flag.

`granted_items` on a replay has to be the list from the first call. `nk.sqlQuery` cannot share `game.apply_event`'s transaction, so the statement has to be pasted into `game.apply_event` before the idempotency insert. Calling `HubItems.grantFromEvent` after `apply_event` returns would be a second transaction, and a replay of the same key would store an empty list. `HubItems.grantFromEvent` is the statement itself. It is not a registered RPC.

Canonical events the statement will grant on:

| Event | Session game | `event_rule` already on main | `max_amount` |
| --- | --- | --- | --- |
| `hpos10i.level_complete` | `hpos10i` | yes, relic row | unchanged (NULL) |
| `nobu.boss_defeated` | `nobu` | yes, relic row | unchanged (NULL) |
| `sproto.boss_defeated` | `sproto` | yes, relic row | unchanged (NULL) |
| `pb.quest_complete` | `peoples-bitcoin` | yes, relic row | unchanged (NULL) |
| `pb.item_obtained` | `peoples-bitcoin` | no, new reason | `0` |

`max_amount` is the Ticket ceiling for that event reason. `0` means the event credits no Tickets. Existing relic rows stay NULL so this prep does not change their Ticket behaviour (they do not pay Tickets today either). The one-per-player item cap is the `item_owned` primary key, not `max_amount`.

A new event reason is an `event_rule` row that sets `max_amount`, plus an `item_rule` row, plus one entry in `CANONICAL` inside `item_grant.ts`. This branch adds one new reason: `pb.item_obtained`.

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
| `pet_sproto_pup` | `peoples-bitcoin` | `pb.item_obtained` | `{"itemId":"pet_sproto_pup"}` |

People's Bitcoin session game id is `peoples-bitcoin`. The event type string stays `pb.quest_complete` / `pb.item_obtained`, which is what the game reports and what `game.event_rule` already uses for the quest relic.

`pet_sproto_pup` is granted only by that `item_rule` match. It is not in the backfill, not granted at account creation, and not derived from a Relic. Until the seed exists and a session reports `pb.item_obtained` with `itemId` `pet_sproto_pup`, the player does not own it.

These catalog ids have no live `item_rule` in this prep:

| pet_id | Why there is no live grant |
| --- | --- |
| `pet_baby_sproto` | Spec trigger is the first `exchange_tx`. That is `tickets.exchange`, not a canonical `session.event`. |
| `pet_four_lights_sproto` | Spec trigger is `count(relic_claim) = 4` inside the relic transaction. That is not an `item_rule` match on an event payload. |
| `pet_hopium_sproto` | Spec trigger is `store.purchase` (400 Verse). A purchase RPC is not a `session.event`. |
| `pet_coom_sproto` | Spec trigger is `store.purchase` (600 Verse). Same as Hopium. |
| `pet_speed_sproto` | Derived from `relic_claim.hpos10i_core`. Not stored. |
| `pet_nobu` | Derived from `relic_claim.cones_tip`. Not stored. |
| `pet_duelist_sproto` | Derived from `relic_claim.tinubu_crown`. Not stored. |

`genesis_shard` does not derive a hub pet. Four Lights is the separate "all four relics" pet, and it is backfill-only until a canonical event exists.

## `loadout.set_hub`

`HubPets.setHub` is the RPC handler. Register it later as `loadout.set_hub`. A hub session may call it. A game session (`scope` `game`) gets `not_hub_session`.

Payload `{ "v": 1, "pet": "<id>"|null, "seq": <positive integer> }`. `v` may be omitted. `pet` is required and is either `null` (unequip) or a catalog id. Any other id, including a forged one, is `not_owned` and writes nothing.

Ownership is the same set `profilePets` returns. An `item_owned` row counts for every catalog pet that is not a relic summon. `pet_speed_sproto`, `pet_nobu`, and `pet_duelist_sproto` count when `relic_claim` has `hpos10i_core`, `cones_tip`, or `tinubu_crown`. Equipping does not insert `item_owned` and does not write `item_ledger`.

`seq` is an integer from 1 through `2^53 - 1` and must be greater than the stored seq. The same seq with the same pet that is still owned returns `ok: true` and does not write again. A lower or equal seq with a different pet is `stale_seq`.

The stored object is Nakama storage collection `loadout`, key `hub`:

```json
{ "v": 1, "slots": { "pet": "pet_honk_sproto" }, "seq": 1, "updated_at": "2026-10-29T22:00:00Z" }
```

`permission_read` is 1 (owner). `permission_write` is 0. `updated_at` is Postgres `now()` in UTC, not the client clock. The server builds `slots`. A client `slots` object on the payload is ignored.

This is not the M3 `game.loadout` row. That table is per game (`hpos10i`, `nobu`, `peoples-bitcoin`, `sproto`) and is added by #28. The hub pet is the storage key above so it does not depend on that table and does not collide with People's Bitcoin `slots.summon`.

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

## Backfill

`HubPets.backfill(nk)` grants two pets for rows that already exist. It is not called from `InitModule`, from `session.event`, or from any RPC. Do not register it.

| pet_id | Who gets a row |
| --- | --- |
| `pet_baby_sproto` | Any user with at least one `game.exchange_tx` row |
| `pet_four_lights_sproto` | Any user with all four of `hpos10i_core`, `genesis_shard`, `cones_tip`, `tinubu_crown` on `game.relic_claim` |

Source is `migration`. The `item_ledger` op is `grant_item`. `ref_id` is the new ledger `event_id`. `ON CONFLICT (user_id, item_id) DO NOTHING` makes a second call grant zero rows. The statement reads `exchange_tx` and `relic_claim`. It does not update them, and it does not write Tickets or Verse. `pet_sproto_pup` is not in the statement. Boss, quest, and act pets are not backfilled: those payloads are not stored, and the spec says the player earns them again by repeating the event.

This function is the spec's one-off. It is not a live grant path. Live grants stay on `session.event` plus `item_rule`.

## Statement to paste into `game.apply_event`

Declare `v_items json` next to the other variables. After the relic block updates `v_response`, and before the idempotency insert, run the statement `HubItems.grantFromEvent` runs. With the constants spliced in, that statement is:

```sql
WITH sess AS (
  SELECT 1 FROM game.game_session
  WHERE session_id = p_session_id AND user_id = p_user_id AND game_id = p_game_id
    AND state = 'open' AND lease_until > now() AND ticket_redeemed_at IS NOT NULL
),
eligible AS (
  SELECT r.item_id FROM game.item_rule r
  WHERE EXISTS (SELECT 1 FROM sess)
    AND (
      (p_game_id = 'hpos10i' AND p_event_id = 'hpos10i.level_complete')
      OR (p_game_id = 'nobu' AND p_event_id = 'nobu.boss_defeated')
      OR (p_game_id = 'sproto' AND p_event_id = 'sproto.boss_defeated')
      OR (p_game_id = 'peoples-bitcoin' AND p_event_id = 'pb.quest_complete')
      OR (p_game_id = 'peoples-bitcoin' AND p_event_id = 'pb.item_obtained')
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
        AND (NOT (p_event_id = 'pb.item_obtained') OR e.max_amount = 0)
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

Inside `apply_event` the session was already locked, so `sess` is present whenever this runs. Always store `granted_items`, including `[]`. A relic response becomes `{ "granted": "<relic_id>", "granted_items": [] }` when the event grants a Relic and no item. An item-only event becomes `{ "granted_items": ["pet_honk_sproto"] }`.

The TypeScript function binds the same statement as `$1` user, `$2` session, `$3` game, `$4` event type, `$5` data jsonb, and returns `{ error, granted_items }`. Use the plpgsql form above for the real wiring. Keep `CANONICAL` in `item_grant.ts` in step with this list.

## Schema to number later

No migration file is in this branch. #24 (not on main) records `0001_schema_migrations`, `0002_baseline`, and `0003_merge_pb_into_peoples_bitcoin`. Its notes reserve later ids for #12 and #13. #17 and #28 also need free ids. This branch does not pick or reserve one.

When this is wired, put the statements below in one new ledger entry. The id is the next free id in `game.schema_migrations` at that time. Do not edit `0002_baseline` or any id already stored. A changed checksum fails startup. Do not append these statements to the `HubSchema` list on today's main if the ledger is what boots the database.

`game.item_ledger` and `game.event_rule` already exist. This entry creates the two new tables, widens the ledger check, and adds `max_amount`. It does not recreate the ledger.

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

ALTER TABLE game.event_rule ADD COLUMN max_amount bigint;
ALTER TABLE game.event_rule DROP CONSTRAINT IF EXISTS event_rule_max_amount;
ALTER TABLE game.event_rule ADD CONSTRAINT event_rule_max_amount
  CHECK (max_amount IS NULL OR max_amount >= 0);

INSERT INTO game.event_rule (game_id, event_type, relic_id, tickets, session_limit, day_limit, match, max_amount)
VALUES ('peoples-bitcoin', 'pb.item_obtained', NULL, NULL, NULL, NULL, '{}'::jsonb, 0)
ON CONFLICT (game_id, event_type) DO NOTHING;

INSERT INTO game.item_rule (game_id, event_type, item_id, match)
VALUES
  ('hpos10i', 'hpos10i.level_complete', 'pet_honk_sproto', '{"zone":"z1_retro_rush_hills","act":2}'::jsonb),
  ('hpos10i', 'hpos10i.level_complete', 'pet_spiral_sproto', '{"zone":"z2_wizard_academy","act":2}'::jsonb),
  ('nobu', 'nobu.boss_defeated', 'pet_mecha_sproto', '{"boss":"bird"}'::jsonb),
  ('nobu', 'nobu.boss_defeated', 'pet_conehead_sproto', '{"boss":"cat"}'::jsonb),
  ('sproto', 'sproto.boss_defeated', 'pet_presidential_sproto', '{"boss":"obama"}'::jsonb),
  ('peoples-bitcoin', 'pb.quest_complete', 'pet_moon_sproto', '{"questId":"quest_moonward"}'::jsonb),
  ('peoples-bitcoin', 'pb.item_obtained', 'pet_sproto_pup', '{"itemId":"pet_sproto_pup"}'::jsonb)
ON CONFLICT (game_id, event_type, item_id) DO NOTHING;
```

`ON CONFLICT DO NOTHING` on the pup `event_rule` will not fill `max_amount` if a row for that event type is already there. The grant requires `max_amount = 0` for `pb.item_obtained`, so a pre-existing row without that value grants nothing until it is set. Do not change the relic rows for `hpos10i.level_complete`, `nobu.boss_defeated`, `sproto.boss_defeated`, or `pb.quest_complete`.

The grant statement references `event_rule.max_amount`, so this entry has to be applied before that statement is installed in `apply_event`.

`source = 'meta'` and `source = 'store'` and `op = 'purchase'` are in the checks because the spec shares `item_owned` with the store. This branch writes only `source = 'event'` (live) and `source = 'migration'` (the unwired backfill). It does not write `purchase`.

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

One new ledger id, the next free one. Statements are the block above. Then install the `apply_event` paste. Order matters because the paste reads `max_amount`.

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

Do not register a grant RPC. Do not register `backfill`.

### 4. `profile.get` and `session.event`

In `server/modules/src/rpcs.ts`, one line in `HubRpc.profile`:

```ts
profileBody.pets = HubPets.profilePets(nk, userId);
```

In `server/modules/src/schema.ts`, paste the statement into `game.apply_event` as shown above. Do not also call `HubItems.grantFromEvent` from `HubRpc.sessionEvent`.

### 5. Leave the backfill unwired

`HubPets.backfill` stays uncalled until Architect accepts that one-off. It is not part of startup.

## Files wiring has to touch

| File | Change |
| --- | --- |
| `server/modules/tsconfig.json` | Add `item_grant.ts` and `pets.ts` to `files` |
| `server/modules/src/main.ts` | Register `loadout.set_hub` only |
| `server/modules/src/rpcs.ts` | `profile.get` adds `pets` from `HubPets.profilePets` |
| `server/modules/src/schema.ts` | One new ledger entry, the next free id, and the `apply_event` paste |

`server/modules/src/nakama.d.ts` needs no edit for this to typecheck while the `declare namespace` block remains. The hub client and SDK are a later change. #12 and #25 already edit them.

`server/modules/src/schema.ts` on today's main has no ledger. Wait until #24 has merged before adding the migration entry.

## Questions for Architect

1. `pet_baby_sproto` and `pet_four_lights_sproto` have no canonical `session.event`. Live `item_rule` rows are not seeded. `HubPets.backfill` covers the spec's `exchange_tx` and four-relic cases and is not called. Should that function stay as the one-off, or should each pet get a new event reason with `event_rule.max_amount` instead?
2. `pet_hopium_sproto` and `pet_coom_sproto` are `store.purchase` in the spec. That path is a direct RPC, so they are not granted here. Which `session.event` should match them?
3. Relic summons are derived from `relic_claim` and are not inserted into `item_owned`. `loadout.set_hub` treats them as owned when the relic row exists. The spec's set-hub sentence names `item_owned` only. Confirm derived ownership is the equip check.
4. `pb.item_obtained.max_amount` is `0`, meaning that event credits no Tickets. Confirm that reading. The item cap is the primary key.
5. The session check copied from relics is open, same game, `lease_until > now()`, and ticket redeemed. Confirm that is the "minimum age" check.
6. The hub pet is Nakama storage `loadout` / `hub` with `permission_read` 1 and `permission_write` 0, not a `game.loadout` row. Confirm that split from the M3 table.
