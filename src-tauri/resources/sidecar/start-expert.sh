#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
echo "$(date): start-expert.sh called" >> "$LOG"
export QUINKI_AGENT_DIR="$HOME/.quinki"
export PI_CODING_AGENT_DIR="$HOME/.quinki"
export QUINKI_WS_PORT=9183
DIR="$(cd "$(dirname "$0")" && pwd)"

# Wait up to ~8s for a previously-killed sidecar to release port 9183.
# Fixes: after sync/restart the sidecar wasn't found — start-expert.sh exited early
# because the port was still briefly bound by the dying old process.
i=0
while [ $i -lt 8 ]; do
  if ! lsof -ti:9183 >/dev/null 2>&1; then break; fi
  sleep 1
  i=$((i+1))
done

exec "$DIR/quinki-sidecar-ws" >> "$LOG" 2>&1
