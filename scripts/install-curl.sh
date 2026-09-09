#!/bin/bash
# =============================================================================
# Quinki installer — the Gatekeeper-free way
#
# Public usage (when hosted):
#   curl -fsSL https://quinki.app/install.sh | sh
#
# Local usage (for testing now, without hosting):
#   bash scripts/install-curl.sh /path/to/Quinki.dmg        (local DMG)
#   bash scripts/install-curl.sh https://192.168.1.23:8000/Quinki.dmg  (URL)
#
# Why this works without notarization:
#   Downloads via curl do NOT get the com.apple.quarantine attribute, so
#   Gatekeeper never triggers. We still run xattr -cr as a safety net.
# =============================================================================
set -euo pipefail

APP_NAME="Quinki"
APP_BUNDLE="${APP_NAME}.app"
INSTALL_DIR="/Applications"
URL="${QUINKI_URL:-}"

# --- 1. Source: argument, env var, or default (future public URL) -----------
SRC="${1:-$URL}"
if [ -z "$SRC" ]; then
  echo "Usage: $0 <Quinki.dmg | URL>   (or set QUINKI_URL)"
  echo "Example: QUINKI_URL=http://192.168.1.23:8000/Quinki.dmg bash $0"
  exit 1
fi

# --- 2. Arch check -----------------------------------------------------------
ARCH="$(uname -m)"
if [ "$ARCH" != "arm64" ]; then
  echo "Quinki is currently built for Apple Silicon (arm64). This Mac is $ARCH."
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'cleanup' EXIT
cleanup() {
  if [ -n "${MOUNT_POINT:-}" ]; then
    hdiutil detach "$MOUNT_POINT" -force >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR" >/dev/null 2>&1 || true
}
MOUNT_POINT=""

echo "[install] Downloading ${APP_NAME}..."
# --- 3. Fetch (curl = no quarantine, by design) ------------------------------
if [[ "$SRC" =~ ^https?:// ]]; then
  # Remote (accept self-signed for LAN testing: http server on the host)
  if [[ "$SRC" =~ ^http://[0-9] ]]; then
    curl -fkSL "$SRC" -o "$TMP_DIR/quinki.dmg"
  else
    curl -fSL "$SRC" -o "$TMP_DIR/quinki.dmg"
  fi
else
  # Local file
  [ -f "$SRC" ] || { echo "[install] File not found: $SRC"; exit 1; }
  cp "$SRC" "$TMP_DIR/quinki.dmg"
fi

echo "[install] Mounting..."
# --- 4. Mount DMG (mountpoint FISSO: niente parsing fragile dei path con spazi) ---
mkdir -p "$TMP_DIR/mnt"
hdiutil attach "$TMP_DIR/quinki.dmg" -nobrowse -readonly -mountpoint "$TMP_DIR/mnt" >/dev/null
MOUNT_POINT="$TMP_DIR/mnt"
[ -d "$MOUNT_POINT/$APP_BUNDLE" ] || { echo "[install] ${APP_BUNDLE} not found in DMG"; exit 1; }

echo "[install] Copying to ${INSTALL_DIR}..."
# --- 5. Stop running instance, replace ---------------------------------------
if pgrep -f "Quinki.app/Contents/MacOS" >/dev/null 2>&1; then
  echo "[install] Quinki is running — closing it..."
  osascript -e 'quit app "Quinki"' 2>/dev/null || pkill -f "Quinki.app/Contents/MacOS" 2>/dev/null || true
  sleep 1
fi
if [ -d "$INSTALL_DIR/$APP_BUNDLE" ]; then
  rm -rf "$INSTALL_DIR/$APP_BUNDLE"
fi
if ! cp -R "$MOUNT_POINT/$APP_BUNDLE" "$INSTALL_DIR/$APP_BUNDLE" 2>/dev/null; then
  # Fallback: admin privileges prompt (rare)
  osascript -e "do shell script \"cp -R '$MOUNT_POINT/$APP_BUNDLE' '$INSTALL_DIR/$APP_BUNDLE'\" with administrator privileges"
fi

echo "[install] Clearing quarantine attributes (safety net)..."
# --- 6. Safety net: no quarantine, ever -------------------------------------
xattr -cr "$INSTALL_DIR/$APP_BUNDLE" 2>/dev/null || true

echo "[install] Launching ${APP_NAME}..."
# --- 7. Launch ---------------------------------------------------------------
open "$INSTALL_DIR/$APP_BUNDLE"

echo "[install] Done. ${APP_NAME} is in ${INSTALL_DIR} and running."