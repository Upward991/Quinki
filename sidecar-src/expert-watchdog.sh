#!/bin/bash
# Expert sidecar watchdog — restarts the expert sidecar if it dies
LOG="$HOME/.quinki-expert-sidecar.log"
PID_FILE="$HOME/.quinki-expert-sidecar.pid"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "$(date): expert-watchdog started" >> "$LOG"

while true; do
  # Check if port 9183 is in use
  if ! lsof -ti:9183 > /dev/null 2>&1; then
    echo "$(date): port 9183 not in use, starting expert sidecar..." >> "$LOG"
    
    # Start the expert sidecar
    bash "$SCRIPT_DIR/start-expert.sh" &
    SIDECAR_PID=$!
    echo "$SIDECAR_PID" > "$PID_FILE"
    
    # Wait a bit for it to start
    sleep 2
    
    if lsof -ti:9183 > /dev/null 2>&1; then
      echo "$(date): expert sidecar started successfully (pid=$SIDECAR_PID)" >> "$LOG"
    else
      echo "$(date): expert sidecar failed to start, retrying in 3s..." >> "$LOG"
      sleep 3
    fi
  fi
  
  # Check every 2 seconds
  sleep 2
done