# State machines and full audit: plan for all 9 repos

> **Revision 4 (second round of owner decisions applied). Read §R first.**
> - §R.6 records your decisions.
> - §R.7 is the final wave plan.
> - §R.8–R.11 are the launch tracks: Shooter PvP (low-latency netcode, wagers, rooms, rematch, leaderboard), zero-kill deploys, the Diagnostics setting, and the economy loop.
> - §R.12 is the rollout: branches, release trains, flags, staging and progressive enablement.
> - The body (§0–§3) is the backlog. §R.1 corrects it.

## R. Review changes and owner decisions (Revisions 2–4)

An independent reviewer audited this plan, and I re-checked each of its key points in the code (✔ = re-verified by me).

### R.1 Corrections to the body

| Item | Was | Now | Evidence |
|---|---|---|---|
| Fighter tripwire (§0) | "any `src/sim` edit, even comments" | the esbuild output of `serverEntry.ts`'s import graph; comments don't count, but renames, moves and `src/net/*` do | ✔ `build-sim-bundle.mjs:19-26` |
| Bug #5 Coop circular pin | High | **Low–Med, a developer-loop gap only.** Hub CI already compares the vendored pin with Coop `main` on every PR, on every push and daily, and the behaviour goldens still guard semantics. | ✔ hub `ci.yml:30`, `coop-sim-version.yml` |
| Bugs #3/#4 Shooter PvP latency and rejoin | W1, player-facing | **Latent.** The hub registers no Shooter PvP match, only `shooter.run.*` RPCs. Moved to a "before PvP launch" gate. The latency trigger is round-trip time, not one-way delay. Rejoin edits pinned `director.js`, so it is a pin bump plus a hub re-pin, not a client-only fix. | ✔ hub `main.ts:279-282` |
| Bug #16 Arcade checkpoint save | bug | **Probably deliberate.** A checkpoint run skips phase 1, so not recording the clear prevents cheap clears. Kept only as owner decision 1. | `game.js:515` |
| S3 "add `check-sproto-sim-version` to hub `ci.yml`" | needed | **Redundant.** `sproto-sim-version.yml` already runs on push, on PR and daily. Removed. | ✔ |
| Bug #8 ledger index | bug | **Performance item.** Balance and daily cap are primary-key reads; only session-cap and wager sums scan. Also add **`UNIQUE(event_id)`** on `tickets_ledger`, which other ledgers have and this one lacks. | ✔ `schema.ts:62,79` vs `96-106` |
| HPOS10I coyote-time assist | proposed | Contradicts `docs/PHYSICS.md:6` ("no coyote time, no input buffering"). **Owner decision only.** | |
| PB: move `assets.manifest.json` | proposed | DESIGN §1, the source of truth, places it there. The owner must amend DESIGN first. | |
| Bug #23 stale SDK | per game | **Crosses games.** All games share the `hub-outbox` IndexedDB on one origin, so a row refused for one game can block `init` in any game on SDK ≤0.6.0. | |

### R.2 Severity re-ranking: two security/economy bugs come first

1. **Duel `innerHTML` injection is a cross-game session risk, and it needs a server fix too.**
   - The hub's own `sanitizeName` is applied only in the plaza shard (`hub_match.ts:90,215`).
   - The arena match copies `presence.username` with only `.slice(0, 32)` (`games/sproto_arena.ts:451,471`), and so does the Fighter duel (`sproto_duel.ts:317-318`). ✔
   - All games share one origin, where hub session tokens live, so script in a name could reach every game's session.
   - **Fix:**
     - escape on the client in every game that renders server strings
     - apply `sanitizeName` to every server-side name map (arena, Fighter duel, coop)
     - validate usernames at account create and update (owner decision R4-1 about existing names)
2. **PB sell clamp is a Ticket mint from the normal UI.** No crafted client is needed: Sell-10 on 1 item credits 10, bounded only by the 200-per-call `pb_sell` rule and the daily cap. **P0 hotfix.**

### R.3 Gaps added

- **Missed state machine: Fighter duel wager escrow.** `held|settled|refunded`, but crashed-match expiry runs *only* when the next pair is matched (`sproto_duel.ts:315`) ✔. After a Nakama restart, escrowed Tickets stay held until someone else queues. **Fix:** run `sproto_wager_expire` from `maint_sweep` or the plaza match loop.
- **Retention sweeps could re-open double payment.** SDK outbox rows on dead sessions persist indefinitely (`live.ts:362-368`). A row replayed after its idempotency record is swept would pay twice. **Fix:**
  - the SDK drops rows older than the window minus a margin
  - the sweep ships only after every game runs that SDK
  - `UNIQUE(event_id)` on the ledger
- **No safety net after deploy.** (Revision 3: the telemetry and drain parts are now designed in §R.9 and §R.10.) None of the 9 repos has client error telemetry, feature flags or a deploy drain. A hub deploy restarts Nakama and kills live Coop, Arena and wager matches, and backups stay on the same host. **Add to W0:**
  - an additive, rate-limited `client.report` RPC that the new crash panels call
  - a `game_flags` table read by `open_portal` and the match handlers, as a kill switch
  - a deploy runbook: notice, drain, then migration → module → games
  - off-host backups
  - a rollback line on every ticket
- **More missed state machines, added to the backlog:**

  | Area | Where |
  |---|---|
  | `maint_sweep` piggybacks on RPC traffic, with no scheduler | `rpcs.ts:163-165` |
  | Account and username flow | `apps/hub/src/auth.ts:143-196` |
  | PB player trade: disconnect during confirm, a classic item-duplication spot | `server/trade.ts:84,156-235` |
  | Page lifecycle: no repo handles `webglcontextlost`; Arcade, Shooter and the plaza have no `visibilitychange` | all repos |
  | Audio unlock and suspend: each game does it differently | all games |
  | Pointer lock | Shooter `input.js:29-41` |
  | Fighter and Coop matchmaking tickets | hub `games/*_matchmaking.ts` |
  | Other hub match handlers | `pb_world`, plaza shards, realms |
  | Deploy pipeline | release symlink plus the previous 3 releases |

- **Measures, so each wave can be closed on numbers:**
  - hub event counters: linked vs standalone sessions, init failure rate, refused-write rate, crash reports per 1,000 sessions
  - DX: time from a fresh checkout to green checks
  - AX: green CI on an agent's first PR, and merge-conflict count
- **A gameplay track (G).** The plan was about 85% hygiene. Add one playtest-led improvement per game, gated by events:
  - Coop: solo balance (a CPU-only team loses on stage 1)
  - Duel: gauntlet checkpoints
  - nobu: faster retry and hitstop
  - Fighter: sound effects
  - hub: first-session onboarding
  - all: what Tickets and Relics *buy*, with visible receipts. S11 moves earlier.

### R.4 Pattern change (replaces §0 rule 6)

The real defects are mostly **stale async continuations** and **orthogonal states** (paused × online, screen × role), not missing enums. A flat `allowed[from]` table explodes in size. The pattern is now:
1. A **generation token or AbortController** for every async lifecycle (connect, load, transition), checked after each `await`.
2. **Nested unions** for orthogonal dimensions, instead of one flat enum.
3. **onEnter/onExit** effects that own pointer lock, audio, timers and the HUD.
4. **Illegal transitions assert in dev** and count to telemetry in production.
5. Hand-rolled, with no XState. XState doesn't fit goja/ES5 sims or the classic-script repos.
6. **Don't convert machines that are already explicit and stable** just for uniformity: Arcade's `World.state`, Shooter's wave director, PB trades, Fighter's story save, nobu's chaser.

### R.5 Process for 4 concurrent agents

- **One GitHub issue per ticket**, using the template below. Its "Touches" field lists files, and one agent at a time holds a hotspot file through a `lock:<file>` label.
- **Hotspots:**

  | Repo | Files |
  |---|---|
  | hub | `schema.ts`, `main.ts`, `test/dup/*` |
  | nobu | `session.js`, `game.js` |
  | Duel | `App.ts`, `config.ts` |
  | Arcade | `game.js`, `index.html`, `legacy.html` |

- **Splitting `schema.ts` moves to "quiet window or never".**
- **Freeze Arcade refactors and version bumps** while its AGENTS.md "current priority" (boss-art production) is active.
- **Owner instructions stay with the owner.** Edits to AGENTS.md and DESIGN.md are batched into one owner-approved PR per repo. PB's `TODO.md` and `DECISIONS.md` are updated as its AGENTS.md requires.
- **A test that pins behaviour merges as its own PR before the change it guards.** Every ticket names its guard: `golden | unit | e2e | playtest`. Changes to feel need a 10-minute human playtest checklist that the owner signs off.

```
ID: <repo>-<wave>-<n>   Owner agent: <claude|codex|cursor|grok>   Reviewer: <different agent>
Problem / evidence: file:line, ✔/traced
Touches (exclusive): <files>   Hash/pin impact: none | SIM_VERSION | pin <id> → hub refresh PR #
Guard (merged first): golden | unit | e2e | playtest checklist
Owner decision needed: <none | #n>
Done when: checks green + <metric/assertion> + CHANGELOG/DECISIONS updated where required
Rollback: revert PR | release symlink | flag off   Hub restart needed: y/n
```

### R.6 Owner decisions: resolved (2026-11-08)

| # | Question | Owner answer | What it means for the plan |
|---|---|---|---|
| 1 | Force-rename unsafe usernames? | **No** | Never rename an account. Unsafe names are sanitized wherever they are *shown*:<br>• every game escapes server strings<br>• `HubMatch.sanitizeName` is applied in every server name map (arena, Fighter duel, coop, shooter PvP)<br>Only names created or changed from now on are validated. |
| 2 | Shooter online 1v1 at launch? | **Yes, at launch** | Shooter PvP moves out of "gated" into the launch track. Full plan in §R.8. |
| 3 | Telemetry? | **Yes, but as a player setting** | A "Diagnostics" setting with two switches, both **off** by default. Design in §R.10. |
| 4 | May a hub deploy kill live matches? | **No** | Zero-kill deploy with a drain. Design in §R.9. |
| 5 | PB spread and `pb_sell` limit; timed wager-escrow expiry | "Keep it if necessary" | The **PB spread and limit question is deleted**: current values stay. The **timed escrow refund is kept**, because it fixes Tickets stuck after a crash. It is part of §R.9 step 5. |
| 6 | What are Tickets and Relics for? | **Tickets are traded for Verse, the in-game currency that buys items. Relics are earned in one game and give benefits in *other* games.** | The economy loop becomes a launch track (§R.11). Today Verse can't be spent, and half the Relics can't be earned. |

**Second round of answers (2026-11-08):**

| # | Question | Answer | Effect |
|---|---|---|---|
| 1 | Lag compensation for Shooter PvP | **Do it now, with an architecture built for online play and no lag** | §R.8 is rewritten: prediction, reconciliation, adaptive interpolation, lag compensation, binary 30 Hz snapshots, a netcode test harness |
| 2 | Room codes, rematch, leaderboard | **Yes to all three** | In §R.8 (H4/S4) |
| 3 | Shooter PvP rewards | **Ticket wagers, like Fighter** | Generalized escrow, from the Shooter Ticket balance (§R.8). *Note: Arcade has no wager system in code, so Fighter's escrow is the model.* |
| 4 | Release the held Relics | **Yes** | §R.11 step 2, behind flag `relic_unhold` |
| 5 | HPOS10I Tickets → Verse | **Yes** | §R.11 step 3 |
| 6 | Server ops metrics without the setting | **Yes** | Loop timing and counts, with no per-player data |
| — | Rollout | **Better than a single branch** | New §R.12: per-ticket branches, release trains, flags, staging, progressive enablement |

