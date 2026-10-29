# Metaverse Hub

A Ready Player One style plaza that links four web games. This repo is milestone **M0**: a walkable hub, a typed `hub-sdk` the games will call later, and a Nakama + Postgres compose file that is not connected yet.

The product shape comes from the design doc. Technical ids (games, relics, boards, ticket fragment, SDK methods) follow the architecture. Where this milestone is smaller than the architecture's M0, that is intentional: there is no live guest session yet.

## Layout

```
apps/hub/            Three.js + TypeScript + Vite plaza, served at /hub/
packages/hub-sdk/    Typed client the games will import. Mock implementations.
server/              Docker Compose for Nakama, Postgres, and Caddy. Not wired.
```

Game ids used in code, in `#from=`, and in the default portal paths:

| Portal | Id | Default page |
| --- | --- | --- |
| HPOS10I | `hpos10i` | `/play/hpos10i/` |
| NOBU: Saviour Dog | `nobu` | `/play/nobu/` |
| The People's Bitcoin (18+) | `pb` | `/play/pb/` |
| Sproto Duel | `sproto` | `/play/sproto/` |

## Run the plaza

Requires Node 22+.

```bash
npm ci
npm run dev
```

Open http://127.0.0.1:5173/hub/

The camera is **third person**: a spring arm behind a low-poly avatar, because the design asks for that view and it keeps the character on screen. Click the view to capture the mouse. WASD moves (arrows work too), the mouse looks, Shift sprints, Space jumps. Desktop only.

Walk into a portal ring. The hub plays a short wipe and navigates to that game's URL with a mock signed ticket in the fragment:

```
/play/hpos10i/#t=<payload>.<hmac>
```

Change the pages in `apps/hub/src/config.ts`. The defaults are placeholders; the games are not in this repo, so the browser will not find them yet. The ticket is a local HMAC, not a credential. M1 replaces it with Nakama's `portal.enter`.

Coming back from a game, open the hub with the game id in the hash. The avatar stands in front of that portal, facing it:

```
http://127.0.0.1:5173/hub/#from=sproto
```

`#from=` accepts `hpos10i`, `nobu`, `pb`, or `sproto`.

## Scripts

```bash
npm run dev         # plaza
npm run typecheck
npm run lint
npm test            # hub-sdk mock behavior and the capsule collider
npm run build       # sdk, plaza, then a check that the bundle has no debug globals
npm run preview     # serves the production build at /hub/
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and build.

## What you see

A round neon plaza, about 60 m across, built from primitives and emissive materials. No downloaded art.

- **The Four Lights** at the center: four empty relic sockets (HPOS10I Core, Genesis Block Shard, Cone's Tip, Tinubu's Crown) and a sealed Hall of Champions portal. Nothing lights up until a relic exists.
- **Four gates** on the ring, with holo labels.
- **A leaderboard** above the monument. One `CanvasTexture`, mock rows for the four games plus the meta score. It is not live.
- Collision is a kinematic capsule on a `three-mesh-bvh` mesh: the pedestal, portal pillars, bollards, and the outer parapet.

`npm run dev` shows a small draw-call and fps counter. That overlay and `window.__hub` exist only in dev. Production builds constant-fold them out; `npm run build` fails if `__hub`, `__nobu`, or `__duel` remain in the bundle. The scene stays under the 100 draw-call budget by merging static meshes and skipping shadow maps and postprocessing. The download is the Three.js bundle plus this scene; textures are painted on canvases at startup.

## hub-sdk

`@metaverse/hub-sdk` is the surface the games will call. Outside a redeemed ticket every method no-ops, so a game still runs on its own.

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

See [server/README.md](server/README.md). Compose file only.

## M1

M1 is the first real round trip. It adds:

- Nakama guest device auth, using the device id this client already stores, plus an optional recovery code
- A real portal ticket and `hub-sdk` redeem, in place of the mock HMAC
- Sproto Duel: enter from the plaza, play, return to `/hub/#from=sproto` (that spawn already works)
- The first earn-once relic grant, Tinubu's Crown, with the duplication tests from the architecture

The other three games, live leaderboards, multiplayer, and lighting the Four Lights come after that.
