#!/bin/sh
# Render the Nakama config from the environment, migrate, then replace this process.
# Keep the secret rules aligned with deploy/scripts/check-env.sh.
set -eu
umask 077

template=/etc/nakama/config.yml.template
out=/tmp/nakama.yml

require_secret() {
  name=$1
  val=$2
  min=$3
  if [ -z "$val" ]; then
    echo "missing ${name}" >&2
    exit 1
  fi
  if [ "${#val}" -lt "$min" ]; then
    echo "${name} must be at least ${min} characters" >&2
    exit 1
  fi
  case "$val" in
    *[!A-Za-z0-9_-]*)
      echo "${name} must contain only letters, digits, underscore, or hyphen" >&2
      exit 1
      ;;
  esac
  case "$val" in
    defaultkey|localdb|localhttpkey|defaulthttpkey|defaultencryptionkey|defaultrefreshencryptionkey|password|changeme|dev-ticket-hmac-key|dev-recovery-pepper|dev-audit-key)
      echo "${name} is a dev default; generate a new value" >&2
      exit 1
      ;;
  esac
}

require_secret POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}" 32
require_secret NAKAMA_SERVER_KEY "${NAKAMA_SERVER_KEY:-}" 32
require_secret NAKAMA_HTTP_KEY "${NAKAMA_HTTP_KEY:-}" 32
require_secret NAKAMA_SESSION_ENCRYPTION_KEY "${NAKAMA_SESSION_ENCRYPTION_KEY:-}" 32
require_secret NAKAMA_REFRESH_ENCRYPTION_KEY "${NAKAMA_REFRESH_ENCRYPTION_KEY:-}" 32
require_secret NAKAMA_CONSOLE_PASSWORD "${NAKAMA_CONSOLE_PASSWORD:-}" 32
require_secret NAKAMA_CONSOLE_SIGNING_KEY "${NAKAMA_CONSOLE_SIGNING_KEY:-}" 32
require_secret TICKET_HMAC_KEY "${TICKET_HMAC_KEY:-}" 32
require_secret RECOVERY_PEPPER "${RECOVERY_PEPPER:-}" 32

user=${NAKAMA_CONSOLE_USERNAME:-admin}
case "$user" in
  [A-Za-z]*) ;;
  *)
    echo "NAKAMA_CONSOLE_USERNAME must start with a letter" >&2
    exit 1
    ;;
esac
case "$user" in
  *[!A-Za-z0-9_-]*)
    echo "NAKAMA_CONSOLE_USERNAME must contain only letters, digits, underscore, or hyphen" >&2
    exit 1
    ;;
esac
if [ "${#user}" -gt 32 ]; then
  echo "NAKAMA_CONSOLE_USERNAME is too long" >&2
  exit 1
fi

differ() {
  left_name=$1
  left=$2
  right_name=$3
  right=$4
  if [ "$left" = "$right" ]; then
    echo "${left_name} and ${right_name} must be different" >&2
    exit 1
  fi
}

differ NAKAMA_SERVER_KEY "$NAKAMA_SERVER_KEY" NAKAMA_HTTP_KEY "$NAKAMA_HTTP_KEY"
differ NAKAMA_SESSION_ENCRYPTION_KEY "$NAKAMA_SESSION_ENCRYPTION_KEY" NAKAMA_REFRESH_ENCRYPTION_KEY "$NAKAMA_REFRESH_ENCRYPTION_KEY"
differ TICKET_HMAC_KEY "$TICKET_HMAC_KEY" RECOVERY_PEPPER "$RECOVERY_PEPPER"
differ POSTGRES_PASSWORD "$POSTGRES_PASSWORD" NAKAMA_CONSOLE_PASSWORD "$NAKAMA_CONSOLE_PASSWORD"

export NAKAMA_CONSOLE_USERNAME="$user"

if [ ! -f "$template" ]; then
  echo "missing ${template}" >&2
  exit 1
fi

awk '
BEGIN {
  n = split("POSTGRES_PASSWORD NAKAMA_SERVER_KEY NAKAMA_HTTP_KEY NAKAMA_SESSION_ENCRYPTION_KEY NAKAMA_REFRESH_ENCRYPTION_KEY NAKAMA_CONSOLE_USERNAME NAKAMA_CONSOLE_PASSWORD NAKAMA_CONSOLE_SIGNING_KEY TICKET_HMAC_KEY RECOVERY_PEPPER", names, " ")
  for (i = 1; i <= n; i++) allowed[names[i]] = 1
}
{
  line = $0
  while (match(line, /\$\{[A-Za-z0-9_]+\}/)) {
    token = substr(line, RSTART, RLENGTH)
    name = substr(token, 3, length(token) - 3)
    if (!(name in allowed)) {
      printf "unknown placeholder %s\n", name > "/dev/stderr"
      exit 2
    }
    if (ENVIRON[name] == "") {
      printf "empty %s\n", name > "/dev/stderr"
      exit 2
    }
    line = substr(line, 1, RSTART - 1) ENVIRON[name] substr(line, RSTART + RLENGTH)
  }
  print line
}
' "$template" > "$out"

# shellcheck disable=SC2016 # literal ${ so a leftover placeholder fails the boot
if grep -q '\${' "$out"; then
  echo "rendered Nakama config still contains a placeholder" >&2
  rm -f "$out"
  exit 1
fi
chmod 600 "$out"

if [ "${RENDER_ONLY:-}" = "1" ]; then
  echo "$out"
  exit 0
fi

/nakama/nakama migrate up --config "$out"
exec /nakama/nakama --config "$out"
