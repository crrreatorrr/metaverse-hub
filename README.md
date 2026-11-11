# Metaverse Hub

A Ready Player One style plaza that links eight web games: five through portal rings (HPOS10I, NOBU, The People's Bitcoin, Sproto Duel, Sproto Shooter) and three through the arcade cabinet in the Bar (Sproto Arcade, Sproto Fighter, Sproto Coop Battle). The plaza is multiplayer: up to 100 players per world (shard), with more worlds opening on demand, live chat, and public NOBU time-trial boards in the Bar. The same Nakama server hosts the games' online pieces (Sproto Fighter and Sproto Duel 1v1, People's Bitcoin's 100-player worlds, Sproto Coop Battle's banked six-seat matches, Sproto Shooter's run verifier); see [docs/realtime.md](docs/realtime.md). [docs/CONTRACTS.md](docs/CONTRACTS.md) indexes the cross-repo contracts (C1–C14), what an SDK or simulation change forces in each game repo, the migration id ranges, and names that are easy to mix up.

The product shape comes from the design doc. Technical ids (games, relics, boards, ticket fragment, SDK methods) follow the architecture.

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
| Sproto Arcade (Bar arcade cabinet) | `sproto-arcade` | `sproto-arcade` | [crrreatorrr/Sproto-Arcade](https://github.com/crrreatorrr/Sproto-Arcade) |
| Sproto Shooter (The Range) | `sproto-shooter` | `sproto-shooter` | [crrreatorrr/sproto-shooter](https://github.com/crrreatorrr/sproto-shooter) |
| Sproto Coop Battle (Bar arcade cabinet) | `sproto-coop-battle` | `sproto-coop-battle` | [crrreatorrr/Sproto-Coop-Battle.](https://github.com/crrreatorrr/Sproto-Coop-Battle.) (the repo name ends in a dot; the id does not) |

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

The camera is **third person**: a spring arm follows behind the avatar and smoothly turns toward each new travel direction. Holding a direction keeps a straight course as the camera catches up. Click the view to capture the mouse. WASD or the arrow keys move the character relative to the view when you choose a direction, the mouse looks, Shift runs, Space jumps, E uses what is in front of you (the arcade cabinet, Sprotel), Enter opens chat and Esc opens the menu. Without a mouse, Z / C look left / right and R / F lower and raise the camera. Mouse and stick look right when pushed right, and vertical camera control is inverted. Manual look takes priority, with automatic follow resuming after a short pause while moving. Stopping keeps the avatar facing its last travel direction. Desktop only.

**Controllers** work everywhere in the hub, including the login gate, the menu and the arcade picker: left stick moves and right stick turns the camera by default, with inverted vertical camera control; Menu → Items → Controller swaps the sticks. A uses a nearby prompt or jumps, B (held) runs, X also uses the prompt, Menu opens the menu, View opens chat. Every game follows the same convention (A confirms, B goes back, Menu pauses, buttons held while a page loads are ignored until released), so a player can walk from the plaza into any game and back on the pad alone. See [docs/controllers.md](docs/controllers.md).

Walk into a portal ring. The hub plays a short wipe and navigates to that game's URL with a one-time ticket in the fragment:

```
/play/sproto/#t=<ticket>
```

Sproto Duel's in-repo page is a mock arena: defeat Tinubu, then return. It stands in until a real Sproto Duel build is fetched. Portal pages are resolved in `apps/hub/src/games.ts`.

Coming back from a game, open the hub with the game id in the hash. The avatar stands in front of that portal, facing it:

```
http://127.0.0.1:5173/hub/#from=sproto
```

`#from=` accepts `hpos10i`, `nobu`, `peoples-bitcoin`, `sproto`, `sproto-shooter`, `sproto-fighter`, `sproto-arcade`, or `sproto-coop-battle`. `#from=sproto-fighter`, `#from=sproto-arcade` and `#from=sproto-coop-battle` load the Bar and put the avatar at the arcade cabinet.

**The Bar cabinet** holds three games. Press **E** at it to pick **Sproto Arcade** (story mode, `/play/sproto-arcade/`), **Sproto Fighter** or **Sproto Coop Battle** with 1–3 or the arrows and Enter; Esc steps away. Each choice mints its own portal ticket. Sproto Arcade is a static classic-script game. Its `Web build` workflow uploads a trimmed `web-build` artifact (`tools/build-web.mjs`, about 140 MB of the repo's 200 MB, most of it scrolling level scenery). `npm run fetch:sproto-arcade` installs it at `/play/sproto-arcade/` for dev, or symlink a Sproto-Arcade checkout there, or set `VITE_GAME_URL_SPROTO_ARCADE`. Production serves it at `play.<domain>/sproto-arcade/` (`deploy-game.sh sproto-arcade <dist>`). Its build takes the client server key from the `NAKAMA_SERVER_KEY` secret in the Sproto-Arcade repo.

**Sproto Fighter** has no ring. Walk into the Bar, stand at the arcade cabinet on the back wall and press **E**. The hub mints the same portal ticket as a ring and opens `/play/sproto-fighter/#t=<ticket>`. The **Tidebreaker Belt** stands on a plinth beside the cabinet and lights up once you own it. It also has the fifth socket on the monument and orbits your avatar like the other Relics, but it does not count toward the Hall of Champions or the Four Lights Sproto pet, which still need the original four. Like every Relic it unlocks one item in each other game: Fighter's Might (Sproto Duel staff: 2× bolt damage, 1.85× slower firing, fist bolt), Champion's Crown (NOBU head: triple jump, 1.4× bite radius), Champion Sproto (People's Bitcoin summon that throws rocks), and the Tidebreaker skin (HPOS10I: 3 spin-dash charge per press instead of 2).

## Scripts

```bash
npm run fetch:games # real game web builds into apps/hub/public/play/<slug>/ (or fetch:<slug>)
npm run dev         # plaza and the Sproto mock, proxied to Nakama
npm run typecheck
npm run lint
npm test            # hub-sdk (incl. realtime client + mock), capsule collider, hub net layer, Nakama module unit tests
npm run test:dup    # relic duplication tests against docker compose Nakama
npm run test:rt     # realtime (plaza, chat, matchmaker scope, NOBU boards) against docker compose Nakama
npm run vendor:sdk -- <game-repo>   # build and vendor @metaverse/hub-sdk into a game repo
npm run build       # sdk, Nakama module, plaza, then a check that the bundle has no debug globals (needs VITE_NAKAMA_SERVER_KEY)
npm run pack:sdk    # tarball a game repo can npm install
npm run preview     # serves the production build
```

CI (`.github/workflows/ci.yml`) runs lint, typecheck, test, and build, then the duplication and realtime tests against Nakama and Postgres.

`npm run build` inlines `VITE_NAKAMA_SERVER_KEY` into the plaza and stops with an error when it is empty or unset, because an empty key makes every login fail. For a release build, set it to `NAKAMA_SERVER_KEY` from `deploy/.env`, either in the shell or in `apps/hub/.env.production` (gitignored; the shell value wins). CI builds with a placeholder value that no server accepts. `npm run build -w @metaverse/hub -- --mode development` builds a local bundle with the dev key instead.

## Multiplayer

- **Plaza:** after sign-in the hub calls `hub.join`, which places the player on the least-full open world (soft cap 90 of 100; a new world opens when all are full). Positions travel at 10 Hz as compact deltas, filtered by zone (plaza vs Bar). The 6 nearest players within 30 m get full animated avatars, name tags and orbit gems; everyone else is one instanced impostor draw. A dropped socket reconnects and rejoins the same slot within 20 s. The status line shows `World N · n/100`. A portal trip returns you to the same world.
- **Chat:** Enter opens the box. Lines go through the world's channel (`hub.<world>`), so everyone in that world sees them, with 30 lines of history on join. The server normalises text (1–120 characters), checks colour/effect prefixes, masks profanity, rejects slurs, rate-limits (burst 5, then 1 per 1.5 s; guests 1 per 3 s) and refuses repeats within 30 s. `/ignore name` and `/unignore name` hide a player in this browser; `/report name` files a report for moderators (`game.chat_report`). Mutes are rows in `game.chat_mute`.
- **Sims (Menu → Sims, key 5):** characters only you can see. Pick a character (the avatar roster), a dialogue (one of the eight personas from People's Bitcoin's awakening bots, or Quiet) and a name, then **Add sim**, or **Add the whole cast**. Up to 24, kept in this browser. They walk the open plaza, talk in your chat log (`Name (sim): …`) and in cyan bubbles, and over about 10 minutes go from repeating their loop to waking up and gathering in a ring; **Story speed** runs it up to 20× faster and **Restart story** starts it over. They join the RemoteWorld beside real players (slots from 10000, user ids `sim:<id>`) but never reach the server or the chat channel, and the `n/100` count leaves them out. Lines and scenes are in `apps/hub/src/sims/script.json`, a copy of People's Bitcoin `src/data/awakening.json`; re-copy it when that file changes.
- **Dev profiling:** `http://127.0.0.1:5173/hub/?bots=100` fills the plaza with 100 client-side fake players (dev builds only); the dev overlay shows draws, fps and near+far remote counts.

## What you see

A round neon plaza, about 60 m across, built from GLB models (with LODs, under `apps/hub/public/world/`) plus primitives and emissive materials.

- **The Four Lights** at the center: eight relic sockets (HPOS10I Core, Genesis Block Shard, Cone's Tip, Tinubu's Crown, Tidebreaker Belt, Breakwater Coin, Marina Anchor, Dragon Scale) and a sealed Hall of Champions portal that opens with the first four. The Marina Anchor (Sproto Coop Battle, clear stage 1) and the Dragon Scale (Sproto Shooter, clear wave 1 of Wave Mode) socket, orbit and give an aura like the others, but they do not count toward the Four Lights and unlock nothing in other games yet. Nothing lights up until a relic exists. Owned Relics orbit your avatar as gems; each one has an **Orbit on/off** switch in the Relics menu (saved per browser).
- **Five gates** on the ring. Four stand in front of their buildings: Green Hill Zone (HPOS10I), the Kennel (NOBU), the White House (People's Bitcoin), and the Castle (Sproto Duel). The fifth, The Range (Sproto Shooter), is the gate in front of the Bar.
- **A Bar** northeast of the monument, with a walk-in interior. Its arcade cabinet (press E) opens Sproto Arcade, Sproto Fighter or Sproto Coop Battle; the Tidebreaker Belt plinth stands beside it. The scoreboard screen on the inside wall cycles the public boards: HPOS10I act time, NOBU time trials (one page per level, `m:ss.cc`), People's Bitcoin XP, Sproto Duel wins, and lifetime Verse per game and in total.
- Collision is a kinematic capsule on a `three-mesh-bvh` mesh: the pedestal, portal pillars, bollards, and the outer parapet.

`npm run dev` shows a small draw-call and fps counter. That overlay and `window.__hub` exist only in dev. Production builds constant-fold them out; `npm run build` fails if `__hub`, `__nobu`, or `__duel` remain in the bundle. The scene stays under the 100 draw-call budget by merging static meshes and skipping shadow maps. Postprocessing is a half-resolution selective bloom plus tone mapping (`apps/hub/src/core/engine.ts`). The download is the Three.js bundle plus the GLB models and textures under `apps/hub/public/world/`; signs and boards are painted on canvases at startup.

## hub-sdk

`@metaverse/hub-sdk` is the surface the games call. Outside a redeemed ticket every method no-ops, so a game still runs on its own. Install and the Three.js wiring are in [packages/hub-sdk/README.md](packages/hub-sdk/README.md).

```ts
redeemTicket({ game })                // reads #t=, strips it, custom-auth session + refresh token
init(gameId)                          // same exchange when a ticket is still in the hash; otherwise the saved session
reportEvent(eventId, data, key)       // ready, or the four relic triggers
earnTickets(amount, reason, key)
exchange(tickets, key)                // 10 Tickets = 1 Verse, 50 Verse per game per day
submitScore(boardId, value, meta?)    // the server decides; returns { accepted, posted?, value?, order?, reason? }
getLeaderboard?(boardId, { variant }) // leaderboard.top
exit(reason?)                         // goes to /hub/#from=<game>
realtimeFromSdk(sdk)                  // realtime client on the game session (matches, matchmaker, chat), null standalone
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
| `arcade.boss_defeated` with boss `bront` (god mode counts) | `breakwater_coin` |
| `coop.stage_clear` with stage `1` (Sproto Coop Battle, god mode counts) | `marina_anchor` |
| `shooter.wave_clear` with wave `1` (Sproto Shooter Wave Mode, god mode counts) | `dragon_scale` |

The Marina Anchor and the Dragon Scale pay no Tickets, unlock no items in other games and do not count toward the Four Lights. The banked online Coop match also grants the Marina Anchor on the server to each human account at a stage-1 clear (migration `0045_coop_shooter_relics`). `coop.boss_clear` and `shooter.boss_clear` are server-only names; a client gets `server_reason`.

The same events also grant cosmetic pets once per player through `game.item_rule` (migration `0030_m6_item_grants`): HPOS10I act 2 of `z1_retro_rush_hills` and `z2_wizard_academy`, NOBU bosses `bird` and `cat`, Sproto boss `obama`, and People's Bitcoin quests `quest_moonward` and `quest_hatchery`. Every successful `session.event` response has `granted_items` (a list, `[]` when none). See [docs/m6-server-prep.md](docs/m6-server-prep.md).

Same idempotency key and same body returns the stored response. A reused key with a different body throws. Boards: HPOS10I and Sproto boards need a ranked session (`reason: 'unranked'` otherwise); NOBU time trials (`nobu_trial_time`, `meta.level` 1–3, integer ms) count from any session; `sproto_wins` is written by the server only. A score with `meta.godMode: true` posts nothing. The SDK is at 0.6.4; see its README for the realtime API and the mock server for game tests.

`installHubSdk()` sets `window.hubSdk` for HPOS10I's JavaScriptBridge. The plaza does not install it.

## Server

See [server/README.md](server/README.md). `docker compose up` in `server/` builds the TypeScript runtime into Nakama.

Tinubu's Crown is granted once when the mock arena reports the boss, including a god-mode win. The hub reads that from Nakama and lights the socket. A win also pays 20 Tickets. The arena's exchange turns them into Verse at 10 to 1, capped at 50 Verse from that game per day. The hub HUD shows the Verse balance. The Bar, northeast of the monument, has the scoreboard: one tab per game plus Total, ranked by lifetime Verse earned. Sample rows fill a tab until someone has earned Verse there. The other three Relics are defined and granted by their events, but nothing in the plaza reaches those bosses yet.
