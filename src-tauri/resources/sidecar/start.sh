#!/bin/bash
LOG="$HOME/.quinki-sidecar.log"
echo "$(date): start.sh called" >> "$LOG"
if lsof -ti:9182 > /dev/null 2>&1; then exit 0; fi
export QUINKI_AGENT_DIR="$HOME/.quinki"
export PI_CODING_AGENT_DIR="$HOME/.quinki"
export QUINKI_WS_PORT=9182
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/quinki-sidecar-ws" >> "$LOG" 2>&1
