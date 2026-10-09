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

## Verified consumers — who can plug into the Agent API (source-verified 8 Oct 2026)

All three accept a custom OpenAI-compatible endpoint. This confirms the Agent API is the single
piece that unlocks "use our agents inside other apps". Evidence from the official sources:

| App | Verdict | Evidence (checked at the source) |
|---|---|---|
| **Obsidian** (Copilot plugin) | YES | obsidiancopilot.com: "Any AI Model. Zero Lock-In. Use OpenAI, Anthropic, Google, LM Studio, Ollama, **or any OpenAI-compatible endpoint. Your own keys and custom providers**, and you can switch models anytime." |
| **SiYuan** | YES | siyuan-note/siyuan issue #19199 (Sep 2026): providers "already work in SiYuan through a **custom OpenAI-compatible provider** ... users have to **configure the base URL by hand**". Settings: app/src/config/tabs/ai (AI providers). |
| **AFFiNE (self-hosted)** | YES (server flag) | docs.affine.pro self-host AI guide (upd. 27 Aug 2026): BYOK; to allow "OpenAI-compatible or other custom endpoints" the admin must set `copilot.byok.allowCustomEndpoint: true` (+ `allowPrivateEndpoint: true` if the endpoint is on the private network, e.g. the Mac) in config/config.json. BYOK UI: Settings -> Integrations -> AI BYOK. |
| **Notion** | NO (gated today) | External Agents API exists ("even the ones you built yourself") but: alpha/waitlist -> partner beta (Claude, Cursor), usage billed on Notion Credits, Business/Enterprise plans. Revisit when self-serve opens. |

### What the Agent API must expose (MVP, for these consumers)
- `GET /v1/models` -> one entry per exposed agent (agent id as the model id).
- `POST /v1/chat/completions` -> runs that agent, SSE streaming, standard OpenAI response shape.
- Auth: token (remote-devices mechanism), server on the Mac (localhost + tailnet via the
  existing tunnel), allow-list of agents to expose.

### Test plan (user tests, one app at a time — easiest first)
1. `quinki serve` + token; verify `curl /v1/models` and one streaming completion.
2. **Obsidian** + Copilot: custom provider (URL + key) -> pick an agent as the model -> chat.
3. **SiYuan**: AI settings -> custom OpenAI-compatible provider -> base URL by hand -> chat.
4. **AFFiNE self-hosted**: config.json `allowCustomEndpoint: true` (+ `allowPrivateEndpoint: true`
   if AFFiNE runs in Docker on the Mac: use the Mac's LAN IP or host.docker.internal) -> BYOK ->
   add key (OpenAI-compatible route) -> chat.

## Obsidian integration paths — full landscape (verified 9 Oct 2026)

Beyond Copilot's custom endpoint, Obsidian now offers several official/community bridges. Ranked by
usefulness for Quinki:

1. **Official Obsidian CLI** (Obsidian 1.12+): "Anything you can do in Obsidian you can do from
   the command line." Enable in Settings -> General -> Command line interface (needs the 1.12.7+
   installer; the app must be running). Commands: daily, search, read, create (with templates),
   tasks, tags, diff, plus developer commands: devtools, plugin:reload, dev:screenshot, and
   **eval code="..."** (runs JavaScript in the app). The docs say explicitly these exist so
   "agentic coding tools can automatically test and debug". This is the sanctioned automation
   surface -> our agents (and the App Expert itself) can drive Obsidian through it.
2. **obsidian-agent-client** (community, ~2.4k stars): brings AI agents into Obsidian via
   **Agent Client Protocol (ACP)** — Claude Code, Codex, Gemini CLI run inside Obsidian.
   If our CLI/agents could speak ACP, Quinki agents would run inside Obsidian like they do.
   Worth investigating: what the plugin needs to launch a custom agent.
3. **Local REST API plugin** (+ MCP): HTTP bridge + built-in MCP server; app-side control
   (read/write, commands) for MCP clients. Good for network/MCP integrations.
4. **NotesMD CLI** (ex "obsidian-cli", renamed after the official CLI shipped): file-only vault
   operations without Obsidian running. Redundant for us (we already have raw filesystem).
