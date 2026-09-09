# B4 — STUDIO APPROFONDITO: ISOLAMENTO SESSIONI (worker vs processi)

> 21 ago 2026. Scopo: 100-1000 sessioni usabili FLUIDAMENTE (mai timeout), accettando RAM che scala con le sessioni.
> Domanda: worker threads o altra architettura? Cosa si rompe? Quanto tempo? Quali test?

---

## 1. SCOPERTA CHIAVE: IL PATTERN DEL SECONDO PROCESSO ESISTE GIÀ IN QUINKI

**L'Expert è un SECONDO sidecar-processo** (porta 9183, `QUINKI_ROLE=expert`, owner-lock, filtro sessioni in `#load`/`getSessionsFromFile`/`getSessionsWithFolder`). Il codice per **far girare N processi sidecar con sessioni separate** è GIÀ in produzione e funziona da settimane.

→ La soluzione per B4 è **MOLTO più semplice di un refactor a worker threads**: è lo STESSO pattern dell'Expert, generalizzato a N processi con un router.

---

## 2. LE DUE STRADE A CONFRONTO

### STRADA A — PROCESS POOL (N processi sidecar, raccomandata) 🟢
```
┌─ MAIN sidecar (porta 9182) = ROUTER + pool-0 ───────────┐
│  - WS server + RPC con il frontend                     │
│  - METADATA owner: sessions.json, folders, settings     │
│  - scheduler / longhorizon / notifiche / recovery       │
│  - ospita il gruppo di sessioni hash%N==0               │
│  - proxy per le sessioni degli altri gruppi             │
└──────┬──────────────────────────────────────────────────┘
       │ WS interno (localhost:9184, 9185, ...)
  ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
  │SIDECAR 1│  │SIDECAR 2│  │SIDECAR 3│   = stessi binari, porta +1
  │ grupp0  │  │ grupp0  │  │ grupp0  │   ognuno: SOLO le sue sessioni
  └─────────┘  └─────────┘  └─────────┘

- Assegnazione: `hash(sessionKey) % N` (deterministica, stabile)
- Ogni child: il VERO PiBridge, carica solo le sue sessioni (filtro tipo expert)
- CPU: N processi su N core = PARALLELISMO VERO
- Crash: un child muore → solo le sue sessioni; il main lo riavvia
- Codice PiBridge: **NON CAMBIA** (i child sono lo stesso binario!)

### STRADA B — WORKER THREADS (bun Worker)
- PiBridge unico deve essere SCISSO in: main (router) + worker (executor sessioni)
- Il SDK gira in worker (heap separato per worker — ok), MA:
- `#active`, `#entries`, `#streamingBuffers`, `#wss`, `#prompts` sono UNO stato intrecciato in 7.658 righe → split ad alto rischio
- Cross-worker: delegazioni, MCP, longhorizon → messaggi via main
- bun Worker ≠ thread "leggero": ogni worker ha heap separato + copia del SDK (~90MB) — RAM simile al process pool
- **Vantaggio vero dei thread**: meno overhead di spawn, heap JSC condivisi → in futuro
- **Svantaggio**: refactor enorme, rischio regressioni

| Criterio | A. Process pool | B. Worker threads |
|---|---|---|
| Cambi a pi-bridge.ts (7.658 righe) | **NESSUNO** | SCISSO completo |
| Pattern già in produzione | ✅ Expert (9183) | ❌ nuovo |
| Parallelismo CPU | ✅ N processi = N core | ✅ N thread = N core |
| Isolamento crash | ✅ migliore (processo) | parziale (thread) |
| RAM base extra | ~90MB × (N-1) | ~90MB × N (stessa) |
| Tempo stimato | **1-2 settimane** | 4-6 settimane |
| Rischio | **BASSO-MEDIO** | ALTO |
| SDK thread-safe? | ✅ (già per processo) | ⚠️ da verificare |

---

## 3. COME LO FAREBBE REALE (process pool) — 6 passi incrementali

