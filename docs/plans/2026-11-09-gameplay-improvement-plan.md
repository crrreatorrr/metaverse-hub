# Metaverse Hub: gameplay improvement plan

## 1. Status

**Plan only. No code has changed and nothing was deployed.**

**Update 2026-11-11: implemented on branch `claude/trusting-ramanujan-63h582`, not deployed.** Done in code: A1 to A4, B1 (migration `0060_hub_exchange`), B2 (tests), B3 (migration `0061_relic_unhold`), B4, D1 to D5, D7, E1 (overhead lines, no clips), E3, E4, and the E5 parts that are not Shooter (Coop variant read, Coop and Hub ranking Bar pages). Not done: C1 and C2 (no store item has art yet), D6 and every Shooter item (out of scope for now), E2 (sound cannot be judged without hearing it), E6 (a new Verse mint whose amounts are an open owner decision), E7, the Fighter and Shooter wins boards, and the re-vendor queue in §8. `npm run test:dup` was not run (no Nakama on the build machine); the economy rules were run against a real Postgres with `npm run test:pg` (`server/test/pg/`). The server must be deployed before the hub client for B1, B3, E3 and E4 to show.

- First written 2026-11-09 against `8753d1c`. **Re-validated 2026-11-11 against `38905d4`** (230 commits later). Every finding, table row and plan item was re-read against the current tree; line numbers below are for `38905d4`. What changed is listed in §5.1 (resolved) and marked "new" in §5.
- What those 230 commits were, by theme: (1) a dormant second version of Shooter campaign verification (migrations `0050` to `0058`, about twenty workflows, `docs/shooter-verification/`); (2) Shooter and People's Bitcoin re-vendors; (3) follower pets: a free default companion, six more Relic pets, server-owned pet equipment; (4) a plaza restyle (plain entrances with signs in place of neon rings), a larger Bar, new camera follow, three Pepe avatars, four more staves; (5) flags and a maintenance drain (`shooter_pvp` now gates free Shooter matches, `sproto_duel_wager` gates Fighter wagers); (6) `docs/two-game-release.md`, which records that Coop Battle and Shooter stay dark until the owner says otherwise.
- The re-validation was a code and docs re-read. Nothing was re-run.
- Scope: the plaza as a place to play, and the cross-game layer (Tickets, Verse, Relics, boards, online modes). The eight games have their own plans in their own repos.
- Relation to `2026-11-08-state-machines-audit-and-launch.md` (called "the launch plan" below): this document is the gameplay track that plan asks for in §R.3 ("A gameplay track (G)") and expands its economy track §R.11. Where the two differ, the difference is stated in the item. Sizes use the same S / M / L scale.

Labels used here: **faucet** means a way to earn Tickets. **Held** means a Relic or item rule with `grant_hold = true`, whose grant is parked in a pending table and gives the player nothing. **Hub scope** and **game scope** are the two session kinds (`ctx.vars.scope`); a plaza session is hub scope, a session opened by a portal ticket is game scope.

## 2. How this was audited and how far to trust it

**Run.** `npm ci`, then the plaza dev server (Vite), driven by headless Chromium at 1280×720, 1366×768, 1920×1080 and 1024×576. The Nakama backend was not running, so every `/v2` call returned 502. Seen on screen: the login gate, guest entry, the south spawn, `#from=nobu` (a ring with its board), `#from=sproto-fighter` (the Bar, the cabinet picker, a failed launch), the Esc menu tabs (Items, Relics, Pets, Sims) and offline chat.

**Not re-run on 2026-11-11.** The plaza was restyled after the run above (`realms/plaza/content.ts`, `buildings.ts`, `plaza.ts`): the neon rings, lamps and floor tints are gone and each entrance is a door frame with a name sign. Anything this plan says about how the outdoor plaza looks was seen on the old look and is unverified on the new one. The login gate files (`login.css`, `hub/index.html`, `login.ts`) did not change, so the fold measurements still apply.

**Read only.** Everything server-side (`server/modules/src`), the whole economy, every online mode, the SDK, each game's hub integration files, and production behaviour.

**Limits you should hold against every claim below.**

- Software rendering stalled 2 to 5 seconds per frame. Movement feel, frame rate, camera behaviour and anything multiplayer are **unverified**. Draw calls (47 to 71) and script cost (about 240 ms of app script in a 15 s profile) were measured and are fine.
- Nothing was checked against the live production database. Any statement about what a migration left in place (which rules are held, which amounts are 0) comes from reading `schema.ts` in id order, not from data. If production skipped or hand-edited a row, this plan does not know.
- In dev the plaza fills several features with stub data (`realms/plaza/content.ts:264`). What a production build shows in those places was inferred from code.
- Distances and travel times are computed from constants, not walked.
- The game repos were read only for their hub calls. Their gameplay was not judged here.

## 3. What already works and should be kept

- **Light first load.** About 1.9 MB of world assets before the first frame and about 7.7 MB streamed in during the next 40 s (measured on the dev server). The 6.7 MB Bar interior loads only when you walk in.
- **The login gate takes input while the plaza loads behind it** (`login.ts`), and resumes a remembered account without asking.
- **Guest to account keeps progress** (`account.claim`), and a guest can make a recovery code.
- **Portal flow.** One second of standing in a ring (`PORTAL_ENTER_DWELL`, `travel.ts:7`), a 700 ms wipe, a one-time 60 s ticket, a 6 h session lease (`schema.ts:260-265`), and `#from=<game>` puts you back at the gate you left by.
- **Idempotent economy.** Every write takes a key, replays return the stored answer, and the duplication suite (`npm run test:dup`) covers earns, exchange, Relics and wagers.
- **Server-verified modes.** Coop Battle (banked six-seat, full sim), Shooter (campaign verifier and the free 1v1 director), Fighter (full replay), People's Bitcoin (server-run worlds). These are the model for anything that pays.
- **Chat moderation** (rate limits, masking, mute, report) and shard placement (100 per world, soft cap 90).
- **Controller support across the hub**, extended in `8753d1c`.
- **Sprotel answers honestly** that the store is not open (`v2/sprotel-talk.ts:30`).
- **The cabinet picker** is clear and quick.
- **Launch errors at the cabinet stay for 5 s** (`PORTAL_ERROR_MS`, `core/shell.ts:871`).
- **Every account has a companion.** Pepe Bull follows new players by default; equipment is stored and validated on the server and ignores what the client claims (`pets.ts`, `hub_match.ts` `applyProfile`, `docs/follower-pets.md`). Seven of the eight Relics now come with a pet.
- **Relics gate visible things in the plaza.** The Shooter Staff needs the Dragon Scale and the Fighter Staff needs Tinubu's Crown (`config.ts:110-113`), checked on the server too (`hub_match.ts` `ownsStaff`).
- **A safe way to change a fingerprint inside an applied migration**: `0048_shooter_campaign_fingerprint` rewrites the live function with `pg_get_functiondef` and `replace` (`games/shooter_rewards.ts:408-427`). §8 reuses it.
- **A deploy drain** (`games/maint.ts`, `deploy/scripts/check-nakama-drain.sh`): new matches are refused with "Maintenance. Try again after the restart." while a restart is pending.

## 4. The economy as it stands

### 4.1 The three things

- **Tickets** are earned inside a game and live in a wallet **per game** (`game.tickets_balance`, keyed by user and game). They are spent in People's Bitcoin's Ticket shop, staked in Fighter wagers (and Shooter wagers when those are switched on), or exchanged for Verse.
- **Verse** is one account-wide balance (`game.verse_wallet`). Nothing spends it today.
- **Relics** are eight earn-once trophies, one per game. They orbit the avatar, sit in monument sockets, unlock an aura, a pet (all but the Marina Anchor) and, for seven of them, an item in at least one other game. The benefit is computed by each game from `profile.relics` and `profile.items`; the server's resolver returns `{}` because `portal.enter` passes an empty loadout (`rpcs.ts:450`, `effects.ts:316-320`). Item ownership derived from Relics is `game.owned_item_ids`, last replaced by `0047_duel_relic_staves` (`schema.ts:3518`).

### 4.2 Caps

| Cap | Value | Source |
|---|---|---|
| Tickets per game session | 200 | `game.session_ticket_cap()`, `schema.ts:212-214`; enforced in `game.take_ticket_credit`, `schema.ts:923-935` |
| Tickets per game per UTC day | 1,000 | `schema.ts:940` (`v_room := 1000 - v_used`) |
| Exchange rate | 10 Tickets = 1 Verse | `schema.ts:1560` (`v_verse := p_tickets / 10`); SDK `TICKETS_PER_VERSE`, `types.ts:69` |
| Verse per game per UTC day | 50 | `schema.ts:1568` (`v_room := 50 - v_used`); SDK `VERSE_DAILY_CAP`, `types.ts:70` |
| Portal entries | 10 per minute | `game.claim_portal_rate`, `schema.ts:1296-1311` |
| Session lease | 6 hours; entering another portal closes it | `game.open_portal`, `schema.ts:245-275` |
| Story-boss pay | 20 Tickets, once per boss per UTC day | `game.apply_event`, `schema.ts:3018` onward (bucket `boss:<game>:<boss>`) |

The session and daily caps are per game, not global. A request that would cross a cap is refused whole, not trimmed.

### 4.3 Earn rules per game

