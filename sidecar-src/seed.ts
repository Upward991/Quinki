// seed.ts — File di default per il bootstrap silenzioso al primo avvio.
// Contiene PROMPT.md, config.json, SKILL.md degli agenti di sistema e della skill quinki-expert.
// Il sidecar li estrae su disco se non esistono già (mai sovrascrive file esistenti).

export const SEED_AGENTS: Record<string, { config: string; prompt: string }> = {
  orchestrator: {
    config: JSON.stringify({
      id: "orchestrator",
      name: "Orchestrator",
      tools: ["read", "bash", "grep", "find", "ls", "skill", "write", "edit", "delegate_to_agent"],
      skills: ["ddg-search"],
    }, null, 2),
    prompt: `# Orchestrator

Sei l'**Orchestrator**, il coordinatore degli agenti nella chat.

## Chi sei
Sei un agente di sistema che coordina altri agenti per risolvere i task dell'utente. L'utente parla direttamente con te quando non tagga nessun agente specifico.

## Cosa fai
- **Analizzi** la richiesta dell'utente
- **Decidi** quale agente delegare per ogni task
- **Coordini** gli agenti per risolvere il problema
- **Riporti** i risultati all'utente in modo chiaro

## Come delegi (TOOL: delegate_to_agent)
Hai a disposizione il tool **\`delegate_to_agent\`** per delegare task agli agenti nella chat.

**Quando usarlo:**
- L'utente chiede qualcosa che richiede competenze specifiche di un agente
- L'utente chiede di fare qualcosa su un sistema gestito da un agente (es. Notion per database/pagine)
- Il task richiede tool o skill che tu non hai

**Come usarlo:**
\`\`\`
delegate_to_agent(agent_name: "Notion", task: "Cerca tutti i database e mostrami i nomi")
\`\`\`

**Parametri:**
- \`agent_name\`: il nome esatto dell'agente come mostrato nella lista agenti
- \`task\`: descrizione chiara e completa del task da assegnare all'agente

**Dopo la delega:**
- L'agente esegue il task e ti ritorna la risposta
- Tu **sintetizzi** la risposta per l'utente
- Se la risposta è breve, riportala tale quale
- Se è lunga, sintetizza mantenendo le informazioni chiave
- Tabelle, codice, schemi: riportali integralmente

**Regole di delega:**
- Se il task è semplice e non richiede skill specifiche, rispondi direttamente tu (non delegare)
- Se più agenti potrebbero contribuire, delega a ciascuno la sua parte
- Se non sai quale agente usare, chiedi all'utente
- Non eseguire MAI tu il lavoro di un agente specializzato

## Regole fondamentali
- **NON sostituirti mai agli agenti normali**: se un agente non è in grado di fare qualcosa, NON farla tu. Chiedi all'utente cosa fare.
- **Non prendere l'iniziativa** di fare qualcosa che spetta a un altro agente. Tu coordini, non esegui.
- Rispondi in italiano
- Sii conciso: spiega cosa fai e chi deleghi

## Come riporti le risposte
- **Risposta breve**: riportala tutta, così com'è
- **Risposta lunga**: sintetizza, ma mantieni le informazioni chiave
- **Tabelle, schemi, codice, liste**: riportali sempre integralmente, non sintetizzare
- Spiega sempre all'utente cosa stai facendo e chi stai delegando
- Non ripetere le risposte degli agenti: sintetizza o riporta, a seconda della lunghezza`,
  },
  "quinki-expert": {
    config: JSON.stringify({
      id: "quinki-expert",
      name: "Quinki Expert",
      tools: ["write", "edit", "bash", "read", "grep", "find", "ls", "skill"],
      skills: ["quinki-expert", "find-skills", "ddg-search", "ponytail"],
    }, null, 2),
    prompt: `# Quinki Expert

You are the **Quinki Expert**, the automatic developer of the Quinki app.

## Who you are
You are a developer agent that works on behalf of the user: you implement features, fix bugs, write tests, build and install new versions of Quinki. The user tells you what to do and you deliver the finished product. You work inside Quinki to modify, fix, and improve Quinki itself.

## Codebase knowledge and skills
The complete codebase map is in the **quinki-expert** skill. Use the \`skill\` tool with \`command='list'\` to discover available skills, and \`command='load'\` with the skill name to read them. ALWAYS consult the quinki-expert skill before operating. For precise changes, read the actual files with the \`read\` tool.

## Architecture (summary)
Quinki = desktop app built with **Tauri 2** (native shell, Rust) + **React 19 + TypeScript + Vite** (frontend, \`src/\`) + **Node.js sidecar** (\`sidecar-src/\`) that bridges the **Pi SDK** (\`@earendil-works/pi-coding-agent\`). Details in the quinki-expert skill.

## Two apps, shared data
- **Quinki** (main app) — sidecar on port 9182. Full UI: chat, sidebar, agents, settings, log.
- **Quinki Expert** (separate app) — sidecar on port 9183. Minimal UI: chat only. Runs as an independent process.
- Both share the same data directory (\`.quinki/\` in the user's home). Agents, skills, sessions, settings are synchronized automatically.
- The Expert app bundle lives inside the main app bundle (\`Quinki.app/Contents/Resources/Quinki Expert.app\`).
- A watchdog process restarts the Expert sidecar if it dies.

## Where you work
You work in the **repo** — the Quinki source code directory, which is your working directory (set by the user via the onboarding modal). All changes happen here. The installed app runs a separate compiled binary — your code changes do NOT affect it until a new version is built and installed.

## Git — commit BEFORE and AFTER (MANDATORY)
**BEFORE every modification** (checkpoint, so you can go back):
\`\`\`
git add -A && git commit -m "checkpoint: <description>"
\`\`\`
**AFTER finishing modifications**:
\`\`\`
git add -A && git commit -m "<description of changes>"
\`\`\`
**Never skip either one**, even for small changes. If something breaks, go back with \`git checkout\` / \`git reset\`.

## Development workflow
1. **Plan** (read files, understand the problem, plan the changes).
2. **Commit BEFORE** (checkpoint): \`git add -A && git commit -m "checkpoint: <description>"\`.
3. **Modify** files in the repo (write/edit).
4. **Commit AFTER**: \`git add -A && git commit -m "<description of changes>"\`.
5. **Build** (from the project root):
   - \`rm -rf dist node_modules/.vite && npx vite build\`
   - \`export PATH="$HOME/.cargo/bin:$PATH" && npx tauri build\`
   - \`bash scripts/build-expert-app.sh\` (bundles the Expert app with its own sidecar copy)
6. **Ask the user**: "Build ready. Install now? Active chats will be interrupted (messages are saved)."
7. **On user confirmation**, install with backup + rollback:
   - Backup: \`mv /Applications/Quinki.app /Applications/Quinki.app.bak\`
   - Install: \`ditto "src-tauri/target/release/bundle/macos/Quinki.app" /Applications/Quinki.app\` (use \`ditto\`, not \`cp -R\`, on macOS)
   - Restart main: \`lsof -ti:9182 | xargs kill -9 2>/dev/null; open /Applications/Quinki.app\`
   - Clear WKWebView caches: \`rm -rf ~/Library/WebKit/com.quinki.app ~/Library/Caches/com.quinki.app\`
8. **The user tests**. If broken → user says "rollback" → restore: \`mv /Applications/Quinki.app.bak /Applications/Quinki.app\` + restart. If OK → \`rm -rf /Applications/Quinki.app.bak\`.
9. **Expert app update**: the Expert app bundle is updated by the \`ditto\` (it's inside Quinki.app). To apply changes to the running Expert process, the user quits and reopens the Expert app.

**NEVER install without explicit user permission.** The user must confirm before you install.

## Sidecar rebuild
When you modify \`sidecar-src/\`, the changes are picked up differently:
- \`ws-bridge.ts\` — needs bundle rebuild: \`cd sidecar-src && npx esbuild ws-bridge.ts --bundle --platform=node --outfile=ws-bridge-bundle.cjs --format=cjs\`
- \`sidecar.ts\`, \`pi-bridge.ts\`, \`agent-handlers.ts\` — run via \`npx tsx\` at runtime, so changes are picked up on sidecar restart (no bundle needed).
- After modifying sidecar code, kill old sidecar processes and restart: \`lsof -ti:9182 | xargs kill -9 2>/dev/null; lsof -ti:9183 | xargs kill -9 2>/dev/null\` (main and Expert sidecars respectively). The app auto-restarts the main sidecar; the Expert watchdog restarts the Expert sidecar.

## Data directory
The Quinki data directory is \`.quinki/\` in the user's home directory. It contains:
- \`agents/<id>/\` — agent config + PROMPT.md
- \`skills/<name>/\` — SKILL.md
- \`sessions/<key>.jsonl\` — message history per session
- \`quinki-sessions.json\` — session metadata (SessionEntry)
- \`config.json\` — global settings, providers, models
- \`attachments/<session-key>/\` — file attachments
- \`auth.json\` — API keys (encrypted)
- \`models.json\` — model definitions

## Tools
read, grep, find, ls, write, edit, bash, skill, delegate_to_agent. Use \`bash\` for git, vite, tauri, and system commands.

## Rules
- Work in the repo. Never install without explicit user permission.
- **Commit BEFORE and AFTER every modification.** Never skip them.
- Explain to the user what you do. The install step only on explicit user confirmation.
- Keep the quinki-expert skill updated when you change something important in the code.
- All UI text must be in **English**.
- All code must be in **English**.
- All colors via CSS variables (\`var(--q-*)\`), never hardcoded hex in component code.
- \`transition: none\` on all animations. No animated transitions.
- 12px spacing standard across the UI.
- Action buttons: \`var(--q-tab-accent)\` border + text, hover fill solid + text becomes \`var(--q-bg)\`.
- Cancel buttons: \`var(--q-accent-danger)\` (red) text, \`var(--q-border)\` border, hover \`rgba(255,255,255,0.06)\`.
- Remove buttons: text-only (no border, \`var(--q-text-tertiary)\`).

## Self-awareness and self-modification
Your system prompt and knowledge are files you can modify with the \`edit\`/\`write\` tools when the user asks:
- **System prompt**: \`agents/quinki-expert/PROMPT.md\` (in the data directory)
- **Knowledge**: \`skills/quinki-expert/SKILL.md\` (in the data directory)
Do not modify placeholders \`{{...}}\` (they are generated by code).`,
  },
};

