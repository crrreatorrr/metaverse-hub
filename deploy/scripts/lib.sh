# shellcheck shell=bash
# Shared helpers for the deploy scripts. Source this file; do not execute it.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "source this file; do not execute it" >&2
  exit 1
fi

deploy_dir() {
  cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "run as root" >&2
    exit 1
  fi
}

read_env() {
  local file="$1" key="$2" line val
  if [ ! -f "$file" ]; then
    echo "missing ${file}" >&2
    return 1
  fi
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  val="${line#"${key}="}"
  case "$val" in
    \"*\")
      val="${val#\"}"
      val="${val%\"}"
      ;;
  esac
  case "$val" in
    *$'\n'*|*$'\r'*)
      echo "${key} contains a newline" >&2
      return 1
      ;;
  esac
  printf '%s' "$val"
}

assert_game_id() {
  case "$1" in
    hpos10i|nobu|peoples-bitcoin|sproto-duel) ;;
    *)
      echo "unknown game id: $1" >&2
      echo "expected hpos10i, nobu, peoples-bitcoin, or sproto-duel" >&2
      return 1
      ;;
  esac
}

precompress_tree() {
  local root="$1" f
  command -v brotli >/dev/null 2>&1 || { echo "brotli is not installed" >&2; return 1; }
  command -v gzip >/dev/null 2>&1 || { echo "gzip is not installed" >&2; return 1; }
  while IFS= read -r -d '' f; do
    gzip -9 -c -- "$f" > "${f}.gz.tmp"
    mv -f "${f}.gz.tmp" "${f}.gz"
    brotli -q 11 -c -- "$f" > "${f}.br.tmp"
    mv -f "${f}.br.tmp" "${f}.br"
  done < <(find "$root" -type f \
    ! -name '*.gz' ! -name '*.br' ! -name '*.tmp' \
    \( -name '*.wasm' -o -name '*.pck' -o -name '*.js' -o -name '*.mjs' \
       -o -name '*.html' -o -name '*.css' -o -name '*.json' \
       -o -name '*.svg' -o -name '*.txt' -o -name '*.xml' \) -print0)
}

stage_release() {
  local base="$1" src="$2"
  local rel dest
  src="$(readlink -f "$src")"
  if [ ! -d "$src" ]; then
    echo "build dir is not a directory: ${src}" >&2
    return 1
  fi
  install -d -m 755 "${base}/releases"
  rel="$(date -u +%Y%m%dT%H%M%SZ)-$$"
  dest="${base}/releases/${rel}"
  if [ -e "$dest" ]; then
    echo "release path already exists: ${dest}" >&2
    return 1
  fi
  mkdir -p "$dest"
  if ! rsync -a --delete "${src}/" "${dest}/"; then
    rm -rf "$dest"
    return 1
  fi
  find "$dest" -type d -exec chmod 755 {} +
  find "$dest" -type f -exec chmod 644 {} +
  if id caddy >/dev/null 2>&1; then
    chown -R root:caddy "$dest"
  fi
  printf '%s' "$rel"
}

atomic_swap() {
  local base="$1" rel="$2"
  ln -s "releases/${rel}" "${base}/current.next"
  mv -Tf "${base}/current.next" "${base}/current"
}

prune_releases() {
  local base="$1" keep="${2:-3}" current="" d i=0
  if [ -L "${base}/current" ]; then
    current="$(readlink -f "${base}/current")"
  fi
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    i=$((i + 1))
    if [ "$i" -le "$keep" ]; then
      continue
    fi
    if [ -n "$current" ] && [ "$d" = "$current" ]; then
      continue
    fi
    rm -rf -- "$d"
  done < <(find "${base}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
}
