# VM TEST SUITE — RESOCONTO (Batch 1-7)

Data: 1-2 settembre 2026 · Target: Quinki v4 (45ad26cf) nella VM (macOS 26.6.2, UTM)
Modello: deepseek/deepseek-v4-flash-0731 (OpenRouter + Ollama host) · Suite: `scripts/vm-tests/`

## ✅ FUNZIONA (verificato dal vivo, ~85 test)

**Streaming & messaggi (Batch 1 — 19/19)**: ack→pill→delta→done→stop · thinking auto-max (xhigh) · footer completo (modello/agente/thinking/tokens/usage/cacheRead) · markdown/code/bold/bullets · abort in ogni fase (thinking/testo/tool) + turno dopo l'abort parte subito · steering (design SDK: consegnato al prossimo step) · risposta 19k char senza troncamenti (1042 delta) · messaggio 43k char · emoji/unicode round-trip · 3 chat in parallelo (pool workers) · allegati (lettura + sezione prompt) · modello invalido rifiutato · kill APP a metà turno: lo streaming sopravvive e completa; history integra alla riapertura · kill SIDECAR a metà turno: autoprompt recovery con UN solo turno, user_message visibile, retry scale attiva.

**Tool call (Batch 2 — 17/17)**: read/grep/find/ls/bash/write/edit + catene 3+ tool · errori gestiti (isError) · output 2000 righe · sleep 8s · path non autorizzati bloccati · plan mode read-only (file NON creato) · bash_readonly blocca la scrittura (plan) · blocchi toolcall start/delta/end completi.

**Agenti & delega (Batch 3 — 16/17)**: delegation_start/end con nested blocks · doppia delega (2 start/2 end) · anti-loop (il delegato non può delegare) · override thinking=off applicato · @tag routing diretto (via agentId, come il frontend) · errore multi-agente inglese persistito nel jsonl · i 3 agenti default con system prompt corretti.

**Skills (Batch 4 — 9/9)**: menu /skill (filtro frontmatter) · iniezione one-shot VERIFICATA a livello system prompt (hasSkills true→false) · skill su agente delegato iniettata · tool skill (list) · listSkills · chips persistiti nel registry.

**Long Horizon & autoprompt (Batch 5)**: autoprompt del support agent VISIBILI in tempo reale (user_message live — il fix funziona) · flusso reale planning→running→build: unità eseguite (file creati) · stato persistito · stop utente MAI ri-promptato.

**Task/Scheduler (Batch 6)**: fire puntuale + risposta persistita · schedule `once` auto-rimossa dopo il fire (design) · **catch-up FUNZIONA** (fire previsto col sidecar morto → eseguita 4s dopo il riavvio) · schedule_task via modello · getTaskStatus/readHandoff · deleteSchedule · runTask fire-and-forget (queued → risultato persistito).

**Sessioni (Batch 7 — 7/7)**: crea/rinomina/elimina · cartelle+spostamento · reset (history azzerata su disco) · read-state persistito.

## 🐛 FINDINGS (da fixare)

1. **[MEDIA] `setModel` con modello invalido avvelena la sessione senza rollback** — `s.model` viene scritto+persistito PRIMA della validazione; l'RPC risponde "Model not found" ma il modello rotto resta nella sessione e su disco. (`pi-bridge.ts` ~2679)

2. **[BASSA] Autoprompt: doppio evento `user_message`** — il recovery lo emette (pi-bridge ~3453) E il send interno lo ri-emette (~6121) → il frontend mostra il bubble doppio.

3. **[MEDIA] Override thinking per agente: solo `on`/`off` gestiti** — livelli concreti (low/medium/high/xhigh) cadono: `levelToApply2` resta undefined → ignorati in silenzio. (`pi-bridge.ts` ~6410-6430)

4. **[BASSA] Recovery "informato" non informato** — `lastPartial` calcolato solo per il log (`rich:`), mai iniettato nel prompt. Codice morto + commento fuorviante. (`pi-bridge.ts` ~3425-3445)

5. **[MEDIA] Cap-6 del recovery = CODICE MORTO** — il messaggio "Could not recover this turn after 6 attempts" non può MAI arrivare: il guard `retries >= 3` (skip) scatta prima del ramo `retries >= 6`. L'utente non vede mai l'errore finale; il recovery si spegne in silenzio a 3. (`pi-bridge.ts` ~3398 vs ~3420)

6. **[ALTA] `longHorizonDeactivate` non disattiva** — fa `st.active = true` (è una PAUSA!) → LH non si spegne mai, stati zombie active:true su disco che `resume()` può rimettere in running al riavvio. Manca un vero off. (`longhorizon.ts` ~215)

7. **[MEDIA] `longHorizonSetPlan` non porta la fase a running** → il percorso diretto (goal+plan senza setPhase) gira le unità in plan read-only: falliscono in silenzio. Il flusso UI completo funziona. (`longhorizon.ts` setPlan)

