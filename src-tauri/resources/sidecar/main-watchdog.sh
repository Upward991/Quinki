#!/bin/bash
# FIX F10 (02 set): watchdog per il SIDECAR MAIN (porta 9182) — modello dell'expert-watchdog.
# Prima: un crash/kill del sidecar main lasciava l'app morta sullo splash "Could not start!"
# per sempre (nessun respawn, verificato in VM: 0 restart in 180s). L'Expert ce l'aveva già.
# Esce quando l'app main NON è più in esecuzione (quit vero: nessuno sidecar zombie senza app).
LOG="$HOME/.quinki-sidecar.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "$(date): main-watchdog started from $SCRIPT_DIR" >> "$LOG"

while true; do
  # App main chiusa davvero (processo assente) → esci + PULIZIA TOTALE.
  # Il pattern DEVE includere "/quinki": col vecchio "Quinki.app/Contents/MacOS"
  # il tunnel (path Quinki.app/Contents/MacOS/../Resources/...) matchava e il
  # watchdog credeva l'app viva PER SEMPRE: restava in background e rispawnava
  # il sidecar. In uscita porta giu' anche il sidecar: mai orfani, per nessuna
  # via di morte (SIGTERM, kill -9, crash; il quit normale ha gia' kill_backend).
  if ! pgrep -f "Quinki.app/Contents/MacOS/quinki" > /dev/null 2>&1; then
    echo "$(date): Main app not running, main-watchdog exits and cleans up" >> "$LOG"
    pkill -9 -f 'Quinki.app/Contents/Resources/resources/sidecar/quinki-sidecar-w[s]' 2>/dev/null
    lsof -ti:9182 2>/dev/null | xargs kill -9 2>/dev/null
    # ULTIMA app in uscita (vale anche per morte brutale): spegni anche il TUNNEL.
    # Nessuna app aperta = nessun ponte = zero processi in background. Alla
    # riapertura di una qualsiasi delle due app il watchdog lo riavvia da solo.
    sleep 2
    if ! pgrep -f "App Expert.app/Contents/MacOS/quinki" > /dev/null 2>&1; then
      pkill -TERM -f 'tsnet-tunnel' 2>/dev/null
      rm -f "$HOME/.quinki/tunnel.pid"
      echo "$(date): no app running, tunnel stopped" >> "$LOG"
    fi
    exit 0
  fi
  if ! lsof -ti:9182 > /dev/null 2>&1; then
    echo "$(date): port 9182 not in use, starting main sidecar..." >> "$LOG"
    nohup bash "$SCRIPT_DIR/start.sh" >> "$LOG" 2>&1 &
    sleep 2
    if lsof -ti:9182 > /dev/null 2>&1; then
      echo "$(date): main sidecar started successfully (watchdog)" >> "$LOG"
    fi
  fi
  sleep 2
done