#!/usr/bin/env bash
# Check deploy/.env. Prints names and problems, never values.
# Keep the secret rules aligned with deploy/nakama/render-config.sh.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"

file="$(deploy_dir)/.env"
if [ ! -f "$file" ]; then
  echo "missing ${file}" >&2
  echo "copy deploy/.env.example to deploy/.env and fill it" >&2
  exit 1
fi

fail() {
  echo "$1" >&2
  exit 1
}

require_secret() {
  local name="$1" min="$2" val
  val="$(read_env "$file" "$name")" || exit 1
  if [ -z "$val" ]; then
    fail "missing ${name}"
  fi
  if [ "${#val}" -lt "$min" ]; then
    fail "${name} must be at least ${min} characters"
  fi
  case "$val" in
    *[!A-Za-z0-9_-]*)
      fail "${name} must contain only letters, digits, underscore, or hyphen"
      ;;
  esac
  case "$val" in
    defaultkey|localdb|localhttpkey|defaulthttpkey|defaultencryptionkey|defaultrefreshencryptionkey|password|changeme|dev-ticket-hmac-key|dev-recovery-pepper|dev-audit-key)
      fail "${name} is a dev default; generate a new value"
      ;;
  esac
  printf '%s' "$val"
}

differ() {
  local left_name="$1" left="$2" right_name="$3" right="$4"
  if [ "$left" = "$right" ]; then
    fail "${left_name} and ${right_name} must be different"
  fi
}

domain="$(read_env "$file" DOMAIN)" || exit 1
case "$domain" in
  [a-z0-9]*) ;;
  *) fail "DOMAIN must be a lowercase hostname" ;;
esac
case "$domain" in
  *[!a-z0-9.-]*) fail "DOMAIN must be a lowercase hostname" ;;
esac
case "$domain" in
  *..*|.*|*.|*/*|*:*) fail "DOMAIN must be an apex hostname, with no scheme or trailing dot" ;;
esac
case "$domain" in
  *.*.*) ;;
  *.*) ;;
  *) fail "DOMAIN must contain a dot" ;;
esac

pg="$(require_secret POSTGRES_PASSWORD 32)"
server_key="$(require_secret NAKAMA_SERVER_KEY 32)"
http_key="$(require_secret NAKAMA_HTTP_KEY 32)"
session_key="$(require_secret NAKAMA_SESSION_ENCRYPTION_KEY 32)"
refresh_key="$(require_secret NAKAMA_REFRESH_ENCRYPTION_KEY 32)"
console_password="$(require_secret NAKAMA_CONSOLE_PASSWORD 32)"
require_secret NAKAMA_CONSOLE_SIGNING_KEY 32 >/dev/null
ticket="$(require_secret TICKET_HMAC_KEY 32)"
pepper="$(require_secret RECOVERY_PEPPER 32)"

user="$(read_env "$file" NAKAMA_CONSOLE_USERNAME)" || exit 1
if [ -z "$user" ]; then
  user="admin"
fi
case "$user" in
  [A-Za-z]*) ;;
  *) fail "NAKAMA_CONSOLE_USERNAME must start with a letter" ;;
esac
case "$user" in
  *[!A-Za-z0-9_-]*) fail "NAKAMA_CONSOLE_USERNAME must contain only letters, digits, underscore, or hyphen" ;;
esac
if [ "${#user}" -gt 32 ]; then
  fail "NAKAMA_CONSOLE_USERNAME is too long"
fi

differ NAKAMA_SERVER_KEY "$server_key" NAKAMA_HTTP_KEY "$http_key"
differ NAKAMA_SESSION_ENCRYPTION_KEY "$session_key" NAKAMA_REFRESH_ENCRYPTION_KEY "$refresh_key"
differ TICKET_HMAC_KEY "$ticket" RECOVERY_PEPPER "$pepper"
differ POSTGRES_PASSWORD "$pg" NAKAMA_CONSOLE_PASSWORD "$console_password"

for key in GAME_COOP_HPOS10I GAME_COOP_NOBU GAME_COOP_PEOPLES_BITCOIN GAME_COOP_SPROTO_DUEL; do
  val="$(read_env "$file" "$key")" || exit 1
  if [ -z "$val" ]; then
    val=0
  fi
  case "$val" in
    0|1) ;;
    *) fail "${key} must be 0 or 1" ;;
  esac
done

cidr="$(read_env "$file" SSH_ALLOW_CIDR)" || exit 1
if [ -n "$cidr" ]; then
  case "$cidr" in
    *[!0-9a-fA-F:./]*) fail "SSH_ALLOW_CIDR must be a single CIDR" ;;
  esac
  case "$cidr" in
    */*) ;;
    *) fail "SSH_ALLOW_CIDR must include a prefix length" ;;
  esac
fi

target="$(read_env "$file" BACKUP_RSYNC_TARGET)" || exit 1
if [ -n "$target" ]; then
  case "$target" in
    *[!A-Za-z0-9_@:/.-]*) fail "BACKUP_RSYNC_TARGET has characters this script will not pass to rsync" ;;
  esac
fi

days="$(read_env "$file" BACKUP_RETAIN_DAYS)" || exit 1
if [ -z "$days" ]; then
  days=14
fi
case "$days" in
  [0-9]|[0-9][0-9]|[0-9][0-9][0-9]) ;;
  *) fail "BACKUP_RETAIN_DAYS must be a positive integer" ;;
esac
if [ "$days" -lt 1 ]; then
  fail "BACKUP_RETAIN_DAYS must be at least 1"
fi

chmod 600 "$file" || true
echo "deploy/.env ok (DOMAIN=${domain})"
