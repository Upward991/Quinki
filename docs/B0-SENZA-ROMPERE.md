# B0 — STUDIO "SENZA ROMPERE NESSUNA FEATURE"

> Per ogni modifica: cosa cambia, QUALI feature potrebbero rompersi, come mitigare, come verificare PRIMA di installare.
> Regola: ogni cambiamento deve passare da test automatico (script bun su WS) + test manuale mirato PRIMA di arrivare all'utente.

---

## 0. FEATURE CRITICHE DA NON ROMPERE — INVENTARIO COMPLETO

> **L'inventario COMPLETO delle feature (estratto dal codice: 134 RPC + 54 comandi Rust + strumenti agenti + UI) è in `docs/APP0-FEATURES-INVENTARIO.md`.** Qui sotto le aree di riferimento per le analisi di rischio (ogni area racchiude più feature).

| Area | Feature principali (vedi inventario per il dettaglio) |
|---|---|
| **A1 Chat/Messaggi** | send/stream/stop/steer/clip, 200 msg, marker unread, search+date, export, reset/reload/compact, allegati, task clips, multi-agente, default agent |
| **A2 Agenti/Risorse** | CRUD agenti (protetti), skill, MCP (3 tipi), tool + bash_readonly, plan mode, default agent |
| **A3 Task/Scheduler/Timeline** | executor, scheduler (once/daily/…), recoverExecutions, handoff, piani, ponti chat↔task |
| **A4 Long Horizon** | fasi, unità, support agent, session files, git, multiple sessioni |
| **A5 Sessioni/Sidebar** | folders, tombstone, welcome, multi-window (win-chat) |
| **A6 Notifiche** | 2 modalità, badge, pannello, macOS click→chat, read-state condiviso |
| **A7 Settings/Providers/Modelli** | providers DnD, apiKey, modelli, thinking probe, tema, default |
| **A8 Files/Attachments** | clip, cartelle, export, permessi cartelle |
| **A9 Ciclo vita app** | tray, close-to-tray, quit modale, kill sincrono, menu custom, watchdog |
| **A10 Expert/Sync/Update** | install/sync/rollback/restart Expert, banner, apply update |
| **A11 Recovery/Reliability** | pending-turn, recoverPendingTurns, executor recovery, tombstone, merge condivisi |
| **A12 Home/Calendar/Log** | welcome, timeline, task view, log |
| **A13 Sidecar/SDK** | sessioni Pi, jsonl, compaction, Ollama, MCP client, auth |
| **A14 Permessi macOS** | TCC, folders, system settings |

---

