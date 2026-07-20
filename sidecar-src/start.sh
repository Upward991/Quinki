#!/bin/bash
LOG="$HOME/.quinki-sidecar.log"
echo "$(date): start.sh called" >> "$LOG"

# Kill old processes
lsof -ti:9182 | xargs kill -9 2>/dev/null
pkill -f "ws-bridge" 2>/dev/null
sleep 1

export QUINKI_AGENT_DIR="$HOME/.pi/agent-quinki-dev"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$(dirname "$0")"
echo "$(date): starting from $(pwd)" >> "$LOG"
exec node ws-bridge-bundle.cjs 9182 >> "$LOG" 2>&1
