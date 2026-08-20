# B0b — INDAGINE UI/RENDERING (20 ago 2026)

> Studio approfondito sul lato FRONTEND (React): rendering chat, virtualizzazione, subscription, streaming.
> Fonti online: virtuoso.dev (Message List), GetStream docs (VirtualizedMessageList), react-window docs, StackOverflow (DOM size), react-markdown, Syncfusion.

---

## 0. METODO
1. **Audit interno** del codice di rendering: ChatArea, MessageBubble, LogPanel, CalendarView, useSidecarData.
2. **Misura dati reali**: dimensioni delle entry nel jsonl di `__app_expert__` (43.444 entry, top 1.3MB).
3. **Ricerca online**: librerie di virtualizzazione per chat, best practice, limiti DOM, streaming batching.

---

## 1. COME RENDERIZZA OGGI (stato reale)

| Area | Stato | Limite |
|---|---|---|
| Chat | `ChatArea` → `chatItems` (msg + task + LH) → `.map()` → **TUTTI i messaggi montati**, niente virtualizzazione | max **200** messaggi (`getHistory` → `slice(-200)`) |
| Messaggio | `MessageBubble` è `memo`; rende thinking + tool call + tool result + **markdown del testo** | nessun limite sulla dimensione del contenuto |
| Log | `LogPanel` | cap **300** entry (`slice(-300)`) |
| Calendar | lista task/schedules (tutte renderizzate) | nessun cap esplicito (cresce con le task) |
| Subscription frontend | tutte con cleanup (`return () => unsub...()`) | ✅ nessun leak |
| Streaming | `stream_event` per token → append → setState per token | costo CPU, non RAM |
| Multi-chat | **una sola** ChatArea montata per volta (tab attiva) | le altre chat NON sono renderizzate |

### Dati reali (`__app_expert__`, 43.444 entry)
- Entry singola più grande: **1.313 KB (1.3 MB)** — risultato tool/enorme
- Media 2.2 KB, mediana 0.9 KB
- → se una entry da 1.3 MB è tra gli ultimi 200 messaggi renderizzati, il markdown crea **decine di migliaia di nodi DOM** → lag evidente (StackOverflow: 4000+ DOM nodes possono già essere problematici)

---

## 1. CASISTICHE / PROBLEMI (UI)

### U1 — MESSAGGI ENORMI renderizzati per intero 🔴
- Una entry da 1.3MB (tool result / output) → react-markdown → **decine di migliaia di nodi DOM** in una sola bolla. Con 200 messaggi di cui 10 grossi → DOM eccessivo → lag/scroll lento.
- **Online**: "Avoid an excessive DOM size" (4000+ nodi già da valutare); react-markdown performance.

### U2 — NESSUNA VIRTUALIZZAZIONE
- I 200 messaggi sono TUTTI montati (anche quelli fuori viewport). Oggi il cap 200 limita il danno, ma:
  - Se in futuro mostriamo la cronologia completa (paginazione), saranno migliaia di msg → lag.
  - Con 7-8 chat attive simultaneamente (multi-window, task chat + chat + expert) → N×200 msg tutti renderizzati.
- **Sintomo tipico**: scroll che lagga, DOM enorme, paint lento.

### U3 — STREAMING PER-TOKEN (CPU)
- Ogni `stream_event` (token) → `setState` → re-render della lista. Con memo, si re-renderizza solo la bolla streaming, ma ChatArea ricostruisce `chatItems` + sort a ogni token → O(n log n) × token.

### U4 — LIMITE 200 = LIMITE UX
- Non puoi **scrollare oltre 200 messaggi** né cercare nella storia completa (la search gira sui 200). Serve paginazione (caricare più vecchi) con virtualizzazione.

### U5 — LISTE SECONDARIE
- LogPanel: cap 300 ✓. CalendarView: lista task/schedules **senza cap** — con 1000+ task potrebbe crescere (da misurare).

### U6 — SUBSCRIPTION
- Frontend: ✅ cleanup verificato. Il leak delle subscription è nel sidecar (C4), non qui.

---