export const SEED_SKILLS: Record<string, { skillMd: string }> = {
  "quinki-expert": {
    skillMd: `---
name: quinki-expert
description: Codebase map for the Quinki Expert agent. Consult before operating; for details read the actual files with the read tool.
---

# Quinki Expert — Codebase Map

> **Orientation guide.** For precise changes, **read the actual files** with the \`read\` tool: this is a map, not the source of truth. Update it when something fundamental changes.

## What it is
Quinki = **AI chat desktop app** (currently macOS, built with **Tauri 2**) with a **React 19 + TypeScript + Vite** frontend and a **Node.js sidecar** that bridges the **Pi SDK** (\`@earendil-works/pi-coding-agent\`). Users chat with LLMs (Anthropic, OpenAI, Ollama, OpenRouter, ...) and can use tools (read/edit/write/bash/grep/find/ls), skills, agents, delegations, and file attachments.

## Architecture — 3 layers
\`\`\`
React (src/)  ←──WebSocket/JSON-RPC──▶  sidecar (sidecar-src/)  ──API──▶  Pi SDK
   UI + state (hooks)                       bridge Pi SDK              agent runtime
\`\`\`
1. **Frontend (\`src/\`)** — React 19 + TypeScript + Vite + Tailwind CSS v4. UI + state. Communicates with sidecar via WebSocket + JSON-RPC.
2. **Tauri (\`src-tauri/\`)** — Native shell (Rust). Window management, tray icon, sidecar lifecycle, file dialogs, attachments. Embeds frontend at build time.
3. **Sidecar (\`sidecar-src/\`)** — \`ws-bridge.ts\` (WebSocket server, multi-client routing) + \`sidecar.ts\` (JSON-RPC handlers) + \`pi-bridge.ts\` (Pi SDK sessions, system prompt, mode, delegations, skills, attachments) + \`agent-handlers.ts\` (agent/skill/tool/file CRUD).

## Two apps
- **Main app** (Quinki) — sidecar port 9182. Full UI: chat, sidebar, agents panel, settings, log, home. Tray icon with menu (Show / Open Expert / Restart / Quit).
- **Expert app** (Quinki Expert) — sidecar port 9183. Minimal UI: chat only. Separate process with its own sidecar code copy. Watchdog restarts sidecar if it dies. Tray icon (bot). Close-to-tray.
- Both share \`.quinki/\` data directory. Cross-sidecar sync via \`getSessionMeta\` (force-reads from disk).
- Expert app bundle: \`Quinki.app/Contents/Resources/Quinki Expert.app\`. Built by \`scripts/build-expert-app.sh\`.
- Expert mode detection: \`is_expert_mode()\` in \`lib.rs\` checks exe path or \`--expert\` arg.

## File map — Frontend (\`src/\`)
- \`main.tsx\` — React root, renders App.
- \`App.tsx\` — Main entry. Tab switching (home/chat/expert/agents/log/settings), sidecar connection, session management, onboarding modal, expert mode, multi-window, slash menu, agent picker, mode/thinking state, drag-drop.
- \`hooks/useSidecar.ts\` — Low-level WebSocket client. Connect, reconnect (500ms), JSON-RPC call/notify, subscription.
- \`hooks/useSidecarData.ts\` — Data layer. Sessions, agents, providers, messages, streaming, sendMessage, resetSession, reloadSession, compactSession, attachments, skill chips, agent overrides, context tokens. Per-session streaming state map.
- \`components/chat/ChatArea.tsx\` — Chat container. Message list, auto-scroll, welcome mode, HTML5 drag-drop for attachments, drag overlay.
- \`components/chat/ChatHeader.tsx\` — Header. Agent picker dropdown, model picker, thinking picker, context counter popup, mode toggle, export, reset, reload, compact, agent config modal trigger, expert title.
- \`components/chat/Composer.tsx\` — Input area. Text box, slash menu trigger, agent chips, skill chips, attachment chips, paperclip menu, send/stop, plan/build mode display.
- \`components/chat/MessageBubble.tsx\` — Message rendering. Markdown (react-markdown + remark-gfm + rehype-highlight), thinking toggles, tool calls, delegation blocks, attachment chips, skill chips, code blocks, search highlight.
- \`components/chat/SlashMenu.tsx\` — Slash command menu. /mode, /model, /agent, /skill, /directory, /reset, /reload, /export, /compact. Grouped items, confirm button flow.
- \`components/chat/ModelPicker.tsx\` — Model selection dropdown (grouped by provider).
- \`components/chat/AgentConfigModal.tsx\` — Agent config modal (left-click agent name). Uses AgentRow exported from AgentsPanel.
- \`components/chat/AgentPicker.tsx\` — Agent selection dropdown in chat header.
- \`components/sidebar/Sidebar.tsx\` — Session list. @dnd-kit drag-and-drop, folders (create/rename/delete/nesting), DnD indicator, multi-select, context menu.
- \`components/agents/AgentsPanel.tsx\` — Agent management. AgentRow, SkillRow, FileEditor, AddItemsModal, TagChip, MiniButton (all defined internally + exported). Create/edit/delete agents, skills, tools, files.
- \`components/settings/SettingsPanel.tsx\` — Settings. Providers, models, API keys, themes, attachments, launch at login, auto-save (debounced 800ms).
- \`components/settings/ProviderRow.tsx\` — Provider config row. API key, models, context window, rename, enable/disable.
- \`components/settings/ProviderDnD.tsx\` — Provider drag-and-drop reordering (@dnd-kit).
- \`components/log/LogPanel.tsx\` — Debug log viewer. Filter pills (chat, system, llm, etc.), search, export, payload formatting.
- \`components/home/HomeView.tsx\` — Home screen. Tab cards, Expert card (right-click → Open Expert App).
- \`components/shared/AppShell.tsx\` — Shell layout (tab bar, titlebar, content area).
- \`components/shared/GlobalContextMenu.tsx\` — Global context menu handler.
- \`components/icons/index.tsx\` — Icon components (Lucide-based).
- \`index.css\` — CSS variables (7 themes), global styles, \`transition: none\`, \`.win-inactive\` hover fix, breathe animation.
- \`types/index.ts\` — TypeScript types (Session, Message, Agent, Provider, etc.).
- \`utils/export.ts\` — Chat export (Markdown + HTML) via Rust \`export_chat_file\` command.
- \`utils/dateParser.ts\` — Date/time search parser.

## File map — Tauri (\`src-tauri/\`)
- \`src/lib.rs\` — Main Rust entry. Window setup, multi-window, tray icons (main + expert), sidecar start (main 9182 + expert 9183), watchdog, close-to-tray, \`is_expert_mode()\`, single instance PID check, file dialogs (\`pick_directory\`, \`pick_files\`), attachment commands (\`copy_to_attachments\`, \`save_attachment_content\`, \`open_attachments_folder\`, \`list_attachments\`), \`export_chat_file\`, \`restart_app\`, \`quit_expert_app\`, \`set_window_bg_color\`, launch at login.
- \`tauri.conf.json\` — Tauri config. Windows (all \`create: false\` except main), \`dragDropEnabled: false\` (HTML5 native drag-drop), plugins (dialog, fs, autostart, window-state).
- \`capabilities/default.json\` — Tauri ACL permissions.
- \`Cargo.toml\` — Rust dependencies (tauri, tray-icon, rfd, base64, libc, etc.).

## File map — Sidecar (\`sidecar-src/\`)
- \`ws-bridge.ts\` — WebSocket server. Multi-client routing (responses to specific client via prefixes, notifications broadcast to all). Spawns sidecar via \`npx tsx\`. Uses esbuild bundle for fast startup. \`QUINKI_WS_PORT\` env var (9182 main, 9183 expert).
- \`sidecar.ts\` — JSON-RPC handlers. \`sendMessage\`, \`getHistory\`, \`listAgents\`, \`createAgent\`, \`updateAgent\`, \`deleteAgent\`, \`listSkills\`, \`createSkill\`, \`installSkill\`, \`setMode\`, \`setWorkingDir\`, \`setChatAgents\`, \`setAgentOverride\`, \`compactSession\`, \`resetSession\`, \`reloadSession\`, \`getSessionMeta\`, \`listChatSkills\`, \`loadSkill\`, \`getFullState\`, attachment handlers. Uses \`QUINKI_AGENT_DIR\` and \`PI_CODING_AGENT_DIR\` env vars (both = \`.quinki/\` in home).
- \`pi-bridge.ts\` — PiBridge class. Core LLM logic. Sessions (\`#active\` Map), system prompt builder (\`#buildSystemPrompt\`), plan/build mode (\`#applyMode\`), agent overrides (model/thinking per agent), delegations (\`#buildDelegateTool\` → temp session → .jsonl entry), skill tool (\`#buildSkillTool\`), skill injection in system prompt, attachment system prompt, \`@tag\` agent parsing, \`agent_llm_config\` logging, \`getSessionMeta\` (force-reads from disk for cross-sidecar sync), \`sendMessage\` (timeout 600000ms), \`sendDirect\` (for @tag direct), streaming via \`fs.writeSync(1,...)\`.
- \`agent-handlers.ts\` — Agent/skill/tool/file CRUD. Reads/writes \`agents/\` and \`skills/\` directories. \`scanSkills\` parses frontmatter (\`disable-model-invocation\`, \`user-invocable\`). \`mapAgent\` transforms config.json to frontend format.
- \`providers.ts\` — Provider detection (by capability, not name). Tries \`/api/tags\` for Ollama-like providers.
- \`start.sh\` — Main sidecar start script. Sets \`QUINKI_AGENT_DIR\` and \`PI_CODING_AGENT_DIR\` to \`$HOME/.quinki\`. Launches ws-bridge bundle → spawns sidecar via \`npx tsx\`.
- \`start-expert.sh\` — Expert sidecar start script. Port 9183. Same env vars. Shared data directory.
- \`expert-watchdog.sh\` — Restarts Expert sidecar if it dies. Checks every 1s. Uses \`nohup\`.
- \`vendor/@earendil-works/pi-coding-agent/dist/core/\` — Pi SDK (modified):
  - \`session-manager.js\` — \`buildSessionContext()\` includes delegation entries (type: "delegation"). \`_appendEntry\` used for delegation .jsonl entries.
  - \`agent-session.js\` — Filters \`role: "delegation"\` before LLM calls (3 call sites). Zero context cost for delegations.
  - \`compaction.js\` — \`estimateTokens\` patched with BPE tokenizer (\`gpt-tokenizer\`, cl100k_base).
  - \`model-registry.js\` — Model registry.

## Main flows

### Send message
Composer → \`App.tsx\` onSend → \`useSidecarData.sendMessage\` → sidecar \`sendMessage\` RPC → \`pi-bridge.send()\` → system prompt build → Pi SDK stream → \`stream_event\` (filtered by sessionKey) → WebSocket → React state → UI (MessageBubble, auto-scroll). \`agent_status\` events control the status pill. \`streaming_stopped\` (agent_end) sets \`isStreaming = false\`.

### Plan / Build mode
\`setMode\` RPC → \`pi-bridge.#applyMode\` → sets active tools. **Plan** = read-only (read, grep, find, ls, skill). **Build** = all tools. Mode is per-chat (changing in one chat doesn't affect others).

### Agent override (model/thinking per agent)
\`setAgentOverride\` RPC → stores in \`SessionEntry.agentOverrides[agentId]\`. Applied in 3 paths: main session \`send()\`, @tag direct \`sendDirect()\`, delegation \`#buildDelegateTool()\`. \`agent_llm_config\` debug log in all 3 paths.

### Delegation
Orchestrator delegates via \`delegate_to_agent\` tool → \`#buildDelegateTool\` creates temp session for target agent → system prompt with skill injection → stream forwarded to frontend → delegation entry appended to .jsonl via \`sessionManager._appendEntry\` (in tree chain, not orphan) → \`buildSessionContext()\` walks it → \`agent-session.js\` filters \`role: "delegation"\` before LLM → zero context cost → frontend renders as \`type: 'delegation'\` block.

### Skill system
\`/skill\` slash menu → \`listChatSkills\` RPC (filters by \`disable-model-invocation\` or \`user-invocable\`) → skills grouped by agent → user selects → skill content injected in system prompt (NOT user message) → one-shot per message → orchestrator gets own skills ("Follow them directly"), other agents' skills stored in \`#pendingDelegationSkills\` Map → delegated agents get skills injected via \`#buildDelegateTool\`. Skill chips persisted in \`messageSkills\` (SessionEntry, matched by message text first 200 chars).

### Attachments
Files copied to \`.quinki/attachments/<session-key>/<uuid>-<original-name>\`. HTML5 drag-drop (dragDropEnabled: false in Tauri config). System prompt: "Attachment directory" (always when dir exists) + "=== ATTACHED FILES ===" (per message). All agents (main, @tag, delegated) receive both sections. Model reads on-demand via \`read\` tool. \`messageAttachments\` in SessionEntry (persistence, matched by text first 200 chars).

### @tag agent parsing
\`@agentname\` in message text → route to that agent's id. If not found + orchestrator present → orchestrator. If not found + single agent → that agent. If not found + multiple agents (no orchestrator) → error in English, persisted in .jsonl.

### Status pill
\`agent_status\` events = single source of truth. \`streaming_stopped\` (agent_end) = only handler that sets \`isStreaming = false\`. Per-session tracking via \`sessionStreamingMap\` ref. \`setStreamingState\` called BEFORE sessionKey filter.

### Streaming filter
\`stream_event\` handler filtered by \`activeSessionIdRef.current\`. Ref updated synchronously in \`selectSession\`. Event handlers NOT recreated on session change. Prevents streaming from appearing in wrong chat.

### Cross-sidecar sync
\`getSessionMeta\` force-reads from \`quinki-sessions.json\` on disk → enables main ↔ expert sync. Expert app polls every 3s for model/thinking/mode/agent changes. Restart main only kills port 9182 (NOT \`pkill -f ws-bridge\` which would kill Expert sidecar too).

## Persistence
- \`quinki-sessions.json\` — SessionEntry array (id, title, model, thinkingLevel, mode, agentId, workingDir, agentOverrides, messageSkills, messageAttachments, folderId, order).
- \`sessions/<key>.jsonl\` — Message tree (role: user/assistant/delegation). Delegations are entries in the tree chain (parentId = leaf). Position automatic from .jsonl.
- \`config.json\` — Providers, models, enabled models, context lengths, API keys (encrypted), default model, default thinking, default mode, compaction settings.
- \`agents/<id>/\` — \`config.json\` (name, model, thinkingLevel, skills, tools, files) + \`PROMPT.md\`.
- \`skills/<name>/\` — \`SKILL.md\` (with YAML frontmatter: name, description, disable-model-invocation, user-invocable).
- \`auth.json\` — API keys (encrypted with OS keychain).
- \`models.json\` — Model definitions synced from providers.
- \`attachments/<session-key>/\` — File attachments.

## Conventions
- **English** for all UI text and code.
- All colors via CSS variables (\`var(--q-*)\`), never hardcoded hex in component code.
- \`transition: none\` on all animations (CSS + inline styles).
- 12px spacing standard.
- Action buttons: \`var(--q-tab-accent)\` border + text, hover fill solid + text \`var(--q-bg)\`, \`padding: 7px 16px\`, \`borderRadius: var(--radius-sm)\`, \`fontSize: 13px\`, \`fontWeight: 600\`.
- Cancel buttons: \`var(--q-accent-danger)\` (red) text, \`var(--q-border)\` border, hover \`rgba(255,255,255,0.06)\`.
- Remove buttons: text-only (no border, \`color: var(--q-text-tertiary)\`, \`background: none\`).
- Tauri 2 \`invoke()\` for native operations. \`@tauri-apps/api/core\` import.
- WebSocket + JSON-RPC for sidecar communication (not stdio).
- Sidecar: \`QUINKI_AGENT_DIR\` and \`PI_CODING_AGENT_DIR\` both set to \`.quinki/\` in home.
- Build: use \`ditto\` (not \`cp -R\`) on macOS for app bundles. \`rm -rf dist node_modules/.vite\` before frontend build. \`rm -f src-tauri/target/release/quinki\` to force Rust re-embed. Clear WKWebView caches after install.
- Sidecar: ws-bridge uses esbuild bundle (fast 60ms startup), spawns sidecar via \`npx tsx\` (correct streaming — esbuild bundle has stdout buffering issues).
- Streaming: \`fs.writeSync(1, ...)\` in FakeWebSocket (bypasses Node.js stream buffering).
- \`sendMessage\` timeout: 600000ms (10 min). \`call()\` accepts timeout as third parameter.

## Build / run / test
- **Frontend**: \`rm -rf dist node_modules/.vite && npx vite build\`
- **Full build**: \`export PATH="$HOME/.cargo/bin:$PATH" && npx tauri build\`
- **Expert app**: \`bash scripts/build-expert-app.sh\`
- **Sidecar bundle** (ws-bridge only): \`cd sidecar-src && npx esbuild ws-bridge.ts --bundle --platform=node --outfile=ws-bridge-bundle.cjs --format=cjs\`
- **Install (macOS)**: \`ditto "src-tauri/target/release/bundle/macos/Quinki.app" /Applications/Quinki.app\`
- **Clear caches**: \`rm -rf ~/Library/WebKit/com.quinki.app ~/Library/Caches/com.quinki.app\`
- **Dev**: \`npx tauri dev\` (Vite dev server + Rust debug build)
- **Test**: manual testing (no automated tests yet)

## How to update this file
Update when something **fundamental** changes (architecture, main flows, conventions, new subsystems). Keep it concise — it's an orientation map, not a file inventory. For details, read the code.`,  },
};

export const SEED_GLOBAL_CONFIG = JSON.stringify({
  tools: ["read", "grep", "find", "ls", "skill"],
  planModeTools: {
    read: true, grep: true, find: true, ls: true, skill: true,
    write: false, edit: false, bash: false, delegate_to_agent: true,
  },
  skills: [],
  defaultMode: "plan",
}, null, 2);