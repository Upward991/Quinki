#!/usr/bin/env bash
# Build the sidecar binary with build-time secret injection.
# The GitHub OAuth secret is read from ~/.quinki/oauth.conf (NEVER from the repo)
# and injected via `bun build --define process.env.QUINKI_GH_SECRET`. The repo
# source stays secret-free; the compiled binary works everywhere (the secret is
# unavoidable in a desktop binary, same as VSCode and friends).
# Runtime fallback: the binary also reads ~/.quinki/oauth.conf if present.
set -euo pipefail
cd "$(dirname "$0")/.." # project root

CONF="$HOME/.quinki/oauth.conf"
SECRET=""
if [ -f "$CONF" ]; then
  SECRET=$(grep '^GH_CLIENT_SECRET=' "$CONF" | cut -d= -f2- | tr -d '"' | tr -d " \n\r")
fi
if [ -z "$SECRET" ]; then
  echo "[build-sidecar] WARNING: no GH_CLIENT_SECRET in ~/.quinki/oauth.conf → building WITHOUT GitHub secret (login GitHub will fail in the binary; runtime file fallback still applies on machines that have the file)"
fi

# Compile single binary (bun) with secret injected
cd sidecar-src
if [ -n "$SECRET" ]; then
  bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts \
    --outfile quinki-sidecar-ws \
    --define "process.env.QUINKI_GH_SECRET:\"$SECRET\""
else
  echo "[build-sidecar] no oauth.conf found → building without secret (runtime file fallback only)"
  bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts --outfile quinki-sidecar-ws
fi
# Sign the sidecar binary with a stable identifier (bun default is "a.out").
# Without this, TCC cannot attribute the sidecar process to the app bundle
# and macOS re-prompts for permissions (Screen Recording etc.) after every update.
codesign --force --sign - --identifier "com.quinki.sidecar" quinki-sidecar-ws
cp quinki-sidecar-ws ../src-tauri/resources/sidecar/
# Photon WASM: la compressione immagini (resize JPEG/PNG) lo cerca ACCANTO AL
# BINARIO (photon.js: path.dirname(process.execPath)). Senza, resizeImage ritorna
# null e le immagini sarebbero SCARTATE invece che compresse.
if [ -f node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm ]; then
  cp node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm ../src-tauri/resources/sidecar/
  echo "[build-sidecar] photon wasm copied next to the binary"
fi

echo "[build-sidecar] binary compiled and copied to src-tauri/resources/sidecar/"
# sanity: the binary must NOT contain the raw secret in plaintext when built from a clean machine,
# but on the owner machine it is injected on purpose (desktop binary, unscannable by GitHub).
echo "[build-sidecar] done."