1. **POC off-app** (0.5gg): spawn 2 sidecar con `QUINKI_POOL_SIZE=2 QUINKI_POOL_INDEX=0|1`, filtro `hash(key)%2`, mini-router in bash/node → verificare che le due parti funzionano.
2. **Filtro pool nel #load** (generalizzare `expertOnlyScan` → `poolIndex`/`poolSize`): il child carica SOLO le sue sessioni. (1-2 gg)
3. **PoolManager in sidecar.ts**: al boot spawna N-1 child (stesso binario, porta +N, env pool), restarta i morti. (1 gg)
4. **Router nel main**: RPC per sessione di altro gruppo → forward via WS interno; streaming del child → proxy al frontend; `sessions.json` e metadata SOLO nel main (i child non lo scrivono: env `QUINKI_POOL_CHILD=1`). (3-4 gg)
5. **Recovery/scheduler/longhorizon**: restano nel main (già sono lì); il recovery gira su TUTTE le sessioni (il main le vede tutte via metadata). (1 gg)
6. **Test Enduro pool**: T1-T8 sotto. (2-3 gg)

**Totale: 1-2 settimane.** Si può partire con N=2 e scalare.

---

## 4. COSA SI RISCHIA DI ROMPERE (e come evitarlo)

| Rischio | Impatto | Mitigazione |
|---|---|---|
| `sessions.json` scritto da N processi | RIGA metadata | Il MAIN è l'UNICO scrittore; i child scrivono solo i jsonl per-sessione |
| `context-usage.json` / `models.json` condivisi | Corruzione | Owner main; i child solo lettura |
| Routing sbagliato (session key → child sbagliato) | Chat nel child sbagliato | Hash deterministico + test di routing |
| Streaming proxy rotto | Chat senza eventi | Test dedicato (T4) |
| Un child muore | Sessioni perse | Auto-restart child + riavvio recovery (T5) |
| Delegazione cross-gruppo | Tool rotto | Forward via main (test T6) |
| La sessione `__app_expert__` | Confusione ruoli | Il pool NON tocca l'Expert (owner-lock invariato) |
| MCP client condiviso | Doppio collegamento | Ogni child i suoi MCP (stesso pattern odierno) |

---

## 4. PIANO DI TEST (Enduro-style)

| Test | Cosa verifica |
|---|---|
| T1 Routing | hash → stesso child SEMPRE (create/open/close ×50) |
| T2 Split corretto | ogni child carica solo le sue sessioni (nessun doppione) |
| T3 Metadata | rename/delete/folder/move dal frontend → sessions.json corretto (main) |
| T4 Streaming proxy | child→main→frontend: evento per evento identico al single-process |
| T5 Crash child | kill child → main riavvia → sessioni recuperate (recovery) |
| T6 Cross-group | session A (child1) delega a B (child2) → funziona |
| T7 Carico | 100 sessioni su N=4: zero timeout RPC, misura RAM (proiezione: ~2.6GB per 100) |
| T8 Expert | pool + Expert (9183) convivono; ruolo invariato |
| T9 Recovery | boot con pool: solo turni interrotti ri-promptati |

**Criterio di successo T7**: con 100 sessioni in streaming, tutte le RPC rispondono < 200ms (oggi: timeout).

---

## 5. PROIEZIONE RAM (process pool, 4 processi)

| Sessioni | RAM proiettata | Note |
|---|---|---|
| 1 | ~0.3GB | main (0) + nessun extra |
| 20 | ~0.9GB | main + 3 child base 90MB |
| 100 | **~2.6GB** | 2.2GB contesti + 4×90MB base |
| 1000 | ~26GB | ok su Mac Studio 128GB+ |

La RAM scala con le sessioni (corretto — è il costo del lavoro). I ~270MB extra di base (3 child) sono il prezzo dell'isolamento — accettabile (e "pagato" dalla fluidità).

---

## 5. QUANDO VALE LA PENA I WORKER THREADS (futuro)
- Se il base per-processo (90MB × N) diventasse rilevante (macchine piccole, N molti)
- Se bun matura l'API Worker per importare il SDK in modo sicuro
- MA oggi: il process pool risolve il problema con un rischio 10× inferiore

---

## 6. FONTI
- bun docs: Workers vs child_process (GitHub discussion #14053)
- bun issue #21560 (RSS in spawned child process)
- Node: "Worker Threads vs Child Process: choose right" (adhdecode 2026)
- Nostro codebase: il pattern Expert (9183, owner-lock, filtro ruoli) è la prova che il pool funziona
