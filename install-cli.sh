#!/bin/sh
# Quinki CLI installer — standalone, no app required.
#   curl -fsSL https://raw.githubusercontent.com/Upward991/Quinki/main/install-cli.sh | sh
set -e

REPO="Upward991/Quinki"
OS="$(uname -s)"; ARCH="$(uname -m)"
case "$OS" in
  Darwin) [ "$ARCH" = "arm64" ] && PATTERN="macos-arm64" || PATTERN="macos-x64" ;;
  Linux)  [ "$ARCH" = "aarch64" ] && PATTERN="linux-arm64" || PATTERN="linux-x64" ;;
  *) echo "Unsupported system: $OS. Windows: use the .exe from the releases page."; exit 1 ;;
esac

echo "Fetching the latest Quinki CLI ($PATTERN)..."
JSON=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases?per_page=5")
URL=$(echo "$JSON" | grep -o '"browser_download_url": *"[^"]*Quinki_CLI_[^"]*'"$PATTERN"'"' | head -1 | cut -d'"' -f4)
if [ -z "$URL" ]; then echo "No CLI build found for $PATTERN (yet). See https://github.com/${REPO}/releases"; exit 1; fi
NAME=$(basename "$URL")
echo "Downloading $NAME ..."

TMP="$(mktemp)"
curl -fL -o "$TMP" "$URL"
chmod +x "$TMP"

if [ -w /usr/local/bin ] 2>/dev/null; then
  DEST=/usr/local/bin
else
  DEST="$HOME/.local/bin"; mkdir -p "$DEST"
fi
mv "$TMP" "$DEST/quinki"
echo "Installed: $DEST/quinki"

# PATH: add ~/.local/bin once (marker) if it is not already there
case ":$PATH:" in
  *":$DEST:"*) ;;
  *)
    RC="$HOME/.zshrc"; [ -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ] && RC="$HOME/.bashrc"
    if [ -f "$RC" ] && ! grep -q '# quinki-cli' "$RC"; then
      printf '\n# quinki-cli\nexport PATH="%s:$PATH"\n' "$DEST" >> "$RC"
      echo "Added $DEST to PATH in $RC (open a new terminal, or run: export PATH=\"$DEST:\$PATH\")"
    else
      echo "Add to PATH manually: export PATH=\"$DEST:\$PATH\""
    fi ;;
esac
echo ""
echo "Done. Start it with:  quinki"
echo "Sessions, agents and skills are shared with the Quinki app (~/.quinki)."
