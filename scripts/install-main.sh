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

# 2a2) Scrivi l'hash git CORRENTE nel version.txt del bundle installato.
#      L'Expert confronta Main vs Expert version.txt per mostrare il banner
#      "Update available. Sync and restart to apply." — l'hash cambia a OGNI fix.
GIT_HASH=$(git -C "$(dirname "$0")/.." rev-parse --short HEAD 2>/dev/null || echo "dev")
if [ -n "$GIT_HASH" ]; then
  echo "$GIT_HASH" > "$MAIN_APP/Contents/Resources/resources/sidecar/version.txt"
  echo "[install-main] version.txt -> $GIT_HASH"
fi

# 2b) Sign with the STABLE self-signed identity ("Quinki Self-Signing").
#     The old ad-hoc + custom --requirements trick does NOT work on modern
#     macOS: TCC ignores it for Screen Recording / Full Disk Access and keys
#     the grant on the code signature, which changes at every ad-hoc build.
#     A stable certificate identity makes TCC recognize the app as the SAME
#     app across reinstalls, so granted permissions PERSIST.
bash "$(dirname "$0")/codesign-quinki.sh" "$MAIN_APP"

# 3) Kill ONLY the main sidecar (port 9182) AND the main app process (by exact path).
#    The App Expert process is NEVER matched (its path is /Applications/App Expert.app/...).
# Kill ALL Quinki sidecar processes (old app instances respawn their sidecars via
# watchdog and steal port 9182). The App Expert sidecar is NEVER matched (different path).
pkill -f "/Applications/Quinki.app/Contents/Resources/resources/sidecar/quinki-sidecar-ws" 2>/dev/null || true
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
