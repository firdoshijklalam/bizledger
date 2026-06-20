#!/bin/bash
# Watchdog: keeps the Next.js dev server alive
cd /home/z/my-project
LOG=/home/z/my-project/dev.log

while true; do
  # Check if next dev is running
  if ! pgrep -f "next dev -p 3000" > /dev/null 2>&1; then
    echo "[$(date)] Starting dev server..." >> "$LOG"
    node node_modules/.bin/next dev -p 3000 >> "$LOG" 2>&1 &
    SERVER_PID=$!
    echo "[$(date)] Started PID $SERVER_PID" >> "$LOG"
    # Wait for it to be ready
    for i in $(seq 1 30); do
      sleep 1
      if curl -s -o /dev/null --max-time 2 http://127.0.0.1:3000/ 2>/dev/null; then
        echo "[$(date)] Server ready after ${i}s" >> "$LOG"
        break
      fi
    done
  fi
  sleep 5
done
