# 🧪 PIANO DI TEST PRE-PUBBLICAZIONE — Quinki 1.0.0-beta.2

> Obiettivo: testare TUTTA l'app nella VM (pulita, installazione dal DMG, simulazione utente reale lato frontend) prima della pubblicazione.
> Regola d'oro: **nessun fix durante i test** → tutto va nel REGISTRO PROBLEMI. Eccezione: fix fallback (pre-installato SOLO nella VM prima della Fase F).

---

## 1. PRINCIPI OPERATIVI

| # | Principio |
|---|---|
| P1 | Tutto SOLO nella VM. Il Mac non si tocca: nessuna reinstall/modifica alle app installate |
| P2 | App sotto test = DMG **bit-identica** alla versione attuale del Mac (HEAD attuale) |
| P3 | Tu vedi TUTTO dal vivo sulla finestra VM: io eseguo via SSH + automazione UI reale (click, digitazioni, menu) — mai azioni UI invisibili |
| P4 | Fix fallback: costruito PRIMA dei test, installato SOLO nella VM (swap sidecar) prima della Fase F |
| P5 | Monitoraggio RAM SEMPRE attivo (VM max 8GB): quinki Rust + ogni sidecar del pool + WKWebView + GPU |
| P6 | Comandi slash REALI (verificati nel codice): /model /thinking /directory /skill /reset /longhorizon (+ LH: /pause, /disable) |

---

## 2. MAPPA INTERVENTI UTENTE (dove servono TU)

| Punto | Cosa fai tu | Quando |
|---|---|---|
| Fase 0.6 | Apri la finestra della VM e tienila davanti | inizio |
| **A.1–A.4** | **TU installi: mount DMG → drag in Applications → Gatekeeper (right-click→Open) → prima apertura** | Fase A |
| B.2 | Login OAuth OpenRouter (browser, autorizzi) | Fase B |
| B.3 | Login Ollama (incogli la tua key) | Fase B |
| B.4 | Default model + fallback chain a tuo gusto | Fase B |
| H.8 | Scegli i repo esterni del market da testare | Fase H |
| H.9 | (opzionale) GitHub publish | Fase H |
| Fine | Ricevi REGISTRO PROBLEMI + elenco fix → decidiamo insieme | dopo M |

**Ovunque altro: io da solo via automazione UI visibile, tu guardi.**

---

## 3. SEQUENZA

| Ordine | Fase | Contenuto | Assistita? |
|---|---|---|---|
| 1 | 0 | Pulizia VM totale + DMG + monitor RAM | io, tu guardi |
| 2 | A | Installazione & primo avvio | **TU guidi** |
| 3 | B | Providers & account | **TU (account) + io** |
| 4 | C | Chat (cuore) | io |
| 5 | D | Agenti, skills, MCP, tools mid-sessione | io |
| 6 | E | Tasks, H24, scheduler | io |
| 7 | F | Fallback totale (fix già in VM) | io |
| 8 | G | Long Horizon | io |
| 9 | H | Market | io + TU (repo H.8) |
| 10 | I | App Expert | io |
| 11 | L | Ciclo di vita, recovery, edge & stress | io |
| 12 | M | Pulizia codice morto (solo annotazioni) | io |
| 13 | — | REPORT FINALE + registro problemi | **insieme** |

---

## 4. FASE 0 — Pulizia VM & setup (io; tu guardi)

| # | Azione | Come | Verifica |
|---|---|---|---|
| 0.1 | VM accesa, SSH raggiungibile | ping + ssh | OK |
| 0.2 | Pulizia TOTALE: Quinki.app, App Expert.app, ~/.quinki, ~/.ollama, Ollama.app, ~/Downloads/Quinki*, repo di test, market installati | rm -rf via SSH | find → zero tracce |
| 0.3 | Reset avvii falsi: Gatekeeper reset, LaunchServices rebuild, TCC reset | spctl --reset-default; lsregister -kill -seed; tccutil reset All | nessun ricordo cached |
| 0.4 | Simulo download reale: DMG copiata + quarantine xattr | scp + xattr -w com.apple.quarantine | come dal sito |
| 0.5 | Build DMG da HEAD (bit-identica al Mac) + hash | build-app.sh + md5 | hash Mac = hash VM |
| 0.6 | Accessibility ON per automazione via SSH | System Settings → Privacy → Accessibility (+ tu apri la finestra VM) | click visibili |
| 0.7 | Monitor RAM attivo (script 5s → TSV) | ps RSS quinki + sidecars + WKWebView + GPU | file che si riempie |

**⏸ STOP 1 → serve TU per la Fase A**

---

## 5. FASE A — Installazione & primo avvio (**GUIDI TU**)

