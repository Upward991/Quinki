#!/bin/bash
LOG="$HOME/.quinki-sidecar.log"
echo "$(date): start.sh called" >> "$LOG"

if lsof -ti:9182 > /dev/null 2>&1; then
  echo "$(date): port 9182 already in use, NOT killing" >> "$LOG"
  exit 0
fi

pkill -f "ws-bridge" 2>/dev/null

export QUINKI_AGENT_DIR="$HOME/.pi/agent-quinki-dev"
export PI_CODING_AGENT_DIR="$HOME/.pi/agent-quinki-dev"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

cd "$(dirname "$0")"

# Use bundled ws-bridge.js (esbuild) — 20x faster than npx tsx
# Fallback to tsx if bundle doesn't exist
if [ -f "bundle/ws-bridge.cjs" ]; then
  echo "$(date): starting bundled ws-bridge.cjs from $(pwd)" >> "$LOG"
  exec node bundle/ws-bridge.cjs >> "$LOG" 2>&1
else
  echo "$(date): starting tsx ws-bridge.ts from $(pwd) (no bundle)" >> "$LOG"
  exec npx tsx ws-bridge.ts >> "$LOG" 2>&1
fi