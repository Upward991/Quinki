# Getting started

Quinki creates AI agents and orchestrates them — on your Mac, with your accounts. From download to your first reply takes about five minutes.

## What you need

- **macOS 14+** on Apple Silicon (M1 or later). Windows and Linux builds come after macOS; the web UI already works everywhere.
- About **200 MB** of disk space.
- One way to reach a model: a **subscription** (ChatGPT Plus/Pro, Claude Pro/Max, GitHub Copilot, SuperGrok), an **OpenRouter** account (free, pay per use), or **Ollama** running free on your Mac.

## 1. Install the app

One command — always installs the latest release:

```bash
curl -fsSL https://raw.githubusercontent.com/Upward991/Quinki/main/install.sh | sh
```

Or download the DMG from the [Releases page](https://github.com/Upward991/Quinki/releases) and drag Quinki into Applications.

Installing the app also installs the **CLI** (`quinki` lands in `~/.local/bin`, and PATH is updated for new terminals).

> First launch: if macOS is unsure about the app, allow it in **System Settings → Privacy & Security → Open Anyway**.

## 2. Connect a model

On first launch Quinki asks for a provider. Pick one:

- **Subscription** — sign in with your ChatGPT, Claude, Copilot or SuperGrok account. No API key to paste.
- **OpenRouter** — paste an API key: free account, pay per use, 200+ models from every provider.
- **Ollama** — free, runs locally. Quinki can install it for you: **Settings → Providers → Ollama → Install**.

Then choose your **default model** in Settings → Providers (or with the model picker in a new chat).

## 3. Your first chat

1. Open a chat from **Home** (or the ➕ in the sidebar)
2. Pick **Plan** (read-only: the agent explores and proposes) or **Build** (it can edit files and run commands) with the toggle in the composer
3. Type your message and press **Enter**

That is the whole loop. While the model works, the status pill shows what is happening (Thinking, Writing, Running a tool); press **Esc** to stop; press **Tab** anytime to switch Plan/Build.

## 4. Meet the agents

Every chat starts with one agent. Open the **Agents** tab to see them, edit their `PROMPT.md`, give them their own model, tools and skills.

The next step up is orchestration: put a team in a chat, choose one as **Orchestrator**, and it will delegate work to the others — you get one synthesized answer. [Guides](guides.html) has a walkthrough.

## Next steps

- [User Guide](user-guide.html) — the day-to-day tour: sessions, skills, notifications, the Market, the App Expert
- [Guides & Tutorials](guides.html) — task-based walkthroughs: first agent, scheduled tasks, Long Horizon, your phone
- [Inside Quinki](features.html) — how it works: sessions on disk, delegations, tasks, logs
- [CLI Reference](reference-cli.html) · [Files & Environment](reference-config.html) · [Troubleshooting](troubleshooting.html)

*Docs for AI agents: every page is plain Markdown in [`docs/`](https://github.com/Upward991/Quinki/tree/main/docs) — read the `.md` sources directly.*
