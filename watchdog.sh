#!/bin/bash
# Watchdog for BizLedger dev server — keeps it alive across sandbox resets
cd /home/z/my-project
while true; do
  if ! curl -s --max-time 3 "http://localhost:3000/api/business" >/dev/null 2>&1; then
    echo "[$(date)] Server down — restarting..." >> /home/z/my-project/watchdog.log
    pkill -9 -f "next" 2>/dev/null
    sleep 2
    nohup setsid bash -c 'cd /home/z/my-project && exec node node_modules/.bin/next dev --turbopack' >> /home/z/my-project/dev.log 2>&1 < /dev/null &
    disown
    sleep 15
  fi
  sleep 5
done