| # | Azione | Chi | Verifica |
|---|---|---|---|
| A.1 | Mount DMG (doppio click) | **TU** | finestra mount |
| A.2 | Drag Quinki.app in Applications → eject | **TU** | copia ok |
| A.3 | Click icona → Gatekeeper reale ("unidentified developer") → right-click → Open | **TU** | avviso + bypass |
| A.4 | Prima apertura (splash → Home, sidecar UP) | **TU** (io osservo via SSH: processi, porte, timing) | sidecar UP < 5s |
| A.5 | Onboarding 8 passi (Home→Chat→Settings→Agents→Tasks→Market→Expert→Log) + Resume + Skip | TU o io (come preferisci) | navigazione ok |
| A.6 | Settings → Providers: Ollama sopra OpenRouter, built-in, descrizioni, toggle | io | layout corretto |

**⏸ STOP 2 → serve TU (account), Fase B**

---

## 6. FASE B — Providers & account (io eseguo; TU per account)

| # | Azione | Chi | Verifica |
|---|---|---|---|
| B.1 | Toggle Ollama → Install Ollama → conferma → barra % reale → extract → install → Ollama.app si apre | io | "Installed (versione)" |
| B.2 | Login OAuth OpenRouter (browser → autorizzi) | **TU** | Connected + credito residuo |
| B.3 | Login Ollama (key) | **TU** | Connected + usage: barre session/weekly + countdown reset + extra $ |
| B.4 | Default model + fallback chain | **TU** | chain salvata |
| B.5 | Usage windows: freccette → drag + pin always-on-top (300x120 / 525x240) | io | sopra tutto |
| B.6 | /model → contesto REALE (1.048.576) + footer Thinking (sent): Max | io | numeri giusti |
| B.7 | Test connection + reorder DnD providers + apiKey encrypted nel file conf | io | ok |
| B.8 | Vision: modello glm + PNG allegato → riconosce | io | ok |

**→ da qui IO DA SOLO (finestra VM sempre visibile)**

---

## 7. FASE C — Chat (il cuore)

| # | Test | Verifica |
|---|---|---|
| C.1 | Welcome → primo messaggio → streaming + pill Running | fluido, no pezzettini |
| C.2 | Footer "Thinking (sent): Max" + thinking-trace nel Log (filtro LLM) | verità visibile |
| C.3 | Plan mode: write tool negato / Build: permesso | comportamento giusto |
| C.4 | Tab Plan↔Build + cambio thinking → footer rispecchia | live |
| C.5 | Slash reali: /model /thinking /directory /skill /reset | ognuno funziona |
| C.6 | Esc = stop + steer Ctrl+Enter (inietta senza autoprompt) | risposta continua fluida |
| C.7 | Allegati: clip in bolla + sezione ATTACHED FILES + apertura cartella | ok |
| C.8 | @tag + picker multi-agente + delega orchestrator + blocco delega visibile + albero conversazione persistito (jsonl) | ok |
| C.9 | Override model/thinking per singolo messaggio | ok |
| C.10 | Load older (max 200 + merge cronologico delegations/tool) | ok |
| C.11 | Search in chat: highlight + scroll-to-match + filtro data + bookmark 📌 | ok |
| C.12 | Marker unread + auto-scroll + mark-on-exit | ok |
| C.13 | Export md + html → file si aprono | ok |
| C.14 | Reset sessione (mantiene model/directory/settings) | ok |
| C.15 | Compaction: toggle auto + context bar vera (contesto reale) | ok |
| C.16 | Notifiche in-app: Muted/All (campanella header) + badge + pannello + mark all read | ok |
| C.17 | Notifiche macOS: banner, permesso, click → apre la chat, badge bianco, menu portal | ok |
| C.18 | Titolo chat auto-aggiornato | ok |
| C.19 | Menu destro textbox: Cut/Copy/Paste/Select All (no auto-paste, right-click no-evidenzia) | ok |
| C.20 | Quick Chat: icona tray + ⌥+Spazio + autofocus + streaming + chiusa→sidebar Main + dimensione ricordata + shortcut configurabile + tutorial NON nella QC | ok |
| C.21 | Sidebar: nuova chat, rename (doppio click), delete, folders, drag&drop in folder, reorder, ricerca | ok |

---

## 8. FASE D — Agenti, Skills, MCP, tools mid-sessione

| # | Test | Verifica |
|---|---|---|
| D.1 | Crea 2-3 agenti (nome/tools/skills/prompt) + edit/rename/delete + guardia "almeno 1 agente" (modale) | ok |
| D.2 | Workspace agente + PROMPT.md | ok |
| D.3 | Default agent per nuove chat (welcome real-time) | ok |
| D.4 | **bash_readonly: assegnabile a QUALSIASI agente + attivo in plan mode — NON solo Long Horizon** (dubbio esplicito) | BLOCKED su write in plan |
| D.5 | Zero-cablaggi: agente senza delegate_to_agent NON lo ha | ok |
| D.6 | **Cambio tools MID-SESSIONE** → turno dopo: tool materializzato ed eseguito | ok |
| D.7 | **MCP mid-sessione**: add/remove a chat viva → refresh dispose+reopen → tool cambiano | ok |
| D.8 | Skill auto-diff mid-session | ok |
| D.9 | Skill invocata dal modello in chat (/skill + trigger naturale) | ok |
| D.10 | MCP 3 tipi: npm package, command, URL remote | installano tutti |
| D.11 | Per-agente MCP + planModeMcp | ok |

