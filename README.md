# Metaverse Hub

A Ready Player One style plaza that links five web games: four through portal rings, and Sproto Fighter through the arcade cabinet in the Bar. Milestone **M1** connects the plaza to Nakama: guest device accounts, portal tickets, and the first earn-once Relic.

The product shape comes from the design doc. Technical ids (games, relics, boards, ticket fragment, SDK methods) follow the architecture. Where this milestone is smaller than the architecture's M0, that is intentional: there is no live guest session yet.

## Layout

```
apps/hub/            Three.js + TypeScript + Vite plaza at /hub/, mock Sproto Duel at /play/sproto/
packages/hub-sdk/    Client the games import. Real Nakama path, plus the in-memory mock the unit tests use.
server/              Nakama + Postgres + Caddy. TypeScript runtime for tickets and Relics.
```

The games live in their own repos. Game ids are used in code and in `#from=`; slugs are the page paths (`/play/<slug>/` in dev, `https://play.<domain>/<slug>/` in production, see `apps/hub/src/games.ts`):

| Portal | Id | Slug | Repo |
| --- | --- | --- | --- |
| HPOS10I | `hpos10i` | `hpos10i` | [crrreatorrr/HPOS10I](https://github.com/crrreatorrr/HPOS10I) |
| NOBU: Saviour Dog | `nobu` | `nobu` | [crrreatorrr/nobu](https://github.com/crrreatorrr/nobu) |
| The People's Bitcoin (18+) | `peoples-bitcoin` | `peoples-bitcoin` | [crrreatorrr/peoples-bitcoin](https://github.com/crrreatorrr/peoples-bitcoin) |
| Sproto Duel | `sproto` | `sproto-duel` | [crrreatorrr/sproto-duel](https://github.com/crrreatorrr/sproto-duel) |
| Sproto Fighter (Bar arcade cabinet) | `sproto-fighter` | `sproto-fighter` | [crrreatorrr/Sproto-Fighter](https://github.com/crrreatorrr/Sproto-Fighter) |

## Run the plaza

Requires Node 22+.

```bash
docker compose -f server/docker-compose.yml up --build
npm ci
npm run fetch:games   # optional: real game builds, see below
npm run dev
```

`npm run fetch:games` pulls each game's latest web build into `apps/hub/public/play/<slug>/` (gitignored) with `gh`, so the dev plaza opens the real game same-origin and its `#t=` ticket and `/v2` calls reach the local Nakama. A fetched build takes over that portal in dev, including HPOS10I, which otherwise opens its GitHub Pages copy. `VITE_GAME_URL_*` still wins when set. Without a fetched Sproto Duel build, its portal opens the in-repo mock. `npm run build` leaves fetched builds out of `dist`; production serves games from `play.<domain>`.

The game repos are private. If `gh` cannot read them (an agent token scoped to this repo only, for example), set `GAME_REPOS_GITHUB_TOKEN` to a fine-grained token with Contents: Read on those repos.

Open http://127.0.0.1:5173/hub/

The hub opens on a sign-up / log-in page: username, password, and a backup email (not verified yet). The plaza downloads and builds behind it. If you finish before the plaza is ready, a spinning V token and a block progress bar hold until it is. **Continue as guest** keeps the old device-only guest for that tab. A signed-in account is remembered on this browser; **Account → Sign out** returns to the page. Details are in [server/README.md](server/README.md#accounts).

The camera is **third person**: a spring arm behind the wizard, because the design asks for that view and it keeps the character on screen. Click the view to capture the mouse. Arrow keys move the character (camera-relative), WASD orbits the camera, the mouse looks, Shift runs, Space jumps. Desktop only.

Walk into a portal ring. The hub plays a short wipe and navigates to that game's URL with a one-time ticket in the fragment:

```
/play/sproto/#t=<ticket>
```

Sproto Duel's in-repo page is a mock arena: defeat Tinubu, then return. It stands in until a real Sproto Duel build is fetched. Portal pages are resolved in `apps/hub/src/games.ts`.

Coming back from a game, open the hub with the game id in the hash. The avatar stands in front of that portal, facing it:

```
http://127.0.0.1:5173/hub/#from=sproto
```

`#from=` accepts `hpos10i`, `nobu`, `peoples-bitcoin`, `sproto`, or `sproto-fighter`. `#from=sproto-fighter` loads the Bar and puts the avatar at the arcade cabinet.

**Sproto Fighter** has no ring. Walk into the Bar, stand at the arcade cabinet by the EXIT door and press **E**. The hub mints the same portal ticket as a ring and opens `/play/sproto-fighter/#t=<ticket>`. The **Tidebreaker Belt** stands on a plinth beside the cabinet and lights up once you own it. It also has the fifth socket on the monument and orbits your avatar like the other Relics, but it does not count toward the Hall of Champions or the Four Lights Sproto pet, which still need the original four. Like every Relic it unlocks one item in each other game: Fighter's Might (Sproto Duel staff: 2× bolt damage, 1.85× slower firing, fist bolt), Champion's Crown (NOBU head: triple jump, 1.4× bite radius), Champion Sproto (People's Bitcoin summon that throws rocks), and the Tidebreaker skin (HPOS10I: 3 spin-dash charge per press instead of 2).

## Scripts

```bash
npm run fetch:games # real game web builds into apps/hub/public/play/<slug>/ (or fetch:<slug>)
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

- **The Four Lights** at the center: five relic sockets (HPOS10I Core, Genesis Block Shard, Cone's Tip, Tinubu's Crown, Tidebreaker Belt) and a sealed Hall of Champions portal that opens with the first four. Nothing lights up until a relic exists. Owned Relics orbit your avatar as gems; each one has an **Orbit on/off** switch in the Relics menu (saved per browser).
- **Four gates** on the ring, each in a labelled placeholder building: Green Hill Zone (HPOS10I), the Kennel (NOBU), the White House (People's Bitcoin), and the Castle (Sproto Duel). Blockouts only; the portal ring and the return spawn are unchanged.
- **A Bar** northeast of the monument, with a walk-in interior. Its arcade cabinet (press E) opens Sproto Fighter; the Tidebreaker Belt plinth stands beside it. The scoreboard is a screen on the inside wall: HPOS10I, NOBU, People's Bitcoin, Sproto Duel, and Total. Each tab ranks lifetime Verse earned. Sample rows stand in until someone has earned Verse in that game.
- Collision is a kinematic capsule on a `three-mesh-bvh` mesh: the pedestal, portal pillars, bollards, and the outer parapet.

`npm run dev` shows a small draw-call and fps counter. That overlay and `window.__hub` exist only in dev. Production builds constant-fold them out; `npm run build` fails if `__hub`, `__nobu`, or `__duel` remain in the bundle. The scene stays under the 100 draw-call budget by merging static meshes and skipping shadow maps and postprocessing. The download is the Three.js bundle plus this scene; textures are painted on canvases at startup.

## hub-sdk

`@metaverse/hub-sdk` is the surface the games call. Outside a redeemed ticket every method no-ops, so a game still runs on its own. Install and the Three.js wiring are in [packages/hub-sdk/README.md](packages/hub-sdk/README.md).

```ts
redeemTicket({ game })                // reads #t=, strips it, custom-auth session + refresh token
init(gameId)                          // same exchange when a ticket is still in the hash; otherwise the saved session
reportEvent(eventId, data, key)       // ready, or the four relic triggers
earnTickets(amount, reason, key)
exchange(tickets, key)                // 10 Tickets = 1 Verse, 50 Verse per game per day
submitScore(boardId, value, meta?)    // ignored unless the ticket was ranked
exit(reason?)                         // goes to /hub/#from=<game>
```

`reportEvent` understands:

| Event | Grants |
| --- | --- |
| `ready` | nothing |
| `game_beaten` | nothing. A client cannot claim a Relic by saying it won |
| `hpos10i.level_complete` with zone `z1_retro_rush_hills` and act `1` | `hpos10i_core` |
| `pb.quest_complete` with quest `quest_tutorial` | `genesis_shard` |
| `nobu.boss_defeated` with boss `cone` | `cones_tip` |
| `sproto.boss_defeated` with boss `tinubu` | `tinubu_crown` |
| `fighter.story_level_complete` with world `1` | `tidebreaker_belt` |

Same idempotency key and same body returns the stored response. A reused key with a different body throws. Unranked sessions drop scores. God mode is the game's job: it still reports the relic and simply does not call `submitScore`.

`installHubSdk()` sets `window.hubSdk` for HPOS10I's JavaScriptBridge. The plaza does not install it.

## Server

See [server/README.md](server/README.md). `docker compose up` in `server/` builds the TypeScript runtime into Nakama.

Tinubu's Crown is granted once when the mock arena reports the boss, including a god-mode win. The hub reads that from Nakama and lights the socket. A win also pays 20 Tickets. The arena's exchange turns them into Verse at 10 to 1, capped at 50 Verse from that game per day. The hub HUD shows the Verse balance. The Bar, northeast of the monument, has the scoreboard: one tab per game plus Total, ranked by lifetime Verse earned. Sample rows fill a tab until someone has earned Verse there. The other three Relics are defined and granted by their events, but nothing in the plaza reaches those bosses yet.
