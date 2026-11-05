# Second hub world: audit and design

Status: draft for the owner's approval. Audited against `origin/main` at `1c5ff75`. The audit was a static
read, plus one production build. No server, load test or duplication suite was run for it.

## Intent

The owner wants a second themed 3D world, with its own art and its own identity, connected to the existing
hub. Players should feel they are the same character in both places. Each world must stay free to add
things the other doesn't have.

## What the owner decided

- The new world connects back to the main hub. It does not need its own route back from the games.
- Relics work in both worlds.
- Certain physics and movement rules match across worlds.
- Each world can add new things of its own.
- It has different 3D assets from the current hub.

## Calls made in this design

The owner can overrule any of these.

| Call | Why |
| --- | --- |
| Same repo, not a clone | The server has to be shared anyway, and movement fixes would otherwise be made twice. |
| Games stay in the main hub | This is how the owner's "takes you to the main hub" was read. It keeps the new world free of portal and game-return work. |
| Relics are earned only through games | This is how they work today. It also keeps the ticket and session protections in place. |
| "Realm" is the code word for a themed world | "World" already means a shard on screen (`World 2 · 41/100`). The player-facing name is still open. |
| Each realm is its own page, at `/realm/<id>/` | `/world/` is already the asset root. A full page load also frees memory and keeps downloads separate. |
| Plaza stays at `/hub/` | Games, the SDK and existing links all assume it. |
| A realm is not a `GameId` | Making it one touches many allow-lists and SQL checks, and forces a re-sync in every game repo. |
| Plain git for assets, final exports only | Nothing uses LFS today. One more world fits if files aren't committed repeatedly. |
| Portal and travel logic stays generic in `core/`, with portal lists passed in | If games are later wanted in the new realm, the refactor doesn't have to be redone. |
| The foundation is built against a plain gray test realm, `sandbox` | The theme and activities aren't decided, and the refactor doesn't depend on them. |
| Capacity is first tested locally, against the 600–1000 player estimate shared by all realms | The repo documents no staging server. A staging run is the owner's decision. |

## Goals

1. A player can walk through a gate from the plaza into the new realm and back, still signed in.
2. Movement feels identical in both, and a test fails if the shared values drift.
3. Relics display the same way in both: orbit gems, HUD, menu and aura, for the local player and for others.
4. Players in different realms never see or chat with each other.
5. Neither realm downloads the other's world art.
6. A realm can add a feature without editing the shared core.
7. The plaza keeps working exactly as it does now throughout the refactor.

## Non-goals

- Game portals inside the new realm, or games returning to it.
- New Relics, or a Relic that only exists in one realm.
- Two realms loaded in one page. `v2/core.ts` holds singletons with no way to unregister them.
- Mobile. The hub is desktop only.
- Server clustering. Nakama OSS doesn't cluster, so all realms share one server's capacity.

## Anti-goals

The work has failed, even if it technically runs, if:

- the plaza looks or behaves differently after the refactor, except for the new gate
- a realm feature can grant Relics, Tickets or Verse from a hub session
- the realms' movement slowly drifts apart because each has its own copy
- the game repos need an SDK re-sync for this

## Audit findings

### Client

`main.ts` (980 lines) and `scene.ts` (811 lines) are the tangle. Both mix generic engine work with plaza
content, and `main.ts` has no exports and runs through top-level await.

| Class | Files |
| --- | --- |
| Shared as is | `physics.ts`, `avatar.ts`, `overheads.ts`, `chat.ts`, `auth.ts`, `look.ts`, `games.ts`, `leaderboards.ts`, `net/protocol.ts`, `net/remoteWorld.ts`, `net/interp.ts`, `v2/core.ts`, `v2/pets.ts`, `v2/signs.ts`, `v2/arcade-picker.ts`, `m3/canvas.ts`, `m3/orbitGems.ts` |
| Shared after change | `main.ts`, `scene.ts`, `config.ts`, `layout.ts`, `travel.ts`, `collider.ts`, `remotes.ts`, `net/plaza.ts`, `net/bots.ts`, `menu.ts`, `login.ts`, `boot.ts`, `style.css`, `login.css`, `m3/types.ts`, `m3/livingPortals.ts`, `m3/barLeaderboard.ts`, `hub/index.html`, `vite.config.ts` |
| Plaza only | `plaza-collider.ts`, `blockouts.ts`, `v2/buildings.ts`, `v2/club-interior*.ts`, `v2/interior.ts`, `v2/arcade.ts`, `v2/arcade-layout.ts`, `v2/billboard.ts`, `v2/neon-sign.ts`, `v2/sprotel-npc.ts`, `v2/plaza.ts` (except `buildPortal`), `m3/hallOfChampions.ts`, `m3/stub.ts` |