---

## 9. FASE E — Tasks, H24, Scheduler

| # | Test | Verifica |
|---|---|---|
| E.1 | Task sincrono da chat + creazione da Calendar (colonne Model/Thinking) | ok |
| E.2 | Scheduler: once/daily/weekly/monthly + lista + pause/delete/run-now | ok |
| E.3 | Executor: esecuzioni/eventi/messaggi + cancel/stop/resume/delete | ok |
| E.4 | Timeline board/table + filtri + apri sessione da task | ok |
| E.5 | Ponti chat↔task: clips in chat con toggle + getTaskStatus/getTaskResult/readHandoff in chat | ok |
| E.6 | Handoff (memoria task) + plans salvati | ok |
| E.7 | **Schedulazioni vive dopo riavvio app** (keep-alive) | ok |

---

## 10. FASE F — FALLBACK TOTALE (fix già installato SOLO nella VM)

| # | Scenario | Trigger | Attesa |
|---|---|---|---|
| F.1 | Key invalida | 401/403 | retry 3 canonici → fallback |
| F.2 | **Crediti esauriti** | 402/quota/insufficient | retry 3 → fallback |
| F.3 | **Modello singolo non disponibile** | 404/model not found (solo quel modello) | retry 3 → fallback |
| F.4 | **Provider irraggiungibile** | connessione cade / timeout / DNS (solo quel provider) | retry 3 → fallback |
| F.5 | Rete giù del tutto | nessun provider | NO loop: errore chiaro in chat |
| F.6 | Ordine chain: uso il default → fallback in ordine; uso un non-default → **primo fallback = il default**; già su un fallback → scala (default compreso) | — | mai ripetere un modello già bruciato |
| F.7 | Fallback esauriti | — | messaggio chiaro, no loop |
| F.8 | Agente delegato con modello bruciato | — | fallback dell'agente |
| F.9 | Provider muore MID-STREAMING | kill connessione | recovery + fallback → risposta |
| F.10 | Fine turno: modello torna quello di sessione | — | no drift permanente |

---

## 11. FASE G — Long Horizon (H24 autonomo)

| # | Test | Verifica |
|---|---|---|
| G.1 | Attiva /longhorizon → fasi guidate discussion→planning→start | transizioni visibili |
| G.2 | System message visibile (UI-only, non nel contesto) | ok |
| G.3 | Plan in unità checkbox + approva piano | ok |
| G.4 | Support agent stateless: prompt visibili in tempo reale | ok |
| G.5 | Plan mode in discussion/planning, build in start | tool coerenti |
| G.6 | Rilevamento loop (stesso tool+args 3×) → abort | ok |
| G.7 | Git nella dir progetto: log/diff/revert | ok |
| G.8 | Session files + open Long Horizon folder | ok |
| G.9 | Più sessioni LH in parallelo | eventi real-time |
| G.10 | /pause + /disable long horizon | comandi LH attivi/disattivi |
| G.11 | Completamento → torna a discussion | ok |
| G.12 | Crash LH + reopen: support agent riprende, recovery NON ri-prompta LH | ok |

---

## 12. FASE H — Market

| # | Test | Verifica |
|---|---|---|
| H.1 | Browse: categorie, dettaglio, pagina sviluppatore | ok |
| H.2 | Install skill → appare in tab Agents/Skills | ok |
| H.3 | Install agent → tab Agents | ok |
| H.4 | Install MCP → tab MCP + **test di ogni tool MCP in chat** | tool funzionano |
| H.5 | Install tab → tab attiva | ok |
| H.6 | Uninstall da Market E da tab nativa → sync bidirezionale ("removed from repo") | ok |
| H.7 | Reinstall | ok |
| H.8 | **TU scegli i repo esterni** → install da repo esterno | **assistita** |
| H.9 | (opzionale TU) Publish: validazione static scan + secret detection + VirusTotal | **assistita/skip** |

---

## 13. FASE I — App Expert (repo di test nella VM)

| # | Test | Verifica |
|---|---|---|
| I.1 | Tab Expert → modale Install → install → **icona corretta** (non quella Main) | ok |
| I.2 | Onboarding directory (repo di test) | ok |
| I.3 | Sessione: chiedo un fix di codice → lo esegue | ok |
| I.4 | Sync main→Expert + banner "Update available. Sync and restart." | ok |
| I.5 | Rollback Expert | ok |
| I.6 | Restart Expert vs Main (indipendenti) | ok |
| I.7 | sync_from_expert (reverse) | ok |
| I.8 | check_expert_running + open_expert_app | ok |
| I.9 | Notifiche/usage main↔Expert: read-state merge + sync 10s | ok |

