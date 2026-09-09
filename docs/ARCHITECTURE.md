# Architecture

> How Quinki works: the three layers, the main flows, and the design decisions behind them.
> This document is written from the source code. Last updated: August 2026.

## The three layers

```
React frontend (src/)  ←──WebSocket + JSON-RPC──▶  sidecar binary (sidecar-src/)  ──▶  Pi SDK
     UI + state                       compiled Bun binary (quinki-sidecar-ws)         agent runtime
        ▲                                        ▲
        └──────────── Tauri 2 shell (src-tauri/) ─┘  window mgmt, tray, sidecar lifecycle
```

1. **Frontend**: React 19 + TypeScript + Vite. All UI and state. Talks to the sidecar over WebSocket with JSON-RPC (calls get a response, notifications are fire-and-forget).
2. **Tauri shell**: Rust. Native window management (main window + chat windows), tray icon, file dialogs, attachments, export dialogs, autostart, sidecar process lifecycle, app install/update (DMG), App Expert install/sync/rollback.
3. **Sidecar**: one compiled Bun binary. WebSocket server + JSON-RPC dispatch + the Pi SDK bridge (sessions, streaming, delegations) + scheduler + executor + process pool + Market back-end (tab plugin RPC) + notifications. No Node.js required on the user machine.

The two apps: **Quinki** (main) and **App Expert**: are the same binary run twice with a different role flag. They share one data directory (`~/.quinki/`), so agents, skills, sessions, API keys and settings are shared by design. Ports: main sidecar **9182**, Expert sidecar **9183**, pool workers **9184+**.

## Sidecar components (`sidecar-src/`)

| File | Size | Role |
|---|---|---|
| `sidecar-ws.ts` | ~140 | Entry point of the compiled binary. WebSocket server, HTTP callback server for GitHub OAuth, monkey-patched stdout bridge. Connects to port 9182 (main) or 9183 (Expert via `QUINKI_WS_PORT`). |
| `sidecar.ts` | ~1250 | JSON-RPC dispatch. `handlers` map (~80 methods: sessions, agents, skills, notifications, Market install, executor, pool status). Exposes `globalThis.__quinki_handleLine`. Runs first-run seed. |
| `pi-bridge.ts` | ~7900 | The core. PiBridge class: agent sessions via Pi SDK, system prompt builder, Plan/Build mode, per-agent overrides (model/thinking), delegations, skills injection, attachments, timestamp injection, compaction, streaming via `fs.writeSync(1)` (bypasses Node stream buffering), persistence (`#save`/`#load`, `quinki-sessions.json` + per-session `.jsonl` trees). |
| `agent-handlers.ts` | ~720 | CRUD for agents/skills/tools/files. YAML frontmatter parsing, provider config, API keys (OS keychain), Market install/uninstall RPCs. |
| `pool-router.ts` | ~320 | B4 process pool (main sidecar only): spawn, routing, shrink, respawn. See below. |
| `scheduler.ts` | ~365 | H24 scheduler: persisted schedules, due checks, triggers `runTask` executions. |
| `executor.ts` | ~670 | Task executions engine: start/cancel/resume executions, events, messages (H24). |
| `longhorizon.ts` | ~740 | Long Horizon: plan → approve → run phases for long-running agent work, with recovery. |
| `mcp.ts` | ~340 | MCP server registry (add/remove/list), stdio/url servers. |
| `providers.ts` | ~440 | Provider detection by capability (not by name: Ollama-like detection via `/api/tags`), model fetch/sync, provider ordering. 6 built-in providers: OpenAI, Anthropic, Ollama, OpenRouter, GitHub Copilot, xAI. Subscription OAuth providers store access/refresh tokens in `providers.json` (field `subscription`). |
| `tab-plugins.ts` | ~120 | Back-end for installed tabs: runs each tab's `server.js`, routes RPC `<tabId>:<method>` with a sandboxed context (data dir access, whitelisted calls, logging). |
| `seed-defaults.ts` |: | First-run bootstrap: default agents (Orchestrator, App Expert) + `app-expert` skill. Only creates what is missing; never overwrites user data. |
| `vendor/` |: | Pi SDK (vendored, patched: see below) |

### Vendor patches (`sidecar-src/vendor/`)

The Pi SDK is vendored and patched at specific points (documented in the files):

- `openai-completions.js`: system role always sent as `system` (required by Ollama)
- `agent-session.js`: filters `role: "delegation"` before LLM calls (delegations live in the conversation tree at zero context cost)
- `compaction.js`: `estimateTokens` replaced with a BPE tokenizer (cl100k) for accurate compaction thresholds
- `model-registry.js`: model registry additions
- `agent-session.js` (compaction): `estimateTokens` patched with BPE counts

## Communication protocol

