# Quinki

**AI-powered desktop chat application with multi-agent support, skills, and self-modification capabilities.**

[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/frontend-React%2019-61dafb)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178c6)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-All%20Rights%20Reserved-red)](LICENSE)

## What is Quinki?

Quinki is a desktop AI chat application that lets you converse with large language models (Anthropic, OpenAI, OpenRouter, Ollama, and more) with first-class support for:

- **Multi-agent workflows** — chat with multiple AI agents, delegate tasks between them, and coordinate complex work via an Orchestrator.
- **Skills** — installable knowledge modules that give agents domain-specific expertise (codebase maps, search strategies, coding standards, etc.).
- **Tools** — agents can read, write, edit, search, and execute bash commands on your filesystem.
- **Plan & Build modes** — switch between read-only exploration (Plan) and full filesystem access (Build) per chat session.
- **File attachments** — drag and drop files into any chat; agents read them on-demand.
- **Delegations** — the Orchestrator can delegate tasks to specialized agents, with full conversation tree persistence.
- **Session management** — folders, drag-and-drop reordering, search, export (Markdown/HTML), and context window tracking.
- **Quinki Expert** — a built-in agent that can modify, fix, and improve Quinki itself, running as a separate app with its own sidecar.

## Architecture

```
React (src/)  ←──WebSocket/JSON-RPC──▶  sidecar binary (sidecar-src/)  ──API──▶  Pi SDK
   UI + state (hooks)                       compiled bun binary              agent runtime
```

- **Frontend** — React 19 + TypeScript + Vite + Tailwind CSS v4. Handles all UI and state management.
- **Tauri 2** — Native shell (Rust). Window management, tray icon (main app), sidecar lifecycle, file dialogs, attachments, expert app install/sync.
- **Sidecar** — Single compiled binary (`quinki-sidecar-ws`) built with `bun build --compile`. No Node.js or external runtime required. Includes WebSocket server + JSON-RPC handlers + Pi SDK bridge.

### Two separate apps

Quinki ships as two completely independent apps:

1. **Quinki** (main app) — Full UI with chat, sidebar, agents panel, settings, log, and home. Sidecar on port 9182. Tray icon (Show / Restart / Quit).
2. **Quinki Expert** (separate app) — Minimal chat-only UI for the built-in developer agent. Runs as a completely independent process and bundle with its own sidecar on port 9183. No tray icon. A watchdog restarts the sidecar if it crashes.

Both apps share the same data directory (`~/.quinki/`), so agents, skills, sessions, and settings stay in sync automatically.

### Expert app sync

When Quinki is updated, the user syncs the Expert app from Settings → Quinki Expert → "Sync Expert App". This copies the new binary and sidecar to the Expert app. If the Expert app is running, a restart button appears. If it's closed, the new version is picked up next time it opens.

## Getting started

### Prerequisites (development only)

- [Bun](https://bun.sh/) (for compiling the sidecar binary)
- [Rust](https://www.rust-lang.org/) (stable toolchain)
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- Node.js 18+ (for Vite frontend build only — not needed at runtime)

### Install dependencies

```bash
npm install
```

### Development

```bash
npx tauri dev
```

### Build

```bash
# Build frontend
rm -rf dist node_modules/.vite && npx vite build

# Recompile sidecar (if sidecar code changed)
cd sidecar-src && bun build --compile --target=bun-darwin-arm64 sidecar-ws.ts --outfile quinki-sidecar-ws
cp quinki-sidecar-ws ../src-tauri/resources/sidecar/

# Build native app
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri build
```

### Install (macOS)

The app is self-contained — no Node.js, Bun, or external dependencies required at runtime. Only API keys need to be configured after install.

```bash
ditto "src-tauri/target/release/bundle/macos/Quinki.app" /Applications/Quinki.app
```

## Default agents

Quinki seeds two default agents on first launch:

- **Orchestrator** — Coordinates other agents. Delegates tasks via the `delegate_to_agent` tool. Talks directly to the user when no agent is tagged.
- **Quinki Expert** — Automatic developer of the Quinki app. Can read, modify, build, and install new versions of Quinki from within itself. Runs as a separate app to avoid self-destruction during updates.

Custom agents can be created from the Agents panel. Each agent has its own PROMPT.md, config, skills, and tools.

## Skills

Skills are installable knowledge modules (SKILL.md files with YAML frontmatter) that give agents domain-specific expertise. Skills can be:

- Installed from GitHub repositories or local directories
- Activated per-message via the `/skill` slash menu
- Automatically injected into the system prompt (one-shot per message)
- Delegated to other agents during orchestrator workflows

## Data directory

Quinki stores all user data in a `.quinki/` directory in the user's home:

```
~/.quinki/
├── agents/           # Agent configs + PROMPT.md
├── skills/           # SKILL.md files
├── sessions/         # .jsonl message history
├── attachments/      # File attachments per session
├── config.json       # Global settings + providers
├── auth.json         # API keys (encrypted)
├── models.json       # Model definitions
└── .expert-needs-restart  # Flag file for Expert app sync
```

## Supported providers

- **Anthropic** (Claude)
- **OpenAI** (GPT, o1, o3)
- **OpenRouter** (multiple models)
- **Ollama** (local models)
- **Moonshot** (Kimi)
- **GLM** (Zhipu)
- Any OpenAI-compatible API

Provider detection is by capability (trying `/api/tags`), not by provider name.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Native shell | Tauri 2 (Rust) |
| Sidecar | Compiled bun binary (`bun build --compile`), WebSocket, JSON-RPC |
| AI SDK | Pi SDK (`@earendil-works/pi-coding-agent`) |
| Markdown | react-markdown, remark-gfm, rehype-highlight |
| Tokenizer | gpt-tokenizer (BPE, cl100k_base) |

## License

All rights reserved. This software is proprietary and not licensed for redistribution, modification, or commercial use without explicit permission from the author.
