# Handoff: realtime hub (owner actions only)

Everything else (code, tests, docs, the decisions in `docs/realtime.md` § Decisions) is done on branch `claude/loving-galileo-ndy2tu`. These steps need you.

1. **Merge in migration order.** The schema runner refuses an unapplied migration below the highest recorded one, so merge and deploy in this order (or all together): this hub PR (`0011`, `0012`), then the People's Bitcoin hub PR (`claude/pb-world`, `0013`–`0019`), then the Sproto Duel hub PR (`claude/sproto-arena`, `0020`–`0024`). If a lower range has to ship after a higher one is already live, renumber it above the highest recorded id before merging.

2. **Re-vendor the SDK into the games from hub `main`** after the merges (the SDK's early-match-message fix landed after `contract/hub-v1`), then run each game's checks and redeploy its build:
   ```bash
   cd /path/to/metaverse-hub && git checkout main && git pull && npm ci
   npm run vendor:sdk -- /path/to/nobu --branch main
   npm run vendor:sdk -- /path/to/sproto-duel --branch main
   npm run vendor:sdk -- /path/to/peoples-bitcoin --branch main
   ```

3. **Deploy the server and hub on the VPS** (bootstrap rebuilds the Nakama image from `server/Dockerfile`; migrations run at boot). Build `dist/hub` and the game dists on your build machine and `rsync` them up as in `deploy/README.md` step 5, then:
   ```bash
   cd /opt/metaverse && git pull
   deploy/scripts/bootstrap.sh
   /opt/metaverse/deploy/scripts/deploy-hub.sh /tmp/hub-dist
   /opt/metaverse/deploy/scripts/deploy-game.sh nobu /tmp/nobu
   /opt/metaverse/deploy/scripts/deploy-game.sh sproto-duel /tmp/sproto-duel
   /opt/metaverse/deploy/scripts/deploy-game.sh peoples-bitcoin /tmp/peoples-bitcoin
   docker compose --project-directory /opt/metaverse/deploy --env-file /opt/metaverse/deploy/.env \
     -f /opt/metaverse/deploy/compose.yml logs --tail 80 nakama | grep -E "hub shard|runtime ready|error"
   ```
   The log must show `hub shard 1 up` and `metaverse hub runtime ready`. The new runtime knobs in `deploy/nakama/config.yml` (64 JS VMs, 8 KB socket messages, 256-deep queues) apply on this restart.

4. **Cloudflare:** confirm Network → WebSockets is on and the "Bypass the API" cache rule (deploy/README.md § Cloudflare) covers `/ws` on both `<domain>` and `play.<domain>`. Then open `https://<domain>/hub/` in two browsers and check the status line reads `World 1 · 2/100`.

5. **Size the box with a load test on staging (not production):**
   ```bash
   npm run load:plaza -- --bots 100 --seconds 120 --url https://<staging-host> --server-key <NAKAMA_SERVER_KEY>
   ```
   Targets: p95 download ≤ 16 KB/s, max ≤ 40 KB/s, upload ≤ 1 KB/s per bot, and Nakama CPU under ~70 % (`docker stats`). Bots fill world 1 to 90, then open world 2. If the plaza plus PB worlds go over ~70 % CPU, move to a CCX33. More than one node means Heroic Cloud / Nakama Enterprise (Nakama OSS does not cluster).

6. **Play-test the plaza with real people** (two or more machines, ideally one guest and one account): see each other move, chat (`red:wave:hi`), `/ignore` and `/report`, walk into the Bar together, take a portal and come back to the same world, close a laptop lid for ~10 s and reopen (should rejoin). On a mid laptop with many players, the dev overlay (`npm run dev`, `?bots=99`) read ~165 draws with the 6 nearest players as full avatars in headless Chrome; if real hardware drops below ~55 fps, lower `NEAR_MAX` in `apps/hub/src/remotes.ts`.

7. **Moderation:** decide who reads `game.chat_report` and mutes people, and how often. Until a `chat.mute` RPC exists, mute and read reports with SQL (see `server/README.md` § Realtime):
   ```bash
   cd /opt/metaverse/deploy
   docker compose --env-file .env -f compose.yml exec -T postgres psql -U postgres -d nakama -c "SELECT created_at, reporter, target, text, reason FROM game.chat_report ORDER BY created_at DESC LIMIT 50"
   docker compose --env-file .env -f compose.yml exec -T postgres psql -U postgres -d nakama -c "INSERT INTO game.chat_mute (user_id, until, reason) VALUES ('<uuid>', now() + interval '1 day', 'spam')"
   ```

8. **Optional:** extend the profanity/slur seed lists in `server/modules/src/chat_words.ts` (`MASK` plain words, `HARD_ROT13` ROT13-encoded slurs).

9. **Checks I could not run here:** the GitHub Actions run itself (CI now runs `npm run test:rt` after `npm run test:dup`), and a test against the production Caddy/Cloudflare path (`wss://<domain>/ws`). Both happen when the PR is pushed and deployed. Locally every `test:dup` group passed and `test:rt` passed, except the 11 `fault … x100` cases, which hit their 150 s budget in this sandbox; the same case times out identically on `main` here, so it is machine speed, not this change. Watch that the CI `duplication` job (which passed on `main`) stays green.
