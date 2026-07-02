#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "next dev" > /dev/null 2>&1; then
    echo "[$(date)] Starting server..." >> /home/z/my-project/watchdog.log
    node /home/z/my-project/node_modules/.bin/next dev --turbopack >> /home/z/my-project/dev.log 2>&1 &
    sleep 15
  fi
  sleep 3
done
