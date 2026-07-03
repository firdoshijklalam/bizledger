#!/bin/bash
# Robust keep-alive: spawns watchdog-server.sh in a detached session,
# and also respawns the watchdog itself if it dies.
cd /home/z/my-project

# Start the watchdog if not running
start_watchdog() {
  if ! pgrep -f "watchdog-server.sh" > /dev/null 2>&1; then
    setsid bash /home/z/my-project/watchdog-server.sh > /dev/null 2>&1 < /dev/null &
    disown
    echo "[$(date '+%H:%M:%S')] Watchdog started" >> /home/z/my-project/keep-alive.log
  fi
}

start_watchdog
sleep 20
start_watchdog
sleep 20
start_watchdog
