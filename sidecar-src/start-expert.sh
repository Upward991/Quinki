#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
echo "$(date): start-expert.sh called (from app bundle)" >> "$LOG"

if lsof -ti:9183 > /dev/null 2>&1; then
  echo "$(date): port 9183 already in use, NOT starting" >> "$LOG"
  exit 0
fi

EXPERT_DIR="$HOME/.quinki-expert"
MAIN_DIR="$HOME/.quinki"

# Create expert data dir if it doesn't exist
mkdir -p "$EXPERT_DIR"

# First run: copy agents/skills/models/providers from main
if [ ! -d "$EXPERT_DIR/agents" ] && [ -d "$MAIN_DIR/agents" ]; then
  echo "$(date): First run — copying agents/skills from main" >> "$LOG"
  cp -R "$MAIN_DIR/agents" "$EXPERT_DIR/agents"
  [ -d "$MAIN_DIR/skills" ] && cp -R "$MAIN_DIR/skills" "$EXPERT_DIR/skills"
  [ -f "$MAIN_DIR/models.json" ] && cp "$MAIN_DIR/models.json" "$EXPERT_DIR/models.json"
  [ -f "$MAIN_DIR/quinki-providers.json" ] && cp "$MAIN_DIR/quinki-providers.json" "$EXPERT_DIR/quinki-providers.json"
  [ -f "$MAIN_DIR/dashboard-providers.json" ] && cp "$MAIN_DIR/dashboard-providers.json" "$EXPERT_DIR/dashboard-providers.json"
  [ -f "$MAIN_DIR/quinki-global.json" ] && cp "$MAIN_DIR/quinki-global.json" "$EXPERT_DIR/quinki-global.json"
  [ -f "$MAIN_DIR/dashboard-global.json" ] && cp "$MAIN_DIR/dashboard-global.json" "$EXPERT_DIR/dashboard-global.json"
  echo "$(date): Copy complete" >> "$LOG"
fi

# Create symlinks for SHARED data (sessions, auth, attachments, folders, context)
# These must point to the main dir so both apps see the same data
SHARED_FILES=(
  "quinki-sessions.json"
  "dashboard-sessions.json"
  "auth.json"
  "models.json"
  "dashboard-context-usage.json"
  "quinki-context-usage.json"
  "dashboard-folders.json"
)
SHARED_DIRS=(
  "sessions"
  "attachments"
)

for f in "${SHARED_FILES[@]}"; do
  if [ -f "$MAIN_DIR/$f" ] && [ ! -L "$EXPERT_DIR/$f" ]; then
    rm -f "$EXPERT_DIR/$f"
    ln -s "$MAIN_DIR/$f" "$EXPERT_DIR/$f"
  fi
done

for d in "${SHARED_DIRS[@]}"; do
  if [ -d "$MAIN_DIR/$d" ] && [ ! -L "$EXPERT_DIR/$d" ]; then
    rm -rf "$EXPERT_DIR/$d"
    ln -s "$MAIN_DIR/$d" "$EXPERT_DIR/$d"
  fi
done

export QUINKI_AGENT_DIR="$EXPERT_DIR"
export PI_CODING_AGENT_DIR="$EXPERT_DIR"
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
