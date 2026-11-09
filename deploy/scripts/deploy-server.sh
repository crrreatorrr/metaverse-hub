#!/usr/bin/env bash
# Zero-kill Nakama deploy for the single production node. The owner runs this by hand on
# the VPS; deploy/README.md "Upgrades" is the runbook.
#
#   1. pg_dump backup (backup-postgres.sh)
#   2. build metaverse-nakama:<git sha> while the old container keeps serving
#   3. maint.begin (deadline +DRAIN_MINUTES): no new hard matches, players get a notice
#   4. poll maint.live every POLL_SEC until 0 hard matches or the deadline
#   5. wait NOTICE_SEC so the notice reaches everyone
#   6. retag :prod to the new image and recreate only the nakama container
#   7. wait for health
#   8. maint.end (also from the EXIT trap, so Ctrl-C or a failure ends maintenance)
#   9. optional: publish game pages last with deploy-game.sh (--game id=dir)
#
# When the running server has no maint.* RPCs yet (404), it warns and waits
# NO_MAINT_WAIT_SEC instead of draining. Rollback: IMAGE_TAG=<prev> deploy-server.sh --no-drain
# DRY_RUN=1 prints every step that would change something and only reads.
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$(readlink -f "$0")")/lib.sh"

usage() {
  cat <<'EOF'
usage: deploy-server.sh [--no-drain] [--game <id>=<build-dir>]...

  --no-drain          skip maintenance and restart at once (rollback, or an empty server)
  --game id=dir       after the server is healthy, publish this game build with deploy-game.sh

environment:
  IMAGE_TAG           deploy this existing metaverse-nakama tag instead of building HEAD
  DRY_RUN=1           print the changes, make none
  DRAIN_MINUTES       maintenance deadline (default 20)
  POLL_SEC            maint.live poll interval (default 15)
  NOTICE_SEC          wait after the drain so the notice is seen (default 60)
  NO_MAINT_WAIT_SEC   fixed wait when the server has no maint RPCs (default 60)
  HEALTH_TIMEOUT_SEC  compose --wait timeout for the new container (default 240)
  ALLOW_DIRTY=1       build even with uncommitted tracked changes
EOF
}

drain=1
games=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-drain) drain=0 ;;
    --game)
      if [ "$#" -lt 2 ]; then
        usage >&2
        exit 2
      fi
      shift
      games+=("$1")
      ;;
    --game=*) games+=("${1#--game=}") ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

uint() {
  local name="$1" val="$2"
  case "$val" in
    ''|*[!0-9]*)
      echo "${name} must be a whole number" >&2
      exit 2
      ;;
  esac
  printf '%s' "$val"
}

dry_run="${DRY_RUN:-0}"
case "$dry_run" in
  0|1) ;;
  *)
    echo "DRY_RUN must be 0 or 1" >&2
    exit 2
    ;;
esac
drain_min="$(uint DRAIN_MINUTES "${DRAIN_MINUTES:-20}")"
poll_sec="$(uint POLL_SEC "${POLL_SEC:-15}")"
notice_sec="$(uint NOTICE_SEC "${NOTICE_SEC:-60}")"
fallback_sec="$(uint NO_MAINT_WAIT_SEC "${NO_MAINT_WAIT_SEC:-60}")"
health_sec="$(uint HEALTH_TIMEOUT_SEC "${HEALTH_TIMEOUT_SEC:-240}")"

for g in ${games[@]+"${games[@]}"}; do
  case "$g" in
    ?*=?*) ;;
    *)
      echo "--game takes <id>=<build-dir>, got: ${g}" >&2
      exit 2
      ;;
  esac
  if [ ! -f "${g#*=}/index.html" ]; then
    echo "--game ${g%%=*}: no index.html in ${g#*=}" >&2
    exit 2
  fi
done

require_root
scripts="$(dirname "$(readlink -f "$0")")"
dir="$(deploy_dir)"
repo="$(cd "${dir}/.." && pwd)"
env_file="${dir}/.env"
"${scripts}/check-env.sh" >/dev/null
http_key="$(read_env "$env_file" NAKAMA_HTTP_KEY)"
base_url="http://127.0.0.1:7350"
repo_name="metaverse-nakama"

log() {
  printf '[deploy-server %s] %s\n' "$(date -u +%H:%M:%S)" "$*"
}
warn() {
  printf '[deploy-server %s] WARNING: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2
}
die() {
  printf '[deploy-server %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2
  exit 1
}

# A step that changes something: printed under DRY_RUN=1, run otherwise.
act() {
  if [ "$dry_run" = 1 ]; then
    log "DRY_RUN: $*"
  else
    "$@"
  fi
}

