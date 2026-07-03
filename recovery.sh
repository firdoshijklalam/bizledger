#!/bin/bash
# Recovery script — called by cron every minute to ensure server is alive
cd /home/z/my-project

# If next-server is NOT running, start it
if ! pgrep -f "next-server" > /dev/null 2>&1; then
  pkill -9 -f "next dev" 2>/dev/null
  sleep 1
  nohup node /home/z/my-project/node_modules/.bin/next dev --turbopack -p 3000 >> /home/z/my-project/dev.log 2>&1 &
  echo "[$(date '+%H:%M:%S')] Recovery: started next dev" >> /home/z/my-project/recovery.log
fi

# Also ensure a watchdog loop is running to catch deaths within the minute
if ! pgrep -f "watchdog-server.sh" > /dev/null 2>&1; then
  setsid bash /home/z/my-project/watchdog-server.sh 0<&- 1>/dev/null 2>&1 &
  disown
  echo "[$(date '+%H:%M:%S')] Recovery: started watchdog" >> /home/z/my-project/recovery.log
fi