All events between sidecar and frontend use JSON-RPC 2.0 format: `{jsonrpc: "2.0", method: "...", params: {...}}`.
The frontend dispatches events by `method` field only. Raw payloads (`{type: "..."}` without `method`) are ignored.
The `#sendToWs` method in the sidecar ALWAYS converts payloads to JSON-RPC format before sending (direct WS, pool broadcast, or stdout fallback), ensuring no events are lost.

## The process pool (B4)

Goal: 100+ parallel sessions with no timeouts, without spawning one process per session.

- The **main** sidecar (`QUINKI_POOL_INDEX=0`, port 9182) spawns **N−1 child** sidecars (same binary) on ports 9184+, with `QUINKI_POOL_SIZE = min(cores, 16)` by default (explicit `QUINKI_POOL_SIZE=16` in `start.sh` for stability)
- **Eager spawn**: all children start immediately at boot (~1s). At pool init, any orphaned workers from a previous session are automatically killed (single `lsof` call on all pool ports)
- **Ownership**: every process (main and workers) knows `poolN` and its own `poolIndex`. The recovery system, Long Horizon support agent, and event routing all respect this ownership: each process only handles its own sessions
- **Routing**: session-bound writes/LLM work (`sendMessage`, `abort`, `set*`, `compactSession`, …) go to the owning child (djb2 hash of session key → pool index). Reads (`getHistory`, `getSessionMeta`, …) stay on the main sidecar: they read from disk/registry in milliseconds
- **Events**: worker events go DIRECTLY to the worker's WebSocket clients via `__quinki_broadcast` (no router bottleneck). The frontend connects to worker WS ports for streaming
- **Recovery**: each worker runs its own recovery driver for its own sessions. On-open recovery is forwarded to the owning worker instantly (`recoverOnWorker`). Interrupted sessions recover automatically with a visible status pill
- **Long Horizon**: every worker has its own Long Horizon instance. Activations are picked up from disk via `#rescan()` at every tick (cross-process coordination)
- **Shrink**: idle children for 5 minutes are shut down; they respawn on demand
- **Crash recovery**: a dead child is respawned and the recovery system resumes its interrupted turns
- The Expert app **never** enables the pool (dedicated guard)

Measured (enduro test on the installed app): 100 parallel sessions, 0 errors, 0 RPC timeouts, stable main-process memory.

## Frontend structure (`src/`)

- `App.tsx`: root: sidecar connection, tab routing (home/chat/expert/agents/calendar/log/settings/market + installed tabs), Expert-mode branch (separate app via `?expert=1`), onboarding, guard modals
- `hooks/useSidecarData.ts`: the data layer: sessions, agents, providers, messages, streaming, attachments, skill chips, agent overrides, folders, context tokens, notifications. One connection per window (main = 9182, Expert = 9183)
- `components/chat/`: ChatArea (message list, auto-scroll with pin, drag & drop), ChatHeader (agent/model/thinking pickers, mode toggle, export, App Expert modals), Composer (slash menu, @agent tags, skill chips, attachments, status pill), MessageBubble (markdown, thinking/tool toggles, delegation blocks, search highlight)
- `components/sidebar/Sidebar.tsx`: session tree with folders, drag & drop, multi-select, unread badges
- `components/agents/AgentsPanel.tsx`: agents, skills, tools, files, plan-mode toggles
- `components/settings/SettingsPanel.tsx`: providers, models, API keys, themes, notifications, permissions, App Expert sync
- `components/marketplace/`: Market: catalog, item detail, publish panel (picker with per-item version, license picker, rights confirmation), account
- `components/shared/AppShell.tsx`: tab bar + layout; `LogPanel`, `CalendarView`, `MarketplaceView`, `InstalledTabPanel` for installed tabs

Design system: CSS variables only (`--q-*`), no transitions/animations by policy, 12px spacing, per-tab accent colors.

## Tauri shell (`src-tauri/src/lib.rs`, ~2000 lines)

56 commands covering: window management (drag, maximize, multi-window, focus, close-to-tray), sidecar lifecycle (start via `start.sh`, `kill_backend`, `restart_app`), App Expert (install, open, sync, rollback, restart: with caller-dependent behavior), permissions (TCC status, authorized folders), attachments (copy, list, open), export (chat → file via native dialog), autostart, update (`apply_update`: download DMG → mount → install → optional Expert sync → detached restart), tray, notifications.

The main process owns the sidecar lifecycle: launches it via `start.sh` (env: `QUINKI_AGENT_DIR`, `QUINKI_WS_PORT`, …), monitors it, kills it on quit. `SHOULD_EXIT` + `kill_backend()` (synchronous) ensure the sidecar and watchdog die with the app.

## The App Expert

The Expert is the same binary with `QUINKI_ROLE=expert` on port 9183, running as a separate macOS app (`/Applications/App Expert.app`) whose working directory points to the Quinki source code. Its agent (`app-expert`) carries the codebase map as a skill.

