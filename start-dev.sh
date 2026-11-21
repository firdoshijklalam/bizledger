#!/bin/bash
# Kill old instances
pkill -9 -f "next" 2>/dev/null
pkill -9 -f "watchdog" 2>/dev/null
sleep 2

cd /home/z/my-project
> /home/z/my-project/dev.log

# Start dev server with full detachment
nohup bun run dev >> /home/z/my-project/dev.log 2>&1 &
DEV_PID=$!
disown $DEV_PID 2>/dev/null

# Start watchdog with full detachment  
nohup bash /home/z/my-project/watchdog.sh >> /home/z/my-project/watchdog.log 2>&1 &
WD_PID=$!
disown $WD_PID 2>/dev/null

# Wait for server
for i in $(seq 1 45); do
  if curl -s http://localhost:3000/api/business > /dev/null 2>&1; then
    echo "READY"
    exit 0
  fi
  sleep 1
done
echo "TIMEOUT"
exit 1
