#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
echo "$(date): start-expert.sh called" >> "$LOG"
if lsof -ti:9183 > /dev/null 2>&1; then exit 0; fi
export QUINKI_AGENT_DIR="$HOME/.quinki"
export PI_CODING_AGENT_DIR="$HOME/.quinki"
export QUINKI_WS_PORT=9183
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/quinki-sidecar-ws" >> "$LOG" 2>&1
