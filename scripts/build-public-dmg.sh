#!/bin/bash
# ============================================================================
# build-public-dmg.sh — Build the PUBLIC Quinki DMG (for GitHub releases).
#
# Pipeline: full build (vite + sidecar + tauri) → stable-identity signing
# ("Quinki Self-Signing", required so TCC permissions persist across
# reinstalls) → hdiutil DMG (build-dmg.sh; Tauri's own DMG bundler is broken
# on this machine — do NOT rely on npx tauri build's dmg output).
#
# Output: ~/Downloads/Quinki_v<version>_aarch64.dmg
# ============================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "[public-dmg] 1/3 Full build (vite + sidecar + tauri)..."
bash scripts/build-app.sh

echo "[public-dmg] 2/3 Sign + create DMG..."
bash scripts/build-dmg.sh

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json | head -1)"
DMG="src-tauri/target/release/bundle/dmg/Quinki-signed.dmg"
OUT="$HOME/Downloads/Quinki_v${VERSION}_aarch64.dmg"

echo "[public-dmg] 3/3 Copy to Downloads..."
mv "$DMG" "$OUT"
echo "[public-dmg] DONE: $OUT ($(ls -la "$OUT" | awk '{printf "%.0f MB", $5/1024/1024}'))"
echo "[public-dmg] MD5: $(md5 -q "$OUT")"
echo ""
echo "[public-dmg] USER INSTRUCTIONS:"
echo "  1. Open the DMG → drag Quinki into Applications"
echo "  2. First launch: right-click → Open (app is self-signed, not notarized)"