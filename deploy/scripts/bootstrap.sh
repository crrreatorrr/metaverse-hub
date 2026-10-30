#!/usr/bin/env bash
# Idempotent first-boot and re-run for the production VPS.
# Hardens SSH, installs unattended upgrades, Docker, and Caddy, and opens
# 80/443 only to Cloudflare. Starts Nakama when deploy/.env is valid, and
# starts Caddy when the origin certificate is installed too.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
umask 022

if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
fi
if [ "${ID:-}" != "ubuntu" ]; then
  echo "bootstrap.sh supports Ubuntu. This host is ${ID:-unknown}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y \
  ca-certificates curl gnupg rsync brotli gzip git \
  ufw unattended-upgrades apt-transport-https \
  debian-keyring debian-archive-keyring

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/51metaverse-unattended <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
EOF
systemctl enable --now unattended-upgrades

timedatectl set-timezone Etc/UTC
systemctl enable --now systemd-timesyncd

install -d -m 755 /etc/ssh/sshd_config.d
cat > /etc/ssh/sshd_config.d/99-metaverse.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh || systemctl reload sshd

if [ -f /etc/default/ufw ] && grep -q '^IPV6=no' /etc/default/ufw; then
  sed -i 's/^IPV6=no/IPV6=yes/' /etc/default/ufw
fi
ufw default deny incoming
ufw default allow outgoing

env_file="$(deploy_dir)/.env"
cidr=""
if [ -f "$env_file" ]; then
  cidr="$(read_env "$env_file" SSH_ALLOW_CIDR)"
fi
if [ -n "$cidr" ]; then
  case "$cidr" in
    *[!0-9a-fA-F:./]*)
      echo "SSH_ALLOW_CIDR must be a single CIDR" >&2
      exit 1
      ;;
  esac
  case "$cidr" in
    */*) ;;
    *)
      echo "SSH_ALLOW_CIDR must include a prefix length" >&2
      exit 1
      ;;
  esac
  if ! ufw status | grep -F "$cidr" | grep -q '22/tcp'; then
    ufw allow from "$cidr" to any port 22 proto tcp comment 'ssh-admin'
  fi
else
  echo "WARNING: SSH is open to the world. Set SSH_ALLOW_CIDR in deploy/.env, or restrict port 22 in the Hetzner Cloud Firewall." >&2
  if ! ufw status | grep -q '22/tcp'; then
    ufw allow 22/tcp comment 'ssh-admin'
  fi
fi
ufw --force enable

if [ -n "$cidr" ]; then
  while true; do
    num="$(
      ufw status numbered | awk '
        /22\/tcp/ && /Anywhere/ && /# ssh-admin[[:space:]]*$/ { print; exit }
      ' | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/' || true
    )"
    case "$num" in
      '') break ;;
      *[!0-9]*)
        echo "could not parse the SSH ufw rule" >&2
        exit 1
        ;;
    esac
    ufw --force delete "$num"
  done
fi

"$(dirname "$(readlink -f "$0")")/cloudflare-ufw.sh"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  arch="$(dpkg --print-architecture)"
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

if ! command -v caddy >/dev/null 2>&1; then
  rm -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    -o /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
  systemctl disable --now caddy || true
fi

write_placeholder() {
  local path="$1" body="$2" dir
  dir="$(dirname "$path")"
  install -d -m 755 "$dir"
  if [ ! -f "$path" ]; then
    printf '%s\n' "$body" > "$path"
    chmod 644 "$path"
  fi
}

hub_placeholder='<!doctype html><meta charset="utf-8"><title>hub</title><p>Hub build is not deployed.</p>'
game_placeholder='<!doctype html><meta charset="utf-8"><title>not deployed</title><p>This game is not deployed.</p>'
write_placeholder /srv/hub/releases/placeholder/hub/index.html "$hub_placeholder"
if [ ! -L /srv/hub/current ]; then
  ln -s releases/placeholder /srv/hub/current
fi
for id in hpos10i nobu peoples-bitcoin sproto-duel; do
  write_placeholder "/srv/play/${id}/releases/placeholder/index.html" "$game_placeholder"
  if [ ! -L "/srv/play/${id}/current" ]; then
    ln -s releases/placeholder "/srv/play/${id}/current"
  fi
done
if id caddy >/dev/null 2>&1; then
  chown -R root:caddy /srv/hub /srv/play
fi
install -d -m 700 /var/backups/metaverse
install -d -m 755 /etc/caddy/certs

install_unit() {
  local name="$1"
  sed "s|@DEPLOY_ROOT@|$(deploy_dir)|g" "$(deploy_dir)/systemd/${name}" > "/etc/systemd/system/${name}"
  chmod 644 "/etc/systemd/system/${name}"
}
install_unit metaverse-backup.service
install_unit metaverse-backup.timer
install_unit metaverse-cloudflare-ufw.service
install_unit metaverse-cloudflare-ufw.timer
systemctl daemon-reload
systemctl enable --now metaverse-cloudflare-ufw.timer

scripts="$(dirname "$(readlink -f "$0")")"
if [ -f "$env_file" ] && "$scripts/check-env.sh"; then
  docker compose \
    --project-directory "$(deploy_dir)" \
    --env-file "$env_file" \
    -f "$(deploy_dir)/compose.yml" \
    up -d --build --wait --wait-timeout 240
  systemctl enable --now metaverse-backup.timer
else
  echo "Nakama is not started. Copy deploy/.env.example to deploy/.env, fill it, then re-run bootstrap.sh."
fi

if [ -f "$env_file" ] && [ -s /etc/caddy/certs/origin.pem ] && [ -s /etc/caddy/certs/origin.key ]; then
  "$scripts/install-caddy.sh"
elif [ ! -f /etc/caddy/metaverse.env ]; then
  systemctl disable --now caddy || true
  echo "Caddy is stopped. Install /etc/caddy/certs/origin.pem and origin.key, then re-run bootstrap.sh."
fi

echo "bootstrap finished"
