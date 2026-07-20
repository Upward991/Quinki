#!/bin/bash
# Kill any existing process on port 9182
lsof -ti:9182 | xargs kill -9 2>/dev/null
pkill -f "ws-bridge" 2>/dev/null
sleep 1

# Set agent dir
export QUINKI_AGENT_DIR="$HOME/.pi/agent-quinki-dev"

# Start ws-bridge
cd "$(dirname "$0")"
exec npx tsx ws-bridge.ts 9182