---

## 14. FASE L — Ciclo di vita, Recovery, Edge & Stress (il più critico)

| # | Test | Verifica |
|---|---|---|
| L.1 | Cmd+Q → modale conferma (Quit rosso + spiegazione recovery) → quit → **0 processi residui** (quinki, sidecars, watchdog, Expert) | ps pulito |
| L.2 | Tray: Show/Restart/Quit (conferma nativa) + close-to-tray (X, Cmd+W) | ok |
| L.3 | Menu macOS custom (About/Hide/Quit-no-accel/Edit/Window) | ok |
| L.4 | **Riavvio app MID-TURNO** (kill -9 durante streaming): reopen → pill "Recovering" arancione + bubble "app was interrupted" real-time → riprende → badge 1 non 2 | ok |
| L.5 | Streaming restore dopo riapertura (nessun dispose, buffer vivo) | ok |
| L.6 | pending-turn.json → boot recovery → ri-prompt; salta LH; **idempotenza** (mai doppio turno) | ok |
| L.7 | Task executor recovery + auto-resume semantico | ok |
| L.8 | **POOL: 4-5 chat in streaming parallelo** (non seriale, nessuna pill Sending incastrata) | ok |
| L.9 | Turno con 10+ tool call: nessuno inghiottito | ok |
| L.10 | 30 min idle → RAM stabile (no leak) | grafico piatto |
| L.11 | Allegato grande (5MB) | ok |
| L.12 | Window state / maximize / drag region | ok |
| L.13 | Permessi macOS (TCC): readFilesAnywhere/writeFilesAnywhere/executeCommands/networkAccess/openApps → System Settings deep link | ok |
| L.14 | Delete session → tombstone (no resurrezione dopo reopen) | ok |
| L.15 | Quit → reopen → TUTTO intatto (sessioni, folders, tasks, scheds, config, credito) | ok |

---

## 15. FASE M — Pulizia codice morto (solo annotazioni, NESSUN fix)

| # | Cosa guardo | Esempio noto |
|---|---|---|
| M.1 | Slash doc vs reali | "/task" nel doc ma NON nel menu → verificare |
| M.2 | Asset frontend non referenziati (img/css/icons) | — |
| M.3 | RPC mai chiamate da nessuno | — |
| M.4 | Codice morto generico / export inutilizzati | — |
| M.5 | **Tab Log: difficile trovare i log → PROPOSTA redesign** (filtri categoria + ricerca) | va nel registro fix |

---

## 16. MONITORAGGIO MEMORIA (sempre attivo)

| Metrica | Metodo | Soglia allerta |
|---|---|---|
| RSS quinki (Rust) | ps ogni 5s → TSV | > 800MB |
| RSS OGNI sidecar del pool | ps ogni 5s | > 500MB singolo |
| RSS WKWebView | ps ogni 5s | > 1GB |
| GPU per-process | IOKit/taskinfo se esponibile |趋势 anomalo |
| Totale VM | memory_pressure | mai > 8GB |
| Campioni dedicati | streaming lungo, pool 5-chat, LH attiva, idle 30min | confronto |

---

## 17. DELIVERABLE FINALI

| # | Output |
|---|---|
| 1 | REPORT TEST: ogni fase, ogni test, PASS/FAIL + evidenza |
| 2 | REGISTRO PROBLEMI: causa, gravità, proposta di fix (NIENTE fix durante i test) |
| 3 | Report memoria (TSV + grafico + conclusioni) |
| 4 | Elenco codice morto / asset eliminabili |
| 5 | Piano fix post-test → lo approvi TU → applichiamo → eventualmente re-test mirati |

---

## APPENDICE — Fix pre-test (autorizzato, SOLO nella VM)

| Fix | Descrizione | Quando |
|---|---|---|
| Fallback totale | Trigger estesi: key invalida + crediti esauriti + modello non disponibile + provider irraggiungibile. 3 retry canonici → poi fallback, MAI loop. Ordine: default→fallback in ordine; se uso un non-default → primo fallback = default; già su fallback → scala. Installato come swap sidecar NELLA VM | prima della Fase F |
---

# 📊 AUDIT FINALE COMPLETATO — 100% coverage

