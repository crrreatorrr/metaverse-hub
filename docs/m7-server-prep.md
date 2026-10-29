# M7 server prep

Verse store purchase. Nothing here is registered or applied. #12, #13, and #25 edit `main.ts`, `rpcs.ts`, `schema.ts`, and `tsconfig.json`, so this branch only adds files. Wire it after those PRs merge, and after the store UI has a Bar to sit in (#18 and #25). #24's ledger is not on main. Do not edit `0002_baseline` or any id already stored in `game.schema_migrations`. QA owns tests. This change adds none.

The runtime is the TypeScript Nakama module (`InitModule` in `server/modules/src/main.ts`). There is no Go plugin. There is no hub UI in this prep. The Terminal is the store inside the Bar, next to the leaderboard wall, and that screen is a later change.

## Files

| File | Role |
| --- | --- |
| `server/modules/src/store.ts` | `store.purchase` and the catalogue loader |
| `docs/m7-server-prep.md` | This wiring list, the table SQL, and the seed |

`store.ts` is not in the `files` array of `server/modules/tsconfig.json`, so `tsc` does not concatenate it into `server/modules/build/index.js`. `InitModule` does not register `store.purchase`. No migration file is added. No ledger id is reserved.

## Session

`HubStore.purchase` runs on a hub session only.

| Session | Result | Writes |
| --- | --- | --- |
| No `userId`, or a user id that is not a UUID | `{ error: "unauthorized", message: "unauthorized" }` | none |
| `vars.scope` is anything other than `hub`, including empty and `game` | `{ ok: false, reason: "wrong_scope", verse }` | none (one balance read) |
| `vars.scope` is `hub` | purchase flow below | see below |

Hub tokens are minted with `scope = "hub"` (`beforeAuthenticateDevice`, `beforeSessionRefresh` when the current scope is not `game`, and recovery). Empty scope is rejected. A `scope` field on the body is ignored. The token is the session.

Wiring must assert, at the token mint, that every game token and every portal token has `scope = game`. That keeps a missing scope from being treated as a hub session.

## Purchase

RPC `store.purchase`. Payload `{ item_id, expected_price, idem_key }`. `idem_key` is a UUID v4. `price`, `defId`, and `key` are not read. The debit is `game.store_item.price_verse`. `expected_price` is only compared to that column.

| Body | Result | Writes |
| --- | --- | --- |
| Missing or non-v4 `idem_key` | `{ error: "bad_key", message: "bad_key" }` | none |
| `item_id` not a string of 1 to 64 characters | `{ error: "bad_json", message: "bad_json" }` | none |
| `expected_price` missing or not a safe integer | `{ error: "bad_price", message: "bad_price" }` | none |

A negative integer is a real `expected_price`. It does not match a server price, so the function returns `price_changed` and does not debit.

`HubStore.APPLY_SQL` is `game.apply_store_purchase`. Wiring installs that function. The RPC calls it once. Nakama runs that call as one transaction. Inside the function, in order:

1. Read `game.idempotency` for `(user_id, key)`. Same `req_hash`: return the stored response and stop. No second debit. Different `req_hash`: `{ ok: false, reason: "idempotency_mismatch", verse }` and do not replace the stored row. The hash covers `item_id` and `expected_price` only.
2. Read `game.store_item` (`price_verse`, `on_sale`, `catalog_version`, `effect`). No row: `{ ok: false, reason: "unknown_item", verse }` and no insert. `on_sale` false: `{ ok: false, reason: "not_for_sale", verse }` and no insert. `price_verse` different from `expected_price`: store `{ ok: false, reason: "price_changed", verse }` under the key and return it. No debit.
3. Before any debit: if `game.item_owned` has `(user_id, item_id)`, or the shared earned-id check below is true, store `{ ok: false, reason: "already_owned", verse }` and return it.
4. `SELECT balance FROM game.verse_wallet WHERE user_id = $1 FOR UPDATE`. No row, or `balance < price`: store `{ ok: false, reason: "insufficient_verse", verse }` and return it.
5. `UPDATE game.verse_wallet SET balance = balance - price` where `price` is the server `price_verse`. The table `CHECK (balance >= 0)` is the backstop. The `UPDATE` also requires `balance >= price`.
6. `INSERT game.verse_ledger` (`delta = -price`, `balance_after`, `source = 'store'`, `ref_id = purchase_id`).
7. `INSERT game.item_owned` (`source = 'store'`, `ref_id = purchase_id`, `acquired_at = now()`). The table is M6's. The primary key `(user_id, item_id)` is the duplicate guard. A racing second transaction fails here and rolls its own debit back.
8. `INSERT game.item_ledger` (`op = 'purchase'`, `source = 'store'`, `ref_id = purchase_id`).
9. `INSERT game.store_purchase` (`price` is the server price, `UNIQUE (user_id, idem_key)`, `UNIQUE (user_id, item_id)`).
10. `INSERT game.idempotency` (`rpc = 'store.purchase'`, `req_hash`, `response`) and return.

