
## 1.0.0-beta.1 (pre-release) — 8 September 2026

### Subscription OAuth Providers (Major)
- Added 4 new built-in providers that use your existing AI subscriptions:
  - **OpenAI**: Sign in with ChatGPT Plus/Pro — GPT-5.4/5.5/5.6 models
  - **Anthropic**: Sign in with Claude Pro/Max — Claude Opus/Sonnet/Haiku models
  - **GitHub Copilot**: Sign in with GitHub ($10/mo) — Claude + GPT models via Copilot
  - **xAI (Grok)**: Sign in with SuperGrok/X Premium — Grok 4.x models
- No API keys needed: connect with your existing account via OAuth
- Provider order: OpenAI → Anthropic → Ollama → OpenRouter → GitHub Copilot → xAI
- Auto-refresh of OAuth tokens before expiry

### Recovery System (Major fixes)
- Fixed critical bug: `already-answered` check now searches from the END of history (findLastIndex), not the beginning. Previously, if you sent the same text multiple times, the recovery would incorrectly think the turn was already answered and never fire
- Removed the `concurrent-recovery-in-flight` lock (was redundant — the promise chain already serializes turns per session, and the lock could get permanently stuck)
- Added 30s timeout on recovery send: if the LLM call doesn't start in 30s, the lock is released and the promise chain is reset
- Marker `pending-turn.json` is now deleted when recovery fails (was staying forever, causing false "Recovering" status)
- "Recovering" status is now truthful: shown ONLY when the marker exists (recovery genuinely in progress)
- Main process now spawns the owning worker and queues a specific recovery RPC (instead of relying on unreliable worker boot scans)
- Worker events reach the frontend via stdout fallback even before the router connects

### cancel_schedule Tool (New)
- Agents can now cancel scheduled tasks: `cancel_schedule` tool with scheduleId parameter
- Available in the Agents tab UI (toggle per-agent)
- Registered in both new-session and mid-session paths

### Market
- Auto-clear market cache on version change (no stale catalog after updates)
- Empty catalog results are no longer cached (previously caused 30-minute delays)
- 5-minute grace period during CI validation (no more false "removed from repo")
- Market repository cleaned: all test packages removed, ready for community content
- Market README with recommended sources (250+ skills from 7 repos)

### Onboarding
- Removed OpenRouter/Ollama recommendation cards from tutorial (now generic: "use your existing subscription")
- Removed em dashes from user-visible text

### Bug Fixes
- `resetSession` now clears the promise chain, guards, streaming buffers, AND MCP clients (previously: chat died after reset)
- Ghost re-send in fallback: hard-reset session before re-send (connection-refused left SDK in broken state)
- Executor cancel/stop now return `{ok: boolean}` instead of empty `{}`
- `getTaskStatus` now shows local time with timezone instead of UTC
- Italian error strings translated to English
- 2 dead RPC handlers removed (45+ still kept for safety)
- MCP package install: fallback to npm when Bun is not available
- Publish description extracted from actual content (PROMPT.md, SKILL.md, manifest.json)


## 1.0.0-beta.2 — 31 August 2026

### Process Pool (Major)
- Pool now works reliably across restarts: orphaned workers are automatically killed at boot
- Workers spawn eagerly (no lazy start) for instant availability
- Each worker's events go directly to its WebSocket clients (no router bottleneck)
- `QUINKI_POOL_SIZE=16` explicit in start.sh (fixes SIGKILL from os.cpus() in compiled binary)

### Recovery & Autoprompt (Major)
- Recovery now respects pool ownership: each process only recovers its own sessions
- On-open recovery is forwarded to the owning worker instantly
- Steering (Ctrl+Enter) no longer triggers the autoprompt
- Status pill "Recovering" (orange) shows immediately when opening an interrupted chat
- Badge now counts conversation turns, not individual messages
- Stale `isStreaming` state no longer blocks recovery (10s inactivity threshold)

### Long Horizon Mode
- Support agent now works on ALL sessions (pool-aware), not just main-owned sessions
- Workers pick up Long Horizon activations from disk via periodic rescan