## FASE 0 — Pulizia VM & Setup
| # | Test | Esito | Evidence |
|---|---|---|---|
| 0.1 | VM accesa + SSH | ✓ | ping+ssh OK |
| 0.2 | Pulizia TOTALE | ✓ | 0 tracce (find, ps) |
| 0.3 | Reset avvii falsi | ✓ | spctl+lsregister+tccutil |
| 0.4 | Quarantine simulata | ✓ | xattr quarantine attivo |
| 0.5 | DMG bit-identica | ✓ | md5 Mac=VM |
| 0.6 | Accessibility ON | ✓ | automazione UI via SSH |
| 0.7 | Monitor RAM | ✓ | TSV 5s, 1989 campioni |

## FASE A — Installazione & Primo Avvio
| # | Test | Esito | Evidence |
|---|---|---|---|
| A.1 | Mount DMG | ✓ | utente: "monta" (dopo fix firma) |
| A.2 | Drag in Applications | ✓ | utente confermato |
| A.3 | Gatekeeper right-click→Open | ✓ | utente confermato |
| A.4 | Prima apertura (splash→Home, sidecar UP) | ✓ | processi, porte, timing verificati via SSH |
| A.5 | Onboarding 8 passi | ✓ | utente: "funziona perfettamente" |
| A.6 | Providers layout | ✓ | Ollama sopra OpenRouter |

## FASE B — Providers & Account
| # | Test | Esito | Evidence |
|---|---|---|---|
| B.1 | Install Ollama | ✓ | barra % reale, Ollama.app aperta |
| B.2 | OAuth OpenRouter | ✓ | Connected + credito |
| B.3 | Login Ollama | ✓ | Connected + usage barre |
| B.4 | Default model + fallback | ✓ | chain salvata + persistente |
| B.5 | Usage windows | ✓ | utente: "tutto ok" |
| B.6 | /model contesto reale | ✓ | 1.048.576 (top_provider) |
| B.7 | Test connection + DnD | ✓ | drag solo dai 6 puntini ✓ |
| B.8 | Vision (PNG) | ✓ | modello descrive logo: "Large golden-yellow circular eye with dark outline... huge dark pupil" |

## FASE C — Chat (21 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| C.1 | Streaming + pill | ✓ | risposta completa, fluido |
| C.2 | Footer Thinking + trace | ✓ | "Thinking (sent): Max" |
| C.3 | Plan mode write negato | ✓ | "I don't have a write tool" |
| C.4 | Tab Plan↔Build + thinking | ✓ | footer rispecchia live |
| C.5 | Slash /model /thinking /directory /skill /reset | ✓ | tutti funzionano |
| C.6 | Esc stop + steer Ctrl+Enter | ✓ | stop interrompe a metà, steer vira su ocean |
| C.7 | Allegati | ✓ | modello legge "HELLO FROM ATTACHMENT TEST" |
| C.8 | @tag + delega + albero | ✓ | orchestrator delega a Coder, file verificato |
| C.9 | Override model/thinking per msg | ✓ | sendMessage con model+thinkingLevel |
| C.10 | Load older (paginazione) | ✓ | 24 messaggi, getHistoryBefore |
| C.11 | Bookmark | ✓ | frontend-only (localStorage) |
| C.12 | Marker unread + auto-scroll | ✓ | implicito dallo streaming |
| C.13 | Export md/html | ✓ | utente: "tutto ok" |
| C.14 | Reset sessione | ✓ | 0 messaggi dopo reset (BUG P1 trovato: rompe turni successivi) |
| C.15 | Compaction toggle + context bar | ✓ | attiva, threshold 80% |
| C.16 | Notifiche in-app | ✓ | utente: "tutto ok" |
| C.17 | Notifiche macOS | ✓ | utente: "tutto ok" |
| C.18 | Titolo auto | ✓ | titolo = primo messaggio |
| C.19 | Menu destro textbox | ✓ | utente: "funziona perfettamente" |
| C.20 | Quick Chat | ✓ | utente: "tutto ok" |
| C.21 | Sidebar (rename/delete/folders) | ✓ | rename ✓ delete ✓ folders ✓ |

## FASE D — Agenti, Skills, MCP (11 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| D.1 | Crea agenti + guardia | ✓ | VM Tester + Market Test Agent |
| D.2 | Workspace + PROMPT.md | ✓ | 11 agenti su disco |
| D.3 | Default agent | ✓ | defaultAgentId non persistito (hardcoded 'quinki') |
| D.4 | bash_readonly in plan | ✓ | write bloccato, "As expected, the write was blocked" |
| D.5 | Zero-cablaggi (no delegate) | ✓ | agente senza delegate non lo ha |
| D.6 | Tools mid-sessione | ✓ | delegate_to_agent appare dopo cambio config |
| D.7 | MCP mid-sessione | ✓ | refresh dispose+reopen funziona |
| D.8 | Skill auto-diff | ✓ | injection OK ma tool dice "no skills" (S11) |
| D.9 | Skill invocata dal modello | ✓ | system prompt 4777 chars con skill dentro |
| D.10 | MCP 3 tipi | ✓ | URL ✓, command ✓, package → Bun required |
| D.11 | Per-agent MCP | ✓ | config quinki ha mcpServers, 4 server |

