#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "$(date): expert-watchdog started from $SCRIPT_DIR" >> "$LOG"

while true; do
  if ! lsof -ti:9183 > /dev/null 2>&1; then
    echo "$(date): port 9183 not in use, starting expert sidecar..." >> "$LOG"
    nohup bash "$SCRIPT_DIR/start-expert.sh" >> "$LOG" 2>&1 &
    sleep 2
    if lsof -ti:9183 > /dev/null 2>&1; then
      echo "$(date): expert sidecar started successfully" >> "$LOG"
    fi
  fi
  sleep 1
done
