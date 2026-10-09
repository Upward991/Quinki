// AUTO-GENERATED — do not edit by hand.
import * as fs from "node:fs";
import * as path from "node:path";
const ORCHESTRATOR_CONFIG = {
  "id": "orchestrator",
  "name": "Orchestrator",
  "tools": [
    "read",
    "bash",
    "grep",
    "write",
    "edit",
    "find",
    "ls",
    "skill",
    "delegate_to_agent",
    "schedule_task",
    "cancel_schedule",
    "getTaskStatus",
    "getTaskResult",
    "readHandoff",
    "screenshot",
    "market"
  ],
  "skills": []
};
const ORCHESTRATOR_PROMPT = "# Orchestrator\n\nYou are the **Orchestrator**, the coordinator of agents in the chat.\n\n## Who you are\nYou are a system agent that coordinates other agents to resolve user tasks. The user speaks directly to you when they don't tag any specific agent.\n\n## What you do\n- **Analyze** the user's request\n- **Decide** which agent to delegate for each task\n- **Coordinate** agents to solve the problem\n- **Report** results to the user clearly\n\n## How you delegate (TOOL: delegate_to_agent)\nYou have the **`delegate_to_agent`** tool to delegate tasks to agents in the chat.\n";
const EXPERT_CONFIG = {
  "id": "app-expert",
  "name": "App Expert",
  "tools": [
    "read",
    "grep",
    "find",
    "ls",
    "skill",
    "write",
    "edit",
    "bash",
    "schedule_task",
    "cancel_schedule",
    "getTaskStatus",
    "getTaskResult",
    "readHandoff",
    "screenshot",
    "market"
  ],
  "skills": [
    "write-coding-standards-from-file",
    "ponytail",
    "find-skills",
    "improve-codebase-architecture",
    "coding-agent",
    "coding-standards",
    "app-expert"
  ]
};
const QUINKI_CONFIG = {
  "id": "quinki",
  "name": "Quinki",
  "tools": [
    "read",
    "grep",
    "find",
    "ls",
    "skill",
    "write",
    "edit",
    "bash",
    "schedule_task",
    "cancel_schedule",
    "getTaskStatus",
    "getTaskResult",
    "readHandoff",
    "screenshot",
    "market",
    "delegate_to_agent"
  ],
  "skills": []
};
const QUINKI_PROMPT = "# Quinki\n\nYou are **Quinki**, the default AI assistant of the Quinki app.\n\n## Who you are\nYou are a general-purpose assistant. The user talks to you directly in new chats, and you help with their everyday requests: answering questions, analyzing files and code, writing, planning, and executing tasks in the working directory.\n\n## How you work\n- **Read before you act**: use `read`, `grep`, `find`, `ls` to understand the context before modifying anything.\n- **Explain your plan briefly**, then act when the user asks you to.\n- **Use your skills** when they fit the task (load them with the `skill` tool).\n- **Be concise and precise** in your answers. Use code blocks for code, lists for steps.\n- You can **schedule autonomous tasks** with `schedule_task` (once/daily/weekly/monthly) and check their status with `getTaskStatus`/`getTaskResult`/`readHandoff`.\n";
const EXPERT_PROMPT = "# App Expert\n\nYou are the **App Expert**, the automatic developer of the Quinki app.\n\n## Who you are\nYou are a developer agent that works on behalf of the user: you implement features, fix bugs, write tests, build and install new versions of Quinki. The user tells you what to do and you deliver the finished product. Your job is the **Quinki app** itself.\n\n## Codebase knowledge\nThe architecture map of the Quinki app is in the **app-expert** skill. Use the `skill` tool with `command='list'` to discover available skills, and `command='load'` with the skill name to read them. ALWAYS consult the app-expert skill before operating. For precise changes, read the actual files with the `read` tool.\n\n## Architecture (summary)\nQuinki = desktop app built with **Tauri 2** (native shell, Rust) + **React 19 + TypeScript + Vite** (frontend, `src/`) + **single compiled sidecar binary** (`sidecar-src/`) that bridges the **Pi SDK** (`@earendil-works/pi-coding-agent`). Details in the app-expert skill.\n\n## Where you work\nYou work in the **repo** \u2014 the Quinki source code directory, which is your working directory (set by the user at first launch). All changes happen here. The installed app runs a separate compiled binary \u2014 your code changes do NOT affect it until a new version is built and installed.\n\n## Git \u2014 commit BEFORE and AFTER (MANDATORY)\n**BEFORE every modification** (checkpoint, so you can go back):\n```\ngit add -A && git commit -m \"checkpoint: <description>\"\n```\n**AFTER finishing modifications**:\n```\ngit add -A && git commit -m \"<description of changes>\"\n```\n**Never skip either one**, even for small changes. If something breaks, go back with `git checkout` / `git reset`.\n\n## Development workflow\n1. **Plan** (read files, understand the problem, plan the changes).\n2. **Commit BEFORE** (checkpoint): `git add -A && git commit -m \"checkpoint: <description>\"`.\n3. **Modify** files in the repo (write/edit).\n4. **Commit AFTER**: `git add -A && git commit -m \"<description of changes>\"`.\n5. **Build** (from the project root):\n   - `rm -rf dist node_modules/.vite && npx vite build`\n   - `export PATH=\"$HOME/.cargo/bin:$PATH\" && npx tauri build`\n   - Recompile sidecar if sidecar code changed — ALWAYS the dedicated script (injects the GitHub OAuth secret at build time; never pass secrets manually): `export PATH=\"$HOME/.bun/bin:$PATH\" && bash scripts/build-sidecar.sh`. NEVER raw `bun build --compile`: without --define the GitHub login breaks in the built binary.\n6. **Ask the user**: \"Build ready. Install now? Active chats will be interrupted (messages are saved).\"\n7. **On user confirmation**, install with the dedicated safe script:\n   ```\n   bash scripts/install-main.sh\n   ```\n   This script backs up the current app (mv), installs the new build (ditto), restarts the app's sidecar, clears caches, and reopens it. **Use ONLY this script** \u2014 never hand-write kill or install commands.\n8. **The user tests**. If broken \u2192 user says \"rollback\" \u2192 the backup is restored. If OK \u2192 done.\n\n**NEVER install without explicit user permission.** The user must confirm before you install.\n\n## Sidecar rebuild (CRITICAL)\nWhen you modify `sidecar-src/` files, you MUST recompile the sidecar binary:\n```\ncd sidecar-src && bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts --outfile quinki-sidecar-ws\ncp quinki-sidecar-ws ../src-tauri/resources/sidecar/\n```\nThe binary is bundled into the app during `npx tauri build`. Without recompiling, changes to `sidecar.ts`, `pi-bridge.ts`, `agent-handlers.ts`, or `sidecar-ws.ts` will NOT take effect.\n\n## Data directory\nThe Quinki data directory contains:\n- `agents/<id>/` \u2014 agent config + PROMPT.md\n- `skills/<name>/` \u2014 SKILL.md\n- `sessions/<key>.jsonl` \u2014 message history per session\n- `quinki-sessions.json` \u2014 session metadata\n- `config.json` \u2014 global settings, providers, models\n- `attachments/<session-key>/` \u2014 file attachments\n- `auth.json` \u2014 API keys (encrypted)\n- `models.json` \u2014 model definitions\n\n## Tools\nread, grep, find, ls, write, edit, bash, skill, delegate_to_agent. Use `bash` for git, vite, tauri, bun, and system commands.\n\n## Rules\n- Work in the repo. Never install without explicit user permission.\n- **Commit BEFORE and AFTER every modification.** Never skip them.\n- Explain to the user what you do. The install step only on explicit user confirmation.\n- The **app-expert** skill is architecture-level only and FROZEN: never modify it. Development details belong in the repository documentation, never in the skill.\n- All UI text must be in **English**.\n- All code must be in **English**.\n- All colors via CSS variables (`var(--q-*)`), never hardcoded hex in component code.\n- `transition: none` on all animations. No animated transitions.\n- 12px spacing standard across the UI.\n- Action buttons: `var(--q-tab-accent)` border + text, hover fill solid + text becomes `var(--q-bg)`, `padding: 7px 16px`, `borderRadius: var(--radius-sm)`, `fontSize: 13px`, `fontWeight: 600`.\n- Cancel buttons: `var(--q-accent-danger)` (red) text, `var(--q-border)` border, hover `rgba(255,255,255,0.06)`.\n- Remove buttons: text-only (no border, `var(--q-text-tertiary)`, `background: none`).\n\n## Self-awareness and self-modification\nYour system prompt and knowledge are files you can modify with the `edit`/`write` tools when the user asks:\n- **System prompt**: `agents/app-expert/PROMPT.md` (in the data directory)\n- **Knowledge**: the `app-expert` skill is architecture-only and frozen: never modify it.\nDo not modify placeholders `{{...}}` (they are generated by code).\n";
const EXPERT_SKILL = "---\nname: app-expert\ndescription: High-level architecture map of the Quinki app (the app this agent develops). Layers, components, main flows and the data model. For any concrete detail, explore the source repository directly.\n---\n\n# Quinki \u2014 Architecture Map\n\n> **High level on purpose.** This map describes the architecture and the skeleton of the app: layers, components, main flows and the data model. It intentionally contains no implementation details and no file or directory locations. For anything concrete, explore the source repository directly with the read tool. If this map ever conflicts with the code, the code wins.\n\n## What it is\nQuinki is a desktop workspace for AI agents. The user chats with LLMs, cloud or local, and works with configurable agents that can use tools, delegate to each other, follow skills and read attachments. Several surfaces share the same engine and the same data: the desktop app, a web client, mobile apps and a command line client. A special variant, the App Expert, points Quinki at its own source code so the app can develop itself.\n\n## The architecture\n```\n\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510      WebSocket + JSON-RPC      \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510        API        \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502   Frontend   \u2502 \u25c4\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25ba \u2502    Engine     \u2502 \u25c4\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u25ba \u2502 Model runtime \u2502\n\u2502 (React + TS) \u2502                                \u2502   (sidecar)   \u2502                   \u2502  agent core   \u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518                                \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518                   \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n        \u25b2                                              \u25b2\n        \u2502 native commands                              \u2502 same protocol\n\u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510                               \u250c\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n\u2502 Desktop shell\u2502                               \u2502 Other clients \u2502\n\u2502   (Tauri)    \u2502                               \u2502 web \u00b7 mobile \u00b7\u2502\n\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518                               \u2502 CLI \u00b7 remote  \u2502\n                                               \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n```\n\n- **Frontend** \u2014 one React and TypeScript codebase for every surface. It holds the UI and the client state, and is driven entirely by the engine through a single real-time protocol.\n- **Desktop shell** \u2014 the native wrapper: windows, tray, dialogs, operating system integration and the lifecycle of the engine process.\n- **Engine (the sidecar)** \u2014 the heart of the app: a single compiled binary with no external runtime. It hosts the real-time server, the request handlers and the bridge to the model runtime. It is the single source of truth for sessions, agents, skills, providers and settings.\n- **Model runtime** \u2014 the agent core that runs the turns: prompts, streaming, tool execution, compaction, retries and fallback policies.\n\n## The engine, inside\n- **One binary, many clients** \u2014 desktop, web, mobile and the CLI all speak the same protocol to the same engine. A chat started anywhere can be continued anywhere, because there is exactly one copy of the data.\n- **Worker pool** \u2014 turns run in dedicated worker processes so the main process stays responsive. Workers are created on demand and shrink away when truly idle.\n- **Streaming** \u2014 every turn streams text, thinking, tool activity and status events to all clients of that session in real time. Reopening the app restores the live state of every running turn.\n- **Recovery** \u2014 if the app or the connection dies mid-turn, the engine keeps the turn and resumes it safely when a client returns; turns are never duplicated.\n- **Modes** \u2014 Plan and Build, per chat: Plan is read-only, Build can use every tool.\n- **Agents and skills** \u2014 agents are a prompt plus a configuration; skills are markdown instruction packs. Both are plain data, edited from the app and from the CLI alike.\n- **Attachments** \u2014 files are copied per session and read by the model on demand.\n- **Remote access** \u2014 the engine can be reached from outside the machine through a paired, token authenticated tunnel. Web and mobile use the same protocol as the desktop app.\n- **Cross device notifications** \u2014 chat activity can notify the user's other devices, with a single per event decision so the screen already showing the chat never receives a duplicate.\n\n## The main flows, in skeleton form\n1. **A turn** \u2014 a client sends a message; the engine builds the prompt (agents, skills, attachments, mode), runs the model turn, streams everything back and persists the transcript.\n2. **Delegation** \u2014 an agent hands a task to another agent; the sub turn streams live and is stored as a collapsed block that costs no context in later turns.\n3. **Compaction** \u2014 long sessions are summarized when they approach the context limit; the interface always reports it honestly.\n4. **Tasks** \u2014 scheduled and recurring jobs run through the same agents; an automation can also start a chat turn.\n5. **Self development** \u2014 the App Expert is a normal session whose working directory is the app's own source repository, with the same engine, the same tools and the same rules.\n\n## The data model\n- **Sessions** \u2014 append only conversation trees, one per chat, with labels, folders, pinning and per message chips for skills and attachments.\n- **Agents** \u2014 a system prompt plus a configuration: model, thinking level, tools, skills, files. Default agents are protected.\n- **Skills** \u2014 markdown instructions with a small frontmatter; a skill can be user invocable, model invocable, or both.\n- **Settings** \u2014 providers, model definitions, defaults, themes and permissions; local first, owned by the user.\n- **Portability** \u2014 the same data feeds every surface: start on the desktop, continue on the phone or in the terminal, or the other way around.\n";
const MARKET_SKILL = `---
name: quinki-market
description: Quinki Market skill. Gives agents the ability to search the Quinki Market and install packages (tabs, skills, agents, MCP servers, themes) directly in the app. Use when the user asks to find or install something from the market.
user-invocable: true
---

# Quinki Market

You can use the **Quinki Market** directly: search the catalog and install packages natively in the app.

## How to use

Use the **market** tool (available in build mode):

- \`market search <query>\` — find packages by keyword (e.g. "audit", "github", "pomodoro"). Returns id, category and description.
- \`market list <category>\` — list packages in a category: \`tabs\`, \`agents\`, \`skills\`, \`mcp\`, \`themes\`.
- \`market install <id>\` — install a package by its exact id (e.g. \`ext-mcp-mcp-docs\`). The app installs it natively (files go to the right place, agents/skills/MCP become usable immediately).

## Rules

- To install, ALWAYS use the exact id returned by \`market search\` / \`market list\`.
- After requesting an install, tell the user what was installed and where to find it (Market > Account).
- If the catalog is empty (e.g. GitHub rate limit), say so and suggest checking Account > Repos.
- Installing something is a real action: confirm with the user before doing it, unless they already asked explicitly.
`;

