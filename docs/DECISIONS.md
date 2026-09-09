# Design Decisions

> Why Quinki is built the way it is. Each entry: the decision, the context, the alternatives considered, and the consequences accepted. Backed by measured data from the internal studies (`docs/B0-*`, `docs/A2.5b-*`, `docs/B4-*`).

---

## 1. Tauri 2 native shell (not Electron)

**Decision**: Tauri 2 (Rust shell + system webview) instead of Electron.

**Why**: an AI app with a sidecar already carries a Node-compatible runtime: an Electron shell would duplicate a full Chromium *and* a bundled Node. Tauri keeps the installer at ~35MB, the native shell (Rust) uses a few MB of RAM, and gives us real multi-window management, tray, dialogs and autostart without a framework.

**Trade-off**: two languages (TypeScript + Rust). Accepted: the Rust surface is deliberately thin (~2k lines: windows, files, sidecar lifecycle) while all product logic lives in the sidecar.

## 2. A separate sidecar process (Bun binary), not the UI runtime

**Decision**: all agent logic runs in one compiled Bun binary (`quinki-sidecar-ws`), reached over WebSocket.

**Why**: the agent runtime (Pi SDK) is JavaScript. Keeping it out of the UI process means: the UI stays responsive at 60fps even while the sidecar burns CPU on a 100k-token stream; the sidecar can crash/restart without losing the UI; the same binary powers main, Expert and every pool worker.

**Measured**: before optimization the sidecar idled at 640MB–2.1GB; after the B0 pass (session load fixes, stale buffers, GC discipline) it sits at **~92MB idle**, ~300MB with an active session.

## 3. WebSocket + JSON-RPC as the app contract

**Why**: the protocol was born with the first (Dart) client and survived the UI migration untouched: `{jsonrpc, method, params}` calls with `id`/result, plus notifications (`stream_event`, `compaction`, `agent_status`, …). NDJSON lines keep streaming trivial. Keeping the contract meant the React frontend swapped in without touching the engine.

**Trade-off**: a WebSocket per app window; the frontend connects directly to `ws://127.0.0.1:9182` (main) or `:9183` (Expert).

## 4. Process pool, not worker threads (B4)

**The problem**: ~100 streaming sessions share one event loop; synchronous work around the agent loop (context, tools, jsonl, hashing) saturates it: RPCs queue and time out, RSS climbs to ~5GB.

**Alternatives considered** (from the concurrency study):
- *Worker threads*: the Pi SDK is **not thread-safe**: every worker needs its own copy of the engine (memory × N), and shared files (session jsonl, registries) need locking
- *Concurrency cap*: turns "in queue" = a chat waits behind another chat; unacceptable
- *Single process, optimized*: measured ceiling ~30-40 concurrent streams before timeouts

**Chosen**: a **process pool of the same binary**: the pattern already proven by the Expert (a second sidecar process), generalized to N. Main = router + pool-0; children spawn lazily (ports 9184+), sessions map to workers by djb2 hash; reads stay on the main sidecar (disk/registry reads are ms: routing them would lazy-spawn workers and slow chat opening); writes and LLM work route to the owning worker; idle children shut down after 5 minutes and respawn on demand; crashed children respawn and recovery resumes their turns.

**Consequences**: RAM scales with active sessions (the cost of the work: fine on a modern Mac); 100 parallel sessions measured with 0 RPC timeouts.

## 5. The App Expert is a separate *app*, not a tab

**Why**: an agent that rebuilds and restarts Quinki would kill its own host process if it lived inside it. Running the same binary with `QUINKI_ROLE=expert` on its own port solves it: the Expert stays alive while Quinki restarts into the new build.

**Design**: one binary, two roles (`is_expert_mode()` checks the executable path). Both apps share `~/.quinki/`: agents, skills, sessions, keys: so no synchronization layer exists. Sync copies the newest build into `App Expert.app`; the Expert app can also sync/rollback itself from its own header.

## 6. WebSocket + JSON-RPC between UI and sidecar

**Context**: the protocol started as NDJSON over stdin/stdout with a Dart client, then the UI moved to React. WebSocket + JSON-RPC was kept deliberately:

- The contract (methods, params, events) is already well-defined and battle-tested
- NDJSON streaming maps 1:1 to LLM token streams
- The frontend talks to the sidecar directly (not through Rust), keeping the Rust shell thin

**Consequence**: the Rust layer never parses chat traffic; it manages windows, files and the sidecar lifecycle only. Clean separation: UI ↔ sidecar is the stable contract; Rust is plumbing.

## 7. The Market lives on GitHub (no backend)

**Why**: a marketplace normally needs servers, accounts, moderation tooling and money. GitHub provides, for free: hosting, API, accounts (GitHub OAuth), pull requests, CI, binary storage and abuse reporting. Quinki's Market is *the* repository; the app is a client of it.

