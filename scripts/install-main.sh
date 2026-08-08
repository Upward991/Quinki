#!/bin/bash
# ============================================================================
# install-main.sh — Install/update the QUINKI MAIN app only.
#
# This is the ONLY install command the App Expert agent should use.
# It is built so that it can NEVER touch the App Expert app:
#   - backs up /Applications/Quinki.app (mv, not rm)
#   - installs the new build (ditto)
#   - kills ONLY port 9182 (the main sidecar) — never 9183
#   - clears ONLY the main app webview caches
#   - reopens /Applications/Quinki.app
#   - contains hard safety guards refusing 'Expert' targets
#
# The Expert app is a completely separate bundle and is never referenced here.
# ============================================================================
set -e

# Relative to this repo root.
MAIN_BUNDLE="src-tauri/target/release/bundle/macos/Quinki.app"
MAIN_APP="/Applications/Quinki.app"
HOME_DIR="$HOME"

echo "[install-main] Starting main-app install..."

# --- Hard safety guards (by construction — never can hit the Expert app) ---
for p in "$MAIN_APP" "$MAIN_BUNDLE"; do
  if [[ "$p" == *"Expert"* ]]; then
    echo "[install-main] REFUSING: path '$p' contains 'Expert'. Aborting."
    exit 1
  fi
done

if ! [ -d "$MAIN_BUNDLE" ]; then
  echo "[install-main] ERROR: build bundle not found at '$MAIN_BUNDLE'"
  exit 1
fi

# 1) Backup current main app (mv, never rm the live app)
if [ -d "$MAIN_APP" ]; then
  rm -rf "$MAIN_APP.bak" 2>/dev/null || true
  mv "$MAIN_APP" "$MAIN_APP.bak"
  echo "[install-main] Backed up existing app -> $MAIN_APP.bak"
fi

# 2) Install new build
ditto "$MAIN_BUNDLE" "$MAIN_APP"
echo "[install-main] Installed $MAIN_APP"

# 3) Kill ONLY the main sidecar (port 9182) AND the main app process (by exact path).
#    The App Expert process is NEVER matched (its path is /Applications/App Expert.app/...).
if command -v lsof >/dev/null 2>&1; then
  pids=$(lsof -ti:9182 2>/dev/null || true)
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    echo "[install-main] Killed main sidecar (port 9182)."
  fi
fi
# Kill the running main app process by its exact path so the new bundle actually launches
pkill -f "/Applications/Quinki.app/Contents/MacOS/quinki" 2>/dev/null || true
sleep 1

# 4) Clear main app webview caches only
rm -rf "$HOME_DIR/Library/WebKit/com.quinki.app" \
       "$HOME_DIR/Library/Caches/com.quinki.app" \
       "$HOME_DIR/Library/HTTPStorages/com.quinki.app" 2>/dev/null || true

# 5) Reopen main app
open "$MAIN_APP"
echo "[install-main] Main app installed and reopened. The App Expert app was NOT touched."
