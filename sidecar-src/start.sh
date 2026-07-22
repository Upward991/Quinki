#!/bin/bash
LOG="$HOME/.quinki-sidecar.log"
echo "$(date): start.sh called" >> "$LOG"

# Only kill and restart if port 9182 is NOT in use
if lsof -ti:9182 > /dev/null 2>&1; then
  echo "$(date): port 9182 already in use, NOT killing" >> "$LOG"
  exit 0
fi

pkill -f "ws-bridge" 2>/dev/null
sleep 1

export QUINKI_AGENT_DIR="$HOME/.pi/agent-quinki-dev"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$(dirname "$0")"
echo "$(date): starting from $(pwd)" >> "$LOG"
exec node ws-bridge-bundle.cjs 9182 >> "$LOG" 2>&1
