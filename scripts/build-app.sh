#!/bin/bash
# Build completa Quinki: vite (desktop) + web app + sidecar + tauri (cargo nel PATH)
set -e
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/.."
rm -rf dist dist-web node_modules/.vite
npx vite build
# Web app (F1): stessa UI in versione browser, servita dal sidecar sulla porta WS.
# Vive accanto al binario del sidecar nell'app bundle (Resources/sidecar/web).
npx vite build -c vite.config.web.ts
rm -rf src-tauri/resources/sidecar/web && mkdir -p src-tauri/resources/sidecar/web
# Web only: logo leggero (il desktop tiene l'originale 870px). La web app passa
# dal tunnel: questo file si scarica una volta sola e resta in cache.
if [ -f public/quinki-logo-small.png ]; then
  cp public/quinki-logo-small.png dist-web/quinki-logo.png
fi
cp -R dist-web/. src-tauri/resources/sidecar/web/
# APK Android scaricabili dal tunnel (percorso pubblico /apk/): sempre vivi,
# niente dipendenza da server locali.
if [ -d android/dist ]; then
  mkdir -p src-tauri/resources/sidecar/web/apk
  cp android/dist/*.apk src-tauri/resources/sidecar/web/apk/ 2>/dev/null || true
fi
bash scripts/build-sidecar.sh
# Dettatura locale (Parakeet TDT v3 via FluidAudio): compila l'helper swift e lo
# spedisce accanto al sidecar, stesso schema del tunnel.
if [ -x /usr/bin/swift ] || command -v swift >/dev/null 2>&1; then
  ( cd tools/dictation-helper && PATH="/opt/homebrew/bin:$PATH" /usr/bin/swift build -c release ) || true
fi
if [ -x tools/dictation-helper/.build/release/dictate ]; then
  mkdir -p src-tauri/resources/dictation-helper
  cp tools/dictation-helper/.build/release/dictate src-tauri/resources/dictation-helper/dictate
  echo "[build-app] dictation helper included"
fi
# Tunnel stabile (tsnet): nodo Tailscale in userspace dentro l'app.
# Ricompila se c'e' Go, altrimenti usa il binario gia' compilato.
if command -v go >/dev/null 2>&1 || [ -x /opt/homebrew/bin/go ]; then
  ( cd tools/tsnet-tunnel && PATH="/opt/homebrew/bin:$PATH" go build -o tsnet-tunnel . )
fi
cp tools/tsnet-tunnel/tsnet-tunnel src-tauri/resources/tsnet-tunnel
npx tauri build
