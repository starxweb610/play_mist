#!/usr/bin/env bash
#
# scripts/deploy.sh — the one and only way play_mist reaches production.
#
# Runs the exact same sequence every time:
#   1. lock          — refuse to run if another deploy is in progress
#   2. preflight     — show exactly which commits are about to go live
#   3. db backup     — abort the deploy if the backup fails
#   4. tag           — bookmark the currently-running commit (deploy-YYYYMMDD-HHMMSS)
#   5. update        — git reset --hard origin/main (+ npm install if the lockfile changed)
#   6. restart       — pm2 restart playmist
#   7. health check  — poll /api/health (200 = app up AND database reachable)
#   8. auto-rollback — if the health check fails, return to the tagged commit and re-verify
#
# Usage (from anywhere):  ssh cgpixels-vps 'bash /var/www/play_mist/scripts/deploy.sh'
# Everything is logged to /var/www/play_mist/deploy.log
#
set -euo pipefail

APP_DIR="/var/www/play_mist"
PM2_APP="playmist"
BRANCH="main"
HEALTH_URL="http://127.0.0.1:3798/api/health"
HEALTH_TRIES=20          # x 3s = up to 60s for the app to come up
LOG_FILE="$APP_DIR/deploy.log"
KEEP_TAGS=15             # deploy-* tags to keep

# ── Bootstrap ────────────────────────────────────────────────────────────────
# Always run as the deploy user (pm2 + repo files belong to it, never root).
if [ "$(id -un)" != "deploy" ]; then
  exec sudo -u deploy bash -lc "exec bash '${BASH_SOURCE[0]}'"
fi

# Run from a temp copy: step 5 rewrites this very file, and bash reads scripts
# incrementally — executing the repo copy while git replaces it can corrupt the run.
if [ "${DEPLOY_SELF_COPY:-}" != "1" ]; then
  tmp="$(mktemp /tmp/playmist-deploy.XXXXXX.sh)"
  cp "${BASH_SOURCE[0]}" "$tmp"
  DEPLOY_SELF_COPY=1 exec bash "$tmp"
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "❌ DEPLOY ABORTED: $*"; exit 1; }

health_ok() {
  local i code
  for i in $(seq 1 "$HEALTH_TRIES"); do
    sleep 3
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || true)"
    if [ "$code" = "200" ]; then return 0; fi
    log "   health check $i/$HEALTH_TRIES: got ${code:-no-response}, retrying…"
  done
  return 1
}

main() {
  cd "$APP_DIR"

  # 1) Lock — one deploy at a time.
  exec 9>/tmp/playmist-deploy.lock
  flock -n 9 || die "another deploy is already running"

  log "════════ DEPLOY STARTED (by $(logname 2>/dev/null || echo ssh)) ════════"

  # 2) Preflight — what is about to change?
  git fetch origin "$BRANCH" || die "git fetch failed — check network/GitHub"
  local OLD_SHA NEW_SHA
  OLD_SHA="$(git rev-parse HEAD)"
  NEW_SHA="$(git rev-parse "origin/$BRANCH")"

  if [ "$OLD_SHA" = "$NEW_SHA" ]; then
    log "No new commits on origin/$BRANCH — this will be a restart-only redeploy of ${OLD_SHA:0:7}."
  else
    log "Deploying ${OLD_SHA:0:7} → ${NEW_SHA:0:7}. Incoming commits:"
    git log --oneline "$OLD_SHA..$NEW_SHA" | sed 's/^/    /'
  fi

  # 3) Database backup BEFORE anything changes. No backup, no deploy.
  log "Backing up database to R2…"
  npm run --silent backup-db || die "database backup failed — nothing was deployed"

  # 4) Tag the currently-running (known-good) commit.
  local TAG="deploy-$(date '+%Y%m%d-%H%M%S')"
  git tag "$TAG" "$OLD_SHA"
  log "Tagged current version as $TAG (rollback target)"
  # Prune old deploy tags, keep the newest $KEEP_TAGS
  git tag -l 'deploy-*' | sort | head -n "-$KEEP_TAGS" | xargs -r git tag -d >/dev/null

  # 5) Update code (+ dependencies only when the lockfile changed).
  local LOCK_CHANGED=0
  if ! git diff --quiet "$OLD_SHA" "$NEW_SHA" -- package-lock.json; then LOCK_CHANGED=1; fi
  git reset --hard "$NEW_SHA"
  if [ "$LOCK_CHANGED" = "1" ]; then
    log "package-lock.json changed — installing dependencies…"
    npm install --omit=dev --no-audit --no-fund || { git reset --hard "$OLD_SHA"; die "npm install failed — code reverted, app NOT restarted"; }
  fi

  # 6) Restart.
  log "Restarting pm2 app '$PM2_APP'…"
  pm2 restart "$PM2_APP" --update-env >/dev/null

  # 7) Health check.
  log "Waiting for $HEALTH_URL to return 200…"
  if health_ok; then
    log "✅ DEPLOY SUCCEEDED — ${NEW_SHA:0:7} is live and healthy (rollback tag: $TAG)"
    exit 0
  fi

  # 8) Auto-rollback.
  log "❌ Health check failed — ROLLING BACK to ${OLD_SHA:0:7} ($TAG)"
  git reset --hard "$OLD_SHA"
  if [ "$LOCK_CHANGED" = "1" ]; then
    npm install --omit=dev --no-audit --no-fund || log "⚠️ npm install failed during rollback — continuing anyway"
  fi
  pm2 restart "$PM2_APP" --update-env >/dev/null

  if health_ok; then
    log "✅ ROLLBACK SUCCEEDED — previous version ${OLD_SHA:0:7} is live again."
    log "   The new code was NOT deployed. Debug it with: pm2 logs $PM2_APP --lines 100"
    exit 1
  fi

  log "🚨 EMERGENCY: rollback ALSO failed its health check. The app may be down."
  log "   1. Check logs:      pm2 logs $PM2_APP --lines 200"
  log "   2. Check process:   pm2 status"
  log "   3. DB backups live in R2 under playmist_data_backup/ (one was taken at the start of this deploy)"
  exit 2
}

main 2>&1 | tee -a "$LOG_FILE"
exit "${PIPESTATUS[0]}"
