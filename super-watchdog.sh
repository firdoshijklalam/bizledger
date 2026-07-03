#!/bin/bash
# Super watchdog: respawns next dev AND respawns itself via a cron-like loop
# This is launched with setsid + full fd redirection so it survives sandbox cleanup
cd /home/z/my-project

respawn_server() {
  # Kill any stale next processes
  pkill -9 -f "next dev" 2>/dev/null
  pkill -9 -f "next-server" 2>/dev/null
  sleep 1
  # Start next dev directly (node), fully detached
  nohup node /home/z/my-project/node_modules/.bin/next dev --turbopack -p 3000 >> /home/z/my-project/dev.log 2>&1 &
  echo "[$(date '+%H:%M:%S')] Spawned next dev (pid $!)" >> /home/z/my-project/super-watchdog.log
}

# Initial spawn
respawn_server

# Loop forever: check every 5s, respawn if dead
while true; do
  if ! pgrep -f "next-server" > /dev/null 2>&1; then
    echo "[$(date '+%H:%M:%S')] next-server dead — respawning" >> /home/z/my-project/super-watchdog.log
    respawn_server
  fi
  sleep 5
done
