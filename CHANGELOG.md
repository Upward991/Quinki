# Changelog

All notable changes to Quinki are documented here.

## [1.0.0-beta.1] - First public release

Quinki goes public: a desktop AI work app: multi-agent chats, scheduled agent work, a community Market, and the App Expert to update and extend the app from inside it.

### Highlights

- **Multi-agent AI chat**: Anthropic, OpenAI, OpenRouter, Ollama and any OpenAI-compatible provider; tools (read/write/edit/bash/search), skills, file attachments, delegations with full conversation-tree persistence
- **Plan & Build modes**: read-only exploration or full filesystem access, per chat
- **App Expert**: a companion app with the same code that can modify, fix and improve Quinki from within itself (sync + rollback built in)
- **H24**: scheduler for long-running and scheduled agent work, with crash recovery
- **Scale**: 100+ parallel chat sessions via a multi-process sidecar pool (auto-tuned to your CPU)
- **Market**: online catalog of community items (tabs, skills, agents, MCP servers, themes); one-click install, publish flow with automatic validation (static scan, secret detection, VirusTotal for binaries) and auto-merge
- **Universal thinking**: one toggle, always the maximum reasoning level your provider supports
- **Privacy by design**: everything is stored locally, zero telemetry, zero servers

### Known limitations (beta)

- macOS only (Apple Silicon) for now
- The app is not notarized: on first launch, right-click → Open to bypass Gatekeeper
- Some edge cases in long-running H24 sessions are still being stabilized

> This is a beta release: expect bugs and breaking changes between betas. Feedback is welcome: open a GitHub Issue.