The good news is that `createPlayerController(bvh)` already takes its collision mesh as an input, and physics
has no plaza data. The camera and input code is the part stuck in `main.ts`. `PLAZA_RADIUS` is unused: the real
boundary is the collision wall in `plaza-collider.ts`.

### Server

- `HubShards.place` already handles separate pools through `kind`, and passes `params` to `matchCreate`.
- These are written for the plaza only: `zoneOf`, `inBounds` (±140 m, two y bands), and the spawn in
  `hub_match.ts`, the `shard !== 1` never-close rule, and the `HUB_ROOM` chat pattern.
- Without a server change, two realms would place players in the same shards at the same coordinates.
- The step limit is 4.22 m per tick horizontally (about 42 m/s) and 3 m per tick vertically (`hub_match.ts:42-43`). Moves
  over it are dropped, up to 10 in a row, and then accepted as a snap. Sprint at 16 m/s is well inside it. A boost or launch
  pad above those limits, or a teleport within a zone, would look jerky to other players rather than being blocked.
- `matchJoinAttempt` doesn't check placement, so a token holding a match id can enter any shard. This doesn't
  affect the economy, but realm isolation is not a security boundary.
- Duplicate-session kicks are per match, so one account can be in both realms at once from two tabs.
- `hub.join` allows 6 calls a minute, and the client shows `rate_limited` as offline.

### Relics

- Storage and reads have no world in them: `game.relic_claim`, `profile.get`, and the roster field `r`. Reusing
  the `hub` match module gives a realm correct Relic data with no new server code.
- These parts carry over: orbit gems, HUD pips, menu tab, aura, remote gems.
- These are plaza set pieces: monument pedestal rings, Hall of Champions door, belt plinth. All of them sit behind
  the same `setRelics` in `scene.ts:656-677`, so it has to be split.
- Relic effects outside the games are limited to pet ownership and aura choice, and neither depends on a world.

Existing bugs found on the way:

| Bug | Where | Action |
| --- | --- | --- |
| Breakwater Coin never orbits anyone. It has no `RELIC_GEMS` entry, and gems are colored instances, so no new art is needed. | `m3/types.ts`, `orbitGems.ts:58` | Fix first |
| "Own all four Relics" tests six in its fallback path | `menu.ts:437` | Fix in the Relic phase |
| Stale "0 of 4 Relics" and "Relics 0/4" starting text | `menu.ts:167`, `hub/index.html:25` | Fix in the Relic phase |
| Pedestal ring colors differ from `SOCKETS` | `v2/plaza.ts:259` | Fix in the Relic phase |
| Relic ids are duplicated in about nine places | See the plan | Add a test that they match |
| `pet_four_lights_sproto` may only be granted by a one-time backfill. Unverified. | `pets.ts:37,376` | Check separately; out of scope here |

### Deploy, CI and assets

- The catch-all Caddy route would serve `/realm/<id>/` unchanged, but `no-cache` only matches `/hub/` and `.html`.
  A realm page would be cached for 5 minutes and could point at deleted chunks, so `deploy/Caddyfile:113` must change.
- `deploy-hub.sh:27` only checks for `hub/index.html`, so a missing realm page would still publish.
- There's no deploy workflow. Deploys are manual and only happen when the owner asks.
- JS budget: measured at 331,046 bytes gzip against an 800,000 limit that sums all entries. There's room.
- No check covers asset size, and nothing would notice one realm loading another's files.
- `public/world` is 55 MB in plain git. The pack is 99 MiB, and 50 MB more would take it to about 146 MiB.
- The repo has no asset tooling. Assets arrive as finished exports. `docs/higgsfield-workflow-guide.md` has no workflow
  for environments or building kits, and no step for LODs or compression.
