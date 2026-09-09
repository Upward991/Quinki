#!/bin/bash
# Quinki installer (beta) — downloads and installs Quinki from GitHub Releases.
# Usage: curl -fsSL https://raw.githubusercontent.com/Upward991/quinki/main/install.sh | sh
set -e

VERSION="v1.0.0-beta.1"
REPO="Upward991/quinki"
DMG_URL="https://github.com/${REPO}/releases/download/${VERSION}/Quinki_${VERSION}_aarch64.dmg"
TMP_DMG="/tmp/quinki-install.dmg"
MOUNT_POINT="/Volumes/Quinki Installer"

echo "Quinki Installer"
echo "================="
echo ""

# Check architecture
ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
  echo "❌ Quinki requires Apple Silicon (M1/M2/M3/M4)."
  echo "   Your architecture: $ARCH"
  exit 1
fi

# Check macOS version
OS_VERSION=$(sw_vers -productVersion | cut -d. -f1)
if [ "$OS_VERSION" -lt 14 ]; then
  echo "❌ Quinki requires macOS 14 or later."
  echo "   Your macOS: $OS_VERSION"
  exit 1
fi

# Check if Quinki is running
if pgrep -f "Quinki.app" > /dev/null 2>&1; then
  echo "Stopping Quinki..."
  pkill -f "Quinki.app" 2>/dev/null || true
  sleep 2
fi

# Download
echo "Downloading Quinki ${VERSION}..."
curl -fsSL -o "$TMP_DMG" "$DMG_URL"
echo "  ✓ Downloaded"

# Mount
echo "Mounting disk image..."
hdiutil attach "$TMP_DMG" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
echo "  ✓ Mounted"

# Install
echo "Installing to /Applications..."
if [ -d "/Applications/Quinki.app" ]; then
  rm -rf "/Applications/Quinki.app.bak"
  mv "/Applications/Quinki.app" "/Applications/Quinki.app.bak"
  echo "  ✓ Previous version backed up"
fi
ditto "${MOUNT_POINT}/Quinki.app" "/Applications/Quinki.app"
echo "  ✓ Installed"

# Clear quarantine (curl downloads don't have it, but just in case)
xattr -cr "/Applications/Quinki.app" 2>/dev/null || true

# Unmount
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
rm -f "$TMP_DMG"

# Open
echo ""
echo "Opening Quinki..."
open "/Applications/Quinki.app"

echo ""
echo "✓ Quinki installed successfully!"
echo ""
echo "  Next steps:"
echo "  1. The tutorial will start automatically"
echo "  2. Go to Settings → Providers to sign in"
echo "  3. Use your existing subscriptions (ChatGPT, Claude, Copilot, Grok)"
echo "     or set up Ollama (free) for local models"
echo ""
echo "  Support the project: https://github.com/sponsors/Upward991"
echo ""