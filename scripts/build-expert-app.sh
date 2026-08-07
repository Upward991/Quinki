#!/bin/bash
# Post-build script: creates Quinki Expert.app from Quinki.app
# - Separate app with its own sidecar copy (port 9183)
# - Placed INSIDE the main app bundle: Quinki.app/Contents/Resources/Quinki Expert.app
# - Shared data: ~/.quinki/

set -e

SOURCE_APP="src-tauri/target/release/bundle/macos/Quinki.app"
EXPERT_APP="src-tauri/target/release/bundle/macos/Quinki Expert.app"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_SRC="$PROJECT_DIR/sidecar-src"

echo "Creating Quinki Expert.app..."

# Remove old expert app
rm -rf "$EXPERT_APP"

# Copy the main app
ditto "$SOURCE_APP" "$EXPERT_APP"

# Modify Info.plist
PLIST="$EXPERT_APP/Contents/Info.plist"
MAIN_BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST" 2>/dev/null || echo "com.quinki.app")
/usr/libexec/PlistBuddy -c "Set :CFBundleName Quinki Expert" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Quinki Expert" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${MAIN_BUNDLE_ID}.expert" "$PLIST"

# Copy expert icon
EXPERT_ICNS="$PROJECT_DIR/src-tauri/icons/expert-icon.icns"
if [ -f "$EXPERT_ICNS" ]; then
  cp "$EXPERT_ICNS" "$EXPERT_APP/Contents/Resources/icon.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile icon" "$PLIST" 2>/dev/null || true
  echo "Expert icon installed"
fi

# Copy sidecar code INTO the Expert app bundle (separate copy, independent from main)
SIDECAR_DEST="$EXPERT_APP/Contents/Resources/sidecar"
mkdir -p "$SIDECAR_DEST"
# Copy only what's needed: bundle, start-expert.sh, sidecar.ts, pi-bridge.ts, agent-handlers.ts, vendor
cp -R "$SIDECAR_SRC/bundle" "$SIDECAR_DEST/"
cp "$SIDECAR_SRC/start-expert.sh" "$SIDECAR_DEST/"
cp "$SIDECAR_SRC/sidecar.ts" "$SIDECAR_DEST/"
cp "$SIDECAR_SRC/pi-bridge.ts" "$SIDECAR_DEST/"
cp "$SIDECAR_SRC/agent-handlers.ts" "$SIDECAR_DEST/"
cp "$SIDECAR_SRC/providers.ts" "$SIDECAR_DEST/" 2>/dev/null || true
cp "$SIDECAR_SRC/seed.ts" "$SIDECAR_DEST/" 2>/dev/null || true
cp -R "$SIDECAR_SRC/vendor" "$SIDECAR_DEST/" 2>/dev/null || true
cp "$SIDECAR_SRC/package.json" "$SIDECAR_DEST/" 2>/dev/null || true
cp "$SIDECAR_SRC/tsconfig.json" "$SIDECAR_DEST/" 2>/dev/null || true
echo "Sidecar copied to Expert app bundle (independent copy)"

# Also copy the expert-watchdog.sh
cp "$SIDECAR_SRC/expert-watchdog.sh" "$SIDECAR_DEST/"

# Update start-expert.sh inside the bundle to use the bundled path
cat > "$SIDECAR_DEST/start-expert.sh" << 'EXPERT_START'
#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
echo "$(date): start-expert.sh called (from app bundle)" >> "$LOG"

if lsof -ti:9183 > /dev/null 2>&1; then
  echo "$(date): port 9183 already in use, NOT starting" >> "$LOG"
  exit 0
fi

export QUINKI_AGENT_DIR="$HOME/.quinki"
export PI_CODING_AGENT_DIR="$HOME/.quinki"
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
EXPERT_START
chmod +x "$SIDECAR_DEST/start-expert.sh"

# Update watchdog to use bundled path
cat > "$SIDECAR_DEST/expert-watchdog.sh" << 'WATCHDOG'
#!/bin/bash
LOG="$HOME/.quinki-expert-sidecar.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "$(date): expert-watchdog started from $SCRIPT_DIR" >> "$LOG"

while true; do
  if ! lsof -ti:9183 > /dev/null 2>&1; then
    echo "$(date): port 9183 not in use, starting expert sidecar..." >> "$LOG"
    bash "$SCRIPT_DIR/start-expert.sh" &
    sleep 2
    if lsof -ti:9183 > /dev/null 2>&1; then
      echo "$(date): expert sidecar started successfully" >> "$LOG"
    else
      echo "$(date): expert sidecar failed, retrying in 3s..." >> "$LOG"
      sleep 3
    fi
  fi
  sleep 2
done
WATCHDOG
chmod +x "$SIDECAR_DEST/expert-watchdog.sh"

echo "Quinki Expert.app created at $EXPERT_APP"
echo "  - Own sidecar copy: $SIDECAR_DEST"
echo "  - Port: 9183"
echo "  - Shared data: ~/.quinki/"


# Copy Expert.app inside the main app bundle
echo "Installing Expert.app inside main app bundle..."
EXPERT_IN_MAIN="$SOURCE_APP/Contents/Resources/Quinki Expert.app"
rm -rf "$EXPERT_IN_MAIN"
ditto "$EXPERT_APP" "$EXPERT_IN_MAIN"
echo "Expert.app installed at: $EXPERT_IN_MAIN"

# Refresh icon cache
killall Dock 2>/dev/null || true
echo "Done!"