- **Why a separate app**: an agent that rebuilds the app it runs in would kill its own process. As a separate process it can build, install and restart Quinki while staying alive.
- **Shared data**: both apps read/write the same `~/.quinki/`: no sync logic needed
- **Sync**: after the Expert updates Quinki, `Settings → App Expert → Sync` copies the new binary + sidecar into `App Expert.app`; the Expert shows a restart banner (`version.txt` compares git hashes)
- **Restart is caller-aware**: from the Expert, the app exits itself cleanly and a detached process reopens it; from the Main, a detached script restarts only the Expert

## Market

The Market lives on GitHub: the app is only a client:

- **Catalog**: the `quinki-market` repository holds `catalog.json` + `packages/<category>/<id>/` (manifest + files). Multi-source support lets users browse additional repos (skills as `SKILL.md`, agents as `agents/*.md`, MCP as `*mcp.json`)
- **Publish**: login with GitHub (browser OAuth flow, token persisted locally in `~/.quinki/github-auth.json`), pick what you created (tabs/agents/skills/MCP/themes), choose a license and confirm you own the content → fork + pull request
- **Auto-merge**: a GitHub Actions workflow validates every PR (structure, static scan, secret detection, VirusTotal for binaries) and merges automatically: no human gatekeeper
- **Integrity**: a local registry tracks published packages (hash + origin) to block re-uploading someone else's work; items removed upstream surface a dismissible "Removed from repo" notice
- **Tab back-end**: installed tabs can ship `server.js`, executed by the sidecar with a restricted context (data directory + whitelisted parent calls + logging)

## Persistence (`~/.quinki/`)

| File / dir | Content |
|---|---|
| `quinki-sessions.json` | Session entries (key, title, model, thinking, mode, agents, folder, compaction, overrides, skills, attachments) |
| `sessions/<key>.jsonl` | Message tree per session (user/assistant/delegation entries, persisted in order) |
| `agents/<id>/` | `config.json` + `PROMPT.md` per agent |
| `skills/<name>/SKILL.md` | Skills (YAML frontmatter: name, description, `disable-model-invocation`, `user-invocable`) |
| `config.json` / `auth.json` | Providers, models, enabled models, defaults, encrypted API keys |
| `notifications.json`, read-state files | Unread tracking per session/notify mode |
| `attachments/<session-key>/` | Chat attachments |
| `github-auth.json` | Market login token (local only) |
| `market-registry.json`, `published.json`, `tutorial.json` | Market registry, publish history, onboarding state |

## Main flows

### Send message
Composer → `sendMessage` RPC → (pool: routed to the owning worker) → PiBridge `send()` → system prompt build (PROMPT.md + skills + mode + timestamp + cwd) → Pi SDK stream → `stream_event` notifications → WebSocket → React state → UI. `agent_status` events drive the status pill; `streaming_stopped` (agent_end) clears streaming state.

### Delegations
The Orchestrator delegates via a custom tool → a temporary session is created for the target agent (own system prompt, own model/thinking, same mode rules) → events stream to the UI as a `delegation` block → the delegation is appended to the conversation tree. Vendor patch: delegation entries are filtered out of LLM context (zero token cost).

### Recovery
Interrupted turns are resumed automatically at boot/respawn (`pending-turns-recovered` markers). Streaming buffers carry timestamps: a buffer untouched for >45s is considered stuck and re-prompted.

### Compaction
Sessions with auto-compaction enabled compact at 80% of the model context window, using a BPE-accurate token estimate (vendored `compaction.js` patched). Per-session toggle; Expert sessions are recovered by the main sidecar only when the Expert sidecar is not running.

### Universal thinking
One On/Off toggle for new chats. `on` maps to the **maximum** thinking level the provider supports: for any provider, with an automatic correction at runtime if the level maps lower than the provider max.

## Build

**Important**: `BUN_OPTIONS="--smol"` was removed from all sidecar start scripts (01 Sep 2026). It limited Bun's heap to ~256MB, causing OOM crashes on sessions with large contexts (500K+ tokens). Bun now uses full available memory.

## Build

- **Frontend**: `npm run build` (Vite, TypeScript check, sidecar bundle)
- **Sidecar binary**: `bash scripts/build-sidecar.sh`: compiles `sidecar-ws.ts` with Bun (`--compile`) injecting the GitHub OAuth secret from `~/.quinki/oauth.conf` (never stored in the repo) and copies it into `src-tauri/resources/sidecar/`
- **Full app**: `npx tauri build` (frontend + Rust + DMG)
- **Install**: `bash scripts/install-main.sh` (backup → ditto → re-sign → restart sidecar → reopen)

See [DEVELOPER.md](DEVELOPER.md) for the full developer guide and [DECISIONS.md](DECISIONS.md) for why each design decision was made.