#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "$(date): expert-watchdog started from $SCRIPT_DIR" >> "$LOG"

while true; do
  if ! lsof -ti:9183 > /dev/null 2>&1; then
    echo "$(date): port 9183 not in use, starting expert sidecar..." >> "$LOG"
    setsid bash "$SCRIPT_DIR/start-expert.sh" &
    sleep 1
    if lsof -ti:9183 > /dev/null 2>&1; then
      echo "$(date): expert sidecar started successfully" >> "$LOG"
    else
      echo "$(date): expert sidecar failed, retrying in 1s..." >> "$LOG"
      sleep 1
    fi
  fi
  sleep 1
done