## 2. SOLUZIONI (con fonti online)

### V1 — VIRTUALIZZAZIONE MESSAGGI (per U2)
- **Virtuoso** (`virtuoso.dev/message-list`) — è la libreria pensata ESATTAMENTE per chat: virtualizza i messaggi, mantiene l'**autoscroll**, gestisce **"loading older messages"** (cronologia), scroll-to-bottom. È il pattern "Messaging interface / AI chatbot" documentato.
- Alternative: **react-window** (più semplice, ma l'autoscroll+ancoraggio in chat va gestito a mano), **@tanstack/react-virtual** (headless).
- **Risultato**: DOM = solo i messaggi visibili ± buffer (es. 20-30 nodi) invece di 200-2000.

### V2 — PAGINAZIONE CRONOLOGIA (per U4)
- Caricare messaggi più vecchi quando l'utente scrolla in alto: sidecar → `getHistoryBefore(ts)` che legge la coda del jsonl PRIMA di un timestamp (riusa il tail-reader di S2 lato sidecar).
- Virtuoso documenta esattamente "Loading older messages" (infinite scroll verso l'alto senza salti — GitHub open-webui #23990: il problema dei "jump" quando si virtualizza+carica storia; Virtuoso lo risolve con anchor).

### V3 — CONTENUTI GROSSI: TRONCA + "SHOW MORE" (per U1) 🔴
- Per risultati tool/output enormi: default troncato (es. prime 20KB) + bottone "Show more" (come i toggle delle sezioni) → il DOM resta piccolo.
- Collassare di default le bolle con contenuto > soglia; espandere a richiesta.
- Fonti: DOM size limit, react-markdown performance.

### V4 — STREAMING BATCHING (per U3)
- Buffer dei `stream_event` nel frontend: accumula i delta e fa setState ogni **33-50ms** (~20-30Hz) invece che a ogni token. La UI resta fluida, il testo appare comunque in tempo reale.
- Fonti: pattern standard chat streaming (bun blog/streaming), GetStream docs.

### V5 — SEARCH LATO SIDECAR (per U4)
- Search su TUTTA la storia (non solo 200): RPC `searchSessionMessages(key, query)` che legge il jsonl (o l'indice) e ritorna match — il frontend non deve caricare nulla.

### V6 — STABILITÀ REFERENZE / MEMO (complemento)
- Già `MessageBubble` memo; assicurarsi che lo streaming NON cambi le referenze dei messaggi non-in-stream (verifica: in useSidecarData lo stream aggiorna solo il messaggio attivo → ok; da ri-verificare con la batching).

---

## 3. QUANDO APPLICARE (sequenza)

1. **SUBITO (con B0)**: V3 (truncate contenuti enormi) — costo basso, elimina il lag DOM da 1.3MB ANCHE oggi.
2. **Fase 2 (dopo B0 sidecar)**: V1 + V2 (virtualizzazione + paginazione storia completa) — quando vogliamo scrollare/cercare tutta la storia.
3. **Fase 2**: V4 (streaming batching) — CPU.
4. **Fase 2**: V5 (search lato sidecar).

---

## 4. MISURARE PRIMA (Bible §22-25)
- DOM nodes della chat Expert aperta (DevTools → elementi → conteggio)
- Durata render di un messaggio da 1.3MB
- FPS durante streaming lungo
- DOM con 100 task nel calendar/task panel

---

## 5. FONTI ONLINE
- **Virtuoso Message List**: https://virtuoso.dev/message-list/ (virtualizzazione + autoscroll + loading older)
- **GetStream VirtualizedMessageList**: https://getstream.io/chat/docs/sdk/react/components/core-components/virtualized-list/
- **react-window**: oneuptime guide; **@tanstack/react-virtual**
- StackOverflow "Avoid an excessive DOM size" (4000+ nodi)
- react-markdown issue #703 (keys/re-render)
- open-webui #23990 (scrolling up jumps con lazy/virtual)
- Syncfusion "Render Large Datasets in React"
- Slate "Improving Performance" (paint 100× slower con molti nodi)
