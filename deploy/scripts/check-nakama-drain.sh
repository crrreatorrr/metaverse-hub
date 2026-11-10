#!/usr/bin/env bash
# Refuse a Nakama restart while a Shooter wager is still held or a hard match
# is still running. This node refunds every held row on boot.
#
#   deploy/scripts/check-nakama-drain.sh
#   deploy/scripts/check-nakama-drain.sh --allow-open
#
# --allow-open is the explicit override. It prints the counts and exits 0.
# A failed read (database or maint.live) also refuses, unless that override is set.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"

allow=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-open) allow=1 ;;
    -h|--help)
      echo "usage: check-nakama-drain.sh [--allow-open]" >&2
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

dir="$(deploy_dir)"
env_file="${dir}/.env"
compose=(docker compose --project-directory "$dir" --env-file "$env_file" -f "${dir}/compose.yml")

if ! held="$("${compose[@]}" exec -T postgres psql -U postgres -d nakama -tAc \
  "SELECT count(*) FROM game.shooter_wager WHERE status = 'held'")"; then
  echo "could not read game.shooter_wager" >&2
  if [ "$allow" != 1 ]; then
    exit 1
  fi
  echo "override: continuing without a hold count" >&2
  held="?"
fi
held="$(printf '%s' "$held" | tr -d '[:space:]')"
case "$held" in
  '?'|''|*[!0-9]*)
    if [ "$held" != "?" ]; then
      echo "bad hold count" >&2
      if [ "$allow" != 1 ]; then
        exit 1
      fi
      echo "override: continuing without a hold count" >&2
      held="?"
    fi
    ;;
esac

http_key="$(read_env "$env_file" NAKAMA_HTTP_KEY)" || exit 1
out="$(mktemp)"
code="$(printf 'url = "http://127.0.0.1:7350/v2/rpc/maint.live?unwrap=true&http_key=%s"\n' "$http_key" \
  | curl -sS -K - -X POST -H 'Content-Type: application/json' --max-time 10 --data '{}' -o "$out" -w '%{http_code}')" || code="000"
body="$(head -c 2000 "$out" | tr -d '\n' || true)"
rm -f "$out"
hard="$(printf '%s' "$body" | sed -n 's/.*"hard"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)"
if [ "$code" != 200 ] || [ -z "$hard" ]; then
  echo "could not read live matches (HTTP ${code})" >&2
  if [ "$allow" != 1 ]; then
    exit 1
  fi
  echo "override: continuing without a live-match count" >&2
  hard="?"
fi

busy=0
if [ "$held" != "?" ] && [ "$held" != 0 ]; then
  busy=1
fi
if [ "$hard" != "?" ] && [ "$hard" != 0 ]; then
  busy=1
fi
if [ "$busy" = 1 ]; then
  echo "refusing restart: shooter holds=${held} hard matches=${hard}. A boot refunds every held wager. Pass --allow-open to continue." >&2
  if [ "$allow" != 1 ]; then
    exit 1
  fi
  echo "override: restarting with open holds or matches" >&2
else
  echo "drain ok (holds=${held} hard=${hard})"
fi
