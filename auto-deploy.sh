#!/bin/bash
# §AUTO-DEPLOY: Watches for unpushed commits and pushes them to GitHub.
# Vercel (connected to the GitHub repo) then auto-deploys on each push.
# This makes deployment fully automatic — no manual push/deploy needed.
#
# Runs every 20s. Idempotent: only pushes when local main is ahead of origin.
# Logs to auto-deploy.log. Safe to run multiple instances (uses a lock).

set -u
cd /home/z/my-project || exit 1
LOG=/home/z/my-project/auto-deploy.log
LOCK=/tmp/auto-deploy.lock
INTERVAL=20

# Ensure only one instance runs
if [ -f "$LOCK" ]; then
  OLD_PID=$(cat "$LOCK" 2>/dev/null)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    # Already running — exit silently
    exit 0
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

# Make sure git identity is set (in case of fresh shell)
git config user.name >/dev/null 2>&1 || git config user.name "firdoshijklalam"
git config user.email >/dev/null 2>&1 || git config user.email "firdoshijklalam@users.noreply.github.com"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] auto-deploy watcher started (interval=${INTERVAL}s)" >> "$LOG"

while true; do
  # Fetch remote state (silent — fails gracefully if offline)
  git fetch origin main >/dev/null 2>&1

  # Count commits local is ahead of origin/main
  AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo "0")

  if [ "$AHEAD" -gt "0" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Detected $AHEAD unpushed commit(s). Pushing to GitHub..." >> "$LOG"
    # Push (credentials are embedded in the remote URL)
    PUSH_OUT=$(git push origin main 2>&1)
    PUSH_RC=$?
    echo "$PUSH_OUT" >> "$LOG"
    if [ $PUSH_RC -eq 0 ]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✓ Push successful — Vercel deployment triggered (if linked to GitHub repo)." >> "$LOG"
    else
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✗ Push failed (rc=$PUSH_RC). Will retry next cycle." >> "$LOG"
    fi
  fi

  sleep "$INTERVAL"
done