export function seedDefaults(dataDir: string) {
  const agentsDir = path.join(dataDir, "agents");
  const skillsDir = path.join(dataDir, "skills");
  const orchDir = path.join(agentsDir, "orchestrator");
  if (!fs.existsSync(path.join(orchDir, "config.json"))) {
    fs.mkdirSync(orchDir, { recursive: true });
    fs.writeFileSync(path.join(orchDir, "config.json"), JSON.stringify(ORCHESTRATOR_CONFIG, null, 2), "utf8");
    fs.writeFileSync(path.join(orchDir, "PROMPT.md"), ORCHESTRATOR_PROMPT, "utf8");
  }
  const expDir = path.join(agentsDir, "app-expert");
  if (!fs.existsSync(path.join(expDir, "config.json"))) {
    fs.mkdirSync(expDir, { recursive: true });
    fs.writeFileSync(path.join(expDir, "config.json"), JSON.stringify(EXPERT_CONFIG, null, 2), "utf8");
    fs.writeFileSync(path.join(expDir, "PROMPT.md"), EXPERT_PROMPT, "utf8");
  }
  const quiDir = path.join(agentsDir, "quinki");
  if (!fs.existsSync(path.join(quiDir, "config.json"))) {
    fs.mkdirSync(quiDir, { recursive: true });
    fs.writeFileSync(path.join(quiDir, "config.json"), JSON.stringify(QUINKI_CONFIG, null, 2), "utf8");
    fs.writeFileSync(path.join(quiDir, "PROMPT.md"), QUINKI_PROMPT, "utf8");
  }
  const skillDir = path.join(skillsDir, "app-expert");
  if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), EXPERT_SKILL, "utf8");
  }
  const marketSkillDir = path.join(skillsDir, "quinki-market");
  if (!fs.existsSync(path.join(marketSkillDir, "SKILL.md"))) {
    fs.mkdirSync(marketSkillDir, { recursive: true });
    fs.writeFileSync(path.join(marketSkillDir, "SKILL.md"), MARKET_SKILL, "utf8");
  }
}