8. **[ALTA] Recovery su riavvio sidecar/app: bubble persi** — l'autoprompt `user_message` è emesso PRIMA che il frontend riconnetti il WS → l'utente vede i bubble solo dopo reload (riprodotto 2 volte dall'utente). Serve replay-on-connect o fetch all'apertura.

9. **[ALTA] Errore provider ≠ "app interrotta" + DOPPIO recovery** — un 500 del provider fa partire DUE meccanismi insieme (`auto-reprompt-scheduled` + `pending-turn-recover-mid`) → doppio invio (2 msg-in a ~2s) e messaggio fuorviante "The app was interrupted" quando nulla era interrotto. (riprodotto: ollama.com 500 ×2)

10. **[MEDIA] Sidecar main SENZA watchdog** — dopo un kill/crash del sidecar nessuno lo riavvia (0 auto-restart in 180s); l'app resta sullo splash "Could not start!" (messaggio fuorviante) e serve il bottone Restart manuale. L'Expert sidecar invece HA il watchdog: asimmetria.

## ⚠️ NOTE (non-bug / comportamenti)
- Steering = consegna al prossimo step del loop SDK (by design).
- Deleghe chat-scoped: l'agente delegabile deve essere nella roster della chat (by design).
- Skill senza flag frontmatter non appaiono nel menu /skill (by design del filtro).
- Unità LH in running = build mode con bash piena: con piani vaghi il modello crea/cancella liberamente (da sapere).
- `once` schedules auto-rimotate dal registry dopo il fire (design); runTask è async fire-and-forget (queued).
- Pool: le sessioni girano su worker, eventi tornano correttamente al frontend (verificato).
- T1.15a "sidecar riparte" era falso positivo (translocation di residuo quarantena di un test Gatekeeper — ripulita).

## ⏳ NON ESEGUITI
- **Batch 8 (stress)**: 5 stream paralleli, kill -9 ×3, tempesta reconnect, kitchen sink, memoria RSS. Parzialmente coperto da batch 1/6 (3 paralleli ✓, kill verificati ✓).
- **Batch 9 (Expert app nella VM)**: bundle installato ma non testato (9183, handoff, watchdog).
- Temi/drag&drop/export (visual-manuali).
## 🎯 #13 [ALTISSIMA] — ROOT CAUSE degli autoprompt "insensati" (trovato live)
Un turno che completa NON cancella i marker pending-turn **di turni precedenti**: la cancellazione richiede `turnCompleted && markerTurnStarted && sameMessage` — un marker **stantio** (di un'interruzione/recovery precedente) resta per sempre → il driver 30s lo vede → autoprompt per un messaggio **già risposto**. Riprodotto: turno di report completato (turnCompleted:true) → `marker-keep-turn-not-complete` (sameMessage:false) → 30s dopo autoprompt insensato. Il recovery inoltre non controlla se il messaggio del marker ha GIÀ una risposta nel jsonl. FIX: a turno completato, cancellare ANY marker più vecchio; e il recovery deve verificare che il messaggio non abbia già risposta.

## ✅ BATCH 8-9 (completati dopo il resoconto intermedio)
- **Batch 8 STRESS: 8/8 PASS** — 5 stream paralleli completati, rapid-fire 5 messaggi ravvicinati = 5 turni distinti senza merge, RSS sidecar 329MB dopo tutto lo stress.
- **Batch 9 EXPERT NELLA VM: 7/7** — App Expert.app avvia + sidecar 9183 ✓ · isExpertAlive=true con Expert su ✓ · la main NON tocca __app_expert__ (skip) ✓ · app+watchdog+sidecar spenti → isExpertAlive=false → **la main ADOTTA la sessione** (recovery-expert-down-main-recovers) ✓ · watchdog dell'Expert rilancia il sidecar (tornato su dopo il kill) ✓.

## 🎯 RIPRODUZIONE LIVE (in questa stessa sessione Expert)
L'utente ha visto 3 autoprompt "insensati" + 2 bubble visibili solo dopo reload: causa = finding #13 (marker stantio mai pulito perché `sameMessage=false` a turno completato) + #8 (bubble emessi prima della riconnessione WS) + #9 (500 provider → doppio fire `auto-reprompt-scheduled` + `pending-turn-recover-mid`, 2 msg-in a ~2s). L'ultimo autoprompt post-report: turno completato → marker-keep (sameMessage:false) → driver → autoprompt. STOP utente rispettato ✓ (stopped-turn > marker).

## ✅ ROUND 2 FIX (F1-F12) — stato
- F2,F3,F6,F8 ✓✓ VERIFICATI in VM: emissione unica, gave-up al cap-6 (recovery-gave-up nei log con retries:6), LH disable=active:false+file, setModel rifiutato prima della scrittura (set-model-rejected-before-write ×2)
- F5,F7,F11 ✓ installati (visuali: sys message cronologico, no wipe all'attivazione LH, codice morto rimosso) — da verificare a occhio dell'utente
- F10 ✓✓ VERIFICATO: kill -9 sidecar → watchdog lo riaccende in <6s (prima: morto per sempre)
- F12 (nuovo, trovato in deploy): single-instance PID check ingenuo (kill(pid,0)=esiste) — col riuso PID l'app non partiva MAI in silenzio → fix: verifica che il PID sia DAVVERO l'app + cleanup del PID stantio
- F9: fix applicato (on→caps max) MA test VM mostra thinking finale=off — RESIDUO da indagare (turno ok, ma il livello non risulta il max)
- F1/F4: meccanismo installato (dedup+live-extras) — da verifica utente; se salta ancora il bubble, aggiungo il percorso-dati in getHistory
- LEZIONE DEPLOY: il bundle di build ha il sigillo rotto → la VM va sempre deployata dalla copia FIRMATA di /Applications (post install-main), MAI dalla build dir

## ✅ F9-FINALE (chiuso)
'on' non tocca livelli concreti (MAI passare 'max' al Pi SDK: non è un livello valido → SDK riporta OFF). Il massimo lo possiede la macchina universal-thinking del session level (caps evolution + mappature provider = futuribile). VM test: thinkingLevel=xhigh, translated=max ✓ PASS.
## ⚠️ REGOLA DEPLOY VM (critica, memorizzarla)
Nel deploy sulla VM killare SEMPRE ANCHE IL SIDECAR (pkill -9 -f quinki-sidecar-ws) PRIMA di riaprire l'app: start.sh esce se la 9182 è occupata → il vecchio binario sopravvive e i test girano sul codice vecchio (è successo per 2 round di fix). Il watchdog poi riaccende quello nuovo dal bundle.