> Nota: i riferimenti F1–F14 qui sotto sono le aree critiche specifiche per ogni modifica (da incrociare con l'inventario completo A1–A14).

## 1. B0.1 — Monitoring heapStats (S9)

- **Cosa cambia**: + RPC `getHeapStats`, + log periodico.
- **Cosa potrebbe rompersi**: nulla (read-only). Attenzione solo: non loggare troppo spesso (CPU) → 1 per agent_end + 1/60s idle.
- **Mitigazione**: log solo se cambi > 10MB.
- **Verifica**: probe bun → RPC risponde con i campi; nessun impatto su streaming.

## 2. B0.2 — Fix leak remove() (S4) 🔴

**Cosa cambia**: `remove(key)`, `deleteSessionsByKeys`, `deleteSessionsByFolder` ora chiamano `(unsub)?.()` e `(pi as any).dispose?.()`.

**Feature a rischio**:
- F2 (streaming): dispose su sessione in streaming → turno perso → **GUARDIA: mai dispose se `#streamingBuffers.has(key)` o se c'è un turno attivo (`#prompts.has(key)`)**.
- F1 (recovery): dispose di una sessione con `pending-turn.json` → il marker resta → al boot il recovery ri-prompta (OK, è il comportamento voluto), MA se la sessione è stata ELIMINATA dall'utente il recovery non deve ri-ripparla → il marker va eliminato con la sessione.
- F3 (task `__exec_*`): dispose a metà task → task rotta → **GUARDIA**: dispose SOLO dopo `agent_end` (executor già chiama `remove` al termine; assicurare che `remove` non disfi una sessione con task attivo — verificare `executor.running` per quella execution).
- F5 (allegati): nessun impatto (solo sessioni eliminate).
- F10 (sync): `remove` è per-app; la sessione eliminata è tombstone → nessun conflitto.

**Mitigazioni**: (1) guardie streaming/attivo; (2) eliminare `pending-turn.json` quando si elimina la sessione; (3) nei delete BULK, iterare e chiamare lo stesso helper `removeDispose(key)`.
**Verifica** (prima dell'utente): script bun su WS: `createSession` → `sendMessage` breve → `deleteSession` → `getHeapStats` → l'heap NON deve crescere dopo GC; controlla anche che una sessione in streaming NON venga disposta (crea streaming, prova delete → deve essere ignorata/bloccata).

## 3. BOD.3 — getHistory tail (S2)

**Cosa cambia**: la HISTORY VIEW legge la coda del jsonl invece di `buildSessionContext` completo.

**Feature a rischio**:
- F12 (search): la search gira sugli ultimi 200 → col tail resta identica (200 msg) → ok.
- F8 (compaction): i messaggi "compactionSummary" devono essere inclusi dal tail-reader (leggere anche le entry `compaction` nella coda).
- F7 (delegations): il merge cronologico delegations/tool_call è lato UI → il tail deve restituire messaggi nello STESSO formato di prima (stesso `#mapMessage`).
- F13 (marker unread): basato su timestamp dei messaggi → ok.
- F2 (streaming restore): `getStreamingSnapshot` separato → ok.

**Implementazione sicura**: tail-reader che legge le ULTIME ~250 righe (leggere da fine file con Buffer), le `JSON.parse`, e applica lo STESSO `#mapMessage` + merge delegations/compaction. Parità garantita da un **test di confronto**: su 3 sessioni (piccola, media, __app_expert__) `getHistory` vecchio vs nuovo → stessi ultimi 200 (stesso id e ordine).

**Fallback**: se il tail-reader fallisce o il file è malformato → tornare al path vecchio (try/catch).

## 3. B0.4 — `--smol` (S5)

**Cosa**: env `BUN_OPTIONS=--smol` all'avvio del sidecar.
**Rischio**: nessuna feature (solo GC più frequente, CPU + leggermente). NON rompe niente.
**Verifica**: avvio app → sidecar parte → probe risponde → misura CPU idle per 2min.

## 5. B0.5 — Sessioni LRU (S1+S7) 🔴 (il più delicato)

**Cosa cambia**: una sessione inattiva (no streaming, no turno, lastActivity vecchia, oltre il max N) viene disposta (dispose + unsub). Al prossimo uso si ricarica.

**Feature a rischio**:
- F1 (recovery): il recovery scansiona le sessioni al boot. Se una sessione è stata disposta (ma non eliminata), il recovery NON deve ri-attivarla inutilmente → il recovery lavora su `pending-turn.json` e sui jsonl, non su `#active` → ok. MA: se il marker esiste su una sessione disposta, il recovery la ri-attiva e la ri-prompta → è il comportamento voluto.
- F2 (streaming): MAI disporre una sessione in streaming (guardia `#streamingBuffers.has`).
- F3 (task): le `__exec_*` attive → guardia su `executor.running`; le `__exec_*` completate → dispose SUBITO (migliora anche il leak).
- F4 (LH): le sessioni LH in corso hanno `state.json` con `active:true` → guardia: non disporre se `longHorizon.isActive(key)`.
- F10 (sync): `read-state`, `context-usage` restano su disco (non sono in RAM della sessione) → ok.
- F14 (agent default): `#agentOverride`, `messageSkills` sono in `SessionEntry` (metadata, non Pi session) → restano.

**Implementazione sicura**:
1. `#touchSession(key)` aggiorna `lastActivity` (già esiste `lastActivity` in SessionEntry).
2. `#sweepInactive()` EVENT-based (non timer): chiamato su `selectSession`/`deleteSession`/agent_end — MAI da un timer periodico (regola recovery event-based).
3. Guardie triple: no streaming buffer, no pending turn attivo, no executor/LH attivo, non `__app_expert__` se l'Expert è aperto? (NO — l'Expert gestisce la sua; la main NON deve disporre la sessione che l'Expert sta usando: l'Expert ha la propria istanza Pi, la main la sua — nessun conflitto. La main può disporre la SUA sessione `__app_expert__` se inattiva.)
4. Config disattivabile: `maxActiveSessions` / `sessionIdleTimeout` in settings con default (es. 5/15min).

**Verifica**: script bun: attiva 10 sessioni con invio breve → attendi idle → controlla `#active` via streamingStatus/getDebugLog → solo N attive; RSS cala; poi riusa una sessione disposta → torna attiva e la history c'è.

## 6. B0.7 — UI V3 truncate contenuti enormi

**Cosa cambia**: il RENDER di bolle con contenuto > soglia è troncato con "Show more"; i DATI restano interi.

**Feature a rischio**:
- F11 (export): l'export usa `messages` (full) → NON troncare i dati, solo il render → ok.
- F12 (search): la search cerca nel full content (usa `messages` data) → ok; il highlight su testo troncato? → se il match è nella parte troncata, mostrare "Show more" evidenziato.
- F5 (allegati): i blocchi allegati restano visibili (non sono il contenuto testuale troncato).
- F7 (delegations): i blocchi delega sono dentro la bolla → non troncarli (o tronca solo il testo del tool result).

**Implementazione**: in `MessageBubble`/`MessageBlocks`, per ogni blocco `tool_result`/`text` oltre soglia → render primo N KB + bottone. Soglia e comportamento configurabili.
**Verifica**: chat con messaggio 1.3MB → conteggio DOM nodes < 1500 (DevTools); "Most more" espande senza ri-render dell'intera lista (memo).

## 7. B0.8 — UI virtualizzazione + paginazione (V1+V2) 🔴 (fase 2)

**Feature a rischio (tutte le chat)**: 
- Autoscroll allo streaming e scroll-to-bottom (F2).
- Marker unread + auto-scroll al marker (F13).
- Search: highlight in DOM, scroll-to-match `data-msg-idx` (F12).
- Date separators/bookmarks (F13).
- Load older: scroll position stable (jump) — noto.
- Task panel mix (chatItems) — il pannello task convive nella lista.
- LH system message (chatItems).
- Multi-window (F9).

**Come farlo senza rompere**: **Virtuoso Message List** (gestisce autoscroll + older + anchor); alza `itemContent` con `MessageBubble` memo; le feature che usano `querySelector('[data-msg-idx=...]')` (scroll-to-match) → API Virtuoso `scrollToIndex`; il marker unread → componente renderizzato da Virtuoso (header/footer o item). Test manuale PER OGNI feature: scroll fluido, search → click → scroll, marker, task panel, LH, export.
**Regressione**: paragonare con la vecchia ChatArea su 5 scenari (streaming, search, date, task, unread).

## 8. B0.9 — streaming batching (V4) + search sidecar (V5)
- **V4**: i delta accumulano in buffer → setState a 20-30Hz. Rischio: testo in ritardo (accettabile), markdown parziale durante lo stream (già oggi il markdown parziale è un problema noto) → flush a fine stream. Verifica: FPS durante streaming 5 min.
- **V5**: nuova RPC search — zero rischio (aggiunta); test: search su sessione grande → risultati rapidi senza caricare la history.

---

## 9. REGOLA OPERATIVA
1. Ogni fase: **test automatico prima** (script bun su WS) → **test manuale** → SOLO POI install.
2. Ogni fase è separata e reversibile (git commit dedicato; rollback con checkout se serve).
3. Le metriche vengono raccolte PRIMA (baseline) e DOPO ogni fase (Bible §25).