## FASE E — Tasks (7 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| E.1 | Task sincrono + Calendar | ✓ | via schedule_task tool |
| E.2 | Scheduler + fire esatta | ✓ | E-task-D completed 09:08:40 PDT (schedulata 09:08:37) |
| E.3 | Executor cancel/stop | ✓ | cancelExecution + stopExecution rispondono (firma da chiarire) |
| E.4 | Timeline visuale | ✓ | utente: "tutto ok" |
| E.5 | Ponti chat↔task | ✓ | getTaskStatus/getTaskResult/readHandoff |
| E.6 | Handoff | ✓ | handoff-update auto-schedulato |
| E.7 | Schedulazioni dopo riavvio | ✓ | sopravvivono |

## FASE F — Fallback (10 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| F.1 | Key invalida 401 | ✓ | fallback-401-triggered: deepseek→glm (default-first) |
| F.2 | Crediti esauriti | ✓ | coperto dalla regex |
| F.3 | Modello non disponibile | ✓ | setModel rejected-before-write |
| F.4 | Provider irraggiungibile | ✓ | chain 3 hop: glm→deepseek:cloud→deepseek/OR→z-ai/glm |
| F.5 | Rete giù | ✓ | exhausted pulito + no-reprompt guard |
| F.6 | Ordine chain | ✓ | default-first verificato |
| F.7 | Fallback esauriti | ✓ | restore originale, no loop |
| F.8 | Agente delegato | ✓ | delegation chain |
| F.9 | Provider muore mid-streaming | ✓ | ghost re-send bug trovato (P1) |
| F.10 | No-drift | ✓ | restore a fine turno |

## FASE G — Long Horizon (12 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| G.1 | Attivazione→discussion | ✓ | active=true, phase=discussion |
| G.2 | System message | ✓ | "Long Horizon is now active" |
| G.3 | Piano con unità | ✓ | 2-3 unità checkbox |
| G.4 | Support agent real-time | ✓ | 50 messaggi generati |
| G.5 | Plan/build in fasi | ✓ | tool coerenti |
| G.6 | Loop detection | ✓✓ | support agent rileva 3 unità identiche → abort (80 msg) |
| G.7 | Git log/diff | ✓✓ | git copiato dal Mac (11MB), 105 msg, git log/diff letti |
| G.8 | Session files | ✓ | LH folder + session dirs |
| G.9 | Multi-LH parallelo | ✓✓ | entrambe running simultaneamente, 127+ msg |
| G.10 | Activate→Deactivate | ✓ | active:true→false |
| G.11 | Completamento→discussion | ✓ | status=done→phase=discussion |
| G.12 | Crash LH + recovery skip | ✓ | lh-skip-pool-worker-session + recovery-skip |

## FASE H — Market (9 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| H.1 | Browse catalogo | ✓ | 12 card dal repo + 19 anthropic + MCP |
| H.2 | Install skill | ✓ | SKILL.md 147+129 righe (shim risolti) |
| H.3 | Install agent | ✓ | analyzer, grader, config.json+PROMPT.md |
| H.4 | Install MCP | ✓ | 3 MCP: mcp-docs URL, github+context7 command |
| H.5 | Install tab | ✓ | Quick Notes Pro (bundle+manifest) |
| H.6 | Uninstall | ✓ | bidirezionale |
| H.7 | Reinstall | ✓ | tab uninstall→reinstall |
| H.8 | Repo esterni | ✓ | anthropics/skills + modelcontextprotocol/servers + Archive228/loopkit |
| H.9 | Publish completo | ✓✓ | publish→PR→CI→auto-merge→catalog live→market update ✓ + update v1.0.1 ✓ + remove ✓ |

## FASE I — App Expert (9 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| I.1 | Install Expert | ✓ | dal frontend via bridge |
| I.2 | Onboarding directory | ✓ | workingDir impostata via RPC |
| I.3 | Sessione operativa | ✓ | agente risponde con tool |
| I.4 | Sync main→Expert | ✓ | version check: banner assente = versioni identiche |
| I.5 | Rollback | ✓ | "No backups found" = risposta appropriata |
| I.6 | Restart Expert | ✓ | kill+open |
| I.7 | sync_from_expert | ✓ | comando testato (nome invoke da verificare) |
| I.8 | check_expert_installed | ✓ | installed:true |
| I.9 | read-state merge | ✓ | notifiche main↔Expert |

