# `quinki acp` — native ACP mode for the Quinki CLI (feature design, 9 Oct 2026)

**Status: DESIGN LOCKED — to build.** Priority: after CLI Windows/Linux (user's order), or
earlier on request. This becomes a first-class CLI feature ("Quinki agent inside any editor").

## What ACP is
The Agent Client Protocol (by Zed, agentclientprotocol.com): JSON-RPC 2.0 over stdio. An editor
(or note app) launches an "agent server" process and drives it: sessions, prompts, streaming
updates, tool calls, permission prompts, slash commands, skills. Existing clients include Zed
and the Obsidian plugin `obsidian-agent-client` (~2.4k stars, actively developed), which accepts
"any ACP-compatible agent as a custom entry".

## Decision (user, 9 Oct 2026)
- ACP support ships as a **native mode of the Quinki CLI**: `quinki acp` (alias `--mode acp`).
- **NO `pi` shim, NO external `pi-acp` package.** People who use the `pi` agent alongside Quinki
  must keep their installation untouched — no fake `pi` binaries in PATH, no name collisions,
  no extra installs. The CLI already ships with the app, so integrating with an editor is just
  pointing it at `quinki acp`.
- Engine note: internally the CLI still runs the vendored Pi SDK today, but the ACP interface is
  ours 100% — integrations stay stable even if the engine changes in the future.

## Verified groundwork (measured 9 Oct 2026, installed CLI)
- `quinki rpc` and `quinki --mode rpc` already run the SDK's RPC mode and answer with the FULL
  Quinki configuration: providers, models, and sessions in `~/.quinki` (verified with
  `{"type":"get_state"}` -> model deepseek-v4.1-flash:cloud via local Ollama, session file under
  `~/.quinki/sessions/quinki/...`).
- `quinki --mode rpc --no-themes` == the exact command line that `pi-acp` launches -> protocol
  compatibility is proven (`"success": true` observed).
- The vendored SDK exports `runRpcMode` ("headless operation ... used for embedding the agent in
  other applications"), so the engine side is ready.
- `pi-acp` spawns the `pi` executable from PATH — that is exactly why a shim was rejected.

## Design
- New subcommand `quinki acp`: ACP server on stdio inside our single binary.
- Bridges ACP to the same agent engine the CLI already drives. The event mapping mirrors what the
  sidecar already does for the app: streaming text, tool call/result events, permission prompts,
  context usage. Known work, not experimental.
- Sessions map to `~/.quinki` sessions — shared with the app and the CLI (same agents, same
  skills, same history everywhere).
- Slash commands and skills surface from the Quinki config; startup info branded "Quinki".

## Scope
- **MVP (~1 day)**: initialize; session/new; session/prompt + streaming; tool call updates;
  permission requests; cancel.
- **Full (~1-2 more days)**: session/load + history replay; slash commands; skills listing;
  usage updates; edit diffs; quiet startup.
- **Test plan**: (1) a small local harness driving `quinki acp` with raw JSON-RPC; (2) Zed via
  `agent_servers` config; (3) Obsidian `obsidian-agent-client` custom entry (command `quinki`,
  args `acp`) — final chat test by the user.

## Why this matters beyond Obsidian
- Any ACP client can host Quinki agents: today Zed and Obsidian; tomorrow whatever editor or
  note app adopts ACP. One implementation, many hosts.
- Complements the Agent API (docs/AGENT-API.md): ACP = local stdio for desktop editors;
  Agent API = network/OpenAI-compatible for arbitrary apps. Same engine underneath.
- Cements the CLI as the neutral, scriptable face of Quinki.

## Related
- `docs/AGENT-API.md` — integrations menu, Copilot V4 analysis, Smart Composer notes.
- `docs/report-notion-obsidian-import.md` — the Notion -> Obsidian pipeline (already working).
