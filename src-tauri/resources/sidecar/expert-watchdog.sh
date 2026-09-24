#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "$(date): expert-watchdog started from $SCRIPT_DIR" >> "$LOG"

while true; do
  # Se l'app Expert non è più in esecuzione → esci + PULIZIA TOTALE (niente
  # sidecar zombie per nessuna via di morte: SIGTERM, kill -9, crash).
  if ! pgrep -f "App Expert.app/Contents/MacOS/quinki" > /dev/null 2>&1; then
    echo "$(date): App Expert not running, watchdog exits and cleans up" >> "$LOG"
    pkill -9 -f 'App Expert.app/Contents/Resources/resources/sidecar/quinki-sidecar-w[s]' 2>/dev/null
    lsof -ti:9183 2>/dev/null | xargs kill -9 2>/dev/null
    exit 0
  fi
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
