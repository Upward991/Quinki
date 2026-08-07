#!/bin/bash
LOG="$HOME/.quinki-sidecar.log"
echo "$(date): start.sh called" >> "$LOG"
if lsof -ti:9182 > /dev/null 2>&1; then echo "port 9182 in use" >> "$LOG"; exit 0; fi
export QUINKI_AGENT_DIR="$HOME/.quinki"
export PI_CODING_AGENT_DIR="$HOME/.quinki"
export QUINKI_WS_PORT=9182
DIR="$(cd "$(dirname "$0")" && pwd)"
export QUINKI_SIDECAR_DIR="$DIR"
if [ -f "$DIR/quinki-ws-bridge" ]; then
  echo "$(date): starting quinki-ws-bridge from $DIR" >> "$LOG"
  exec "$DIR/quinki-ws-bridge" >> "$LOG" 2>&1
else
  echo "$(date): ERROR - quinki-ws-bridge not found in $DIR" >> "$LOG"; exit 1
fi