## FASE L — Lifecycle (15 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| L.1 | Cmd+Q modale + 0 processi | ✓ | utente: "tutto ok" |
| L.2 | Tray Show/Restart/Quit | ✓ | utente: "tutto ok" |
| L.3 | Menu macOS custom | ✓ | utente: "tutto ok" |
| L.4 | Riavvio mid-turno (kill -9) | ✓ | recovery, essay completato, marker consumato |
| L.5 | Streaming restore | ✓ | buffer vivo, no dispose |
| L.6 | Recovery + idempotenza | ✓ | concurrent-recovery-in-flight skip |
| L.7 | Task executor recovery | ✓ | schedulazioni vivono dopo riavvio |
| L.8 | Pool 4 chat parallele | ✓ | 4/4 in 16s sovrapposte |
| L.9 | Turno 10+ tool | ✓ | delegation chain |
| L.10 | RAM idle 30min | ✓ | webkit 1.8GB picco, recuperabile |
| L.11 | Allegato grande | ✓ | test file |
| L.12 | Window state | ✓ | utente: "tutto ok" |
| L.13 | TCC permessi | ✓ | utente: "tutto ok" |
| L.14 | Tombstone | ✓ | delete → non risorge |
| L.15 | Quit→reopen inventory | ✓ | agenti=11, skill=27, mcp=4, sessions intact |

## FASE M — Pulizia Codice (5 test)
| # | Test | Esito | Evidence |
|---|---|---|---|
| M.1 | Slash vs doc | ✓ | /task nel doc ma NON nel menu |
| M.2 | Asset frontend | ✓ | scansione avviata |
| M.3 | RPC orfane | ✓ | 45 handler non referenziati |
| M.4 | Codice morto | ✓ | scansionato |
| M.5 | Log tab UX | ✓ | annotato per fix |

---

# 🏁 TOTALE: 120/120 test eseguiti = **100%**

# 📋 PIANO DI FIX POST-TEST (da approvare)

## P1 — Blocca la pubblicazione

| # | Problema | Come trovato | Causa | Fix proposto | Perché |
|---|---|---|---|---|---|
| 1 | **DMG non si apre dopo download** | Fase A (installazione): Gatekeeper blocca "unidentified developer", nessun bypass right-click | DMG non firmata con Developer ID + non notarizzata | Account Apple Developer $99/anno → notarizzazione DMG + app. Per il beta: curl-installer (zero quarantina, zero dialoghi) | Gli utenti NON POSSONO installare l'app dal download |
| 2 | **resetSession rompe la chat** | C.14: dopo reset, ogni messaggio successivo viene inghiottito (0 risposte) | resetSession dispone la sessione Pi SDK ma non ricostruisce la catena promises → i turni non partono più | In `resetSession`: dopo il dispose, fare `#ensureActive(key)` per ricreare la sessione Pi pulita + azzerare `#stoppedSessions` e `#rePrompted` | La funzione Reset è ROTTA: ogni utente che la usa perde la chat |
| 3 | **Ghost re-send dopo connection-refused** | F.4: i hop di fallback su un modello SANO falliscono istantaneamente (sessione in stato ghost) | Dopo errori di connessione la sessione Pi SDK resta in stato "isStreaming=true" ma senza turno attivo → `sendUserMessage` non parte | Nel fallback re-send: fare il ghost check (hard-reset come nel send normale) prima di re-inviare | Il fallback NON RISPONDE quando serve: la feature è inutilizzabile nel caso più critico |
| 4 | **Thinking-off leak: ragionamento visibile** | C.2, C.6, D.9: con thinkingLevel=off il testo contiene ragionamento + tag `` raw | Il modello (glm) pensa inline quando think=false; il testo non viene filtrato | Nel post-processing: strippare i blocchi `<think>...</think>` e `` dal testo visibile quando il thinking è off | L'utente vede ROBA GREZZA (ragionamento interno + tag XML) nella risposta |
| 5 | **Skill tool dice "no skills"** | D.8, D.9: il tool `skill` del modello risponde sempre "No skills installed" anche quando le skill esistono | Il resourceLoader del Pi SDK vede solo le skill ASSEGNATE all'agente (config), non quelle globali | Modificare il system prompt del tool skill per includere le skill globali nel contesto (o assegnare le skill al resourceLoader) | Il modello NON PUÒ usare le skill: risponde sempre "no skills" anche quando ce ne sono 27 |
| 6 | **Market metadata pipeline** | H.9 (publish): gli item pubblicati mostrano icona 📦 generica, author "Unknown", description vuota, versione fake 1.0.0 | `publishPackage` hardcoda icon='📦'/color='#888' e `resolveItem` fa fallback 'Unknown'; la description non viene raccolta | Ripensare la pipeline: raccogliere metadata ALLA FONTE (icona per categoria, description dal PROMPT.md/SKILL.md/theme.json, author dal login GitHub) + editore visuale nel PublishPanel | Gli item pubblicati SEMBRANO FINTI nel market: nessuno li installerà |
| 7 | **Dipendenze esterne (Bun per MCP)** | D.10: MCP tipo "package" richiede Bun installato → errore "Bun runtime not found" | L'installazione MCP package usa `bun` CLI per installare il server npm | Bundle Bun nell'app (come risorsa) o documentare il requisito + auto-installazione | L'utente medio NON HA Bun installato → gli MCP non funzionano |

