#!/usr/bin/env bash
# Publish one game build to /srv/play/<id>/releases/<stamp> and point current at it.
# Caddy serves /srv/play/<id>/current. The swap is a rename, so readers see either
# the old tree or the new one.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root

if [ "$#" -ne 2 ]; then
  echo "usage: deploy-game.sh <hpos10i|nobu|peoples-bitcoin|sproto-duel> <build-dir>" >&2
  exit 2
fi

id="$1"
src="$2"
assert_game_id "$id"

base="/srv/play/${id}"
install -d -m 755 "$base"
rel=""
dest=""
swapped=0
cleanup() {
  if [ "$swapped" != 1 ] && [ -n "$dest" ] && [ -d "$dest" ]; then
    rm -rf -- "$dest"
  fi
}
trap cleanup EXIT

if [ ! -f "${src%/}/index.html" ]; then
  echo "build dir has no index.html: ${src}" >&2
  exit 1
fi

rel="$(stage_release "$base" "$src")"
dest="${base}/releases/${rel}"
echo "precompressing ${dest} (brotli -q 11; a ~38 MiB wasm can take a few minutes)"
precompress_tree "$dest"
find "$dest" -type d -exec chmod 755 {} +
find "$dest" -type f -exec chmod 644 {} +
if id caddy >/dev/null 2>&1; then
  chown -R root:caddy "$dest"
fi
sync
atomic_swap "$base" "$rel"
swapped=1
prune_releases "$base" 3
echo "live ${id} -> ${dest}"
