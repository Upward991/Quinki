# Intelligent UI — feasibility for Quinki (analysis, 8 Oct 2026)

Reference: OpenAI "GPT‑6 and Intelligent UI for everyone" (openai.com/index/gpt-6-for-everyone, 7 Oct 2026).

## What OpenAI actually shipped

1. **A native component library + a client-side compiler**: GPT-6 composes responses out of
   a library of streamable UI components (tables, forms, buttons, charts, interactive
   diagrams, mini-tools). The compiler renders the interface *progressively* while the
   model is still generating.
2. **Model-side training**: GPT-6 was trained and evaluated to make design decisions
   (layout, when to use interactivity, when text is enough).

Part 2 is theirs (model weights). Part 1 is protocol + app work — that part is portable.

## Verdict for Quinki

**Feasible.** We already have the two hard pieces: a streaming pipeline (tokens reach the
UI as they are produced) and a React renderer with a custom markdown layer. Nothing about
this needs a rewrite.

### Level 1 — Live HTML blocks (prototype, ~1 day)

- Agents emit a fenced block (e.g. ```quinki-ui) containing a self-contained HTML document.
- The app renders it in a **sandboxed iframe** (sandbox="allow-scripts", no same-origin,
  CSP meta inside, no network by default). Interactions are local; optional postMessage
  bridge for "send this back to the chat".
- Result: calculators, chart builders, diagrams, small games — **with any model**, including
  local/free ones. This is the cheapest path to "wow".

### Level 2 — Native components (the OpenAI path, ~2-4 days MVP)

- Define a small Quinki UI spec (JSON or JSX-like) with components we own: Table, Form,
  Buttons (send/approve actions), Charts (SVG bars/lines), Tabs, Checklist, Callout.
- Progressive parsing while the message streams (we control the stream -> render partial).
- Because the components are ours, they always match the app's design system.
- The spec lives in the agent prompt/skill, so every provider (not just GPT-6) can use it.

### Level 3 — UI as a tool (most agentic)

- A `render_ui` tool: agents call it with a spec; the result renders inline where tool calls
  already render. Perfect for long tasks: progress dashboards, approval gates with buttons
  ("Approve plan" -> replies to the agent), live checklists.

## What we cannot copy, and the compensating move

- The trained design judgment: we compensate with strong instructions in agents' skills +
  a curated component set (guardrails instead of training).
- Their speed claims are model-side; our advantage: it works across **all** models and
  providers — a differentiator, not a limitation.

## Fit checklist

- Streaming: already streamed to the webview. OK.
- Persistence: spec is plain text in the session JSONL -> re-renders on reload. OK.
- Mobile + web app: sandboxed iframes work in both. OK.
- Security: the main real work — sandboxing, CSP, postMessage surface. Must be done properly.
- Desktop + phones: same renderer everywhere. OK.

## Proposed order for Quinki

1. Level 1 prototype (1 day) -> try it on the phone.
2. If liked: Level 2 component MVP (2-4 days) + agent skill updates.
3. Level 3 after the Agent API groundwork (specs shared with external consumers).