pause() {
  if [ "$1" -gt 0 ] && [ "$dry_run" = 0 ]; then
    sleep "$1"
  fi
}

# The running service is always :prod. A sha tag names the same image for rollback.
compose() {
  IMAGE_TAG=prod docker compose --project-directory "$dir" --env-file "$env_file" -f "${dir}/compose.yml" "$@"
}
compose_build() {
  IMAGE_TAG="$1" docker compose --project-directory "$dir" --env-file "$env_file" -f "${dir}/compose.yml" build nakama
}

# rpc <name> <json>: POST to Nakama with the http key. Sets rpc_status and rpc_body.
# The key reaches curl through a config on stdin, so it never shows in the process list.
rpc_status=""
rpc_body=""
rpc() {
  local name="$1" body="$2" out code
  out="$(mktemp)"
  code="$(printf 'url = "%s/v2/rpc/%s?unwrap=true&http_key=%s"\n' "$base_url" "$name" "$http_key" \
    | curl -sS -K - -X POST -H 'Content-Type: application/json' --max-time 10 \
        --data "$body" -o "$out" -w '%{http_code}')" || code="000"
  rpc_body="$(head -c 2000 "$out" | tr -d '\n')"
  rm -f "$out"
  rpc_status="$code"
}

json_int() {
  printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" | head -n 1
}

# Prints "hard N (duel a, arena b, coop c, shooter d), soft M" from a maint.live body;
# sets live_hard (empty when the body has no count).
live_hard=""
describe_live() {
  local body="$1" k v parts=""
  live_hard="$(json_int hard "$body")"
  for k in duel arena coop shooter; do
    v="$(json_int "$k" "$body")"
    parts="${parts:+${parts}, }${k} ${v:-?}"
  done
  log "live: hard ${live_hard:-?} (${parts}), soft $(json_int soft "$body" || true)"
}

maint_active=0
end_maint() {
  if [ "$maint_active" != 1 ]; then
    return 0
  fi
  maint_active=0
  rpc maint.end '{}'
  if [ "$rpc_status" = 200 ]; then
    log "maintenance ended"
  else
    warn "maint.end failed (HTTP ${rpc_status}): ${rpc_body}. Maintenance turns itself off at its deadline; or retry once Nakama is healthy."
  fi
}
on_exit() {
  local rc=$?
  end_maint
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 130 ]; then
    printf '[deploy-server] failed (exit %s). Check docker compose ps; rollback: IMAGE_TAG=%s %s --no-drain\n' \
      "$rc" "${rollback_tag:-<previous sha>}" "$0" >&2
  fi
}
rollback_tag=""
trap on_exit EXIT
trap 'echo; log "interrupted"; exit 130' INT
trap 'exit 143' TERM

# Which image to deploy.
if [ -n "${IMAGE_TAG:-}" ]; then
  tag="$IMAGE_TAG"
  build=0
else
  tag="$(git -C "$repo" rev-parse --short=12 HEAD)"
  build=1
  if [ -n "$(git -C "$repo" status --porcelain --untracked-files=no)" ] && [ "${ALLOW_DIRTY:-0}" != 1 ]; then
    die "the checkout has uncommitted changes, so ${repo_name}:${tag} would not name the code. Commit or stash them, or set ALLOW_DIRTY=1."
  fi
fi
case "$tag" in
  [A-Za-z0-9_]*) ;;
  *) die "IMAGE_TAG must start with a letter, digit or underscore" ;;
esac
case "$tag" in
  *[!A-Za-z0-9_.-]*) die "IMAGE_TAG may contain only letters, digits, '_', '.' and '-'" ;;
esac
if [ "${#tag}" -gt 128 ]; then
  die "IMAGE_TAG is too long"
fi
image="${repo_name}:${tag}"
if [ "$build" = 0 ] && ! docker image inspect "$image" >/dev/null 2>&1; then
  die "no image ${image}. List them with: docker image ls ${repo_name}"
fi

# Name the live image so the rollback command can be printed (and works after this run).
live_cid="$(compose ps -q nakama 2>/dev/null || true)"
if [ -n "$live_cid" ]; then
  live_img="$(docker inspect -f '{{.Image}}' "$live_cid" 2>/dev/null || true)"
  if [ -n "$live_img" ]; then
    same=0
    for t in $(docker image inspect -f '{{join .RepoTags " "}}' "$live_img" 2>/dev/null || true); do
      case "$t" in
        "${repo_name}:prod") ;;
        "${repo_name}:${tag}") same=1 ;;
        "${repo_name}:"*) rollback_tag="${t#"${repo_name}:"}" ;;
      esac
    done
    if [ -z "$rollback_tag" ] && [ "$same" = 0 ]; then
      rollback_tag="rollback-$(date -u +%Y%m%dT%H%M%SZ)"
      act docker tag "$live_img" "${repo_name}:${rollback_tag}"
    fi
  fi
