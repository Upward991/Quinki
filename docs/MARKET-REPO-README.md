# Quinki Market

The public catalog of community items for [Quinki](https://github.com/Upward991/Quinki): the AI work app for your Mac: chats, agents, and community-built tools.

This repository **is** the Market: the Quinki app is its client. Catalog, packages and validation live here; browsing, installing and publishing happen inside the app.

> This repository is part of the Quinki project. The app documentation (including the full Market guide) lives in the main Quinki repository: **Market Guide → docs/MARKET.md**.

## What you can publish

| Category | What it is |
|---|---|
| **tab** | A community tool with UI (knowledge base, notes, RSS reader, email manager…): rendered in Quinki's tab runtime, optional `server.js` back-end |
| **skill** | A knowledge module (SKILL.md) injected into agent prompts |
| **agent** | A ready-to-use agent (config + PROMPT.md) |
| **mcp** | MCP server configurations |
| **theme** | Color themes |

## How publishing works

1. Log in with GitHub from the app (browser OAuth, token stays on your machine)
2. Pick **what you created** → choose a license (default MIT) → confirm you own the content
3. The app forks this repo and opens a pull request
4. CI validates automatically: structure → static scan → secret detection → VirusTotal for binaries
5. All green → **the PR merges itself**. No review queue.

Full guide: [Market Guide in the Quinki repo](https://github.com/Upward991/Quinki/blob/main/docs/MARKET.md)

## Rules

- Publish only what you own; declare your license honestly (default MIT)
- No malware, no copyright infringement: abusive content is removed via the Issue-based takedown process
- Multi-repo: you can also add your own GitHub repos as additional catalogs from inside the app

## License

The Market infrastructure (workflows, docs) is MIT. **Each item in `packages/` is licensed by its author** (see each item's `manifest.json`; default MIT).