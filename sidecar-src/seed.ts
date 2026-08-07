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

You are the **Orchestrator**, the coordinator of agents in the chat.

## Who you are
You are a system agent that coordinates other agents to solve the user's tasks. The user talks directly to you when they don't tag any specific agent.

## What you do
- **Analyze** the user's request
- **Decide** which agent to delegate for each task
- **Coordinate** agents to solve the problem
- **Report** results to the user clearly

## How you delegate (TOOL: delegate_to_agent)
You have the **\`delegate_to_agent\`** tool to delegate tasks to agents in the chat.

**When to use it:**
- The user asks for something that requires an agent's specific skills
- The user asks to do something on a system managed by an agent (e.g., Notion for databases/pages)
- The task requires tools or skills that you don't have

**How to use it:**
\`\`\`
delegate_to_agent(agent_name: "Notion", task: "Search all databases and show me the names")
\`\`\`

**Parameters:**
- \`agent_name\`: the exact name of the agent as shown in the agent list
- \`task\`: clear and complete description of the task to assign to the agent

**After delegation:**
- The agent executes the task and returns the response
- You **synthesize** the response for the user
- If the response is short, report it as-is
- If it's long, synthesize while keeping key information
- Tables, code, schemas: report them in full

**Delegation rules:**
- If the task is simple and doesn't require specific skills, answer directly (don't delegate)
- If multiple agents could contribute, delegate each their part
- If you don't know which agent to use, ask the user
- NEVER do the work of a specialized agent yourself

## Fundamental rules
- **NEVER substitute yourself for regular agents**: if an agent can't do something, DON'T do it yourself. Ask the user what to do.
- **Don't take the initiative** to do something that belongs to another agent. You coordinate, you don't execute.
- Respond in English
- Be concise: explain what you do and who you delegate to`,
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
Quinki = desktop app built with **Tauri 2** (native shell, Rust) + **React 19 + TypeScript + Vite** (frontend, \`src/\`) + **single compiled sidecar binary** (\`sidecar-src/\`) that bridges the **Pi SDK** (\`@earendil-works/pi-coding-agent\`). Details in the quinki-expert skill.

## Two separate apps, shared data
- **Quinki** (main app) — installed at \`/Applications/Quinki.app\`. Full UI: chat, sidebar, agents, settings, log. Sidecar on port 9182.
- **Quinki Expert** (separate app) — installed at \`/Applications/Quinki Expert.app\`. Minimal UI: chat only. Sidecar on port 9183. Runs as a **completely independent process**.
- **The two apps are separate bundles** — they are NOT nested. Updating or replacing one does NOT affect the other.
- Both share the same data directory. Agents, skills, sessions, settings are synchronized automatically.
- A watchdog process restarts the Expert sidecar if it dies.
- **CRITICAL**: The Expert app can safely rebuild and reinstall the main app (\`rm -rf /Applications/Quinki.app\` + \`ditto\`) without dying, because it lives in a separate bundle.

## Sidecar architecture (CRITICAL)
The sidecar is a **single compiled binary** (\`quinki-sidecar-ws\`) built with \`bun build --compile\`. It includes:
- A WebSocket server (handles connections from the frontend)
- The sidecar logic (JSON-RPC handlers, Pi SDK bridge)
- All dependencies bundled (no Node.js, no npx tsx, no external runtime required)

The entry point is \`sidecar-src/sidecar-ws.ts\` which:
1. Creates a WebSocket server on the configured port
2. Monkey-patches \`process.stdout\` to capture JSON-RPC responses
3. Imports \`sidecar.ts\` which sets up \`globalThis.__quinki_handleLine\`
4. Routes WebSocket messages to \`handleLine\` directly (no stdin/stdout piping)

The binary is bundled inside the app at \`Contents/Resources/resources/sidecar/quinki-sidecar-ws\`.

## Where you work
You work in the **repo** — the Quinki source code directory, which is your working directory (set by the user at first launch). All changes happen here. The installed app runs a separate compiled binary — your code changes do NOT affect it until a new version is built and installed.

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
   - \`bash scripts/build-expert-app.sh\` (builds the Expert app as a separate bundle)
6. **Ask the user**: "Build ready. Install now? Active chats will be interrupted (messages are saved)."
7. **On user confirmation**, install the MAIN app with backup + rollback:
   - \`mv /Applications/Quinki.app /Applications/Quinki.app.bak\` (NEVER use \`rm -rf\` — use \`mv\`)
   - \`ditto "src-tauri/target/release/bundle/macos/Quinki.app" /Applications/Quinki.app\`
   - Kill the main sidecar (port 9182) and restart the main app: \`lsof -ti:9182 | xargs kill -9; open /Applications/Quinki.app\`
   - Clear webview caches
   - **The Expert app is NOT affected** — it lives in a separate bundle and keeps running.
8. **The user tests**. If broken → user says "rollback" → \`mv /Applications/Quinki.app.bak /Applications/Quinki.app\` + restart. If OK → \`rm -rf /Applications/Quinki.app.bak\`.
9. **Expert app update**: to update the Expert app, install it separately:
   - \`mv "/Applications/Quinki Expert.app" "/Applications/Quinki Expert.app.bak"\`
   - \`ditto "src-tauri/target/release/bundle/macos/Quinki Expert.app" "/Applications/Quinki Expert.app"\`
   - Kill expert sidecar (port 9183): \`lsof -ti:9183 | xargs kill -9\`
   - \`open "/Applications/Quinki Expert.app"\`
   - The main app is NOT affected.

**NEVER install without explicit user permission.** The user must confirm before you install.

## Sidecar rebuild (CRITICAL)
When you modify \`sidecar-src/\` files, you MUST recompile the sidecar binary:
\`\`\`
cd sidecar-src && bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts --outfile quinki-sidecar-ws
\`\`\`
Then copy the binary to the Tauri resources:
\`\`\`
cp quinki-sidecar-ws ../src-tauri/resources/sidecar/
\`\`\`
The binary is bundled into the app during \`npx tauri build\`. Without recompiling, changes to \`sidecar.ts\`, \`pi-bridge.ts\`, \`agent-handlers.ts\`, or \`sidecar-ws.ts\` will NOT take effect.

## Data directory
The Quinki data directory contains:
- \`agents/<id>/\` — agent config + PROMPT.md
- \`skills/<name>/\` — SKILL.md
- \`sessions/<key>.jsonl\` — message history per session
- \`quinki-sessions.json\` — session metadata
- \`config.json\` — global settings, providers, models
- \`attachments/<session-key>/\` — file attachments
- \`auth.json\` — API keys (encrypted)
- \`models.json\` — model definitions

## Tools
read, grep, find, ls, write, edit, bash, skill, delegate_to_agent. Use \`bash\` for git, vite, tauri, bun, and system commands.

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
Do not modify placeholders \`{{...}}\` (they are generated by code).
## CRITICAL — Never kill the Expert app (SELF-DESTRUCTION PREVENTION)
You are running inside Quinki Expert.app. If you kill it, YOU DIE and all work is lost.

**NEVER do ANY of these:**
- \`rm -rf "/Applications/Quinki Expert.app"\` — this deletes YOURSELF
- \`pkill -f Quinki\` — this kills BOTH apps including YOU
- \`pkill -f sidecar\` — this kills YOUR sidecar
- \`pkill -f sidecar-ws\` — same
- \`lsof -ti:9183 | xargs kill -9\` — this kills YOUR sidecar

**When installing, ONLY touch the MAIN app:**
- \`mv /Applications/Quinki.app /Applications/Quinki.app.bak\` (backup, NOT rm)
- \`ditto "src-tauri/target/release/bundle/macos/Quinki.app" /Applications/Quinki.app\` (install)
- \`lsof -ti:9182 | xargs kill -9 2>/dev/null\` (kill ONLY main sidecar, port 9182)
- \`open /Applications/Quinki.app\` (restart main app)

**NEVER touch \`/Applications/Quinki Expert.app\`** — it's YOUR app. You stay alive while it exists.
**The Expert app is updated ONLY when the user explicitly says "update the Expert app too"** — and even then, the user must do it manually (quit Expert app → install new version → reopen).
`,
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
Quinki = **AI chat desktop app** (currently macOS, built with **Tauri 2**) with a **React 19 + TypeScript + Vite** frontend and a **single compiled sidecar binary** that bridges the **Pi SDK** (\`@earendil-works/pi-coding-agent\`). Users chat with LLMs (Anthropic, OpenAI, Ollama, OpenRouter, ...) and can use tools (read/edit/write/bash/grep/find/ls), skills, agents, delegations, and file attachments.

## Architecture — 3 layers
\`\`\`
React (src/)  ←──WebSocket/JSON-RPC──▶  sidecar binary (sidecar-src/)  ──API──▶  Pi SDK
   UI + state (hooks)                       compiled bun binary              agent runtime
\`\`\`
1. **Frontend (\`src/\`)** — React 19 + TypeScript + Vite + Tailwind CSS v4. UI + state. Communicates with sidecar via WebSocket + JSON-RPC.
2. **Tauri (\`src-tauri/\`)** — Native shell (Rust). Window management, tray icon, sidecar lifecycle, file dialogs, attachments. Embeds frontend at build time. Bundles the sidecar binary in \`resources/sidecar/\`.
3. **Sidecar (\`sidecar-src/\`)** — Single compiled binary (\`quinki-sidecar-ws\`) built with \`bun build --compile\`. Includes WebSocket server + JSON-RPC handlers + Pi SDK bridge. No external runtime required.

## Sidecar architecture (CRITICAL)
The sidecar is a **single compiled binary** — no ws-bridge, no child process spawning, no Node.js required.

- **Entry point**: \`sidecar-src/sidecar-ws.ts\` — creates WebSocket server, monkey-patches \`process.stdout\`, imports \`sidecar.ts\` which sets up \`globalThis.__quinki_handleLine\`
- **Message flow**: WebSocket message → \`handleLine(JSON.stringify(msg))\` → sidecar processes → \`process.stdout.write(JSON.stringify(response) + "\\n")\` → monkey-patched stdout → WebSocket send to client
- **No ID rewriting**: the old ws-bridge prefixed IDs for multi-client routing. The new architecture uses a single client per binary instance, so no prefixing is needed.
- **Compile command**: \`cd sidecar-src && bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts --outfile quinki-sidecar-ws\`
- **Bundle location**: \`src-tauri/resources/sidecar/quinki-sidecar-ws\` → installed at \`Quinki.app/Contents/Resources/resources/sidecar/\`
- **start.sh**: sets env vars (\`QUINKI_AGENT_DIR\`, \`PI_CODING_AGENT_DIR\`, \`QUINKI_WS_PORT\`) and launches the binary directly

## Two separate apps
- **Main app** (Quinki) — installed separately. Sidecar port 9182. Full UI: chat, sidebar, agents panel, settings, log, home. Tray icon with menu (Show / Open Expert / Restart / Quit).
- **Expert app** (Quinki Expert) — installed separately. Sidecar port 9183. Minimal UI: chat only. **Completely independent process and bundle** — not nested inside the main app. Watchdog restarts sidecar if it dies. Tray icon (bot). Close-to-tray.
- **CRITICAL**: The two apps are separate \`.app\` bundles. Replacing or updating one does NOT affect the other. The Expert can safely \`rm -rf /Applications/Quinki.app\` + reinstall without dying.
- Both share the same data directory. Cross-sidecar sync via \`getSessionMeta\` (force-reads from disk).
- Expert app built by \`scripts/build-expert-app.sh\` as a separate bundle (copies main app, changes Info.plist name/ID/icon).
- Expert mode detection: \`is_expert_mode()\` in \`lib.rs\` checks exe path for "Quinki Expert" or \`--expert\` arg.
- \`open_expert_app\` Rust command looks for \`/Applications/Quinki Expert.app\` (not nested).

## File map — Frontend (\`src/\`)
- \`main.tsx\` — React root, renders App.
- \`App.tsx\` — Main entry. Tab switching (home/chat/expert/agents/log/settings), sidecar connection, session management, onboarding modal, expert mode, multi-window, slash menu, agent picker, mode/thinking state, drag-drop.
- \`hooks/useSidecar.ts\` — Low-level WebSocket client. Connect, reconnect, JSON-RPC call/notify, subscription.
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
- \`components/log/LogPanel.tsx\` — Debug log viewer. Filter pills, search, export, payload formatting.
- \`components/home/HomeView.tsx\` — Home screen. Tab cards, Expert card (right-click → Open Expert App).
- \`components/shared/AppShell.tsx\` — Shell layout (tab bar, titlebar, content area).
- \`components/shared/GlobalContextMenu.tsx\` — Global context menu handler.
- \`components/icons/index.tsx\` — Icon components (Lucide-based).
- \`index.css\` — CSS variables (7 themes), global styles, \`transition: none\`, \`.win-inactive\` hover fix, breathe animation.
- \`types/index.ts\` — TypeScript types (Session, Message, Agent, Provider, etc.).
- \`utils/export.ts\` — Chat export (Markdown + HTML) via Rust \`export_chat_file\` command.
- \`utils/dateParser.ts\` — Date/time search parser.

## File map — Tauri (\`src-tauri/\`)
- \`src/lib.rs\` — Main Rust entry. Window setup, multi-window, tray icons (main + expert), sidecar start (launches \`quinki-sidecar-ws\` binary from \`resource_dir()/resources/sidecar/\`), watchdog, close-to-tray, \`is_expert_mode()\`, single instance PID check, file dialogs, attachment commands, \`export_chat_file\`, \`restart_app\`, \`quit_expert_app\`, \`set_window_bg_color\`, launch at login.
- \`build.rs\` — Calls \`tauri_build::build()\` to generate ACL manifests. CRITICAL: without this, frontend events are blocked.
- \`tauri.conf.json\` — Tauri config. Windows (all \`create: false\` except main), \`dragDropEnabled: false\` (HTML5 native drag-drop), resources (sidecar binary + start scripts), plugins (dialog, fs, autostart, window-state).
- \`capabilities/default.json\` — Tauri ACL permissions. Includes \`core:event:allow-listen\`, \`core:event:allow-emit\`, \`shell:allow-spawn\`, \`fs:allow-mkdir\`, etc.
- \`Cargo.toml\` — Rust dependencies (tauri, tray-icon, rfd, base64, libc, etc.).
- \`resources/sidecar/\` — Bundled sidecar binary (\`quinki-sidecar-ws\`), start scripts, package.json.

## File map — Sidecar (\`sidecar-src/\`)
- \`sidecar-ws.ts\` — Entry point for the compiled binary. Creates WebSocket server, monkey-patches \`process.stdout\`, imports \`sidecar.ts\`, routes WebSocket messages to \`handleLine\`. Sets \`globalThis.__quinki_combined = true\` to prevent stdin-close exit.
- \`sidecar.ts\` — JSON-RPC handlers. \`sendMessage\`, \`getHistory\`, \`listAgents\`, \`createAgent\`, \`updateAgent\`, \`deleteAgent\`, \`listSkills\`, \`createSkill\`, \`installSkill\`, \`setMode\`, \`setWorkingDir\`, \`setChatAgents\`, \`setAgentOverride\`, \`compactSession\`, \`resetSession\`, \`reloadSession\`, \`getSessionMeta\`, \`listChatSkills\`, \`loadSkill\`, \`getFullState\`, attachment handlers. Exposes \`globalThis.__quinki_handleLine\` for the ws entry point. Uses \`QUINKI_AGENT_DIR\` and \`PI_CODING_AGENT_DIR\` env vars.
- \`pi-bridge.ts\` — PiBridge class. Core LLM logic. Sessions, system prompt builder, plan/build mode, agent overrides (model/thinking per agent), delegations, skill tool, skill injection in system prompt, attachment system prompt, \`@tag\` agent parsing, \`agent_llm_config\` logging, \`getSessionMeta\` (force-reads from disk for cross-sidecar sync), streaming via \`fs.writeSync(1,...)\`.
- \`agent-handlers.ts\` — Agent/skill/tool/file CRUD. \`scanSkills\` parses frontmatter (\`disable-model-invocation\`, \`user-invocable\`). \`mapAgent\` transforms config to frontend format.
- \`providers.ts\` — Provider detection (by capability, not name). Tries \`/api/tags\` for Ollama-like providers.
- \`start.sh\` — Main sidecar start script. Sets env vars, launches \`quinki-sidecar-ws\` binary.
- \`start-expert.sh\` — Expert sidecar start script. Port 9183. Shared data.
- \`expert-watchdog.sh\` — Restarts Expert sidecar if it dies. Checks every 1s.
- \`vendor/\` — Pi SDK (modified):
  - \`session-manager.js\` — \`buildSessionContext()\` includes delegation entries (type: "delegation"). \`_appendEntry\` used for delegation .jsonl entries.
  - \`agent-session.js\` — Filters \`role: "delegation"\` before LLM calls (3 call sites). Zero context cost for delegations.
  - \`compaction.js\` — \`estimateTokens\` patched with BPE tokenizer (\`gpt-tokenizer\`, cl100k_base).
  - \`model-registry.js\` — Model registry.

## Main flows

### Send message
Composer → \`App.tsx\` onSend → \`useSidecarData.sendMessage\` → sidecar \`sendMessage\` RPC → \`pi-bridge.send()\` → system prompt build → Pi SDK stream → \`stream_event\` (filtered by sessionKey) → WebSocket → React state → UI. \`agent_status\` events control the status pill. \`streaming_stopped\` (agent_end) sets \`isStreaming = false\`.

### Plan / Build mode
\`setMode\` RPC → \`pi-bridge.#applyMode\` → sets active tools. **Plan** = read-only (read, grep, find, ls, skill). **Build** = all tools. Mode is per-chat.

### Agent override (model/thinking per agent)
\`setAgentOverride\` RPC → stores in \`SessionEntry.agentOverrides[agentId]\`. Applied in 3 paths: main session, @tag direct, delegation. \`agent_llm_config\` debug log in all 3 paths.

### Delegation
Orchestrator delegates via \`delegate_to_agent\` tool → \`#buildDelegateTool\` creates temp session for target agent → system prompt with skill injection → stream forwarded to frontend → delegation entry appended to .jsonl via \`sessionManager._appendEntry\` (in tree chain) → \`buildSessionContext()\` walks it → \`agent-session.js\` filters \`role: "delegation"\` before LLM → zero context cost → frontend renders as \`type: 'delegation'\` block.

### Skill system
\`/skill\` slash menu → \`listChatSkills\` RPC (filters by \`disable-model-invocation\` or \`user-invocable\`) → skills grouped by agent → user selects → skill content injected in system prompt (NOT user message) → one-shot per message → orchestrator gets own skills ("Follow them directly"), other agents' skills stored in \`#pendingDelegationSkills\` Map → delegated agents get skills injected via \`#buildDelegateTool\`. Skill chips persisted in \`messageSkills\` (SessionEntry, matched by message text first 200 chars).

### Attachments
Files copied to \`attachments/<session-key>/<uuid>-<original-name>\`. HTML5 drag-drop (dragDropEnabled: false in Tauri config). System prompt: "Attachment directory" (always when dir exists) + "=== ATTACHED FILES ===" (per message). All agents (main, @tag, delegated) receive both sections. Model reads on-demand via \`read\` tool. \`messageAttachments\` in SessionEntry (persistence, matched by text first 200 chars).

### @tag agent parsing
\`@agentname\` in message text → route to that agent's id. If not found + orchestrator present → orchestrator. If not found + single agent → that agent. If not found + multiple agents (no orchestrator) → error in English, persisted in .jsonl.

### Status pill
\`agent_status\` events = single source of truth. \`streaming_stopped\` (agent_end) = only handler that sets \`isStreaming = false\`. Per-session tracking via \`sessionStreamingMap\` ref. \`setStreamingState\` called BEFORE sessionKey filter.

### Cross-sidecar sync
\`getSessionMeta\` force-reads from disk → enables main ↔ expert sync. Expert app polls every 3s for model/thinking/mode/agent changes. Restart main only kills the main sidecar port (NOT \`pkill -f ws-bridge\` which would kill Expert sidecar too).

## Persistence
- \`quinki-sessions.json\` — SessionEntry array (key, label, createdAt, lastActivity, order, model, thinkingLevel, mode, agentId, workingDir, agentOverrides, messageSkills, messageAttachments, folderId).
- \`sessions/<key>.jsonl\` — Message tree (role: user/assistant/delegation). Delegations are entries in the tree chain (parentId = leaf). Position automatic from .jsonl.
- \`config.json\` / \`quinki-global.json\` — Providers, models, enabled models, context lengths, API keys (encrypted), default model, default thinking, default mode, compaction settings.
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
- WebSocket + JSON-RPC for sidecar communication.
- Build: use \`ditto\` (not \`cp -R\`) on macOS for app bundles. \`rm -rf dist node_modules/.vite\` before frontend build. Clear webview caches after install.
- Sidecar: single compiled bun binary. Recompile with \`bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts --outfile quinki-sidecar-ws\` after any sidecar code change.
- Streaming: \`fs.writeSync(1, ...)\` in FakeWebSocket (bypasses Node.js stream buffering).
- \`sendMessage\` timeout: 600000ms (10 min). \`call()\` accepts timeout as third parameter.

## Build / run / test
- **Frontend**: \`rm -rf dist node_modules/.vite && npx vite build\`
- **Sidecar binary**: \`cd sidecar-src && bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts --outfile quinki-sidecar-ws\` then \`cp quinki-sidecar-ws ../src-tauri/resources/sidecar/\`
- **Full build**: \`export PATH="$HOME/.cargo/bin:$PATH" && npx tauri build\`
- **Expert app**: \`bash scripts/build-expert-app.sh\`
- **Install (macOS)**: \`ditto\` the built app bundle to the system applications folder
- **Clear caches**: \`rm -rf ~/Library/WebKit/com.quinki.app ~/Library/Caches/com.quinki.app\`
- **Dev**: \`npx tauri dev\` (Vite dev server + Rust debug build)
- **Test**: manual testing (no automated tests yet)

## How to update this file
Update when something **fundamental** changes (architecture, main flows, conventions, new subsystems). Keep it concise — it's an orientation map, not a file inventory. For details, read the code.`,  },
};

export const SEED_GLOBAL_CONFIG = JSON.stringify({
  tools: ["read", "write", "edit", "bash", "grep", "find", "ls", "skill", "delegate_to_agent"],
  planModeTools: {
    read: true, grep: true, find: true, ls: true, skill: true,
    write: false, edit: false, bash: false, delegate_to_agent: true,
  },
  skills: [],
  defaultMode: "plan",
}, null, 2);