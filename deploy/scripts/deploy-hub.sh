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
dest=""
swapped=0
cleanup() {
  if [ "$swapped" != 1 ] && [ -n "$dest" ] && [ -d "$dest" ]; then
    rm -rf -- "$dest"
  fi
}
trap cleanup EXIT

check_hub_pages() {
  local dist_root="${1%/}"
  if [ ! -f "$dist_root/hub/index.html" ]; then
    echo "dist has no hub/index.html: $dist_root" >&2
    return 1
  fi
  if [ ! -f "$dist_root/realm-pages.txt" ]; then
    echo "dist has no Vite realm-pages.txt manifest: $dist_root" >&2
    return 1
  fi
  local page
  while IFS= read -r page || [ -n "$page" ]; do
    [ -n "$page" ] || continue
    if [[ ! "$page" =~ ^realm/[a-z0-9_-]+/index\.html$ ]]; then
      echo "invalid realm page in Vite manifest: $page" >&2
      return 1
    fi
    if [ ! -f "$dist_root/$page" ]; then
      echo "dist is missing Vite realm input: $page" >&2
      return 1
    fi
  done < "$dist_root/realm-pages.txt"
}

check_hub_pages "$src"

"$(dirname "$(readlink -f "$0")")/check-dist-secrets.sh" "$src"

install -d -m 755 "$base"

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
