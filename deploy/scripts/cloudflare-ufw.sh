#!/usr/bin/env bash
# Allow tcp/80 and tcp/443 only from Cloudflare's published ranges.
# SSH rules are left alone. New ranges are added before old ones are removed.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root

if ! command -v ufw >/dev/null 2>&1; then
  echo "ufw is not installed" >&2
  exit 1
fi
if ! ufw status | grep -q 'Status: active'; then
  echo "ufw is not active. bootstrap.sh enables it after allowing SSH." >&2
  exit 1
fi

has_comment() {
  local want="$1" line
  while IFS= read -r line; do
    case "$line" in
      *" # ${want}") return 0 ;;
    esac
  done < <(ufw status numbered || true)
  return 1
}

delete_comment() {
  local want="$1" line num
  while IFS= read -r line; do
    case "$line" in
      *" # ${want}")
        num="$(printf '%s\n' "$line" | sed -E 's/^\[[[:space:]]*([0-9]+)\].*/\1/')"
        case "$num" in
          ''|*[!0-9]*)
            echo "could not parse a ufw rule number for ${want}" >&2
            exit 1
            ;;
        esac
        ufw --force delete "$num"
        delete_comment "$want"
        return
        ;;
    esac
  done < <(ufw status numbered || true)
}

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
curl -fsSL --retry 3 --max-time 30 https://www.cloudflare.com/ips-v4 -o "${workdir}/v4"
curl -fsSL --retry 3 --max-time 30 https://www.cloudflare.com/ips-v6 -o "${workdir}/v6"
grep -E '^[0-9.]+/[0-9]+$' "${workdir}/v4" >/dev/null
grep -E '^[0-9a-fA-F:]+/[0-9]+$' "${workdir}/v6" >/dev/null
if [ ! -s "${workdir}/v4" ] || [ ! -s "${workdir}/v6" ]; then
  echo "Cloudflare IP list was empty" >&2
  exit 1
fi

# A previous run that died after adding the new set still has both comments.
# Drop the incomplete new set and keep the set that was already serving traffic.
if has_comment cf-edge && has_comment cf-edge-next; then
  delete_comment cf-edge-next
fi

new_comment=cf-edge-next
old_comment=cf-edge
if has_comment cf-edge-next && ! has_comment cf-edge; then
  new_comment=cf-edge
  old_comment=cf-edge-next
elif ! has_comment cf-edge; then
  new_comment=cf-edge
  old_comment=
fi

add_list() {
  local file="$1" cidr
  while read -r cidr; do
    [ -n "$cidr" ] || continue
    ufw allow from "$cidr" to any port 80 proto tcp comment "$new_comment"
    ufw allow from "$cidr" to any port 443 proto tcp comment "$new_comment"
  done < "$file"
}

add_list "${workdir}/v4"
add_list "${workdir}/v6"
if [ -n "$old_comment" ]; then
  delete_comment "$old_comment"
fi

proxies="$(mktemp)"
{
  printf 'servers {\n\ttrusted_proxies static'
  while read -r cidr; do
    [ -n "$cidr" ] || continue
    printf ' %s' "$cidr"
  done < "${workdir}/v4"
  while read -r cidr; do
    [ -n "$cidr" ] || continue
    printf ' %s' "$cidr"
  done < "${workdir}/v6"
  printf '\n\tclient_ip_headers CF-Connecting-IP\n}\n'
} > "$proxies"
install -d -m 755 /etc/caddy
install -m 644 "$proxies" /etc/caddy/cloudflare-proxies.caddy
rm -f "$proxies"
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet caddy; then
  systemctl reload caddy
fi
echo "ufw allows tcp/80 and tcp/443 from Cloudflare only"