### Quick Chat (New)
- Floating chat window for quick questions (opens from tray icon left-click or ⌥+Space)
- Window remembers user's preferred size (persists across reinstalls)
- Global shortcut configurable from Settings → Shortcuts
- Session created on first message, appears in sidebar instantly
- Tutorial closes Quick Chat only when user starts the tour (skip keeps it open)

### Context Menu (New)
- Custom Quinki-styled context menu for text inputs (Cut, Copy, Paste, Select All)
- No macOS native menu on right-click (Reload/Inspect completely blocked)
- No auto-select on right-click (selection is preserved)
- Paste uses execCommand insertText (React-safe, text never disappears)
- Smart positioning: menu never goes outside window bounds
- Works in all windows (Main, Expert, Quick Chat)

### UI Improvements
- Shortcuts section in Settings (all keyboard shortcuts listed, Quick Chat shortcut configurable)
- Modal improvements: bigger AddItems modal, no redundant X button, scroll lock
- Checkbox click fix (stopPropagation)
- Tab key switches Plan/Build anywhere in chat area
- Expert app icon now bundled inside app resources

### Bug Fixes
- Delegation crash fixed (`#translateThinkingForModel` this → self)
- App notarization: self-signed certificate for stable macOS permissions
- Double badge count fixed (turns instead of messages)
- Steering no longer triggers autoprompt
- Pool workers no longer crash with EADDRINUSE after restarts

### Communication (Critical)
- Fixed event delivery: all sidecar-to-frontend events now use JSON-RPC format consistently. Previously, events sent via direct WebSocket used raw format (`{type: ...}`) which the frontend could not dispatch (it expects `{method: ...}`). This was the root cause of invisible autoprompt bubbles, missing status pills, and delayed streaming
- Both autoprompt (recovery) and support agent (Long Horizon) messages now appear in real-time in the chat

### UI Fixes
- Reload chat button restored in chat header (was accidentally removed)
- Reload is now visually evident: messages clear and loading skeleton shows before re-fetch
- Quick Chat sessions appear in sidebar instantly (Tauri cross-window events, zero polling)

### 01 September 2026 — Final fixes

- **Removed `--smol` from Bun runtime** (critical): was limiting sidecar heap to ~256MB, causing OOM crashes on large sessions. Expert sidecar was crashing every ~4 minutes with 500K+ token context. Pool workers also at risk with large chats. Bun now uses full available memory.
- **Fixed event delivery (root cause)**: `#sendToWs` now always converts payloads to JSON-RPC format before sending. Previously, raw payloads (`{type: ...}`) sent directly to WebSocket were silently ignored by the frontend (it only dispatches `{method: ...}`). This fixed: invisible autoprompt bubbles, missing status pills, delayed streaming, missing support agent messages.
- **Quick Chat session focus**: clicking a Quick Chat session in the sidebar now focuses the Quick Chat window (same behavior as separate chat windows), preventing the session from opening in both windows simultaneously.
- **Tutorial no longer appears in Quick Chat** when already completed, skipped, or rejected. Starting the tutorial from Quick Chat closes it and opens the tour in the main window; skipping keeps Quick Chat open.
- **Reload button restored** in chat header (was accidentally removed). Reload now visibly clears messages and shows loading skeleton before re-fetching.
- **Context menu final behavior**: custom Quinki-styled menu on text inputs only (Cut/Copy/Paste/Select All with working clipboard). Native WKWebView Reload menu blocked everywhere via preventDefault, while app's own React context menus (sidebar, tabs) continue to work via event bubbling.
- **Context menu Paste**: uses `execCommand('insertText')` for React-safe insertion (text never disappears on re-render). Clipboard read via Tauri plugin with correct `__TAURI_INTERNALS__.invoke` path.
- **Known limitation**: on API error (500), recovery fires on next 30-second driver cycle instead of immediately. Will be improved in v1.1.
- **Recovery speed**: auto-reprompt on API error (500) now fires within 2 seconds (was 30 seconds). The "Recovering" pill appears immediately, the autoprompt follows within 2 seconds.
