# Quinki

**Your AI subscriptions, in one app.**

Quinki is a native macOS desktop app that lets you chat with AI models using the subscriptions you already have — ChatGPT Plus, Claude Pro, GitHub Copilot, SuperGrok — plus free options like Ollama and OpenRouter.

![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-blue)
![Version](https://img.shields.io/badge/version-1.0.0--beta.1-orange)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## What is Quinki?

Quinki is an AI chat desktop app with a difference: it uses **your existing subscriptions** to power the AI. No new API keys, no new billing — just sign in with the account you already pay for.

### Providers (built-in)

| Provider | Sign in with | Models |
|----------|-------------|--------|
| **OpenAI** | ChatGPT Plus/Pro subscription | GPT-5.4, GPT-5.5, GPT-5.6 series |
| **Anthropic** | Claude Pro/Max subscription | Claude Opus 5, Sonnet 5, Haiku 4.5 |
| **Ollama** | Free, runs locally on your Mac | Any local model (Llama, DeepSeek, etc.) |
| **OpenRouter** | Free account, pay-per-use | 200+ models from all providers |
| **GitHub Copilot** | Copilot subscription ($10/mo) | Claude + GPT models through Copilot |
| **xAI (Grok)** | SuperGrok or X Premium subscription | Grok 4.3-4.6 |

### Features

- **Chat** with streaming responses, thinking traces, and model switching mid-conversation
- **Agents** — create custom assistants with specific tools, skills, and model overrides
- **Skills** — teach agents specific tasks with SKILL.md files
- **Delegation** — let an orchestrator agent delegate to specialized agents
- **MCP** — connect Model Context Protocol servers (browser automation, search, databases, etc.)
- **Market** — browse and install community-made tabs, agents, skills, MCP servers, and themes
- **Scheduled Tasks** — tell an agent to do something later ("tomorrow at 7am, do X")
- **Long Horizon** — multi-step autonomous execution with planning and progress tracking
- **App Expert** — a built-in agent that can modify and improve Quinki itself
- **File Attachments** — drag files into chat, the model reads them
- **Themes** — 7 built-in themes, custom themes from the market

## Install

### Beta (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/Upward991/quinki/main/install.sh | sh
```

### From DMG

1. Download the latest DMG from [Releases](../../releases)
2. Open the DMG and drag Quinki to Applications
3. **Important**: On first launch, right-click Quinki.app → "Open" (bypass Gatekeeper)

> ⚠️ **Beta notice**: This is a beta release. The DMG is not notarized yet (requires Apple Developer Program). The curl-installer bypasses this issue. Notarization is a donation goal — help us reach it!

## Getting started

1. **Open Quinki** — you'll see a guided tutorial
2. **Go to Settings → Providers** — sign in with any subscription you have:
   - ChatGPT Plus/Pro → click "Sign in" on OpenAI
   - Claude Pro/Max → click "Sign in" on Anthropic
   - No subscription? → Set up Ollama (free, local models) or OpenRouter (free, pay-per-use)
3. **Pick a model** — the model selector in the chat header shows all your available models
4. **Start chatting!**

## Recommended market sources

The Quinki Market can browse external GitHub repositories. Add these to get 250+ skills and MCP servers instantly:

### Skills

| Repository | Skills | Best for |
|-----------|--------|----------|
| [anthropics/skills](https://github.com/anthropics/skills) | 20 | Official Anthropic skills: canvas design, algorithmic art, brand guidelines |
| [bergside/awesome-design-skills](https://github.com/bergside/awesome-design-skills) | 67 | UI/UX design, branding, layout, visual design |
| [gamedev-skills/awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) | 74 | Game development: Godot, Unity, Unreal, Phaser |
| [SnailSploit/Claude-Red](https://github.com/SnailSploit/Claude-Red) | 78 | Security testing, pentesting, red teaming |
| [obra/superpowers](https://github.com/obra/superpowers) | 14 | Development workflow: TDD, debugging, code review |
| [elementalsouls/Claude-OSINT](https://github.com/elementalsouls/Claude-OSINT) | 10 | OSINT, reconnaissance, information gathering |

### MCP servers

| Repository | Contents |
|-----------|----------|
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | Official MCP servers: filesystem, git, search, memory, and more |

### How to add

In Quinki, go to **Market → My Repos → Add** and paste the repo name (e.g. `anthropics/skills`). The skills appear instantly in the catalog.

## App Expert

Quinki can modify and improve itself. Open the **App Expert** tab, set the source code directory (clone this repo), and tell it what to fix or build. It commits, builds, and installs — with your confirmation at every step.

## System requirements

- macOS 14+ on Apple Silicon (M1/M2/M3/M4)
- ~200MB disk space
- One of: ChatGPT Plus/Pro, Claude Pro/Max, GitHub Copilot, SuperGrok, or Ollama (free)

## Building from source

```bash
# Clone
git clone https://github.com/Upward991/quinki.git
cd quinki

# Install dependencies
bun install

# Build the sidecar (requires Bun)
cd sidecar-src && bun install && cd ..
bash scripts/build-sidecar.sh

# Build the app (requires Rust)
npx tauri build
```

The built app appears in `src-tauri/target/release/bundle/macos/Quinki.app`.

## Support the project 🎯

Quinki is free and open source. Donations fund the infrastructure:

| Goal | Amount | Status |
|------|--------|--------|
| Apple Developer Program (notarization) | $99/year | ⏳ Pending |
| Domain (quinki.app) | $20/year | ⏳ Pending |
| Development time | Any amount | ❤️ Always needed |

**Donate**: [GitHub Sponsors](https://github.com/sponsors/Upward991)

## Report issues

Found a bug? [Open an issue](../../issues) with:
- What you were doing
- What happened vs what you expected
- macOS version and model used

## License

AGPL-3.0. See [LICENSE](LICENSE) for details.

The source is open: you can study it, modify it, and build it. Any distribution of modified versions must also be AGPL-3.0 and include the source code.

---

<div align="center">
Made with ❤️ in Italy 🇮🇹

*If Quinki saves you time, consider [supporting it](https://github.com/sponsors/Upward991).*
</div>