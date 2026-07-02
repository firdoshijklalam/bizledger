#!/bin/bash
# Start the dev server and keep it running
cd /home/z/my-project
pkill -9 -f "next" 2>/dev/null
sleep 2
exec node node_modules/.bin/next dev --turbopack