fi

log "deploying ${image}$([ "$build" = 1 ] && echo ' (build)')$([ "$drain" = 0 ] && echo ', no drain')$([ "$dry_run" = 1 ] && echo ', DRY_RUN')"
if [ -n "$rollback_tag" ]; then
  log "live image is ${repo_name}:${rollback_tag}; rollback: IMAGE_TAG=${rollback_tag} $0 --no-drain"
fi

log "1/9 backup"
act "${scripts}/backup-postgres.sh"

if [ "$build" = 1 ]; then
  log "2/9 building ${image} (the running server is not touched)"
  act compose_build "$tag"
else
  log "2/9 using existing ${image}"
fi

if [ "$drain" = 1 ]; then
  deadline=$(( $(date +%s) + drain_min * 60 ))
  if [ "$dry_run" = 1 ]; then
    log "3/9 DRY_RUN: maint.begin {\"reason\":\"deploy ${tag}\",\"deadline\":${deadline}}"
    rpc maint.live '{}'
    case "$rpc_status" in
      200)
        describe_live "$rpc_body"
        log "4-5/9 DRY_RUN: poll every ${poll_sec}s until 0 hard matches or ${drain_min} min, then wait ${notice_sec}s"
        ;;
      404) warn "the running server has no maint RPCs; a real run warns and waits ${fallback_sec}s without a drain" ;;
      *) warn "maint.live returned HTTP ${rpc_status}: ${rpc_body}" ;;
    esac
  else
    log "3/9 maintenance on until $(date -u -d "@${deadline}" +%H:%M:%SZ 2>/dev/null || echo "${deadline}")"
    rpc maint.begin "{\"reason\":\"deploy ${tag}\",\"deadline\":${deadline}}"
    case "$rpc_status" in
      200)
        maint_active=1
        log "4/9 draining: polling maint.live every ${poll_sec}s"
        while :; do
          rpc maint.live '{}'
          if [ "$rpc_status" = 404 ]; then
            warn "maint.live is missing; waiting ${fallback_sec}s instead of polling"
            pause "$fallback_sec"
            break
          elif [ "$rpc_status" = 200 ]; then
            describe_live "$rpc_body"
            if [ "$live_hard" = 0 ]; then
              break
            fi
          else
            warn "maint.live returned HTTP ${rpc_status}: ${rpc_body}; still polling"
          fi
          if [ "$(date +%s)" -ge "$deadline" ]; then
            warn "drain deadline reached with hard matches still live; they get the ${notice_sec}s notice plus the shutdown grace"
            break
          fi
          pause "$poll_sec"
        done
        log "5/9 waiting ${notice_sec}s so the notice reaches players"
        pause "$notice_sec"
        ;;
      404)
        warn "the running server has no maint.begin RPC, so nothing drains and players get no notice. Live matches get only the shutdown grace. Waiting ${fallback_sec}s (Ctrl-C to stop)."
        pause "$fallback_sec"
        ;;
      *)
        die "maint.begin failed with HTTP ${rpc_status}: ${rpc_body}. Nothing was restarted. Fix it, or deploy with --no-drain."
        ;;
    esac
  fi
else
  log "3-5/9 skipped (--no-drain)"
fi

log "6/9 switching nakama to ${image}"
if [ "$tag" != prod ]; then
  act docker tag "$image" "${repo_name}:prod"
fi
log "7/9 waiting up to ${health_sec}s for health"
act compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout "$health_sec" nakama
if [ "$dry_run" = 0 ]; then
  ok=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 5 -o /dev/null "${base_url}/healthcheck"; then
      ok=1
      break
    fi
    sleep 2
  done
  if [ "$ok" != 1 ]; then
    die "nakama did not answer ${base_url}/healthcheck"
  fi
fi

log "8/9 ending maintenance"
end_maint

if [ "${#games[@]}" -gt 0 ]; then
  log "9/9 game pages"
  for g in "${games[@]}"; do
    act "${scripts}/deploy-game.sh" "${g%%=*}" "${g#*=}"
  done
else
  log "9/9 no game pages requested"
fi

log "done: nakama runs ${image}$([ -n "$rollback_tag" ] && echo "; rollback: IMAGE_TAG=${rollback_tag} $0 --no-drain")"
