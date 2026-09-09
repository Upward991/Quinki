#!/bin/bash
# Build script: creates App Expert.app as a SEPARATE app bundle
# - Independent from Quinki.app (not nested inside it)
# - Own sidecar binary copy (port 9183)
# - Shared data: ~/.quinki/

set -e

SOURCE_APP="src-tauri/target/release/bundle/macos/Quinki.app"
EXPERT_APP="src-tauri/target/release/bundle/macos/App Expert.app"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Creating App Expert.app (separate bundle)..."

# Copy the main app as the base
rm -rf "$EXPERT_APP"
ditto "$SOURCE_APP" "$EXPERT_APP"

# Modify Info.plist — separate app identity
PLIST="$EXPERT_APP/Contents/Info.plist"
MAIN_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST" 2>/dev/null || echo "com.quinki.app")
/usr/libexec/PlistBuddy -c "Set :CFBundleName App Expert" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName App Expert" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${MAIN_BUNDLE_ID}.expert" "$PLIST"

# Copy expert icon
EXPERT_ICNS="$PROJECT_DIR/src-tauri/icons/expert-icon.icns"
if [ -f "$EXPERT_ICNS" ]; then
  cp "$EXPERT_ICNS" "$EXPERT_APP/Contents/Resources/icon.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon" "$PLIST" 2>/dev/null || true
  echo "Expert icon installed"
fi

# The sidecar binary is already in the app bundle resources (from Tauri build)
# The start-expert.sh is also already there. The binary detects expert mode
# via is_expert_mode() which checks the exe path for "App Expert".

echo "App Expert.app created at $EXPERT_APP"
echo "  - Separate bundle (not nested)"
echo "  - Own sidecar binary"
echo "  - Port: 9183 (via QUINKI_WS_PORT env in start-expert.sh)"
echo "  - Shared data: ~/.quinki/"

# Sign with the stable self-signed identity so macOS TCC permissions persist
# across rebuilds (see scripts/codesign-quinki.sh for the why).
bash "$PROJECT_DIR/scripts/codesign-quinki.sh" "$EXPERT_APP"

# Refresh icon cache
# (rimosso killall Dock: refreshava tutto il desktop macOS a ogni install)
echo "Done!"
