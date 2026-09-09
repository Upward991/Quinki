#!/bin/bash
# Build completa Quinki: vite + sidecar + tauri (con cargo nel PATH)
set -e
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/.."
rm -rf dist node_modules/.vite
npx vite build
bash scripts/build-sidecar.sh
npx tauri build
