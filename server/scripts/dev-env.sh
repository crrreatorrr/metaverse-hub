#!/bin/sh
# Writes server/.env with fresh random dev keys (mode 600). Prints no values.
# Usage: sh server/scripts/dev-env.sh [--force] [--random-server-key]
#
# NAKAMA_SERVER_KEY is not a secret: every Nakama client sends it, and the hub
# dev build (vite.config.ts) and the vendored game SDKs send Nakama's stock
# key in development. So the local stack keeps the stock key unless you pass
# --random-server-key (CI does). Production sets its own in deploy/.env.
# Every other value is server-only and always random.
set -eu
force=0; random_server_key=0
for arg in "$@"; do
  case "$arg" in
    --force) force=1 ;;
    --random-server-key) random_server_key=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
dir=$(cd "$(dirname "$0")/.." && pwd)
out="$dir/.env"
if [ -e "$out" ] && [ "$force" -ne 1 ]; then
  echo "server/.env already exists; pass --force to replace it" >&2
  exit 1
fi
rand() { openssl rand -hex 32; }
if [ "$random_server_key" -eq 1 ]; then server_key=$(rand); else server_key=defaultkey; fi
umask 077
tmp=$(mktemp "$dir/.env.XXXXXX")
{
  echo "POSTGRES_PASSWORD=$(rand)"
  echo "NAKAMA_SERVER_KEY=$server_key"
  echo "NAKAMA_HTTP_KEY=$(rand)"
  echo "NAKAMA_SESSION_ENCRYPTION_KEY=$(rand)"
  echo "NAKAMA_REFRESH_ENCRYPTION_KEY=$(rand)"
  echo "NAKAMA_CONSOLE_USERNAME=dev-$(openssl rand -hex 4)"
  echo "NAKAMA_CONSOLE_PASSWORD=$(rand)"
  echo "NAKAMA_CONSOLE_SIGNING_KEY=$(rand)"
  echo "TICKET_HMAC_KEY=$(rand)"
  echo "RECOVERY_PEPPER=$(rand)"
  echo "AUDIT_KEY=$(rand)"
} > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$out"
echo "wrote $out (mode 600)"