**Defaults now in the plan.** Each is a recommendation; overrule any of them.
- **Shooter wagers:** stake 10 Tickets; daily net-win cap 200 (as Fighter).
- **What a wager pays on:** a time win (higher HP and shield) pays out; a draw is refunded; leaving after the 10 s grace forfeits and pays the opponent.
- **Crits:** off in PvP.
- **Private rooms:** free only, no wagers.
- **Wagered play:** RTT cap of 150 ms.
- **Leaderboard:** public wins board plus Elo.
- **Sim rate:** 30 Hz at launch.

**Still open from Revision 2:**
- Freeze Arcade refactors during boss-art production?
- Who may edit AGENTS.md and DESIGN.md?
- Are accessibility settings must-haves?
- May the plan doc be committed to this session's branch, and may agents create one branch per ticket? This is needed for §R.12.

### R.7 Final waves (replaces §4 and the Revision 2 MVP)

**Launch** means the hub goes public with every game linked, Shooter PvP live, deploys that keep live matches, the Diagnostics setting, and a working Tickets → Verse → items + Relics loop.

**hub-sdk releases: only two re-vendors in total.**

| Release | Contents |
|---|---|
| **0.6.3** (W-1) | the urgent fixes: zombie socket, `deadSession()` in `init`, drain filtered to the game's own outbox rows |
| **0.7.0** (W1) | everything launch needs, all optional or additive:<br>• Diagnostics: `diagnostics()`, `installCrashReporter()`<br>• economy: `verse` in `InitResult`, `granted_items` passed through, `buyItem()` (hub only), and the `economy.ts` contract<br>• maintenance: `onMaintenance()`<br>• hub link: `HubLinkState` and per-write status<br>Shooter PvP needs **no** SDK change. |