| Game (id) | Reason or event | Amount | Limit beyond the caps | Who reports | What verifies |
|---|---|---|---|---|---|
| HPOS10I (`hpos10i`) | `tickets.earn` reason `level_end` | up to 20 per call (rule `schema.ts:1329`); the game sends at most 20 per act | none | client | nothing beyond the ceiling and caps |
| NOBU (`nobu`) | `tickets.earn` reason `level_end` | up to 20 per call; the game splits a level's Tickets into 20-Ticket chunks | none | client | nothing beyond the ceiling and caps |
| People's Bitcoin (`peoples-bitcoin`) | `pb_bank`, `pb_drop`, `pb_lobby`, `pb_sell` (up to 200 per call), `pb_quest` (up to 158) (`schema.ts:1331-1335`) | per call | none | the server-run world, through `HubEconomy.earn` (`games/pb_world.ts:112`) | the hosted sim |
| Sproto Duel (`sproto`) | event `sproto.boss_defeated`, bosses `sahil`, `obama`, `broccoli`, `agent`, `tinubu` | 20 | once per boss per day (`schema.ts:2108-2112`) | client | boss allowlist and the day limit |
| Sproto Duel PvP | `win`, `duel_win`, `srv_pvp_win` | 0 since `0031_story_boss_tickets` (`schema.ts:2089-2096`) | n/a | n/a | n/a |
| Sproto Fighter (`sproto-fighter`) | `tickets.earn` reason `fighter_win` | 0 since `0031` (any positive amount answers `amount_over_rule`) | n/a | client still sends 20 | n/a |
| Sproto Fighter | event `fighter.boss_defeated`, ten boss ids (`schema.ts:2113-2122`) | 20 | once per boss per day | **nobody: the game never sends it** | boss allowlist and the day limit |
| Sproto Arcade (`sproto-arcade`) | `tickets.earn` reason `arcade_clear` (`games/sproto_arcade.ts`) | 20 per clear | none | client | nothing beyond the ceiling and caps |
| Sproto Shooter (`sproto-shooter`), version 1 | `shooter.run.issue` then `shooter.run.submit`, bosses `sahil`, `obama`, `broccoli`, `glowie`, `tinubu` | 20 | once per boss per day (`games/shooter_rewards.ts`) | **nobody: no client calls `submit`**. A long clear can also exceed the 15 s verify budget and come back `cpu_budget`, unpaid (`docs/two-game-release.md`, "Launch risks") | full run replay inside Nakama |
| Sproto Shooter, version 2 (new, dormant) | `shooter.run.issue`, `shooter.run.append`, `shooter.run.finish`, `shooter.run.status` | 20, same boss and day rule, paid later by a worker | payment needs the original session still open when the worker finishes (owner decision D01, `docs/shooter-verification/decisions.md`) | the game's new rewarded mode (`sproto-shooter/src/hub/campaignRewards/`), **built only with `VITE_SHOOTER_REWARDED=true`**; the server cohort is empty and every activation flag is off | replay in an isolated worker, settled by `0055` |
| Sproto Coop Battle (`sproto-coop-battle`) | banked match settle, twelve bosses | 20 | once per boss per day (`games/coop_rewards.ts:16`, `docs/coop-economy.md`) | the match | the hosted sim, AFK and seat rules |

### 4.4 Exchange, Relic, boards, online

| Game | Exchange path | Relic and status | Benefit of this Relic elsewhere | Board | Online |
|---|---|---|---|---|---|
| HPOS10I | **refused by the server** (`rpcs.ts:617`, `schema.ts:1541`) | HPOS10I Core, live since `0043` | yes (3 items) | `hpos10i_act_time`: in the Bar, **can never receive a post** (see F7) | none |
| NOBU | in-game UI | Cone's Tip, live | yes (3 items) | `nobu_trial_time`, 9 variants, all in the Bar, working | none |
| People's Bitcoin | in-game UI | Genesis Block Shard, **held** | yes (3 items), unreachable | `pb_total_xp`, in the Bar | 100-player worlds (`pb_world`) |
| Sproto Duel | in-game UI | Tinubu's Crown, live | yes (3 items) | `sproto_wins`, server-written, in the Bar | relay and referee 1v1 (`sproto_arena`): quick match, rooms, rematch |
| Sproto Fighter | none | Tidebreaker Belt, **held** | yes (4 items and Fighter Pet), unreachable | none | 1v1 with replay verification (`sproto_duel`). The 10-Ticket wager (5 per pair per day, 200 net win per day, no guests) is now behind flag `sproto_duel_wager`, seeded **off** by `0049` (`sproto_duel.ts:317`) |
| Sproto Arcade | none | Breakwater Coin, live | Alien Ray Staff in Duel, Mecha Pet, plus Cone's Tip's items in the other games | none | none |
| Sproto Shooter | none | Dragon Scale, live | Shooter Staff in Duel and in the plaza, Soldier Pet (new since the first audit) | `shooter_story_clear_ms_v1`: server-written, **not in the Bar, and not readable** (see F8) | authoritative 1v1 (`sproto_shooter_free`): queue, rooms, resume. **New free queues and rooms now need flag `shooter_pvp`, seeded off** (`games/shooter_matchmaking.ts:243`, `shooter_match.ts:1174`); wagers also need `shooter_pvp_wager` |
| Sproto Coop Battle | none | Marina Anchor, live | none | `coop_stage_clear_ms_v1`: same as Shooter's | banked six-seat (`sproto_coop`): queue, rooms, resume |

People's Bitcoin's Genesis Block Shard now also carries the Moonward Staff and President Pet; Tinubu's Crown the Fighter Staff and Wizard Pet; the Core the Runner Pet. The Marina Anchor is the only Relic with no benefit. People's Bitcoin's Ticket shop changed one price: the Campaign Pistol buys for 2 and sells for 1 (`0050_pb_campaign_pistol_price`, `schema.ts:3577`; `docs/games/pb-world.md` records it as the one exception to the 45% resale rule, and each round trip still loses a Ticket).

Also held: pets `pet_honk_sproto`, `pet_spiral_sproto`, `pet_moon_sproto`, `pet_sproto_pup` (`schema.ts:2450-2456`) and `hub_life_medal` (`schema.ts:2964`). A cross-game `meta` board is computed on the server (`leaderboard.ts:170-190`) and shown nowhere.

### 4.5 The arithmetic

All figures are ceilings set by the rules. How long a ceiling takes to reach in play was not measured.

| Game | Tickets per day the rules allow | Verse per day today | Verse per day if every game could exchange |
|---|---|---|---|
| HPOS10I | 1,000 (20 per act, 200 per session) | 0 | 50 |
| NOBU | 1,000 (level 1 alone is authored for up to 205 Tickets, `nobu/src/config/tickets.js:34-38`) | 50 | 50 |
| People's Bitcoin | 1,000 | 50 | 50 |
| Sproto Duel | 100 (5 bosses) | 10 | 10 |
| Sproto Fighter | 0 today; 200 once it sends boss events (10 bosses) | 0 | 20 |
| Sproto Arcade | 1,000 (20 per clear, no daily rule) | 0 | 50 |
| Sproto Shooter | 0 today; 100 once rewarded runs are switched on (5 bosses) | 0 | 10 |
| Sproto Coop Battle | 240 (12 bosses; 200 in one session) | 0 | 24 |
| **Total** | | **110** | **264** |

The store catalogue in `docs/m7-server-prep.md` is 20 items for 4,850 Verse (cheapest 50, dearest 1,000).

| Player | Verse per day | Days to buy the whole catalogue | Days to the cheapest item |
|---|---|---|---|
| Today, hitting every ceiling in NOBU, People's Bitcoin and Duel | 110 | 45 | 1 |
| Today, one capped session a day in each of those three (200 Tickets is 20 Verse; Duel gives 10) | 50 | 97 | 1 |
| Today, Duel only | 10 | 485 | 5 |
| Today, any of the other five games only | 0 | never | never |
| After Phase B, hitting every ceiling in all eight | 264 | 19 | 1 |
| After Phase B, one capped session a day in each of the eight (20+20+20+10+20+20+10+20) | 140 | 35 | 1 |

Two readings. First, a NOBU or People's Bitcoin player earns Verse five times faster than a Duel player and infinitely faster than a Fighter, Arcade, Shooter, Coop or HPOS10I player. Second, even after repair the economy rewards breadth: the per-game cap of 50 means the fastest way to Verse is to play several games, which is the behaviour the hub wants. Keep the per-game cap.

## 5. Findings

Severity is impact on a player. "Read" means established from code only.

