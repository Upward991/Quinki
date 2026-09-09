# B0.8 — DESIGN VIRTUALIZZAZIONE + PAGINAZIONE CHAT (20 ago 2026)

> Studio approfondito PRIMA di implementare (fase delicata). Requisiti dell'utente + analisi + rischi + test.

---

## 0. REQUISITI UTENTE (espliciti)

1. **Streaming**: durante una risposta si renderizzano SOLO l'ultima bolla UTENTE + la risposta IN STREAMING (intera). Tutto il resto della chat è virtualizzato. → 100 chat in streaming = ~200 elementi totali, mai lag.
2. **A fine streaming**: torna a renderizzare una finestra di **50 messaggi** (virtualizzati) + piccolo buffer sopra/sotto.
3. **Paginazione**: scroll su oltre i 50 → carica i **50 precedenti**, e così via (50 alla volta) → tutta la storia visibile.
4. **Compaction**: nessuna novità (i messaggi vecchi restano su disco) → paginazione/virtualizzazione ok.
5. **Tab/chiusa NON aperta → NON renderizzata nulla** (nessun rendering nascosto).
6. **Bolle SEMPRE intere** (mai troncate — B0.7 annullato).

---

## 1. SCELTA LIBRERIA — VIRTUOSO Message List

**Decisione: `react-virtuoso` (componente MessageList)** — già ricercato online (PkgPulse 2026: per chat è la scelta pragmatica; TanStack richiede gestione manuale del reverse-scroll).