**Consequences**: the catalog is public data on GitHub; browsing works with the public API; publishing uses OAuth (browser flow, token stored locally); multi-source browsing (any GitHub repo can act as a market) falls out of the same API.

## 8. Fork + PR + auto-merge (no human gatekeeper)

**Why**: classic marketplace review is a bottleneck: one person becomes the gatekeeper, uploads stall, the catalog dies. Quinki validates automatically instead: structure check, static scan, secret detection, VirusTotal for binaries, then auto-merge. A malicious PR fails validation; a good one merges in minutes.

**Consequences**: publishing is instant for honest authors; the anti-theft registry (hash + origin) blocks re-uploading someone else's package; takedown is an Issue (Safe Harbor process).

## 9. AGPL-3.0 for the app code

**Why**: MIT would allow a closed commercial fork of the same product with zero contribution back. AGPL-3.0 keeps the app free for everyone *and* forces any derivative (including services) to open its code. The copyright holder (the project) can still license commercially when monetization arrives. Already-published versions stay AGPL forever; future versions may change license: the standard MongoDB/Elastic pattern.

## 10. Local-first data in `~/.quinki/`

Everything: sessions (`.jsonl` trees), agents (config + PROMPT.md), skills, settings, encrypted keys, attachments, notifications: lives in `~/.quinki/`. No server exists to receive anything else. Consequences: offline-first, privacy by default, and the two apps (main + Expert) share data because they share the folder.

## 11. Compaction at 80% with BPE-accurate counting

**Why BPE**: the vendored compaction estimator used naive heuristics and mis-measured context, compacting too late (overflow) or too early. A patched `compaction.js` uses a real cl100k tokenizer.

**Why 80%**: enough headroom for the largest single turn (a huge tool result) before hitting the hard limit; per-session toggle because some chats (Expert) need different behavior than others.

## 12. Universal thinking

One On/Off default for new chats instead of low/medium/high pickers: `on` maps to the **maximum** thinking level the current provider supports, corrected at runtime if the mapping would resolve lower than the provider max. Rationale: users should not have to know provider-specific level names; the app should always spend the maximum reasoning available unless explicitly off.

## 13. Recovery + stuck-turn detection (H24 correctness)

Sessions must survive app restarts, crashes and long absences (scheduler running tasks at night). Interrupted turns are resumed from persisted state at boot/respawn; streaming buffers carry timestamps and a buffer untouched for >45s is treated as stuck and re-prompted. H24 reliability is a product requirement, not an afterthought.

## 14. GitHub OAuth: browser flow + secret injection (not Device Flow)

The Market login uses the classic browser redirect (user clicks Authorize, comes back: one click). GitHub requires a client secret for the token exchange; the secret therefore lives in the compiled binary (injected at build time from `~/.quinki/oauth.conf`, never in the repository). **Trade-off accepted**: the alternative (Device Flow) has zero secrets but makes the user type a code into a web page. We chose the 1-click experience, matching every mainstream desktop app; the residual risk (app impersonation, no data access) has legal remedies (DMCA/takedown).

## 15. React + Tauri over Flutter

The original app was Flutter Desktop. The move to React 19 + Tauri 2 happened for three reasons: the Pi SDK bridge is JavaScript (one language boundary fewer), the Tauri shell is dramatically lighter than the Flutter desktop shell, and the React prototype ("Deep Cosmos" design system) reached production quality fast. The NDJSON/JSON-RPC contract with the sidecar survived the migration by design.

## 16. Timestamp injection into message metadata

Every message carries an injected timestamp (`[DD Mon YYYY, HH:MM:SS]`) as conversation metadata (via the vendor's conversation info, not message content): the model knows *when* things happen without the user repeating dates. Old-format metadata is stripped before the model sees it to avoid duplication.

## 17. Delegations in the conversation tree at zero context cost

Delegations are entries in the session tree (parentId chain), rendered by the UI as collapsible blocks. The vendored `agent-session.js` filters delegation entries out before LLM calls: the orchestrator's context never pays for delegated sub-conversations, while the UI keeps the full audit trail.

## 18. Per-session compaction toggle + read-state notifications

Notifications (All/Messages/Tasks/Muted per chat) and unread markers use persisted read-state files; recovery is event-based (no polling). Compaction is opt-out per session with a global default in Settings.

---

*Decisions live next to their studies: `docs/B0-indagine-performance.md`, `docs/B0c-virtualizzazione-design.md`, `docs/A2.5b-CONCORRENZA-STUDIO.md`, `docs/B4-STUDIO-PROCESS-POOL.md`, `docs/A4-MARKETPLACE-STUDIO.md` document the analysis that preceded each implementation.*