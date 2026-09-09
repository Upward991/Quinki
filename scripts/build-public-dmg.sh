#!/bin/bash
# === DMG PUBBLICO: firma AD-HOC (nessun certificato) ===
# Su macOS: tasto destro → Apri → "Open" → funziona. ZERO comandi Terminal.
# La firma self-signed "Quinki Self-Signing" NON funziona sui Mac altrui
# (certificato sconosciuto → firma INVALIDA → blocco duro, nemmeno right-click funziona).
# Ad-hoc è sempre strutturalmente valida → macOS fa solo il prompt "Open".

set -e
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "[public-dmg] Build frontend..."
rm -rf dist node_modules/.vite
npx vite build

echo "[public-dmg] Build sidecar..."
bash scripts/build-sidecar.sh

echo "[public-dmg] version.txt..."
echo "$(git rev-parse --short HEAD)" > src-tauri/resources/sidecar/version.txt

echo "[public-dmg] Build Tauri..."
export PATH="$HOME/.cargo/bin:$PATH"
touch src-tauri/src/main.rs src-tauri/src/lib.rs
npx tauri build

BUNDLE="src-tauri/target/release/bundle/macos/Quinki.app"
DMG="src-tauri/target/release/bundle/dmg/Quinki_1.0.0-beta.1_aarch64.dmg"

echo "[public-dmg] Rimuovo firma self-signed, firmo AD-HOC..."
# Rimuovi la firma esistente e firma ad-hoc (nessun certificato)
codesign --remove-signature "$BUNDLE" 2>/dev/null || true
codesign --force --deep --sign - "$BUNDLE"
echo "[public-dmg] Firma ad-hoc: $(codesign -v "$BUNDLE" 2>&1 || echo 'unsigned')"

echo "[public-dmg] Copio DMG in Downloads..."
cp "$DMG" ~/Downloads/
echo "[public-dmg] DONE: $(ls -la ~/Downloads/Quinki_1.0.0-beta.1_aarch64.dmg | awk '{printf "%.0f MB", $5/1024/1024}')"
echo "[public-dmg] MD5: $(md5 -q ~/Downloads/Quinki_1.0.0-beta.1_aarch64.dmg)"
echo ""
echo "[public-dmg] ISTRUZIONI UTENTE:"
echo "  1. Apri il DMG → trascina Quinki in Applications"
echo "  2. TASTO DESTRO su Quinki → Apri → clicca 'Open'"
echo "  3. Fatto. Nessun comando Terminal."
