# Developer Guide

Build Quinki from source, understand the architecture, and create Market items.

## Repository layout

```
Quinki/
├── src/                  # React 19 + TypeScript frontend (Vite)
│   ├── App.tsx           # tab routing, expert mode, onboarding
│   ├── hooks/useSidecar.ts      # WebSocket client (JSON-RPC)
│   ├── hooks/useSidecarData.ts  # data layer (sessions, messages, streaming)
│   ├── components/       # ChatArea, ChatHeader, Composer, Sidebar, AgentsPanel,
│   │                     # SettingsPanel, MarketplaceView, LogPanel, HomeView...
│   └── index.css         # design system (CSS variables, 7 themes, transition: none)
├── src-tauri/            # Rust shell
│   └── src/lib.rs        # windows, tray, sidecar lifecycle, files, expert install/sync
├── sidecar-src/          # the engine (TypeScript, compiled with Bun)
│   ├── sidecar-ws.ts     # entry point: WebSocket server + OAuth callback server
│   ├── sidecar.ts        # JSON-RPC handler map (~80 methods)
│   ├── pi-bridge.ts      # Pi SDK bridge: sessions, streaming, delegations
│   ├── agent-handlers.ts # agent/skill/provider CRUD
│   ├── pool-router.ts    # process pool (spawn lazy, route by hash, shrink)
│   ├── scheduler.ts      # H24 schedules
│   ├── executor.ts       # task executions
│   ├── longhorizon.ts    # long horizon phases (plan → approve → run)
│   ├── providers.ts      # provider detection
│   ├── tab-plugins.ts    # back-end for installed tabs
│   └── vendor/           # Pi SDK (patched): see Vendor patches
├── scripts/
│   ├── build-sidecar.sh  # sidecar compile + secret injection (USE THIS)
│   ├── install-main.sh   # safe install (backup → ditto → re-sign → restart)
│   └── bundle-sidecar.mjs# esbuild bundle (dev)
└── src-tauri/            # Rust: windows, tray, dialogs, install/update, Expert sync
```

## Build from source

```bash
# 1. Frontend (TypeScript check + Vite + sidecar bundle)
npm install
npm run build

# 2. Sidecar binary: ALWAYS use the dedicated script.
#    It injects the GitHub OAuth secret from ~/.quinki/oauth.conf (never in the repo)
#    and copies the binary into src-tauri/resources/sidecar/
export PATH="$HOME/.bun/bin:$PATH"
bash scripts/build-sidecar.sh

# 3. Full app (frontend + Rust + DMG)
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri build

# 4. Install to /Applications
bash scripts/install-main.sh
```

**Never compile the sidecar with a raw `bun build --compile`**: without the `--define` injection of `QUINKI_GH_SECRET` the GitHub login fails in the built binary (the secret is read at runtime from `~/.quinki/oauth.conf` or from the build-time define).

### Ports

| Port | Process |
|---|---|
| 9182 | Main sidecar (pool-0, the router) |
| 9183 | App Expert sidecar |
| 9184+ | Pool workers (9184 + index) |

### Data directory (`~/.quinki/`)

| Path | Content |
|---|---|
| `agents/<id>/` | `config.json` + `PROMPT.md` per agent |
| `skills/<name>/SKILL.md` | skills (YAML frontmatter: name, description, flags) |
| `sessions/<key>.jsonl` | message tree per session |
| `quinki-sessions.json` | session metadata (model, thinking, mode, agents, folders) |
| `config.json` / `auth.json` | providers, defaults, encrypted API keys |
| `attachments/<session-key>/` | attachments |
| `github-auth.json` | Market login token |
| `market-registry.json` | installed item hashes + origins (anti-theft) |
| `oauth.conf` | GitHub OAuth secret (local only, never in the repo) |

## Sidecar architecture

- **Entry**: `sidecar-ws.ts`: WebSocket server on `QUINKI_WS_PORT`, monkey-patches `process.stdout` so anything written lands on the WS, hosts the OAuth callback HTTP server, exposes `globalThis.__quinki_handleLine`
- **`sidecar.ts`**: the RPC handler map. `handleLine` dispatches: pool routing first (session-bound RPCs go to the owning worker), then tab-plugin RPCs (`<tabId>:<method>`), then the local handler map
- **`pi-bridge.ts`**: PiBridge: sessions (Pi SDK SessionManager), system prompt builder, mode application, agent overrides, delegations, skills, attachments, streaming via `fs.writeSync(1, ...)`
- **Pool** (`pool-router.ts`): spawns `N−1` children eagerly at boot (`QUINKI_POOL_SIZE=16` explicit in `start.sh`). Session→child mapping by djb2 hash (`ownerPool`). Each process knows its `poolIndex` and only handles its own sessions (recovery, Long Horizon, events). Worker events go directly to the worker's WebSocket clients via `__quinki_broadcast`. On-open recovery is forwarded to the owning worker (`recoverOnWorker`). Orphaned workers from previous sessions are killed at pool init (single `lsof` nuke). Idle children (5 min) are shut down; they respawn on demand

**Build rules (critical)**:
- After modifying `dist/` (frontend only), force Rust recompile: `touch src-tauri/src/main.rs` before `npx tauri build`
- `dist/` must exist for `cargo check` to pass (`generate_context!` reads it)
- When testing builds, NEVER use `pkill -f "quinki-sidecar"` (kills the Expert sidecar too). Use `pkill -f "Quinki.app/Contents.*sidecar"`
- **Expert mode**: `QUINKI_ROLE=expert` on port 9183: session filtering (`__app_expert__` only), pool disabled, no scheduler

## Vendor patches (Pi SDK, vendored)

- `agent-session.js`: delegation entries filtered before LLM calls (zero context cost)
- `session-manager.js`: delegation entries appended to the tree; `buildSessionContext()` includes them
- `compaction.js`: token estimate via BPE tokenizer (gpt-tokenizer, cl100k_base)
- `openai-completions.js`: system role always `system` (Ollama compatibility)
- `model-registry.js`: model registry additions

## Creating Market items

Five categories, each a package with `manifest.json`:

| Category | Files | Notes |
|---|---|---|
| **tab** | `manifest.json`, `index.html`/JS, optional `server.js` (back-end, RPC via `<tabId>:<method>`, limited context) | Frontend rendered in a sandboxed runtime; server code runs in the sidecar |
| **skill** | `SKILL.md` (YAML frontmatter + body) | Injected into the agent system prompt |
| **agent** | `agents/<id>/config.json` + `PROMPT.md` | Model, thinking, tools, skills |
| **mcp** | `*mcp.json` config | stdio or url servers |
| **theme** | theme JSON | Colors as CSS variables |

Publish from the app: **Market → Publish** → login with GitHub → pick your items → choose a license (default MIT) → confirm ownership → the app forks the market repo, opens a pull request, and the CI validates (structure, static scan, secret detection, VirusTotal for binaries) and auto-merges.

Item rules: you must own what you publish; no malware; declare your license honestly. Abuses: open an Issue (takedown process, see [TERMS](../TERMS.md)).

## Testing

Manual testing (no automated suite yet):

```bash
# Dev run
npx tauri dev

# Clear webview caches after reinstalling
rm -rf ~/Library/WebKit/com.quinki.app ~/Library/Caches/com.quinki.app
```

## Conventions

- English for all code, comments and UI text
- Colors via CSS variables (`var(--q-*)`), never hardcoded hex
- `transition: none` on all animations (design-system rule)
- 12px spacing standard
- Commit before/after every change; small focused commits