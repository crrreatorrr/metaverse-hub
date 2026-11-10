#!/usr/bin/env bash
# Refuse a dist that still contains a dev credential or a server-only secret.
# Prints file paths and the name of the hit. Never prints a secret value.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"

defaults_only=0
if [ "${1:-}" = "--defaults-only" ]; then
  defaults_only=1
  shift
fi

if [ "$#" -lt 1 ]; then
  echo "usage: check-dist-secrets.sh [--defaults-only] <dist-dir> [dist-dir...]" >&2
  exit 2
fi

http_key=""
console_password=""
console_signing_key=""
if [ "$defaults_only" -eq 0 ]; then
  env_file="$(deploy_dir)/.env"
  http_key="$(read_env "$env_file" NAKAMA_HTTP_KEY)" || exit 1
  console_password="$(read_env "$env_file" NAKAMA_CONSOLE_PASSWORD)" || exit 1
  console_signing_key="$(read_env "$env_file" NAKAMA_CONSOLE_SIGNING_KEY)" || exit 1
fi

require_scan_secret() {
  local name="$1" val="$2"
  if [ -z "$val" ]; then
    echo "missing ${name} in deploy/.env" >&2
    exit 1
  fi
  if [ "${#val}" -lt 16 ]; then
    echo "${name} is too short to scan for" >&2
    exit 1
  fi
}

if [ "$defaults_only" -eq 0 ]; then
  require_scan_secret NAKAMA_HTTP_KEY "$http_key"
  require_scan_secret NAKAMA_CONSOLE_PASSWORD "$console_password"
  require_scan_secret NAKAMA_CONSOLE_SIGNING_KEY "$console_signing_key"
fi

for dir in "$@"; do
  if [ ! -d "$dir" ]; then
    echo "not a directory: ${dir}" >&2
    exit 1
  fi
done

export NAKAMA_HTTP_KEY="$http_key"
export NAKAMA_CONSOLE_PASSWORD="$console_password"
export NAKAMA_CONSOLE_SIGNING_KEY="$console_signing_key"

python3 - "$@" <<'PY'
import os
import sys
from pathlib import Path

# Dev credential literals. check-env.sh also refuses the English words "password"
# and "changeme" as a secret's value. Those words are not scanned here: the login
# UI contains the field name "password", and a substring search would reject it.
DEV_VALUES = (
    "defaultkey",
    "localdb",
    "localhttpkey",
    "defaulthttpkey",
    "defaultencryptionkey",
    "defaultrefreshencryptionkey",
    "dev-ticket-hmac-key",
    "dev-recovery-pepper",
    "dev-audit-key",
)

SERVER_SECRETS = tuple(
    (name, os.environ[name].encode())
    for name in ("NAKAMA_HTTP_KEY", "NAKAMA_CONSOLE_PASSWORD", "NAKAMA_CONSOLE_SIGNING_KEY")
    if os.environ.get(name)
)
DEV_BYTES = tuple((name, name.encode()) for name in DEV_VALUES)
PRIVATE_KEYS = (
    ("PRIVATE_KEY", b"-----BEGIN PRIVATE KEY-----"),
    ("PRIVATE_KEY", b"-----BEGIN RSA PRIVATE KEY-----"),
    ("PRIVATE_KEY", b"-----BEGIN OPENSSH PRIVATE KEY-----"),
)

failed = False
for raw in sys.argv[1:]:
    root = Path(raw)
    hits = 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [name for name in dirnames if not (Path(dirpath) / name).is_symlink()]
        for name in filenames:
            path = Path(dirpath) / name
            if path.is_symlink() or not path.is_file():
                continue
            try:
                data = path.read_bytes()
            except OSError as exc:
                print(f"unreadable: {path}: {exc.strerror}", file=sys.stderr)
                failed = True
                continue
            labels = [label for label, needle in DEV_BYTES if needle in data]
            labels += [label for label, needle in SERVER_SECRETS if needle in data]
            labels += [label for label, needle in PRIVATE_KEYS if needle in data]
            if not labels:
                continue
            hits += 1
            failed = True
            print(f"{path}: {', '.join(labels)}", file=sys.stderr)
    if hits == 0:
        print(f"ok {root}")

sys.exit(1 if failed else 0)
PY
