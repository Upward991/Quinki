# ROAD TO PUBLIC — Quinki

> Piano per portare Quinki da "app pronta" a "pubblicata". Aggiornato: 4 settembre 2026.
> **STATO: A1 ✅ · A2 ✅ · A3 ✅ · EXTRA ✅ · B0 ✅ · A2.5 ENDURO ✅ · B4 PROCESS POOL ✅ · A4.1 HOME ✅ · A4.2 STORE ✅ · A4.3 JS RUNTIME ✅ · A4.4 MARKET ✅ · Fix storici ✅ (loadOlder, banner sync, TDZ, dedup) · B RIFINITURA ✅ (manca solo smoke test utente nuovo + auto-prompt bubble).** Prossimo: **C0 Preparazione privata (sicurezza secret → licenze/legale → README/docs → sito → marketing)** mentre lo smoke test gira → al termine: LANCIO (DMG → repo pubbliche → Pages → marketing; dominio solo se cresce).

## 🟢 SESSIONE 3-4 SET 2026 — PROVIDER BUILD-IN, OLLAMA CLOUD, USAGE WINDOWS, AUTO-INSTALL ✅

> La sessione ha trasformato l'onboarding dei provider: OpenRouter e Ollama sono ora
> **provider fissi di default** (un utente nuovo li trova già presenti: fa solo login /
> installa Ollama), con usage in finestra, e Ollama si **auto-installla** dal dentro la app.
> Sotto l'upgrade del SDK e la suite di test che hanno reso tutto solido.

### FATTO (dettaglio)

| Lavoro | Stato | Note |
|---|---|---|
| **Pi SDK 0.78 → 0.84.4** | ✅ | Vendored + tutti i patch ri-applicati (delegation walker, systemPrompt guard, auth bypass, compaction off, BPE estimator). ~10 bug critici fixati: masked-key destruction, salt path ~/.pi→~/.quinki, AuthStorage→#createRegistry via ModelRuntime, clamp chars/4→BPE+floor 256, models.json avvelenato→sync live, pool lazy spawn, shrink-retrap, LH non-ROUTABLE, done LH inghiottito |
| **Suite test VM completa** | ✅ | ~120 test (T1-T8 + edge): streaming, tools, agents, skills, long-horizon, tasks, sessions, stress — tutti verdi. Harness fix: waitDoneWhere consuma i done, q.turn helper, t3 rewrite, t5d restore HOSTKEY |
| **Fallback 401** | ✅ | Catena fallbackModels per sessione, scatta SOLO su 401/402/403/404/credito (mai 429/5xx/abort). Riproduce l'ultima domanda utente. Delega+override+task coperti. Verificato VM: meta(401)→deepseek, xhigh, OK |
| **Provider FISSI di default** | ✅ | OpenRouter + Ollama garantiti su OGNI percorso di lettura config (early return, migrazione, catch). FIX GRAVE fresh-install: ensureBuiltinProviders mai chiamata + DEFAULT_CONFIG vuoto → su VM pulita i provider sparivano. Testato con agent dir vuota |
| **OpenRouter login/logout/usage** | ✅ | OAuth PKCE (browser+loopback, niente key manuale), key cifrata + modelli importati al login. Card "OpenRouter account" + "Remaining credits" (credito RESIDUO = total_credits − total_usage, non all-time) + Add credits (open_url) + refresh 60s solo quando visibile (IntersectionObserver) + freccetta |
| **Ollama Cloud — API discovery** | ✅ | Scoperta e validata `GET ollama.com/api/usage` (Bearer API key): session/weekly % (0-1), extra usage $, request_count per modello. NO reset timestamp esposto → calcolato noi. NO revoca API via API (tutto provato) |
| **Ollama account card** | ✅ | Login = apre browser su settings/keys + input inline + **validazione immediata** (rollback se invalida). Logout = FIX anti-loss (cloudApiKeyDelete flag — prima il fallback ri-scriveva la key e il logout non cancellava nulla). Key cifrata, preservata in read/write |
| **Ollama usage card** | ✅ | Session % + Weekly % con **barre** (rossa >90%), countdown reset con **ancore osservate** (reset-sync: usage che scende → ancora = ora → countdown esatto; prima: stima "(estimated)" griglia UTC 5h / lunedì 00:00 UTC) + Extra usage $ + bullet-list modelli per richieste |
| **Usage windows SEPARATE** | ✅ | win-usage (OpenRouter, 300x120) + win-usage-ollama (525x240). Drag strip 25px stile altre finestre (title bar UI senza titolo), pin DENTRO le card, window-state **denylist** (la dimensione arriva SEMPRE dal config, mai dallo stato salvato). FIX variant='card' hardcoddato che mostrava il floating panel nella finestra |
| **Ollama AUTO-INSTALL** | ✅ | Sezione "Ollama installation" sempre visibile (Installed (versione) verde + tasto disattivato / tasto attivo se manca). **Modale di conferma** → **download REALE con percentuale vera** (stream fetch + content-length, stato JSON 2hz, barra + MB) → estrazione → /Applications → open. FIX URL: l'asset era 404 (Ollama-darwin.zip su GitHub releases). Testato end-to-end: 6→27→58→91→100%→done |
| **UI/UX coerenza provider** | ✅ | Spaziature uniformi (16px), Ollama PRIMA di OpenRouter nei default (drag utente dopo), Cancel stile modale, "Installed" accanto al tasto, Test connection tenuto (senza icona), rename/delete bloccati sui built-in, no em-dash |

### LEZIONI CRITICHE (da non ripetere)
- `writeProvidersConfig` ha un'anti-loss che ri-aggiunge le chiavi cancellate: ogni campo cancellabile serve un **flag esplicito** (pattern apiKeyDelete / cloudApiKeyDelete)
- Il frontend va nel bundle SOLO se importato davvero: un componente referenziato senza import compila ma **non esiste nel bundle** (silenziosamente non renderizza)
- La verifica "marker nel dist/binario" (grep della stringa nel JS minificato / nel binario) è OBBLIGATORIA prima di ogni install
- `scripts/build-app.sh` = build unica con PATH corretto (cargo/bun) — usarla sempre
- Deploy VM: pulizia totale + tar/scp + verifica hash sidecar Mac↔VM (ditto non sovrascrive il sidecar in uso)
- Icone: verificare il nome esatto su api.iconify.design (push_pin ≠ push-pin; il nome sbagliato = pallino trasparente)

