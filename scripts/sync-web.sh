#!/bin/bash
# sync-web.sh — Sincronizza la WEB APP (quella che gira nel browser/telefono via tunnel)
# con il codice React attuale. DA LANCIARE DOPO OGNI MODIFICA GRAFICA.
#
# Perché esiste: la web app è una COPIA COMPILATA (vite) dei sorgenti React. Se non
# la ricompili e non la ricopi, il telefono/browser continua a mostrare la versione
# vecchia (è successo il 6 ott: lo Steer sparito dall'app ma ancora visibile sul web).
#
# Cosa fa (10 secondi):
#   1. ricompila dist-web dai sorgenti
#   2. aggiorna l'hash di versione (index.html)
#   3. copia TUTTO nelle due app installate (Main + Expert) e nel repo
#   4. i telefoni si RICARICANO DA SOLI alla prossima apertura (cambia l'hash)
#
# NOTA RELEASE PUBBLICA: il DMG pubblico si costruisce con build-public-dmg.sh che
# passa da build-app.sh — anche LUI include la web (stesso passo). Quindi:
#   - modifiche grafiche durante lo sviluppo → bash scripts/sync-web.sh
#   - release pubblica → build-public-dmg.sh (fa tutto il necessario da solo)
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="/opt/homebrew/bin:$HOME/.bun/bin:$PATH"

echo "[sync-web] 1/4 — compilo la web app dai sorgenti..."
rm -rf dist-web node_modules/.vite
npx vite build -c vite.config.web.ts 2>&1 | tail -2

echo "[sync-web] 2/4 — hash di versione..."
if [ -f public/quinki-logo-small.png ]; then
  cp public/quinki-logo-small.png dist-web/quinki-logo.png
fi
WV=$(shasum -a 256 dist-web/index.html | awk '{print substr($1,1,12)}')
echo "$WV" > dist-web/version.txt

echo "[sync-web] 3/4 — copio nel repo (per le prossime build dell'app)..."
rm -rf src-tauri/resources/sidecar/web && mkdir -p src-tauri/resources/sidecar/web
cp -R dist-web/. src-tauri/resources/sidecar/web/
echo "$WV" > src-tauri/resources/sidecar/version.txt

echo "[sync-web] 4/4 — copio nelle app INSTALLATE (Main + Expert)..."
for APP in "/Applications/Quinki.app" "/Applications/Quinki Expert.app"; do
  if [ -d "$APP" ]; then
    DEST="$APP/Contents/Resources/resources/sidecar/web"
    if [ -d "$DEST" ]; then
      cp -R dist-web/. "$DEST/"
      echo "$WV" > "$DEST/version.txt"
      echo "$WV" > "$APP/Contents/Resources/resources/sidecar/version.txt"
      echo "  ✓ $APP"
    else
      # La cartella web manca (era assente al boot del sidecar): il sidecar NON
      # serve la web finché non riparte. La creiamo e lo segnaliamo.
      mkdir -p "$DEST"
      cp -R dist-web/. "$DEST/"
      echo "$WV" > "$DEST/version.txt"
      echo "$WV" > "$APP/Contents/Resources/resources/sidecar/version.txt"
      echo "  ✓ $APP (creata da zero: RIAVVIA l'app per attivare il servizio web)"
    fi
  else
    echo "  – $APP non installata (salto)"
  fi
done

echo ""
echo "[sync-web] FATTO — versione web: $WV"
echo "[sync-web] I telefoni si ricaricano da soli alla prossima apertura (l'hash è cambiato)."
echo "[sync-web] Se l'app appena copiata non serviva la web, riaprila una volta."
