# Production

One Hetzner CCX VPS. Nakama and Postgres run in Docker Compose. Caddy runs on the host and terminates TLS. Cloudflare proxies the public names (orange cloud).

Caddy is a host service, and Compose publishes Nakama only on `127.0.0.1:7350`, because that is the upstream the edge proxies. The apex and `play.<domain>` both reverse-proxy `/v2/*` and `/ws` there, and `/ws` is upgraded as a WebSocket. Pages stay on the host that served them. Host Caddy is also covered by ufw. A container that publishes 80 or 443 would accept those ports in Docker's iptables chain, which ufw does not control.

Nothing in this folder calls Hetzner or Cloudflare. It does not contain passwords, tokens, or certificates.

## What Ken provides

Accounts:

- A domain, and the registrar login if the nameservers still need to move to Cloudflare.
- A Hetzner Cloud account, an SSH public key added to that project, and a CCX server. Start with a **CCX23** (4 dedicated vCPUs, 16 GB RAM) and at least 80 GB of disk. A CCX13 (2 dedicated vCPUs, 8 GB RAM) is enough to boot the stack and run the 10-player check. Pick the region closest to the players. Image: Ubuntu 24.04.
- A Cloudflare account with the domain added as a zone.

A Cloudflare API token is not used. DNS, SSL, and cache rules are dashboard steps below. If you later automate them, a token scoped to this zone needs Zone Read, DNS Edit, Cache Rules Edit, and Zone Settings Edit. Do not put that token on the VPS.

Files and secrets, created by you and kept out of git:

