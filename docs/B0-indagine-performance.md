# B0 — INDAGINE PERFORMANCE/RAM (19 ago 2026, sera)

> Indagine completa (interna + online) PRIMA di decidere i fix. Nessuna modifica al codice fatta in questa fase.
> Fonti online: SearXNG, GitHub (oven-sh/bun, earendil-works/pi), docs Bun, blog Bun.

---

## 0. METODO

1. **Baseline processi** (ps): main sidecar 640 MB, Expert sidecar 2.1 GB, UI main 100 MB, UI Expert 111 MB.
2. **Probe WS live** (bun → ws://127.0.0.1:9182/9183): sessioni, contextUsage (231 sessioni tracciate), streaming, log.
3. **Test harness** (`/tmp/measure-session.ts`): import pi-bridge, SessionManager.open su una copia di ~/.quinki, con `heapStats()` (bun:jsc) + `Bun.gc(true)`.
4. **Probe getHistory live**: misura RSS del sidecar prima/dopo una getHistory su sessione da 441k token.
5. **Ricerca online**: Bun runtime docs, bun blog "Debugging JavaScript Memory Leaks", GitHub issues oven-sh/bun + earendil-works/pi.

---

## 1. NUMERI CHIAVE (misurati)

### 1a. Test harness — costo di UNA sessione Pi (93 MB jsonl, 43.218 entries, v0.78.0)

| Step | heap (JSC) | RSS | note |
|---|---|---|---|
| baseline (SDK importato) | 8 MB | 160 MB | runtime bun + SDK |
| **SessionManager.open** | **726 MB** | 1040 MB | +718 MB picco (parsing 93 MB jsonl) |
| buildSessionContext | 726 MB | 1042 MB | +0 (messages=164, compaction ok) |
| **dopo Bun.gc(true)** | **193 MB** | 1043 MB | **~185 MB RITENUTI per sessione** |
| dopo 10s idle | 193 MB | 1043 MB | stabile |

**Interpretazione:**
- Aprire una sessione Pi = +185 MB RITENUTI in RAM (fileEntries + byId Map + messages dell'SDK).
- Il picco transitorio durante l'apertura è ~8× la dimensione del file (93 MB → 726 MB heap).
- **RSS NON scende mai** anche dopo GC: high-water mark (JSC "moats" + mimalloc non restituiscono pagine all'OS).

### 1b. Probe live (main sidecar, porta 9182)
- `getHistory('__app_expert__')` (sessione 441k token): **612 ms, RSS 641 → 1107 MB (+466 MB)**. Il payload di risposta era solo 1.09 MB → la spesa è tutta nella costruzione del contesto.
- Il RSS NON è tornato a 641 MB nemmeno dopo 60 s.
- Streaming attivo: main 0 sessioni, Expert 1 (`__app_expert__`).

### 1c. Baseline dati
- `__app_expert__` jsonl: **93.2 MB** su disco (di gran lunga il più grande; il resto 0.1–1.7 MB).
- `~/.quinki/sessions`: 113 MB totali.
- `quinki-debug.log`: 10 MB (era 50 MB; già capito in RAM a 200 entry).
- `dashboard-context-usage.json`: 231 sessioni tracciate, **3.67 M token totali in contesto** (main), top sessione 441k token (42% del window 1M).

---

## 2. CASISTICHE / PROBLEMI / SCENARI

### C1 — SESSIONI PI RITENUTE IN RAM (il problema più grande)
- **Cosa**: ogni sessione attivata (inviare un messaggio o anche solo `getHistory` fallback) carica TUTTO il jsonl in `SessionManager.fileEntries[]` + `byId` Map; l'SDK non li rilascia mai finché la sessione vive. `#ensureActive` mette la sessione in `#active` e nessuna policy la disattiva.
- **Evidenza**: harness (+185 MB/sessione); codice `#ensureActive` (pi-bridge.ts riga 2408); `SessionManager.open` → `loadEntriesFromFile` (legge tutto il file, JSON.parse per riga).
- **Evidenza online**: GitHub earendil-works/pi **#6841** "Long-running sessions: unbounded memory growth — all session entries kept in RAM for process lifetime" (auto-chiusa dal bot, MAI fixata dagli autori); la versione 0.84.2 (ultima, noi siamo su 0.78.0) ha ancora `fileEntries`/`byId`.
- **Scenario**: con N chat usate oggi → N×185 MB ritenuti. Il main oggi ha 0 sessioni attive ma 1.1 GB RSS (picchi accumulati).

### C2 — SPIKE TRANSIENTI ENORMI a ogni getHistory / apertura chat
- **Cosa**: `getHistory` costruisce il CONTESTO COMPLETO (tutte le entry, `buildSessionContext` + `#mapMessage` su tutto) per poi fare `slice(-200)`. Per una sessione da 93 MB → 700+ MB allocati a ogni apertura/refresh.
- **Evidenza**: probe live +466 MB per una getHistory; il fallback di getHistory apre un NUOVO SessionManager dal disco a ogni chiamata su sessione non attiva.
- **Scenario**: cambio chat, refresh, mark-read, riapertura app → spike ripetuti → RSS high-water cresce a ogni picco.

### C3 — RSS HIGH-WATER MARK (la memoria non torna mai all'OS)
- **Cosa**: anche dopo GC completo, RSS resta al picco massimo. Bun/JSC tiene le pagine (moats, minimalloc).
- **Evidenza**: harness (heap 726→193 MB ma RSS 1043 MB fisso); online: bun blog (JSC "moats"), oven-sh/bun **#12941** (memoria non rilasciata dopo Bun.gc(true)), **#27046** (RSS cresce senza motivo in produzione).
- **Scenario**: il sidecar long-running (Expert 2.1 GB dopo giorni) = somma di tutti i picchi mai raggiunti.

### C4 — LEAK VERO: remove()/delete NON fanno unsubscribe né dispose
- **Cosa**: `remove(key)` fa `#active.delete` + `#unsubs.delete` SENZA chiamare la funzione di unsubscribe; la Pi session resta agganciata all'emitter dell'SDK (subscribe in pi-bridge.ts:5830 → callback in `#unsubs`) → non può MAI essere GC → leak per OGNI chat cancellata.
- Inoltre `deleteSessionsByKeysIPC` (usato dalle delete multiple) tocca SOLO il file, non `#active`.
- **Evidenza**: `remove()` pi-bridge.ts:1295-1297; `deleteSessionsByKeysIPC` pi-bridge.ts:6808.
- **Evidenza online**: bun blog — EventEmitter senza removeListener → retained forever; closure scope retention.
- **Scenario**: ogni chat cancellata (o task `__exec_*` completato rimosso via `remove`) lascia la sessione + history in RAM per la vita del processo.

### C5 — LA COMPACTION NON AIUTA LA RAM
- **Cosa**: l'auto-compaction dell'SDK riassume il contesto per l'LLM ma le entry originali restano in RAM ("Entries cannot be modified or deleted").
- **Evidenza**: issue #6841; comportamento verificato nel harness (compaction attiva ma entry totali 43.218).
- **Scenario**: sessioni vecchie giganti (93 MB) restano pesanti in RAM anche dopo compaction.

### C6 — UI: OK, MARGINI (rischio basso)
- **Cosa**: la UI tiene solo i 200 messaggi della sessione attiva; RSS app 100–134 MB. Niente da fare subito.
- **Evidenza**: `useSidecarData.ts` `messages` = getHistory (max 200); UI RSS misurato.
- **Scenario futuro**: con 100 chat il DOM è contenuto (200 msg max per view); il problema resta il sidecar, non la UI.

### C7 — LOG: GIÀ GESTITO (non è un problema)
- **Cosa**: `#debugMax=200` entry in RAM + flush async 5s su file. Log file 10 MB.
- **Evidenza**: `logDebug` pi-bridge.ts:2712 (cap + buffer).

### C8 — WS PAYLOAD: BASSI (non è un problema)
- **Cosa**: streaming per delta (token piccoli), eventi status piccoli, getHistory max 1.1 MB.
- **Evidenza**: `stream_event` con `delta`; payload misurato.

### C9 — EXPERT 2.1 GB: combinazione C1+C2+C3+C4
- **Scenario**: giorni di lavoro (task, timeline, sessioni aperte/chiuse) → somma di retention + spike + RSS high-water + leak remove() → 2.1 GB.

### C10 — SESSIONI HEADLESS DEI TASK (`__exec_*`)
- **Cosa**: executor crea sessioni `__exec_*` per i task; al termine fa `abort` + `remove` (che non dispose/unsub → C4). Con task frequenti = micro-leak a ogni task.
- **Evidenza**: executor.ts:660-661; 231 sessioni in context-usage (molte `__exec_*`).

### C11 — CICLO DI VITA DEL SIDECAR ALLA CHIUSURA (scoperto con la domanda dell'utente) — ✅ RISOLTA (20 ago)
**Fix installato**: Cmd+Q → modale di conferma (solo Quit App + spiegazione recovery), tray → conferma nativa macOS, menu custom (Cmd+Q libero, Cmd+W ripristinato), `kill_backend()` SINCRONO in TUTTI i percorsi (modale/tray/menu/ExitRequested) — uccide sidecar per porta+percorso, watchdog PRIMA per l'Expert, watchdog consapevole (esce se l'app non è viva). Verificato: dopo quit di main ed Expert → ZERO processi residui (ps pulito).
- **Cosa succede davvero quando chiudi la app**:
  - **X rosso / Cmd+W** → close-to-tray: la finestra si NASCONDE, l'app resta in tray, il sidecar CONTINUA a girare (by design, per i task programmati).
  - **Quit dal tray (Main)** → `SHOULD_EXIT=true` → ExitRequested → `kill -9` sul sidecar 9182 → l'app esce. Niente shutdown pulito.
  - **Quit dal tray (Expert)** → `quit_expert_app`: kill -9 sidecar 9183 + `pkill start-expert.sh` + `pkill expert-watchdog`. MA c'è una RACE: il watchdog controlla la porta ogni 1s; se tra il kill del sidecar e il pkill del watchdog il watchdog ha GIÀ riacceso un nuovo sidecar, quello diventa zombie.
  - **Cmd+Q (macOS)** → `ExitRequested` con `SHOULD_EXIT=false` → `api.prevent_exit()` → **la app NON esce** (bug noto, fix revertito). L'unico modo per uscire è il tray.
- **EVIDENZA GRAVE**: `expert-watchdog.sh` gira con `nohup` (sopravvive alla chiusura della app) in loop infinito: se la porta 9183 è libera, RIACCENDE il sidecar. Log: **6339 riavvii** del sidecar Expert registrati. Il watchdog è stato osservato attivo anche con l'app Expert "chiusa" (ps). → **quando "chiudi" l'Expert, il sidecar 2.1GB può continuare a girare come zombie**.
- **Cosa si salva alla chiusura**: messaggi scritti in tempo reale nel .jsonl (sicuri); session entries salvate su create/rename/etc. (sicure); read-state/notifications su modifica (sic); il turno in corso → marker pending-turn → recovery al boot (by design). SI PERDONO: ultimi ≤200 log in buffer (non flushati), eventuali dati non salvati esplicitamente. Con `kill -9` NON c'è flush: il sidecar non ha handler SIGTERM/SIGINT.

---

## 3. SOLUZIONI (per scenario, con fonte online+interna)

### S1 — CICLO DI VITA SESSIONI: LRU + dispose on-close (risolve C1/C9/C10)
- **Policy**: la sessione Pi resta attiva SOLO mentre è visibile/streaming; dopo X min di inattività (o cambio chat, o oltre N=5 attive) → `dispose()` + unsubscribe (S4). Al prossimo uso si ricarica da disco (picco mitigato da S2).
- **Vincoli**: MAI dispose durante turno attivo/streaming (guardie `#streamingBuffers` già esistono); i task in esecuzione (`__exec_*`) vanno preservati finché attivi e disposti SUBITO dopo agent_end.
- **Fonti**: Bible §14 (chat vecchia = metadata+disco); pi #6841 (suggerisce spill to disk); già esiste `lastActivity`/`order` in SessionEntry → LRU naturale.

### S2 — getHistory BOUNDED (tail del jsonl) (per C2)
- **Cosa**: per la UI NON serve `buildSessionContext` completo: leggere la **coda del file** (ultime ~250 righe, con Buffer/read da fondo) e mappare SOLO quelle → niente SessionManager.open, niente picco da 466 MB.
- **Vincoli**: `messageSkills`/`messageTaskClips`/`messageAttachments` sono per-messaggio (servono per i msg del tail — OK); il merge cronologico per delegations/tool_call avviene lato UI; la sessione per l'INVIO continua a usare l'SDK (full context) — solo la HISTORY VIEW diventa leggera.
- **Fonti**: Bible §5/§16 (slice/query/pagination, no parse totale); misura (466 MB eliminata).

### S3 — RIDURRE I JSONL ENORMI: "vacuum" periodico delle sessioni inattive (per C1/C2/C5)
- **Cosa**: riscrivere il file delle sessioni inattive da molto tempo tenendo solo le entry recenti + summary di compaction (drop di tool results/thinking vecchi). File 93 MB → 5-10 MB → 12× meno picco e retention.
- **Vincolo**: il session-manager è append-only → il vacuum va fatto SOLO su sessioni dispose e lontane; NON toccare la sessione attiva; backup prima. Riserve di integrità da testare (load + send dopo vacuum).
- **Fonti**: problema alla radice (entries immutabili); suggestion #6841 (spill to disk / truncate in RAM).

### S4 — FIX LEAK remove(): unsubscribe + dispose OBBLIGATORI (per C4)
- **Cosa**: in `remove(key)` e in `deleteSessionsByKeysIPC`/`deleteSessionsByFolderIdIPC`: chiamare `(unsub)?.()` poi `(pi as any).dispose?.()` PRIMA di `#active.delete`. Nessun session "zombie" agganciata all'emitter.
- **Fonti**: bun blog (listener retention), codice nostro.

### S5 — QUICK WIN BUN: `--smol` / `BUN_OPTIONS` (per C3)
- **Cosa**: `BUN_OPTIONS=--smol` (variabile d'ambiente per standalone executables — docs bun) o ricompilare con `--compile-exec-argv="--smol"`. Effetto: GC più frequente → heap cresce più lento, picchi minori (costo: CPU leggermente +).
- **Evidenza**: docs bun runtime (`--smol` = "Use less memory, but run GC more often"), docs executables (BUN_OPTIONS per binari compilati).
- **Da misurare**: curva RSS a parità di carico con/ senza --smol.

### S8 — SHUTDOWN PULITO + WATCHDOG CONSAPEVOLE (per C11)
- **Cosa**: (1) il sidecar gestisce SIGTERM: flush del buffer log, salva stati pendenti, poi exit (niente kill -9). (2) `quit_expert_app` deve killare il sidecar e il watchdog ATOMICAMENTE senza race (kill watchdog PRIMA, poi sidecar, poi verificare). (3) il watchdog deve controllare ANCHE che l'app Expert sia viva (es. `pgrep -f 'App Expert.app/Contents/MacOS'`), non solo la porta → niente zombie quando l'app è chiusa davvero.
- **Vincoli**: i task programmati (A2.2 scheduler) girano nel sidecar → la domanda è di PRODUCT: vuoi che il sidecar Expert resti su anche a app chiusa (scheduler H24) o si spegne con la app?
- **Fonti**: codice lib.rs (quit_expert_app, ExitRequested, watchdog loop).

### S9 — MONITORING: heapStats() nel debug log (per validare tutti i fix)
- **Cosa**: RPC `getHeapStats` + log periodico (`heapStats()` di `bun:jsc`: heapSize/heapCapacity/extraMemory/objectCount) a ogni agent_end e ogni 60 s idle. Serve per distinguere spike/leak e validare ogni fix con curve (Bible §25).
- **Evidenza**: bun blog — heapStats() di bun:jsc.

### S6 — EVITARE getHistory RIPETUTI (per C2)
- **Cosa**: la UI chiama getHistory a ogni `selectSession` e ad altri eventi; con S2 il costo crolla ma restare attenti a non farlo in loop.
- **Da verificare**: punti esatti nel frontend (useSidecarData.ts:795 e altre).

### S7 — CAP SESSIONI ATTIVE (complemento a S1)
- **Policy**: massimo N sessioni Pi in `#active` (es. 5) per app; oltre → disattiva la meno recente inattiva (LRU).
- **Vincoli**: mai le in streaming; mai `__app_expert__` se Expert aperto? (l'Expert gestisce la sua; la main fa recovery solo se 9183 chiuso — già così).

---

## 4. COSA MISURARE (Bible §25) — prima e dopo ogni fix
- Idle RSS, picco, dopo-GC, dopo-idle
- `heapStats()`: heapSize/heapCapacity/extraMemory/objectCount/protected
- Numero di sessioni in `#active` (via probe)
- Curva: 1 → 5 → 10 → 20 → 50 → 100 sessioni (Test E)
- Curva open/close ×50 (Test B), cambio tab ×100 (Test C), streaming ripetuto (Test D), streaming + cambio tab (Test H)

---

## 5. DECISIONI DA PRENDERE (discussione)
1. **Strategia sessioni (S1+S7)**: quante attive max? inactivity timeout? dispose al cambio sessione?
2. **getHistory tail (S2)**: procediamo (basso rischio, grande guadagno)?
3. **--smol (S5)**: quick win subito o prima misurare baseline senza?
4. **Vacuum jsonl (S3)**: sì? (rischio integrità) o rimandare?
5. **Monitoring heapStats (S9)**: sì — strumentazione prima di toccare il codice.
6. **Fix leak (S4)**: ovviamente sì — bug reale, indipendente dalle strategie.
7. **Shutdown/watchdog (S8)**: il sidecar Expert deve restare su a app chiusa (scheduler H24) o spegnersi con la app?

---

## 6. FONTI ONLINE (raccolte)
- Bun docs — Runtime: `bun run --smol` ("Use less memory, but run garbage collection more often")
- Bun docs — Executables: `BUN_OPTIONS=--smol` per standalone; `--compile-exec-argv="--smol"`; compiled executables reduce memory usage
- Bun blog — "Debugging JavaScript Memory Leaks" (2 apr 2025): `writeHeapSnapshot`, `heapStats()`, EventEmitter/listener retention, JSC "moats"
- GitHub oven-sh/bun: #6548 (limit memory), #12941 (Bun.gc(true) non rilascia), #27046 (RSS cresce in prod)
- GitHub earendil-works/pi: **#6841** (unbounded memory growth: session entries kept in RAM — NON fixato), #7772 (tracking reduce memory)
- Bible RAM & Performance (utente): DATA≠UI, §14 chat attiva/in-esecuzione/vecchia, §21 spike vs leak, §24-25 stress test/metriche
