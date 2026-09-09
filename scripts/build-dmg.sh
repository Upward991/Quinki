#!/bin/bash
# ============================================================================
# build-dmg.sh — Create a SIGNED Quinki DMG.
#
# WHY: `npx tauri build` produces an UNSIGNED bundle in the DMG (only the
# linker signature on the Mach-O). On other Macs (Sequoia), downloading that
# DMG via browser/WhatsApp → Gatekeeper sees a broken seal → "damaged and
# can't be opened" — NOT bypassable with right-click → Open. The root cause
# found in VM testing (01 set): "code has no resources but signature
# indicates they must be present" (missing Resources/CodeResources).
#
# FIX: sign the bundle (stable self-signed identity, ad-hoc fallback) and
# THEN create the DMG. Signed ad-hoc + quarantine → users get the milder,
# bypassable "Apple could not verify" dialog instead of "damaged".
#
# Usage: bash scripts/build-dmg.sh
# Output: src-tauri/target/release/bundle/dmg/Quinki-signed.dmg
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/src-tauri/target/release/bundle/macos/Quinki.app"
OUT_DIR="$ROOT/src-tauri/target/release/bundle/dmg"
OUT="$OUT_DIR/Quinki-signed.dmg"
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/src-tauri/tauri.conf.json" | head -1)"

[ -d "$APP" ] || { echo "[build-dmg] ERROR: bundle not found at $APP — run tauri build first"; exit 1; }

echo "[build-dmg] 1/4 Signing the bundle..."
bash "$ROOT/scripts/codesign-quinki.sh" "$APP"

echo "[build-dmg] 2/4 Verifying signature..."
codesign -vv --deep "$APP" 2>&1 | sed 's/^/[build-dmg]   /'
spctl -a -t exec "$APP" 2>&1 | sed 's/^/[build-dmg]   spctl: /' || true

echo "[build-dmg] 3/4 Creating DMG (v$VERSION)..."
mkdir -p "$OUT_DIR"
rm -f "$OUT"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/Quinki.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Quinki" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null

echo "[build-dmg] 4/4 Final check — the DMG content must be VALID:"
hdiutil attach "$OUT" -nobrowse -readonly -mountpoint "$STAGE/check" >/dev/null 2>&1
codesign -vv --deep "$STAGE/check/Quinki.app" 2>&1 | sed 's/^/[build-dmg]   /'
hdiutil detach "$STAGE/check" -force >/dev/null 2>&1

ls -lh "$OUT" | awk -v o="$OUT" '{print "[build-dmg] DONE: " o " (" $5 ")"}'