- `deploy/.env`, mode `600`, copied from [`.env.example`](.env.example). Generate each secret with `openssl rand -hex 32`. The checker rejects the dev values (`defaultkey`, `localdb`, `localhttpkey`, and the rest of that list).
- The Cloudflare origin certificate and its private key, installed on the VPS as `/etc/caddy/certs/origin.pem` and `/etc/caddy/certs/origin.key`.
- Optional: `SSH_ALLOW_CIDR` (your IP as a `/32`) and `BACKUP_RSYNC_TARGET` (a host that already accepts this VPS's root SSH key).

`NAKAMA_SERVER_KEY` is the only Nakama value that belongs in a client. Inject it at build time from CI secrets or an uncommitted `.env.production`. Leave `serverUrl` unset. Production pages call `/v2` and `/ws` on the host that served them. `serverUrl` is for dev, mock, and QA only.

`NAKAMA_HTTP_KEY`, the console password, and the console signing key stay on the server. They must not appear in a client bundle. `TICKET_HMAC_KEY`, `RECOVERY_PEPPER`, the session keys, and `POSTGRES_PASSWORD` stay on the server too.

`deploy/scripts/check-dist-secrets.sh` reads the dist before a publish. It fails if any file contains a dev default (`defaultkey`, `localhttpkey`, `localdb`, and the rest of that list) or the live HTTP key, console password, or console signing key. A bundle that still has the dev server key does not ship.

Builds you produce elsewhere and copy to the VPS:

- Hub: the complete Vite `dist` directory (`hub/index.html`, `realm/<id>/index.html`, `realm-pages.txt`, and `assets/`).
- One directory per game, with `index.html` at its root. Asset URLs have to resolve under `/<game-id>/`. A relative base (`./`) does that. An absolute base has to be `/<game-id>/`.

| Public URL | Directory | Nakama game id in this repo |
| --- | --- | --- |
| `https://play.<domain>/hpos10i/` | `/srv/play/hpos10i/current` | `hpos10i` |
| `https://play.<domain>/nobu/` | `/srv/play/nobu/current` | `nobu` |
| `https://play.<domain>/peoples-bitcoin/` | `/srv/play/peoples-bitcoin/current` | `peoples-bitcoin` |
| `https://play.<domain>/sproto-duel/` | `/srv/play/sproto-duel/current` | `sproto` |
| `https://play.<domain>/sproto-fighter/` | `/srv/play/sproto-fighter/current` | `sproto-fighter` (the Bar's arcade cabinet, no plaza ring) |
| `https://play.<domain>/sproto-arcade/` | `/srv/play/sproto-arcade/current` | `sproto-arcade` (the Bar's arcade cabinet, no plaza ring) |

Sproto Duel's public path is `sproto-duel`. The game id stored by Nakama in this repo is `sproto`. Portal URLs in `apps/hub/src/config.ts` still point at `/play/<id>/` on the hub origin. Point them at `https://play.<domain>/<path>/` when you build the hub for production. HPOS10I's web build includes a file of about 37.7 MiB. The cache notes below are written for that file.

## Layout

```
deploy/compose.yml                 Nakama + Postgres
deploy/Caddyfile                   host Caddy
deploy/nakama/config.yml           template, secrets substituted at start
deploy/nakama/render-config.sh
deploy/cloud-init.yaml             optional Hetzner user data
deploy/scripts/bootstrap.sh        packages, firewall, docker, caddy, first start
deploy/scripts/install-caddy.sh    Caddyfile, cert paths, reload
deploy/scripts/cloudflare-ufw.sh   80/443 from Cloudflare ranges only
deploy/scripts/deploy-hub.sh
deploy/scripts/deploy-game.sh
deploy/scripts/check-dist-secrets.sh
deploy/scripts/backup-postgres.sh
deploy/scripts/check-env.sh
deploy/scripts/godmode.sh          owner godmode for The People's Bitcoin Tickets
```

On the server:

```
/opt/metaverse                      git checkout
/srv/hub/releases/<stamp>/          hub dist
/srv/hub/current                    symlink to the live release
/srv/play/<id>/releases/<stamp>/
/srv/play/<id>/current
/var/backups/metaverse/             local pg_dump files, mode 600
/etc/caddy/Caddyfile
/etc/caddy/cloudflare-proxies.caddy trusted proxy ranges, rewritten weekly
/etc/caddy/metaverse.env            DOMAIN and the five COOP toggles, no secrets
/etc/caddy/certs/origin.pem
/etc/caddy/certs/origin.key         mode 600
```

`current` is a relative symlink. A deploy writes a new release directory, precompresses it, then `mv -Tf` the symlink into place. Readers see the old tree or the new tree. The previous three releases stay on disk.

## Bring-up

1. In Cloudflare, add the domain. Create the origin certificate before the server is useful, under SSL/TLS → Origin Server → Create Certificate. Hostnames: `<domain>` and `*.<domain>`. The wildcard does not cover the apex, so both lines have to be there. Save the certificate as `origin.pem` and the key as `origin.key`. 15 years is fine. This certificate is trusted by Cloudflare, not by browsers.

2. Create the Hetzner server. Type CCX, Ubuntu 24.04, your SSH key selected. You can paste [`cloud-init.yaml`](cloud-init.yaml) as user data. That only locks the box down (SSH keys, no password login, inbound deny except port 22, unattended security upgrades, UTC). Docker and Caddy come from bootstrap.

3. SSH to the **public IP**, not to the proxied hostname. Cloudflare does not forward port 22.

   ```bash
   git clone https://github.com/crrreatorrr/metaverse-hub.git /opt/metaverse
   cd /opt/metaverse
   umask 077
   cp deploy/.env.example deploy/.env
   chmod 600 deploy/.env
   ```

   Fill `DOMAIN` and the secrets. `openssl rand -hex 32` once per secret. The client build needs `NAKAMA_SERVER_KEY` from CI secrets or an uncommitted `.env.production`, not from this file's other keys. Leave `serverUrl` unset. Leave every `GAME_COOP_*` at `0` unless that game's build needs `SharedArrayBuffer`. HPOS10I ships with threads off, so it stays `0`.

   ```bash
   install -d -m 755 /etc/caddy/certs
   install -m 644 origin.pem /etc/caddy/certs/origin.pem
   install -m 600 origin.key /etc/caddy/certs/origin.key
   deploy/scripts/bootstrap.sh
   ```

   Bootstrap is safe to re-run. It installs Docker and Caddy from their official apt repositories, builds the Nakama image from `server/Dockerfile` unchanged, and starts Compose when `.env` is valid. The VPS needs outbound HTTPS to Docker Hub, `download.docker.com`, Cloudsmith, Ubuntu, and `https://www.cloudflare.com/ips-v4` (and the v6 list).

4. Point DNS, then open the cache rules in the next section. From your laptop:

   ```bash
   curl -fsS -o /dev/null -w '%{http_code}\n' https://<domain>/hub/
   curl -fsS -o /dev/null -w '%{http_code}\n' https://play.<domain>/hpos10i/
   ```

   Both answer `200` once DNS has propagated. Before a real build is deployed, the body is the placeholder. From the VPS, Nakama's own check is:

   ```bash
   docker compose --project-directory /opt/metaverse/deploy \
     --env-file /opt/metaverse/deploy/.env \
     -f /opt/metaverse/deploy/compose.yml exec nakama /nakama/nakama healthcheck
   ```

   `https://<domain>/v2/` should not be a gateway failure. A 401 or 404 from Nakama means the proxy reached the process.

5. Deploy the hub and each game. Build the hub with `VITE_NAKAMA_SERVER_KEY` set to this server's `NAKAMA_SERVER_KEY`; the build refuses an empty key. On the build machine, before the upload:

   ```bash
   deploy/scripts/check-dist-secrets.sh dist/hub dist/hpos10i dist/nobu dist/peoples-bitcoin dist/sproto-duel dist/sproto-fighter dist/sproto-arcade
   ```

   `rsync` the complete trees to the VPS, including the hub’s `realm-pages.txt` and every listed realm page, then publish only when authorized. `deploy-hub.sh` and `deploy-game.sh` run the same check again and refuse the swap when it fails.

   ```bash
   /opt/metaverse/deploy/scripts/deploy-hub.sh /tmp/hub-dist
   /opt/metaverse/deploy/scripts/deploy-game.sh hpos10i /tmp/hpos10i
   /opt/metaverse/deploy/scripts/deploy-game.sh nobu /tmp/nobu
   /opt/metaverse/deploy/scripts/deploy-game.sh peoples-bitcoin /tmp/peoples-bitcoin
   /opt/metaverse/deploy/scripts/deploy-game.sh sproto-duel /tmp/sproto-duel
   /opt/metaverse/deploy/scripts/deploy-game.sh sproto-fighter /tmp/sproto-fighter
   /opt/metaverse/deploy/scripts/deploy-game.sh sproto-arcade /tmp/sproto-arcade
   ```

   Precompression uses `gzip -9` and `brotli -q 11`. The HPOS10I wasm can take a few minutes.

Clock is UTC via `systemd-timesyncd`. Daily caps and session expiry use server time.

## Cloudflare

Proxied records (orange cloud), all aimed at this VPS:

| Name | Type | Value |
| --- | --- | --- |
| `<domain>` | A | VPS IPv4 |
| `<domain>` | AAAA | VPS IPv6, if Hetzner assigned one |
| `play` | A | same IPv4 |
| `play` | AAAA | same IPv6, if you published the apex AAAA |
| `www` | CNAME | `<domain>` |

Leave them proxied. A grey-cloud name would present the origin certificate to the browser, which will not trust it, and ufw would drop the connection unless the client address is in Cloudflare's list. SSH uses the raw IP.

SSL/TLS:

- Encryption mode: **Full (strict)**.
- Always Use HTTPS: on.
- Minimum TLS version: 1.2.
- Edge certificate: Cloudflare's universal certificate. Visitors see that, not the origin certificate.
- Origin certificate: the one installed in `/etc/caddy/certs`.

Caching → Configuration → Browser Cache TTL: **Respect Existing Headers**.

Speed: leave Brotli on. Turn **Rocket Loader** and **Email Obfuscation** off so they do not rewrite the game shell. Network → WebSockets: on (the default).

Cache rules, in this order:

1. **Bypass the API.** If hostname equals `<domain>` or `play.<domain>` and URI Path starts with `/v2` or `/ws`: Bypass cache.
2. **Cache game packs.** If hostname equals `play.<domain>` and (file extension is `wasm` or `pck`, or the path matches a fingerprinted `index.<hash>.wasm`, `.pck`, or `.js`): Eligible for cache, Edge TTL respect origin, Browser TTL respect origin.

`index.html` is `Cache-Control: no-cache`. Cloudflare does not store that. Fingerprinted `index.<hash>.wasm`, `.pck`, and `.js` are `public, max-age=31536000, immutable`. Other game files get five minutes, so an unhashed name cannot sit on the edge for a year.

### Large files

HPOS10I's pack is about **37.7 MiB**. That is a download. Publishing it is `rsync` over SSH to the VPS IP, so Cloudflare's upload cap never sees it.

| Limit | Free / Pro | Business | Enterprise |
| --- | --- | --- | --- |
| Max cacheable object | 512 MB | 512 MB | 5 GB default |
| Max upload (request body) | 100 MB | 200 MB | up to 5 GB |

37.7 MiB is under 512 MB, so the edge can store it. A later pack over the plan limit is not stored: the response is `BYPASS` and every player pulls it from the VPS. `.js` is in Cloudflare's default cached extension list. `.wasm`, `.pck`, and HTML are not, which is why the cache rule exists. Without it, the wasm is an origin hit on every request.

Caddy's `precompressed` serves a sibling `.br` or `.gz` and sets `Content-Type: application/wasm` from the original name. Cloudflare may still recompress toward the browser. The siblings are there so an origin hit does not compress 37.7 MiB on the fly. Do not link to the `.br` or `.gz` URL directly. Caddy would otherwise answer those siblings with `206` and `Content-Range: bytes 0-`, and browsers treat a 206 the client did not ask for as a failed fetch. The file server forces `200` for that case. A real `Range` request still gets `206`.

`/v2` and `/ws` on the apex and on `play.<domain>` both proxy to Nakama on `127.0.0.1:7350`. `/ws` is the WebSocket, including the upgrade. Cloudflare closes a socket that goes idle; a custom idle timeout is an Enterprise setting. Nakama's `ping_period_ms` is 15000 so the connection keeps moving.

## COOP / COEP

Off for every game unless `GAME_COOP_<ID>=1` in `deploy/.env`. The names are `GAME_COOP_HPOS10I`, `GAME_COOP_NOBU`, `GAME_COOP_PEOPLES_BITCOIN`, `GAME_COOP_SPROTO_DUEL`, `GAME_COOP_SPROTO_FIGHTER`, and `GAME_COOP_SPROTO_ARCADE`. `1` sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on that game only. Then re-run `deploy/scripts/install-caddy.sh`. Turn it on only for a build that needs `SharedArrayBuffer`, and only when that build's assets are same-origin. A cross-origin script or font will fail once COEP is on.

## Firewall

ufw denies inbound, then allows:

- SSH. From `SSH_ALLOW_CIDR` when that is set, otherwise from anywhere. The warning from bootstrap is the prompt to set the CIDR or to do it in Hetzner's firewall instead.
- TCP 80 and 443, only from the ranges at `https://www.cloudflare.com/ips-v4` and `ips-v6`.

`metaverse-cloudflare-ufw.timer` refreshes those ranges weekly. The same run rewrites `/etc/caddy/cloudflare-proxies.caddy` and reloads Caddy. Stock Caddy has no built-in Cloudflare IP module, so that file is a `trusted_proxies static` list. It only changes which address shows up in the logs (`CF-Connecting-IP`). ufw is what actually refuses other clients.

Changing `SSH_ALLOW_CIDR` after the first run is a manual `ufw` edit: bootstrap will not delete a CIDR it added earlier. Deleting the SSH rule while you are connected is safe for the current session; add the new rule before you delete the old one.

Hetzner Cloud Firewall is a second door you configure in the console, same shape: 22 from your IP, 80 and 443 from Cloudflare's ranges, deny the rest. This repo does not call the Hetzner API.

Nakama's console is `127.0.0.1:7351` on the VPS. Postgres is not published. gRPC `7349` is not published.

```bash
ssh -L 7351:127.0.0.1:7351 root@<vps-ip>
```

Then open `http://127.0.0.1:7351` and use `NAKAMA_CONSOLE_USERNAME` / `NAKAMA_CONSOLE_PASSWORD`.

## Backups

`metaverse-backup.timer` runs `deploy/scripts/backup-postgres.sh` daily at 03:17 UTC. The dump is `pg_dump --format=custom` at `/var/backups/metaverse/nakama-<stamp>.dump`, kept for `BACKUP_RETAIN_DAYS` (default 14). A local disk is not a backup. Set `BACKUP_RSYNC_TARGET` when you have a second host.

Restore, with Nakama stopped so it is not writing:

```bash
cd /opt/metaverse/deploy
docker compose --env-file .env -f compose.yml stop nakama
docker compose --env-file .env -f compose.yml exec -T postgres \
  pg_restore -U postgres -d nakama --clean --if-exists --no-owner \
  < /var/backups/metaverse/nakama-<stamp>.dump
docker compose --env-file .env -f compose.yml start nakama
```

`POSTGRES_PASSWORD` is applied when the data volume is created. To rotate it, put the new hex in `.env`, then on the server:

```bash
cd /opt/metaverse/deploy
set -a
. ./.env
set +a
docker compose --env-file .env -f compose.yml exec -T postgres \
  psql -U postgres -v ON_ERROR_STOP=1 \
  -c "ALTER USER postgres PASSWORD '${POSTGRES_PASSWORD}'"
docker compose --env-file .env -f compose.yml up -d --force-recreate nakama
```

That `psql` command shows the password in the process list for the length of the command. Rotating `NAKAMA_SESSION_ENCRYPTION_KEY` or `NAKAMA_REFRESH_ENCRYPTION_KEY` logs every player out. Rotating `TICKET_HMAC_KEY` invalidates portal tickets that are still in flight.

## Upgrades

Unattended upgrades install Ubuntu security updates and do not reboot. Reboot for a kernel on purpose.

After a git pull that changes the Nakama module or this folder:

```bash
cd /opt/metaverse
git pull
deploy/scripts/bootstrap.sh
```

`HUB_FAULT_INJECT` is not set. The duplication-suite hook stays inert.

### Nakama shutdown grace

A restart (`bootstrap.sh`, `docker compose up -d` after a rebuild, `stop`, `restart`) sends Nakama `SIGTERM`. Nakama then gives every running match `shutdown_grace_sec` (60 s, in `nakama/config.yml`) to run `matchTerminate`, which refunds held wager escrow, writes coop checkpoints and saves People's Bitcoin worlds. `compose.yml` sets `stop_grace_period: 90s` on the `nakama` service, so Docker waits that long before it sends `SIGKILL`. Docker's default is 10 s, which killed Nakama before terminate could finish.

- Keep `stop_grace_period` at least 15 s above `shutdown_grace_sec`, and `shutdown_grace_sec` at 30 s or more. `scripts/deploy-grace.test.mjs` (part of `npm test`) fails if either rule breaks.
- A restart currently takes about 60 s. Every hub match handler's `matchTerminate` still returns its state instead of `null`, so Nakama waits out the whole grace window even when the match work is done. The 60 s is an upper bound only once `matchTerminate` returns `null` when finished (a separate server ticket). That wait is expected. Do not follow it with `docker kill`.
- Passing `-t`/`--timeout` to `docker compose stop|restart|up` overrides `stop_grace_period`. Leave it off, or give at least 90.
- The local stack (`server/docker-compose.yml`) keeps Nakama's default grace of 0 so the duplication suite's kill and restart cases stay fast. Graceful terminate is a production setting.

## Checks

```bash
deploy/scripts/check-env.sh
systemctl status caddy --no-pager
ufw status
docker compose --project-directory /opt/metaverse/deploy --env-file /opt/metaverse/deploy/.env -f /opt/metaverse/deploy/compose.yml ps
curl -fsSI https://play.<domain>/hpos10i/index.html | grep -i cache-control
curl -fsSI -H 'Accept-Encoding: br' https://play.<domain>/hpos10i/index.<hash>.wasm | grep -iE 'content-type|content-encoding|cache-control'
```

`index.html` is `no-cache`. The fingerprinted wasm is `application/wasm`, `immutable`, and `content-encoding: br` when the `.br` sibling exists and the client asks for brotli.


## People's Bitcoin godmode (owner)

`deploy/scripts/godmode.sh` keeps one account's `peoples-bitcoin` Ticket wallet at a fixed amount,
90,000,000,000 by default. Run it as root on the VPS after a deploy that includes migration
`0042_pb_godmode`:

```bash
sudo /opt/metaverse/deploy/scripts/godmode.sh on <username>
sudo /opt/metaverse/deploy/scripts/godmode.sh list
sudo /opt/metaverse/deploy/scripts/godmode.sh off <username>
```

`on` takes a username or a user id, and an optional amount as a third argument. It raises the
wallet right away. After that the server raises it again whenever People's Bitcoin reads the
balance (`tickets.balance` in a hub session, `HubEconomy.balance` in an online world), so spending
never runs it down for long. Each raise is one `tickets_ledger` row with reason `godmode` and no
session ref, so it bypasses the 200-per-session and 1000-per-day earn caps and the ledger still
sums to the balance. Exchanging Tickets for Verse keeps its own cap. `off` stops the top-ups and
leaves the Tickets in the wallet. Only this script writes `game.godmode_user`; no RPC can, so
turning it on needs root on the server.

## Realm pages (prepared; deploy only when the owner asks)

The hub build includes `/realm/sandbox/` as a separate HTML input. Its plaza gate is disabled
in production and requires `VITE_REALM_GATE_SANDBOX=1` in development. This preparation does not
launch the second world or authorize a deployment.

Caddy redirects bare `/realm/<id>` paths to their trailing-slash pages and preserves query
parameters. Realm pages, `/hub/`, and `.html` responses use `Cache-Control: no-cache`; hashed
assets keep their existing immutable caching. Do not add a production gate flag or change
Cloudflare rules until the owner approves launch.

Vite emits `realm-pages.txt` from its configured HTML inputs. Include that file when transferring
the complete dist. `deploy-hub.sh` checks `hub/index.html`, the manifest, and every listed realm
`index.html` before creating a release. Missing pages, a missing manifest, or paths outside
`realm/<id>/index.html` fail. The existing dist-secrets check still runs before release staging.
No Node runtime is required on the server for this check. A pre-realm build must be rebuilt to
produce the manifest before using the updated deploy script.

Validation for this change is local only: page-guard fixtures and Caddy validation use a
disposable container, test certificates and a dummy domain. No production config is reloaded.
