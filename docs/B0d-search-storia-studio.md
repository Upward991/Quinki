# B0.9b — STUDIO: SEARCH SU TUTTA LA STORIA (fatta bene)

> Studio approfondito (online + interno) su come fare la ricerca su tutta la history SENZA rompere la precisione.
> Fonti: SearXNG (MiniSearch/FlexSearch/Fuse.js, debounce, highlight), codice attuale.

---

## 0. IL PROBLEMA (perché i tentativi precedenti hanno fallito)

La vecchia ricerca locale è **precisa** perché lavora a livello di **OCCORRENZE** (ogni posizione del carattere):
- `matches = [{ msgIdx, charIdx }]` — ogni singola "C", ogni numero, ogni punteggiatura
- evidenziazione della posizione ESATTA
- scroll al centro

I miei tentativi sidecar hanno fallito perché la sidecar ritornava **MESSAGGI** (un match per messaggio), non **OCCORRENZE**. Risultato: salti, match fantasma, conteggio incoerente.

**La regola**: la search deve ritornare **OCCORRENZE** (messageId + timestamp + charIdx), non messaggi.

---

## 1. ARCHITETTURA CORRETTA

### Sidecar (streaming, senza indice)
- `searchSessionMessages(key, query)` → stream del jsonl riga per riga
- Per ogni messaggio: estrai il testo, trova **TUTTE le occorrenze** della query (charIdx)
- Ritorna: `[{ messageId, timestamp, charIdx, role }]` (cap 10.000)
- **Niente indice**: lo streaming è ~1-2s per 10.000 messaggi, accettabile con debounce (300ms)

### Frontend
- Debounce 300ms → chiama `searchSessionMessages` → `historyMatches` (occorrenze)
- **Navigazione**: frecce su/giù navigano le occorrenze (indice)
- **Quando l'occorrenza è nella finestra caricata** → evidenzia il charIdx + scroll al centro (come la vecchia)
- **Quando è oltre la finestra** → `getHistoryAround(timestamp)` → la finestra si ricarica → evidenzia il charIdx + scroll al centro

### Il punto critico: la text extraction DEVE combaciare
- Il frontend estrae il testo con: `content.replace(/```[\s\S]*?```/g,'').replace(/`[^`]*`/g,'')`
- La sidecar DEVE usare la STESSA estrazione, altrimenti il charIdx non combacia
- Soluzione: estrarre la funzione di estrazione in un modulo CONDIVISO (o replicarla identica)

---

## 2. LIBRERIE (dalla ricerca online)

| Libreria | Cosa fa | Serve a noi? |
|---|---|---|
| **MiniSearch** | full-text search in-memory, "as you type", ranking, fuzzy | ❌ NON per l'highlight: issue #37 — non salva le posizioni dei termini → non può evidenziare il charIdx esatto |
| **FlexSearch** | full-text search velocissimo | ❌ stesso limite: trova i documenti, non le posizioni dei caratteri |
| **Fuse.js** | fuzzy search | ❌ fuzzy, non per occorrenze esatte |
| **lunr/elasticlunr** | full-text search | ❌ come sopra |

**Conclusione**: le librerie full-text trovano i DOCUMENTI (messaggi), non le OCCORRENZE (posizioni). Per l'evidenziazione precisa serve una **ricerca semplice per substring** (indexOf) che ritorna il charIdx — che è esattamente quello che fa la vecchia ricerca locale. **Nessuna libreria da installare**: la soluzione è la sidecar che fa `indexOf` e ritorna le occorrenze.

---

## 3. PIANO DI IMPLEMENTAZIONE (incrementale, testato)

1. **Sidecar**: `searchSessionMessages` ritorna OCCORRENZE (messageId + timestamp + charIdx + role), con la STESSA text extraction del frontend. Test: parità col conteggio locale.
2. **Frontend**: debounce → historyMatches (occorrenze); frecce navigano le occorrenze; se l'occorrenza è nella finestra → evidenzia + scroll al centro; se oltre → getHistoryAround → evidenzia + scroll.
3. **Log**: stessa cosa (searchDebugLog ritorna occorrenze).
4. **Test automatici**: parità conteggio (sidecar vs locale su una finestra), salto preciso, evidenziazione.

---

## 4. DECISIONI

1. **Nessuna libreria** (la ricerca per substring è la soluzione giusta per l'evidenziazione precisa) — ok?
2. **Streaming senza indice** (1-2s con debounce) — ok, o vuoi un indice in-memory (MiniSearch) per la velocità?
3. **Cap 10.000 occorrenze** — ok?

---

## 5. FONTI
- MiniSearch (lucaong/minisearch): full-text in-memory, ma issue #37 = niente posizioni per l'highlight
- FlexSearch/Fuse.js/lunr: trovano documenti, non occorrenze
- Debounced search (dev.to, StackOverflow): pattern standard 300ms
- La vecchia ricerca locale (codice attuale): il riferimento per la precisione (indexOf + charIdx)
