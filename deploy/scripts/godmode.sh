#!/usr/bin/env bash
# Owner godmode for The People's Bitcoin: keep one account's peoples-bitcoin Ticket wallet
# at a fixed amount (default 90,000,000,000). The server tops it up whenever the game reads
# the balance (server/modules/src/godmode.ts). Only for accounts the owner names here.
#
#   godmode.sh on  <username|user-id> [tickets]
#   godmode.sh off <username|user-id>
#   godmode.sh list
#
# "off" stops the top-ups; Tickets already granted stay in the wallet.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
"$(dirname "$(readlink -f "$0")")/check-env.sh" >/dev/null

file="$(deploy_dir)/.env"
compose() {
  docker compose --project-directory "$(deploy_dir)" --env-file "$file" -f "$(deploy_dir)/compose.yml" "$@"
}

usage() {
  sed -n '6,8p' "$0" | sed 's/^#   /usage: /' >&2
  exit 2
}

action="${1:-}"
who="${2:-}"
tickets="${3:-90000000000}"

case "$tickets" in
  ''|*[!0-9]*|0)
    echo "tickets must be a whole number above 0" >&2
    exit 2
    ;;
esac

run_sql() {
  compose exec -T postgres psql -U postgres -d nakama -v ON_ERROR_STOP=1 -qAt \
    -v who="$who" -v tickets="$tickets" "$@"
}

# :'who' is a user id or a username; psql quotes it, so it is never run as SQL.
resolve='
  SELECT id FROM users
  WHERE id::text = :'"'"'who'"'"' OR username = :'"'"'who'"'"'
  LIMIT 1'

case "$action" in
  on)
    [ -n "$who" ] || usage
    run_sql <<SQL
\set QUIET on
SELECT (count(*) = 1) AS found FROM ($resolve) u \gset
\if :found
INSERT INTO game.godmode_user (user_id, tickets)
SELECT id, :'tickets'::bigint FROM ($resolve) u
ON CONFLICT (user_id) DO UPDATE SET tickets = EXCLUDED.tickets;
SELECT 'godmode on for ' || u.id || ': ' || COALESCE(game.godmode_topup(u.id, 'peoples-bitcoin')->>'balance', '?') || ' Tickets'
FROM ($resolve) u;
\else
DO \$fail\$ BEGIN RAISE EXCEPTION 'no account with that username or user id'; END \$fail\$;
\endif
SQL
    ;;
  off)
    [ -n "$who" ] || usage
    run_sql <<SQL
DELETE FROM game.godmode_user WHERE user_id IN ($resolve) RETURNING 'godmode off for ' || user_id;
SQL
    ;;
  list)
    run_sql <<'SQL'
SELECT g.user_id || '  ' || COALESCE(u.username, '-') || '  target ' || g.tickets
       || '  balance ' || COALESCE(b.balance, 0)
FROM game.godmode_user g
LEFT JOIN users u ON u.id = g.user_id
LEFT JOIN game.tickets_balance b ON b.user_id = g.user_id AND b.game_id = 'peoples-bitcoin'
ORDER BY g.created_at;
SQL
    ;;
  *)
    usage
    ;;
esac
