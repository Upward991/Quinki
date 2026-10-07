# Quinki as Model (Agent API)

**Status:** planned. After CLI Windows/Linux and the small UX features.

Every Quinki agent becomes an OpenAI-compatible endpoint. Phase 2 exposes whole sessions.
Consumers: apps with a "custom model" slot, IDEs (Continue.dev and friends), n8n/CRM, chat bots,
Home Assistant, and teams sharing one machine. The first consumer and provider are the same thing:
the CLI (`quinki serve`).

## MVP architecture

1. **Server** in the sidecar (Bun): new module `sidecar-src/model-api.ts`, dedicated port 9185 (main) / 9186 (expert).
2. **Endpoints**
   - `GET /v1/models` — agents exposed as models, id `agent:<agentId>`.
   - `POST /v1/chat/completions` — standard OpenAI shape, streaming (SSE) and non-streaming.
3. **Execution** on the existing engine (pi-bridge), no new engine:
   - one headless run per request, on a dedicated session `__api_<consumer>_<agent>`, or a named session;
   - per-consumer working directory; v1 read-only by default.
4. **Auth**: Bearer token, reusing `remote-devices.json` (per-device tokens, revocable, loopback exempt).
5. **UI**: Settings, "Agent API" section (toggle, port, copy endpoint).
6. **CLI**: `quinki serve [--port]` starts just the API server.
7. **Phase 2 (sessions)**: `GET /v1/sessions`, `POST /v1/sessions/:key/chat` with a queue
   (turns are serialized; no simultaneous writing). Shared events already work.

## Steps

| Step | Time |
|---|---|
| `/v1/models` + non-streaming chat | half a day |
| Streaming SSE | half a day |
| Auth + Settings UI | half a day |
| `quinki serve` | 2 hours |
| Tests (Continue.dev, n8n, a bot) | half a day |
| Docs (site + repo) + curl examples | 2 hours |

MVP: about 2 days. Phase 2 (sessions): 3 to 5 more days.

## Launch use cases

- Any app with a custom model slot: keep its native chat, run on your agent (prompt + skills).
- VS Code: Continue.dev or any BYO-endpoint extension, next to the CLI in the terminal.
- n8n / CRM / automations: a trigger calls an agent (for example the Notion agent).
- Telegram/Discord bots: the same endpoint, any bot template.
- Voice: Home Assistant and similar accept OpenAI-compatible endpoints.
- Teams: one always-on machine, everyone's tools point at it, per-person tokens.

## Risks and notes

- Provider ToS with subscriptions: personal use is fine, resale is not. Local-first, bring your own keys.
- Tool use happens inside the agent; the consumer only sees the text. Document this clearly.
- One turn at a time per session (queue).
- Security: closed by default (loopback or tailnet), revocable tokens, explicit working directory.

## Naming

Feature: "Agent API". Standalone: same binary with a flag.

## Notion (verified, October 2026)

Notion AI has no native BYOK and no custom OpenAI endpoint. But Notion's Custom Agents platform has an
**External Agents API**: an agent you built yourself can be registered and used inside Notion
(Notion's own video: "use the External Agents API to bring in one you've built yourself").

So a phase-3 adapter is possible: Quinki agents registered as Notion external agents, with a thin
translator between Notion's protocol and our agent runs. The same pattern exists for other platforms
that are adding "bring your own agent" slots.

Reverse direction, for reference: tools like notion2api wrap Notion AI into an OpenAI-compatible API.
That is the opposite of what we need.

## Obsidian (verified, October 2026)

Perfect target, the opposite of Notion: the app is free for personal use, there is no vendor AI to pay
for, and the plugin ecosystem openly accepts custom endpoints.

- **Copilot for Obsidian**: "Use OpenAI, Anthropic, Google, LM Studio, Ollama, or any OpenAI-compatible
  endpoint. Your own keys." It also runs external coding agents (opencode, Claude Code, Codex) inside
  the vault. A Quinki agent as "the model" plugs straight in.
- **Smart Composer**, **Text Generator**, **Local GPT**, **Smart Connections**: all support custom or
  local endpoints; the community guides are built around running your own models privately.
- Today, without waiting for the Agent API: an Obsidian MCP server lets Quinki agents read and write
  the vault through any MCP client setup we already support.
- Later option: a small "Quinki" Obsidian plugin as the polished front door.

## Open-source Notion alternatives (verified, October 2026)

Exodus from Notion is a real 2026 theme ("Leaving Notion" guides everywhere). The serious
self-hosted alternatives: AppFlowy, AFFiNE, SiYuan, Anytype, Outline.

- **AppFlowy**: the closest to Notion (blocks, databases) and the most faithful migration path.
  Wired **Ollama as a first-class** local AI (2025 release), so prompts stay private.
- **SiYuan**: self-hosted, and its AI accepts **any OpenAI-compatible endpoint**. That is the
  Agent API slot, straight in.
- One 2026 guide about these tools puts it perfectly: they are "the agentic layer those tools
  miss". That missing layer is exactly what Quinki sells.

Useful follow-up idea: give the Agent API an **Ollama-compatible mode** too (`/api/chat`), so apps
that only speak Ollama also work out of the box.
