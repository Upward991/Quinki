#!/bin/bash
# Quinki installer (beta) — downloads and installs the latest Quinki from GitHub Releases.
# Usage: curl -fsSL https://raw.githubusercontent.com/Upward991/quinki/main/install.sh | sh
# Re-running this command always installs the latest version.
set -e

REPO="Upward991/quinki"
TMP_DMG="/tmp/quinki-install.dmg"
MOUNT_POINT="/Volumes/Quinki Installer"

# Fetch the latest release tag + DMG asset URL from the GitHub API (no hardcoded version:
# re-running the installer always gets the latest published release, prereleases included)
echo "Fetching latest release..."
LATEST_JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=1")
VERSION=$(echo "$LATEST_JSON" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
DMG_URL=$(echo "$LATEST_JSON" | grep -o '"browser_download_url": *"[^"]*\.dmg"' | head -1 | cut -d'"' -f4)

if [ -z "$VERSION" ] || [ -z "$DMG_URL" ]; then
  echo "❌ Could not fetch the latest release. Check your connection and retry."
  exit 1
fi

echo "Latest release: ${VERSION}"

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
hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
hdiutil attach "$TMP_DMG" -mountpoint "$MOUNT_POINT" -nobrowse -quiet
echo "  ✓ Mounted"

# Install
# NO backup: the public installer never leaves .bak copies on user machines
# (re-running it always re-fetches the latest release). Clean up any stale .bak
# left by previous installer versions.
echo "Installing to /Applications..."
if [ -d "/Applications/Quinki.app.bak" ]; then
  rm -rf "/Applications/Quinki.app.bak"
  echo "  ✓ Removed stale backup from a previous install"
fi
rm -rf "/Applications/Quinki.app"
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