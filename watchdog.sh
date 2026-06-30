#!/bin/bash
# Watchdog for BizLedger dev server
# Keeps the Next.js dev server running across sandbox resets
cd /home/z/my-project
while true; do
  if ! lsof -ti:3000 >/dev/null 2>&1; then
    echo "[$(date)] Starting dev server..." >> /home/z/my-project/watchdog.log
    nohup bun run dev >> /home/z/my-project/dev.log 2>&1 &
    disown
    sleep 10
  fi
  sleep 5
done
