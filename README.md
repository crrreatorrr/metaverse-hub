# Metaverse Hub

A Ready Player One style plaza that links four web games. Milestone **M1** connects the plaza to Nakama: guest device accounts, portal tickets, and the first earn-once Relic.

The product shape comes from the design doc. Technical ids (games, relics, boards, ticket fragment, SDK methods) follow the architecture. Where this milestone is smaller than the architecture's M0, that is intentional: there is no live guest session yet.

## Layout

```
apps/hub/            Three.js + TypeScript + Vite plaza at /hub/, mock Sproto Duel at /play/sproto/
packages/hub-sdk/    Client the games import. Real Nakama path, plus the in-memory mock the unit tests use.
server/              Nakama + Postgres + Caddy. TypeScript runtime for tickets and Relics.
```

Game ids used in code, in `#from=`, and in the default portal paths:

| Portal | Id | Default page |
| --- | --- | --- |
| HPOS10I | `hpos10i` | `/play/hpos10i/` |
| NOBU: Saviour Dog | `nobu` | `/play/nobu/` |
| The People's Bitcoin (18+) | `pb` (`peoples-bitcoin` is accepted and stored as `pb`) | `/play/peoples-bitcoin/` |
| Sproto Duel | `sproto` | `/play/sproto/` |

## Run the plaza

Requires Node 22+.

```bash
docker compose -f server/docker-compose.yml up --build
npm ci
npm run dev
```

Open http://127.0.0.1:5173/hub/

The camera is **third person**: a spring arm behind a low-poly avatar, because the design asks for that view and it keeps the character on screen. Click the view to capture the mouse. WASD moves (arrows work too), the mouse looks, Shift sprints, Space jumps. Desktop only.

Walk into a portal ring. The hub plays a short wipe and navigates to that game's URL with a signed ticket in the fragment:

```
/play/sproto/#t=<payload>.<hmac>
```

Sproto Duel's page in this repo is a mock arena: defeat Tinubu, then return. The other three URLs are still placeholders for the real games. Change them in `apps/hub/src/config.ts`.

Coming back from a game, open the hub with the game id in the hash. The avatar stands in front of that portal, facing it:

```
http://127.0.0.1:5173/hub/#from=sproto
```

`#from=` accepts `hpos10i`, `nobu`, `pb`, or `sproto`.

## Scripts

```bash
npm run dev         # plaza and the Sproto mock, proxied to Nakama
npm run typecheck
npm run lint
npm test            # hub-sdk behavior and the capsule collider
npm run test:dup    # relic duplication tests against docker compose Nakama
npm run build       # sdk, Nakama module, plaza, then a check that the bundle has no debug globals
npm run pack:sdk    # tarball a game repo can npm install
npm run preview     # serves the production build
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and build, then the duplication tests against Nakama and Postgres.

## What you see

A round neon plaza, about 60 m across, built from primitives and emissive materials. No downloaded art.

- **The Four Lights** at the center: four empty relic sockets (HPOS10I Core, Genesis Block Shard, Cone's Tip, Tinubu's Crown) and a sealed Hall of Champions portal. Nothing lights up until a relic exists.
- **Four gates** on the ring, each in a labelled placeholder building: Green Hill Zone (HPOS10I), the Kennel (NOBU), the White House (People's Bitcoin), and the Castle (Sproto Duel). Blockouts only; the portal ring and the return spawn are unchanged.
- **A Bar** northeast of the monument, with a walk-in interior and no portal. The scoreboard is a screen on the inside wall: HPOS10I, NOBU, People's Bitcoin, Sproto Duel, and Total. Each tab ranks lifetime Verse earned. Sample rows stand in until someone has earned Verse in that game.
- Collision is a kinematic capsule on a `three-mesh-bvh` mesh: the pedestal, portal pillars, bollards, and the outer parapet.

`npm run dev` shows a small draw-call and fps counter. That overlay and `window.__hub` exist only in dev. Production builds constant-fold them out; `npm run build` fails if `__hub`, `__nobu`, or `__duel` remain in the bundle. The scene stays under the 100 draw-call budget by merging static meshes and skipping shadow maps and postprocessing. The download is the Three.js bundle plus this scene; textures are painted on canvases at startup.

## hub-sdk

`@metaverse/hub-sdk` is the surface the games call. Outside a redeemed ticket every method no-ops, so a game still runs on its own. Install and the Three.js wiring are in [packages/hub-sdk/README.md](packages/hub-sdk/README.md).

```ts
init(gameId)                          // reads #t=, strips it, returns the mock profile
reportEvent(eventId, data, key)       // ready, game_beaten, or the four relic triggers
earnTickets(amount, reason, key)
exchange(tickets, key)                // 10 Tickets = 1 Verse, 50 Verse per game per day
submitScore(boardId, value, meta?)    // ignored unless the ticket was ranked
exit(reason?)                         // goes to /hub/#from=<game>
```

`reportEvent` understands:

| Event | Grants |
| --- | --- |
| `ready` | nothing |
| `game_beaten` | that game's relic, once |
| `hpos10i.level_complete` with zone `z1_retro_rush_hills` and act `1` | `hpos10i_core` |
| `pb.quest_complete` with quest `quest_tutorial` | `genesis_shard` |
| `nobu.boss_defeated` with boss `cone` | `cones_tip` |
| `sproto.boss_defeated` with boss `tinubu` | `tinubu_crown` |

Same idempotency key and same body returns the stored response. A reused key with a different body throws. Unranked sessions drop scores. God mode is the game's job: it still reports the relic and simply does not call `submitScore`.

`installHubSdk()` sets `window.hubSdk` for HPOS10I's JavaScriptBridge. The plaza does not install it.

## Server

See [server/README.md](server/README.md). `docker compose up` in `server/` builds the TypeScript runtime into Nakama.

Tinubu's Crown is granted once when the mock arena reports the boss, including a god-mode win. The hub reads that from Nakama and lights the socket. A win also pays 20 Tickets. The arena's exchange turns them into Verse at 10 to 1, capped at 50 Verse from that game per day. The hub HUD shows the Verse balance. The Bar, northeast of the monument, has the scoreboard: one tab per game plus Total, ranked by lifetime Verse earned. Sample rows fill a tab until someone has earned Verse there. The other three Relics are defined and granted by their events, but nothing in the plaza reaches those bosses yet.