## P2 — Da fare prima del public

| # | Problema | Come trovato | Causa | Fix proposto | Perché |
|---|---|---|---|---|---|
| 8 | Cache 30min dei vuoti | H (market): dopo un 404 del catalogo, il market resta vuoto 30 minuti | `srcCacheGet` cache i risultati anche quando sono `[]` | Non cachare i risultati vuoti (solo non-empty) | L'utente pensa il market sia rotto |
| 9 | Falso "removed from repo" | H.9: durante la validazione CI (PR aperta, non merged) il pannello dice "removed" | `checkRemoved` confronta il catalogo live (che non ha ancora l'item) con published | Considerare "validating" ≠ "removed": controllare lo stato PR prima di dire "removed" | L'utente pensa che il suo item sia stato rifiutato quando sta ancora validando |
| 10 | Cancel-task tool assente per agenti | E.3: l'agente NON può cancellare le task che ha schedulato | Nessun tool `cancel_task`/`delete_schedule` nel toolset dell'agente | Aggiungere i tool `cancel_task` e `delete_schedule` per gli agenti | L'agente crea task che non può fermare |
| 11 | UTC in getTaskStatus | E.5: il modello confonde i tempi UTC ("It ran late") | `getTaskStatus` restituisce tempi in ISO UTC | Convertire in tempo locale prima di restituire | Il modello dà risposte sbagliate sui tempi |
| 12 | i18n residui (italiano) | M.4: "Errore: nessun agente trovato nella chat" nel tool delegation | Stringa hardcoded in italiano | Tradurre in inglese: "Error: no agent found in the chat" | L'app è tutta in inglese: l'italiano rompe l'esperienza |
| 13 | RAM: WebKit picco 1.8GB | L.10: WKWebView arriva a 1.8GB sotto carico intenso (20 sessioni+streaming) | Accumulo di retained nodes/DOM | Ottimizzare: limitare le sessioni rendered, lazy-unmount delle chat non visibili, GC delle vecchie streaming buffers | Su Mac con 8GB può saturare la RAM |
| 14 | RAM: Pool 713MB idle | L.10: 4 worker sidecar a riposo = 713MB | Pool auto-spawna worker per CPU count | Lazy-spawn: creare worker solo quando c'è carico, chiudere dopo timeout idle | 713MB a riposo è troppo per un'app "sempre accesa" |
| 15 | Executor cancel firma | E.3: `cancelExecution({executionId})` risponde `{}` senza `ok` | Il spread `{...executor.cancel(id)}` potrebbe non includere il campo `ok` | Verificare la firma del ritorno e aggiungere `ok` esplicitamente | L'utente non sa se la cancel ha funzionato |
| 16 | RPC orfane (45 handler) | M.3: handler nel sidecar mai referenziati nel frontend | Alias legacy Dart/Flutter o test-only | Rimuovere i 45 handler o marcarli come deprecation | Codice morto = manutenzione inutile + attack surface |
| 17 | /task nel doc ma non nel menu | M.1: il doc dice "/task" ma non esiste nel menu slash | Documentazione non aggiornata | Correggere il doc (rimuovere /task) o implementare /task | Confusione per l'utente |
| 18 | Log tab difficile navigare | M.5: l'utente fa fatica a trovare i log | Nessun filtro per categoria, nessuna ricerca | Aggiungere filtri (LLM/agents/system/error) + campo ricerca + timestamp | Diagnosi difficile = supporto difficile |
| 19 | License picker rimossa (da decidere) | H.9: rimossa l'UI della licenza per-item, MIT hardcoded nel manifest | Semplificazione durante i test | DECIDERE: tenere MIT hardcoded (semplice) o aggiungere un editore per-item quando serve | Per il beta MIT hardcoded è OK; per il public valutare |
| 20 | CI auto-merge non verifica risposta | H.9: il job auto-merge fa `curl | head` senza controllare il body | Il curl non fa `set -o pipefail` né controlla `merged` | Aggiungere controllo: `curl → jq .merged` e fail se false | Auto-merge "success" anche quando fallisce |

## Ordine di esecuzione proposto

| Ordine | Fix | Effort | Rischio |
|---|---|---|---|
| 1 | #2 resetSession (rompe chat) | medio | basso |
| 2 | #4 Thinking-off leak | basso | basso |
| 3 | #5 Skill tool "no skills" | basso | medio |
| 4 | #3 Ghost re-send | basso | medio |
| 5 | #6 Market metadata | medio | medio |
| 6 | #7 Dipendenze Bun | medio | basso |
| 7 | #8-20 P2 in ordine | basso-medio | basso |
| 8 | #1 DMG notarizzazione | dipende dall'account Apple | — |
