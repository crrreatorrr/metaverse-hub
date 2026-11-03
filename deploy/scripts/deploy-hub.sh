#!/usr/bin/env bash
# Publish the hub static root to /srv/hub/releases/<stamp> and point current at it.
# Pass the Vite dist directory: it contains hub/index.html and assets/.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root

if [ "$#" -ne 1 ]; then
  echo "usage: deploy-hub.sh <vite-dist-dir>" >&2
  exit 2
fi

src="$1"
base="/srv/hub"
install -d -m 755 "$base"
dest=""
swapped=0
cleanup() {
  if [ "$swapped" != 1 ] && [ -n "$dest" ] && [ -d "$dest" ]; then
    rm -rf -- "$dest"
  fi
}
trap cleanup EXIT

if [ ! -f "${src%/}/hub/index.html" ]; then
  echo "dist has no hub/index.html: ${src}" >&2
  exit 1
fi

"$(dirname "$(readlink -f "$0")")/check-dist-secrets.sh" "$src"

rel="$(stage_release "$base" "$src")"
dest="${base}/releases/${rel}"
echo "precompressing ${dest}"
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
echo "live hub -> ${dest}"
