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
cp -R dist-web/. src-tauri/resources/sidecar/web/
bash scripts/build-sidecar.sh
npx tauri build