| Wave | Tracks (parallel unless noted) |
|---|---|
| **W-1 Hotfix (~1 week)** | • PB sell clamp<br>• display-time name sanitizing: client escaping in every game, plus `sanitizeName` in the arena, Fighter duel and coop name maps<br>• Nakama `stop_grace_period: 90s` and `shutdown_grace_sec: 60`<br>• escrow refund at boot and on a periodic sweep<br>• empty-server-key build guard<br>• nobu outbox game filter<br>• **arena staff ownership check** (§R.11 #8, a live PvP exploit)<br>• `server_flags` table (with an allowlist and a percentage per flag), so all launch work can merge dark<br>• staging stack (§R.12.3)<br>• SDK 0.6.3 → one re-vendor of the 6 stale games |
| **W0 Nets** | • crash-proof loops and "Something broke" panels in all 8 games (they report only once Diagnostics exists)<br>• Fighter golden-hash fixture<br>• Coop committed-pin test<br>• CI typecheck gaps<br>• nobu lint<br>• docs batch: hub `CONTRACTS.md`, AGENTS.md for Shooter and Coop<br>• Shooter netcode test harness (S0) |
| **W1-A Shooter PvP (critical path)** | §R.8: S0 → S1 → S2a → S2b → H2 → H3 → H4 → L; H1, S3, S4 and H5 in parallel |
| **W1-B Zero-kill deploys** | §R.9 steps 2–8 |
| **W1-C Diagnostics setting** | §R.10, shipped in SDK 0.7 |
| **W1-D Economy loop** | §R.11 steps 1–9, with SDK 0.7. The store is the largest item. |
| **W2 Live flow bugs** | • Duel: `stopSim`, KO pause<br>• Coop banked leave confirm<br>• nobu: no pause while busy, plus a `leaving` state for fades<br>• Fighter desync display<br>• PB kick overlay and dialogue latch<br>• HPOS10I Restart rule (after decision)<br>• hub stale `chatRoom` |
| **G1 Gameplay (playtested)** | one item per game:<br>• Coop solo balance<br>• Duel gauntlet checkpoints<br>• nobu faster retry and hitstop<br>• Fighter SFX<br>• hub first-session onboarding<br>• a Relic benefit for every game (§R.11 #7) |
| **Backlog** | everything else in §2 and §3, re-ranked with W0 and Diagnostics data |

**Launch gate:**
1. W-1, W0 and W1-A to W1-D are merged.
2. The Shooter PvP launch checks pass (§R.8 PR8).
3. One rehearsal of `deploy-server.sh` on staging, with a live coop match and a held wager surviving it.
4. Diagnostics consent is verified off by default.
5. The store dup tests are green.
6. A 30-minute human playtest of the whole loop: earn Tickets → exchange in the hub → buy an item → equip it → see a Relic benefit in another game.
7. Shooter PvP harness gates pass (late < 1%, correction p99 < 5 cm, rewind agreement ≥ 98%), the 100-bot load gate passes, and the wager chaos tests pass.
8. Every launch flag goes through the progressive enablement in §R.12.4. Wagers turn on last.

### R.8 Shooter online 1v1: low-latency architecture, wagers, rooms, rematch, leaderboard

**The goal is "no lag", measured.**
- Your own movement, aim, muzzle flash, recoil and ammo respond in **0 frames** (prediction).
- Hits match what you saw, for opponents up to a **200 ms rewind**.
- The remote player moves smoothly, with under 1% starved or extrapolated frames.
- Prediction corrections are under 5 cm at p99.
- Fewer than 1% of inputs arrive late at 30 ms jitter.

**Today (✔ verified):**
- Sim at 30 Hz; snapshots every 3 ticks (10 Hz), each running a full `hashState` (`director.js:247-273`).
- Inputs are stamped with the last snapshot tick, so under any real latency they are rejected (`client.js:209-217`, `director.js:200`). One reject cascades through the sequence check, and only 1 tick in 3 carries real input.
- The remote player is sampled by tick, so it steps at 10 fps.
- The camera uses the *server's* copy of your own yaw, which lags, and ignores pitch.
- Hitscan tests against *current* positions. At sprint speed, 100 ms is 0.95 m, more than twice the 0.4 m player radius.
- **The combat seed is sent to clients in WELCOME** (`director.js:74,97`). Spread and crits are therefore predictable, an exploit once wagers exist.
- The catch-up cap is `tick+18000` (`:269`).
- The director stores a `Map` and closures, so it can't live in Nakama's copied match state.
- The hub wager SQL hard-codes `'sproto-fighter'` (`schema.ts:1690-1698`).
- The transport is Nakama JSON over WebSocket, so TCP. Loss shows up as stalls and bursts, not drops.
- **Easier than expected:** the arena has no walls, so there are no "shot behind cover" complaints, and all three guns are hitscan, so no projectile rewind is needed.

**Architecture (server-authoritative, with client prediction and lag compensation):**

| Layer | Design |
|---|---|
| Rates | 30 Hz sim and Nakama loop. **30 Hz binary snapshots, one per tick, per recipient.** The state hash runs once a second, not per snapshot. 60 Hz stays a later option (sim 3). |
| Sim refactor | Split `step` (`sim.js:313`) into pure `movePlayer`, `weaponTick` and `traceShots`, with the call order unchanged. **Guard:** the golden `ce272de1` must not move in Node, goja or Chromium. |
| Client prediction | A fixed 30 Hz input clock on an accumulator, not the render loop. Each tick: build the wish → send it → store it in a pending ring → step the local player with the shared `movePlayer`/`weaponTick`. The camera reads the local yaw and pitch. |
| Reconciliation | Each per-recipient snapshot carries `ackFrame` plus the seat's exact private state (fixed-point). The client rewinds to it, replays unacked inputs, and decays the visual error over ~100 ms; it snaps only above 2 m. |
| Clock sync and input lead | PING/PONG with the median of the last 8 RTTs. Stamp = estimated server tick + RTT/2 + buffer (1–3 ticks from jitter p95). Snapshots report the server buffer depth, and the client adjusts its input clock by ±5% instead of skipping frames. |
| Server jitter buffer (director v2) | Accept `cursor..cursor+8`. **Late frames are accepted and discarded**: they consume their seq, so there is no reject storm. A missing tick repeats the last held wish (move, aim, held fire) for up to 3 ticks; edge buttons never repeat. Rate caps count frames (45/s, 6 per cursor), so bursts after a TCP stall pass. Catch-up is capped at 4 ticks. |
| Remote interpolation | Clock-based, with an adaptive delay D = clamp(snapshot interval + 2×jitter p95, 50, 150 ms). Extrapolate for up to 100 ms when starved, then hold. Snapshots carry shot counters and firing/dash flags for remote muzzle flashes and tracers. |
| Lag compensation (sim 2) | An 8-tick history ring of {pos, alive, invuln} per player inside the sim state, so replays reproduce it. Each input carries `viewTick`/`viewFrac`.<br>Rewind = min(client claim, 6 ticks, the server's own measured RTT/2 + D + 1 tick). The target is rewound; the shooter stays current.<br>`invuln` comes from the rewound tick; `alive` from the current tick, so there are no hits on corpses. Same-tick trades go through the existing `double_ko`. |
| Combat RNG | **Split the seed:**<br>• a public `spawnSeed`<br>• a secret `combatSeed`, with only its sha256 sent at start and the seed revealed in RESULT so clients can verify<br>The client predicts fire timing. Spread is cosmetic locally; damage and crits come back as server-confirmed hit events. |
| Aim | Cast the crosshair ray from the camera, and send the eye-to-hit-point yaw/pitch, so the crosshair and the hit always agree |
| Wire (protocol 2) | Binary INPUT (seq + count + N×14 B) and per-recipient binary SNAPSHOT (~90 B; ~6.6 KB/s down and ~3.7 KB/s up per client).<br>New ops: PING/PONG, REMATCH, names in WELCOME. **Check first** that goja's `broadcastMessage` accepts binary; if not, send a latin1 string. |
| Server cost (estimate, to measure) | ~0.3–0.8 ms per loop → 100 matches ≈ 1–2.4 cores on the shared 4-vCPU node. **Gate:** loop p95 < 3 ms and node CPU < 60% with 100 bot matches. Reuse coop's loop-timing metrics. |

**Wagers, matching Fighter's escrow:**
- **Generalize the escrow additively.** Add `game_id` (default `'sproto-fighter'`) and `meta` columns to `sproto_wager`, and new `game.wager_hold/settle/refund/expire/move(p_game, …)` functions. The old `sproto_wager_*` become thin wrappers with unchanged signatures, so Fighter and `test/dup/wagers.ts` stay green.
- **Stake and caps:** stake 10 Tickets from the **sproto-shooter** balance; daily net-win cap 200 (as Fighter); pair limit as Fighter.
- **Queues:** wagered and free queues are separate.
- **Gates:** no guests; matching versions; lobby RTT median ≤150 ms over 5 pings, or it is cancelled *before* the hold.
- **The hold** is taken when both players are ready, connected and RTT-checked, just before the match goes live.
- **Settle vs refund:**
  - **Settle:** KO; a time win on higher HP and shield; forfeit after the 10 s disconnect grace while the other player is still sending.
  - **Refund:** draw, double KO, both stalled, cancel, server shutdown, sim fault, max-time cap, **replay mismatch**.
- **Replay before settling.** The director logs every wish it used (~75 KB per match, flushed to `nk.localcache`). After RESULT, `replayJSON` v2 re-runs the match and must agree with the outcome, winner and hash, or the wager is refunded and the log kept.
- **Collusion signals:** alternating wins, forfeits in the first 15 s, a loser with 0 damage. These are logged per wager, and the pair and daily caps apply.
- **Crits are off in PvP.** A crit makes the Sniper a one-shot, and luck shouldn't decide a wager.

**Room codes, rematch, leaderboard:**
- **Room codes:** 6 characters, copying `sproto_arena` room create/join. **Private rooms are free (no wager) at launch**, because wagering against a chosen opponent is the easiest collusion.
- **Rematch:** both players confirm → a new match id → a **fresh wager hold**, counted toward the caps (`sproto_arena.ts:327-357` pattern).
- **Leaderboard:**
  - `shooter_pvp_wins`, incremented through the idempotent `HubBoards.recordWin`.
  - An Elo rating table (K=32, start 1000, provisional for the first 10 games), shown publicly next to wins.
  - Only matchmade games count, not private rooms. No rating-based matchmaking until the population is larger.

**PRs (shooter = sproto-shooter, hub = metaverse-hub):**

| # | Repo | What | Pin/golden | Size |
|---|---|---|---|---|
| S0 | shooter | **Netcode test harness, merged first.** `tests/net/netsim.js` is a seeded discrete-event TCP/WS model (latency, jitter, head-of-line stalls, disconnects) driving 2 clients and a director on a virtual clock. It collects metrics, and baseline tests pin the golden. | none | S |
| S1 | shooter | Client only, still protocol 1: fixed input clock, input lead, one send per tick, camera from local yaw/pitch, clock-based interpolation, the `movePlayer`/`weaponTick`/`traceShots` split | golden unchanged (guard) | M |
| S2a | shooter | Director v2 / protocol 2: rejoin via HELLO, `bothReady`+connected, late-accept-discard, hold-last, seq gaps, frame rate caps, catch-up cap 4, JSON export/import, PING/PONG, names, acks, per-recipient binary snapshots, 1 Hz hash, used-input log | **new fingerprint + pin** | L |
| S2b | shooter | Sim 2: history ring, `viewTick` rewind, split seed, crits off in PvP, replay v2 | **new golden** (Node/goja/Chromium) | M |
| S3 | shooter | Prediction and reconciliation, adaptive interpolation and extrapolation, predicted muzzle/tracers, server-confirmed hitmarkers, aim convergence, **dev net-graph overlay** (RTT, jitter, buffer, late%, correction cm, D, rewind ms).<br>**Harness gates at RTT 100±30 ms:** late < 1%; correction p99 < 5 cm; rewind hit agreement ≥ 98%; starvation < 1%. | none | L |
| S4 | shooter | Lobby: free vs wagered queue, room create/join, ping display, rematch, result screen with Ticket deltas, leaderboard view. Mock hidden in production. RTT/stall counters only with Diagnostics on. | none | M |
| H1 | hub | Generic escrow migration and wrappers, plus `test/dup` for the shooter `game_id`, cross-game isolation and refunds | — | M |
| H2 | hub | Vendor `shooter-pvp-sim.js` and its pin; `check-shooter-pvp-sim-version.mjs` in CI; the bundle does no work at load | pin | S |
| H3 | hub | `games/shooter_pvp.ts`:<br>• director thaw/freeze per callback<br>• 10 s grace and message caps<br>• flags `shooter_pvp` / `shooter_pvp_wager`, and drain refusal<br>• hold and settle per the rules above, with replay before settle<br>• loop metrics<br>• `matchTerminate` refunds | — | L |
| H4 | hub | Free and wagered matchmaker queues (one ticket per account, protocol/content must match the pin, `pairToken`, `sanitizeName`), room RPCs, rematch, board and Elo SQL, RTT gate | — | M |
| H5 | hub | Plaza ring entry with an online count; `VITE_GAME_URL_SPROTO_SHOOTER` | — | S |
| L | both | Launch checks:<br>• 100 bot matches (loop p95 < 3 ms, CPU < 60%, result = replay)<br>• toxiproxy e2e with two browsers (latency, jitter, bandwidth cap, connection reset, rejoin, reload and resume)<br>• **wager chaos tests** (kill Nakama mid-match → refund, no double refund)<br>• human playtest at 30, 80 and 150 ms | — | M |

**Critical path:** S0 → S1 → S2a → S2b → H2 → H3 → H4 → L.
**Parallel from day one:** H1. **After S2a:** S3, finishing against S2b. **Once the protocol 2 contract is frozen:** S4 and H5. H3 can start against the S2a bundle and re-pin after S2b.

**Rollout:** casual first (`shooter_pvp`: allowlist → 10% → on). **Wagers turn on (`shooter_pvp_wager`) only after a week of casual play** with 0 settlement errors, 0 orphaned escrows and 100% replay agreement.

### R.9 Zero-kill hub deploys

**Today (✔ verified):**
- `bootstrap.sh:178` runs `docker compose up -d --build`, which recreates Nakama immediately.
- `compose.yml` has no `stop_grace_period`, so Docker's 10 s default SIGKILLs Nakama before its `shutdown_grace_sec: 15` ends (`deploy/nakama/config.yml:52`).
- Effects: shards are lost (they reconnect fine). A killed Fighter duel strands its escrow. Coop's client tries `coop.resume` once against the server that is shutting down, then gives up. PB shows a reload modal with no retry. Running two Nakama nodes at once is not safe on OSS Nakama, so the design is a **single-node drain**.

| Step | Content | Size |
|---|---|---|
| 1 | `stop_grace_period: 90s` in compose and `shutdown_grace_sec: 60` (in W-1) | S |
| 2 | Migration `server_flags` with `maint_begin(reason, deadline)`, `maint_end()` and `maint_state()`.<br>`Maint.draining()` gates **new** matches:<br>• matchmaker add, `beforeMatchCreate`<br>• sproto and coop room create/join<br>• `pb.worlds`, `shooter.run.issue`<br>• `SprotoDuel.onMatched`, shooter PvP<br>`coop.resume`, `hub.join` and `portal.enter` stay open. The flag has a hard deadline, after which it counts as off. | M |
| 3 | `maint.live` RPC (http_key only): live hard matches (duel, arena, coop, shooter PvP) vs soft ones (plaza, PB world) | S |
| 4 | "Maintenance in N min" notice: one `notificationSendAll`, a per-match `maint` op, optional SDK `onMaintenance()`, a plaza toast, a banner in PB/coop/duel | M |
| 5 | Escrow: `sproto_wager_expire(interval '0')` at boot (single node), plus a sweep every 5 min from the shard-1 loop, keeping the lazy call. The same for arena and coop live rows. Tests: kill and restart in `test:dup` give a refund and no double refund. | S |
| 6 | Coop: retry `coop.resume` with backoff for about 3 min, and resume after a reconnect that gets `match_not_found`. While draining, `rpcResume` returns `maintenance` with `retryAt`. | M |
| 7 | PB: on KICK `shutdown`, show a countdown and poll `pb.worlds`, then rejoin automatically (the reload button stays) | S |
| 8 | `deploy/scripts/deploy-server.sh`:<br>1. `pg_dump`<br>2. build the new image while the old one runs<br>3. `maint_begin(+20 min)`<br>4. poll `maint.live` until there are 0 hard matches or the deadline passes<br>5. wait 60 s more<br>6. `up -d --no-build nakama`<br>7. health check<br>8. sweep<br>9. `maint_end` (also in an EXIT trap)<br>10. deploy the game pages last<br>Images are tagged by git sha for rollback (`IMAGE_TAG=<prev> --no-drain`). Migrations must be additive-only so the previous image still runs. Runbook in `deploy/README.md`, plus off-host backups. | M |

**Later (L):** a blue/green second node, once migrations are reliably additive.

### R.10 Diagnostics setting (telemetry)

- **The setting:** one **Diagnostics** setting with two switches, **Crash reports** and **Anonymous usage**. Both are **off by default**. The hub asks once, with a small non-blocking prompt, never inside a game.
- **Where it lives:**
  - The source of truth is the hub **Account panel**, stored in `game.user_prefs` and set through a hub-scope `prefs.set`.
  - Games receive it in `profile.get` and as the optional `InitResult.diagnostics`. Each game's settings panel shows it read-only with "Change in Hub › Account".
  - Standalone play has a local toggle, default off, and never sends anything.
  - nobu, Arcade and Coop have no settings panel today. They get a minimal one with this line plus volume and reduced motion, if accessibility is approved.
- **What is collected:**
  - Crash: game, build/sim version, phase, message (≤300 chars), stack (≤4 KB, URLs cut to path and line, query strings and `#t=` stripped), browser family, timestamp.
  - Usage: an allowlisted event enum (session_start, level_start, level_clear, quit, portal_enter, pvp_queue, pvp_match, exchange, purchase).
  - **No user id, username or IP is stored.** Only a salted daily hash, used for de-duplication.
- **Server:**
  - `diag.report` re-checks consent on the server: if consent is off it drops the report and still answers ok.
  - Per-user rate limit through `HubRpc.allow`, an 8 KB cap and per-stack de-duplication.
  - Retention: 30 days for crashes, 90 days for aggregated events, enforced by the shard-1 sweep.
  - `diag.forget` deletes the player's data.
- **Clients:** `sdk.installCrashReporter({phase})` registers `error` and `unhandledrejection` handlers and wraps the rAF loop. It does nothing unless consent is on. The W0 crash panels call it, sending through the outbox fire-and-forget.
- **Steps:**
  1. Migrations (S).
  2. RPCs and sweep (M).
  3. SDK 0.7 (M).
  4. Account UI and the prompt (S).
  5. About 20 lines of wiring per game (M in total).
- **Docs:** `docs/privacy-diagnostics.md`, linked from the setting.

### R.11 Economy loop: Tickets → Verse → items, and Relics across games

**Today (✔ verified where marked):**
- **The exchange is sound but scattered.** It runs at 10:1 with a cap of 50 Verse per game per day, is idempotent and writes receipts. But it is game-scoped only, and only PB, nobu and Duel have an exchange UI.
  - HPOS10I Tickets can't be exchanged (the server forbids it).
  - Arcade, Shooter, Coop and Fighter have no exchange.
  - Fighter's `fighter_win` earn pays 0 (✔ `schema.ts:2089-2094`) while the client still sends it.
  - PB and nobu read a `verseCredited` field the server never returns; it returns `verse` (✔).
- **Verse can't be spent.**
  - `store.ts` and `loadout.ts` are not shipped. There is no `store_item` migration and no SDK purchase method.
  - The plaza store prompt opens nothing.
  - Menu prices disagree with `store.ts`.
  - The loadout ids `hpos_skin_golden`, `pb_summon_speed` and `pb_summon_duelist` don't match the live `*_sproto` ids.
- **Three of the six Relics can't be earned.** HPOS10I Core, Genesis Shard and Tidebreaker Belt are "held" grants, and nothing calls `promote_pending_grant` outside tests (✔).
- **Benefits are incomplete:**
  - **PB applies no Relic benefit** (the four summons are not implemented).
  - Duel has no Tidebreaker Belt staff.
  - Shooter and Coop neither grant nor use Relics.
  - `portal.enter` returns empty effects, so every benefit is computed on the client.
  - Fighter, Arcade and Duel relic caches can be spoofed locally.
- **PvP exploit (✔):** `sproto_arena.ts:151-154` `normalizeStaff` accepts any listed staff from the client with no ownership check, and staffs have gameplay stats.

**Steps:**

| # | Content | Repos | Size | Safeguard |
|---|---|---|---|---|
| 1 | **Economy contract** `packages/hub-sdk/src/economy.ts` (in SDK 0.7): Relic ids by game, exchange rules, the store catalog with `catalogVersion`, and `RELIC_BENEFITS[relic][game]` generated from `effects.ts`. The server stays authoritative. Games import it or keep local copies plus a diff test. | hub | M | additive, so old copies still work |
| 2 | **Unstick held Relics** (open question 4). Default: a migration sets `grant_hold=false` for the three, plus a one-off job promoting pending claims. Relics stay revocable and never affect PvP. | hub | S–M | dup test; earn-once PK |
| 3 | **One exchange place for every game:** a hub-scope `verse.exchange {game, tickets, key}` reusing `game.exchange_tickets`, plus `tickets.balances`. An **Exchange tab** in the plaza Esc menu lists each game's Tickets with an exchange button. The in-game exchanges stay. HPOS10I is allowed (open question 5). | hub | M | same SQL, lock and idempotency; new `server/test/dup` case for double exchange |
| 4 | **Fix drift:**<br>• Fighter stops sending `fighter_win` and sends `fighter.boss_defeated` for story bosses<br>• PB and nobu read `verse` instead of `verseCredited`<br>• SDK `InitResult.verse` | Fighter, PB, nobu, SDK | S each | unit tests |
| 5 | **Ship the Verse store:**<br>• `store_item` and `store_purchase` migrations seeded from `docs/m7-server-prep.md`<br>• add `store.ts` to tsconfig and register `store.purchase`<br>• SDK `buyItem(itemId, expectedPrice, key)`, hub only<br>• the **Sprotel panel** subscribes to `onOpenRequest`<br>• menu prices aligned to one catalog | hub | L | `CHECK balance>=0`, server price, `already_owned`; dup tests for double-buy and price mismatch |
| 6 | **Equip and pets:**<br>• fix the `loadout.ts` ids first<br>• call `loadout.set_hub` from the Items tab and drop the `?pet=` path<br>• `portal.enter` resolves effects from the loadout, so games read `init.effects` from the server<br>• `granted_items` is passed through so games show a "new item" toast | hub, SDK | M | unit tests |
| 7 | **Every Relic does something in every other game:**<br>• PB implements the four summons in `src/sim` (balance values, Vitest, DECISIONS.md; a sim bump)<br>• Duel adds `tidebreaker_belt → fighters_might`<br>• Shooter and Coop get a cosmetic benefit or "no Relic" written in the contract<br>• games prefer server `init.effects` over local caches | games | M each | per-game tests; PB `pb-sim` rebuild |
| 8 | **Arena staff ownership check:** `normalizeStaff` checks owned items and falls back to the starter staff, and echoes the accepted staff in `OP_START`. Moved to **W-1**. | hub | S | `sproto_arena.test.ts` case |
| 9 | **Clarity:**<br>• render Relic cards from `RELIC_BENEFITS`, so the text can't drift (Relic text currently promises benefits that don't exist)<br>• a "Tickets → Verse → Store" explainer card<br>• a hub Ticket-balance view<br>• exchange history<br>• a "pending" state for any held Relic<br>• in-game toasts | hub, games | S–M | e2e |

**Rule kept:** Tickets and Verse are fictional, with no real-money concepts anywhere (PB DESIGN §0).

---

### R.12 Rollout: branches, trains, flags and environments (replaces "one branch")

**Today (checked):**
- Each repo has only `main` plus this session's `claude/jolly-knuth-rwthof`.
- There is **no staging environment**. The hub deploys by hand from `main` (`bootstrap.sh`). HPOS10I auto-deploys `main` only when `PAGES_ENABLED` is set.
- There are no feature flags.

The model below lets 4 agents work in parallel, keeps `main` releasable, and makes every change reversible without a redeploy.

#### 1. Branches and pull requests
- **One ticket = one branch = one small PR**, named `<agent>/<ticket-id>-<slug>` and cut from the latest `main` (for example `claude/HUB-W1-05-verse-exchange`). This matches every repo's AGENTS.md.
- **Stacked PRs** for dependent work inside one repo (for example Shooter PR2 sits on PR1). Each PR targets its parent branch, gets rebased after the parent merges, and is retargeted to `main`.
- **Release trains** for cross-repo work. One tracking issue in `metaverse-hub` per train (`TRAIN: shooter-pvp`, `TRAIN: sdk-0.7`, `TRAIN: economy`, `TRAIN: zero-kill-deploy`) lists every PR across repos in merge order. The rule: **producers merge first** (game sim → SDK), then the hub vendors the exact commit SHA. Pin checks (`check-*-sim-version`, `SOURCE.pin.json`) prove the result is consistent.
- **Hotfixes:** `hotfix/<slug>` is cut from the **production tag**, deployed, then merged back into `main`. W-1 hotfixes use this path.
- **This session's branch** (`claude/jolly-knuth-rwthof`) carries only the plan document (`docs/plans/`), never code. That needs your OK to commit there.
- **Sproto-Arcade** keeps its AGENTS.md exception (verified work may go straight to `main`), but still lands dark behind flags.
- **Required checks per repo** are the AGENTS.md check lists plus the new guards, with a different agent as reviewer. Turn on GitHub's merge queue where it's available, so two agents can't merge into a red `main`.

#### 2. Feature flags: merge dark, enable deliberately
- Extend `game.server_flags` (§R.9, step 2) to rows of `{key, state: off|allowlist|percent|on, allowlist uuid[], percent int}`.
- Read flags through `Flags.on(nk, key, userId)`. The SDK sees them through `profile.get` → `InitResult.flags`, which is optional.
- **Launch flags:**

  | Flag | Controls |
  |---|---|
  | `shooter_pvp` | Shooter online 1v1 |
  | `shooter_pvp_wager` | Ticket wagers in Shooter online |
  | `shooter_pvp_ranked` | the ranked leaderboard |
  | `hub_exchange` | the plaza Exchange tab |
  | `verse_store` | the Verse store |
  | `relic_unhold` | releasing the three held Relics |
  | `diagnostics_prompt` | the first-run Diagnostics prompt |
  | `maint` | maintenance mode (the drain) |

- **Every launch feature merges with its flag `off`.** Turning a flag off is the first rollback: instant, with no deploy.

#### 3. Environments
- **Add a staging stack.** It is a second compose project (`metaverse-staging`) on its own database and subdomain (`staging.<domain>`), and `deploy-server.sh` gets a `--env staging` option. Games deploy to `/staging/play/<game>/`.
- **Promotion path:**
  1. Merge to `main`.
  2. Auto-deploy to staging. A new CI job runs on `main`, using a deploy key stored as a CI secret.
  3. Smoke checks and e2e run against staging.
  4. A tag `hub-vYYYY.MM.DD.n` is pushed (you push it, or approve it).
  5. `deploy-server.sh` deploys to production with the zero-kill drain.
- **SDK releases are tagged** `hub-sdk-v0.6.3` and `hub-sdk-v0.7.0`. Games vendor **by tag**, and `SOURCE.pin.json` records both the tag and the commit.

#### 4. Progressive enablement for each launch feature
1. **Staging:** flag on, with bots and e2e.
2. **Production, allowlist:** you and your testers dogfood it for at least 48 h.
3. **Production, 10%:** watch the server metrics (and opt-in Diagnostics) for 72 h.
4. **Production, on.**

Wagers come last. `shooter_pvp_wager` turns on only after casual Shooter PvP has run for a week with:
- 0 settlement errors
- 0 orphaned escrows
- replay agreement at 100%

#### 5. Who works where (default lanes; you can change them)

| Agent | Lane | Hotspot files it owns |
|---|---|---|
| Claude | hub server, SDK, economy, drain | `schema.ts`, `main.ts`, `packages/hub-sdk` |
| Codex | Shooter PvP game side and netcode | `sproto-shooter/src/sim/pvp`, `src/net` |
| Cursor | game-client fixes and crash panels (Duel, nobu, HPOS10I, PB, Coop, Fighter) | each game's UI/flow files |
| Grok | docs batch, CONTRACTS.md, tests and guards, re-vendor PRs | docs and tests |

- A different agent from another lane reviews each PR.
- A `lock:<file>` label marks hotspot ownership for files outside the owner's lane.

#### 6. Rollback ladder (fastest first)
1. Flag off.
2. Game release symlink back to the previous release.
3. Hub image tag back (`IMAGE_TAG=<prev> deploy-server.sh --no-drain`).
4. Revert the PR.

Database migrations are **forward-only and additive**: a schema change must still work with the previous image. Wager escrow always has a refund path (§R.9, step 5).

#### 7. Cadence
- **Hub:** a weekly release train from `main` to staging to production, on a fixed day, using the drain.
- **Games:** deploy on merge, but launch features stay dark until their flag is on.
- **Hotfixes:** any time, through `hotfix/*`.

---

## 0. How we change things without breaking anything

These rules apply to every item below. They are the "always, without breaking anything" part.

1. **Write the test first.** Every bug fix starts with a failing test that reproduces it. Every refactor starts with a test or golden that pins today's behaviour.
2. **Know each repo's tripwire before you touch it.** Several repos ship a deterministic sim to the hub. In those repos, editing certain folders changes a version or hash, and the hub must then re-vendor.

   | Repo | Editing this changes the hub contract | Guard |
   |---|---|---|
   | peoples-bitcoin | `src/sim`, `src/server`, `src/config` (including `assets.manifest.json`), `src/data`, `src/net/protocol.ts` | `SIM_VERSION` → rebuild hub `pb-sim.js` |
   | Sproto-Fighter | anything reachable from `src/net/serverEntry.ts` (most of `src/sim`, plus `src/net/*`), including identifier renames and file moves; comments and whitespace do **not** count (`legalComments:'none'`) | `SIM_VERSION` = sha256 of the esbuild output (`scripts/build-sim-bundle.mjs:19-26`) → hub `sproto-sim.js` |
   | sproto-duel | `src/sim-core` and the whole `CONFIG` | `DUEL_SIM_VERSION`, 23 goldens, `check:server-sim` |
   | Sproto-Arcade | `game.js` and shared rule modules that go into the bundle | `ARCADE_SIM_VERSION`, `qa/golden/story-*.json` |
   | sproto-shooter | `src/sim/pvp/*`, `src/net/{inputCodec,protocol}.js`, `src/server/*` | campaign fingerprint `3c657fb5`, PvP pin `f5949631`, golden `ce272de1` |
   | Sproto-Coop-Battle. | `public/js/{sim,ai,net-protocol,manifest}.js` | sha256 pin plus 40 goldens |
   | metaverse-hub `packages/hub-sdk` | any change | all 8 games re-vendor |

3. **Prefer derived state over stored state inside a sim.** For example, a selector `fighterAction(f)` that is computed and never stored leaves hashes, replays and goldens unchanged. Stored-state refactors are batched into one deliberate version bump, each with a planned hub refresh.
4. **SDK and server changes are additive only.** New fields and methods are optional, so old vendored copies keep working. Migrate one game at a time with `sdk.getState ? new : legacy`. Remove legacy paths last.
5. **One small branch and PR per item.** Follow each repo's AGENTS.md: a `<agent>/<slug>` branch from the latest `main` and a PR. Sproto-Arcade alone may integrate to `main` directly. Run the repo's checks and have a different agent review.
6. **One state-machine pattern for every repo, not a shared library.** Use:
   - a discriminated union, `type Phase = {kind:'playing'} | {kind:'dying', wait:number} | …`
   - one mutator, `setPhase(next)`, which checks a small `allowed[from]` table and logs illegal moves
   - terminal states that stay terminal
   - timers that count ticks, not wall-clock time, so pause stops them
   - the current phase exposed to agents and QA (`window.hpos`, `__duel.qa`, `src/dev.js`, …)
   - a table-driven test of each guarded transition

   The repos mix TS, JS and classic scripts, so a shared library would cost more than it saves.

---

## 1. Executive summary

### Real bugs found (fix these first; most are small and client-only)

| # | Repo | Bug | Status |
|---|---|---|---|
| 1 | peoples-bitcoin | **Hub sell claims Tickets for items you don't own.** The client computes `packs` from the requested quantity without clamping it to `countItem`, while the sim does clamp (`hub/client.ts:192-196` vs `sim/terminal.ts:102`). | ✔ |
| 2 | sproto-duel | **The opponent name is injected into `innerHTML` unescaped** on the results screen (`ui/Menus.ts:900`). Server names are only shortened to 24 characters (`net/protocol.ts:81`). | ✔ |
| 3 | sproto-shooter | **Online PvP is broken under real latency.** Inputs are stamped with the last snapshot tick (`net/client.js:209-217`), and the director rejects `frame < cursor` (`sim/pvp/director.js:200`). At a one-way delay over 33 ms every input is late, and after 10 s the seat forfeits. Input is also sent only once per snapshot, so 2 of every 3 ticks are neutral. | ✔ |
| 4 | sproto-shooter | **PvP rejoin always fails.** The client sends only RESYNC (`client.js:186-199`). `requireSeat` needs `connected` and the *old* `sessionId` (`director.js:139-146`), and that id changes on reconnect. | ✔ |
| 5 | Sproto-Coop-Battle. | **The pin check is circular.** The test rebuilds the bundle and compares it with itself (`tests/goja-goldens.test.js:88-89`). A comment-only edit to `sim.js` passes and silently rewrites the hub pin. | ✔ |
| 6 | Sproto-Coop-Battle. | **B in a banked (server) match leaves without the confirm.** `runLive` reads `app.sim`, which is null in the banked role (`main.js:129-133`). | ✔ |
| 7 | metaverse-hub (hub-sdk) | **`disconnect()` during connect leaves an open "zombie" socket.** There is no check after `await getToken()` (`realtime/client.ts:384-394`, `460-464`, `618-630`). Every game inherits this. | ✔ |
| 8 | metaverse-hub | **The Tickets ledger has no index** besides `seq` (`schema.ts:96-106`). Each earn, balance check and wager check scans the table. | ✔ |
| 9 | metaverse-hub | **A production build can embed an empty Nakama server key** (`apps/hub/vite.config.ts:134-136`), and nothing checks for it. Every login would then fail. | ✔ |
| 10 | sproto-duel | **The abandoned fight keeps simulating behind the menu.** `enterMenuState` never calls `stopSim` (`App.ts:1089`). It can post a QUICK win to the hub. | ✔ |
| 11 | sproto-duel | **Pausing during the 2.2 s KO beat means the results screen never appears.** `pause()` allows it (`App.ts:1034`), and the timer fires only when `state==='playing'` (`:1300-1303`). | ✔ |
| 12 | HPOS10I | **Any thrown error freezes the game forever.** rAF is re-armed only at the end of the frame, and nothing catches errors (`runtime/tree.ts:194-201, 255-266`). | ✔ |
| 13 | nobu | **A `render()` throw stops the loop.** Only `update` is inside the try (`game/game.js:145-158`). | ✔ |
| 14 | nobu | **It can delete another game's queued Ticket write.** `firstOutboxKey` takes `rows[0]` with no game filter, and the outbox is shared per origin (`hub/hubBridge.js:638-654`). | ✔ |
| 15 | hub server vs mock | **The live server never returns `capped:true`** (cap checks are all-or-nothing, `schema.ts:928-944`), but the SDK mock does. Every game's "capped" UI is untested against reality. | ✔ |
| 16 | Sproto-Arcade | **A phase-2 checkpoint clear never saves locally.** `game.js:515` skips `levelCleared`, which holds the only `recordClear` (`hub-link.js:222-226`). | ✔ (owner decides intent) |
| 17 | sproto-shooter | **Holding Ctrl to slide while pressing W closes the tab** (`input/input.js:4`). | traced |
| 18 | peoples-bitcoin | **Dying during a teleport** drops your pile at the destination (`zones.ts:131`, `tick.ts:89`). | traced |
| 19 | peoples-bitcoin | **The kick overlay stacks a second "kicked" message**, and intents keep sending after a kick. | traced |
| 20 | HPOS10I | **Die → pause → Restart costs no life** (`pause_menu.ts:190,277`, `scene_router.ts:71-77`). | traced |
| 21 | HPOS10I | **TimeFocus overwrites the boss's final-hit slow-motion** every frame (`time_focus.ts:98`, `the_executive.ts:501`). | traced |
| 22 | nobu | **Pause during gate and goal transitions lets the boss intro run under the pause menu.** QUIT TO MAP during the fade can queue two `toMap` calls. | traced |
| 23 | Five games | **A stale SDK (missing the 0.6.1 outbox fix) gets stuck.** One refused write, such as the daily cap, makes every `init` fail that day, so the game silently drops to standalone. Affected: PB 0.5.0; HPOS10I, Fighter, Duel and Arcade 0.6.0. | traced |
| 24 | Sproto-Coop-Battle. | **Clears refused by the cap are marked done and never retried.** The player never sees a receipt (`coop_match.ts:366-369`). | traced |
| 25 | metaverse-hub | **Guest recovery restore leaves `chatRoom` stale**, so chat is bound to a dead socket. | traced |
| 26 | Sproto-Fighter | **Online desync is detected but never shown.** `session.desync` is not read outside `rollback.ts`. | ✔ |

### Decisions only you can make (each blocks one item)

1. **Arcade:** should a phase-2 checkpoint clear save local progress and unlocks? Should god mode protect against chase/climb barrage falls?
2. **HPOS10I:** Restart while dying: should it be disabled, cost a life, or stay free? Should the 8 emeralds persist across reloads, or count per run?
3. **peoples-bitcoin:**
   - Should a teleport make the player invulnerable, or should death cancel the teleport?
   - May the dead economy code be deleted? This is a one-time sim bump.
   - DESIGN §0 rule 1 (no real tickers) conflicts with rule 3 (`$BITCOIN`).
4. **Trust model:** most Ticket earns are client-claimed, bounded only by caps. Only Shooter and Coop are server-verified. Should this be documented as accepted, or should verification be added per game? Related questions:
   - HPOS10I ships `window.hpos` and `?inputs=` in production.
   - Duel's god-mode boss wins still post `boss_defeated`.
5. **sproto-duel:** should boss gauntlet stages get checkpoints? Fights run 15+ minutes and a loss restarts from stage 1.
6. **Arcade:** should the two runtimes (Machine Trials vs Story) stay separate long-term? The recommendation is yes for now, with parity tests.
7. **Fighter:** move the 6.2 GB `art/` folder to LFS or a separate repo? That means a history rewrite. The recommendation is not now: use sparse worktrees instead.
8. **Hosting:** should Duel, Arcade and Shooter PvP sims be hosted by the hub? Today they are built but not hosted.

---

## 2. Shared plan (Tickets, rewards, Relics, sessions, SDK, cross-repo)

### 2.1 How the shared lifecycles work today

- **Launch.** Plaza ring dwell 1 s → `portal.enter` → `game.open_portal`. This closes any other open session, opens a 6 h lease and creates a 60 s ticket. The game loads with `#t=`, and `init` swaps the ticket, caches the session in `hub:<game>:session`, then drains the outbox. `exit()` → `session.close` → `<hub>/#from=<game>`.
- **Session.** In the SDK the only state is `active: LiveSession | null`. The server's `game_session.state` allows `open|closed|expired`, but `expired` is never written. "Live" means `state='open' AND lease_until>now() AND ticket_redeemed_at IS NOT NULL`, and that predicate is copy-pasted about 18 times.
- **Ticket write.** queued (IndexedDB) → sent → paid / replayed / refused / stuck on a dead session. **None of this is visible to the game.** Refusals are not durable, so the same key can pay later.
- **Server-paid flows that are already explicit:** Coop settle result, `shooter_run.status`, `sproto_wager.status`. These are the model to copy.
- **SDK versions:**

  | Game | SDK version |
  |---|---|
  | current | **0.6.2** |
  | PB | 0.5.0 |
  | HPOS10I, Fighter, Duel, Arcade | 0.6.0 |
  | nobu | 0.6.1 |
  | Shooter, Coop | current |

- **Games read SDK internals.** Six games read the SDK's private `hub:<game>:session`, and two decode the JWT. Each game has its own UI wording for offline, guest, cap and failed states. Five "final error" lists disagree with each other.

### 2.2 Shared items, in rollout order

| Step | Item | Effort | Repos | Safeguard |
|---|---|---|---|---|
| S1 | Re-vendor the 6 stale SDK copies to 0.6.2, one game per PR. Add `SOURCE.pin.json` everywhere. Update PB's `sdk-hash.test.ts` and HPOS10I's `originality_allow.txt` line pins. | S | PB, HPOS10I, Fighter, Duel, Arcade, nobu | each game's checks; fixes bug #23 |
| S2 | Docs only: hub `CONTRACTS.md`. It holds:<br>• the C1–C14 table (cited about 70 times in code, never listed)<br>• the change matrix (SDK change → re-sync 8; sim change → rebuild/pin/check)<br>• the migration id ranges<br>• all 8 games<br>Also: AGENTS.md for Shooter and Coop; sync the Higgsfield guide (HPOS10I differs; Shooter and Coop are missing it); fix the stale READMEs. | S | all | none needed |
| S3 | CI hygiene:<br>• Node 22 in Duel (20) and nobu (`lts/*`)<br>• `cache: npm` in Arcade<br>• run `check-sproto-sim-version` in the hub `ci.yml`<br>• add a `pb-sim.pin.json` and check (report-only for a week) | S | Duel, nobu, Arcade, hub | warn-only first |
| S4 | Fix nobu's cross-game outbox delete (filter by game) | S | nobu | `hubSdkMock` test with two games' rows |
| S5 | Mock parity: the mock throws `daily_ticket_cap` all-or-nothing and `capped` is deprecated. Add one contract suite run against the mock and against Nakama. | S–M | hub | `test:rt` |
| S6 | Additive server fields:<br>• `profile.get` gains `identity`, `username`, `leaseUntil`<br>• `replay:true` on idempotent replays<br>• a `retry:'never'\|'next_session'\|'next_day'\|'transient'` hint on errors<br>• `game_session.closed_reason`<br>• one `game.ticket_caps()` SQL function replacing the 4 hard-coded 1000s<br>• a `game.session_live()` helper replacing the 18 copied predicates<br>• the Coop receipt sent to the client | S–M | hub only | dup suite; old SDKs ignore new fields |
| S7 | `packages/hub-sdk/src/contract.ts` as the single source for game ids, Relic ids, events, reasons (`{max, trust}`), caps and error codes with a retry class. The server compares itself to it in a unit test and never rewrites migrations. Games import it as they re-sync. | M | hub, then games | compare-only tests |
| S8 | **SDK 0.7, all additive:**<br>• `HubLinkState = standalone{reason} \| connecting \| linked{identity,…,leaseUntil} \| session_closed{reason} \| degraded{pending,lastError}`<br>• optional `getState()` / `onState()`<br>• per-write status (`queued→sending→paid\|replayed\|refused{code,retry}\|stuck`) with `pendingWrites()`, `onWrite()`, `retryPending()`, `forgetWrite(ownKey)`<br>• `reportEvent` returns `granted_items`<br>• a failing drain row no longer fails `init` (it becomes `degraded`)<br>• fix the realtime zombie socket with a connection generation token<br>• fix cached-session resume via `deadSession()`<br>• add `describeHubState()` to give every game the same chip/toast wording | M–L | hub, then all 8 | contract suite and the existing `sdk.test.ts` / `realtime.test.ts`; add a deferred-`getToken` test first |
| S9 | Migrate games to 0.7 one at a time: Shooter → Coop → Fighter → Duel → Arcade → HPOS10I → PB → nobu. Keep a fallback in each, and delete the private-storage probes and IndexedDB edits only after that. | M each | games | each game's hub tests |
| S10 | One sim-pin manifest `<id>.sim.pin.json`:<br>• fields: `gameId`, `commit`, `bundleSha256`, `simVersion` (16-hex), `protocolVersion`, `global`, `goja`, `hosted`<br>• one `check-sim-pins.mjs` run on every PR plus daily<br>• one goja version (there are 3 today) and one Go version<br>• a daily `check-consumers.mjs` drift report, plus `resync-sdk.mjs` | M | hub and the sim games | report-only first, then blocking after 7 clean days |
| S11 | Visible receipts with one shape: `paid \| already_paid \| ineligible \| refused(retryable) \| session_closed`. Retry Coop's `sealed:false` clears. Wire `play_lease` (or a light `session.status` call) so a second tab shows "superseded". Refresh the hub token before `portal.enter`. | M–L | hub, Coop, Shooter | dup suite |
| S12 | In 0.8, once every pin is ≥0.7: drop `capped`, and stop promising stable private storage keys | S | all | drift report clean |

**Leave as is:** the different test runners, TS vs JS, and the three/vite major versions per game. Each game is deployed separately, so standardizing costs more than it returns.

---

## 3. Per-repo plans

Each repo has two parts:
- **State machines:** the implicit machines found, and what to do with each.
- **Top 10:** state machines plus the full audit, merged into one list. Quick, safe, high-value items come first.

### 3.1 metaverse-hub

**State machines**

| # | Machine | Today | Do |
|---|---|---|---|
| SM1 | Realtime connection (`hub-sdk/realtime/client.ts`) | public `RealtimeState` plus loose `wanted/connecting/socket/attempt`; ✔ zombie-socket bug; `open` fires before matches are re-joined | internal union plus a generation token checked after each `await`; optional `restoring` flag; public type unchanged |
| SM2 | Plaza input owner (`shell.ts`) | gate/picker/chat/menu/account/travel flags; priority encoded in 4 places; the account panel doesn't block portals; the store prompt opens no UI (`onOpenRequest` unsubscribed) | pure `inputOwner(flags)` reducer with tests in the arcade-picker style |
| SM3 | Portal travel | `traveling` plus a CSS wipe; no timeout; no `pageshow` reset; the realm gate's `leaving` never resets | `idle\|minting\|navigating\|failed` with a timeout and a `pageshow` reset; `stepPortalDwell` tests |
| SM4 | Plaza link plus shard chat | `'elsewhere'` is overwritten by `'reconnecting'`; `placeOnce` doesn't re-check `closed`; stale `chatRoom` after restore; `startPlaza` race | event→status reducer; generation token; reset chat when the plaza is replaced |
| SM5 | SDK live session (`live.ts`) | `active: LiveSession\|null` covers 4 meanings; any `profile.get` failure keeps a dead session | internal `SessionState`; use `deadSession()` in `init` (folds into S8) |
| SM6 | Arena match (`sproto_arena.ts`) | `phase: string` plus 5 rematch fields | type-only `ArenaPhase` and a `Rematch` union; wire values unchanged |
| SM7 | Coop match (`coop_match.ts`, 1,844 lines) | `phase` plus `broken/cleaned/cold`; `leftTick` sentinel −1/≥0/−2 | phase union; `presence: present\|grace{since}\|cpu`; read-map old checkpoints |
| SM8 | `game_session` row | `expired` is never written; "live" predicate copied ×18 | `game.session_live()` SQL helper (S6) |

**Top 10**
1. **Refresh README and AGENTS.md.** The README says "no downloaded art", but there are 56 MB of GLBs. It says "no postprocessing", but bloom is on. Shooter and Coop are missing. Write down the goja/ES5 `var` rules, the `tsconfig files` order, migration id ranges and the docker requirement for `test:dup`. S.
2. **Fail the production build on an empty `VITE_NAKAMA_SERVER_KEY`.** S. (✔ bug #9)
3. **Label or remove the fake Bar scoreboard rows.** `setBoard` drops its `sample` flag. S.
4. **SM4:** fix the stale `chatRoom` and the `startPlaza` race. Write the `net.test.ts` case first. S.
5. **SM1:** fix the zombie socket. Write the deferred-`getToken` test first; it ships in the SDK, so all games re-vendor. S–M.
6. **New migration:** `tickets_ledger` indexes `(user_id, game_id, ref_id)` and `(user_id, game_id, created_at)`. S. (✔ bug #8)
7. **Guards:**
   - a game-id list invariant (about 10 copies; `vcoin` is missing from the SDK)
   - migration id-range test
   - typecheck `apps/hub/test` (never checked today)
   - typecheck or delete the 1,100 unshipped lines (`store.ts`, `loadout.ts`, `play_lease.ts`)

   S.
8. **SM3 and SM2:** travel timeout and `pageshow` reset; input-owner reducer; wire or hide the store prompt. S–M.
9. **Pin `pb-sim.js`** (830 KB, with no pin or check). S–M.
10. **Server structure:**
    - move the meta-leaderboard rollup out of the 10 Hz shard tick
    - add retention sweeps for `idempotency` and `game_session`, with a replay-within-window test
    - split `schema.ts` (3,377 lines, the top churn file) into one file per migration

    M.

Later: SM6/SM7 unions, shard `test:dup` across CI jobs (up to 140 min today), KTX2 for the two largest GLBs plus a per-asset budget, plaza audio (there is none), WASD-move option and gamepad, reduced motion for 3D effects, rename `sproto_duel.ts` (which is Fighter) and `sproto_arena.ts` (which is Duel), and one JWT helper (there are 4 copies).

### 3.2 sproto-duel

**State machines**

| # | Machine | Do |
|---|---|---|
| SM1 | Engine mode (`Game.sim/role/qaMode/inSandbox/useSim`) | ✔ `stopSim()` in `enterMenuState` now; later `EngineMode = attract\|sim\|replica\|sandbox` |
| SM2 | App flow (`AppState` plus `resultsTimer`, `simulating`, audio set by hand in 5 places) | ✔ KO-beat fix now; later `menu{screen}\|fighting{lockWait}\|koBeat{t}\|paused{online}\|results` with onEnter/onExit owning lock, HUD, audio and timers |
| SM3 | OnlineSession (explicit enum plus about 12 side fields) | surface a transport drop during rematch (frozen panel); subscribe to `rejoin`; per-state data in the union; FakeArenaServer tests |
| SM4 | OnlineController (`active/resultSent/logSent/needSnap`) | `idle\|host\|replica\|draining\|stopped`; remove the order dependency on `ctl.stop()` |
| SM5 | `Menus.current` derived from a CSS class | typed `ScreenId` returned by `mount()` |
| SM6 | Wizard action timers (hashed and wire-encoded) | **do not change storage**: derived `actionState()` getter plus an exclusive-action fuzz invariant |
| SM7 | Match phase implemented twice (hashed `phase` string) | make Match a read-only mirror on the sim path; drop `'menu'` from the phase type; shared constants |
| SM8 | AI (`SimAI` / `AIController`) | leave the logic alone; expose state and overlay reasons in a debug overlay |

**Top 10**
1. **Escape names and all server strings in `Menus` innerHTML.** Add a `<b>x</b>` name test. S. (✔ bug #2)
2. **SM1:** `stopSim()` in `enterMenuState`. Add a QA scenario: quit mid-fight, then no `matchEnd`. S. (✔)
3. **SM2:** block pause once the match is decided, or fire results on resume. Add a QA scenario. S. (✔)
4. **CI:** add `npm run typecheck` (test files are never typechecked today) and `check:assets`. S.
5. **Docs and AX:**
   - AGENTS.md: the determinism contract, goldens, `check:server-sim`, tuning edits change the server bundle, colocated tests, and that the QA harness runs the *legacy* engine
   - `qa-tester.md` is stale (it lists "three difficulties")
   - SERVER-SIM.md still says "only Tinubu"
   - rename `TINUBU_EVENT` and drop the dead hub constants

   S.
6. **Production build guard** for `VITE_NAKAMA_URL` (it falls back to `127.0.0.1`) and the server key, plus a timeout on hub init at boot. S.
7. **SM3:** rematch disconnect and the `rejoin` event. S–M.
8. **Asset diet:**
   - staff GLB textures from JPEG to WebP
   - lazy-load staffs the player doesn't own
   - `golden_ticket.png` (916 KB)
   - WAV to OGG
   - size budgets in `check:assets`

   S–M.
9. **Split `CONFIG` into SIM and PRESENT.** Today the whole config ships in the server bundle, so a bloom tweak forces a hub re-sync. Move the pure data out of `arena/Pillar` (which imports three) and add an import-boundary test for `sim-core`. M; one deliberate version bump.
10. **SM1/SM2 unions,** then move QA onto the production sim and retire the duplicated legacy gameplay. That is about 6k lines across Wizard, Spells, AI, BossPowers, RewardSpells, ArenaShifts and Match. L; protected by goldens, fuzz and `check-game-sim-e2e` (promote it to nightly CI).

Later: shake/flash/reduced-motion settings (strobe-like cinematics), boss stage checkpoints (owner decision 5), guest prediction after a human playtest, settings schema validation, flow tunables into `CONFIG.flow`, and fixing per-tick allocations in `SimDriver.apply`.

### 3.3 HPOS10I

**State machines**

| # | Machine | Do |
|---|---|---|
| SM1 | Level lifecycle (`Finish` enum is explicit; the death side uses `respawnWait`/`respawnSent`/…) | `LevelPhase = playing\|dying{wait}\|respawning\|finishing{step}\|leaving` with a public `phase()`; PauseMenu reads it to apply the Restart rule (owner decision 2); needs a LEAD-REQUEST |
| SM2 | `tree.timeScale` ownership (4 writers fight) | `requestTimeScale(owner,s)` / `release(owner)`, effective value = the minimum; lint ban on direct writes |
| SM3 | Player flags around the explicit `PlayerState` | **don't restructure** (physics pinned to the Guide); add a `checkInvariants()` test helper; delete or wire the dead `dropdash`/`airdash`; make the `state` setter internal; turn the `dropCharge` sentinel into a union |
| SM4 | Boss stage (generators, already good) | derived `stage()` getter; `phase` derived from hits |
| SM5 | PauseMenu | `closed\|open{page}\|resuming{quiet}` |
| SM6 | Hub client (`reach` plus 4 booleans) | `{offline}\|{pending}\|{ready, session}`; later SDK 0.7 |

**Top 10**
1. **Crash-proof main loop:** rAF in a `finally`, an error counter, and a visible "reload" panel. Add a unit test that throws from a node. S. (✔ bug #12)
2. **SM1:** the Restart-while-dead rule (owner decision 2) plus a test. S–M.
3. **Gate `window.hpos` and the `?zone`, `?scene` and `?inputs` URL parameters behind a dev flag** that the smoke test and bots set. S.
4. **SM2:** time-scale request stack plus TimeFocus tests (it has none today). S–M.
5. **Docs:**
   - deploy happens only when `PAGES_ENABLED` is set (AGENTS and README say every push)
   - mark the planned art paths
   - add the folder-ownership / LEAD-REQUEST line to AGENTS.md
   - "edit levels via the builder, never the 1.4 MB JSON by hand"

   S.
6. **Save versioning:** add `v:1` and a migrate function per `SAVE_KEYS` blob. S.
7. **Emerald persistence** (owner decision 2). S.
8. **Accessibility:** OPTIONS reachable from the title, music/SFX volume, a flash toggle, and an optional coyote-time/jump-buffer assist (off in Ranked; bots run with it off). M.
9. **SM3** invariants and dead-state cleanup, then split `player.ts` (1,209 lines) behind a facade. M; protected by `tests/physics/reference*`, the bots and the recorded inputs.
10. **Small guards:**
    - lint rules for floating promises, `no-restricted-imports` layering (`core`/`runtime` must not import upward) and the `timeScale` ban
    - scope CI `pages:write`/`id-token:write` to the deploy job
    - SM4 `stage()` getter

    S.

### 3.4 nobu

**State machines**

| # | Machine | Do |
|---|---|---|
| SM1 | Session lifecycle (`phase/busy/loading/dying/over/disposed`, duplicated in `rushSession.js`; wall-clock waits; async guards are no-ops for L1–L4) | Stopgap: forbid pause while `busy`. Then a shared `SessionPhase` union with `canPause()` derived from it, the lifecycle-token pattern for every session, pause-aware waits, and re-arming a track trigger when its handler bails |
| SM2 | Game screen (18 writes plus per-screen sub-state) | discriminated `Screen` with sub-state inside; a `leaving{to}` state that ignores input during fades; one `setScreen()` |
| SM3 | `player.frozen` (33 writers; the first to unfreeze wins) | `freeze(reason)`/`unfreeze(reason)` backed by a set; compat setter; lint guard |
| SM4 | Boss state (the session writes boss fields directly; dying in the 600 ms phase delay skips the evolve setup) | boss-owned `idle\|intro\|fighting\|evolving\|defeated`; methods instead of field writes; per-boss `STATES` dev assert |
| SM5 | Player mode plus sub-mode flags | single `setMode()`; fold `flopPhase` into it; add coyote/buffer tests first |
| SM6 | Dialogue, cutscene and loading overlays (`ui.update` runs under pause) | gate overlay input on the screen state |

**Top 10**
1. **ESLint config and a `lint` script.** The CI step is a silent no-op today. Pin Node 22. S.
2. **Main-loop resilience:** `render` inside the try, rAF in a `finally`, a visible error panel. S. (✔ bug #13)
3. **SM2 `leaving` state** to block input during fades. Use the `pause-exit-confirm` test. S–M.
4. **SM1 stopgap:** no pause during `busy`. Then the full `SessionPhase`. S → L.
5. **Asset loading.** About 28 MB of GLB and 10 MB of images load before the title, with no compression. Load boot-critical assets first, load per level, and compress with meshopt. M; protected by `placeholders.test.js` plus a "level uses only preloaded ids" test.
6. **SM3** freeze reasons plus the lint guard. S–M.
7. **AGENTS.md conventions:**
   - lifecycle epochs
   - who owns `frozen`
   - where tunables live
   - dev hooks and fixtures
   - a new-boss checklist
   - an index of the 27 `docs/expansion` notes

   Also delete the dead `buildLevel2` in `level2.js` and date `handoff.md`. S.
8. **Flow tunables into `config/flow.js`,** then a shorter retry (3.4–3.9 s per death today) and 2–4 frames of hitstop on boss hits and stomps. S each.
9. **Opt-in `tsc --checkJs`** on save, hub, config and session, plus JSDoc for Session, Boss and Entity. Do not convert to TypeScript. M.
10. **Split `game.js` screens and `session.js` flows; merge RushSession** (with SM1/SM2). Accessibility: remap, reduced motion, a visual twin for each audio-only tell. L.

### 3.5 Sproto-Fighter

**State machines.** Every hashed sim field stays as it is: `hashState = JSON.stringify(s)`.

| # | Machine | Do |
|---|---|---|
| SM1 | Per-fighter action (`move/stun/blockstun/reaction/dash/throwState`, re-derived about 43 times outside the sim) | read-only `fighterAction(f,s)` union in a module the sim bundle doesn't import; `sim-version-smoke` proves it is neutral |
| SM2 | Throw guards (3 inline locks) | named predicates, batched into the next sim bump |
| SM3 | Round/screen flow in `main.ts` (`presentation.phase` written from 3 places, early-return precedence) | `RoundFlow` union plus a transition function in its own module (presentation-only) |
| SM4 | Online session (`OnlinePhase` set from 6 places; a `cancelled` outcome overwrites `finished`; no forfeit warning during `starting`) | `allowed[from]` table in `setPhase` |
| SM5 | Round result | derived `roundStatus(s)` |
| SM6 | Story encounter and boss | leave as is |

**Top 10**
1. **Golden state-hash fixture** (scripted plus CPU-vs-CPU logs). This is step 0: nothing today proves a refactor kept the output the same. S.
2. **Sparse-checkout worktrees for agents.** The full checkout is 7.6 GB. Make `agent-task` apply `ci-checkout-paths.txt`, and note it in AGENTS.md. S.
3. **Docs:**
   - any `src/sim` edit, even cosmetic, needs a hub refresh
   - don't hand-edit the 88 generated `BEGIN/END` regions
   - README points to a stale hub branch
   - fighter count is stale (131 vs 254)

   S.
4. **Show online desync in the status line and telemetry** (✔ bug #26). SM4 transition table. S.
5. **SM1 `fighterAction` selector,** adopted by render and poseAtlas. S–M.
6. **Sound effects and screen shake,** presentation-only. Fire them on confirmed events so rollback doesn't replay them. There is no SFX today. M.
7. **Typecheck `tests/`** and add a lint baseline. S.
8. **SM3 `RoundFlow`.** M.
9. **One sim bump batch:**
   - SM2 throw predicates
   - a `FRAME_DATA` module
   - per-fighter quirks (22 id branches in the sim) moved into `COMBAT_STYLES` fields

   M; needs goldens plus a hub re-vendor.
10. **Split `roster.ts`** (190 KB, lines up to 3,264 characters). Move display strings and colours out of hashed state, which stops renames forcing a re-sync. M–L; planned hub sync.

Later: a "reduce flashes" canvas option, colourblind options.

### 3.6 Sproto-Arcade

Respect AGENTS.md: authored timing, trajectories, RNG, damage and armor windows are preserved. Selectors must be derived, never stored.

**State machines**

| # | Machine | Do |
|---|---|---|
| SM1 | Checkpoint run kind (`phaseCheckpointRun` skips the local save) | `runKind` union; split `levelCleared` into `recordLocalClear` and `reportHubClear` (owner decision 1) |
| SM2 | Story `mode` (`loading\|title\|play\|paused\|clear\|lost\|won`, set from sim and UI) | legal-transition guard in browser code only; values unchanged, so the hash is unchanged |
| SM3 | Boss encounter (`boss.phase`, `phaseShift`, `transition`, density state) | derived `encounterStage()` |
| SM4 | Pickup lifecycle (`{spawned, done}`) | derived `planStatus()` |
| SM5 | Machine Trials `World.state` (already explicit) | document its table; add a `barrageGate(w)` hook in place of hard-coded stage ids |
| SM6 | Player defense timers | derived `defenseState(p)` plus a table-driven hit-precedence test |

**Top 10**
1. **Docs and AGENTS cleanup:**
   - 12 → 13 encounters, 24 → 52 sheets
   - the PHASE-POWERUPS gate is stale
   - SERVER-SIM describes a hub verifier the hub doesn't run
   - move the historical paragraphs into a dated History section
   - fix glued numbers ("levels1 and2") that break grep
   - document that the production hub mode lives in `legacy.html`

   S.
2. **Parity tests:**
   - campaign order is defined twice (`levels.js` and `order:1.5`)
   - shared pickup, shield and retry constants in both runtimes
   - server-entry stubs touch only `mode`

   S.
3. **`jsconfig`/`@ts-check`** on `runtime/`, the shared modules and `hub-link.js`. S.
4. **SM1 checkpoint persistence** (owner decision 1), plus `checkpoint.test.js` and `check-server-bundle`. S.
5. **SM2 mode guard.** Goldens prove it is neutral. S.
6. **SM3, SM4 and SM6 derived selectors.** S.
7. **SM5 table doc and `barrageGate` hook.** S–M.
8. **Input:**
   - keymap and gamepad layer feeding `readKeyboardFrame`; replays record inputs, so the sim is unaffected
   - saved remaps
   - mute/volume and a reduced-motion option
   - a message instead of a silent reload when boss-sheet code is missing

   M.
9. **Boss sheets** (115 MB of PNG) to lossless WebP or trimmed atlases with a PNG fallback. `sprite-hitboxes.js` (853 KB on one line) to per-stage JSON. That second change touches the bundle, so it needs goldens. M.
10. **Two-runtime convergence plan:** shared player, hit and pickup modules. L. Scope it only after 1–9 and owner decision 6.

### 3.7 peoples-bitcoin

Remember the hash roots (§0). AGENTS.md rules apply: tunables in `balance.ts`, `src/sim` pure, Vitest tests, choices recorded in DECISIONS.md, and README/TODO/CHANGELOG updated after each phase.

**State machines**

| # | Machine | Do |
|---|---|---|
| SM1 | Player activity (6 nullable fields: `action/dialogue/interface/path/teleport/dyingUntil`) | Now: `canAct`/`isBusy` guards, clear `teleport` in `startDying`, failing tick test first, DECISIONS entry (owner decision 3). Later: one `activity` union (L, save v8 migration) |
| SM2 | Dialogue latch (`waiting` cleared only on a key change) | `reading(page)\|awaiting(sentKey, sentAt)` with a timeout, plus `choosing`; a sim dialogue sequence number; keep the "prompt stays still" rule |
| SM3 | Client boot and online (`frozen/resetting/showKick`) | `ClientPhase = worldSelect\|joining\|playing\|kicked(reason)\|tabLocked\|resetting`, first kick reason wins; don't cache a rejected `connect()` |
| SM4 | Server session (`expired` never resets on reconnect) | `conn: connecting\|live\|grace(until)` plus `hub: open\|closed`; sim bump |
| SM5 | Ledger orders | leave; document `finishPurchase` as the one out-of-tick exception, or route it through an intent |

**Top 10**
1. **Clamp hub sell packs to the number owned,** reusing the sim's helper. Add a `hub-duplication.test.ts` case. S, no sim bump. (✔ bug #1)
2. **AGENTS.md:**
   - the sim-hash roots and the `pb-sim.js` rebuild rule
   - client-only tunables go outside the hashed folders
   - `tsconfig.sim.json` covers `src/server`

   S.
3. **CI fails on every sim-project type error.** Today errors outside `sim`/`config` are filtered out. Run `tsc -p tsconfig.sim.json` locally first to see the backlog. S.
4. **SM3** kick overlay and freezing `queue`. Add a jsdom test. S.
5. **SM2** dialogue awaiting state. Add a DialogueBox test and keep the CSS test. S.
6. **Lint guards and a hard-rules test:**
   - lint: no `Math.random`/`Date`/`performance`/`localStorage` in `src/sim` or `src/server`
   - a string test for hard rules 1–3

   S.
7. **Loading screen with error and retry.** Load assets *before* joining a world: today other players see you before your own art has loaded. S–M.
8. **SM1** teleport death (sim bump; owner decision 3). S.
9. **Move `assets.manifest.json` out of the hashed `src/config`** so art swaps stop changing `SIM_VERSION`. One-time bump. S.
10. **Docs pass:**
    - DESIGN §1 lists about a dozen files that don't exist
    - DESIGN still mentions Colyseus and the price sparkline
    - the 5-state Sproto AI description is wrong
    - CHANGELOG has gaps
    - `package.json` says 0.1.0 while CHANGELOG is at 0.7.0

    Then split `host.ts` (1,156 lines) and `main.ts` (998), and do per-zone meshopt loading. M–L.

Later: audio (none today), a settings model with reduced motion and colour-blind hitsplats, a timeout on `exitToHub`, batched `writeOnline`, and deleting the dead economy code (owner decision 3).

### 3.8 sproto-shooter

**State machines**

| # | Machine | Do |
|---|---|---|
| SM1 | PvP director: rejoin and ready | rebind the session on RESYNC/HELLO for the same account; `ready()` requires `connected`; transition table; test with a new `sessionId`; leave `sim.js` alone |
| SM2 | PvP client view | reducer where `done` is terminal |
| SM3 | Game screens (`playing/hubLeaveArmed/paused(never read)/…`, read from the DOM every frame) | `screen` union owned by Game; cancel the `bossFightOver` timeout; route `restoreCheckpoint` through the action log |
| SM4 | Hub link plus matchmaking | derive `connected`/`bankable` from `status`; a queued state plus `removeMatchmaker` (stops double tickets) |
| SM5 | Wave director (already an explicit switch) | document it as a table |

**Top 10**
1. **Add AGENTS.md.** It should cover the checks; the pins `3c657fb5`, `f5949631` and `ce272de1`; "never edit `src/sim/pvp` without a rebuild"; and the Go 1.26 and Chromium needs.
   Also fix these docs:
   - README: says 30 tests (there are 151) and "no multiplayer"; layout and keys are stale
   - `.cursor/rules`: names 7 paths that don't exist
   - `CODEX_PLAN.md`

   S.
2. **PvP input lead and per-tick sending.** Client only: estimate the cursor, stamp `cursor+lead` within `futureFrames`, and send one input per tick. Write a latency-injecting mock test first. S–M; golden and pin unchanged. (✔ bug #3)
3. **SM1 rejoin.** M. (✔ bug #4)
4. **`Game.frame` try/finally, and a catch with Retry in `boot()`.** S.
5. **Drop the `ControlLeft` slide binding.** S.
6. **Guards:**
   - lint all of `src/` (only 5 files today)
   - purity scan over every esbuild metafile input for both bundles
   - a test that fails if `sim/pvp` imports `net/`; move the codec and op table into `sim/pvp` (rebuild, no protocol change)

   S.
7. **SM2 monotonic phase.** S.
8. **SM4 matchmaking queued state.** Do it before the hub PvP handler goes live. M.
9. **SM3 screen union and action-logged checkpoint restore.** M; protected by `baseline-hashes.json` and the boss goldens.
10. **Split `renderer.js`** (1,462 lines, the top churn file). Pool the per-boom materials and per-tracer colours. Stop the 600-projectile cap from deleting boss shots mid-flight. M–L; protected by render regression and screenshots.

Later:
- a "behaviour digest" fixture (the campaign fingerprint doesn't cover enemy AI or boss attack data)
- hide Sandbox, Test Range and god mode in production
- remap UI, gamepad and colourblind support
- production `nakamaUrl` guard and an init timeout

### 3.9 Sproto-Coop-Battle.

Pinned files are `sim.js`, `ai.js`, `net-protocol.js` and `manifest.js`. Everything else is free to change.

**State machines**

| # | Machine | Do |
|---|---|---|
| SM1 | App screen × role (`screen/role/paused/hub.confirming/net/authority`, about 30 writers) | Now: read the mode from `authority.view()` for the banked role. Later: a `{kind: local\|host\|guest\|banked}` union |
| SM2 | Authoritative client phase (`net-hub.js`, phase plus 9 flags) | table with terminal states; reconnect expiry ends the session; late WELCOME/RESUME can't rewind `ended`; P is kept during the return confirm |
| SM3–5 | Sim stage, boss and player/enemy states | leave them (pinned); extract the "can be hit" helper only at the next re-pin |

**Top 10**
1. **Committed-pin guard test:** check the four file sha256s and `bundleSha256` against `build/coop-sim.pin.json` *before* rebuilding. Fail when `UPDATE_GOLDENS` is set in CI. S. (✔ bug #5)
2. **SM1 banked leave confirm** in `main.js`. Write an e2e or HUD test first. S. (✔ bug #6)
3. **Move the goja p95 < 25 ms assertion out of `npm test`.** Coop's own release doc recorded 28 ms. S.
4. **Add AGENTS.md** (pinned files, the re-pin procedure, Go 1.26, `dist` vs `npm start`). Fix the README: CPUs reach game over on stage 1 rather than clearing 12; snapshots are 2.2–3.5 KB, not 1.2; the code map is stale. Also fix the stale coop-hub and contract docs, and the two different seed-3 goldens. S.
5. **`NetHub.FINGERPRINT === pin.contentSha256` test** and a single opcode source shared with the tests. S.
6. **SM2 net-hub table.** Write an "END then late WELCOME" test first. M.
7. **CI:** add `actions/setup-go` 1.26, and make the test runner report every failure instead of stopping at the first `&&`. S.
8. **Move the 240 unused pose PNGs out of `public/`.** The budget margin is about 305 KB today. Consider WebP. S–M.
9. **Trusted-proxy option for the relay's per-IP limits.** Behind a proxy, every client shares one IP. S.
10. **Measure the banked input reject rate under jitter.** The pinned window is `tick+1..+3`. Then add an in-game controls card and a solo-difficulty note (a CPU-only team loses on stage 1). Fix the "12-character code" copy (codes are 4 letters). M; rebalancing means a re-pin.

---

## 4. Suggested rollout (waves): SUPERSEDED by §R.7, kept for reference

Within a wave, items in different repos can run in parallel because they touch different files.

| Wave | Content | Why first |
|---|---|---|
| **W0: safety nets** (no behaviour change) | Fighter golden-hash fixture, Coop committed-pin test, CI typecheck gaps (Duel, PB sim project, hub tests), nobu lint script, S2 docs/CONTRACTS/AGENTS (Shooter, Coop), S3 CI hygiene | Every later change relies on these to prove nothing broke |
| **W1: verified bugs, client-only, S** | PB sell clamp; Duel escaping, `stopSim` and KO pause; Shooter input lead, per-tick send and Ctrl binding; Coop banked confirm; HPOS10I and nobu crash-proof loops; hub empty-key build guard and fake Bar rows; nobu outbox filter (S4); Fighter desync surfacing | Real player-facing bugs, no hash or pin impact |
| **W2: SDK and server foundations** | S1 re-vendor, hub ledger indexes, zombie socket and chat fixes, S5 mock parity, S6 additive server fields, pin `pb-sim.js` | Unblocks the shared state model |
| **W3: explicit state machines, no hash change** | Derived selectors (Fighter, Arcade, Duel), UI/flow unions (Duel app flow, HPOS10I LevelPhase, nobu Screen and SessionPhase, Coop net-hub, Shooter screens and client view, hub input-owner and travel, PB dialogue and ClientPhase) | Biggest UX/DX/AX win, guarded by W0 nets |
| **W4: SDK 0.7 and contract.ts** | S7, S8, then S9 game by game | Gives one shared state vocabulary and one UI wording |
| **W5: deliberate version bumps** (batched, one per repo, with a planned hub refresh) | PB teleport death and session flags; Fighter frame data, throw predicates, quirks to data and roster split; Duel CONFIG split; Arcade hitbox JSON; Shooter codec move; S10 sim-pin manifest | Each bump costs a re-vendor, so batch them |
| **W6: game feel and accessibility** | SFX and shake (Fighter), audio (PB, hub), remap/gamepad/volume/reduced motion (Arcade, HPOS10I, nobu, Duel, PB), asset diets (nobu, Duel, Arcade, PB, hub), nobu hitstop and faster retry | Player-visible polish once the flows are stable |
| **W7: large refactors** | Duel legacy-engine retirement, nobu `game.js`/`session.js` split, hub `schema.ts` split, Arcade runtime convergence (owner decision 6), S11/S12 | Highest effort; only after everything above is in place |

Each item becomes its own branch and PR, following that repo's AGENTS.md, with checks run and a reviewing agent.

**Approvals needed before W1 starts:**
- whether to start
- the owner decisions in §1 that block specific items

Items not blocked can start right away.