- Existing budgets disagree: 100 vs 150 draw calls, and an "under 8 MB" first load vs 9.2–14 MB measured.
- `.glb` files are probably not cached by Cloudflare on the apex. That's unverified, and a second world doubles
  the exposure.

## Design

### Structure

```text
apps/hub/
  hub/index.html              plaza page, same URL as today
  realm/<id>/index.html       new realm page
  src/
    core/                     shared shell: input, camera, movement wiring, session, Relic HUD, net, chat
      movement.ts             the locked values
      realm.ts                the RealmDefinition contract
    realms/
      plaza/                  everything classed "plaza only" above
      <id>/                   the new realm
  public/world/
    v2/avatar, staffs, pets   shared, at today's paths
    basis, fonts              shared
    realms/<id>/              this realm's art
```

`travel.ts` stays where it is, because `server/test/dup/same-tab.ts` reads it by path. Plaza art stays in `world/v2`,
since moving 54 MB would add to git history for no gain.

### The realm contract

Each page imports its realm definition directly, so a realm's code and art never reach the other realm's page.

```ts
interface RealmDefinition {
  id: RealmId;
  /** Scene, lights, sky and bloom settings. */
  build(ctx: RealmContext): Promise<RealmContent>;
  /** Where to appear, given the URL hash. */
  spawn(hash: string): SpawnPoint;
}

interface RealmContent {
  collider: Collider;
  /** Lowest allowed camera height at this position. Replaces the plaza's y >= 0.45 and floorY rules. */
  cameraFloor(position: Vector3): number;
  /** Runs every frame. Realm-only features live here. */
  update(dt: number, state: FrameState): void;
  /** Plaza set pieces react here. Orbit gems, HUD and menu are handled by the core. */
  onRelicsChanged?(relics: readonly RelicId[]): void;
  /** Prompts such as "press E": gates, NPCs, cabinets. */
  interactions?: readonly Interaction[];
}
```

The builder can adjust these shapes during the refactor. The rule that matters is that plaza code moves behind
this contract with no plaza-only branch left in `core/`.

### Same rules, room to add

| Locked in `core/movement.ts` | Free per realm |
| --- | --- |
| Gravity, jump, terminal velocity | Scene, sky, fog, lights, bloom |
| Walk and sprint speed | Colliders and map size |
| Capsule and body scale | Spawn points |
| Camera arm, FOV, pitch limits, mouse and turn rates | NPCs, interiors, minigames, signs |
| Controls | UI theme and copy |

A realm can add a movement feature such as a jump pad or a boost. If it can exceed the normal step limit, the feature
must declare that in the server's realm table, so it can't be added by accident on the client alone. The first
realm doesn't need one.

### Server realm table

```ts
REALMS = {
  plaza: { kind: "hub", room: "hub", bounds, zones, spawn, alwaysOn: true },
  <id>:  { kind: "hub_<id>", room: "hub.<id>", bounds, zones, spawn, alwaysOn: false },
}
```

- `hub.join` takes an optional `realm` and rejects unknown values. No value means plaza, so cached clients, the
  load bots and the current tests keep working. An allow-list matters because `place()` has no shard ceiling, so a
  free-form value could create unlimited matches.
- Both realms use the existing `hub` match module, and `matchInit` reads the realm from `params`.
- The plaza's label stays exactly as it is, because a test pins it. Other realms get their own `kind`.
- `HUB_ROOM` also accepts `hub.<id>.<n>`. Plaza room names don't change, so chat history survives.
- Only plaza shard 1 is always on. A realm's shards open on demand and close when empty, including its shard 1.
- The `sessionStorage` key `hub:plaza:match` becomes per realm, and `connectPlaza` takes a realm.

### Crossing between worlds

- The plaza gets one gate into the realm, and the realm gets one gate back. Both navigate with a full page load.
- The plaza arrival uses a new hash, `#realm=<id>`, so players appear beside the gate rather than at the south spawn.
  `parseReturnGame` stays untouched, because the games and a test depend on it.