Success body: `{ ok: true, purchase_id, item_id, price, verse_after }`. `price` and `verse_after` come from the server row and the wallet, not from the client.

`already_owned`, `insufficient_verse`, and `price_changed` store that response under the key, so the same key returns the same answer and does not debit again. `unknown_item`, `not_for_sale`, `wrong_scope`, and `idempotency_mismatch` do not insert a new idempotency row.

A unique violation on the item primary key or on `store_purchase` rolls the debit back. If that key already has a response, the function returns it. Otherwise, when the item is now owned, it stores `already_owned` and returns that. One debit, one grant.

Crash points, all inert unless `HUB_FAULT_INJECT=1` and `game.fault_arm` is set:

| Point | Where |
| --- | --- |
| `purchase.before_rpc` | `HubFault.apply` after the body checks, before the function call |
| `purchase.after_wallet` | `game.fault_at` immediately after the wallet update, before the verse ledger insert. The duplication trigger on `game.verse_wallet` also calls this point |
| `purchase.after_item` | `game.fault_at` after `item_owned`, before `item_ledger` |
| `purchase.after_purchase` | `game.fault_at` after `store_purchase`, before the idempotency insert |
| `purchase.after_commit` | `HubFault.apply` after the function returns |

The same economy advisory lock as `game.exchange_tickets` (`economy:<user>`) is taken at the start of the function so a purchase and an exchange on one user do not interleave.

## Catalogue loader

`storeItemRejected` is the one earned-id check. `loadCatalog`, the seed validator, and the `already_owned` branch of `apply_store_purchase` all use it. It rejects a store row when any of these holds:

- `item_id` is in `game.item_rule` (M6's earn rules; the SQL predicate is `EXISTS` on that table)
- the id is relic-derived, using the same pairs as `HubPets.ownedSet`: `pet_speed_sproto` / `hpos10i_core`, `pet_nobu` / `cones_tip`, `pet_duelist_sproto` / `tinubu_crown`
- the id is in the server-internal set `{pet_baby_sproto, pet_four_lights_sproto}`
- `effect` is not null

`loadCatalog` throws `store_item_earned` when that check is true. The 20 seed rows pass it: every `effect` is null, and the prices sum to 4850. There is no display-name column. Display names live in the client catalog.

Portal FX and the robe aura are visuals. Their `effect` is null. They are not gameplay params. Staff skins and the bolt colour are in the seed. They do not replace the staff id and they have no gameplay param.

## Schema to number later

No migration file is in this PR. #24 (not on main) already uses `0001_schema_migrations`, `0002_baseline`, and `0003_merge_pb_into_peoples_bitcoin`, and reserves `0004` upward for #12 and #13. #17's play-lease migration and the M3 tables also have to take a free id from that ledger.

This migration depends on M6 (#30). M6 creates `game.item_owned` (`source` CHECK `IN ('event', 'meta', 'store', 'migration')`, `acquired_at`) and `game.item_rule`, and widens `item_ledger` ops to `grant_relic`, `grant_item`, `purchase`, and `admin_revoke`. M7 does not create `item_owned` and does not change that check. M7's entry only adds `game.store_item`, `game.store_purchase`, and `game.apply_store_purchase`.

`game.store_item` and `game.store_purchase` take the next free number when they are wired. This branch does not reserve an id. Do not edit `0002_baseline`. Do not append this SQL to the old `HubSchema` statement list if the ledger is what boots the database. One new ledger entry, after M6's. Statement order:

1. `game.store_item` and `game.store_purchase`.
2. The append-only trigger on `game.store_purchase`.
3. The seed `INSERT` and the validator `DO` block.
4. `HubStore.APPLY_SQL` (`game.apply_store_purchase`).

The purchase insert writes M6's `game.item_owned` with `source = 'store'` and `acquired_at`. It does not create that table.

```sql
CREATE TABLE game.store_item (
  item_id text PRIMARY KEY,
  kind text NOT NULL,
  price_verse bigint NOT NULL CHECK (price_verse > 0),
  on_sale boolean NOT NULL DEFAULT true,
  catalog_version int NOT NULL,
  effect text
);

CREATE TABLE game.store_purchase (
  purchase_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  item_id text NOT NULL,
  price bigint NOT NULL CHECK (price > 0),
  catalog_version int NOT NULL,
  idem_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idem_key),
  UNIQUE (user_id, item_id)
);
```

`UNIQUE (user_id, item_id)` on `game.store_purchase` is the purchase-row guard. The `game.item_owned` primary key is the one that rolls a racing debit back. Both are `(player, item)`.

```sql
DROP TRIGGER IF EXISTS store_purchase_append_only ON game.store_purchase;
CREATE TRIGGER store_purchase_append_only
  BEFORE UPDATE OR DELETE ON game.store_purchase
  FOR EACH ROW EXECUTE FUNCTION game.reject_mutation();
```

### Seed

The seed is this `INSERT` only. It is not a migration file in this PR. Catalog version is 1. Every row is on sale. Every `effect` is null. Prices are Gameplay's final list: 20 items, 4,850 V. The debit path does not read this list from the client or from `store.ts`. Display names are not in this table. After the insert, the validator raises `store_item_earned` when the shared check matches a row, and `store_catalog` when the table is not exactly these 20 rows at 4,850 V.

`hub_head_moonward_hat` is the head row. The design table that still says `hub_head_ten_spiral_hat` is not the seed.

```sql
INSERT INTO game.store_item (item_id, kind, price_verse, on_sale, catalog_version, effect) VALUES
  ('hub_face_clown_nose', 'face', 50, true, 1, NULL),
  ('hub_title_never_sell', 'title', 50, true, 1, NULL),
  ('hub_title_tartarian', 'title', 100, true, 1, NULL),
  ('hub_nameplate_golden_ticket', 'nameplate', 100, true, 1, NULL),
  ('hub_emote_mega_bark', 'emote', 100, true, 1, NULL),
  ('hub_emote_spin_dash', 'emote', 100, true, 1, NULL),
  ('nobu_body_hopium_bandana', 'body', 100, true, 1, NULL),
  ('hub_outfit_hopium_hoodie', 'outfit', 150, true, 1, NULL),
  ('duel_bolt_hopium_green', 'bolt', 150, true, 1, NULL),
  ('hub_head_moonward_hat', 'head', 200, true, 1, NULL),
  ('hub_back_sproto_plush', 'back', 200, true, 1, NULL),
  ('hub_trail_coom_sparks', 'trail', 250, true, 1, NULL),
  ('hub_trail_hopium_bubbles', 'trail', 250, true, 1, NULL),
  ('duel_staffskin_golden_ticket', 'staffskin', 250, true, 1, NULL),
  ('duel_staffskin_tartarian_stone', 'staffskin', 250, true, 1, NULL),
  ('hub_portal_terminal_glitch', 'portal', 300, true, 1, NULL),
  ('pet_hopium_sproto', 'pet', 300, true, 1, NULL),
  ('hub_outfit_presidential_suit', 'outfit', 450, true, 1, NULL),
  ('pet_coom_sproto', 'pet', 500, true, 1, NULL),
  ('hub_outfit_10inu_robe', 'outfit', 1000, true, 1, NULL);
```

```sql
DO $validate$
BEGIN
  IF EXISTS (
    SELECT 1 FROM game.store_item s
    WHERE (
      EXISTS (SELECT 1 FROM game.item_rule AS earned_rule WHERE earned_rule.item_id = s.item_id)
      OR s.item_id IN ('pet_speed_sproto', 'pet_nobu', 'pet_duelist_sproto')
      OR s.item_id IN ('pet_baby_sproto', 'pet_four_lights_sproto')
      OR s.effect IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'store_item_earned';
  END IF;

  IF (SELECT count(*) FROM game.store_item) <> 20
     OR (SELECT COALESCE(sum(price_verse), 0) FROM game.store_item) <> 4850
  THEN
    RAISE EXCEPTION 'store_catalog';
  END IF;
END
$validate$;
```

That `WHERE` predicate is `earnedSql("s.item_id", "s.effect")` from `store.ts`, the same check as `storeItemRejected`.

The last statement in that ledger entry is `HubStore.APPLY_SQL` from `server/modules/src/store.ts`. That string is the function body. Do not paste a second copy into the migration.

There is no resale, refund, gift, or trade RPC. `admin_revoke` does not credit Verse. A goodwill credit is a separate `verse_ledger` row with `source = 'admin_credit'`. This prep does not add that RPC.

Price changes are an update of `game.store_item.price_verse` for a later purchase. `game.store_purchase.price` stays the price that was charged. The sum check above is the seed, not a permanent constraint, so a later price change does not fail startup.

### Audit

Run after purchases. Each query must return no rows.

```sql
SELECT p.purchase_id
FROM game.store_purchase p
LEFT JOIN game.item_owned o ON o.user_id = p.user_id AND o.item_id = p.item_id
WHERE o.user_id IS NULL;

SELECT o.user_id, o.item_id
FROM game.item_owned o
LEFT JOIN game.store_purchase p ON p.user_id = o.user_id AND p.item_id = o.item_id
WHERE o.source = 'store' AND p.purchase_id IS NULL;

SELECT w.user_id
FROM (
  SELECT user_id, sum(-delta) AS spent
  FROM game.verse_ledger
  WHERE source = 'store'
  GROUP BY user_id
) w
JOIN (
  SELECT user_id, sum(price) AS spent
  FROM game.store_purchase
  GROUP BY user_id
) p ON p.user_id = w.user_id
WHERE w.spent IS DISTINCT FROM p.spent;

SELECT user_id, item_id
FROM game.item_ledger
WHERE op = 'purchase'
GROUP BY user_id, item_id
HAVING count(*) > 1;
```

## Wiring after #12, #13, and #25 merge

Do this on a branch from the main that contains those PRs and the #24 ledger. Leave those branches rebase-free. Do this before the Bar store UI, which waits on #18 and #25 as well.

### 1. Compile the module

In `server/modules/tsconfig.json`, insert `src/store.ts` immediately before `src/main.ts`. `src/fault.ts` is already earlier in that list. `HubStore.purchase` calls `HubFault.apply`.

### 2. Register

In `server/modules/src/main.ts`, inside `InitModule`, after the existing RPC registrations:

```ts
function rpcStorePurchase(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
  return guard(HubStore.purchase, ctx, logger, nk, payload);
}
```

```ts
initializer.registerRpc("store.purchase", rpcStorePurchase);
```

Do not register a second purchase id. Do not register it on a game session.

At the token mint, assert that every game token and every portal token has `scope = game`. Hub mints already set `scope = hub`.

### 3. Play lease

`store.purchase` must check the M11 play lease (#17) the same way the other writes do. Inside `game.apply_store_purchase`, before any insert, `PERFORM game.require_lease(p_user_id, p_lease_id)`. Pass `leaseId` from the body. Leave it out of the idempotency hash. A stale lease raises `session_superseded` and writes no idempotency row. `nk.sqlQuery` commits each call, so the `PERFORM` has to be inside this function, not a separate query before it. This prep does not add that parameter. #17 is not on main, and M7's migration does not create `game.require_lease`.

### 4. Number the tables

Give the statements in [Schema to number later](#schema-to-number-later) the next free id in #24's ledger, after M6's entry. That entry is `game.store_item`, `game.store_purchase`, and `HubStore.APPLY_SQL`. Do not create `game.item_owned` here and do not widen `item_ledger`. Do not change the text of `0002_baseline`.

## Files wiring has to touch

| File | Change |
| --- | --- |
| `server/modules/tsconfig.json` | Add `src/store.ts` to `files` immediately before `src/main.ts` |
| `server/modules/src/main.ts` | Register `store.purchase` |
| `server/modules/src/schema.ts` | One new ledger entry after #24 and M6 are on main. `store_item`, `store_purchase`, and `apply_store_purchase` only. Not an edit of `0002`. Not a new file under `server/modules/migrations` |
| `server/modules/src/store.ts` | Add `game.require_lease` inside `apply_store_purchase` when #17 is wired |

The hub client and SDK stay out of this prep. #12 and #25 already edit them, and the Terminal UI is later, in the Bar, after #18 and #25:

| File | Later change |
| --- | --- |
| `packages/hub-sdk/src/types.ts` | `store.purchase` request and response |
| `packages/hub-sdk/src/live.ts` | Send one `idem_key` per confirm, and the same key on retry |
| `packages/hub-sdk/src/createHubSdk.ts` | Same call on the mock |
| `apps/hub` Bar | The Terminal, next to the leaderboard wall. Verse balance, server price, confirm, no refunds. Owned rows show equip. Earn-only rows show no price |

`server/modules/src/schema.ts` on today's main has no ledger. Wait until #24 has merged before adding the migration entry.

## Open questions

- The attached design table still names `hub_head_ten_spiral_hat` and totals 5,150 V. This seed uses `hub_head_moonward_hat` and 4,850 V. Display names stay in the client catalog.
- The duplication harness still calls `store.buy` with `{ defId, key }` on a game token and reads `game.purchase_tx` and `game.cosmetic_owned`. This RPC is `store.purchase` on a hub session with `{ item_id, expected_price, idem_key }`. QA owns the harness. It is not edited here.
