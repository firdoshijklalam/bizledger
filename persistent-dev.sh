#!/bin/bash
# BizLedger Persistent Dev Server — auto-restart loop
# This script runs bun run dev in a while loop, so if the process dies,
# it immediately restarts. This survives sandbox process cleanup.

cd /home/z/my-project
LOG=/home/z/my-project/dev.log

while true; do
  echo "[persistent $(date '+%H:%M:%S')] Starting dev server..." >> "$LOG"
  bun run dev >> "$LOG" 2>&1
  EXIT_CODE=$?
  echo "[persistent $(date '+%H:%M:%S')] Dev server exited (code $EXIT_CODE). Restarting in 2s..." >> "$LOG"
  sleep 2
done
