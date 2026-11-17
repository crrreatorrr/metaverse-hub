# Coop Battle tickets

Banked Coop clears pay **20 Tickets** once per account, per canonical boss, per UTC day. The match settles that inside Postgres. A client `tickets.earn`, `session.event`, or `score.submit` cannot name the payout, and there is no positive `event_rule` for `sproto-coop-battle`.

The inherited caps are unchanged: **200 Tickets per game session** and **1,000 Tickets per account per game per UTC day**. Those caps are not global across games. Duel, Fighter, and Shooter keep their own rules. V Coin gates are unchanged.

A full sweep is 12 bosses × 20 = **240 Tickets**. The session cap stops that sweep at **200** (ten awards). The 11th and 12th clears in that session pay 0. Opening another session does not reset a boss that was already credited today, and it is not a way around the cap. A boss the first session never credited can still pay later the same day, under that new session's 200 cap and the same 1,000 daily cap. The daily boss bucket resets at **00:00 UTC**, which is **7:00 PM in Lima (UTC−5)**.

## One clear, one account

Each of the twelve stages is one canonical boss. Phase 1 and phase 2 are that same clear. There is no phase multiplier and no per-seat multiplier. One account holding all six local seats receives one award of 20, not 120.

| Boss id | Stage | Pilot | Machines (phase 1 / phase 2) |
|---|---|---|---|
| `01-marina-bront` | Tidebreak Marina | bront | Breakwater Tug / Dry Dock Press |
| `02-last-light-vela` | Last Light Bar | vela | Prism Projector / Mirror Gantry |
| `03-mudline-crapto` | Mudline Trenches | crapto | Sludge Dredger / Floodgate Pump |
| `04-ranch-zephyr` | Sproto Ranch | zephyr | Lantern Harvester / Harvest Express |
| `05-neon-sproto102` | Neon Tomorrow | sproto102 | Salvage Strider / Billboard Rig |
| `06-circuit-rune` | Circuit Gate | rune | Relay Walker / Gate Spider |
| `07-moonkeep-bigswole` | Moonkeep Castle | bigswole | Siege Dragon / Rampart Dragon |
| `08-crown-alpha777` | Crown Relay Chamber | alpha777 | Jackpot Knight / Crown Joust Rig |
| `09-hatchery-highsproto` | The Hatchery | highsproto | Incubator Crane / Brood Crawler |
| `10-verse-sprotosales` | Verse Gate | sprotosales | Sales Carrier / Orbital Showroom |
| `11-rooftop-sproto1668` | Rooftop Breakaway | sproto1668 | Pursuit Jetpack / Intercept Glider |
| `12-codebreak-sproto3106` | Codebreak Ascent | sproto3106 | Warrant Rig / Summit Lockdown |

Names are the current manifest. Display names that are not in that manifest are not invented here.

## Who is paid

The account must hold a redeemed `sproto-coop-battle` session, own at least one human seat when the encounter starts, and still be eligible at the clear. The server seals that decision with the terminal tick and the UTC day. A retry uses the sealed day. It does not move the receipt to tomorrow.

Eligible:

- Present on a human seat at the encounter's first ticks.
- Not AFK. AFK means zero non-neutral inputs and at least 300 alive-neutral ticks after the 180-tick opening. Down ticks are not neutral. There is no damage minimum, so a downed or support player is not dropped for dealing no damage.
- Still inside the 15 second reconnect grace, or back on their seat. Grace time is not added to the AFK clock.

Not eligible:

- CPU-only demo, practice, God Mode, or a stage jump.
- A seat taken after the encounter started.
- AFK, as defined above.
- A seat released to CPU after the 15 second grace. That player can be eligible on the next encounter if they are there at its start.
- Out for the kill (`knocked_out`): every seat of the account was dead when the boss fell. A downed seat is not dead. The flag is per encounter, so the next boss starts clean.
- A closed session, an expired lease, or a missing login. The replacement session does not receive that terminal's award.

The Marina Anchor Relic is a separate grant at a banked stage-1 clear. It ignores the Ticket decision (practice, God Mode, a stage jump, a late seat and AFK still get it), with two exceptions shared with Tickets: a seat released to CPU, and an account that was out for the kill. An account that was out gets the Anchor on its next stage-1 clear where it is not out.

Guests can play. Banking still requires a redeemed game session. An anonymous socket cannot mint.

## Receipts and the board

`0041_coop_boss_receipt` adds `game.coop_eligibility` and `game.coop_receipt`. The credit, the boss/day bucket, the score, and both rows commit in one function. A crash after that commit returns the stored receipt. A crash inside the credit rolls the whole attempt back. `0036` and `0038` are not used.

Each receipt, board row and eligibility row stores the fingerprint of the Coop sim that settled it. The live function seals a request with a mismatched fingerprint as `bad_version` and pays no Tickets. The value is `CoopRewards.FINGERPRINT`, which must equal `CoopProto.FINGERPRINT` (the vendored `contentSha256`). The settlement migrations advance the live fingerprint from `f8705ec4…` in `0041` to `fb9f2679…` in `0063`, then to `d1ca2efc…` in `0071` and `1bdabcab…` in `0072`. Previous clears keep their receipt, Tickets and stored answer, and a retry still returns that answer. A re-vendor that changes `contentSha256` needs a new fingerprint constant and SQL migration. `server/test/games/coop_rewards.test.ts` checks both.

The board is `coop_stage_clear_ms_v1`, lower time better, one row per account per boss. Metadata records whether the clear was `all_human` (six human seats) or `cpu_assisted`. It is not part of the meta score. Clients cannot post the board.

The opcode field `rewards` stays 0. The ledger is the payout.