Motivi:
- Virtualizza con **altezze dinamiche** (le bolle hanno altezza variabile — tool toggle, markdown).
- **`followOutput`**: autoscroll allo streaming (scorre automaticamente quando arriva l'ultima risposta).
- **`startReached` / prepend**: caricare messaggi più vecchi (paginazione) **senza far saltare lo scroll** (ancoraggio built-in) — il problema noto (TanStack #195/#1082, StackOverflow).
- **`initialTopMostItemIndex`**: aprire la chat in fondo (ultimi messaggi).
- Item eterogenei (messaggi + task + system LH) supportati.
- Nessuna libreria per le altezze fisse → non possiamo fare un virtualization custom semplice (le bolle hanno dimensioni variabili).

**Costo**: nuova dipendenza (~30KB gzipped), test di integrazione.

---

## 2. ARCHITETTURA

### 2a. Dati: finestra di 50 + pagine

- **Oggi**: `getHistory` → ultimi 200 → merge cronologico → `props.messages` (200).
- **Nuovo**: 
  - `getHistory(key, { limit: 50 })` → **ultimi 50** (il merge cronologico resta lato frontend, uguale).
  - `getHistoryBefore(key, { ts, limit: 50 })` → i **50 precedenti** a un timestamp (sidecar: legge la coda del jsonl PRIMA di ts — riuso del tail-reader B0.3 + filtro).
  - Il frontend mantiene `windowMessages` (array, max 50 per volta) + `olderCount` (quanti più vecchi esistono).
- **La finestra**: 50 messaggi renderizzati (virtualizzati → solo i visibili nel DOM). Buffer: l'overscan di Virtuoso (~200px).

### 2b. Streaming-mode (la tua regola)

```
se props.streaming == true:
    data = [lastUserMsg, streamingMsg]   // SOLO questi due
    followOutput = "smooth"               // resta in fondo mentre cresce
altrimenti:
    data = windowMessages (50, virtualizzati)
```
- Il messaggio in streaming si renderizza **per intero** (1 elemento → Virtuoso lo monta tutto).
- Appena `streaming` finisce → `data` torna alla finestra 50 (stesso componente, stesso scroll container → nessun jump: Virtuoso mantiene l'ancoraggio).
- Con 100 chat in streaming e SOLO quella aperta montata → il DOM è 2 elementi per la chat aperta; le altre 99 non sono montate (vedi §5).

### 2c. Paginazione

- Virtuoso `startReached` → `getHistoryBefore(windowMessages[0].timestamp)` → prepend 50 → Virtuoso mantiene la posizione.
- Finché ci sono messaggi più vecchi → si ripete (50 alla volta).
- Il dato arriva già "mergiato" (tool_call/tool_result/delegation in blocchi) con lo stesso merge della history.

### 2d. Compaction

- I messaggi vecchi (compaction summary) sono nel jsonl → la paginazione li include (stessa pipe di getHistory). Nessuna novità ✓.

---

## 3. FEATURE DELLA CHAT — come convivono con la virtualizzazione

| Feature | Comportamento attuale | Con Virtuoso |
|---|---|---|
| **Autoscroll** (streaming + nuovo messaggio) | `scrollTop = scrollHeight` | `followOutput` (built-in) |
| **Search** (highlight, scroll-to-match) | `querySelector('[data-msg-idx]')` + `scrollIntoView` | `scrollToIndex(idx)` (API) + item wrapper con `data-msg-idx` |
| **Date filter / bookmark** | filtro su `props.messages` + `scrollIntoView` | `scrollToIndex` + la data indica l'idx nell'array caricato |
| **Marker unread** ("unread below") | basato su timestamp + ultimo messaggio caricato | componente renderizzato come item (Virtuoso supporta item custom) oppure indicatore sticky sopra il primo non letto |
| **Task panel** (taskRuns mix) | `chatItems` misti (msg+task+sys) | item eterogenei (Virtuoso) — stesso merge |
| **LH system message** | item "sys" | item eterogeneo |
| **Export md/html** | usa `props.messages` (200) | deve usare i DATI completi: switch a una funzione lato sidecar `exportSessionMessages(key)` che legge la storia intera (o export solo dei 50 caricati + paginazione on-demand per l'export) |
| **Copy** | per-messaggio | invariato (il singolo messaggio montato è completo) |
| **Compaction toggle** | per messaggio | invariato |
| **Reset/Reload/Compact** | RPC sidecar | invariati |

**Decisione export**: `props.messages` oggi = 200. Con la finestra 50, l'export coprirebbe solo 50 → **NON accettabile** → export va fatto lato sidecar (`exportSession` legge il file). Alternativa temporanea: export dei 50 caricati con nota — ma meglio lato sidecar (già esiste `getHistory` — si può riusare leggendo TUTTA la storia per l'export).

---

## 4. SUBSCRIPTION / TAB NON APERTE (requisito 5)

- **Già rispettato**: `App.tsx` monta SOLO la ChatArea del tab attivo. La sidebar è una lista leggera (sessioni), non messaggi.
- **Verificare in B0.8**: (a) nessun componente lista nascosta (es. tab non attivi) montato; (b) la finestra `win-chat` monta la sua ChatArea solo se aperta; (c) durante lo streaming di una chat NON aperta → solo il sidecar lavora, il DOM non tocca nulla.
- **Da aggiungere**: quando una chat NON è più il tab attivo → la ChatArea si smonta (già così) → nessun listener WS residuo (già cleanup verificato). Eventuali buffer di streaming lato frontend per chat chiuse → pulirli (il restore usa `getStreamingSnapshot`).

---

## 5. RISCHI E COME NON ROMPERE (mappa feature)

| Rischio | Mitigazione |
|---|---|
| **Autoscroll rotto** (il più temuto) | Virtuoso `followOutput` + test manuale (streaming lungo, stop, riprendi) |
| **Scroll salta durante il prepend (paginazione)** | Virtuoso gestisce l'ancoraggio; test: scorri 500 messaggi senza salti |
| **Search/date/marker rotti** | API `scrollToIndex`; ogni item ha `data-msg-idx` → il codice esistente continua a funzionare |
| **Task panel / LH system message scompaiono** | item eterogenei; test: task + LH visibili |
| **Export con 50 msg** | export lato sidecar (storia completa) |
| **Streaming-mode disturba lo scroll** | il switch 50→2→50 è lo stesso componente (data cambia) + Virtuoso mantiene la posizione |
| **Prestazioni con 100 chat** | SOLO la chat aperta è montata; streaming-mode 2 elementi |
| **Multi-window (win-chat)** | ogni finestra ha il proprio stato/lista — invariato |
| **Regressione durante lo streaming di tool lunghi** | la bolla in streaming è 1 item → nessun troncamento (requisito 6) |

---

## 6. TEST

### Automatici (io, prima dell'install)
- **Parità dati**: `getHistoryPage(50)` vs `getHistory(200)` → gli ultimi 50 sono identici (stesso id/ordine).
- **Paginazione**: `getHistoryBefore(ts)` su 3 pagine → ordine corretto, nessun duplicato, nessun buco.
- **Streaming-mode**: simulare i dati → il componente riceve `[user, stream]` quando `streaming=true` (test unit se si estrae la logica).
- **Search/date**: parità dei match sull'ultima pagina.

### Manuali (utente)
- Apri chat grande → scroll fluido, DOM leggero (DevTools).
- Scroll su → carica 50+50 → nessun salto.
- Streaming: solo la risposta + ultima utente renderizzati; a fine, 50 messaggi.
- Search → click → salta al match. Marker unread. Task panel. Export (tutta la storia).

---

## 6. DECISIONI DA CONFERMARE

1. **Libreria**: Virtuoso Message List (aggiungo dipendenza) — ok?
2. **Finestra**: 50 + buffer (overscan) — ok (tuo requisito).
3. **Paginazione**: 50 alla volta — ok.
4. **Export**: porto l'export lato sidecar (storia completa) — ok?
5. **Ordine**: implemento in 2 step: (1) dati+sidecar (getHistory limit/before + merge) con test; (2) UI con Virtuoso (streaming-mode, finestra 50, paginazione) con test manuale.

---

## 7. SEQUENZA IMPLEMENTAZIONE (se approvato)

1. Sidecar: `getHistory` con `limit` + `getHistoryBefore` (tail + filtro) → test parità/paginazione.
2. Frontend: `useSidecarData` mantiene `windowMessages` + `olderPage` (50), streaming-mode data.
3. ChatArea: Virtuoso MessageList (item = MessageBubble/note/task), followOutput, startReached, scrollToIndex.
4. Export lato sidecar.
5. Test automatici + manuali → install.
