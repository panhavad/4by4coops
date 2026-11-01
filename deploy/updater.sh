#!/bin/sh
# Ridgeline 4x4 auto-updater (runs inside the `updater` compose service).
#
# Watches the git checkout mounted at /repo. When a new commit appears - pushed to the remote
# (fast-forward pulled automatically) or committed locally - it rebuilds and restarts the game
# service with `docker compose up -d --build`. The commit hash is baked into the image so
# connected browsers notice the new version and reload themselves.
set -u

REPO_DIR=${REPO_DIR:-/repo}
INTERVAL=${UPDATE_INTERVAL:-30}
REMOTE=${UPDATE_REMOTE:-origin}
BRANCH=${UPDATE_BRANCH:-}
SERVICES=${UPDATE_SERVICES:-game}
SELF=/tmp/updater.sh

log() { echo "[updater] $(date -u '+%Y-%m-%d %H:%M:%S') $*"; }
idle() { while :; do sleep 3600; done; }

cd "$REPO_DIR" || { log "cannot cd to $REPO_DIR"; idle; }
git config --global --add safe.directory '*' 2>/dev/null

if [ "$INTERVAL" = "0" ]; then
  log "UPDATE_INTERVAL=0 - auto-update disabled"
  idle
fi
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  log "$REPO_DIR is not a git repository - auto-update disabled"
  idle
fi

running_version() {
  cid=$(docker compose ps -q game 2>/dev/null | head -n 1)
  [ -n "$cid" ] || return 0
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$cid" 2>/dev/null | sed -n 's/^APP_VERSION=//p'
}

# Keep files written by this (root) container owned by whoever owns the checkout.
fix_owner() {
  owner=$(stat -c '%u:%g' "$REPO_DIR" 2>/dev/null) || return 0
  [ "$owner" = "0:0" ] && return 0
  chown -R "$owner" "$REPO_DIR/.git" 2>/dev/null
  git ls-files -z | xargs -0 chown "$owner" 2>/dev/null
  return 0
}

pull() {
  git remote get-url "$REMOTE" >/dev/null 2>&1 || return 0
  br=${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
  [ "$br" = "HEAD" ] && return 0
  if ! git fetch --quiet "$REMOTE" "$br" 2>/tmp/fetch.err; then
    log "git fetch $REMOTE $br failed: $(tr '\n' ' ' </tmp/fetch.err)"
    return 0
  fi
  [ "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)" ] && return 0
  if git merge-base --is-ancestor HEAD FETCH_HEAD; then
    if git merge --ff-only --quiet FETCH_HEAD; then
      log "pulled $REMOTE/$br -> $(git rev-parse --short HEAD)"
      fix_owner
    else
      log "fast-forward of $REMOTE/$br failed (uncommitted local changes?)"
    fi
  fi
}

deploy() {
  log "deploying $1 ..."
  if GIT_COMMIT=$1 docker compose up -d --build --no-deps $SERVICES; then
    log "deployed $1"
    docker image prune -f >/dev/null 2>&1
    docker builder prune -f --filter until=168h >/dev/null 2>&1
    return 0
  fi
  log "deploy of $1 FAILED - will retry when a new commit arrives"
  return 1
}

log "watching $REPO_DIR every ${INTERVAL}s (remote: $REMOTE, services: $SERVICES)"
failed=""
sleep 5
while :; do
  pull
  head=$(git rev-parse --short=12 HEAD 2>/dev/null)
  if [ -n "$head" ] && [ "$head" != "$failed" ] && [ "$head" != "$(running_version)" ]; then
    deploy "$head" || failed=$head
  fi
  if [ -f "$REPO_DIR/deploy/updater.sh" ] && ! cmp -s "$REPO_DIR/deploy/updater.sh" "$SELF"; then
    log "updater script changed - reloading it"
    cp "$REPO_DIR/deploy/updater.sh" "$SELF" && exec /bin/sh "$SELF"
  fi
  sleep "$INTERVAL"
done
