# QUINKI — INVENTARIO COMPLETO DELLE FEATURE (20 ago 2026)

> Inventario completo estratto dal codice (134 RPC sidecar + 54 comandi Rust + UI + strumenti agenti).
> Usato come riferimento per lo studio "senza rompere" (`B0-SENZA-ROMPERE.md`) — ogni feature è una superficie da NON rompere.

---

## 1. CHAT & MESSAGGI
- Invio messaggio (testo, multi-agente @agent, modalità plan/build, modello, thinking per messaggio)
- Streaming: delta live, thinking/tool_call/testo, pill status (running/thinking/tool/writing), streaming restore dopo riapertura
- Stop/abort, steer (re-indirizza il turno), injectClip (incolla un risultato come prompt)
- Cronologia: max 200 messaggi, merge cronologico delegations/tool_call, compaction summary, errori in chat
- Marker unread ("unread messages below") + auto-scroll + mark-on-exit + mark-read streaming-end
- Search nella chat (highlight, scroll-to-match, filtro data/ora), bookmark 📌
- Export md/html, Reset sessione, Reload sessione, Compact manuale, toggle compaction auto
- Allegati: clip nella bolla, sezione `ATTACHED FILES` nel prompt, sessione on-demand alla welcome
- Task clips nella chat (risultati task come messaggi con toggle), Long Horizon system message in chat
- Agente di default per le nuove chat (welcome), multi-agent picker, agent overrides per messaggio
- Slash menu, Composer (textarea, attacchi, skill, invio)

## 2. AGENTI & RISORSE
- Agenti: create/edit/rename/delete (PROTETTI: orchestrator, app-expert, quinki), workspace, prompt PROMPT.md
- Skill: install/create/delete, auto-diff mid-session, sezione Agents (Your agents / Skills / MCP / Tools / Plan mode)
- MCP: 3 tipi (package npm, command, URL remote), install/uninstall, per-agente, planModeMcp
- Tool: lista per agente (read/write/edit/bash/bash_readonly/grep/find/ls/skill/delegate/schedule/getTaskStatus/getTaskResult/readHandoff), abilitazione plan mode (bash_readonly)
- Default agent per le nuove chat (menu custom viewport-aware, welcome real-time)
- Guardia "almeno 1 agente" (modale)

## 3. TASK, SCHEDULER, TIMELINE
- Task da chat (`/task` o creazione da Calendar), run sincrono con stato
- Scheduler: schedule_task (once/daily/weekly/monthly), lista, pause/delete, run-now
- Executor: esecuzioni, eventi, messaggi, cancel/stop/resume/delete, recovery executions
- Timeline: sezioni task (Type, Model, Thinking, Persistenza), ponti chat↔task (clips, getTaskStatus/getTaskResult/readHandoff)
- Handoff (memoria delle task), plans (salvati)

## 4. LONG HORIZON (H24 autonomo)
- Attiva/disattiva, fasi guidate (discussion → planning → start), plan in unit, approva piano
- Support agent (stateless), rilevamento loop, bash_readonly, git nella dir progetto
- Session files (salvataggio per sessione), git log/diff/revert
- System message visibile in chat, più sessioni LH in parallelo, real-time eventi

## 5. SESSIONI & SIDEBAR
- Sessioni: create/rename/delete/reorder, folders (create/delete/move), tombstone deleted
- Welcome chat (nuova sessione), default agent in welcome
- Multi-window chat (win-chat), focus, switch session via event

## 6. NOTIFICHE (A3)
- 2 modalità per chat: Muted / All (campanella nell'header), defaultNotifyMode
- Badge unread (messaggi + task), pannello notifiche, mark all read
- macOS: UNUserNotificationCenter (permesso, banner, click → apre la chat, badge bianco), menu portal
- read-state.json condiviso main↔Expert (merge con notifyModeTs), sync 10s

## 7. IMPOSTAZIONI, PROVIDERS, MODELLI
- Providers: add/remove/rename/reorder (DnD), apiKey (encrypted), fetch models, test connection
- Modelli: context window, thinking levels (probe Ollama), default model/thinking/mode
- Tema (comfort/…), dimensione font/spacing, compaction globale
- Config globale (defaultAgentId, defaultNotifyMode, defaultMode/Model/Thinking)

## 8. ATTACHMENTS / FILE / EXPORT
- Allegati: pick files, copy to attachments/, lista, apertura cartella, download, save content
- Export chat (md/html) su file, open Long Horizon folder, open attachments folder
- Permessi cartelle (TCC): get/set authorized folders

## 9. CICLO DI VITA APP (Rust/Tauri)
- Tray: Show / Restart / Quit (conferma nativa), close-to-tray (X / Cmd+W), quit modale (Cmd+Q) con 3-opzioni→semplificato, kill sincrono backend
- Menu custom macOS (About/Hide/Quit-no-accel/Edit/Window), Cmd+W ripristinato
- Watchdog Expert consapevole (esce se app non viva), sidecar start/stop
- Window state, background color, drag region, maximize
- Notifiche macOS (delegate willPresent/didReceive), click → focus + apri chat
- Permessi macOS (TCC: readFilesAnywhere/writeFilesAnywhere/executeCommands/networkAccess/openApps), System Settings

## 10. EXPERT / SYNC / UPDATE
- Install Expert, Sync main→Expert, Rollback Expert, Restart Expert
- Banner "Update available. Sync and restart to apply." (version.txt main vs expert)
- check_expert_running, open_expert_app, sync_from_main/sync_from_expert
- Install main app update, restart main, apply update (dmg)

## 11. RECOVERY & RELIABILITY
- pending-turn.json marker, recoverPendingTurns al boot (ri-prompt turni interrotti, salta LH)
- executor startRecovery, auto-resume semantico
- keep-alive / schedules dopo riavvio
- tombstone sessioni eliminate, merged condivisi (no stale data), auto-save

## 12. HOME, CALENDAR, LOG
- Home: welcome chat, agenti, aperture rapide, attività recente
- Calendar: timeline board/table delle task, filtri, crea task, apri sessione da task
- Log: debug log (cap 300), chiaricato, livelli, live

## 13. SIDECAR SISTEMA
- Sessioni Pi SDK: SessionManager (jsonl), auto-compaction, thinking levels, context usage
- Ollama: probe, info, base url; provider locali/cloud
- Models registry + auth storage (API keys encrypted)
- MCP client (stdio+HTTP), tools/call

---

## CONTA TOTALE SUPERFICI
- **~150+ RPC/comandi** (134 sidecar + 54 Rust)
- **~30 strumenti agenti** (read/write/bash/… + MCP + skill + delegazione + task + schedule)
- **UI**: 8+ viste (Home/Chat/Expert/Calendar/Agents/Log/Settings + win-chat), 100+ componenti
- **Ciclo vita**: tray/menu/chiusura/recovery/sync — interi sistemi

> NOTA: questa lista è generata dal codice (giugno di handler/comandi/strumenti) — se manca qualcosa la si aggiunge con lo stesso metodo (grep dei handler).
