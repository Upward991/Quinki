#!/bin/bash
LOG="$HOME/.quinki-sidecar.log"
echo "$(date): start.sh called" >> "$LOG"
export QUINKI_AGENT_DIR="$HOME/.quinki"
export PI_CODING_AGENT_DIR="$HOME/.quinki"
export QUINKI_WS_PORT=9182
DIR="$(cd "$(dirname "$0")" && pwd)"

# Wait up to ~8s for a previously-killed sidecar to release port 9182.
# Fixes: after install/restart the sidecar wasn't found — start.sh exited early
# because the port was still briefly bound by the dying old process.
i=0
while [ $i -lt 8 ]; do
  if ! lsof -ti:9182 >/dev/null 2>&1; then break; fi
  sleep 1
  i=$((i+1))
done

exec "$DIR/quinki-sidecar-ws" >> "$LOG" 2>&1
