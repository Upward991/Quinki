# Privacy Policy

**Last updated: August 2026**

Quinki is built on one principle: **your data stays on your machine.**

## What we collect

**Nothing.** Quinki has no servers, no analytics, no telemetry, no tracking. We do not collect, store, or transmit any personal data.

## What stays on your computer

- Your chats, agents, skills, themes, and settings are stored **locally** in `~/.quinki/`
- Your provider API keys are stored locally (encrypted via OS keychain)
- Your GitHub token (if you log in to the Market) is stored locally

## What data goes where (and only there)

| Data | Where it goes | Why |
|---|---|---|
| **Chat messages** | Only to the AI provider **you** choose (Anthropic, OpenAI, OpenRouter, Ollama, etc.) | The LLM needs to respond. Quinki never sees or stores your conversations on any server |
| **Market content** (tab/skill/agent/mcp/theme catalogs and files) | GitHub (`github.com`) | The Market is a GitHub repository; browsing and publishing use the public GitHub API |
| **GitHub login** (only if you use the Market) | GitHub | Your own account authorizes the app via OAuth. The token is stored on your machine only |

## What we never do

- We do **not** collect telemetry, crash reports, or usage statistics
- We do **not** have any backend servers
- We do **not** read your chats, files, or keys: nothing is sent anywhere except to the AI provider you explicitly configured
- We do **not** sell or share anything, because we never receive anything

## The Market

When you publish an item to the Market, its content (the package you chose) is submitted via a pull request to the public `quinki-market` repository, along with the metadata you entered (name, description, author name from your GitHub account). This is public by design: it is how the Market works.

## Contact

Open a GitHub Issue in the project repository for any privacy concern.