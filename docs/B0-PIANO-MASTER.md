# B0 — PIANO MASTER (COMPLETO)

> Il piano unico che raccoglie TUTTO: dove sta ogni studio, cosa è fatto, cosa manca, in che ordine, con metriche e decisioni.
> Aggiornato: 20 ago 2026.

---

## 1. MAPPA — DOVE STA TUTTO

| Cosa | File | Contenuto |
|---|---|---|
| **Indagine RAM sidecar** | `docs/B0-indagine-performance.md` | Metodo, numeri misurati, casistiche **C1–C11**, soluzioni **S1–S9**, metriche, decisioni, fonti online |
| **Indagine UI/rendering** | `docs/B0b-ui-rendering-indagine.md` | Rendering chat (200 msg cap), entry 1.3MB, casistiche **U1–U6**, soluzioni **V1–V6**, fonti online (Virtuoso, Lighthouse DOM 1500) |
| **Roadmap pubblicazione** | `~/Downloads/road-to-public-quinki.md` | Fasi A1–A3 ✅, EXTRA ✅, chiusura app ✅; prossimo: B0 → A2.5 → A4 → B → C |
| **Probe di misura** | `/tmp/probe-ram.ts`, `probe-history.ts`, `measure-session.ts` | Misure live su sidecar 9182/9183 + harness heapStats |
| **Codice sidecar** | `sidecar-src/pi-bridge.ts` (7.222 righe) | Sessioni Pi, getHistory, log, notify, streaming |
| **Codice UI** | `src/App.tsx`, `ChatArea.tsx`, `MessageBubble.tsx`, `useSidecarData.ts` | Rendering, subscription, streaming |
| **Ciclo vita chiusura** | `src-tauri/src/lib.rs` + `QuitConfirmGate.tsx` | C11 ✅ risolto |

---

## 2. STATO (cosa è GIÀ fatto)

- ✅ **A1 MCP, A2 H24, A3 Notifiche** (roadmap)
- ✅ **C11 — chiusura app**: Cmd+Q → modale (Quit App + recovery), tray → conferma nativa, kill_backend() sincrono in TUTTI i percorsi, watchdog Expert consapevole. **Verificato: 0 processi residui su main ed Expert.**
- ✅ **Recovery testato**: chat e task interrotte → riapri → auto-prompt → completano.
- ✅ **Cleanup log `[A3]`** dal frontend.
- ✅ **B0 COMPLETO (20 ago sera)** — sotto il dettaglio; resta B0.10/A2.5 Enduro.

---

## 3. IL PROBLEMA IN UNA RIGA

**Sidecar**: sessioni Pi ritenute in RAM (~185MB l'una), spike getHistory (+466MB), leak sessioni eliminate (mai GC), RSS high-water (mai restituito all'OS) → Expert 2.1GB.
**UI**: 200 msg max montati (cap), ma entry da 1.3MB → DOM eccessivo (Lighthouse: <1500 nodi), nessuna virtualizzazione, streaming per-token.

---

## 4. PIANO DI LAVORO — ORDINE + METRICHE + RISCHI + TEST AUTOMATICI

