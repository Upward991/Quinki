# Files and environment

Everything Quinki knows lives in one folder: **`~/.quinki`**. This page documents it, so nothing is a black box — and so you can back it up, move it, or inspect it with any text editor.

## The data folder

### Folders

| Path | What it holds |
|---|---|
| `sessions/quinki/<chat>/` | The chat's conversation logs (append-only `.jsonl`), plus `chat-meta.json` — the chat's own truth: agents, working directory, overrides |
| `attachments/<chat>/` | Files attached to that chat |
| `workdir/<chat>/` | The chat's **own working directory** — where the agent creates things by default |
| `longhorizon/<chat>/` | Long Horizon: `plan.md`, `handoff.md`, `progress.json`, `state.json`, and the project's git `workdir/` |
| `agents/<id>/` | An agent: `config.json` (model, thinking, tools, skills, MCP), `PROMPT.md`, and its files |
| `skills/<name>/` | A skill: `SKILL.md` plus whatever it needs |
| `executions/<id>/` | A task run: `execution.json` (state, heartbeat) and `events.jsonl` |
| `cli-local/<chat>/` | The CLI's local working copy of a session |
| `tmp/` | The temporary area Quinki uses (the system temp is redirected here, by design) |

### Files

| File | What it holds |
|---|---|
| `quinki-sessions.json` | The chat list: labels, folders, order, per-chat settings |
| `quinki-folders.json` | The sidebar folders |
| `quinki-deleted-sessions.json` | Tombstones — a deleted chat never comes back |
| `quinki-providers.json` | Providers: endpoints, **encrypted** API keys, enabled models (`-backup.json` is the safety copy) |
| `models.json` | The model catalog the engine reads: context windows, capabilities |
| `settings.json` | The engine's settings (default model, default thinking) |
| `quinki-settings.json` | The app's settings: notifications, shortcuts, tabs, theme |
| `quinki-global.json` | Global defaults for tools and skills |
| `quinki-permissions.json`, `quinki-authorized-folders.json` | macOS permissions state and your **Authorized Folders** |
| `thinking-caps.json` | The thinking levels each provider actually accepts (learned automatically) |
| `schedules.json`, `task-reports.json` | Tasks, and the queue of results waiting to be reported |
| `remote.json`, `remote-devices*.json` | Remote access state and the paired devices (the App Expert has its *own* files) |
| `push-*.json` | Notification subscriptions and state |
| `quinki-debug.log` | The Log tab's file — only three streams are written (System Prompt, Thinking, LLM Catalog) |

> API keys are encrypted on disk and never leave your Mac except toward the provider they belong to. Deleting a key in Settings removes it from this file.

## Ports

All local, loopback only — nothing listens on the network unless you turn on the remote tunnel:

| Port | Who |
|---|---|
| `9182` | The engine of the main app |
| `9183` | The engine of the App Expert |
| `9184`+ | The engine's worker processes (created on demand for heavy work) |

## Environment

These are advanced switches — normal use never needs them. The main ones:

| Variable | Effect |
|---|---|
| `QUINKI_AGENT_DIR` | Use a different data folder instead of `~/.quinki` |
| `QUINKI_ROLE` | `main` or `expert`: which app this process belongs to |
| `QUINKI_WS_PORT` | The engine's port (default 9182 / 9183) |
| `QUINKI_AGENT_CWD` | Default working directory for agents without one |
| `QUINKI_POOL_SIZE` | How many worker processes the engine may use (default: number of CPU cores) |
| `QUINKI_POOL_EAGER` | `1` = start workers at boot instead of on demand |
| `QUINKI_POOL_IDLE_MS` / `QUINKI_POOL_STATUS_MS` | Idle-worker shutdown timing and its check interval |
| `QUINKI_SIDECAR_PORT` | Port the **CLI** connects to (9182 main, 9183 Expert) |
| `QUINKI_NO_UPDATE_CHECK` | `1` = the CLI skips the startup update check |
| `QUINKI_CLI_NO_BG` | `1` = the CLI does not set the terminal's background colour |
| `QUINKI_EXPERT` / `QUINKI_SESSION_KEY` | Used by `quinki expert` to target the App Expert session |
| `QUINKI_TEST_BRIDGE` | Development only: JS-injection bridge for automated UI tests. Never on in production |

## Backups

Copying the folder is a complete backup; restoring it restores everything (chats, agents, skills, tasks, settings). Keep the app closed while copying if you want a perfectly consistent snapshot.

Some files are also **self-healing**: if the provider config gets corrupted, Quinki restores it from its own backup at the next launch, and provider keys can be re-entered at any time in Settings.
