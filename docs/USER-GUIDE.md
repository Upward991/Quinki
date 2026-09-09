# User Guide

> Everything you need to install, configure and use Quinki.

## 1. Installation

1. Download the latest DMG from the [Releases](../../releases) page
2. Open the DMG and drag **Quinki** into Applications
3. **First launch**: right-click the app → **Open** (macOS Gatekeeper: the app is not notarized yet)
4. Quinki lives in the menu bar/tray; closing the window keeps it running

**System requirements**: macOS on **Apple Silicon**. No Node.js or other runtime required: everything is bundled.

## 2. Choose an AI provider

Open **Settings** and configure at least one provider:

| Provider | How to connect | Notes |
|---|---|---|
| **OpenAI** | Sign in with ChatGPT | Uses your ChatGPT Plus/Pro subscription. No API key needed. |
| **Anthropic** | Sign in with Claude | Uses your Claude Pro/Max subscription. No API key needed. |
| **Ollama** | Install Ollama | Free, fully local. Install from ollama.com, models appear automatically |
| **OpenRouter** | Sign in with OpenRouter | Access to 300+ models, pay-per-use. Free account available. |
| **GitHub Copilot** | Sign in with GitHub | Uses your Copilot subscription ($10/mo). Access to Claude and GPT models. |
| **xAI (Grok)** | Sign in with Grok | Uses your SuperGrok or X Premium subscription. |

Click **Sign in** on any provider to connect with your existing account. No API keys to manage, no separate billing: use the subscriptions you already pay for.

Prefer pay-per-use? OpenRouter gives you 300+ models with a single account. Prefer free? Ollama runs models locally on your Mac.

Paste your API key in the provider row (stored encrypted in your OS keychain), enable the models you want, and set your default model.

## 3. Your first chat

1. Go to **Home** → open a chat (or the sidebar ➕)
2. Pick a mode with the toggle in the composer:
   - **Plan**: the agent can only read/explore (safe)
   - **Build**: full filesystem access (it can edit and run commands)
3. Type your message. Use `@agentname` to address a specific agent
4. Toggle **thinking** on for maximum reasoning on every model

### Modes

- **Plan** = read-only tools (read, grep, find, ls). The agent explores and proposes, changes nothing.
- **Build** = all tools, including write/edit/bash. Use it when you want the agent to act.

## 4. Agents and skills

- **Agents** live in `~/.quinki/agents/<id>/`: each has a `PROMPT.md`, its own model, thinking level, tools and skills
- The **Orchestrator** is the default system agent: it can delegate work to other agents (`delegate_to_agent`): delegations appear as collapsible blocks and cost zero context in the orchestrator's conversation
- **@tag routing**: start a message with `@agentname` to talk to that agent directly; in a multi-agent chat you must tag someone (or add the Orchestrator)
- **Skills** are knowledge modules (`SKILL.md` with frontmatter). Attach them to agents or inject them per-message with `/skill`
- Manage everything in the **Agents** tab

## 5. Sessions

- **Folders** with drag & drop, rename, nesting
- **Search**: full-text across session titles and message history (with date/time filters)
- **Export**: Markdown or HTML (faithful dark theme)
- **Multi-window**: right-click a session → open in new window; windows remember position
- **Compaction**: per-session auto-compaction at 80% of the context window (toggle in the chat header)
- **Export & attachments**: drag files into the composer; agents read them on demand

## 5b. Quick Chat

Quick Chat is a floating window for questions on the fly: you do not need to switch to the main app or find a chat.

- Press the global shortcut (default: Option+Space) from anywhere, even when Quinki windows are closed
- Or left-click the Quinki icon in the macOS menu bar
- Type your question and press Enter: the response streams right in the window
- When you close it, the session appears in your sidebar like any other chat
- The window remembers the size you prefer

You can change the shortcut from Settings, Shortcuts.

## 5c. Keyboard shortcuts

All shortcuts are listed in Settings, Shortcuts. The most used:

| Shortcut | Action |
|---|---|
| Tab | Switch Plan / Build mode (anywhere in the chat) |
| Enter | Send message |
| Ctrl+Enter | Steering: add context while the model is generating |
| Esc | Stop generation or close open menus |
| / | Open the slash menu (model, thinking, reset, export) |
| @ | Tag an agent in multi-agent chats |
| Option+Space | Quick Chat (configurable) |

## 5d. Automatic recovery

When Quinki is closed during generation (or the model connection drops), the session is automatically recovered:

- The status pill shows "Recovering" (orange) when you open an interrupted chat
- The recovery prompt appears in the chat as a regular message bubble, in real-time
- If the model fails, Quinki retries automatically (3 quick retries, then slower: 5 min, 15 min, 30 min)
- Press Stop at any time to prevent further retries
- In Long Horizon mode, the support agent's guiding messages also appear in real-time

## 6. Notifications

Per-chat notification modes: **All**, **Messages**, **Tasks**, **Muted**. macOS notifications require permission (Settings → Notifications). Unread markers show where you left off.

## 7. H24 (always-on work)

- **Scheduler**: create scheduled agent tasks in the Calendar/Tasks view; executions run headless with full logging
- **Recovery**: interrupted turns resume automatically; a stuck stream (no activity for 45s) is detected and re-prompted
- **Long Horizon**: for big goals: plan first, approve, then let it run with phase tracking

## 8. The Market

Browse and install community content: **tabs** (interactive panels), **skills**, **agents**, **MCP servers**, **themes**.

- **Install**: one click; uninstall from the same page
- **Publish**: log in with GitHub (browser flow), pick what you created, choose a license, confirm you own the content → submit. Your submission goes through automatic validation (structure, static scan, secret detection, VirusTotal for binaries) and merges automatically when it passes
- **Your items**: update (new version) or remove via pull requests; if an item disappears from the repository you get a notice
- Publishing requires a GitHub account and confirming you own the content (see [TERMS](../TERMS.md))

## 9. The App Expert

The **App Expert** is a special agent that can modify Quinki itself. Recommended setup:

1. In Quinki: **Expert tab** → select the folder containing the Quinki source → Start session
2. Install the **App Expert app** (the separate app): the same binary running independently
3. Chat with the Expert from its own app while Quinki keeps running

**Sync**: when the Expert updates Quinki, open the Expert app header (rotate icon) → **Sync Expert App** to apply the same update to the Expert itself, then Restart. **Rollback** restores the previous version if a sync went wrong. Both apps share all data.

## 10. Where your data lives

Everything is in `~/.quinki/`:

| Path | Content |
|---|---|
| `agents/` | agent configs + PROMPT.md |
| `skills/` | installed skills |
| `sessions/` | chat history (one .jsonl per session) |
| `attachments/` | chat attachments |
| `config.json`, `auth.json` | settings + encrypted API keys |
| `github-auth.json` | Market login token |

Uninstalling the app never deletes your data.

## 11. FAQ

**Is my chat data sent anywhere?** Only to the AI provider you configured. Quinki has no servers and no telemetry. See [PRIVACY](../PRIVACY.md).

**Is it free?** Yes, AGPL-3.0 open source. You pay nothing; you use your own provider keys (or a local Ollama, which is free).

**Does it work offline?** With a local provider (Ollama) yes: fully offline.

**Can I use multiple models in one chat?** Yes: tag agents with `@name`, or let the Orchestrator delegate.

**Where are my API keys stored?** Encrypted in your OS keychain, referenced locally by the app.

**Is my data used for training?** Not by Quinki (no data leaves your machine except to your chosen provider). Your provider's policy applies to your chats.