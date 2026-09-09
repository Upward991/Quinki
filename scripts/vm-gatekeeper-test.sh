#!/bin/bash
# =============================================================================
# VM Gatekeeper test suite — run INSIDE the VM via SSH from the host.
# Usage: bash vm-gatekeeper-test.sh <DMG_URL> [HOST_IP]
# Results in ~/vm-test-results/ (screenshots + report)
# =============================================================================
set -uo pipefail

DMG_URL="${1:?Usage: vm-gatekeeper-test.sh <DMG_URL>}"
OUT="$HOME/vm-test-results"
mkdir -p "$OUT"
REPORT="$OUT/report.txt"
echo "=== Quinki VM Gatekeeper Test — $(date) ===" > "$REPORT"

log()  { echo "$1" | tee -a "$REPORT"; }
shot() { screencapture -x "$OUT/$1.png" 2>/dev/null; echo "  [shot saved: $1.png]" >> "$REPORT"; }

# --- 0. System info ----------------------------------------------------------
log "0. SYSTEM"
log "  macOS: $(sw_vers -productVersion) ($(/usr/bin/arch))"
log "  Gatekeeper: $(spctl --status 2>&1)"
log "  RAM: $(sysctl -n hw.memsize | awk '{print $1/1073741824" GB"}')"

# --- 1. Download DMG via curl (should arrive WITHOUT quarantine) -------------
log ""
log "1. DOWNLOAD VIA CURL"
curl -fSL "$DMG_URL" -o "$HOME/Quinki.dmg" 2>>"$REPORT" && log "  curl OK: $(ls -lh $HOME/Quinki.dmg | awk '{print $5}')"
Q="$(xattr "$HOME/Quinki.dmg" 2>/dev/null | grep -c quarantine || true)"
log "  quarantine attr on DMG: $Q (expected: 0 — curl never sets it)"

# --- 2. Install via DMG mount + copy (simulating manual install) -------------
log ""
log "2. INSTALL"
hdiutil attach "$HOME/Quinki.dmg" -nobrowse -readonly -mountpoint /tmp/qmnt >/dev/null 2>&1
if [ -d /tmp/qmnt/Quinki.app ]; then
  log "  Quinki.app found in DMG"
  rm -rf /Applications/Quinki.app 2>/dev/null
  cp -R /tmp/qmnt/Quinki.app /Applications/ 2>>"$REPORT" && log "  copied to /Applications"
  hdiutil detach /tmp/qmnt -force >/dev/null 2>&1
  Q2="$(xattr /Applications/Quinki.app 2>/dev/null | grep -c quarantine || true)"
  log "  quarantine attr on installed app: $Q2 (0 = clean via curl path)"
else
  log "  ERROR: app not found in DMG"
fi

# --- 3. FIRST LAUNCH (clean path — no quarantine) ----------------------------
log ""
log "3. FIRST LAUNCH (clean, no quarantine)"
open /Applications/Quinki.app 2>>"$REPORT"
sleep 6
if pgrep -f "Quinki.app/Contents/MacOS" >/dev/null; then
  log "  PASS: app is running without any Gatekeeper block"
else
  log "  CHECK: app not running — capturing screen"
fi
shot "03-first-launch"

# --- 4. Simulate SAFARI download (set quarantine manually) -------------------
log ""
log "4. SAFARI SIMULATION (quarantine set manually)"
osascript -e 'quit app "Quinki"' 2>/dev/null; sleep 2
xattr -w com.apple.quarantine "0081;5f4e0001;Safari;1756700000;Quinki.dmg" /Applications/Quinki.app
log "  quarantine set: $(xattr -p com.apple.quarantine /Applications/Quinki.app 2>/dev/null | head -c 40)..."
open /Applications/Quinki.app 2>>"$REPORT"
sleep 6
if pgrep -f "Quinki.app/Contents/MacOS" >/dev/null; then
  log "  UNEXPECTED: app launched despite quarantine"
else
  log "  EXPECTED: app blocked by Gatekeeper (damaged/unidentified developer)"
fi
shot "04-quarantine-launch"

# --- 5. THE FIX: xattr -cr ----------------------------------------------------
log ""
log "5. XATTR FIX"
xattr -cr /Applications/Quinki.app
Q3="$(xattr /Applications/Quinki.app 2>/dev/null | grep -c quarantine || true)"
log "  quarantine after fix: $Q3 (expected: 0)"
open /Applications/Quinki.app 2>>"$REPORT"
sleep 8
if pgrep -f "Quinki.app/Contents/MacOS" >/dev/null; then
  log "  PASS: app runs after xattr -cr"
else
  log "  FAIL: app still not running"
fi
shot "05-after-xattr-fix"

# --- 6. NOTIFICATION PERMISSION state ------------------------------------------
log ""
log "6. NOTIFICATIONS"
log "  app in notification prefs: $(defaults read com.apple.ncprefs 2>/dev/null | grep -ci quinki)"
shot "06-notifications"

log ""
log "=== TEST COMPLETE — screenshots in $OUT ==="
echo ""
echo "=== REPORT ==="
cat "$REPORT"