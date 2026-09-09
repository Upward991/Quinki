# B4 POC — Risultati (21 ago 2026)

## Obiettivo
Provare che il process pool funziona: un sidecar-processo può caricare SOLO un sottoinsieme di sessioni, rispondendo alle RPC.

## Test eseguiti
1. **Hash distribuzione** (`/tmp/poc-b4-hash.ts`): djb2 su sessionKey % N → N=2: 21/24, N=4: 8-13 — bilanciato, deterministico.
2. **Boot secondo sidecar** (porta 9192, dir usa-e-getta con 2 sessioni REALI): `listSessions` → **2 sessioni (esattamente il subset)**, `getHistory` → 5 messaggi reali.

## Scoperte
- `QUINKI_ROLE` è OBBLIGATORIO: senza, `sidecarRole()` ricade in ricorsione infinita → `#load` fallisce silenziosamente → 0 sessioni. (Il main e l'Expert lo settano sempre — bug latente, da fissare: fallback a "main".)
- Il filtro per-sottogruppo funziona: è lo stesso meccanismo del filtro Expert (`expertOnlyScan`), generalizzabile con `QUINKI_POOL_SIZE/INDEX`.

## Comandi POC
```bash
# boot child con subset
QUINKI_ROLE=main QUINKI_AGENT_DIR=/tmp/quinki-poc2 QUINKI_WS_PORT=9192 ./quinki-sidecar-ws
# probe
bun /tmp/poc-probe.ts   # listSessions
bun /tmp/poc-probe3.ts  # getHistory
```

## Step 2 completato (filtro pool nel codice) — TESTATO ✅
- `QUINKI_POOL_SIZE/INDEX` + `hashSessionKey` (djb2) + `isMyPoolSession` in pi-bridge.ts.
- `__exec_*` → sempre pool 0 (scheduler nel main).
- Fix ricorsione `sidecarRole()` (fallback "main").
- Main (pool 0) = router UI: mostra TUTTE le sessioni dal file; child = solo il suo gruppo.
- Test 2 processi (9192/9193) su dir con 2 sessioni reali:
  - pool 0 → 2 sessioni (UI completa) ✅
  - pool 1 → 1 sessione (solo gruppo hash) ✅

## Step 3-4 completato (PoolManager + Router) — TESTATI ✅
- `pool-router.ts`: il main (pool-0) spawna N-1 child (stesso binario, porta 9184+i), si connette via WS, instrada le RPC per-sessione (ROUTABLE set) al child proprietario, forward eventi/risposte via stdout, ensureSession idempotente, respawn su crash.
- Child: scheduler/LH/executor OFF, lock dedicato `.sidecar-main-pool-<i>.pid`, watchdog parent (muore col main).
- Test:
  - 4 processi (main + 3 child): distribuzione 26/25/24/25 ✅
  - 100 RPC concorrenti via router: 0 errori, 10ms ✅
  - 200 RPC concorrenti: 0 errori, 273ms ✅
  - kill child → respawn ✅; kill main → i child escono da soli ✅
  - main (router) vede TUTTE le sessioni (UI completa) ✅
- Nota: RPC per sessioni inesistenti → ensureSession crea entry (comportamento idempotente del design, non bug).

## Step 6 (opzione C) completato — TESTATI ✅
- Settings `parallelWorkers` (0=Auto cores / 1=off / 2-16) — il sidecar lo legge al boot (file).
- Campo UI "Parallel workers" in Settings → Global defaults (setSettings RPC).
- SPAWN LAZY: nessun child al boot; nasce alla prima RPC di una sessione del suo gruppo (12s incl. boot, RPC in coda).
- SHRINK: status ogni 60s (override per test) → child idle da 5min (zero streaming/attive) → SIGTERM/SIGKILL. VERIFICATO: il child muore e NON rispawna (childRetired).
- RISPAWN A RICHIESTA dopo lo shrink ✅.
- FIX watchdog child: confronto ppid originale (il vecchio kill(ppid,0) falliva quando il child veniva ri-parentato a launchd → orfani infiniti). VERIFICATO: kill main → child escono, zero orfani.
- FIX flushQueue: tryRoute (era tryRouteInternal).

## FASE FINALE — ENDURO REALE 100 sessioni (21 ago 2026) ✅ PASSATO
Dopo 3 iterazioni di fix (forwarding eventi → connessione DIRETTA frontend→worker):
- **100/100 sendMessage: 0 errori** (prima iterazione: 33-93 errori da spawn)
- **100/100 sessioni completate in 35s** (prima: saturazione → timeout)
- **Probe RPC durante il burst: mediana 1ms, 0 timeout** (prima: 2-3s / wedge)
- **Main footprint: 182MB stabile** (prima: 830MB→2GB→5.7GB RSS + wedge)
- Child: ~300-400MB l'uno (contesti sessioni — previsto)

## Architettura finale (il fix che ha risolto tutto)
- Il router NON inoltra gli eventi streaming (era il collo di bottiglia + la crescita heap)
- Le sessioni espongono `workerPort` (9184+owner) in listSessions
- Il FRONTEND si connette DIRETTAMENTE alla porta del worker per gli eventi
  (con retry: il worker nasce lazy alla prima RPC)
- Il router gestisce SOLO le RPC (volumetto basso) → resta a ~180MB
- Bun.gc(true) periodico RIMOSSO (causava wedge su heap cresciuto)

## Lezioni
- Il full GC sincrono (Bun.gc(true)) su heap grande blocca l'event loop per minuti → MAI periodico
- Il forwarding di eventi streaming attraverso un processo single-thread è il collo di bottiglia:
  l'unica soluzione è NON farli passare (connessione diretta)
- I child stale (vecchio binario, watchdog non funzionante) occupano le porte → vanno uccisi
  prima di reinstallare
