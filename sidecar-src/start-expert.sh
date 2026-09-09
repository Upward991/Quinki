#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
echo "$(date): start-expert.sh called" >> "$LOG"

if lsof -ti:9183 > /dev/null 2>&1; then
  echo "$(date): port 9183 already in use, NOT starting" >> "$LOG"
  exit 0
fi

# Use the SAME data directory as the main app (~/.quinki/)
# Only the sidecar CODE is separate (inside the app bundle)
# This ensures agents, skills, sessions, models — everything is shared
export QUINKI_AGENT_DIR="$HOME/.quinki"
export PI_CODING_AGENT_DIR="$HOME/.quinki"
export QUINKI_WS_PORT="9183"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$(dirname "$0")"

if [ -f "bundle/ws-bridge.cjs" ]; then
  echo "$(date): starting bundled ws-bridge.cjs on port 9183" >> "$LOG"
  exec node bundle/ws-bridge.cjs >> "$LOG" 2>&1
else
  echo "$(date): starting tsx ws-bridge.ts on port 9183" >> "$LOG"
  exec npx tsx ws-bridge.ts >> "$LOG" 2>&1
fi