- Sign-in carries over. The login is in `localStorage` under `hub:account`, and guest state is in `sessionStorage`,
  which survives navigation in the same tab. Look and hidden Relics are also in `localStorage`.
- The departed player's slot stays for the 20 s grace period. That's the same as leaving for a game today.
- The equipped pet comes only from `?pet=` today, so it won't carry over until pet saving is wired up. That's the
  plaza's existing gap, not new work here.

### Relics in both worlds

1. Add the Coin to `RELIC_GEMS`, with a test that every `RELIC_IDS` entry has a gem and a `SOCKETS` entry.
2. Move gems and the Relic HUD into `core/`. Split `setRelics` so set pieces use `onRelicsChanged`.
3. Split `SOCKETS` into Relic identity (id, name, color), which is shared, and monument placement, which stays with the plaza.
4. Reword menu copy that mentions the monument.
5. Each realm chooses whether to have a set piece that reacts to Relics. The new realm doesn't need one to ship.

A realm feature may read Relics and react to them. It may never grant Relics, Tickets or Verse. If a realm ever needs
to award one, that goes through a game session and `event_rule` as a separate design.

Realm-only progress, if it's ever needed, goes in a server-written `world_progress/<realm>` storage object following
the `loadout/hub` pattern, and never reuses `game_id`.

### UI theme

There are four palettes today (`style.css:8-39`, `:805-820`, `:1825-1845` and `login.css:10-25`) and raster pixel art at
fixed URLs. Merge them into one token file with per-realm overrides. Art URLs become variables with the plaza's art as the
default. A realm that keeps the pixel frames can ship with colors only.

### Assets

Export contract, matching what the plaza already uses: `<name>.glb` plus `<name>-lod1.glb`, meshopt, KTX2 textures, one-shot
LOD upgrade by distance. Add a repo script for this, using `gltf-transform` as a new dev dependency, and a section in the
Higgsfield guide on environment kits with polygon targets.

A realm's first load must not exceed the plaza's measured 9.2 MB at default spawn, with at most 150 draw calls at a normal
player count. Those are this design's working numbers until the owner picks others. A new CI check fails on a per-realm
size budget, or if a realm's source references another realm's folder.

### Deployment

These change production, so they ship only when the owner asks:

- Add `/realm/` pages to the `no-cache` rule, and a bare-path redirect, in `deploy/Caddyfile`.
- Make `deploy-hub.sh` check for each realm page.
- Update `deploy/README.md`.
- Consider a Cloudflare cache rule for `.glb` on the apex.

The gate into the realm stays behind a build flag until the owner decides to launch, so the plaza can ship all the
earlier phases safely.

## Testing

- **Plaza stays the same:** a written walkthrough plus before and after screenshots from fixed positions, with draw calls and
  asset counts compared, on every refactor PR.
- **Movement:** a test pins every locked value, and a test runs the capsule against the live plaza collider. Today
  `scripts/sim-capsule.ts` only tests the legacy `buildCollider`.
- **Isolation:** two clients in different realms can't see each other, and can't share chat.
- **Relics:** an account with all six shows all six gems in both realms, to itself and to others.
- **Server:** keep `hub.join` with no realm working. Update `hub_match.test.ts` and `chat.test.ts`. `test:dup` runs in CI.
- **Capacity:** run `scripts/load/plaza-bots.ts` with players split across realms before launch.

## Left to the builder

File names inside `core/`, exact interface shapes, the plaza gate's location, how the flag is implemented, and the order of
small refactor PRs inside a phase.

## Open for the owner

The foundation doesn't depend on these, but the art and launch phases do. The first three were raised by the independent
review of this design.

1. The theme, the name and what players do there. A place to walk around and chat is mostly client work and art.
   Minigames, boards or saved progress add server work.
2. Whether games can be launched from the new realm and return to the main hub, or are only reachable from the main hub.
   This design assumes the second.
3. Where the environment art comes from, who approves it, and the credit and total-size limits. If agents generate it, the
   plan needs a test run first, because nobody has shown the Higgsfield workflow can produce a walkable world within budget.
4. Whether to run the launch capacity test on a staging server, and how many players must fit.
5. Whether the working size and draw-call budgets are acceptable.
6. Whether to allow one account in both realms from two tabs. This design allows it for now.
