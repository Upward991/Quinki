# Quinki

https://github.com/user-attachments/assets/924f89b7-bdd2-4dc7-93d7-f29f3b9a6c37

**AI agents, chats and tools on your desktop.**

Quinki is a native desktop app for AI work: parallel multi-agent chats, scheduled jobs, a Market of community-built tools, and the App Expert to extend the app from inside it. Everything stays on your machine.

## Demos

**Chat: multi-agent + plan/build** (2:44). A single agent first, then a team: the Orchestrator delegates to Coder and Web Researcher in parallel.

https://github.com/user-attachments/assets/fd5805f8-d3b3-46b9-9647-71d5c54e3247

![macOS](https://img.shields.io/badge/macOS-Apple%20Silicon-blue)
![Version](https://img.shields.io/badge/version-1.0.0--beta.1-orange)
![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## What is Quinki?

Quinki is a desktop app with tabs: chat with AI agents, schedule tasks, browse the Market, manage your agents — all in one place. Create your own tabs with the App Expert, publish them to the Market, and install community-built tools. Everything runs locally on your Mac.

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

1. Download the latest DMG from [Releases](https://github.com/Upward991/Quinki/releases)
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

## Market

The [Quinki Market](https://github.com/Upward991/quinki-market) is the official package repository — browse it from within the app (Market tab).

### Recommended market sources

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

## Support the project

Quinki is free and open source.

**Donate**: [GitHub Sponsors](https://github.com/sponsors/Upward991)

## Report issues

Found a bug? [Open an issue](https://github.com/Upward991/Quinki/issues) with:
- What you were doing
- What happened vs what you expected
- macOS version and model used

## Contact

Questions or feedback? [Contact](mailto:quinki.inbox@gmail.com)

## License

AGPL-3.0. See [LICENSE](LICENSE) for details.

The source is open: you can study it, modify it, and build it. Any distribution of modified versions must also be AGPL-3.0 and include the source code.

---

<div align="center">
Made with ❤️ in Italy 🇮🇹

*If Quinki saves you time, consider [supporting it](https://github.com/sponsors/Upward991).*
</div>