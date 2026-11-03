#!/usr/bin/env bash
# Install the repo Caddyfile, the origin certificate paths, and the systemd env file.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
"$(dirname "$(readlink -f "$0")")/check-env.sh"

file="$(deploy_dir)/.env"
domain="$(read_env "$file" DOMAIN)"
install -d -m 755 /etc/caddy/certs /etc/systemd/system/caddy.service.d
if [ ! -s /etc/caddy/cloudflare-proxies.caddy ]; then
  echo "missing /etc/caddy/cloudflare-proxies.caddy. Run deploy/scripts/cloudflare-ufw.sh first." >&2
  exit 1
fi

if [ ! -s /etc/caddy/certs/origin.pem ] || [ ! -s /etc/caddy/certs/origin.key ]; then
  echo "put the Cloudflare origin certificate at /etc/caddy/certs/origin.pem and the key at /etc/caddy/certs/origin.key" >&2
  exit 1
fi
chown root:root /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
chmod 644 /etc/caddy/certs/origin.pem
chmod 600 /etc/caddy/certs/origin.key

umask 022
{
  printf 'DOMAIN=%s\n' "$domain"
  for key in GAME_COOP_HPOS10I GAME_COOP_NOBU GAME_COOP_PEOPLES_BITCOIN GAME_COOP_SPROTO_DUEL; do
    val="$(read_env "$file" "$key")"
    if [ -z "$val" ]; then
      val=0
    fi
    printf '%s=%s\n' "$key" "$val"
  done
} > /etc/caddy/metaverse.env
chmod 644 /etc/caddy/metaverse.env

install -m 644 "$(deploy_dir)/Caddyfile" /etc/caddy/Caddyfile
cat > /etc/systemd/system/caddy.service.d/metaverse.conf <<'EOF'
[Service]
EnvironmentFile=/etc/caddy/metaverse.env
EOF

systemctl daemon-reload
set -a
# shellcheck disable=SC1091
. /etc/caddy/metaverse.env
set +a
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
else
  systemctl start caddy
fi
echo "caddy is serving ${domain} and play.${domain}"
