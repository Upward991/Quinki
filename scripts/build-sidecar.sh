#!/usr/bin/env bash
# scripts/build-sidecar.sh — bundla il sidecar come EXE STANDALONE (Node.js + tsx)
#
# Per ora usa tsx (dev mode). In futuro: pkg/nexe per binario standalone.
#
# Uso:
#   bash scripts/build-sidecar.sh          # dev: tsx
#   bash scripts/build-sidecar.sh prod     # prod: pkg (TODO)

set -e

MODE="${1:-dev}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SIDECAR_SRC_DIR="$PROJECT_DIR/sidecar-src"

if [ ! -d "$SIDECAR_SRC_DIR" ]; then
  echo "[build-sidecar] ERROR: sidecar-src not found in $SIDECAR_SRC_DIR" >&2
  exit 1
fi

if [ "$MODE" = "dev" ]; then
  echo "[build-sidecar] Dev mode: using tsx (no compilation needed)"
  echo "[build-sidecar] Run with: cd sidecar-src && npx tsx sidecar.ts"
  echo "[build-sidecar] OK"
  exit 0
fi

# TODO: prod mode with pkg/nexe
if [ "$MODE" = "prod" ]; then
  echo "[build-sidecar] Prod mode: TODO — use pkg or nexe to create standalone binary"
  echo "[build-sidecar] For now, ship Node.js runtime + tsx"
  exit 0
fi

echo "[build-sidecar] ERROR: unknown mode '$MODE' (use 'dev' or 'prod')" >&2
exit 1
