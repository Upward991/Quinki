#!/bin/bash
set -e

cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"

echo "=== Building sidecar binaries ==="

# Compile ws-bridge
echo "Compiling ws-bridge..."
cd sidecar-src
bun build --compile --target=bun-darwin-arm64 bundle/ws-bridge-standalone.ts --outfile quinki-ws-bridge

# Compile sidecar
echo "Compiling sidecar..."
bun build --compile --target=bun-darwin-arm64 sidecar.ts --outfile quinki-sidecar-full

# Copy binaries + start scripts to Tauri resources
cd ..
mkdir -p src-tauri/resources/sidecar
cp sidecar-src/quinki-ws-bridge src-tauri/resources/sidecar/
cp sidecar-src/quinki-sidecar-full src-tauri/resources/sidecar/
cp sidecar-src/start.sh src-tauri/resources/sidecar/
cp sidecar-src/start-expert.sh src-tauri/resources/sidecar/
cp sidecar-src/expert-watchdog.sh src-tauri/resources/sidecar/

echo "=== Sidecar binaries ready in src-tauri/resources/sidecar/ ==="
ls -lh src-tauri/resources/sidecar/