| ID | Sev | Finding | Evidence | How | What the player experiences |
|---|---|---|---|---|---|
| F1 | High | Verse buys nothing | `store.ts` and `loadout.ts` are absent from `server/modules/tsconfig.json` `files`; `main.ts:231-252` registers no store RPC; Pets tab shows "Store: 400 Verse" (`menu.ts:100-101`). `pets.catalog` (new) reports `buyingEnabled` from flag `pet_buying`, but no purchase RPC exists (`pets.ts:57-61`) | read; menu observed | A counter in the HUD that only goes up, and a shop that says "not yet" |
| F2 | High | Tickets are stranded in five games | Exchange needs a game session (`rpcs.ts:614-616`); only NOBU, People's Bitcoin and Duel call `sdk.exchange`; HPOS10I is refused (`rpcs.ts:617`); there is no hub-scope balance or exchange RPC | read | Tickets earned in Fighter, Arcade, Shooter, Coop and HPOS10I never become anything |
| F3 | High | The Four Lights cannot be completed | Genesis Block Shard and Tidebreaker Belt held (`schema.ts:2444-2449`); "nothing calls" `game.promote_pending_grant` (`schema.ts:2393`); flag `relic_unhold` is seeded and never read (`flags.ts:23`) | read | Finishing the People's Bitcoin tutorial or Fighter World 1 lights nothing. Hall of Champions, the Four Lights Sproto pet and Fighter's Error 333 are unreachable. The Relics menu gives no hint |
| F4 | High | Sproto Fighter has no working faucet | `fighter_win` ceiling is 0 (`schema.ts:2089-2096`); the game still sends it (`Sproto-Fighter/src/hub/report.ts:43`); ten `fighter.boss_defeated` rules are never triggered | read | Wins pay nothing; the 10-Ticket wager can only be funded by Tickets from before `0031` |
| F5 | High | Sproto Shooter's faucet is built but switched off (changed since the first audit) | The game now has a rewarded mode with a boss picker, rules screen and receipt (`sproto-shooter/src/hub/campaignRewards/`, Shooter #112), compiled in only when `VITE_SHOOTER_REWARDED=true` (`session.js:20`). It speaks only the version 2 run protocol. On the server that protocol is dormant: the cohort table is empty and sticky, and issuance needs a registered worker (`docs/shooter-verification/lifecycle.md`). An account outside the cohort gets the version 1 answer, which the client shows as "Rewarded run unavailable" (`presentation.js:66`). Nothing calls version 1 `shooter.run.submit` | read | Shooter still earns no Tickets. Turning it on is an owner decision with hosting attached (§7.2), not a missing button |
| F6 | High | Sign-up and guest buttons are below the fold on common laptops | At 1280×720 the form area is 480 px tall with 614 px of content; "Create account" starts at y=619 and "Continue as guest" at y=701. At 1366×768: 528 px for 630 px. The area scrolls by design (`login.css:160-168`). The guest choice is per tab (`auth.ts:210-222`) | observed | A first-time visitor sees three fields and no button. A guest meets this again in every new tab |
| F7 | Med | HPOS10I's board can never fill | The plaza always sends `ranked: false` (`core/shell.ts:885`) and has no ranked control; unranked posts from `hpos10i` and `sproto` are refused (`leaderboard.ts:134-135`) | read | The first page of the Bar board stays empty |
| F8 | Med | The Bar board is mostly NOBU and partly dead | 17 pages × 8 s (`m3/types.ts:42-61`, `barLeaderboard.ts:50`): 9 NOBU, 1 that cannot post (F7), 1 that cannot exist (`verse_by_game_hpos10i`). Shooter and Coop boards store one row per boss in `variant` (`coop_rewards.ts:345-347`, `shooter_rewards.ts:373-375`) but `leaderboard.top` only accepts a variant for NOBU (`leaderboard.ts:295`), so they cannot be read. `meta` is never shown. Sample names are painted as if real when a tab is empty (`content.ts:522-528`, `:576` discards the `sample` flag) | read | A 136 s loop with little of interest; Fighter, Arcade, Shooter and Coop players never see themselves |
| F9 | Med | The plaza is silent | No audio files under `apps/hub/public/world`, no audio code in `apps/hub/src` | read | No footsteps, ambience, portal or UI sound |
| F10 | Med | Emotes are built on the wire and absent from play | Server relays `wave`, `dance`, `cheer` (`hub_match.ts:40`, `:456-461`); client has `plaza.emote()` and `onEmote()` (`net/plaza.ts:208`, `:214`); nothing calls either, and no avatar file has those clips | read | Nothing to do with other players but type |
| F11 | Med | "Players inside" counts, per-gate top 10 and the Hall roster are dev stubs | Only call sites of `living.setPresence` and `hall.setChampions` are inside `if (devPreview)` (`content.ts:219-225`) | read; stubs observed in dev | In production each entrance board is empty, and the Hall of Champions opens to no names |
| F12 | Med | Finding a game is slow (partly changed) | Spawn 42 m south of centre, entrances at 96 m (`plaza/config.ts:4`, `:44`); walk 7.8 m/s, sprint 16 m/s (`core/movement.ts:3`). Nearest entrances about 66 m (8.5 s walking, 4 s sprinting); HPOS10I about 140 m. Since the restyle each entrance carries a sign with the game's name and "Walk in to play" (`buildings.ts:33-51`), at 0.57 scale on a 4.8 m frame; whether it reads from spawn is **unverified** (on the old look no name was legible). The glowing rings and beams that marked entrances from afar are off (`effects: false`, `content.ts:214`). Three games exist only inside the Bar cabinet. No game list anywhere | computed and read | A new player must still explore to learn what the hub contains |
| F13 | Med | Failure text is developer text | Status line "Nakama offline" (`shell.ts:1019`); launch failure shows the raw error, "HTTP 502" (`shell.ts:899`); RPCs have no timeout (`packages/hub-sdk/src/nakama.ts`), so a hung `portal.enter` leaves the full-screen wipe up; a failed first session is not retried until a portal is tried | observed and read | "HTTP 502" at a gate; a possible stuck coloured screen |
| F14 | Med | No reason to come back tomorrow | No daily or weekly goal, streak or account level; the only clocks are UTC resets of boss pay and exchange | read | Nothing new on a second visit |
| F15 | Med | No social graph in the hub | No friends, party, invite or whisper in `hub_match.ts`, `hub_rpcs.ts` or the client. People's Bitcoin has its own friends list | read | You cannot bring a friend into a Coop room from the plaza |
| F16 | Low | The 18+ mark on People's Bitcoin does nothing | `mature: true` (`plaza/config.ts:13`) is read nowhere; `docs/plaza-baseline.md` asks testers to check a prompt that does not exist | read | Walking into the ring launches the game with no notice |
| F17 | Low | Store prices disagree | Menu (`menu.ts:100-101`) and Sprotel (`sprotel-talk.ts:30`) say 400 and 600 Verse; the seed says 300 and 500 (`docs/m7-server-prep.md` seed, `store.ts` `RAW_CATALOG`) | read | A promise the store would break on day one |
| F18 | Low | One Relic does nothing outside the plaza (was two) | The Marina Anchor has no item, staff or pet (`menu.ts:60`, `pets.ts` catalogue). The Dragon Scale gained the Shooter Staff and Soldier Pet | read | Less reason to earn the Anchor |
| F19 | Low | Avatar choice is per browser | `look.ts:5-6` | read | Character and staff reset on another device |
| F20 | Low | The first menu tab holds no items | Items shows "Verse 0 · 0 of 8 Relics" and, since `8753d1c`, the controller stick setting (`menu.ts:237`) | observed, then read | The page called Items is a wallet line and a settings row |
| F21 | Med | Several Ticket sources are client-reported | HPOS10I, NOBU and Arcade earns are bounded only by the per-call ceiling and the caps; Arcade has no per-day rule | read | Not visible to an honest player. It matters once Verse buys things: a scripted client can reach 50 Verse a day per such game |
| F22 | Med | Coop's reward function hard-codes the content fingerprint | `game.settle_coop_clear` compares against a literal (`coop_rewards.ts:236`, again at `:342`) inside applied, checksummed migration `0041`. Shooter had the same trap and handled it with `0048` (§5.1) | read | After a Coop content re-vendor that updates only the constants, every clear would settle as `bad_version`: no Tickets, no board row. See §8 |
| F23 | Low | Docs drift | `docs/CONTRACTS.md:108` still says the next free migration is 0045; ids run to 0058 and the list of record is now `docs/migration-allocations.md`, which itself starts at 0050 and omits 0047 to 0049. `CONTRACTS.md` still gives the Shooter PvP fingerprint as `f5949631`; the pin and `shooter_protocol.ts:34` say `b33eada6` | read | None directly; it misleads whoever does §8 |
| F24 | Med | **New.** Free Shooter 1v1 is off until a flag is set | New free queues and rooms answer `pvp_off` unless `shooter_pvp` is on for the account (`games/shooter_matchmaking.ts:243`, `shooter_match.ts:1174`, hub #124); the flag is seeded off | read | "Find free match" cannot work in production until the owner turns the flag on. Deliberate (`docs/two-game-release.md`), but the game needs to say "online play is not open yet" |
| F25 | Low | **New.** Fighter wagers are off until a flag is set | `sproto_duel_wager` seeded off by `0049`; a wagered match cancels with `stakes_disabled` (`sproto_duel.ts:317-320`, `:379`) | read | Combined with F4, Fighter's Tickets have no source and no use |
| F26 | Low | **New.** Vertical look is inverted with no setting | README and the controller note say "inverted vertical control" (`menu.ts:246`); `turnCamera` has no invert option (`shell.ts:588-592`, pad at `:707`) | read; feel unverified | Players who expect the other convention cannot change it |
| F27 | Med | **New.** Two unreconciled plans for selling pets | `server/data/follower-pets.json` gives every follower a reserved `ticketsPrice` (all 0) and `pets.catalog` exposes a `pet_buying` flag, while the Verse store seed sells `pet_hopium_sproto` and `pet_coom_sproto` for Verse. Tickets are per game, so "a Tickets price" has no wallet to charge | read | None yet. If both ship, pets are priced in two currencies |
| F28 | Med | **New.** A valid rewarded Shooter run can end unpaid | Version 2 pays only if the session that issued the run is still open when the worker finishes; no grace (D01). The session closes when the player enters any other portal (`schema.ts:258`) or after 6 h | read | "I beat the boss, went back to the plaza, and got nothing." The game warns before the run; the plaza does not |
| F29 | Low | **New.** Many companion slots still have no model | The Pets tab lists 22 pets; models exist for 11 (`apps/hub/public/world/v2/pets`); the rest show "Model soon" when owned (`menu.ts:537`) | read | An earned pet that cannot be seen |

### 5.1 Resolved or changed since the first audit

| What the first audit said | Now | Where |
|---|---|---|
| A failed cabinet launch vanished after one frame | The message stays 5 s. The wording is still raw (F13) | `8753d1c`, `shell.ts:871` |
| The Shooter pin looked behind Shooter `main` | Re-vendored three times; the pin is `7960d85`. Shooter `main` (`d8596be` in the checkout beside this repo) is 29 commits ahead with no change under the paths `scripts/shooter-main-pin.mjs` treats as sim source, so both checks should pass. CI was not run | hub #122, #129, #134, #158 |
| `game.settle_shooter_clear` would reject a new campaign fingerprint | Handled once: `0048_shooter_campaign_fingerprint` rewrote the live function from `3c657fb5` to `cea1f88b`. The same pattern is needed at every later campaign content change | `games/shooter_rewards.ts:408-427` |
| Shooter had no button to submit a verified run | A rewarded mode exists in the game, default off, on a new server protocol that is also default off (F5 rewritten) | Shooter #112, #113; hub #141 to #162 |
| `shooter_pvp` did not gate free matches | It does now, which creates F24 | hub #124 |
| The Dragon Scale did nothing elsewhere | Shooter Staff (Duel and plaza) and Soldier Pet | hub #128 (`0047`), #127 |
| The Breakwater Coin only repeated Cone's Tip | It also grants the Alien Ray Staff and Mecha Pet | `0047`, #127 |
| Only three Relics had pets, and four pet models existed | Seven Relics have pets; eleven models exist; everyone starts with Pepe Bull | hub #127, #132, #157 |
| Fighter wagers were open to any signed-in pair | Behind flag `sproto_duel_wager`, off (F25) | `0049` |
| No maintenance state | `maint.begin` / `maint.live` / `maint.end` and a drain check | `games/maint.ts` |
| People's Bitcoin world sim `f8910ac055ba8871` | `9a8fb62cbbc73f39`, re-vendored with the Campaign Pistol price | hub #147 |

Not changed by any of the 230 commits: the store and loadout are still outside the build (`tsconfig.json` gained only `src/pet_catalog.ts`); there is still no hub-scope exchange or balance RPC (`rpcs.ts` is untouched); the Genesis Block Shard and Tidebreaker Belt are still held (no migration touches `grant_hold` after `0043`); Fighter still sends `fighter_win`; the Bar board list (`m3/types.ts`) and `leaderboard.ts` are untouched; the login gate is untouched; the SDK is still 0.6.4.

**SDK note.** One file under `packages/hub-sdk` changed: `src/pbShop.ts` (the Campaign Pistol row, price 25 to 2, sell 11 to 1) and with it `SOURCE.pin.json`; the version stayed 0.6.4. The table is price data that only People's Bitcoin uses, and the server is authoritative for prices. People's Bitcoin vendored 0.6.4 before that change (its `aa26b51` precedes hub #147), so **People's Bitcoin should re-sync** to show the right price before purchase. The other seven copies differ from hub `main` only in that unused row; re-sync them at their next SDK update. Sproto Coop Battle's build refuses a copy whose hash differs from its pin, so it must update pin and copy together when it does.

## 6. The plan

Every item ends with three lines: **SDK CHANGE**, **SERVER DEPLOY**, **ECONOMY RISK**. Per `AGENTS.md`, an SDK change names the game repos that must re-sync `vendor/hub-sdk`. The owner runs all deploys; items only describe them. Migration ids are written as `00NN`: at `38905d4` the highest registered id is `0058`, so the next free is `0059`. Before taking one, read `docs/migration-allocations.md` and open PRs, add a row there for your reservation (unmerged reservations count), and never reuse a number: the runner allows exactly one historical duplicate, the two `0050` migrations.

### Phase A. Quick wins in the hub client

**A1. Put the buttons above the fold** (fixes F6)
- Goal: at 1280×600 and larger, "Create account" and "Continue as guest" are visible without scrolling.
- Change: today `.login-view` scrolls (`login.css:160-168`) and the footer sits below it. Proposed: (1) move the guest button out of the scrolling view into a fixed action row under it, next to the progress footer; (2) under `@media (max-height: 800px)` hide the three static hint lines until their field has focus or an error, and reduce `.login-panel` top margin from 40 px to 16 px; (3) keep the scroll as a fallback below 600 px.
- Steps: edit `apps/hub/hub/index.html` (move `#login-guest` and the "or" rule), `login.css`, and `login.ts` only where it toggles hint text. Check controller focus order (`core/pad-focus.ts`).
- Tests: add a geometry assertion to the walkthrough in `docs/plaza-baseline.md` step 1 (button bottoms inside the viewport at 1280×720 and 1366×650). No unit test exists for the gate; none is needed.
- Acceptance: at 1280×720, 1366×768 and 1366×650, `getBoundingClientRect().bottom` of `#login-submit` and `#login-guest` is less than `innerHeight`, and neither is clipped by an ancestor.
- Effort: S. Dependencies: none.
- SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**A2. Say what went wrong, in words, and never hang** (fixes F13)
- Goal: a failed launch or an unreachable server reads as a sentence and recovers by itself.
- Change: (1) in `travel()` (`core/shell.ts:873-904`) map errors to copy: network or HTTP 5xx becomes "The hub server is not answering. Try again in a moment."; `rate_limited` keeps the server text; `GATE_LOCKED` becomes "That door is locked."; anything else "Could not open <label>." (2) Race `portal.enter` against a 10 s timer and treat expiry as a failure. (3) Change the status text "Nakama offline" (`shell.ts:1019`) to "Offline: playing solo". (4) After a failed `boot()`, retry every 15 s while the tab is visible, and call `startPlaza` on success. (5) Add a `pageshow` listener that clears `traveling` and the wipe when `event.persisted` is true (the launch plan's SM3).
- Tests: extend `apps/hub/test/game-entry.test.ts` with a pure `launchErrorText(error)` function; add a timeout case.
- Acceptance: with the backend down, a ring and the cabinet both show the sentence for 5 s and no raw status code appears in the HUD; with the backend restored, the status line becomes "World N" within 20 s without a reload.
- Effort: S. Dependencies: none.
- SDK CHANGE: no (the timeout wraps the call in the plaza; `nakama.ts` is untouched). SERVER DEPLOY: no. ECONOMY RISK: none.

**A3. Tell the truth in the Relics and Pets menus** (fixes F17, part of F3)
- Goal: no menu text promises something the server will not do.
- Change: in `menu.ts`, add a `held` set for `genesis_shard` and `tidebreaker_belt` and for the four held pets; their badge reads "Not awarded yet" in place of "Locked", with one line: "Clearing this is recorded. The Relic arrives when grants open." Change "Store: 400 Verse" and "Store: 600 Verse" (`menu.ts:100-101`) and Sprotel's line (`sprotel-talk.ts:30`) to the seed prices, 300 and 500, or to "Store: coming" until C1 ships. Remove the `held` set in B3.
- Tests: `apps/hub/test/relics.test.ts` gains a case that every held id has the pending badge; `sprotel-talk.test.ts` pins the price text to a shared constant.
- Acceptance: the two Relic cards and four pet cards show the pending text; prices match the seed.
- Effort: S. Dependencies: owner decision 10.3 does not block this.
- SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**A4. Remove dead Bar pages and label samples** (part of F8)
- Goal: every page the Bar shows can hold real rows, and placeholder rows say so.
- Change: in `m3/types.ts` drop `verse_by_game_hpos10i` from `HUB_BOARD_IDS` until B1 allows HPOS10I exchange, and drop `hpos10i_act_time` until B4. Collapse the three "Classic" NOBU variants behind the three current layouts (show a Classic page only when it has rows). In `content.ts` stop discarding `sample` in `setBoard` (`:616-618`) and draw "sample" on the wall board, or show "No scores yet. Be the first." and drop `SAMPLE` entirely.
- Tests: `apps/hub/test/relics.test.ts` or a new `boards.test.ts` asserting no page id maps to a board that the server refuses for hub-entered sessions.
- Acceptance: the loop is at most 12 pages; no invented player names appear in a production build.
- Effort: S. Dependencies: none (B4 and E5 add pages back).
- SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

### Phase B. Make the economy connect

**B1. Hub Wallet tab with hub-scope exchange** (fixes F2; the launch plan's §R.11 step 3)
- Goal: from the plaza, a player sees Tickets per game and turns them into Verse, for all eight games.
- Change, server: two hub-scope RPCs. `tickets.balances {}` returns `[{ game, balance, verseCapLeft }]` for every game id from `game.tickets_balance` and the `verse:<game>` row of `game.earn_window`. `verse.exchange { game, tickets, key }` calls a new SQL function `game.exchange_tickets_hub(p_user_id, p_game_id, p_tickets, p_idem_key, p_req_hash)`: the body of `game.exchange_tickets` (`schema.ts:1522-1612`) without the `game_session` check and without the HPOS10I refusal (if decision 10.2 agrees), same advisory lock `economy:<user>`, same `verse:<game>` bucket and 50 cap, same writes to `tickets_ledger`, `verse_ledger`, `exchange_tx`, `verse_earned`, and idempotency recorded as rpc `verse.exchange`. Both handlers call `requireHub(ctx)` and `rejectAnonymousWrite`. Migration `00NN_hub_exchange` creates the function only. The in-game `tickets.exchange` stays as it is.
- Change, client: a seventh menu tab "Wallet" in `menu.ts` (`TABS`, `MENU_TAB_ORDER`, key 7): one row per game with icon, Tickets, "Exchange N for M Verse" (N is the largest multiple of 10 within balance and cap), and the cap left today. On success update the HUD Verse and the row. Offline: the tab says so.
- Steps: (1) migration and function; (2) `rpcs.ts` handlers plus top-level wrappers and `registerRpc` lines in `main.ts`; (3) add both ids to the scope checks in `server/test/unit/scaffold.test.ts`; (4) menu tab; (5) call from `shell.ts` with the hub session, key from `crypto.randomUUID()` kept until an answer arrives so a retry reuses it.
- Tests: new rows in `server/test/dup/cases.ts` for `verse.exchange` (replay, mismatch, race against `tickets.exchange` for the same game and day, cap, insufficient balance, forged scope). **Needs `npm run test:dup` with Nakama from `server/docker-compose.yml`.** `server/test/dup/audit.sql` must still return no rows. Unit: a game-scope token is refused.
- Acceptance: Tickets earned in Coop Battle appear in the Wallet within one `profile` refresh and exchange to Verse; in-game plus hub exchange for one game on one day never exceeds 50 Verse; a double click credits once.
- Effort: M. Dependencies: decision 10.2.
- SDK CHANGE: no. The plaza calls RPCs through `createNakamaClient`, as it already does for `loadout.set_hub`. (The launch plan put a `verse` field and exchange helpers in SDK 0.7.0; that stays optional and is not needed for this item.)
- SERVER DEPLOY: yes (one migration, new RPCs).
- ECONOMY RISK: no new mint; it opens the existing sink-to-Verse path to five more wallets. Daily Verse ceiling rises from 110 to 264 (§4.5). Exposure is the client-reported earns of F21, bounded at 50 Verse per game per day. The shared bucket and lock prevent double spending across the two exchange RPCs; the dup race case proves it.

**B2. Repair the missing earns** (fixes F4, F5)
- Goal: every game that should pay Tickets does.
- Change in this repo: none to rules. `fighter.boss_defeated` rows exist. For Shooter the code on both sides exists and is switched off; what remains is activation (§7.2), which is the owner's. Add coverage so they cannot rot: `server/test/dup/story-boss.ts` gains the ten Fighter boss ids; `server/test/games/shooter_runs.test.ts` already covers issue and submit. Add `FighterBossDefeated: 'fighter.boss_defeated'` to `HubEvent` in `packages/hub-sdk/src/events.ts` only when the SDK is next released for another reason; `reportEvent` takes any string (`types.ts:180`), so Fighter does not need it.
- The real work is in the game repos: §7.1 and §7.2.
- Acceptance: on a local stack, one Fighter story boss win credits 20 Tickets and a second win against the same boss that day credits 0. Shooter's acceptance is the evidence already required by `docs/shooter-verification/execution-ledger.md`.
- Effort: S here. Dependencies: Fighter and Shooter PRs.
- SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: turns on mints the server already allows: up to 200 a day in Fighter (client-reported, allowlisted, day-limited) and 100 in Shooter (verified).

**B3. Release the held Relic grants** (fixes F3; §R.11 step 2, owner answer "Yes" in §R.6)
- Goal: the Genesis Block Shard and Tidebreaker Belt are granted on the qualifying clear, and players who already qualified get them.
- Change: migration `00NN_relic_unhold`: `UPDATE game.event_rule SET grant_hold = false` for (`sproto-fighter`, `fighter.story_level_complete`, `tidebreaker_belt`) and (`peoples-bitcoin`, `pb.quest_complete`, `genesis_shard`); then promote every pending claim for those two ids with `SELECT game.promote_pending_grant(user_id, 'relic', relic_id) FROM game.relic_claim_pending WHERE relic_id IN (...)`. This differs from `0043`, which deleted pending Core claims; promotion is kinder because the player already did the work. Decide separately (10.3) whether the four held pets and `hub_life_medal` follow in the same migration.
- Steps: write the migration in `schema.ts`; remove the `held` set from A3; update the README Relic table. Side effects to expect and test: `game.owned_item_ids` (`0047`) and the pet catalogue derive from `relic_claim`, so promoted accounts also gain the Moonward Staff, Fighter's Might, President Pet and Fighter Pet at once.
- Tests: `server/test/dup/hold.ts` gains "after the unhold migration the grant is live" and "a pending row was promoted exactly once". **Needs `npm run test:dup`.**
- Acceptance: a fresh account finishing `quest_tutorial` receives the Shard at once; an account with a pending row owns the Relic after boot; `game.relic_claim_pending` has no rows for the two ids; `profile.get` lists them.
- Effort: S to M. Dependencies: decision 10.3.
- SDK CHANGE: no. SERVER DEPLOY: yes (one migration).
- ECONOMY RISK: no Tickets or Verse. Relics are forgeable by a crafted client for these two events, exactly as Cone's Tip and Tinubu's Crown are today. They unlock items in other games and the Four Lights pet; `effects.ts` strips gameplay parts in ranked sessions. The exposure is cosmetic status, not currency.

**B4. Let HPOS10I post its act time** (fixes F7)
- Goal: `hpos10i_act_time` receives scores from normal hub sessions.
- Change: in `SUBMIT_SQL` (`leaderboard.ts:134-135`) remove `hpos10i` from the list that answers `unranked`, leaving `sproto`. This is a string in the module, not a migration. HPOS10I already posts only Zone 1 Act 1 and already marks god mode. Alternative, not recommended: a ranked toggle at the gate (decision 10.5).
- Tests: `server/test/unit/leaderboard.test.ts`: an unranked `hpos10i` session is accepted; `sproto` still answers `unranked`. `npm run test:rt` covers boards against Nakama.
- Acceptance: a Zone 1 Act 1 clear from a hub-entered session appears on the Bar page; restore the page removed in A4.
- Effort: S. Dependencies: decision 10.5.
- SDK CHANGE: no. SERVER DEPLOY: yes (module only, no migration).
- ECONOMY RISK: none (boards credit nothing). Fairness note: with unranked posting, Relic gameplay perks from other games (for example Nobu skin, 1.05 speed) can apply on a board run. If that matters, HPOS10I should disable gameplay perks on Zone 1 Act 1 time-trial attempts; that is a game-repo change.

### Phase C. Give Verse a purpose

**C1. Ship the Verse store** (fixes F1; §R.11 step 5)
- Goal: a player buys an item from Sprotel with Verse and owns it on the account.
- Change, server: add `src/store.ts` to `tsconfig.json` `files` (after `pets.ts`, before `main.ts`); register `store.purchase` and a new read `store.catalog` (hub scope; returns `game.store_item` rows plus `owned`); migration `00NN_verse_store` with the tables, append-only trigger, seed and validator from `docs/m7-server-prep.md` and `HubStore.APPLY_SQL` as its last statement. The seed must stay 20 rows summing to 4,850 for the validator; set `on_sale = false` for items with no art (see C2).
- Change, client: a store panel that subscribes to `verseStoreUi.onOpenRequest` (`content.ts:624-640`), opened from Sprotel's "What are you selling?" topic: grid of items, price, owned state, balance, a confirm step. Payload `{ item_id, expected_price, idem_key }`. Handle `price_changed`, `insufficient_verse`, `already_owned`, `not_for_sale`.
- Steps: follow the wiring list in `docs/m7-server-prep.md` exactly; add `HubFault.apply` points `purchase.before_rpc` and `purchase.after_commit` (the store's SQL already has `game.fault_at` hooks); typecheck the 454 lines that have never been compiled into the bundle.
- Tests: `M7_FLOWS` rows in `server/test/dup/cases.ts` (`{ kind: 'purchase', defId, priceVerse }`) as `server/README.md` describes. **Needs `npm run test:dup`.** New `apps/hub/test/store.test.ts` for panel state.
- Acceptance: the launch-gate playtest in the launch plan §R.7 item 6 passes: earn, exchange in the hub, buy, see it owned after reload. A double purchase debits once. The audit queries in the prep doc return no rows.
- Effort: L. Dependencies: B1 (so every player can reach Verse), C2 for the item to be visible.
- SDK CHANGE: no for hub cosmetics. `InitResult.items` already carries the owned list to games (`types.ts:104`), so the game-side items in the seed (`nobu_body_hopium_bandana`, `duel_bolt_hopium_green`, two `duel_staffskin_*`) need code in NOBU and Sproto Duel but no SDK release. This differs from the launch plan, which listed `buyItem()` in SDK 0.7.0; a plaza-only call does not need to be in the SDK the games vendor.
- SERVER DEPLOY: yes (migration, new RPCs). Put it behind flag `verse_store` (already seeded off, `flags.ts`): `store.purchase` answers `not_for_sale` when the flag is off for that user.
- ECONOMY RISK: the first Verse sink. No refund or resale path exists. Server price is authoritative; `expected_price` only detects drift. Verse can come from client-reported Tickets (F21), so scripted accounts can afford cosmetics at 50 Verse per game per day; all 20 items are cosmetic with `effect` null, and the loader rejects any row with an effect.

**C2. Wear what you own** (§R.11 step 6)
- Goal: bought and earned cosmetics show on the avatar, to the owner and to others.
- Change: `loadout.set_hub` exists for the pet slot (`pets.ts:332`); storage hooks block direct client writes to `pets` and `loadout/hub` (`main.ts` `beforePetStorage`). Extend the hub loadout to slots `face`, `head`, `back`, `outfit`, `trail`, `title`, `nameplate`, validated against `game.owned_item_ids`; carry the equipped ids in the plaza `OP_PROFILE` message (today `{ character, staff, pet }`, `net/plaza.ts:203-204`; note the server now ignores the client's `pet` and reads equipment itself, and new slots must work the same way) and in the roster (`hub_match.ts:159`). Render in `avatar.ts` and `remotes.ts`. Add `loadout.ts` (per-game loadouts) to the build only when a game is ready to read it.
- Reality check: eleven pet models now exist under `apps/hub/public/world/v2/pets`, none of them the two store pets. No art was found for any of the 20 store items (unverified beyond a search of `apps/hub`). Launch the store with items that have art, and produce the rest following `docs/higgsfield-workflow-guide.md`.
- Settle F27 first: pets are sold for Verse through this store, and the reserved `ticketsPrice` field and `pet_buying` flag in `pets.catalog` stay unused, or the reverse. Recommendation: Verse only.
- Tests: `server/test/unit/hub_match.test.ts` (profile fields validated and length-capped), `server/test/dup/pets.ts` pattern for ownership checks, `apps/hub/test/net.test.ts` for the wire shape.
- Acceptance: two browsers on one shard see each other's equipped title and pet; an unowned id is ignored by the server.
- Effort: L (mostly art). Dependencies: C1; a single shard deploy since the roster shape changes (add fields, never rename).
- SDK CHANGE: no. SERVER DEPLOY: yes. ECONOMY RISK: none.

### Phase D. Onboarding and discovery

**D1. First-visit card** (fixes part of F12; the launch plan's G1 "hub first-session onboarding")
- Goal: within 10 seconds of arriving, a new player knows there are eight games, what a Relic is, and where to walk.
- Change: on first entry (no `hub:seen` key in `localStorage`, zero Relics) show a three-step card over the HUD: "Walk to a gate" (arrow to the nearest ring), "Win your first Relic there", "Come back: it lights a socket on the statue". Each step ticks from state the plaza already has (`inside` a ring; `profile.relics.length`). A "?" button in the HUD reopens it with a short Tickets, Verse, Relics explainer that uses the SDK constants so the numbers cannot drift.
- Tests: a pure reducer `onboardingStep(state)` in `apps/hub/test/`.
- Acceptance: a new guest sees the card; it never shows again after step 3 or dismissal; the controller can dismiss it.
- Effort: S to M. SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**D2. Gate markers** (fixes F12)
- Goal: every game is nameable from where you stand.
- Change: first check on a real GPU whether the new entrance signs (`buildings.ts:46`) read from spawn; if they do, this item shrinks to the Bar marker. Otherwise: HUD markers at the screen edge for the five entrances and the Bar, each with the game name and distance in metres, fading inside 20 m. Positions come from `PORTALS` and the Bar door. The Bar marker reads "Bar: Arcade · Fighter · Coop Battle". Optionally raise the per-gate label range (`livingPortals.ts` `LABEL_NEAR` 25, `LABEL_FAR` 40).
- Tests: projection maths as a pure function next to `overheads.ts`.
- Acceptance: from spawn, six labelled markers are visible at 1280×720; none overlaps the hint bar.
- Effort: S to M. SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**D3. Games tab** (fixes F12, F20)
- Goal: launch any game in two inputs, and make the menu's first page useful.
- Change: add a "Games" page as the first tab (keep Items, which now holds the controller setting, `menu.ts:237`): eight rows with name, one-line blurb, Relic owned or not, Tickets (from B1's `tickets.balances`), and Play. Play calls the existing `travel()` (`shell.ts:873`). Keep walking as the scenic route. People's Bitcoin goes through D5.
- Tests: `apps/hub/test/game-entry.test.ts` (rows resolve through `gameUrl`, "Coming soon" when a page is unset).
- Acceptance: Esc, Enter launches the last game played; all eight are listed.
- Effort: S to M. Dependencies: decision 10.1; B1 for the Ticket column.
- SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none; `portal.enter` is already limited to 10 a minute.

**D4. Return summary** (supports F14)
- Goal: coming back from a game shows what the trip earned.
- Change: before `window.location.assign` in `travel()`, store `{ game, relics, verse, at }` in `sessionStorage`. On a `#from=<game>` arrival, compare with the fresh `profile.get` and show a card: new Relic (and swing the camera to its socket), Verse gained, Tickets now held in that game (B1). If nothing changed, show the nearest goal: "Defeat Cone for Cone's Tip".
- Tests: a pure `tripSummary(before, after)`.
- Acceptance: earning Cone's Tip then returning shows the Relic card once.
- Effort: S. SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**D5. The 18+ confirm** (fixes F16)
- Goal: People's Bitcoin asks once per account or browser before launching.
- Change: read `mature` (`plaza/config.ts:13`) in `considerPortal()` and in D3's Play: open a small confirm ("18+ satire. Enter?") before `travel()`; remember the answer in `localStorage`.
- Tests: extend the dwell tests in `apps/hub/test/game-entry.test.ts`.
- Acceptance: the first entry asks; declining leaves you in the ring without re-triggering until you step out.
- Effort: S. SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**D6. Tell the player before a trip can cost a reward** (fixes F28; only once Shooter rewarded runs are on)
- Change: when `#from=sproto-shooter` arrives or a player stands in another entrance while a Shooter run is still being verified, show "Your Shooter run is still being checked. Entering another game now forfeits its reward." The plaza can learn this from `shooter.run.status` only with a game-scope session, so the simplest version is a flag the Shooter page leaves in `sessionStorage` on exit. Longer term, raise D01 again with the owner.
- Effort: S. SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**D7. Look settings** (fixes F26)
- Change: an "Invert vertical look" switch beside the stick setting (`menu.ts:237-246`), applied in `turnCamera` (`shell.ts:588`) for mouse, keys and pad; saved per browser like the stick choice.
- Tests: `apps/hub/test/camera-motion.test.ts`. Effort: S. SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

### Phase E. Plaza life and retention

**E1. Emotes** (fixes F10)
- Change: bind keys 1, 2, 3 (and a controller wheel) to `plaza.emote('wave' | 'dance' | 'cheer')`; subscribe with `plaza.onEmote` and play the clip on that remote and on yourself. Clips do not exist: either retarget three short clips onto the wizard skeleton through `rig/locomotion.ts`, or start with an overhead icon burst using `overheads.ts`, which needs no art. Server limit is one per second (`EMOTE_EVERY_TICKS` 10).
- Tests: `apps/hub/test/net.test.ts` (send and receive), `rig.test.ts` if clips are retargeted.
- Acceptance: two browsers see each other's emote within 300 ms on a local stack (**needs a running Nakama**).
- Effort: S for icons, M with clips. SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**E2. Sound** (fixes F9)
- Change: a small audio module (Web Audio, unlocked on the first input): one ambient loop outdoors, one in the Bar, footsteps tied to the gait phase, portal hum by distance, wipe whoosh, UI ticks, a Relic chime for D4. A volume slider and mute in the menu, saved per browser. Budget: under 1 MB total, loaded after the first frame.
- Tests: none automated beyond "module loads without audio support".
- Acceptance: muted by default until first input; no console errors with audio blocked.
- Effort: M (assets). SDK CHANGE: no. SERVER DEPLOY: no. ECONOMY RISK: none.

**E3. Real gate counts** (fixes part of F11)
- Change: new hub-scope RPC `hub.presence` returning `{ game: count }`. Source: live matches by label (`nk.matchList` for `pb_world`, `sproto_arena`, `sproto_coop`, `sproto_shooter_free`, `sproto_duel`, summing label `players`) plus open game sessions redeemed in the last 30 minutes for games with no match (`SELECT game_id, count(DISTINCT user_id) FROM game.game_session WHERE state = 'open' AND ticket_redeemed_at > now() - interval '30 minutes' GROUP BY 1`). Cache 15 s in `localcache` as scalars (contract C12). The client polls every 30 s and calls `living.setPresence`. The count is an estimate until the play lease in `docs/m11-single-active-tab.md` ships; label it "about N playing".
- Tests: `server/test/unit/` case with a fake `nk`; rate-limit check.
- Acceptance: with one account inside NOBU, the NOBU gate reads 1 within 45 s.
- Effort: M. SDK CHANGE: no. SERVER DEPLOY: yes (module only). ECONOMY RISK: none.

**E4. Hall of Champions roster** (fixes part of F11)
- Change: hub-scope RPC `hub.champions` returning the first 50 accounts that hold all four Four Lights Relics, ordered by the time of their fourth claim, names cleaned with `HubBoards.cleanRowName`. Client calls `hall.setChampions` once per visit.
- Tests: unit with fixtures; name cleaning.
- Acceptance: after B3, an account that completes the four appears in the Hall within one reload.
- Effort: S to M. Dependencies: B3. SDK CHANGE: no. SERVER DEPLOY: yes. ECONOMY RISK: none.

**E5. Leaderboards overhaul** (fixes F8)
- Change, server: `leaderboard.top` accepts `variant` for `shooter_story_clear_ms_v1` (the five boss ids) and `coop_stage_clear_ms_v1` (the twelve ids in `coop_rewards.ts:24`), rejecting anything else with `bad_variant`. Add server-written wins boards for Fighter (`fighter_wins`, from `sproto_duel.ts` `close` on a verified result) and Shooter free 1v1 (`shooter_wins`), using `HubBoards.recordWin`, which is idempotent per match; this needs a migration widening the `ranked_score_board` check. Change, client: Bar pages grouped by game with a title card; one Shooter page and one Coop page (fastest clear of the first boss, rotating); a `meta` page titled "Hub ranking". Also give each gate's board its game's top 10 from the same provider, replacing the stub.
- Tests: `server/test/unit/leaderboard.test.ts` (variants, bad variant); `npm run test:rt`.
- Acceptance: every game has at least one Bar page; a Coop clear appears within the 45 s cache.
- Effort: M. SDK CHANGE: no (the optional `getLeaderboard` already passes `variant`). SERVER DEPLOY: yes (one migration for the new boards). ECONOMY RISK: none.

**E6. Daily cross-game bonus** (fixes F14)
- Change: a "Tour" paid in Verse by the server, once per UTC day: when an account has earned Tickets in three different games that day (three distinct `tickets:<game>` rows in `game.earn_window`), credit 10 Verse; five games, 10 more. New table `game.tour_claim (user_id, day, tier)` with a primary key; a hub-scope RPC `tour.status` returns progress, and `tour.claim` pays through a function that writes `verse_ledger` with `source = 'tour'`. Show progress in the D3 Games tab and in D4.
- Tests: dup cases for `tour.claim` (replay, race, day rollover). **Needs `npm run test:dup`.**
- Acceptance: three games in a day pays 10 Verse once; replays pay nothing.
- Effort: M. Dependencies: B1, C1 (otherwise the Verse has no use), decision on amounts.
- SDK CHANGE: no. SERVER DEPLOY: yes (migration).
- ECONOMY RISK: **a new Verse mint**, 20 a day per account at most, about 7.5% of the post-B ceiling. Earning "in a game" can be forged in client-reported games (F21), so a scripted account collects it; the primary key bounds it at 20 a day. Consider requiring one of the three to be a verified game (Coop, Shooter, People's Bitcoin).

**E7. Account level** (fixes F14)
- Change: a level derived from lifetime Verse earned (`game.verse_earned`, already stored): no new currency and no new table. Proposed thresholds 0, 50, 150, 300, 500, then +250 per level. Show it on the name tag and in the menu; each level can unlock one free title from a small list (titles as `item_owned` rows with `source = 'level'`).
- Tests: a pure `levelFor(lifetime)` shared by client and a server unit test.
- Acceptance: level changes are visible to others on the shard within one roster update.
- Effort: S to M. Dependencies: C2 for titles. SDK CHANGE: no. SERVER DEPLOY: yes if titles are granted. ECONOMY RISK: none (titles are free cosmetics).

## 7. Work the game repos must do for the loop to close

File names come from reading each repo at its current checkout.

### 7.1 Sproto Fighter (checked at `d1a1d9c6`)
- Still true: `planFighterWin` (`src/hub/report.ts:39-53`) sends `earn 20 fighter_win` for every CPU win, which the server refuses.
- Changed in Fighter #52: the Relic event is now sent after defeating Halloween 2008 (`BELT_OPPONENT = 'zephyr'`, `src/hub/config.ts:17`; `beltVictory` in `src/main.ts:173`). It is still `fighter.story_level_complete` with `{ world: 1 }`, so the server rule matches and the grant is still **held**; the player gets nothing until B3.
- Do: stop sending `fighter_win` (`WIN_REASON`, `TICKETS_PER_WIN`, `config.ts:9-11`). For a story win against one of the ten bosses the server lists (`sproto3215`, `sproto2616`, `sproto3152`, `rivet`, `sproto865`, `sproto943`, `nick`, `guest07`, `vela`, `vaudream`), send `reportEvent('fighter.boss_defeated', { boss, world, stage }, key)` with a key that is stable per win. `main.ts` already knows `encounter.opponent`; pass it into `FighterWin`. Read `tickets` from the event result for the toast.
- The server's ten ids do not include `zephyr`, the opponent Fighter now treats as its milestone. Decide with the owner whether the list still matches the story (`src/campaignRoster.ts`, `src/storyProgress.ts`); if not, the hub needs a migration that upserts the boss rows. Say so in the Fighter PR.
- No simulation change (`SIM_VERSION` is still `a4c7ddde49ec5a64`), so no re-vendor.

### 7.2 Sproto Shooter (checked at `d8596be`)
- The client work this plan first asked for is done: `src/hub/campaignRewards/` (`controller.js`, `recorder.js`, `transport.js`, `uiFlow.js`, `presentation.js`) with docs in `docs/shooter-reward-ui.md` and `docs/shooter-reward-recorder.md`. It shows the rules (20 per boss, 200 per session, 1,000 per day, the session must still be live at payment) before Start.
- What still stands between a player and 20 Tickets, all owner gates recorded in `docs/shooter-verification/decisions.md` and `execution-ledger.md`: (1) build the game with `VITE_SHOOTER_REWARDED=true`; (2) host the replay worker and register its key; (3) apply migrations `0050` to `0058` in production; (4) enable the admission, scheduler, gateway and payment configuration and enrol accounts in the cohort (enrolment is permanent per account); (5) measurements on the intended host. None of that is in this plan's power, and the launch record keeps Shooter dark.
- Cheaper interim, if the owner wants Shooter Tickets before the worker exists: a version 1 client path (`shooter.run.issue` then `shooter.run.submit`) limited to the short bosses. Not recommended: `docs/two-game-release.md` records that a Sahil clear misses the 15 s budget and goes unpaid.
- For the plaza: D6, and add `shooter_pvp` wording to the game's lobby (F24).

### 7.3 Sproto Arcade, Sproto Coop Battle
- Neither has an exchange screen (`Sproto-Arcade/hub-link.js`, `Sproto-Coop-Battle./public/js/hub-link.js`). Recommendation: do not build one. Rely on the hub Wallet tab (B1) and show one line in the game's hub chip: "Exchange Tickets in the plaza menu". `hub-link.js` is not one of Coop's four pinned files, so that line costs no re-pin.
- Arcade (`936f939`) now reports the Breakwater Coin event on every first-boss win, not only until the local cache has it (`hub-link.js:237-247`); the server grants once. It still sends `arcade_clear` 20 per clear, now skipped for checkpoint clears (`:251`). Consider a per-level-per-day rule for `arcade_clear`; that is a server rule change and an owner call.

### 7.4 HPOS10I
- B4 makes the server accept its unranked post; no game change is required. `src/hub/hub_client.ts:263-266` already posts only Zone 1 Act 1.
- Optional: disable gameplay perks from Relic items on that act (`src/hub/relic_loadout.ts`) so the board is like for like.
- Its Tickets become exchangeable through B1 if decision 10.2 allows it.

### 7.5 NOBU, Sproto Duel, People's Bitcoin
- NOBU and Duel: read `InitResult.items` to apply the store cosmetics that belong to them (C1). No SDK change. Duel already does this for its Relic staves (Alien Ray, Shooter, Fighter; hub `0047`, `sproto_arena.ts` staff list).
- People's Bitcoin: re-sync `vendor/hub-sdk` for the Campaign Pistol row (§5.1) and update `tests/sdk-hash.test.ts`.
- People's Bitcoin: nothing required for the loop. If decision 10.3 chooses verified grants, the hosted world could report the tutorial quest itself (as Coop does through `StageRelics.grantCoopClear`), which is a sim change and joins §8.
- Duel: at most 10 Verse a day. If that is too low, the fix is a server rule (for example pay 5 Tickets per online win, server-written), not a client change.

## 8. Re-vendor queue

Six game audits recommend simulation changes. What each costs here:

| Game | Change proposed there | Hub files | Constants | Check | Who is refused on mismatch |
|---|---|---|---|---|---|
| Sproto Coop Battle | grab release, fail-state fixes, human-count scaling (changes `contentSha256`) | `server/modules/vendor/coop-sim.js`, `coop-sim.pin.json` | `CoopProto.COMMIT`, `BUNDLE_SHA256`, `FINGERPRINT` (`games/coop_protocol.ts:43-46`), `CoopRewards.FINGERPRINT` (`coop_rewards.ts:18`) | `node scripts/check-coop-sim-version.mjs` (in `ci.yml` and `coop-sim-version.yml`) | clients get `version_mismatch` when `contentSha256` differs |
| Sproto Shooter | campaign collision and content, gun and Second Wind rebalance | `shooter-sim.js`, `shooter-sim.pin.json`, `shooter-pvp-sim.js`, `shooter-pvp-sim.pin.json` | `ShooterRewards.COMMIT`, `BUNDLE_SHA256`, `FINGERPRINT` (`shooter_rewards.ts:16-18`); `ShooterProto.COMMIT`, `BUNDLE_SHA256`, `FINGERPRINT`, `LOADOUT_HASH`, `CAMPAIGN_FINGERPRINT` (`shooter_protocol.ts:30-36`); the `FINGERPRINT` constant in `scripts/check-shooter-sim-version.mjs` | `check-shooter-sim-version.mjs` (now also checks the incremental replay API versions in the pin), `check-shooter-pvp-sim-version.mjs`; `scripts/revendor-shooter-pvp.mjs <sha>` regenerates both bundles; workflow `shooter-pin-artifacts.yml` produces the reviewed pins in Actions | free 1v1 HELLO is rejected on protocol, sim or content; run submits fail on fingerprint |
| Sproto Fighter | CPU fixes | `sproto-sim.js`, `sproto-sim.pin.json` | none in TypeScript: `SPROTO_SIM_VERSION` is in the bundle header | `check-sproto-sim-version.mjs` (`sproto-sim-version.yml`) | `sim_mismatch` cancels the duel |
| People's Bitcoin | tutorial and economy data | `pb-sim.js` | none: `PB_SIM_VERSION` is in the bundle header | none (no pin, no check; the launch plan's hub item 9) | `KICK sim_mismatch` on HELLO |
| Sproto Duel | mana economy, spell rebalance | none: `duel-sim.server.js` is not vendored | only if `NET_VERSION` ("2", `sproto_arena.ts:17`), the staff list (`:70`) or round rules (`ROUNDS_TO_WIN` 2, `MIN_ROUND_S` 2) change | none | a `NET_VERSION` change refuses old clients |
| Sproto Arcade | pickup and barrage retiming | none: `arcade-sim.server.js` is not vendored | none | none | nobody |

**Where each pin stands at `38905d4`** (read from the checkouts beside this repo; CI was not run).

| Game | Hub pin | Game `main` | In step? |
|---|---|---|---|
| Sproto Coop Battle | commit `9a0b5d9`, bundle `28f9236d…`, content `f8705ec4…` | `ae9dd75`; its `build/coop-sim.pin.json` has the same two hashes | yes |
| Sproto Shooter | commit `7960d85`; campaign fingerprint `cea1f88b`; PvP content `b33eada6`, loadout `4cdfab55`, protocol 2, sim 2 | `d8596be`, 29 commits ahead, none under the sim paths | yes, by the path rule |
| Sproto Fighter | `65ed5db`, sim `a4c7ddde49ec5a64` | `d1a1d9c6`; `src/net/simVersion.ts` has the same version | yes |
| People's Bitcoin | sim `9a8fb62cbbc73f39` (hub #147) | `3597574`; no commit under the hashed paths since the price change `788c0b8` | yes, by path |

So every re-vendor below is future work caused by the game plans, not a backlog.

**One trap, read from code.**

1. **Fingerprints inside migrations (F22).** `game.settle_coop_clear` compares the fingerprint to a literal in the SQL of applied migration `0041`. Applied migrations are checksummed; editing one makes Nakama refuse to boot (`schema migration checksum mismatch`). A Coop `contentSha256` change therefore needs **a new migration that rewrites the live function**, exactly as `0048_shooter_campaign_fingerprint` did for Shooter: read the function with `pg_get_functiondef`, `replace` the old literal with the new, `EXECUTE`. The literal appears twice in the Coop function (`coop_rewards.ts:236`, `:342`). Without it, clears settle as `bad_version` and pay nothing. Update the fingerprint in `server/test/dup/coop_rewards.ts`, `server/test/games/coop_rewards.test.ts`, `coop_match.test.ts` and `stage_relics.test.ts` in the same PR, and run `npm run test:dup`. Shooter needs the same migration again whenever its campaign fingerprint moves from `cea1f88b` (a collision or content rebalance will move it), plus `shooter_match.test.ts` and the constant in the check script.
2. **Shooter's dormant version 2 pipeline pins more than the bundle.** The worker manifest, corpus inputs and client-test pin under `server/test` and the `shooter-verification-*` workflows name exact Shooter commits (`docs/shooter-verification/execution-ledger.md`). A Shooter sim change will need those fixtures regenerated through the same Actions lanes; budget for it, and expect the campaign rebalance to invalidate recorded corpus runs.

**Steps for one game** (Coop as the example): merge the sim PR in the game repo; build there (`npm run build:server-sim`); copy bundle and pin into `server/modules/vendor/`; update the constants; add the settle migration if the content fingerprint moved; run the check script, `npm test`, and `npm run test:dup` and `npm run test:rt` against Nakama; open the hub PR.

**Sequencing to keep CI red briefly and clients matched.**

- **One sim merge per game.** Each game collects its sim changes on one branch and merges once. Shooter matters most: its bundles change with every merge to its `main`, so five small merges are five hub re-vendors.
- **Prepare the hub PR before the game merges.** Build the bundle from the game branch head and open the hub PR as a draft. If the game merges by fast-forward or merge commit the commit id is already final; with a squash merge, rebuild from the merged commit (for Shooter, `revendor-shooter-pvp.mjs` does this). Hub CI is then red only for the minutes between the game merge and the hub merge.
- **Hub `main` may run ahead of production.** Merging the hub PR does not change what players run. Do not deploy a game's new web build until the hub server carrying the matching bundle is deployed.
- **One server deploy for the whole queue.** Order on the day: merge the four vendored games' sim PRs, merge the four hub re-vendor PRs (or one combined PR), the owner runs `deploy/scripts/deploy-server.sh` once (it now uses the maintenance drain: new matches are refused while live ones finish), then `deploy-game.sh` for each game immediately after. Mismatch is then limited to tabs that were already open; each game should answer a mismatch with "New version: reload".
- **Order within the queue:** Fighter (no constants), People's Bitcoin (no check), Coop (needs the settle migration), Shooter last (most constants, two bundles, a settle migration when campaign content changes, and the version 2 fixtures). Shooter's reward work is still landing; merge its gameplay sim PR when no verification PR is open, or the two will fight over the same pins.
- **Duel and Arcade** deploy on their own schedule with no hub step, unless Duel bumps `NET_VERSION`.
- **People's Bitcoin** saves characters (`pb_character/main`); a data change that alters saved state needs its own compatibility note in that repo. Add `pb-sim.pin.json` and a check script in the same pass.

## 9. Suggested order and PR batching

| Step | Contents | Repos | Deploy |
|---|---|---|---|
| 1 | A1, A2, A3, A4 as four small PRs, one branch each (`<agent>/<slug>`) | hub | hub client only |
| 2 | D1, D2, D5, D4 | hub | hub client only |
| 3 | B4 and E5's `leaderboard.top` variants (module only), then B3 | hub | server |
| 4 | Fighter boss events (§7.1) with B2's tests. Shooter rewards are an owner activation (§7.2), not a PR | Fighter, hub | game build |
| 5 | B1, then D3 (Games tab uses its balances) | hub | server, then hub client |
| 6 | The re-vendor queue (§8) as one train | six games, hub | one server deploy, then game builds |
| 7 | C1 behind `verse_store`, C2 for the items that have art | hub, then NOBU and Duel | server |
| 8 | E1, E2, E3, E4, rest of E5 | hub | server for E3 to E5 |
| 9 | E6, E7 | hub | server |

Notes. Migrations must merge and deploy in id order; reserve ids in `docs/migration-allocations.md` when each PR opens. `docs/two-game-release.md` keeps Coop Battle and Shooter dark and names missing staging and HTTPS as blockers, so every "deploy" below waits on that owner decision; the hub-client steps do not. Steps 1 and 2 touch `shell.ts`, `menu.ts` and `content.ts`; per `AGENTS.md`, do not run two of those PRs at once on the same file. Step 6 should not overlap step 5 or 7, so a red check has one cause. Enable flags by the progressive steps in the launch plan §R.12.4.

## 10. Decisions for the owner

**10.1 Launcher or hangout?**
- Launcher: do D3 first, keep E to the cheap parts (E1 icons, E2). Cost: about a week. The plaza stays a pretty menu.
- Hangout: do E1 to E5 and a friends and invite system (not planned here; L or more). Cost: several weeks plus moderation load.
- Recommendation: both, in that order. D3 costs little and removes friction for returning players; the hangout work is only worth it once Verse has a use and shards have people in them.

**10.2 Per-game Ticket wallets or one wallet?**
- Keep per-game (B1 as written): no data migration, wagers stay inside one game's economy, the 50-per-game cap keeps rewarding breadth. Cost: the Wallet tab has eight rows.
- Merge into one: simpler to explain, but it rewrites every earn, wager and shop function, lets NOBU Tickets fund Fighter wagers, and needs a balance migration.
- Recommendation: keep per-game. Also allow HPOS10I to exchange, which the owner already answered "Yes" to in the launch plan §R.6.

**10.3 Do the two held Relics wait on verification, or only on a migration?**
- Migration only (B3): a day of work; the grants stay forgeable, like two of the live Relics.
- Verification first: People's Bitcoin could report the tutorial from its hosted world (a sim change, §8); Fighter's story has no server sim, so the Belt would wait for one. Cost: weeks, and the Four Lights stay closed meanwhile.
- New since the first audit: the owner accepted "server-verified legal inputs, including bots" for Shooter rewards (2026-11-11, `docs/shooter-verification/decisions.md`). That is a statement about verified play; it does not by itself say unverified client reports are acceptable for Relics.
- Recommendation: migration now, promoting pending claims. Verify People's Bitcoin later if abuse appears. Release the four held pets in the same migration; leave `hub_life_medal` held if it gates the Hatchery.

**10.4 Verse for hub cosmetics only, or in-game items too?**
- Hub only: C1 and C2 stay in this repo; no game work.
- In-game too: four of the 20 seed items belong to NOBU and Duel; each game adds code to read `items`. No SDK release either way.
- Recommendation: launch hub-only with the items that have art; keep the four game items `on_sale = false` until those games ship support.

**10.5 Ranked entry in the plaza?**
- None (B4 as written): HPOS10I posts unranked; "ranked" stays a server concept used only by tests.
- A toggle at the gate: honours the original design (Relic perks off in ranked) but adds a choice most players will not understand, and `sproto_wins` does not need it.
- Recommendation: no toggle. If like-for-like times matter, HPOS10I turns perks off on its board act.

**10.6 How are pets sold?** (new, F27)
- Verse through the store (C1), or Tickets through `pets.catalog` and `pet_buying`. Tickets are per game, so a Tickets price needs a choice of wallet or B1's wallets merged.
- Recommendation: Verse only; leave `ticketsPrice` at 0 and the flag off.

**10.7 Shooter rewards: wait for the worker, or pay short bosses through version 1 now?** (new, F5)
- Recommendation: wait. Do not add a second client path that fails on long clears.

## 11. How to verify the changes improved play

**Checks that run without a server.** `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. The geometry check in A1. A walkthrough of `docs/plaza-baseline.md` on a real GPU: this is the first time movement, camera and frame rate will have been judged, since this audit could not.

**Checks that need Nakama from `server/docker-compose.yml`.** `npm run test:dup` after B1, B3, C1 and E6, with `audit.sql` returning no rows. `npm run test:rt` after B4, E3 and E5. Two-browser checks for E1, C2 and D4. The launch plan's 30-minute loop (earn, exchange in the hub, buy, equip, see a Relic benefit) is the acceptance test for Phases B and C together.

**Checks only production can answer.** Whether held rows exist to promote (`SELECT relic_id, count(*) FROM game.relic_claim_pending GROUP BY 1`). Whether anyone holds Fighter Tickets from before `0031`. Whether the hub-entered HPOS10I board is in fact empty. The owner runs these; this plan only names them.

**Numbers to watch before and after**, all from tables that already exist:

| Question | Query source |
|---|---|
| Do players reach a game? Sessions opened per day, by game | `game.game_session` |
| Do they play more than one? Distinct games per account per week | `game.game_session` |
| Does the economy connect? Accounts with Tickets but no Verse; exchanges per day by game and by RPC | `game.tickets_balance`, `game.exchange_tx` |
| Does Verse get spent? Purchases per day, share of accounts with at least one | `game.store_purchase` |
| Do Relics move? Claims per day by Relic; accounts with all four | `game.relic_claim` |
| Do people come back? Accounts with sessions on two or more days in a week | `game.game_session` |

Targets to agree before starting: the share of accounts that open a second game in their first week, and the share holding at least 1 Verse. Record the baseline first.

## 12. Not audited / out of scope

- Gameplay inside the eight games (their own plans cover it).
- Real-GPU performance, movement and camera feel, and every multiplayer behaviour (presence, chat delivery, reconnect).
- Production data, production configuration, Cloudflare, backups and deploy scripts beyond naming them.
- Security review. The launch plan §R.2 covers the known issues; this plan only notes exploit surface where it touches currency.
- Mobile and touch (the hub is desktop only by design).
- Accessibility beyond what A1 fixes.
- Art and audio production; C2, E1 and E2 depend on assets that do not exist yet.
- The sandbox realm, Sims, and the V Coin, Hatchery and quantum-door gates in `hub_gate.ts`.
- Friends, parties and invites: noted in F15, not planned.
