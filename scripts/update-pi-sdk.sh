#!/bin/bash
# ============================================================================
# update-pi-sdk.sh — Aggiorna l'SDK vendorizzato (pi-*) in modo RIPETIBILE e SICURO.
#
# Uso:  bash scripts/update-pi-sdk.sh 1.3.0
#
# Cosa fa:
#   1. pretende un albero git PULITO (cosi' il rollback e' banale: git checkout)
#   2. scarica i 7 pacchetti @earendil-works/* della versione richiesta (npm pack)
#   3. li estrae nel vendor (escluse *.map e dist/bundle/ — solo cio' che il bundle usa)
#   4. applica i patch di patches/<versione>/ — SE UNO NON ENTRA: STOP immediato,
#      niente stato a meta', e stampa il comando di rollback
#   5. verifica che il sidecar COMPILI (bun build) e stampa i moduli/megabyte del bundle
#   6. elenca eventuali dipendenze nuove da installare (es. quickjs-wasi in 1.3.0)
#
# Cosa NON fa (di proposito): non committa, non installa l'app, non esegue la batteria.
# La batteria (chat, task, LH, immagini, CLI) e il test dell'utente restano SEMPRE manuali.
#
# Rollback:  git checkout -- sidecar-src/vendor && bash scripts/build-sidecar.sh
# ============================================================================
set -euo pipefail

VER="${1:?Uso: bash scripts/update-pi-sdk.sh <versione>  (es. 1.3.0)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VENDOR="$ROOT/sidecar-src/vendor/@earendil-works"
PATCHES="$ROOT/sidecar-src/vendor/patches/$VER"
WORK="$ROOT/dist/.pi-sdk-$VER"          # dentro dist/ (gitignored, mai /tmp)
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"

echo "[update-pi-sdk] versione richiesta: $VER"

# ── 1. albero pulito
if [ -n "$(git status --porcelain -- sidecar-src src-tauri cli | head -n1)" ]; then
  echo "[update-pi-sdk] ERRORE: ci sono modifiche non committate (sidecar-src/ ecc.)."
  echo "               Committa o fai rollback prima: il rollback di questo script e' 'git checkout'."
  exit 1
fi
echo "[update-pi-sdk] git pulito ✓ (rollback garantito: git checkout -- sidecar-src/vendor)"

# ── 2. download
rm -rf "$WORK"; mkdir -p "$WORK"
PKGS=(pi-coding-agent pi-agent-core pi-ai pi-tui pi-telemetry pi-mcp pi-codemode)
for p in "${PKGS[@]}"; do
  ( cd "$WORK" && npm pack "@earendil-works/$p@$VER" --silent >/dev/null 2>&1 ) \
    || { echo "[update-pi-sdk] ERRORE: npm pack fallito per $p@$VER"; exit 1; }
  echo "[update-pi-sdk]   ✓ scaricato $p"
done

# ── 3. estrazione nel vendor (prune)
for p in "${PKGS[@]}"; do
  rm -rf "$VENDOR/$p"
  mkdir -p "$VENDOR/$p"
  tar xzf "$WORK/earendil-works-$p-$VER.tgz" -C "$VENDOR/$p" --strip-components=1
done
find "$VENDOR" -name "*.map" -delete 2>/dev/null || true
rm -rf "$VENDOR"/*/dist/bundle 2>/dev/null || true
echo "[update-pi-sdk] vendor aggiornato a $VER (esclusi *.map e dist/bundle/)"

# ── 4. patch (se presenti per questa versione)
if [ -d "$PATCHES" ]; then
  ok=0
  for f in "$PATCHES"/*.patch; do
    [ -s "$f" ] || continue
    n="$(basename "$f")"
    case "$n" in
      0[1-6]*) tgt="$VENDOR/pi-coding-agent" ;;
      *)       tgt="$VENDOR/pi-tui" ;;
    esac
    if patch -p1 -d "$tgt" --forward -s < "$f" 2>/dev/null; then
      ok=$((ok+1))
    else
      echo "[update-pi-sdk] ✗ PATCH NON APPLICATO: $n"
      echo "               L'upstream ha cambiato quel file: va riadattato A MANO (vedi patches/README.md)."
      echo "               ROLLBACK:  git checkout -- sidecar-src/vendor && bash scripts/build-sidecar.sh"
      exit 1
    fi
  done
  echo "[update-pi-sdk] patch applicati: $ok (tutti puliti ✓)"
else
  echo "[update-pi-sdk] ⚠ nessun set di patch per $VER in sidecar-src/vendor/patches/$VER/"
  echo "               Va rigenerato (diff della versione pristina vs il nostro vendor) PRIMA di procedere."
fi

# ── 5. compile check + misura
bun build sidecar-src/sidecar-ws.ts --target=bun --outfile="$WORK/check.js" 2>&1 | tail -2
echo "[update-pi-sdk] compile check: OK (sopra: moduli + MB del bundle)"
echo "               baseline 0.84.4: 1864 moduli / 13.74 MB · 1.3.0: 1944 moduli / 14.73 MB"

# ── 6. dipendenze nuove?
echo "[update-pi-sdk] dipendenze dichiarate dai pacchetti ($VER) vs node_modules:"
for p in "${PKGS[@]}"; do
  deps=$(python3 - "$VENDOR/$p/package.json" <<'PY' 2>/dev/null || true
import json,sys
try:
    d=json.load(open(sys.argv[1])).get("dependencies",{})
    print(" ".join(d.keys()))
except Exception: pass
PY
)
  for dep in $deps; do
    case "$dep" in @earendil-works/*) continue;; esac
    [ -d "$ROOT/sidecar-src/node_modules/$dep" ] || echo "   → MANCA: $dep   (aggiungilo a sidecar-src/package.json + bun install)"
  done
done
echo "[update-pi-sdk] fatto. PROSSIMI PASSI (manuali):"
echo "  1. aggiorna sidecar-src/vendor/PI-SDK-VERSION.txt"
echo "  2. bash scripts/build-sidecar.sh && bash scripts/build-cli.sh"
echo "  3. batteria: chat (modello), task, Long Horizon, immagini, CLI (boot)"
echo "  4. bash scripts/build-app.sh && bash scripts/install-main.sh → test dell'utente"
