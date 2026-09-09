#!/bin/bash
# ============================================================================
# codesign-quinki.sh — Sign a Quinki .app bundle with the STABLE identity.
#
# WHY: ad-hoc signed apps get a NEW code signature at every build, so macOS
# TCC treats every reinstall as a brand-new app: Screen Recording / Full Disk
# Access / etc. must be granted AGAIN even though the toggle in System
# Settings still shows the old grant as "enabled".
#
# Signing every build with the same self-signed certificate ("Quinki
# Self-Signing", stored in the login keychain) gives the app a stable
# designated requirement (identifier + certificate hash), so TCC recognizes
# it as the SAME app across updates and the granted permissions PERSIST.
#
# Usage:
#   scripts/codesign-quinki.sh <path-to.app>
#
# Fallback: if the identity is missing from the keychain, falls back to
# ad-hoc signing with a warning (install must never break because of this).
# ============================================================================
set -e

APP="$1"
CERT="Quinki Self-Signing"

if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "[codesign] ERROR: no app bundle at '$APP'"
  exit 1
fi
if [[ "$APP" == *"Expert"* && "$APP" == "/Applications/Quinki.app" ]]; then
  echo "[codesign] ERROR: refusing impossible path"
  exit 1
fi

# Which identity do we have?
SIGN_ID="$CERT"
if ! security find-identity -v -p codesigning 2>/dev/null | grep -q "\"$CERT\""; then
  echo "[codesign] WARNING: identity '$CERT' not found in keychain."
  echo "[codesign] Falling back to AD-HOC signing: TCC permissions will NOT be stable."
  SIGN_ID="-"
else
  echo "[codesign] Using stable identity: $CERT"
fi

# 1) Sign every nested Mach-O in the sidecar resources dir (bare binaries
#    need an explicit stable identifier, otherwise codesign derives it from
#    the file name, which is fine here but we keep it pinned anyway).
SIDECAR_DIR="$APP/Contents/Resources/resources/sidecar"
if [ -d "$SIDECAR_DIR" ]; then
  find "$SIDECAR_DIR" -type f | while read -r f; do
    if file -b "$f" | grep -q "Mach-O"; then
      codesign --force --sign "$SIGN_ID" --identifier com.quinki.sidecar "$f" 2>/dev/null \
        && echo "[codesign] signed sidecar binary: $(basename "$f")"
    fi
  done
fi

# 2) Sign the bundle itself (identifier comes from Info.plist:
#    com.quinki.app / com.quinki.app.expert). No hardened runtime on
#    purpose: the bun-compiled sidecar needs JIT and without
#    --options runtime no entitlements are required.
codesign --force --sign "$SIGN_ID" "$APP"
echo "[codesign] signed bundle: $APP"

# 3) Verify the whole tree
if codesign --verify --deep "$APP" 2>/dev/null; then
  echo "[codesign] verify OK: signature is valid"
else
  echo "[codesign] verify FAILED — signature problem, inspect manually"
  exit 1
fi