> Ogni fase ha: cosa · dove · metriche · rischio · **test automatico** · verifica. Lo studio "come non rompere" è in `docs/B0-SENZA-ROMPERE.md`. I test automatici sono script bun su WS (li faccio IO prima di installare, regola: mai far testare all'utente).

### B0.1 — Monitoring (S9)
- **Cosa**: RPC `getHeapStats` + log `heapStats()` (bun:jsc) a ogni agent_end e ogni 60s idle.
- **Dove**: `sidecar-src/pi-bridge.ts` + `sidecar.ts` (RPC) + risorse.
- **Metrica**: heapSize/heapCapacity/extraMemory/objectCount nel debug log.
- **Test automatico**: ✅ SÌ — script bun: RPC `getHeapStats` → risponde con heapSize/heapCapacity/extraMemory/objectCount; log contiene le entry periodiche. **Verifica**: probe bun → RPC risponde.

### B0.2 — Fix leak (S4) 🔴
- **Cosa**: `remove()`/`deleteSessionsByKeys`/`deleteSessionsByFolder` → chiamare `(unsub)?.()` + `(pi)?.dispose?.()` PRIMA di eliminare. Guardie: niente dispose se streaming buffer attivo o pending-turn presente.
- **Dove**: `pi-bridge.ts` (`remove()` riga ~1295, delete IPC ~6808) + `executor.ts` (remove `__exec_*`).
- **Metri**: RSS dopo eliminazione di N chat non cresce; heapStats scende.
- **Test automatico**: ✅ SÌ (forte) — script: crea→attiva→invia→`deleteSession` ×20 → `heapStats` dopo `Bun.gc` → l'heap NON deve crescere; guard: sessione in streaming NON viene disposta (delete ignorata); sessione eliminata → `pending-turn.json` rimosso. **Verifica**: test bun + poi test manuale (elimina chat in UI).
- **Verifica**: test bun: crea→attiva→rimuovi sessione → heapStats; poi test manuale (elimina chat in UI).

### B0.3 — getHistory tail (S2)
- **Cosa**: per la HISTORY VIEW non costruire il contesto completo; leggere la coda del jsonl (ultime ~250 entry) e mappare quelle. Il send resta con l'SDK (contesto completo).
- **Dove**: `pi-bridge.ts` `getHistory()` + helper tail-reader.
- **Metrica**: getHistory su __app_expert__: da +466MB spike → <10MB; tempo da 612ms → <50ms.
- **Test automatico**: ✅ SÌ (test di PARITÀ) — script bun: per 3 sessioni (piccola, media, `__app_expert__`) confronta getHistory vecchio vs nuovo → stessi ultimi 200 (stesso id e ordine), tempo < 100ms, delta RSS < 10MB; fallback al vecchio se file malformato. **Verifica**: script di parità + probe tempi.
- **Verifica**: script bun che confronta getHistory nuovo vs vecchio (stessi ultimi 200 messaggi, id+order).

### B0.4 — quick win `--smol` (S5)
- **Cosa**: `BUN_OPTIONS=--smol` nel launch del sidecar (start.sh / Rust env).
- **Metrica**: curva RSS idle/streaming con e senza.
- **Test automatico**: ✅ SÌ (parziale) — avvio con `BUN_OPTIONS=--smol`: probe RPC rispondono, CPU idle 2min registrata, RSS a riposo prima/dopo. **Verifica**: misura.

### B0.5 — Sessioni LRU (S1+S7) — il grande
- **Cosa**: policy: max N attive (es. 5); dopo X min di inattività o cambio chat → `dispose()` + unsub. RIapre on-demand (con B0.3 per lo spike).
- **Dove**: `pi-bridge.ts` (`#ensureActive`, new `#touchSession`, `#inactivitySweep` event-based) + guardie streaming.
- **Metrica**: N sessioni attive, RSS, curva 1→5→10→20→50→100. **Test automatico**: script scala (vedi B0.6).
- **Test automatico**: ✅ SÌ (forte) — script bun: attiva N sessioni con invio breve → wait idle → conta attive (deve essere ≤ max via streamingStatus/debugLog); RSS cala; riusa una disattivata → torna attiva con history; guardie: sessione in streaming / task / LH mai disposta. **Verifica**: test 100 sessioni + manuale.
- **Decisioni**: quante attive? timeout? (vedi §5)

### B0.6 — Misura finale
- Curva 1→100 sessioni, open/close ×50, streaming ripetuto, cambio tab ×100 (Bible §24-25).

### B0.7 — UI: V3 truncate contenuti enormi — ❌ ANNULLATO (20 ago, scelta utente) — **FATTO: mai troncare**
- L'utente NON vuole il truncate per-contenuto: il toggle già nasconde il contenuto chiuso; quando aperto deve mostrare TUTTO; il thinking in streaming non si può troncare.
- Il problema DOM dei contenuti enormi (1.3MB) va risolto DIVERSAMENTE: virtualizzazione (B0.8) + eventualmente cap a livello di CHAT (es. ultime N risposte montate, le più vecchie lazy) — MAI troncare una singola bolla.
- **Cosa**: tool result/output > soglia (es. 20KB) → default troncato + "Show more". Export/copia/ricerca usano il FULL.
- **Dove**: `MessageBubble.tsx` (render blocchi), `useSidecarData` (non troncare i dati, solo il render).
- **Metrica**: DOM nodes di una chat con 1.3MB scende sotto 1500. **Test automatico**: PARZIALE — estrarre la logica truncate come funzione pura → `bun test` (default, bordi, full data intatti); il conteggio DOM è manuale (DevTools).
- **Rischio**: l'utente "perde" visibilità → toggle espandi + export completo.

### B0.8 — UI: virtualizzazione + paginazione (V1+V2) — fase 2
- **Cosa**: Virtuoso Message List (o TanStack) per il render dei 200+ messaggi; `getHistoryBefore(ts)` lato sidecar per caricare più vecchi su scroll-up.
- **Dove**: `ChatArea.tsx`, `MessageBubble` wrapper; `pi-bridge.ts` (nuovo RPC).
- **Metrica**: DOM nodes < 1500; scroll fluido; caricamento storia senza salti. **Test automatico**: PARZIALE — lato sidecar: nuova RPC `getHistoryBefore` con test parità/tempi (bun); lato UI: manuale (autoscroll, search, marker, task panel) — browser automation (playwright) è un'opzione futura, non ora.
- **Rischio**: ALTO (autoscroll, marker unread, search highlight, scroll-to-msg, data-msg-idx query) → Virtuoso MessageList + test manuale di ogni feature.

### B0.9 — UI: streaming batching (V4) + search sidecar (V5)
- **Cosa**: batch dei stream_event a 20-30Hz; RPC `searchSessionMessages` che cerca nel jsonl.
- **Dove**: `useSidecarData.ts` (buffer delta), `pi-bridge.ts` (search RPC).
- **Test automatico**: SÌ (parziale) — buffer batching: `bun test` della logica di buffer (accumulo/flush); search sidecar: test bun (query su sessione grande → correttezza vs grep, tempi). UI streaming: FPS manuale.

### B0.10 — A2.5 Enduro (24-48h)
- Valida B0: due app conviventi, leak, crash/ripristino, RAM per giorni.

---

## 5. DECISIONI APERTE (da discutere)

| # | Domanda | Opzioni | Impatto |
|---|---|---|---|
| D1 | Quante sessioni attive max? | 3 / 5 / 10 | RAM vs re-open cost |
| D2 | Inactivity timeout per dispose? | 5 / 15 / 30 min | RAM vs frequenza re-load |
| D3 | Vacuum dei jsonl enormi (S3)? | sì / rimandato | RAM + riduzione, risk integrity |
| D4 | Default notify mode nuove chat? | none / all | popup macOS default |
| D5 | Order di B0.3 vs B0.5? | tail prima (riduce spico) o LRU prima (riduce retention) | trade-off |

---

## 6. METRICHE OBIETTIVO (curves, Bible §29)
- Idle sidecar main: da ~1.1GB a **<400MB**
- Expert: da 2.1GB a **<600MB** (dopo che le sessioni inactive vengono disposte)
- getHistory su sessione grande: picco da 466MB a **<10MB**
- N sessioni attive: 1→100 curva piatta (ritenzione ~costante)

---

## 7. PROSSIMO PASSO IMMEDIATO
**B0.1 (S9) + B0.2 (S4) + B0.7 (V3)** come primo pacchetto — misurabili, a rischio basso/medio, non rompono niente (vedi `B0-SENZA-ROMPERE.md`).
