#!/usr/bin/env bash
# Custom-format dump of the Nakama database. Local files live in /var/backups/metaverse.
# Set BACKUP_RSYNC_TARGET to copy each new dump off the VPS.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
"$(dirname "$(readlink -f "$0")")/check-env.sh" >/dev/null

file="$(deploy_dir)/.env"
days="$(read_env "$file" BACKUP_RETAIN_DAYS)"
target="$(read_env "$file" BACKUP_RSYNC_TARGET)"
if [ -z "$days" ]; then
  days=14
fi

compose() {
  docker compose --project-directory "$(deploy_dir)" --env-file "$file" -f "$(deploy_dir)/compose.yml" "$@"
}

umask 077
install -d -m 700 /var/backups/metaverse
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="/var/backups/metaverse/nakama-${stamp}.dump"
tmp="${out}.partial"
trap 'rm -f "$tmp"' EXIT

if ! compose exec -T postgres pg_isready -U postgres -d nakama >/dev/null; then
  echo "postgres is not ready" >&2
  exit 1
fi

compose exec -T postgres pg_dump -U postgres -d nakama --format=custom --no-owner > "$tmp"
bytes="$(stat -c%s "$tmp")"
if [ "$bytes" -lt 1000 ]; then
  echo "pg_dump wrote ${bytes} bytes; refusing to keep it" >&2
  exit 1
fi
mv -f "$tmp" "$out"
trap - EXIT
chmod 600 "$out"
find /var/backups/metaverse -type f -name 'nakama-*.dump' -mtime +"$days" -delete
echo "wrote ${out}"

if [ -n "$target" ]; then
  rsync -a --chmod=F600 -- "$out" "${target}/"
  echo "rsynced dump to BACKUP_RSYNC_TARGET"
fi
