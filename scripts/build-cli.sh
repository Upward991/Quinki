#!/usr/bin/env bash
# =============================================================================
# Build the Quinki CLI — single compiled bun binary (like the sidecar).
# Output: cli/dist/quinki  (darwin-arm64 for now; more targets at E4)
#
# The CLI reuses the vendored Pi SDK (sidecar-src/vendor) and its node_modules.
# The compiled binary resolves theme/assets/package.json from ITS OWN directory
# (getPackageDir() == dirname(execPath) for bun binaries), so we place:
#   cli/dist/theme/        (dark.json/light.json — TUI themes)
#   cli/dist/assets/       (interactive assets)
#   cli/dist/package.json  (branding: name "quinki", version = app version,
#                           piConfig name "quinki" + configDir ".quinki")
# This keeps the rename CLI-scoped: the sidecar (same vendored SDK) is untouched.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.." # project root

BUN="$HOME/.bun/bin/bun"
if [ ! -x "$BUN" ]; then
  echo "[build-cli] bun not found at $BUN"
  exit 1
fi

VENDOR="sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/modes/interactive"

mkdir -p cli/dist/theme cli/dist/assets

"$BUN" build --compile --target=bun-darwin-arm64 cli/main.ts --outfile cli/dist/quinki

# Theme + assets next to the binary (resolved from the executable directory)
cp "$VENDOR"/theme/*.json cli/dist/theme/
cp "$VENDOR"/assets/* cli/dist/assets/ 2>/dev/null || true

# Version: always aligned with the app (src-tauri/tauri.conf.json)
VERSION=$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")

cat > cli/dist/package.json <<EOF
{
  "name": "quinki",
  "version": "$VERSION",
  "piConfig": { "name": "quinki", "configDir": ".quinki" }
}
EOF

# Stable code signature identifier (same reasoning as the sidecar).
codesign --force --sign - --identifier "com.quinki.cli" cli/dist/quinki 2>/dev/null || true

echo "[build-cli] built cli/dist/quinki (version $VERSION)"
ls -lh cli/dist/quinki