### ⚠️ INCIDENTE + RECUPERO DATI UTENTE (4 set)
- Durante la sessione gli agenti/skill/MCP dell'utente sul Mac sono scomparsi da ~/.quinki (l'app ha ri-seminato i default; mtime agents = 1 set). Il file config.json (con gli MCP) è sparito del tutto.
- **RECUPERATO TUTTO** dal backup manuale `~/Backups/quinki-pre-B0-20260820-132159/quinki-data/` (20 ago): 4 agenti (Notion, Coder, Web Researcher, Frontend Designer), 22 skill, MCP playwright-mcp (registry mcpServers.json). Verificato via RPC: MCP visibile; agenti/skill confermati visibili dall'utente nell'app.
- **Gap**: il backup era del 20 ago — tutto creato tra il 20 ago e la cancellazione è perso (chiedere all'utente se manca qualcosa).
- **PREVENZIONE OBBLIGATORIA**: backup di ~/.quinki (agents/skills/mcpServers.json/config) PRIMA di ogni operazione rischiosa + backup periodico automatico da aggiungere all'app (candidato post-lancio o bloccante? da decidere).

### PROSSIMO (secondo il piano)
1. **Ultimo giro di test significativo** (fresh VM + fresh Mac: onboarding → provider → chat → Ollama install → usage → fallback → Market → Expert)
2. Fix bug emersi
3. **C Pubblicazione** (DMG release → repo fresh → Pages → marketing)

---

## STATO ATTUALE (28 ago 2026)

> **28 ago: BUG MATERIALIZZAZIONE TOOL CUSTOM RISOLTO E PROVATO END-TO-END.** La verifica dal vivo
> nell'App Expert (post-sync): 15 tool visibili e usabili, `market` e `getTaskStatus` chiamati con successo
> nello stesso turno. La fix: dispose+reopen della sessione al cambio tools mid-session + re-apply della mode;
> il tool market convertito alla forma defineTool/execute (il vecchio {run} veniva chiamato male dal wrapper ->
> "value2 is not an Object"). Il falso negativo "NO GETTASKSTATUS TOOL" era GLM che elenca male i propri tool
> (si affida alla coerenza conversazionale) ma li chiama quando istruito direttamente (prove: payload-tools.log
> con i custom nel payload API + tool call/result nelle sessioni di test). Dettagli in fondo al documento.

| Fase | Stato | Note |
|---|---|---|

| Fase | Stato | Note |
|---|---|---|
| A1 MCP | ✅ | Fatto e testato (9 ago) |
| A2 H24 (engine, scheduler, recovery, timeline, LH, permessi) | ✅ | Completo (incl. A2.6–A2.12b, permessi, LH) |
| A3 Notifiche | ✅ **COMPLETO (19 ago)** | In-app + macOS, 2 modalità, marker/badge fixati, click notifica apre la chat, recovery event-based |
| **Extra 19 ago (stabilizzazione + feature fuori piano)** | ✅ **FATTO** | Vedi sezione dedicata sotto: fix root allegati, persistenza notifyMode, allegati in welcome, agente di default Quinki, banner sync Expert, restyle tab Agents |
| B0 Performance/RAM | ✅ **CHIUSA (21 ago)** | Sidecar 1-1.7GB → **92MB a riposo** / ~300MB con sessione attiva. Fix completivi: ruolo Expert, quit dock, stale buffer, titolo sessione. **Limite emerso**: saturazione a ~100 stream → fase dedicata B4 (worker pool) sotto |
| A2.5 Enduro test (24-48h) | ✅ **FASE ATTIVA COMPLETATA (21 ago)** | T1-T9 passati (stabile, no leak, forceGC ok). Stress 100 sessioni parallele multi-step: picco 5.2GB RSS + saturazione sidecar (caso estremo), torna a 273MB dopo restart. Resta il soak 24h opzionale. |
| A4.1 Home registry-driven | ✅ **FATTO** | Home con benvenuto centrato (opzione B), ricerca, Market, drag&drop, colonne, persistenza settings |
| A4.2 Store in-app | ✅ **FATTO (UI)** | Market: catalogo **12 item reali** (niente filler/finti), card, dettaglio, pagina sviluppatore, Account (profilo, installati, updates reali, uploads, following, uninstalled, settings), navigazione a stack, modali conferma, sync store↔nativo (se disinstalli da Agents/MCP settings lo store lo rileva), sezione Uninstalled con Reinstall. |
| A4.3 JS runtime | ✅ **COMPLETO (23 ago)** | Runtime bundle (tab renderizzano), **installer per TUTTE le categorie** (tab→~/.quinki/tabs, skill→SKILL.md, agent→config+PROMPT, mcp→addMcpServer, theme→theme.json), **back-end tab (server.js)** caricato dal sidecar (RPC `<tabId>:<method>`, ctx limitato: dataDir+call con permessi+log), QuinkiAPI (notes/agent/ui/call), scelta agente con/senza configurazione, **persistenza totale verificata** (tab/temi/agenti/skill/mcp/disinstallati sopravvivono al reinstall, ripristino istantaneo via read_quinki_settings) |
| **Fix storici (27 ago)** | ✅ FATTO | **Caricamento messaggi vecchi FUNZIONANTE**: `getHistoryBefore` legge il file RAW a chunk dal fondo (non buildSessionContext → dopo la compaction i pre-firstKeptEntryId erano invisibili); `#mapMessage` preserva i timestamp reali (prima tutti = Date.now() → loadOlder chiedeva "prima di adesso" e tornava gli stessi 50 → dedup → nulla); `onLoadOlder` mancante nel branch `_expert` del ChatArea → aggiunto (nell'app Expert lo scroll su non scattava). Banner sync: version.txt = hash git corrente a ogni install. Fix banner sync che non compariva (confronto version.txt Main vs Expert). Fix crash TDZ in compaction. Dedup rimossa GLOBalmente (ogni repo mantiene TUTTI i suoi item, id unici per sorgente+path). |
| A4.4 IL MARKET ONLINE | ✅ **COMPLETO (27 ago)** | **La app è il client del market online** (mai catalogo locale). FATTO: repo `quinki-market` = catalogo; **multi-sorgente** (My repos: adattatore per repo esterni — skill SKILL.md, agenti agents/*.md, MCP *mcp.json; fallback HTML senza API per il rate limit); **publish/upload** = login GitHub OAuth (browser, token su file), picker "solo ciò che hai creato" (multi-selezione con versione individuale, sezioni per categoria, sub-tab come Home), fork+PR (o push diretto per l'owner), **auto-merge** (workflow: struttura → scan statico → segreti → VirusTotal su binari → merge); Update/Remove (PR); **anti-furto** (registry hash+origine, blocco re-upload); filtro Repos + conteggi; avviso "Removed from repo" (dismissibile, solo rimozioni nuove); persistenza su file. TEST END-TO-END REALI: publish/update/remove di 4 agenti reali (Coder, Notion, Web Researcher, Frontend Designer) → tutti mergiati → Coder aggiornato a v1.0.1 → repo svuotato e rilevato. Login GitHub classico (browser + token persistente `~/.quinki/github-auth.json`, scope repo+workflow). |
| **B Rifinitura** | ✅ **QUASI COMPLETA (27 ago)** | **Onboarding guidato FATTO** (8 passi Home→Chat→Settings→Agents→Tasks→Market→Expert→Log, checkbox a destra, Resume = navigazione automatica, tasto Tutorial in Home, Skip = MAI più niente, modali non chiudibili cliccando fuori). **Thinking universale** (xhigh = SEMPRE il max del provider per QUALSIASI modello; Default thinking = On/Off per le nuove chat). **Expert header** (modale scelta Sync/Rollback = copia sezione Settings senza titolo/descrizione; sync con flusso completo conferma→progresso→Restart; rollback originale intatto; restart distingue Main vs Expert; modali sfocati fix). **Dead code removal** (10 file, 52KB). **Coerenza grafica** (search box AddItemsModal, tasti accent/danger standard, icona RotateCcw in Settings). **RIMANE**: smoke test utente nuovo + auto-prompt bubble (timing/posizione) + sessione Expert 124MB da archiviare. |
| C Pubblicazione | ⬜ PROSSIMA (C0 pronto) | **C0 PREPARAZIONE PRIVATA = COMPLETATA (28 ago)**: Blocco 1 Sicurezza ✅ (secret fuori dal repo, build-time injection), Blocco 2 Licenze/Legale ✅ (AGPL + manifest licenze + Safe Harbor), Blocco 3 Docs ✅ (ARCHITECTURE, DECISIONS, USER-GUIDE, DEVELOPER, MARKET, README, RELEASE-CHECKLIST), Blocco 4 Sito ✅ (privo, attiva in un clic). Restano SOLO lo smoke test e il LANCIO: release DMG → repo fresh → Pages → marketing. |
| A4.5 Account (POST-pubblicazione) | ⬜ FUTURO | Vero account della app: sincronizzazione multi-dispositivo (stessi agenti/skill/settings su più Mac), pagamenti futuri. **NON serve per il lancio** — si fa dopo la pubblicazione. |

**Prossimo passo: SMOKE TEST dell'amico (la app è PRONTA: materializzazione tool risolta e provata, C0 completata)** → **C Pubblicazione: release DMG → repo fresh → Pages → marketing** → A4.5 Account (post-pubblicazione).

## 📋 COSA MANCA — CHECKLIST FINALE (28 ago sera)

### PRIMA DEL LANCIO (bloccante — in ordine)
1. **SMOKE TEST dell'amico dell'utente** — la app è pronta. Percorso: installazione pulita dal DMG (tasto destro → apri) → onboarding → chiave provider → prima chat → assegnare tool a un agente dalla tab Agents → installare un item dal Market → test App Expert (chiedere un fix al codice). **NOTA per il smoke test**: un modello che dice "non ho il tool X" va verificato con una chiamata DIRETTA ("chiama subito il tool X") — GLM elenca male i propri tool ma li chiama (documentato sopra).
2. **Fix dei bug emersi dallo smoke test** (se ve ne sono)
3. **Build DMG pulita post-smoke-test** (1.0.0-beta.1)

### AL LANCIO (in ordine — C Pubblicazione)
1. **DMG in GitHub Releases** (Quinki_1.0.0-beta.1_aarch64.dmg, tag v1.0.0-beta.1) + changelog utente
2. **Repo fresh pubblico**: `Upward991/Quinki` + `quinki-market` (un solo commit "v1.0.0-beta.1"; esclusioni per docs/ interni e file obsoleti → docs/RELEASE-CHECKLIST.md) + copiare docs/MARKET-REPO-README.md come README del repo market + **sezione attribuzione third-party (Pi SDK MIT) nel README/NOTICE** (da Blocco 2)
3. **GitHub Pages ON**: sito (site/) + docs online + il secret OAuth nuovo per il repo pubblicato
4. **Marketing (Blocco 5)**: assets pronti (screenshot, GIF demo, 3 bullet, testo Show HN) → Show HN + Product Hunt + Reddit (r/LocalLLaMA, r/SideProject, r/opensource, r/Ollama) + X build-in-public (+ Discord dei tool)
5. **Canale feedback**: GitHub Issues

### POST-LANCIO (non bloccante, in ordine di valore)
1. **Notarizzazione Apple** ($99/anno) — quando la app genera entrate: elimina "tasto destro → apri" e i ri-prompt TCC periodici
2. **Dominio** (quink.ai o .app) — solo se i download crescono; collegabile a Pages in 5 min
3. **A4.5 Account** — multi-dispositivo + pagamenti
4. **Soak test 24h** (Enduro, opzionale)
5. Claim "The composable AI desktop" quando la tab platform è solida (post 1.0)

### SOSPESI MINORI (da fare quando conviene)
- Round-trip screenshot da ritestare con app stabile + TCC (non bloccante: il flusso è provato lato Pi; il permesso Screen Recording è policy Apple, la notarizzazione lo chiude)
- bash_readonly: ritest con la fix installata (restrizione su bash in plan mode)
- Auto-prompt bubble (timing/posizione: bubble solo al reload)
- Sessione `__app_expert__` 124MB da archiviare
- version.txt/payload-tools.log: la diagnostica nel vendored openai-completions.js può restare (append a ~/.quinki/payload-tools.log, innocua) o rimuovere al repo fresh

### 🔧 BUG MATERIALIZZAZIONE TOOL CUSTOM — RISOLTO E PROVATO (28 ago)

**La catena completa delle prove oggettive:**
1. `payload-tools.log` (diagnostica nel Pi SDK vendored openai-completions.js): il payload API include i custom tool (13 tools: getTaskStatus, market, screenshot INCLUSI) GIÀ mid-session dopo dispose+reopen
2. getTaskStatus: `TOOL CALL` → `TOOL RESULT: 'No tasks found'` (endo-to-end, 3/3 sessioni di test)
3. market (dopo la fix defineTool): `TOOL CALL: market {action:'list', category:'tabs'}` → `TOOL RESULT: 'No packages in this category.'`
4. Verifica FINALE dal vivo nell'App Expert (post-sync, 28 ago sera): 15 tool visibili, `market` e `getTaskStatus` chiamati dal Expert con successo nello stesso turno

**Le fix committate:**
- `f48e8138` — dispose+reopen della sessione al cambio tools mid-session (history preservata, stesse dinamiche del skills reload) + re-apply della mode dopo il refresh (la mode non si resetta più a plan) + rimozione corretta dei tool disassegnati
- `59853bce` — market tool convertito alla forma defineTool/execute(toolCallId, params) (la forma vecchia {run} veniva chiamata male dal wrapper Pi SDK destrutturizzando un non-oggetto → "value2 is not an Object")

**Il falso negativo documentato:** GLM risponde "NO GETTASKSTATUS TOOL" alle domande "elenca i tuoi tool"/"usa se puoi" MA chiama i tool quando istruito direttamente ("Non parlare, chiama il tool"). Il tool È nel payload (provato): è una debolezza di GLM nell'auto-descrizione con liste lunghe, NON un bug della piattaforma. Da tenere presente negli smoke test (un modello che "dice di non avere un tool" va verificato con una chiamata forzata).

**Da ritestare post-sync (non bloccante):** il round-trip screenshot (la tool call arriva al tool ma la GUI non rispondeva: app in riavvio, da verificare con app stabile) + bash_readonly (implementato come restrizione su bash in plan mode, non come funzione separata).

---

## ✅ UNIVERSAL THINKING CAPABILITY SYSTEM (29 ago, commit 59dbad9a)

**Il principio**: il massimo del thinking NON si mappa a mano, si SCOPRE e si CACHA. Il fix sostituisce le 5 logiche sparse (downgrade openai-fallback sbagliato per Ollama, mappe stantie self-perpetuanti, re-map runtime cieco) con un meccanismo solo.

**I 3 componenti:**
1. **Vendor openai-completions.js** (il punto di verità, dove la richiesta parte):
   - Cache delle capacità: `~/.quinki/thinking-caps.json` (chiave host/modelId)
   - Risoluzione live: il think-param inviato è quello della CACHE quando richiesta xhigh/high
   - **Self-heal**: se l'API rifiuta il livello (errore con think/reasoning/invalid) → parso i valori ammessi DALL'ERRORE STESSO → scelto il massimo → cache → retry una volta. L'utente vede tutto normale
   - Diagnostica: `payload-tools.log` righe `think-param(modello): livello`
2. **providers.ts**: Ollama MAI il downgrade openai-fallback (xhigh=max, verificato con probe: l'API Ollama elenca high/medium/low/max/true/false); le mappe stantie vengono sanate a ogni sync
3. **pi-bridge.ts**: la cache è AUTOREVOLE sulla mappa runtime/frontend (log thinking-caps-applied)

**Probe dei 5 modelli Ollama reasoning (tutti max=max)**: glm-5.3-flash:cloud, glm-5.3:cloud, qwen3.8:27b-mlx, deepseek-v4-flash:0731-cloud, kimi-k3:cloud. Script: /tmp/test-thinking-caps.ts (probe con valore invalido → l'errore elenca i livelli ammessi → cache col massimo; costo zero).

**Verifica live post-install**: glm-5.3-flash:cloud → "max", glm-5.3:cloud → "max" (payload-tools.log). Il falso "high" di glm-5.3:cloud è STORIA.

**Verità end-to-end del LOG (29 ago, commit b3c4835d + cleanup 5a5278d7)**: `#translateThinkingForModel` (mappa models.json + caps sondate, cache mtime) applicato ai 3 log agent_llm_config, alla history #mapMessage, al done payload e alle delegations → il LogPanel ora mostra "Effort sent to model: Max" e il footer del messaggio mostra il livello REALE (Max/High/Medium/Low; On per i binari; Off) invece di "On" generico. Verificato live post-install: agent_llm_config translated=max + think-param vendor=max per glm-5.3:cloud. Cleanup: 55 file temp bun-build (~GB) rimossi da disco, il 63MB accidentalmente committato rimosso dal repo, pattern gitignored.

**Per provider nuovi/sconosciuti**: prima chiamata → self-heal insegna i livelli validi dall'eventuale errore → cache → per sempre corretto. Formati gestiti: Ollama enum (max), OpenAI reasoning_effort, OpenRouter reasoning.effort, string-thinking, zai/qwen enable_thinking (binari → true al posto del max).

---

## B4 — PROCESS POOL ✅ COMPLETATO E TESTATO SUL CAMPO (21 ago 2026)

**Obiettivo**: 100-1000 sessioni fluide (mai timeout). RAGGIUNTO.

**Architettura finale**:
- N processi sidecar (default AUTO = min(cores,16)), spawn LAZY + shrink (idle 5min → spento) + watchdog (niente orfani)
- Il FRONTEND si connette DIRETTAMENTE ai worker (workerPort nelle sessioni) per lo streaming → il router gestisce solo le RPC
- L'Expert (QUINKI_ROLE=expert) NON attiva MAI il pool (guard dedicato)
- Settings: NESSUN campo (sempre Auto, come richiesto dall'utente)

**Enduro reale (app installata)**: 100 sessioni in parallelo → 100/100 completate, 0 errori, 0 timeout RPC (probe 1ms), main a ~180MB stabile, ~5-6GB fisici totali con 100 contesti attivi, RAM a riposo ~300MB dopo shrink.

**Recovery verificata sul campo**: marker `pending-turns-recovered: 1/5/10` nei log — i turni interrotti vengono ripresi al boot/respawn da soli.

**Obiettivo**: isolare le sessioni in N processi (stesso binario sidecar) così 100-1000 sessioni si usano fluidamente (mai timeout).

**Stato (21 ago sera)**: studio + POC + implementazione passo 1-5 completati e testati in laboratorio:
- `QUINKI_POOL_SIZE/INDEX` + hash djb2 + filtro per-gruppo (in pi-bridge)
- `pool-router.ts`: main spawna N-1 child, instrada RPC per-sessione, forward eventi, respawn, watchdog parent
- Fix ricorsione `sidecarRole`, lock dedicati, child senza scheduler/LH/executor
- **Test**: 4 processi, 100 RPC concorrenti 0 timeout (10ms), 200 RPC 273ms, kill main → child escono, main vede tutte le sessioni

**COMPLETATO (21 ago sera)**: installato e TESTATO con Enduro reale: 100 sessioni in streaming → 0 errori, 0 timeout RPC (probe 1ms), tutte completate in 35s, main a 182MB stabile. Architettura finale: frontend → connessione DIRETTA ai worker (workerPort) per lo streaming; router solo RPC.

**Obiettivo**: isolare le sessioni in worker thread (N = cores) così 100-1000 sessioni si usano fluidamente (mai timeout), accettando che la RAM scalì con le sessioni (è il costo del lavoro — ok su Mac potente).

- **Studio**: `docs/A2.5b-CONCORRENZA-STUDIO.md` (come fanno gli altri: processo-per-sessione; noi: worker pool perché unica app).
- **Quando**: DOPO A4 (Marketplace) — o subito se prioritario.
- **Difficoltà**: ALTA (SDK non thread-safe, file condivisi, delegazioni). Tempo: settimane.
- **Da progettare bene** con test incrementali (2 worker → N).

---

## A2.5 ENDURO TEST — RISULTATI FASE ATTIVA (21 ago 2026) ✅

Eseguito sulla main (Expert mai toccata, monitorata in parallelo). Base: `09f003de`.

| Test | Risultato | Verdetto |
|---|---|---|
| T1 Baseline idle | main 306MB (sessione attiva), Expert 264-282MB | ✅ |
| T2 Open/close ×50 | heap stabile (229→31MB, sweep LRU) | ✅ |
| T3 Streaming ×3 | peak 685MB → 103MB dopo forceGC | ✅ |
| T5 Churn ×40 | Δ heap +0.8MB | ✅ no leak |
| T7 Recovery ×5 | 0 falsi ripristini | ✅ |
| T8 Expert stamina | 264→278MB stabile durante i test | ✅ no leak condiviso |
| T9 Disk | crescita normale | ✅ |

**Stress reale (100 sessioni parallele multi-step)**: picco **5.2GB RSS**, sidecar SATURO (RPC in timeout) → dopo restart torna a **273MB** (nessun leak). **Finding**: con ~100 stream concorrenti il sidecar satura (limite del caso estremo, non un bug di memoria).

**Pulizia**: 100 sessioni di test rimosse; le sessioni utente (4) intatte. Nota: il json veniva ri-scritto dal sidecar che adotta dir orfane — pulizia corretta = `rm -rf` a sidecar ferma + json pulito.

**Rimane**: soak 24h opzionale (validazione lunga) — i test attivi confermano stabilità e zero leak.

---

## FIX COMPLETIVI 21 ago 2026 (emersi durante Enduro + sessioni utente)

| Fix | Dettaglio |
|---|---|
| **Ruolo Expert COMPLETO** | l'Expert sidecar carica e vede SOLO `__app_expert__` (#load + getSessionsFromFile + getSessionsWithFolder filtrati) — non tocca MAI le sessioni della main. Testato: QUINKI_ROLE=expert → 1 sessione |
| **Titolo sessione** | `__app_expert__` rinominata "App Expert" (era "ciao") |
| **Quit dal dock macOS** | fix bug Tauri #13778 (ExitRequested non scatta) — intercettato applicationShouldTerminate via delegate NSApplication (crate objc). Cmd+Q, dock, menu Apple → tutti col modale |
| **Stale streaming buffer** | pulizia (done===true) — niente più "Running" falso |
| **Saturazione a ~100 stream** | 100 sessioni parallele → sidecar saturato (CPU single-thread), RPC timeout. **RISOLTO da B4 (process pool)** — vedi sezione B4 sotto |

---

## B0 Performance/RAM — COMPLETO (20 Aug 2026) ✅

Obiettivo: sidecar main 1-1.7GB → <400MB; Expert 2.1GB → <600MB.

| Fix | Commit | Risultato |
|---|---|---|
| B0.1 Monitoring (getHeapStats + log 60s + agent_end) | 5d7b9402 | osservabilità |
| B0.2 Fix leak (remove/dispose + guardie) | 5d7c9402 | heap torna a baseline |
| B0.3 getHistory tail (6000 righe, 8MB) | b0c3 | picco +466MB→+91MB, 455ms→62ms |
| B0.4 --smol (BUN_OPTIONS) | 5c29b477 | GC più frequente |
| B0.5 LRU sessioni (max 5 attive, idle 15min, event-based) | 5c29b477 | heap piatto 1→100 sessioni (22→26MB) |
| B0.6 Misura finale | ✅ | heap 26MB, RSS 255MB (fresco) |
| B0.8 Virtualizzazione NATIVA (content-visibility) + finestra 50 + paginazione | ✅ | DOM ok; scroll infinito (rimosso cap 300) |
| B0.7 Truncate contenuti | ❌ ANNULLATO (scelta utente) | mai troncare una bolla |
| B0.9 Streaming batching / search sidecar | ❌ RIFIUTATO/revertito | ricerca tornata locale (finestra) |
| **Gigacache disattivata** (`GIGACACHE_ENABLED=0`) | 471cc41c | footprint 600MB→**92-110MB** (issue bun #28318) |
| **forceGC** (`Bun.gc(true)` dopo deattivazione/agent_end) | 2d0183b4 | slab IOAccelerator rilasciati all'OS (test: 213→10MB) |
| **Owner-lock main/Expert** (role esplicito + PID lock + recovery/executor esclusivi) | 90b68b8f, 709307b0 | l'Expert NON tocca le sessioni della main; la main NON tocca __app_expert__ se l'Expert è su |
| **Paginazione infinita** (rimosso cap 300) | 616cb033 | scroll su = carica 50 più vecchi, senza limite |
| **Stale streaming buffer cleanup** | de1889ea, bf0c8e61 | sessione completata (done=true) ma col buffer appeso → "Running" falso + RAM trattenuta; pulizia strict done===true (mai tocca turni in streaming) nel sweep + timer 60s |
| **Recovery al boot + niente falsi ripristini** | 09f003de | recovery al boot RIPRISTINATO (A2 H24, riprende turni interrotti) ma SOLO turni davvero interrotti; le sessioni complete non vengono toccate |
| **Anti-ricorsione getHistory→recovery** | ce083f84 | fix stack overflow (la chat non caricava i messaggi) — guardia #onOpenRecoveryTriggered |

**Numeri finali**: main ~203MB totali, Expert ~473MB max (lavorando) / ~90MB a riposo. **Totale entrambe < 800MB** (prima 3.5GB).

---

## EXTRA — 19 ago sera (fuori piano, fatte prima di B0) ✅

Lavoro di stabilizzazione e piccole feature emerse durante la sessione (NON erano nel piano — l'utente le ha chieste strada facendo). Tutto installato e testato su main (`c48a3b00`):

1. **FIX ROOT allegati A3 (regressione)** — il `handleSend` introdotto da A3 passava solo `text` a `props.onSend`, buttando via `opts` (attachments/skillNames/taskClips) → la clip NON compariva più nella bolla e la sezione `ATTACHED FILES` non compariva nel prompt (il file arrivava solo nella cartella). Fix: `props.onSend(text, opts)`.
2. **Fix persistenza notifyMode** — il merge del read-state non era merge-safe per la modalità: il sidecar con lo stato stantio sovrascriveva il cambiamento appena fatto → dopo riavvio la modalità tornava quella vecchia. Fix: aggiunto `notifyModeTs` (timestamp) — vince la modalità col timestamp più recente in save e sync.
3. **Allegati nella welcome chat** — prima non si poteva allegare un file in una chat non ancora iniziata (nessuna sessione → sessionKey vuoto). Fix: la sessione viene creata **on-demand al momento dell'attach** (`onEnsureSession` via `createSession` sidecar, `resolveSessionKey` nel Composer), e il primo invio usa la STESSA sessione (niente doppia creazione). Funziona con graffetta, drag&drop e ri-attach.
4. **Agente di default "Quinki"** — nuovo agente seedato (`quinki`, assistente generale), **ogni nuova chat nasce con ALMENO un agente** (createSession assegna il default da `defaultAgentId` nel config globale, fallback `quinki`), sezione **"Default agent for new chats"** in Agents (toggle + menu custom viewport-aware, stile menu della app), la welcome segue il default in tempo reale (ref `_appliedDefault`), Quinki protetto (niente rename/delete).
5. **Guardia "almeno 1 agente"** — non si può rimuovere l'ultimo agente da una chat (né in multiselezione rimuovere tutti): **modale centrato** con Cancel/OK (stile degli altri modali), in main ed Expert.
6. **Banner sync Expert migliorato** — il vecchio check confrontava il bundle Expert vs quello registrato all'avvio (mai segnale quando la main si aggiornava). Nuovo check: confronta anche `version.txt` **main vs Expert** (stabile rispetto alla firma) → il banner "Update available. Sync and restart to apply." appare **automaticamente** quando la main è più nuova. (Nota: serve UN sync manuale per portare il nuovo binario nell'Expert.)
7. **Fix crash Long Horizon** (`st2.units is undefined`) — stato.json troncato (`test-lh-skip-session`) → `#loadAll` normalizza i campi (units/currentIdx/status) + guardie ovunque → il tick non crasha più a ogni ciclo.
8. **Agents tab restyle** — **sidebar a sinistra come la tab impostazioni** (full-height, FUORI dal maxWidth, solo hover bg `var(--q-hover)` + testo accent tab, click → scroll LISCIO con `scrollTo({behavior:'smooth'})`, nessun highlight persistente); **sezioni Skill/MCP/Tool standalone** (rimossa la sezione wrapper "Installed resources"); sezioni **più lunghe con cap** (Your agents 65vh, risorse 55vh); bottoni **Install skill a sinistra / Create skill a destra** (gap 6px); icona heading neutra.
9. **Fix TDZ** (`Cannot access before initialization`) — `welcomeKey` dichiarata PRIMA di `handleSend`.

---

## Visione breve
Quinki è un'app nativa macOS (Tauri 2 + React 19 + sidecar compilato, niente Node) per controllare agenti AI Pi SDK. Due app separate: main + App Expert. Autocontenuta, offline, con aggiornamenti manuali da Settings.

Oggi è **già una v1 solida e pubblicabile** come esperienza. Mancano i due differenziatori competitivi (MCP + H24 autonomo) e i passi di pubblicazione.

---

## FASE A — Funzionalità fondamentali (prima del lancio) 🎯

### A1 — MCP support — ✅ FATTO E TESTATO (9 ago 2026)
Parità competitiva con OpenClaw/Hermes/Claude Desktop. **Completato e verificato end-to-end.**
- **3 tipi di server installabili dalla UI** (identica a Skill/Tool, sezione MCP nelle risorse):
  - **Package (npm)** — install con Bun interno, descrizione dal registro npm, args multi-riga
  - **Command** — comando esterno esistente (tilde espansa, no ENOENT)
  - **URL (remote)** — server HTTP remoto
- **Nome automatico** dalla sorgente; **Uninstall totale** (cartella+config+rimozione da agenti+planModeMcp).
- **Per-agente**: Add MCP (solo dagli installati) / rimozione; **Plan mode**: `planModeMcp` globale (in Plan solo i server abilitati → l'agente NON vede gli MCP non abilitati; in Build tutti).
- **Sidecar**: client MCP stdio+HTTP, `tools/list` → registrazione come customTools dell'agente (stesso meccanismo di skill/delegate), `tools/call` → risultato in chat. **Log system_prompt completo** (activeTools con nome/descrizione/schema, MCP inclusi).
- **Auto-diff sicuro a metà sessione**: aggiungere/togliere un MCP dall'agente si applica **dal messaggio successivo** (refresh dei customTools della sessione viva, niente ricreazione, history intatta).
- **Testati**: filesystem (`list_directory` su /tmp), `add` (command), `get_time` (URL) — tutti chiamati e funzionanti; Plan/Build filtro verificato (plan=7 tool, build=25); delega orchestrator ✓ (i delegati ricevono i LORO tool + modalità).
- Menu destro custom nei campi (Copy/Paste/Cut/Select All) ripristinato con paste funzionante (plugin clipboard).

### A2 — H24 Autonomo ("la cosa fondamentale") — FONDAMENTA IMPLEMENTATE + NUOVO STRATO FUNZIONALE (design completo integrato)
> **Questo è il documento di design COMPLETO dell'A2** (sostituisce lo studio `a2-h24-studio.md`, eliminato il 14 ago 2026). Fondamenta implementate (9-14 ago) + nuovo strato funzionale (memoria/contesto) progettato il 14 ago. Da rileggere per ogni implementazione.

---

#### A2-PARTE 1 — LE FONDAMENTA (studio A2, 9 ago 2026) — IN GRAN PARTE IMPLEMENTATE ✅

**Principio architetturale**: lo stato vive su disco (`~/.quinki`), la RAM è solo una cache. Il Mac può morire in qualsiasi istante. Niente Node.js (sidecar compilato bun); Pi SDK vendorizzato riusato (stessa meccanica sendMessage/delega/MCP); due sidecar sullo stesso `~/.quinki` merge-safe o owner-locked; nessun timeout (gli errori emergono).

**Modello dati su disco:**
```
~/.quinki/
├── schedules.json                 # schedule (NON cron!)
├── executions/
│   └── <execution_id>/            # id = ex_<ts>_<rand>
│       ├── execution.json         # meta + stato + heartbeat + owner + progressNote
│       ├── events.jsonl           # event log append-only (tool, errori, fasi) = LA TIMELINE
│       ├── transcript.jsonl       # stessa struttura delle chat (riuso Pi SDK)
│       ├── checkpoint.json        # puntatore di resume (ultimo msg, stato)
│       └── owner.lock             # lease del sidecar che lo sta eseguendo
└── (sessions/, quinki-sessions.json, agents/, skills/, …)
```
`execution.json` porta già: id, scheduleId, title, agentIds, workingDir, mode, **model**, **thinkingLevel**, status, timestamps, lastHeartbeat, progressNote, keepAwake, error, ownerPid, **owner**.
`events.jsonl` (append-only): execution_started, message_started/delta, tool_started/result (con input/outputPreview), delegation_started/result, execution_completed/failed. **È la fonte per la UI live e per il checkpoint.**

**Macchina a stati:**
```
queued → running ⇄ interrupted (crash/sleep) → resumable → running (riprende)
       ↘ completed / failed / cancelled (utente) / paused (utente)
```
- `running` aggiorna `lastHeartbeat` ogni ~10s (scrittura atomica tmp+rename); heartbeat vecchio (>60s) → `interrupted` (al boot o su tick periodico).
- `interrupted` → recovery → `resumable` (o `failed` se irrecuperabile).
- **stop() → interrupted (riprendibile); cancel() → cancelled.**

**Scheduler (schedule object, NON cron):** `schedules.json` con `when: {type: once|daily|weekly|monthly, at, daysOfWeek, dayOfMonth, timezone, date}`, `enabled`, `catchUp`, `nextFireAt`, `sourceSession` (chat da cui è nata), `model?`, `thinkingLevel?`. Loop tick 30-60s → crea execution `queued`.
- **Catch-up: SI FA COMUNQUE, ANCHE IN RITARDO** (deciso) — mai perso in silenzio.

**Motore di esecuzione**: Opzione A (sessione headless riusando il path esistente) — scelta e implementata. *(Raffinata dal nuovo strato: esecuzione = fork della chat, risultato nella timeline, non nel flusso.)*

**Checkpoint e recovery:**
- Livello 1 (v1, IMPLEMENTATO) — resume semantico: si ricarica la sessione dal transcript, si ri-applica mode/model/tools/MCP, si invia messaggio di continuazione *"Sei stato interrotto... se un'azione è mostrata come avviata ma senza risultato, verifica prima di ripeterla"*. Non byte-exact, robusto.
- Livello 2 (v2, futuro) — resume deterministico dei tool in-flight (auto-diff su tool_started senza tool_result). Rimandato.
- Recovery Manager al boot: scan → running+heartbeat vecchio → interrupted → **AUTORIPRENDI** (deciso) con verifica anti-doppione (max 3 riprese) → ricalcola nextFireAt + catch-up → log verificabile.

**Concorrenza**: DECISO PARALLELO. Spike tecnico FATTO (2 task in parallelo testate ✅).

**Keep Awake**: `caffeinate` con contatore (1 processo finché almeno 1 execution keepAwake è running). MacBook coperchio chiuso → recovery/cloud; Mac Mini headless = target H24.

**Idempotency v1**: prompt di resume elenca "tool startati senza risultato" → verifica prima di ripetere. Convenzione `x-quinki-run:<executionId>:<attempt>` per tool a effetto. Niente dedup automatico generico.

**Proprietà (owner)**: entrambe le app hanno un motore; ogni compito ha `owner = main | expert` alla creazione → ognuna esegue SOLO i suoi (niente lock wars). Compiti app-expert girano SEMPRE nell'app esterna (deve poter ricostruire la main senza uccidersi); se l'Expert è spenta e scatta un suo compito, la main la apre.

**Frontend (tab Agents Tasks)**: gruppi per stato con toggle collassabili + Board + view dinamiche con filtri + ricerca + persistenze (ui-state.json). Azioni: create, edit/delete, Run Now, Stop/Resume, Cancel, Retry.

**RPC/WS**: listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, listExecutions, getExecution, getExecutionEvents, stopExecution, cancelExecution, resumeExecution, recoverExecutions, deleteExecution, saveUiState, getUiState. Eventi WS: execution_update, schedule_update.

---

#### A2-PARTE 2 — IL NUOVO STRATO FUNZIONALE (memoria e contesto — progettato 14 ago 2026)

**Il problema che risolve**: lo studio dava esecuzione/storage/recovery ma NON la continuità semantica: (1) la chat in cui scheduli è cieca; (2) nessuno verifica che il lavoro sia stato davvero fatto; (3) il contesto della chat non è affidabile (compaction al 90% → 1%); (4) le task in sequenza non ricordano le precedenti e i token finiscono; (5) chi riprende dopo la compaction in una long-horizon?; (6) le ricorrenti non consegnano il report.

**REGOLA D'ORO**: il contesto della conversazione NON è la memoria delle task. La memoria vive nei FILE (handoff + plan); l'esecuzione usa contesto limitato e ricostruito a ogni unità.

**File HANDOFF (memoria per chat)** — `~/.quinki/handoffs/<chat-key>/handoff.md`:
- Struttura scritta dal CODICE (engine, deterministico): intestazione, record per task (id, titolo, stato, verifica, modello), sezione risultato = report finale VERBATIM (copiato dall'engine).
- Contenuto scritto dal MODELLO: solo testo libero (riassunto, prompt di scheduling).
- **Perché**: un modello scarso non può rompere la struttura (la scrive il codice); al massimo scrive un report peggiore.

**File PLAN (source of truth per il loop)**: lista unità con stato (`- [x] U1 ...`). Il motore legge il piano → esegue → segna → continua. Dopo crash/compaction rilegge il piano e riparte.

**ENGINE-OWNED LOOP (il cuore)**:
```
1. legge il PIANO → prossima unità
2. costruisce il prompt (contesto LIMITATO: piano + handoff + working dir)
3. il MODELLO esegue QUELLA unità (bounded)
4. risultato + verifica oggettiva
5. il MOTORE scrive nell'handoff (deterministico) e segna il piano
6. se vicino al limite → COMPATTA ORA (sicuro: stato già nei file)
7. altre unità? → torna al punto 1
```
- **Compaction tra le unità, mai durante.** Il motore controlla i token dopo ogni unità (~80%).
- **Chi riprende dopo la compaction? Il motore, sempre** — legge il piano, lancia la successiva. Il modello non deve ricordarsi nulla.
- **Il modello NON controlla la compaction**: se a metà unità gli serve contesto, legge il file (escape hatch = readFile). I file sono la memoria.
- **Perché**: è il motivo per cui gli agenti tipo OpenClaw/Hermes falliscono — danno al modello il loop e la compaction; qui il motore decide sempre il "cosa succede dopo".

**Esecuzione: task singole vs Long-Horizon:**
- Task singola/sequenza → **temp session per task**: prompt + riassunto ultime 1-3 task dall'handoff + riferimento al file + working dir. Isolamento, contesto limitato, verifica.
- **Long-Horizon = TERZA MODALITÀ (dopo Plan e Build)** — CONFERMATA: sessione persistente + compaction ai checkpoint + piano/handoff. Lavora ore/giorni senza supervisione, verificabile.

**Verifica oggettiva**: ogni task ha la prova nel prompt ("crea X → verifica che esista", "esegui i test → verifica che passino"). → `completed` (verificato) / `failed` (non verificato). La QUALITÀ la giudica l'utente; lui verifica i fatti. Un `failed` può auto-generare una task di correzione (con fallback manuale).

**Canali di intervento (STOP / STEER / RESUME)**: la temp session non è una chat. STOP (interrompi subito, interrupted), STEER (direttiva iniettata mentre gira: l'engine abortisce, inietta, riprende), RESUME (riparte dall'esatto punto). **Blocco: per SINGOLA task** (disabilita schedule, STOP sul task) — DECISO: NIENTE kill switch globale. Tu sei sempre il capo.

**Model + Thinking per task** — DECISO (14 ago): **NIENTE default separato "compiti automatici"**. Solo possibilità **su richiesta**: (a) al momento della schedulazione (tool `schedule_task` può ricevere "usa modello X e thinking Y"), (b) nel database — **UNA SOLA colonna "Model · Thinking"** (cella "modello · thinking", clic → menu con i due selettori affiancati, come il header chat; modificabile anche dopo). Risoluzione: schedule → sessione → default dell'app. Task banali = modello locale (zero credito); difficili = modello grosso. Tu decidi, per task, mai globale.

---

#### A2-PARTE 3 — LA TIMELINE (parte visiva — decisioni prese)

1. **Niente doppio invio**: i risultati delle task NON entrano nel flusso della chat (inutile con la timeline). Il blocco di consegna nel flusso NON si fa.
2. **Striscia sopra la textbox** — DECISO (14 ago): **VISIBILE SOLO SE CI SONO TASK ATTIVE PER QUELLA SESSIONE** (non sempre presente). Stessa larghezza della textbox, badge numerico (in coda / in corso / risultato pronto). Clic → si espande verso l'alto fino alla headline, occupando la chat area.
3. **Cronologia read-only**: le task di quella chat renderizzate come una chat normale (thinking espandibile, tool call, risultato finale) ma NON scrivibile. **Live**: si aggiorna in tempo reale da `events.jsonl` — anche durante una long-horizon, senza aspettare.
4. **Persistenza per chat**: ricorda se l'avevi aperta o chiusa (per le chat "solo-report" la tieni aperta e basta).
5. **Azioni dalla timeline**: "Apri in chat" (discutine), "Invia in chat" (clip → entra nel contesto solo a quel punto), STOP/STEER/RESUME sul task, **"+ next task"** (fallback catena — CONFERMATO).
6. **Contesto su richiesta**: i risultati non vengono caricati nel contesto di default (niente spreco). L'agente sa di aver schedulato (è nella conversazione). Il risultato entra nel contesto su richiesta: clip/messaggio, oppure tool `readExecution` ("cosa ha fatto il task X?").
7. **I PONTI CHAT ↔ TASK (riferimento 14 ago)**: chat e timeline NON sono due mondi separati — sono due viste dello stesso progetto. Ponti:
   - **Clip**: selezioni un task risultato dalla timeline → lo mandi nella chat come messaggio → entra nel contesto → lo discuti (per un singolo risultato).
   - **Tool agente `getTaskHistory`/`readHandoff`**: l'agente nella chat normale può LEGGERE la cronologia dei task (tutta, singolo task, ultimi N, ricerca) **senza iniettarla nel contesto** (paginazione/sezioni) — per avere più contesto quando serve ("cosa hanno fatto i task di questa settimana?" → risponde IN CHAT).
   - **Domanda diretta**: tu chiedi in chat, lui legge, risponde in chat.
   - **Regola**: default = niente iniettato; su richiesta = si accede (clip per discutere, tool per leggere). Il contesto si accede, non si riempie.
   - **SUPERFICIE TOOL DELL'AGENTE (on demand, in chat o nelle esecuzioni)**:
     - `listTasks`/`getTaskStatus` → "a che punto sono i task" (stato di tutte le task della sessione).
     - `getTaskResult(id)` → "che ne pensi del risultato del task X?" (risultato completo con thinking/tool/verifica).
     - `readHandoff()` → cronologia intera, o sezioni, o ultimi N, o ricerca.
     - `schedule_task`/`createSchedule` → "che task possiamo schedulare ora?" (già esistente).
     - In **long-horizon**: l'accesso è AUTOMATICO (il motore legge piano+handoff tra le unità); dentro l'unità l'agente usa gli stessi tool se gli serve più contesto.
   - **CANALI DI CONSEGNA (futuro, estensibile)**: il risultato del task è prodotto UNA volta (esecuzione + handoff/timeline = storage canonico); la CONSEGNA è un layer separato con canali: chat della sessione (già previsto: clip), tab dedicata "Report", email, WhatsApp/Telegram, sito web/webhook. Ogni canale = piccola estensione (si collega al marketplace A4). Alla schedulazione si sceglie il canale ("alla fine manda il riassunto anche nella chat").

---

#### A2-PARTE 4 — R-INGEGNERIZZAZIONE VIEW TAB — DECISO (14 ago): SIDEBAR DELLE VIEW
L'attuale riga di tab non scala (10-50 view = disastro). **DECISIONE: sidebar delle view** (non selettore a tendina): pannello laterale con l'elenco delle view, creazione, rename, delete (modale di conferma già fatto). Da progettare in dettaglio all'implementazione. Le freccette prev/next (che si fermano ai bordi) restano.

---

#### A2-PARTE 5 — DECISIONI CONSOLIDATE (tabella completa)
| # | Decisione | Razionale |
|---|---|---|
| D1 | Stato su disco, RAM = cache | Il Mac può morire in qualsiasi istante |
| D2 | Owner = main | expert alla creazione | Niente lock wars; l'Expert deve poter ricostruire la main |
| D3 | Concorrenza PARALLELA | Spike fatto ✅ |
| D4 | Auto-resume dopo crash | "Riprende da solo" è il criterio #2; con verifica anti-doppione |
| D5 | Catch-up: si fa comunque, anche in ritardo | Mai perso in silenzio |
| D6 | Idempotency v1 guidata dal modello | Resume non byte-exact; verifica prima di ripetere |
| D7 | Task = fork della chat (contesto), NON nel flusso | La chat resta pulita; il contesto si ricostruisce da file |
| D8 | Memoria = handoff + plan (file), mai contesto live | Compaction, catene, token: il contesto live è fragile |
| D9 | Loop del MOTORE, non del modello | È il motivo per cui OpenClaw/Hermes falliscono |
| D10 | Compaction tra unità, mai durante | Lo stato è già nei file ai checkpoint → sicura |
| D11 | Il modello non controlla la compaction; legge i file | Escape hatch = readFile |
| D12 | Verifica oggettiva → completed/failed | "Fatto davvero" ≠ "finito senza errori"; qualità = utente |
| D13 | STOP / STEER / RESUME per SINGOLA task (no kill switch globale) | Tu sei il capo; la temp session non è una chat |
| D14 | Model/thinking per task SU RICHIESTA, niente default globale | Task banali = modello locale; difficili = modello grosso; decidi tu |
| D15 | Timeline read-only, visibile solo con task attive, niente doppio invio | Un solo posto per i risultati; niente caos nel flusso |
| D16 | Contesto su richiesta: clip (iniettare un risultato) + tool agente getTaskHistory/readHandoff (leggere la cronologia senza iniettarla) + domanda diretta in chat | La chat è il luogo della discussione; la timeline è l'archivio; si accede al contesto, non lo si riempie |
| D17 | Persistenza aperto/chiuso per chat | Per le chat solo-report la timeline resta aperta |
| D18 | Notifiche → fase A3 separata (differita) | Argomento a sé (macOS + badge + permessi) |
| D19 | View tab: SIDEBAR (r-ingegnerizzare ORA) | Con 10-50 view la riga attuale è un disastro |
| D20 | Marketplace PRIMA della pubblicazione (A4) | Decisione 14 ago: si fa prima di B/C |
| D21 | Long-Horizon = terza modalità (Plan/Build/Long-Horizon) | CONFERMATA |
| D22 | Recovery test reale → ULTIMA cosa (dopo tutto il resto) | Non blocca l'implementazione |

---

#### A2-PARTE 6 — ORDINE DI IMPLEMENTAZIONE (da qui in poi)
- **FATTO**: A2.1 execution engine · A2.2 scheduler+catch-up · A2.3 recovery+keepAwake+idempotency · A2.4 Agents Tasks DB · concorrenza parallela · owner main/expert · ui-state · freccette view · modale delete · **A2.6 SIDEBAR DELLE VIEW ✅ (14 ago 2026)** — sidebar stile chat (flottante, ridimensionabile, drag&drop con DragOverlay + segnalino, menu contestuale Rename/Select/Delete, multiselezione, filtri inline intelligenti, persistenza filtri per view in ui-state.json).
- **DA FARE (in ordine):**
  1. ~~**R-ingegnerizzazione view tab → SIDEBAR delle view**~~ — ✅ FATTO (A2.6)
  2. **Engine col nuovo strato**: handoff + plan + temp session con contesto limitato + verifica + model/thinking per esecuzione
  3. **Timeline UI**: striscia sopra la textbox (visibile solo con task attive) → pannello read-only espandibile (live), persistenza aperto/chiuso per chat
  4. **Database**: colonne Model·Thinking, clic task → timeline, "apri in chat", "+" con chat opzionale + auto-creazione sessione
  5. **Clip "invia in chat"** + tool `readExecution`
  6. **Long-Horizon mode** (terza modalità: piano + checkpoint + verifica)
  7. **Recovery test reale** (kill a metà → riapri → riparte dall'esatto punto) — ULTIMA cosa
  8. **A2.5 Enduro test** (24-48h, due app conviventi, disk budget)

---

### A2.11b — PERMESSI PERSISTENTI — ✅ FATTO (17 ago 2026)
> **FINALIZZATO**: sezione unificata "App Permissions" nelle Impostazioni (macOS Permissions + Authorized Folders) con sottosezioni stile Notion. Toggle macOS = icone rotellina che aprono la schermata SPECIFICA di System Settings (la rilevazione TCC è inaffidabile — i toggle non tracciavano la realtà). Authorized Folders a livello APP (funziona davvero): toggle "Allow all folders" (`readFilesAnywhere`/`writeFilesAnywhere`), lista cartelle, "Add folder" con selettore nativo, cestino + modale di conferma. Sidebar ordinata (App Permissions dopo App Expert).

### A3 — Notifiche (in-app + macOS) — ✅ COMPLETO (19 ago 2026)
> **Design SEMPLIFICATO e approvato dall'utente (19 ago 2026) + implementazione COMPLETA + fix.**

**Cosa è stato REALMENTE implementato (19 ago 2026):**
- **Design semplificato a 2 MODALITÀ per chat** (l'utente ha rifiutato le 4): 🔕 **Muted** (solo badge in-app, niente pop-up) / 🔔 **All notifications** (badge + pop-up SEMPRE, anche con chat aperta, per messaggi E task). Default configurabile in Settings (persistente in `quinki-settings.json`). Niente spunta nel menu (l'icona mostra la selezione). Legacy `messages-only`/`tasks-only` → mappati ad `all`.
- **Badge**: sfondo bianco, numero nero. Le task NON hanno unread separato: contano come MESSAGGI via `lastReadTs`.
- **Sidecar**: `read-state.json` (per chat: `lastReadTs`, `lastReadTaskTs`, `notifyMode`) + `notifications.jsonl`; RPC (`getReadState`, `setReadState`, `setNotifyMode`, `getUnreadCounts`, `listNotifications`, `markAllNotificationsRead`, `getAllReadStates`, default notify mode); eventi WS `notification` + `read_state_changed`. **FIX ROOT**: il broadcast notifiche era settato PRIMA della creazione di `piBridge` (null) → gli eventi non arrivavano MAI; wiring spostato DOPO → badge + pop-up funzionano.
- **Mark-read**: all'apertura (dopo baseline → il marker resta finché esci), mark-on-exit, periodico 5s (persistenza robusta anche se l'app viene uccisa), all'invio di un messaggio (tutto letto in tempo reale), streaming-end (SOLO se sei ancora nella chat → se esci prima che finisca la risposta resta UNREAD). **FIX**: niente mark-read DURANTE lo streaming (il timestamp dei messaggi è l'inizio turno → un mark copriva la risposta non finita).
- **Marker "unread messages below"**: preciso (solo unread PRIMA dell'apertura, bound `openTs`), include le TASK (`endedAt > lastReadTs`), auto-scroll al primo non letto una volta per sessione.
- **Guardie `__app_expert__` corrette**: le salta SOLO la main; l'app Expert la marca letta normalmente (prima non veniva mai marcata).
- **Merge read-state main↔Expert**: due sidecar condividono `read-state.json` e si sovrascrivevano → i badge stale ricomparivano alla reinstall. Fix: **merge-on-save** (max lastReadTs per chat) + sync ogni 10s → i badge NON ricompaiono più.
- **Rust**: `send_notification` con **UNUserNotificationCenter REALE** + `sessionKey` in `userInfo`; **richiesta permesso REALE** (il plugin era uno stub) + richiesta automatica al primo avvio; **delegate** con `willPresent` (mostra anche in primo piano) + `didReceive` → **CLICK sulla notifica apre direttamente la chat** (focus + `switch-session`); polling flag file per l'Expert.
- **Recovery turni (chat normali) — EVENT-BASED, niente timer**: `marker is not defined` fixato (il recovery crasHava a ogni marker → l'autoprompt non arrivava MAI); turno ATTIVO = mai toccare; turno finito SENZA completamento (errore/abort, send fallita) → autoprompt immediato; boot recovery col marker (turno interrotto da crash → ri-prompt al riavvio); `toolUse` → non interrompere; STOP → mai autoprompt; guardia anti-doppio. Le TASK hanno il loro recovery separato (executor: heartbeat ogni 5s dal processo vivo → mai interrotte se lavorano; stale > 120s → interrupted → auto-resume al riavvio).

**Cosa genera notifiche**: (1) ogni risposta (messaggio assistant) che arriva in una chat; (2) **solo task COMPLETATE** (niente started/failed/stopped).

**Badge e conteggi**:
- **Sidebar chat row**: badge = messaggi non letti + task non lette (totale).
- **Barra task sopra la textbox**: sezione `x scheduled · y executed · N task unread` (adattata all'esistente).
- **Agents Tasks**: campanella in alto → storico notifiche task completate → "Mark all read" (azzera i conteggi task di tutte le chat).

**Meccanismo letto/non letto — AUTOMATICO ma NON in tempo reale**:
- Il marker NON si sposta su ogni singolo messaggio mentre leggi.
- **Si sposta quando ESCONO dalla chat**: all'uscita calcolo l'ultimo messaggio davvero visto → se restano non letti, il marker si sposta lì (alla prossima apertura parti da lì); se hai letto tutto → conteggio = 0.
- **Apri la chat** → auto-scroll al marker (primo non letto).
- **Segnalibro 📌** (menu destro → "Set bookmark"): si sposta in tempo reale appena lo setto; **non si toglie da solo** (solo manualmente); rende di nuovo visibile la barra unread in quel punto.
- **Stesso meccanismo per la sezione task** quando è aperta (marker task si sposta all'uscita della sezione; segnalibro task in tempo reale).
- **Barra unread nella chat**: colore = accent della tab, testo centrato (es. `——— unread below ———`), sottile.

**Pop-up nativi macOS**:
- Chat: pop-up SOLO se la chat non è silenziata.
- Task: pop-up SOLO se la **chat che le ha generate** non è silenziata (le task seguono la modalità della loro sessione).
- Scatta quando arriva la risposta/task mentre la chat non è aperta (o l'app è in background).

**Le 4 modalità per chat (default: tutta silenziata)**:
| Modalità | Icona | Messaggi pop-up | Task pop-up | Badge |
|---|---|---|---|---|
| Tutta attiva | 🔔 Bell (nuova) | ✅ | ✅ | sempre |
| Solo messaggi | 💬 MessageSquare (esistente) | ✅ | ❌ | sempre |
| Solo task | ✓ Checklist (esistente) | ❌ | ✅ | sempre |
| Tutta silenziata (default) | 🔕 BellOff (nuova) | ❌ | ❌ | sempre |

**Dove si cambia la modalità**:
- **Sidebar**: campanella DENTRO la clip della chat (non esterna) → menu (stessa grafica del menu destro) con le 4 opzioni.
- **Header della chat**: stessa campanella → stesso menu.

**Agents Tasks campanella**: in alto → pannello con tutte le notifiche task (lette + non lette); "Mark all read" → azzera i conteggi task di tutte le chat; sincronizzata con le chat (lettura in una → aggiorna l'altra).

**Permesso macOS notifiche**: è il permesso di SISTEMA (popup macOS "Quinki would like to send you notifications"). In Settings → App Permissions: riga in più con la stessa meccanica delle altre (icona rotellina → apre la schermata specifica di System Settings). Niente nuovo permesso da attivare — solo stato + launcher.

**Storage**:
- `~/.quinki/read-state.json`: per chat `{ lastReadMessageId, lastReadTaskTs, notifyMode }`.
- `~/.quinki/notifications.jsonl`: log notifiche (per la campanella Agents Tasks).
- Il **sidecar** gestisce lo stato (sa quando arrivano messaggi/task).

**Architettura**:
- **Sidecar**: eventi `notification` + `unread_changed` via WS; scrive `notifications.jsonl`.
- **Frontend**: badge real-time, campanella, marker (spostamento all'uscita), segnalibro, auto-scroll.
- **Rust**: `send_notification` (plugin `tauri-plugin-notification`) per i pop-up nativi; polling del file quando la finestra è nascosta (sidecar vivo).

**Icone**: stile tab app (Material Symbols rounded): Bell (nuova), MessageSquare (esistente), Checklist (esistente), BellOff (nuova).

### A4 — MARKETPLACE (ingegnerizzazione + implementazione) — DECISIONE: PRIMA della pubblicazione 🧩
**Decisione (14 ago 2026):** il marketplace si costruisce e si implementa **PRIMA di pubblicare l'app** (invertita la vecchia decisione "post-lancio"). La fase va fatta **prima della FASE B**.

Obiettivo: rendere Quinki estensibile — tab installabili dentro l'app, modello "VS Code". Step:

1. **Extension System core**:
   - Manifest `quinki.config.json` (nome, icona, versione, permessi, entry point).
   - **Sandbox** dell'estensione: iframe isolato / Web Worker (niente accesso diretto al main thread).
   - **Extension API**: API sicure per agenti, sidecar, file (permessi dichiarati nel manifest), event bus.
   - **`@quinki/sdk`** pubblicato su npm (tipi + helper per sviluppare tab).
2. **Tab installabile**: load delle estensioni come tab native, ciclo di vita (install/uninstall/update), isolamento + cleanup memoria.
3. **Marketplace interno all'app**:
   - Bottone **Install** (Home + Settings) → finestra marketplace interno.
   - **Catalogo** iniziale (anche minimale: elenco pacchetti con descrizione/icona).
   - **1-click install da URL o GitHub** (prima del backend centralizzato).
   - **Aggiornamenti** delle estensioni installate.
4. **Home personalizzabile**: drag&drop per riordinare le tab, **pin** delle più usate, sezione marketplace.
5. **Test end-to-end**: install da URL, update, uninstall, isolamento (un'estensione che crasha non tocca l'app).
6. (Post-A4, a catalogo maturo) backend/sito/CDN centralizzato — il catalogo interno intanto funziona da URL.

---

### B0 — OPTIMIZZAZIONE PRESTAZIONI E RAM (DA FARE, PRIMA di B) 🔴
Misurato 9 ago 2026: **l'app UI è leggera** (main ~104MB, expert ~133MB) ma **i sidecar sono enormi**: main **~1GB**, expert **~1.7GB** — ~3GB totali con l'app inattiva. Il carico è nel motore bun + Pi SDK (sessioni con history intere in memoria, log, buffer streaming). Da fare PRIMA del lancio:

1. **Audit RAM sidecar**: profilo bun+Pi SDK; trovare dove vanno i GB (session history, tool results, MCP clients, attachment data, debug log).
2. **Log real-time via push WS** (invece di polling dell'intero dump) + cap memoria del debug log.
3. **Ridurre payload WS** (system_prompt/activeTools nel log con rate/cap).
4. **Memoria sessioni**: strategia per sessioni enormi (cap messaggi caricati, archiviazione, compaction più aggressiva, dispose sessioni inattive).
5. **Test scala: 100 chat / 100 task in parallelo** — misurare RAM, CPU, latenza (non l'abbiamo MAI testato).
6. **WebView**: lazy-load tab, unload finestre nascoste, ridurre polling quando la tab non è visibile.
7. Target: main < 400MB, expert < 400MB a riposo.

---

## FASE B — Rifinitura e solidità ✅ (QUASI COMPLETA, 27 ago 2026)

### FATTO (dettaglio)

1. **Onboarding guidato completo** ✅
   - Trigger al primo clic (non all'avvio forzato), 8 passi: Home → Chat → Settings → Agents → Tasks → Market → Expert → Log
   - Checkbox a destra per segnare i passi; **Resume = navigazione AUTOMATICA** alla tab del passo salvato (l'utente non clicca niente)
   - **Continue = navigazione automatica** alla prossima tab (l'utente clicca solo Continue); Finish → torna in Home
   - **Skip tutorial = MAI più niente** (né tutorial né spiegazioni brevi delle altre tab)
   - Modali onboarding NON si chiudono cliccando fuori (sempre conferma esplicita)
   - Tasto **Tutorial** nella barra in basso della Home (prima del controllo colonne), nel modale Tutorial interrotto: 3 opzioni No/Start over/Resume, tutte partono direttamente
   - Provider consigliati in onboarding: OpenRouter / Ollama
2. **Thinking universale** ✅
   - Regola nel sidecar: `xhigh` = SEMPRE il massimo livello che il provider supporta, per QUALSIASI modello/provider (correzione al volo se la mappa mappa xhigh sotto il max — log `thinking-map-xhigh-fix`)
   - **Default thinking = solo On/Off** (On = sempre il max), usato per le nuove chat; niente "On (xhigh)" da nessuna parte
3. **Expert header** ✅
   - Icona RotateCcw → **modale di scelta** = copia esatta della sezione Settings → App Expert SENZA titolo e descrizione sezione (solo Sync + descrizione + tasto, Rollback + descrizione + tasto, Cancel)
   - **Sync**: stesso identico flusso del rollback (conferma → spinner → completato → Done/Restart) ma chiama `sync_expert_app`
   - **Rollback**: flusso originale intatto (non toccato)
   - **restart_expert_app distingue il chiamante**: dall'EXPERT → kill_backend sincrono + `app.exit(0)` pulito + nohup detached riapre (meccanismo tray Main); dalla MAIN → script esterno chiude/riapre SOLO l'Expert (la Main resta aperta)
   - **Modali Expert sfocati fix**: rimosso `transform: translate(-50%,-50%)` (sfoca su macOS su posizioni a mezzo pixel), centraggio con `inset: 0` + `margin: auto` (pixel interi)
   - Sidebar Settings: icona App Expert = RotateCcw (coerente con Expert header)
4. **Fix completivi della fase B** ✅
   - **Autoscroll**: disabilitato quando l'utente risale (pinnedRef false) — rientra solo se torni in fondo
   - **Banner sync Expert**: version.txt = git hash corrente scritto dall'install (il banner compare a ogni fix); fix del fix (confronto version.txt Main vs Expert)
   - **Dead code removal**: 10 file rimossi (52KB) verificati zero dipendenze (BFS su imports+exports)
   - **Coerenza grafica totale**: search box come AddItemsModal, checkbox come AgentsPanel, tasti accent/danger standard, niente separatori, niente "On (xhigh)"
5. **Market: test utente con repo PRIVATO** ✅ (verificato che gli item spariscono con avviso generico dismissibile)

### RIMANE (per chiudere B)

- **Smoke test utente nuovo** (l'amico): installazione pulita da zero, onboarding, prima chat, provider, market, Expert sync — la app è PRONTA per il test
- **Auto-prompt bubble**: appare solo al reload invece che in tempo reale + posizione errata
- **Sessione `__app_expert__` 124MB**: da archiviare/compattare (housekeeping, non bloccante)
- Limite bun/JSC conosciuto (slab non restituiti) — documentato, non bloccante per il lancio

---

## FASE C — Pubblicazione 📦 (PREPARAZIONE PRIVATA = C0, LANCIO DOPO LO SMOKE TEST)

### ⚠️ PRINCIPIO CONCORDATO (27 ago)
> **Finché lo smoke test con l'amico non è finito (fase B chiusa), NIENTE diventa pubblico.**
> Ma nel frattempo si prepara TUTTO privato: documentazione, licenze, legale, repo aggiornate, sito pronto.
> Al lancio: si apre il rubinetto (DMG release → repo pubbliche → Pages → marketing) in pochi giorni. Dominio: solo se i download crescono.

### C0 — PREPARAZIONE PRIVATA (SI FA ADESSO, tutto resta privato)

**BLOCCO 1 — SICUREZZA ✅ COMPLETATO (27 ago)**
1. **Client Secret OAuth FUORI dal codice ✅ FATTO**: era hardcoded in `sidecar-src/sidecar-ws.ts` → ora letto a runtime da `~/.quinki/oauth.conf` (file locale, fuori dal repo, permessi 600) o da `QUINKI_GH_SECRET` iniettato a build time via `scripts/build-sidecar.sh` (`bun --define`). Repo source PULITO per sempre (verificato: zero occorrenze). Il binario compilato contiene il segreto (necessario per il login 1 clic, non scansionabile da GitHub — standard di settore come VSCode/Slack). System prompt/skill/seed dell'App Expert aggiornati col nuovo comando di build.
   - **Device Flow: OPZIONE FUTURA annotata** (elimina il secret alla radice ma l'utente deve digitare un codice su github.com/login/device — scartato per ora: si vuole il login 1 clic. Rivedere post-lancio se mai servisse).
   - Rischio residuo: impersonificazione dell'app (chi estrae il segreto dal binario può fare un clone che mostra "Quinki" nel consenso OAuth; nessun accesso ai dati utente) → rimedio legale: takedown DMCA/trademark. Standard di settore (VSCode, Slack).
2. **Repo pubblico FRESH (decisione 27 ago)**: NON si carica la storia git attuale. Al lancio: **un solo commit iniziale** ("v1.0") con lo stato attuale del codice; tutta la vecchia storia resta SOLO sul Mac dell'utente come archivio privato. Dal lancio in poi ogni nuovo lavoro entra nella storia pubblica. → NIENTE git filter-repo necessario: il vecchio secret non arriva MAI sul repo pubblico. (Market repo: stesso approccio fresh. Nota: gli hash git cambiano → version.txt riscritto dall'install → nessun problema per il banner sync.)

**BLOCCO 2 — LICENZE E LEGALE ✅ COMPLETATO (28 ago, commit 10543c88 + 99e22a4c + acba1f52)**
- ✅ LICENSE (AGPL-3.0 ufficiale), PRIVACY.md (zero dati, tutto locale, tabella dati→destinazione), TERMS.md (regole market + Safe Harbor DMCA + procedura rimozione), CHANGELOG.md (utente-oriented, parte da 1.0.0-beta.1), CONTRIBUTING.md
- ✅ Codice: campo `license` nel manifest (default MIT; menu MIT/Apache-2.0/CC0-1.0/CC BY 4.0) + checkbox OBBLIGATORIA "I confirm I own this content" nel flusso publish (Publish disabilitato senza conferma)
- ✅ **VERIFICA LEGALE PI SDK (28 ago)**: tutti e 4 i pacchetti vendored (`@earendil-works/pi-agent-core/pi-ai/pi-coding-agent/pi-tui`) sono **MIT** → incorporarli nella app AGPL è legale e NON vincola la monetizzazione (il MIT è permissivo: il loro codice resta MIT, il nostro è AGPL, nessuna contaminazione copyleft). DA FARE al lancio: sezione attribuzione third-party nel README/NOTICE.
- ✅ **VERIFICATION PASS (28 ago, commit 848ca2b3)**: i documenti riletti e confrontati col codice — correzioni: macOS claim (Apple Silicon, senza versione minima non verificabile), 180+ metodi RPC (non ~80). Verificati OK: porte 9182/9183/9184, pool min(cores,16), shrink 5min, compaction 80%, stuck-turn 45s, VirusTotal nel workflow, enduro 100/100, DMG ~35MB, SDK 0.78.0.
- ✅ **DECISIONE VERSIONE**: release pubblica = **1.0.0-beta.1** (i repo vengono RESETTATI alla pubblicazione — la numerazione interna 1.1.x non esiste più; tauri.conf.json + Cargo.toml aggiornati). **BETA, non stable**: tutela le aspettative (no test estesi); la 1.0.0 stable arriva dopo il primo giro di feedback. CHANGELOG utente-oriented con "Known limitations (beta)".
- **Codice app: AGPL-3.0** — nessuno può fare un fork commerciale chiuso; l'utente (detentore copyright) resta libero di monetizzare come vuole (doppia licenza, modello MongoDB). Cambio licenza possibile in futuro per le versioni nuove (le versioni già pubblicate restano AGPL per sempre — regola d'oro: licenza irrevocabile per le release esistenti, libera per le future)
- **Item del market**: campo `license` nel manifest, scelta dall'autore al publish (default MIT; opzioni: MIT / CC0 / CC BY 4.0 / Apache-2.0) + **dichiarazione obbligatoria di avere i diritti** all'upload (riga di testo nel flusso publish — Safe Harbor DMCA, scudo legale per il gestore; standard npm/YouTube/GitHub)
- **Repo market (workflow/docs/infrastruttura): MIT** — vuole essere copiata
- **Sito**: codice MIT, testi **CC BY 4.0**
- **LICENSE** (AGPL-3.0 testo completo), **PRIVACY.md** (nessun dato raccolto da Quinki: tutto locale; chat solo verso i provider scelti dall'utente; GitHub solo per il market), **TERMS.md** (licenza, no warranty, regole market: contenuti legali/copyright, no malware, procedura rimozione)
- GDPR: nessun dato personale raccolto → policy minima sufficiente
- **CHANGELOG.md** + **CONTRIBUTING.md**

**BLOCCO 3 — DOCUMENTAZIONE COMPLETA (APPROCCIO: doc prima, README dopo) — PIANO APPROVATO IN CORSO**
> Principale (28 ago): la documentazione tecnica completa viene PRIMA. Da una documentazione seria (per file, per funzione, con le motivazioni delle scelte) si estraggono i punti di forza per il README (confronto con la documentazione dei competitor) — non il contrario.
- **METODO DI LAVORO (28 ago)**: la documentazione viene scritta DAL CODICE REALE (rilettura file per file — la memoria della conversazione è compressa dalle compaction, il codice è la fonte di verità) + dagli studi in docs/ (B0/A2.5/B4/A4 contengono i PERCHÉ delle scelte) + dai commenti nel codice. Il vecchio ~/Downloads/quinki-docs.md (luglio, epoca Flutter) è stato ELIMINATO — resta il modello di FORMATO (file map, catalogo feature, RPC, config), il contenuto è tutto da riscrivere.
- **3a. `docs/ARCHITECTURE.md`** — overview 3 livelli + flussi principali (send message, streaming, pool, delegations, recovery, market) — adattamento pubblico della mappa esistente
- **`docs/DECISIONS.md` (ADR-style)** — le scelte tecniche e PERCHÉ: perché Tauri (RAM/dimensione vs Electron), perché sidecar bun separato (SDK JS), perché process pool e non worker thread (SDK non thread-safe), perché frontend→worker diretto, perché App Expert è un'APP separata (isolamento), perché WebSocket+JSON-RPC, perché market su GitHub (niente backend), perché fork+PR+auto-merge (niente gatekeeper), perché AGPL, perché universal thinking, perché compaction 80% con BPE, ecc.
- ✅ **FATTI (28 ago, commit 4d2b173d + 852cdffa + 4e60f4c1)**: docs/ARCHITECTURE.md (14KB, scritta dal codice reale), docs/DECISIONS.md (16 decisioni col perché, numeri verificati dagli studi), docs/USER-GUIDE.md (5.9KB), docs/DEVELOPER.md (6.6KB), docs/MARKET.md (3.8KB)
- **3b. `docs/USER-GUIDE.md`** — installazione, permessi, provider, market, App Expert, FAQ
- **3c. `docs/DEVELOPER.md`** — build dal source (script sidecar + secret), architettura file, come creare una tab/skill/agent, struttura sidecar
- **3d. `docs/MARKET.md`** — formato item per le 5 categorie, publish flow, auto-merge, licenze, takedown
- **- **Destinazione**: `docs/` nel repo (Markdown — la stessa sorgente diventa il sito docs stile docs.openclaw.ai alla pubblicazione; il dominio torna quindi sensibile soprattutto per la DOCS)
- ✅ **CLAIM FINALE (28 ago, d2a6e89d)**: per il lancio beta si usa il claim DI FATTO — "AI agents, chats and community-built tools — on your desktop" (README bold + hero sito). "The composable AI desktop" NON si usa ora (prometterebbe una piattaforma tab matura che non c'è ancora — Market quasi-alpha): si adotterà quando la tab platform è solida, post 1.0. Niente promesse di semplicità (comporre = sviluppare con l'App Expert). Claim "maintains itself" RIMOSSO ovunque (README, CHANGELOG, MARKET-REPO-README, sito).
3e. README Quinki** — scritto PER ULTIMO, estratto dalla documentazione: visione, differenze (confronto documentazione vs prodotti concorrenti), quickstart, roadmap pubblica
- ✅ **COMPLETATI (28 ago, commit 525b610f)**: README.md riscritto (tagline "The desktop AI work app that maintains itself", visione tab community, 7 punti di forza da COMPARE, market con nota alpha, roadmap owner, beta disclaimer, licenza AGPL + Pi SDK MIT attribuzione) + docs/MARKET-REPO-README.md (da copiare nel repo market al lancio — rimanda alla doc principale) + docs/RELEASE-CHECKLIST.md (INTERNA: repo fresh orfan-branch, esclusioni docs/ interni, checklist pre-push)
- **3f. README del market repo** — guida publisher + formato + regole
- **3f. Pulizia repo per la pubblicazione**: lista di esclusione (docs/ interni come ROAD-TO-PUBLIC/studi B0-A4-B4 NON vanno nel repo pubblico, file sensibili, ecc.)
- Workflow: io scrivo bozza → utente corregge la sostanza → applico correzioni. Tutto in inglese.
- **README Quinki riscritto**: cos'è, PERCHÉ esiste (visione), perché è DIVERSO (pool 100+ sessioni, H24 scheduler, App Expert self-modifying, thinking universale, market auto-merge, privacy by default, no lock-in), architettura, quickstart, screenshot, **roadmap pubblica**, scopo
- **README quinki-market**: formato item (tab/skill/agent/mcp/theme), guida pubblicazione, workflow auto-merge
- Docs sviluppatore (build, sidecar, architettura) + docs utente (install, permessi, provider)

**BLOCCO 4 — SITO (pronto ma privato, si attiva in un clic al lancio)**
- Cartella `site/` nel repo Quinki: homepage (hero + download + feature), catalogo, guida sviluppatore, privacy/terms
- Catalogo generato dal repo market (GitHub Action: on push market → catalogo → Pages) oppure fetch live via GitHub API (zero duplicazione, sempre aggiornato) → da decidere
- Coerente graficamente con l'app (nessuna animazione, stesso linguaggio visivo)

**BLOCCO 5 — MARKETING ORGANICO (lista preparata, eseguita al lancio)**
- Show HN, Product Hunt, r/LocalLLaMA, r/Ollama, r/SideProject, r/opensource, X/Twitter (build in public), Discord (OpenRouter, Ollama, Pi), r/ItalyInformatica
- Assets da preparare: screenshot, GIF demo, 3 bullet forti, testo Show HN

### LANCIO — (DOPO lo smoke test dell'amico, in ordine)
1. **DMG in GitHub Releases** (nuova build pulita post-smoke-test) | **VERSIONE = 1.0.0-beta.1** (decisione 28 ago: i repo vengono RESETTATI alla pubblicazione — la numerazione interna 1.1.x non esiste più; il changelog è utente-oriented e parte dalla 1.0-beta.1). **BETA, non stable**: tutela le aspettative (no test estesi), la 1.0.0 stable arriva dopo il primo giro di feedback. App aggiornata: tauri.conf.json + Cargo.toml = 1.0.0-beta.1
2. **Pulizia storia + repo PUBBLICHE** (`Upward991/Quinki` + `quinki-market`) → sblocca update system (oggi privato → API 404) + nuovo secret OAuth
3. **SITO ON**: Pages abilitata → catalogo + download + docs online
4. **Dominio: NIENTE al lancio** (decisione 27 ago) — si compra SOLO SE i download crescono (quink.ai = 60-100€/anno; .com/.app = 12-15€/anno; collegabile a Pages in 5 min quando serve). **RICORDATELO come cosa futura nel piano**. Email DMCA/contatti: GitHub Issues (zero costo)
5. **Apple Developer + notarizzazione** (opzionale, $99/anno: Gatekeeper blocca utenti estranei — per il cerchio ristretto va bene senza; spiegare tasto destro → apri)
6. **Lancio marketing**: eseguire Blocco 5 (Show HN + PH + Reddit + X) con assets pronti
7. Canale feedback: GitHub Issues

**Nota**: A4.5 Account (multi-dispositivo + pagamenti) è POST-pubblicazione, NON blocca il lancio.

---

## 🔴 PERMESSI — FDA vs SCREEN CAPTURE (28 ago, chiarimento)

- **Full Disk Access: FUNZIONA per i processi child** — verificato sul campo: l'App Expert sidecar legge TCC.db di sistema e l'agente lavora sui file ovunque. FDA è il permesso CRITICO per il lavoro agentico ed è stabile (granted 17 ago, mai ri-promptato). → NON ha il problema degli screenshot.
- **Screen Capture: la app NON la usa in nessuna feature** — solo gli agenti che lanciano `screencapture` da CLI, e per i processi orfani CLI fallisce anche col permesso concesso (limitazione macOS sui child non-bundle). SOLUZIONE APPLICATA: comando nativo `take_screenshot` in Rust (la cattura avviene nel processo GUI, autorizzato) esposto agli agenti come tool `screenshot` (round-trip notify→frontend invoke→risposta). Il tool è visibile nella tab Agents (listTools) per assegnarlo agli agenti.
- **NOTARIZZAZIONE (dopo il lancio, quando genererà entrate)**: richiede Apple Developer $99/anno — elimina il ri-prompt periodico macOS per le app non notarizzate e il "tasto destro → apri" al primo avvio. Già nel piano: da fare quando la app genera i soldi per pagarlo.

## ✅ BLOCCO 4 SITO — COMPLETATO (28 ago)
- `site/index.html` riscritto: font sobri (13-15px), icone Lucide corrette per ogni card, tutto allineato, spaziature da design system
- Screenshot reale dell'app integrato nella landing (frame cliccabile → releases)
- Sezione download: 4 card con hover accent solo sul tasto "Latest" (grafica come Download for macOS), nota device-detection futura
- Sezione Market: testo + 6 card categorie (Tabs, Agents, Skills, MCP, Themes, Multi-repo) — niente screenshot (repo esterni)
- Responsive mobile testato da telefono reale (server locale http://192.168.1.189:8090): padding 20-22px, colonna singola, nav mobile solo logo+GitHub, niente tagli
- Footer: brand con icona a sinistra, link a destra, niente trattini nel testo, niente claim "solo Mac"
- Pubblicazione: GitHub Pages al lancio (Settings → Pages), URL upward991.github.io/quinki

## ✅ BUG PERMESSI/CAPABILITY — RISOLTO (28 ago)

**TEST OGGETTIVO CONFERMATO (script bun /tmp/test-midsession-tools.ts, sessione pi-...-6h0ttj)**: `delegate_to_agent` assegnato MID-SESSION (config cambiata mentre la sessione era attiva) → il refresh registry mid-session (firma mcp+tools) ha ri-registrato il tool → l'agente: "Ho il tool delegate_to_agent e ho provato a usarlo" → **il tool custom assegnato mid-session si materializza e viene eseguito, come gli MCP** ✅.

**E vision attiva**: read PNG → l'immagine arriva al modello (Shenron riconosciuto) ✅ — il fix models.json input.

### La catena dei fix (tutti verificati)
1. `fetchProviderModels`: capabilities da /api/tags → vision → input ["text","image"] (generalizzato: OpenRouter input_modalities, euristica nomi per OpenAI-compatible, override modelData)
2. `syncModelsJson`: copia input dal modelData nel modelInfo (prima buttava il flag)
3. `models.json`: input per glm/qwen/kimi ✅
4. `#maybeRefreshMcp`: la firma copre mcpServers + tools → assegnare un tool mid-session attiva il refresh → re-registrazione LIVE dei custom tool (delegate, schedule, task tools, market, screenshot)
5. `take_screenshot` nativo (GUI autorizzata) + tool per gli agenti, PNG nella cartella della sessione

### Nota Screen Recording (Apple, non risolvibile in codice)
Le app ad-hoc NON notarizzate su macOS 15+: il permesso Screen Recording si ri-invalida a ogni update del binario e periodicamente. Soluzione definitiva: Apple Developer ($99/anno) + notarizzazione — post-lancio quando la app genererà entrate. Nel frattempo: il tool screenshot NON è nel default dell'App Expert (nessun prompt per gli utenti); chi lo abilita manualmente ri-conferma il permesso dopo i sync.

## 🔴 BUG PERMESSI/CAPABILITY — DA FARE ADESSO (post-Blocco 4, approvato utente 28 ago) (28 ago), DA RISOLVERE SUBITO DOPO IL BLOCCO 4, PRIMA DELLA PUBBLICAZIONE

**Tre problemi collegati emersi dai test TCC (tutti investigati e documentati):**
1. **Tool custom non materializzati mid-session**: `screenshot`, `market`, `bash_readonly` sono nel Pi SDK registry e nel tools array del modello (log system_prompt conferma) MA non materializzati come funzioni nel turno dell'agente → assegnare un tool mid-session non funziona finché la sessione non si ricrea. Gli MCP invece SI ricaricano mid-session (meccanismo _refreshToolRegistry) → replicare per i custom tool: indagare il bridge Pi SDK runtime che materializza le funzioni (perché il tools array le include ma non arrivano all'agente).
2. **Vision non riflessa nel turno**: il config modelData input ['text','image'] fixato (glm-5.3-flash:cloud ha vision) MA il runtime ancora non riflette: read PNG → "(image omitted: model does not support images)". Stessa radice del punto 1: il materializzatore capability/capability → da allineare.
3. **Screen Recording da CLI child**: le feature della app NON lo usano (non bloccante per le funzioni), ma il workflow "l'agente vede l'app" (screenshot da bash) fallisce per l'orfanità del sidecar. FIX STRUTTURALE GIÀ IMPLEMENTATA: comando nativo take_screenshot nella GUI (processo autorizzato) esposto agli agenti come tool screenshot con round-trip — DA TESTARE quando il punto 1 è risolto.

**Fix già applicate in questa indagine**: sidecar firmato con identifier stabile (build-sidecar.sh), rollback_expert_app re-sign, capabilities Ollama lette in fetchProviderModels (vision → input image), frontend persiste l'input nel modelData, glm config fixato, take_screenshot(sessionKey) salva PNG nella cartella attachments della sessione, tool screenshot+market in listTools (tab Agents), refresh registry mid-session per i config.tools.

**TEST A 3 TURNI (28 ago, con la fix dispose+reopen)**: turno 1 senza getTaskStatus ✅ (l'agente elenca esattamente i 12 tools) → MID-SESSION getTaskStatus aggiunto → turno 2 "NO GETTASKSTATUS TOOL" → dispose+reopen avvenuto (log mcp-reload-dispose ✅) → **turno 3 (sessione ricreata): ANCORA "NO GETTASKSTATUS TOOL"** — e il modello conferma: getTaskResult e readHandoff CI SONO (creati con la sessione), getTaskStatus aggiunto mid-session NON C'È → **la materializzazione dei custom tool aggiunti a runtime NON avviene né mid-session né nella sessione ricreata** → il materializzatore delle funzioni esclude i tool custom aggiunti a runtime, a livello più profondo del registry.

**RISOLUZIONE COMPLETA DELLA MATERIALIZZAZIONE (28 ago, verdetto con payload-tools.log)**: la diagnostica nel vendored openai-completions.js (payload-tools.log) ha PROVATO che il payload API include i custom tool (13 tools, getTaskStatus/market/screenshot inclusi) GIÀ mid-session dopo la fix dispose+reopen → il bug "NO GETTASKSTATUS TOOL" era un FALSO NEGATIVO di GLM che elenca male i propri tool (si affida alla coerenza conversazionale, non al blocco functions) MA li chiama quando forzato ("Non parlare, chiama direttamente") → le verità: getTaskStatus tool call + result end-to-end (3/3 sessioni), screenshot tool call eseguita (round-trip timeout solo per app in riavvio), market tool call eseguita DOPO la fix della forma (il bug reale del market: la vecchia forma {run} con destrutturizzazione che il wrapper chiama male → 'value2 is not an Object' → convertito a defineTool/execute(toolCallId, params) come i tool funzionanti, commit 59853bce → il market tool risponde correttamente end-to-end). LA MATERIALIZZAZIONE DEI CUSTOM TOOL MID-SESSION: RISOLTA E PROVATA.

**VERDETTO DEFINITIVO MATERIALIZZAZIONE (28 ago, test pulito con getTaskStatus /tmp/test-materialization.ts, sessione 4124yi)**: 1) sessione creata SENZA getTaskStatus nel config → l'agente elenca ESATTAMENTE i tools passati (senza getTaskStatus) → 2) MID-SESSION getTaskStatus aggiunto al config → refresh registry partito → 3) il turno successivo: l'agente: "NO GETTASKSTATUS TOOL — getTaskStatus non esiste nell'elenco passato" → **la materializzazione mid-session NON funziona: il tool aggiunto al registry NON arriva al tools array effettivo della chiamata successiva**. Nota del modello: getTaskResult e readHandoff CI SONO (erano nel config alla creazione) → il refresh aggiorna il registry MA non il tools array della chiamata → la fix: nel Pi SDK runtime, dopo _refreshToolRegistry, assicurare che agent.state.tools sia ricostruito dal nuovo registry (setActiveToolsByName con i nomi aggiornati) e che il context della chiamata successiva lo rifletta.

**VERDETTO FINALE DEFINITIVO (28 ago, test v3 relancato con la fix installata)**: sessione creata SENZA delegate → MID-SESSION delegate assegnato al config → **il turno successivo: l'agente HA CHIAMATO `delegate_to_agent` due volte mid-session** (la delega fallisce SOLO perché nella chat di test non c'è l'agente target — errore del test) → ✅✅ **IL FIX MID-SESSION FUNZIONA: i tool assegnati durante la conversazione SI MATERIALIZZANO e vengono ESEGUITI nella sessione viva, come gli MCP**.

**VERDETTO FINALE (28 ago, test v3 con debug log)**: la sessione di test (bvhw61) creata SENZA delegate → MID-SESSION il config aggiornato (rimosso screenshot, aggiunto delegate) → **il refresh mid-session ha ri-registrato delegate (`delegate-tool-registered`), l'agente ha chiamato il tool (`delegate-tool-call` agent_name: Orchestrator) ed è stato ESEGUITO con successo (`tool-result: delegate_to_agent, isError: False`)** → ✅ IL FIX MID-SESSION FUNZIONA: aggiunta E rimozione tool mid-session si propagano al turno successivo, come gli MCP.

**RISULTATO TEST OGGETTIVO (28 ago, turno MAIN)**: la tool call `screenshot` è stata emessa dal modello e **RIFIUTATA dal runtime** — il registry della sessione corrente lo include (log verificato post-install) MA il materializzatore delle funzioni del turno NON lo espone. **TEST 2 OGGETTIVO (28 ago, script bun /tmp/test-midsession-tools.ts)**: assegnato `delegate_to_agent` MID-SESSION (config cambiata mentre la sessione era attiva) → il refresh registry è partito (log mcp-config-refresh) MA il turno successivo: l'agente risponde "NON HO IL TOOL" con i tools senza delegate → **il refresh aggiorna il registry MA il tool non diventa attivo nel turno** (l'ordine maybeRefresh→applyMode perde il tool, o il materializzatore usa una mappa fissa). → La fix: tracciare il tools array EFFETTIVO della API call (ACTIVE TOOLS) nel Pi SDK runtime e correggere la catena.

→ La fix è nel Pi SDK runtime vendored: tracciare il flusso _toolRegistry → context.tools → tools array API e assicurare che i custom tool siano eseguibili. DA FARE SUBITO DOPO IL BLOCCO 4.

**PUBBLICAZIONE**: bloccata finché i punti 1-2 non sono risolti (gli agenti degli utenti devono poter usare i tool assegnati e i modelli con vision devono vederli).

## 🔴 BUG TCC PERMESSI MACOS — TROVATO E FIXATO (28 ago)

**Problema**: l'utente abilita Screen Recording in System Settings ma la app continua a chiedere il permesso. Root cause: **il sidecar (bun --compile) ha identifier "a.out" e firma che diventa INVALIDA** quando rollback/sync sostituiscono il binario senza re-sign → TCC non attribuisce il processo al bundle dell'app → il grant esiste nel TCC ma NON si applica ai processi figli (screencapture fallisce: "could not create image from display").

**Fix applicate (c0)**:
- `build-sidecar.sh`: re-sign del sidecar binario con identifier stabile `com.quinki.sidecar` dopo la compilazione
- `rollback_expert_app`: re-sign del bundle Expert DOPO il ripristino del backup (prima mancava → firma stale)
- `install_expert_app`/sync: già re-signavano (confermato nel codice)

**Stato TCC verificato (db sistema, 28 ago)**: ScreenCapture granted (Main + Expert) · FDA granted (Main + Expert, FUNZIONA — la Expert legge TCC.db) · AppleEvents granted (auth=2) · Accessibility denied (non serve) · AppData denied (ok).

**Per applicare al runtime**: riavviare l'App Expert (il processo in esecuzione ha il TCC resolved con la vecchia firma invalida). Dopo il restart, screencapture funziona senza ri-prompt.

**Nota per il lancio**: le app ad-hoc NON notarizzate su macOS 15+ richiedono ri-autorizzazioni periodiche del permesso Screen Recording (comportamento Apple) → la NOTARIZZAZIONE (Apple Developer $99/anno) elimina il problema definitivamente: da "opzionale" a RACCOMANDATA post-lancio.

## ⚠️ Il Marketplace — visione (come l'abbiamo intesa)

**Il marketplace in Quinki = TAB ESTENSIBILI installabili dentro l'app.** Non un catalogo esterno: è il modello "VS Code" applicato alle tab.

Visione operativa:
- Un **sviluppatore crea una TAB/pacchetto** (organizzatore di appunti, calendario interno, guida turistica, gestione affitti, qualsiasi cosa) integrata con l'app (può usare agenti, sidecar, file, API).
- L'utente installa la tab **con un comando DENTRO l'app**: un bottone "Install" (anche dalla Home) apre il **marketplace interno all'app** → scegli ciò che vuoi → si aggiunge una nuova tab.
- La **Home diventa personalizzabile**: riordino delle tab con **drag&drop**, **pinnare** le più usate, e il bottone marketplace.

**Com'è collegato al piano grande (quinki.md):** Fase 4 = Extension System (Web Worker isolato, iframe sandbox, `quinki.config.json`, Extension API, event bus, `@quinki/sdk` pubblicato su npm); Fase 5 = Marketplace (backend + sito + CDN + 1-click install). La tab = superficie visiva dell'estensione.

**Perché pubblicare PRIMA del marketplace:**
- Roadmap **visibile** → attira **contributor esterni** che aiutano a sviluppare più in fretta (è il motivo per cui pubblichi subito).
- Il marketplace ha il **catch-22** (senza utenti niente dev, senza marketplace niente utenti): lo si rompe lanciando prima l'app con i differenziatori (H24 + MCP), poi il marketplace quando c'è una base.
- Il **cuore architetturale dell'extension system** va tenuto in mente fin da ora (la tab installabile = estensione), ma il sistema completo arriva post-lancio.

**Quick win pre/post-lancio legato alla visione:**
- Home: **drag&drop per riordinare tab + pin** + bottone "Install" che apre il marketplace interno (anche se all'inizio installa da URL/GitHub). È la porta d'ingresso alla visione e si costruisce a costi contenuti.

**DECISIONE AGGIORNATA (14 ago 2026):** il marketplace si fa **PRIMA della pubblicazione** — vedi **FASE A4** qui sopra. L'extension system + marketplace interno (install da URL/GitHub) entrano nella release. Il backend/sito/commissioni centralizzato resta post-lancio, ma il catalogo interno parte subito.

---

## Business model — decisione aperta
- Free / freemium / a pagamento? Incide su licenza + update system + approccio al lancio.
- Il modello "marketplace" (commissioni su estensioni) resta il piano: si attiva col Marketplace, non col core app.

---

## Nota su sempre-on e clamshell
- **MacBook aperto** → Keep Awake funziona (idle sleep).
- **MacBook coperchio chiuso (senza display esterno)** → nessun rimedio locale: serve recovery (+ provare a riprendere al wake) o, in futuro, Cloud.
- **Mac Mini headless (no-sleep)** → miglior "sempre acceso" locale: H24 garantito con Keep Awake.
- Niente power assertion = garanzia universale in ogni condizione (come da doc orchestratore).

---

## Ordine dei lavori consigliato
1. ~~**A1 (MCP support)**~~ — ✅ FATTO E TESTATO (9 ago 2026)
2. **A2 (H24) — FONDAMENTA ✅ + SIDEBAR VIEW ✅ (A2.6)** + **NUOVO STRATO**: 1) engine handoff/plan/model-per-task (A2.7) ✅ · 2) timeline UI (A2.8) ✅ · 3) colonne Model·Thinking + crea dalla tab (A2.9) ✅ · 4) ponti chat↔task (A2.10) ✅ · 5) Long-Horizon mode (A2.11) ✅ · 6) recovery (A2.12) ✅ — **A2 COMPLETO**
   - **A2.10 FATTO (15 ago 2026)**: scheduler event-driven (niente polling, fire-and-forget ~60ms); ponti chat↔task (clip come le skill → system prompt `TASK RESULT` + tool agente getTaskStatus/getTaskResult/readHandoff); semplificazione stati (niente Verify/failed/interrupted — ogni task finita = Task result/Executed); task SEMPRE in build mode; colonna Type; persistenza sezioni; toggle task result in chat (merge cronologico).
   - **Fix critici A2.10**: optsTaskClips ReferenceError (tsc --noEmit nel build); chiavi API mai più perse (preservazione+backup+restore); agenti mai più persi (agents.json user-intent inviolabile + recovery + polling post-boot); clip persistente; defaultMode nel file.
   - **A2.11 Long-Horizon mode — FATTO E TESTATO (17 ago 2026)**: modalità GUIDATA FORZATA a fasi (discussion automatica → planning → start); system message UI-only per l'utente (non nel contesto del modello); blocco di fase = plan mode in discussion/planning (tool di scrittura disabilitati, bash_readonly permesso) + build mode in start; nota di fase nel system prompt (niente nota plan/build in LH); support agent (stateless, stesso modello/thinking della sessione, prompt unità scettico, rilevamento loop per PATTERN — stesso tool+args 3+ volte → abort, niente timeout); git nella directory del progetto (non nella LH workdir); prompt di transizione VISIBILI in chat; completamento → torna alla DISCUSSION; più sessioni LH in PARALLELO (sends fire-and-forget); real-time eventi (user_message + streaming, fix fallback JSON-RPC dopo restart); nuovo tool bash_readonly (assegnabile agli agenti, abilitabile in plan mode); agente Coder creato (skill coding); MCP Sequential Thinking + Playwright installati.
   - **A2.12 Recovery — FATTO E TESTATO (17-18 ago 2026)**: recovery turni interrotti per CHAT NORMALI (marker pending-turn.json in send(), eliminato su agent_end, recoverPendingTurns al boot ri-prompta; se il messaggio originale non è nel jsonl → ri-invia il MESSAGGIO ORIGINALE dal marker; salta le sessioni Long Horizon — le gestisce il support agent). Testato: sessione LH ripresa dopo reinstall (currentIdx avanzato), recovery salta LH e ri-prompta le normali.
   - **A2.12b — FIX ROOT recovery/streaming (18 ago 2026) — TESTATO ✅**: la sessione Expert MORIVA a ogni riapertura. Causa radice: App.tsx chiamava `reloadSession('__app_expert__')` a ogni open → `pi-bridge.reloadSession` fa `dispose()` della sessione Pi attiva → uccideva il turno in corso (e anche il re-prompt del recovery). Fix: (1) App.tsx all'apertura usa `selectSession` (carica history+streaming senza uccidere); (2) sidecar `reloadSession` NON dispone se c'è uno streaming buffer attivo (`reload-session-skip-streaming`). In più: streaming restore dopo riapertura via `getStreamingMessage` (non `getStreamingStatus` che restituisce `{streamingKeys}`); pill "Running" appare con turno attivo anche con buffer VUOTO (contesto enorme = modello che carica); stale threshold 20s→45s (non doppia i turni lenti); la main sidecar recupera `__app_expert__` SOLO se l'Expert (9183) è chiuso (check `lsof -ti:9183`). Skill app-expert aggiornata (data dir + seed-defaults.ts).
3. ~~**A3 Notifiche (in-app + macOS)**~~ — ✅ COMPLETO (19 ago 2026): 2 modalità, badge/marker precisi, click notifica apre la chat, recovery event-based, merge read-state main↔Expert
3.5. **CICLO DI VITA CHIUSURA APP (20 ago) — ✅ FATTO e TESTATO**: Cmd+Q → modale conferma (Quit App rosso + spiegazione recovery), menu custom macOS (Cmd+Q arriva alla UI, Cmd+W ripristinato, Edit copy/paste ok), tray → conferma nativa macOS (NSAlert), `kill_backend()` SINCRONO in tutti i percorsi (modale/tray/menu/restart) — uccide sidecar+watchdog, watchdog Expert consapevole (esce se app non viva). VERIFICATO: dopo quit main+Expert → 0 processi residui. Il recovery (chat+task) riprende tutto al riavvio.
3.6. **EXTRA 19 ago sera (fuori piano) — ✅ FATTO**: fix root allegati A3 (clip + ATTACHED FILES), persistenza notifyMode (notifyModeTs), allegati in welcome chat, agente di default Quinki + guardia "almeno 1 agente" (modale), banner sync Expert (version.txt main vs expert), fix crash LH, restyle tab Agents (sidebar stile impostazioni + sezioni standalone). Vedi sezione EXTRA sopra.
4. **B0 — Ottimizzazione prestazioni/RAM (sidecar 1-1.7GB → target <400MB) + test 100 chat parallele** — PRIMA di B (🎯 IN DISCUSSIONE: audit → strategia sessioni → quick win bun → test scala)
5. **A2.5 Enduro test (24-48h)** — ⬜ DA FARE **DOPO B0** (deciso 18 ago): valida le ottimizzazioni B0 nel tempo (leak RAM/disk) + due app conviventi + kill a metà → riapri → riparte dall'esatto punto. Prima di B0 non ha senso (testerebbe i problemi che B0 deve fixare).
6. **A4 — MARKETPLACE (extension system + tab installabili + catalogo + Home personalizzabile)** — DECISIONE: PRIMA della fase B e della pubblicazione
7. **B (onboarding + test pulito + fix)**
8. **C — PUBBLICAZIONE (SOLO alla fine di TUTTE le fasi: A1·A2·A3·B0·A4·B)** (notarizzazione + pubblico + docs + legale + lancio)
9. **Post-lancio**: backend marketplace centralizzato, Knowledge, Mesh, Messaggistica (Fasi 4-7 piano grande)

---

# A4 — MARKETPLACE: STUDIO COMPLETO

> 21 ago 2026. Visione utente: il core NON sono skill/agenti/tool — sono le **TAB installabili** (nuove funzioni dell'app). Il marketplace è un vero app store interno + piattaforma web (quinki.com/.ai) per pubblicare e (in futuro) vendere.

---

## 1. LA VISIONE (riassunto fedele)

- **Core = TAB installabili**: chi usa l'app crea (tramite App Expert) e pubblica le proprie tab — es. "Knowledge interna", "Appunti AI" — scaricandole si aggiunge una funzione all'app.
- Il marketplace ha anche sezioni: **skill, agenti, MCP, temi/styling** — ma il core sono le tab.
- **Due luoghi**: sito web (quinki.com/.ai — serve anche per pubblicare l'app) + **store interno all'app** (bottone dedicato, funziona come un app store: premi Installa → si installa).
- **Home (tab com)**: riordino tab (griglia), barra di ricerca, riga di benvenuto, bottone Marketplace.
- **Sezione "installati"**: vedi tutto ciò che hai installato → aggiorna/elimina/rimuovi. Le **tab originali non si eliminano** (solo si riordinano).
- **Futuro**: login + pagamenti (tipo FanOcean: vendi tab/funzioni, guadagni tu e la piattaforma).

---

## 2. L'ARCHITETTURA DELLE TAB (la decisione chiave)

### Come sono oggi
`HomeView.tsx` ha un array **hardcoded** di 6 tab (expert, chat, calendar, agents, settings, log) → ogni tab apre un pannello React in `AppShell`. Niente è installabile.

### Il formato di una TAB (manifest — basato su VS Code/Obsidian)
```
tab/
├── manifest.json        ← il "contratto" della tab
├── content/             ← il contenuto (HTML/JS o config)
└── assets/              ← icone, stili
```
`manifest.json`:
```json
{
  "id": "knowledge",
  "name": "Knowledge",
  "version": "1.0.0",
  "author": "andrea",
  "description": "Knowledge base interna con AI",
  "icon": "assets/icon.svg",
  "color": "#4CAF50",
  "type": "js-bundle",          // js-bundle (potenza piena) | config | webview
  "entry": "content/index.html",
  "permissions": ["notes:read", "notes:write", "agent:ask"],
  "minAppVersion": "1.1.0"
}
```

### Come si CARICA a runtime — DECISIONE: JS bundle a POTENZA PIENA (tipo VS Code)
La tab è un **modulo JS caricato a runtime** che registra un pannello React con accesso pieno all'app
(come le estensioni VS Code: girano con i permessi dell'host). NIENTE sandbox — **potenza massima,
responsabilità dell'utente** (lo stesso modello di VS Code/npm: ti fidi di ciò che installi).

- La tab è un pacchetto: `manifest.json` + `bundle.js` (il pannello React) + assets
- L'app lo scarica in `~/.quinki/tabs/<id>/` e lo carica con `import()` a runtime
- La tab registra: pannello, icona, colore, posizione nella Home, eventuali comandi
- **Integrazione massima**: può usare le API dell'app (agente, note, file, sessioni, MCP) — con i permessi dichiarati nel manifest e confermati all'installazione

### Il modello di fiducia (come VS Code/npm)
- **L'utente è responsabile** di ciò che installa (disclaimer nel marketplace)
- Il marketplace mostra: autore, versione, permessi richiesti, rating, segnalazioni
- **Version pinning** (blocca la versione installata; aggiorna solo su richiesta)

---

## 3. IL REGISTRY + IL SITO (quinki.com / quinki.ai)

### 3.0 DECISIONI 23 ago — MULTI-SORGENTE + AUTORI + GRATIS/PAGAMENTO 🧩

**Il market VIVE ONLINE — la app è solo il client.** Il catalogo sta in un repo GitHub dedicato (`Upward991/quinki-market`). Niente server nostro, niente account da gestire (GitHub è l'identity provider), niente costi.

#### Multi-sorgente (repo esterni — idea 23 ago, GENIALE ✅)
Come skills.sh: lo store **aggrega PIÙ repo sorgente**, non solo il nostro.
- **quinki-market** = store ufficiale (sempre attivo)
- **My repos**: sezione nell'Account dove l'utente aggiunge repo pubblici compatibili (stessa struttura `catalog.json` + `packages/`) → li vede nello store come sorgenti aggiuntive, con etichetta provenienza ("from: repo-di-xxx")
- Install/update/uninstall identici (fetch raw + installer già pronto)
- **Tab e temi**: restano ESCLUSIVI del nostro formato; i repo esterni forniscono skill/agenti/MCP/tool
- Sicurezza: l'utente aggiunge repo a **sua responsabilità** (modello skills.sh); i primi 1-2 repo pubblici di default così lo store è vivo subito per gli utenti nuovi
- **Sfondo**: repo pubblico = ogni pacchetto ha il SUO autore (manifest), non solo il repo owner

#### Autori per pacchetto (crediti a tutti)
- Ogni pacchetto ha `author` OBBLIGATORIO nel manifest
- Al publish l'autore è **forzato dal login GitHub** (non dal repo, non finto)
- La UI mostra l'autore per item (card/dettaglio/pagina sviluppatore)

#### Anti-furto proprietà intellettuale (upload A4.4)
- All'install l'app registra l'ORIGINE del pacchetto: `{ sorgente, id, versione, autore, hash }` (hash = impronta contenuto)
- Al tentativo di upload: calcola l'hash del candidato → confronta con tutti gli hash noti (installati + catalogo) → **se combacia BLOCCA**: "Questo pacchetto appartiene a <autore>, non puoi caricarlo"
- Non si può riscaricare un pacchetto dello store e ripubblicarlo come proprio

#### Gratis vs a pagamento (distinzione nel repo pubblico)
- **Gratis**: file nel repo pubblico + `downloadUrl` diretto nel catalogo
- **A pagamento**: nel repo pubblico SOLO i metadati (scheda: nome/descrizione/prezzo/autore) — i FILE stanno in uno storage PRIVATO, serviti dalla funzione serverless SOLO dopo pagamento valido (link firmato a scadenza)
- Il catalogo: `price: 0` + `downloadUrl` (gratis) oppure `price: 4.99` + `paymentUrl` (pagamento)
- L'app: gratis → "Install"; a pagamento → "Buy · €4.99" → paymentUrl → serverless verifica → download firmato → installa → l'app salva "acquistato" (re-download senza ripagare)
- **Pagamenti: FUTURO** — sicurezza/scadenza/persistenza per chi paga e non-divulgazione si progettano quando si implementa (A4.5 v3)

### 3.6 A4.4 — PIANO DETTAGLIATO (step 23 ago) 🗂️

**Blocco 1 — Repo + catalogo**
1.1 Creare repo `quinki-market` (lo crea l'utente; privato all'inizio, pubblico quando il market è LIVE)
1.2 Struttura: `catalog.json` + `packages/<categoria>/<id>/` + README con istruzioni
1.3 Primi pacchetti (pubblichiamo noi i 12 item: Knowledge, Pomodoro, 2 skill, 2 agenti, 2 MCP, 2 temi)
1.4 Formato catalogo: id, nome, versione, autore, categoria, downloadUrl, installs, price/paymentUrl

**Blocco 2 — la app legge dal market**
2.1 MarketplaceView fa `fetch(catalog.json)` dal repo (raw GitHub / Pages)
2.2 Fallback al catalogo locale quando offline (per test)
2.3 Install da remoto: scarica zip/raw → verifica manifest → installer già pronto
2.4 Update da remoto: confronta versioni
2.5 Uninstall: già fatto

**Blocco 3 — Multi-sorgente (idea 23 ago)**
3.1 My Repos: sezione nell'Account per aggiungere/rimuovere repo URL
3.2 Fetch multi-sorgente + merge (official + my repos)
3.3 Etichetta provenienza per item ("from: repo") + autore del pacchetto
3.4 1-2 repo di default (store vivo subito per gli utenti)

**Blocco 4 — Origine + anti-furto** ✅
4.1 ✅ All'install registra { sorgente, id, versione, autore, hash } (src/registry.ts + agganciato in doInstall: tab, skill remota, bundle)
4.2 ✅ hash del candidato vs hash noti → blocco se appartiene a un altro autore (hashClaimedByOther/hashOwner, testato; il gate UI arriva col Blocco 5 upload)

**Blocco 5 — Upload + scan**
5.1 Bottone "Pubblica" → impacchetta zip+hash → login GitHub OAuth
5.2 Crea branch+commit+PR al quinki-market (autore = login GitHub)
5.3 Scan: analisi statica (eval/fs/network/require) + VirusTotal (gratis con limite)
5.4 Review della PR + merge → il pacchetto è nel catalogo

**Blocco 6 — Sito web**
6.1 Sito v1 (GitHub Pages): pagina catalogo + download app (DMG)
6.2 Pagine sviluppatore (profilo autore, i suoi pacchetti, istruzioni)

**Blocco 7 — Test end-to-end**
7.1 Install/update/uninstall da official + da un repo esterno, persistenza, offline

**Ordine**: Blocco 1+2 (market online minimale) → 3 (multi-sorgente) → 4 (anti-furto) → 5 (upload+scan) → 6 (sito) → 7 (test).
**Repo visibility**: privato durante la preparazione, pubblico quando il market è LIVE.

**⚠️ GitHub rate limit (limite gratuito, NON dipende da noi)**: GitHub consente 60 chiamate API/ora per IP senza token. Quando il limite è raggiunto, il market mostra SOLO i dati ottenibili via raw (catalog.json/.mcp.json alla radice) e appare un AVVISO "Partial catalog" in alto. Il limite si azzera da solo ogni ora. NON è un bug della app: è il limite gratuito di GitHub. (Soluzione futura: token GitHub per il fetch, Blocco 6/7.)



### Il catalogo (formato)
Un `catalog.json` (o un endpoint API) con la lista delle tab/skill/agenti/temi:
```json
{
  "tabs": [{ "id": "knowledge", "name": "Knowledge", "version": "1.0.0", "author": "andrea", "downloadUrl": "https://quinki.ai/tabs/knowledge.zip", "size": 120, "rating": 4.5, "installs": 1200 }],
  "skills": [...], "agents": [...], "themes": [...]
}
```

### Il sito (fasi)
1. **v1 (statico + registry)**: sito con la lista del catalogo (generato da un repo GitHub) + download dell'app (DMG). L'app legge il catalogo via HTTP.
2. **v2 (account)**: registrazione, pubblicazione (upload tab/skill/agente/tema), profilo autore, statistiche.
3. **v3 (pagamenti)**: vendita con revenue share (tipo FanOcean) — Stripe/Paddle, licenze, download protetti.

### Come l'app scarica
- Il marketplace in-app fa fetch del catalogo (quinki.ai/api/catalog.json)
- "Installa" → scarica lo ZIP → verifica il manifest → copia in `~/.quinki/tabs/<id>/` → la tab compare nella Home
- "Aggiorna" → confronta versioni → scarica la nuova
- "Rimuovi" → elimina la cartella (le tab base no)

---

## 4. LO STORE IN-APP (UI)

- **Bottone Marketplace** nella Home (accanto alla riga di benvenuto)
- Apre il pannello Marketplace: griglia di card (icona, nome, autore, rating, installs, badge "installato")
- **Cerca** (barra), **categorie** (Tab / Skill / Agenti / MCP / Temi), **featured**
- Click su una card → dettagli (descrizione, versioni, permessi richiesti, autore) → **Installa** (con conferma permessi) → installato
- **Sezione "I tuoi installati"**: elenco di tutto ciò che hai installato → Aggiorna / Rimuovi / Apri

---

## 5. LA HOME (tab com) — riordino + ricerca + benvenuto

- Le tab passano da **hardcoded** a **registry-driven**: `tabs = baseTabs + installedTabs` (ordine persistito in `quinki-tabs.json`)
- **Riordino**: griglia con drag&drop (o menu "riordina") — l'ordine si salva; le tab base non si eliminano, solo si riordinano
- **Barra di ricerca** delle tab (filtra la griglia)
- **Riga di benvenuto** (saluto + suggerimenti)
- **Bottone Marketplace** dedicato

---

## 6. SICUREZZA — MODELLO COMPLETO (potenza piena, responsabilità utente)

### 6.1 Lato UPLOAD (il sito scansiona prima di pubblicare)
| Meccanismo | Cosa fa | Strumento |
|---|---|---|
| **VirusTotal API v3** | Scansione multi-engine (60+ antivirus) del pacchetto | VirusTotal API |
| **Static analysis** | Cerca pattern sospetti nel JS: `eval`, `child_process`, `fetch` verso domini sconosciuti, obfuscation, download di eseguibili | scanner tipo **vsix-audit** (trailofbits) adattato |
| **ClamAV** | Antivirus open-source sui file del pacchetto | ClamAV |
| **Review umana/community** | Segnalazioni, rating, "verified publisher" | piattaforma |

### 6.2 Lato DOWNLOAD (l'app)
- Il manifest dichiara i **permessi** → l'utente li **conferma all'installazione** (come gli app store)
- **Version pinning** + hash del pacchetto (verifica integrità)
- **Disclaimer esplicito**: "Le tab di terze parti girano con pieni permessi. Installi a tuo rischio. Controlla autore e recensioni."
- Il sistema permessi esistente (cartelle autorizzate, bash readonly) resta sovrano per gli agenti

### 6.3 Il modello di fiducia (VS Code/npm)
- **Publisher identity**: account verificato, badge "verified"
- **Community**: rating, recensioni, segnalazioni ("report")
- **Supply chain**: versioni pinnate, hash, changelog visibile

---

## 6.5 IL FLUSSO DI UPLOAD (come l'utente pubblica una tab)

1. **Crea la tab nella sua app** (con l'App Expert o a mano): cartella con `manifest.json` + `bundle.js` + assets
2. **"Pubblica" dall'app** (bottone in Marketplace → "Pubblica la tua tab"): l'app impacchetta la cartella in `.zip` (con hash) e apre il sito con il file pronto
3. **Sul sito**: registrazione/login → upload dello zip → il sito **scansiona** (VirusTotal + static analysis + ClamAV) → preview (nome, icona, descrizione, permessi) → **pubblica**
4. Il pacchetto entra nel catalogo con: autore, versione, hash, data, permessi
5. (futuro) prezzo + pagamenti

Stesso flusso per: skill, agenti, MCP, temi — ognuno col suo tipo nel manifest.

---

## 7. MONETIZZAZIONE (futuro, non A4)

- Modello FanOcean: i creator vendono tab/funzioni; la piattaforma prende una % (es. 20-30%)
- Pagamenti: Stripe/Paddle; licenze per download; statistiche per i creator

---

## 8. PIANO DI IMPLEMENTAZIONE (fasi)

| Fase | Cosa | Sforzo |
|---|---|---|
| **A4.1** | Registry tab (manifest + cartella tabs) + Home registry-driven + **riordino tab** + ricerca + benvenuto + bottone Marketplace | 1 sett |
| **A4.2** | Store in-app: catalogo locale (JSON), griglia, dettagli, Installa/Aggiorna/Rimuovi, sezione installati | 1-2 sett |
| **A4.3** | JS bundle runtime + API piena (agente/note/file/sessioni) — la prima tab "vera" (es. Knowledge) | 1-2 sett |
| **A4.4** | Sito quinki.com/.ai: catalogo online + download app + pubblicazione (v1 statico) | 1-2 sett |
| **A4.5** | (futuro) account + pagamenti | dopo |

**Totale A4: ~4-6 settimane** per il core (A4.1-A4.3) + sito (A4.4).

---

## 9. FONTI
- VS Code Extension Manifest (code.visualstudio.com/api/references/extension-manifest) — formato manifest
- Obsidian plugin docs (docs.obsidian.md) — plugin system
- Webpack Module Federation / micro-frontend — caricamento runtime
- Apple/Android app store flow — install/update/remove
- Piattaforme creator (ThriveCart, Klasio, easy.tools) — monetizzazione digital products

---
# Aggiornamento — 29/30 ago 2026 (la notte dei fix + Autoprompt 2.0)

## Streaming & stabilità — CHIUSO
- Streaming: mai più eventi droppati (pseudo-ws → ws più recente → broadcast; pool router ridisegnato con `globalThis.__quinki_broadcast` per-client blindato)
- Zombie killer (il "send incastrato in Running"): stop hard cleanup 2,5s + fantasma riconosce buffer stantio >90s + catena stantia >10min si azzera — tutte scattano SOLO all'arrivo di un nuovo messaggio, MAI interrompono un turno vivo (nessun watchdog: thinking/tools/turni di un'ora restano intoccabili)
- Boot queue: le RPC arrivate durante il boot si accodano, mai droppate; RPC idempotenti con retry+timeout nel frontend
- Pill: `Sending` (rosa tenue) → `Running` → `Thinking/Writing/Tool call` — message_ack alla prima riga del send
- Greeting Home in tempo reale; ESC non cancella MAI il testo; doppio restart ucciso; indicatore versioni onesto (fingerprint, come la pill Expert)
- Permessi macOS stabili: certificato self-signed "Quinki Self-Signing" (login keychain, 20 anni) firmato in ogni build; sync si rifiuta se la Main non risponde; MAI killall Dock
- Pool B4 attivo AUTO (min(cores,16)): 6 turni paralleli provati su 2 worker, consegna completa; worker sopravvive alla morte del main e completa i turni (indipendenza provata)

## Autoprompt 2.0 — CHIUSO
- Scala UTENTE: tentativi 1-2-3 a +60s, poi 5/15/30 min, cap 6 → messaggio finale visibile (bolla rossa)
- nextRetryAt persistito sul marker: la scala sopravvive ai riavvii; driver 30s riprova da solo
- STOP persistito su disco (stopped-turn.json): un lavoro fermato dall'utente non riparte MAI
- Prompt informato: ricostruisce l'ultimo output parziale ("do NOT repeat work — continue from there")
- Pill `Retrying n/6` ROSSA senza puntini; anti-doppione (mai autoprompt sopra un turno vivo)

## Identità & business — CHIUSO
- Licenze: AGPL-3.0 (app) / MIT (infra) / CC BY 4.0 (docs) / licenza autore (market)
- docs/CLA.md: CLA (copyright unico → il progetto resta vendibile; spunta al PR)
- LICENSES.md: nome+logo NON open source (i fork DEVONO rinominare)
- Market: item 100% dell'autore, free o paid, fee piattaforma 10%, CLA mai applicato al market
- Contatti: quinki.inbox@gmail.com (→ hello@quinki.ai col dominio) in LICENSES/SECURITY/README/sito
- Social: r/Quinki (pubblica) + x.com/QuinkiHQ; brand viola #9d8bd9
- Business: donazioni al lancio → quota market → cloud → dual licensing; il 10M protetto da CLA+AGPL

## Cosa manca
1. Smoke test dell'amico
2. Lancio: DMG → repo pubblico fresh (v1.0.0) → GitHub Pages → Show HN
3. Dominio quinki.ai → hello@quinki.ai
4. Post-lancio: notarizzazione $99, account 1.1, pozzo MCP condiviso, notifica+badge rosso del recovery fallito (cosmetico)
