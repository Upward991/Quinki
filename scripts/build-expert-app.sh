#!/bin/bash
# Post-build script: creates Quinki Expert.app from Quinki.app
# Run after `npx tauri build` or `flutter build macos --release`

set -e

SOURCE_APP="${1:-src-tauri/target/release/bundle/macos/Quinki.app}"
DEST_APP="/Applications/Quinki Expert.app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Creating Quinki Expert.app..."

# Remove old expert app
rm -rf "$DEST_APP"

# Copy the main app
ditto "$SOURCE_APP" "$DEST_APP"

# Modify Info.plist: change name, bundle ID, and icon
PLIST="$DEST_APP/Contents/Info.plist"

# Get the main bundle ID
MAIN_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST" 2>/dev/null || echo "com.quinki.app")

# Set new name
/usr/libexec/PlistBuddy -c "Set :CFBundleName Quinki Expert" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Quinki Expert" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleExecutable Quinki" "$PLIST" 2>/dev/null || true

# Set new bundle ID (append .expert)
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${MAIN_BUNDLE_ID}.expert" "$PLIST"

# Copy expert icon into the app bundle
EXPERT_ICNS="$PROJECT_DIR/src-tauri/icons/expert-icon.icns"
if [ -f "$EXPERT_ICNS" ]; then
  cp "$EXPERT_ICNS" "$DEST_APP/Contents/Resources/icon.icns"
  # Update the icon reference in Info.plist
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon" "$PLIST" 2>/dev/null || true
  echo "Expert icon installed"
fi

# Refresh icon cache
killall Dock 2>/dev/null || true

echo "Quinki Expert.app created at $DEST_APP"