# Competitive Analysis — Quinki vs OpenClaw vs Hermes Agent

> INTERNAL document — never published to the public repo. Purpose: identify our real strengths and gaps vs the two leading personal-agent products, to build an honest README.
> Sources: openclaw.ai, hermes-agent.nousresearch.com (August 2026).

---

## The three products at a glance

| | **Quinki** | **OpenClaw** (Peter Steinberger) | **Hermes Agent** (Nous Research) |
|---|---|---|---|
| Form factor | **Native desktop app** (macOS) with full GUI | CLI gateway + companion apps (beta) + chat-app control | Native desktop app + CLI |
| Core identity | Desktop AI work app: chats, agents, market, self-modifying app | Personal assistant living in your messaging apps | Personal agent that "grows with you", multi-surface |
| Where you talk to it | In the app (multi-agent chat, sidebar, market) | WhatsApp, Telegram, Discord, any chat app | Telegram, Discord, Slack, WhatsApp, Signal, Email, CLI |
| License | AGPL-3.0 | Open source (MIT-family) | MIT |
| Monetization | None yet (future: accounts, payments) | Open core + partnerships (OpenAI sign-in, X API) | **Free/Plus/Super/Ultra tiers + Nous Portal credits (300+ models)** |
| Platforms | macOS (Apple Silicon) | macOS 15+, Windows 10/11, Linux | macOS 12+, Windows 10/11, Linux |
| Community | Just launching | **Fastest-growing GitHub project ever** (6 months, @steipete), Microsoft Build partnership | Nous Research brand (known AI lab) |
| Version | 1.0.0-beta.1 | 1.x (mature, huge) | 0.20.6 |

## Their key features

### Hermes Agent
1. **Lives everywhere** — Telegram, Discord, Slack, WhatsApp, Signal, Email, CLI: one agent, one memory, every surface
2. **Persistent memory** — learns your projects, auto-generates skills, "never forgets how it solved a problem"
3. **Natural-language scheduling** — reports, backups, briefings running unattended through a gateway
4. **Isolated subagents** — own conversations, terminals, Python RPC scripts (zero-context pipelines)
5. **Web**: search, browser automation, vision, image generation, TTS, multi-model
6. **Sandboxing** — 5 backends: local, Docker, SSH, Singularity, Modal (container hardening)
7. **Commercial funnel**: Nous Portal tiers with monthly model credits

### OpenClaw
- Gateway model: you message your computer from WhatsApp/Telegram/Discord; a gateway executes
- Companion apps (beta), npm-based (Node.js), macOS 15+, Windows 10+, Linux
- Massive community (fastest-growing GitHub project ever, Microsoft Build partnership, OpenAI partnership)
- "Hackable and self-hackable" — user-modified, community skills
- Persistent memory + skills ecosystem

---

## Quinki's genuine advantages (verified, not marketing)

### 1. The App Expert — nobody has this
Neither OpenClaw nor Hermes has an **agent that updates the app itself**: OpenClaw is "hackable (and more importantly, self-hackable)" per its own users — but the *user* hacks it. Quinki ships a dedicated agent whose job is building, installing, syncing and rolling back the application, with UI (sync banner, version.txt hash comparison, rollback modals, caller-aware restart). **Unique in the category.**

### 2. A real desktop app with a full UI
OpenClaw is CLI-first (its "companion apps" are beta). Hermes is messaging-first (Telegram/WhatsApp) with a desktop app. Quinki is a **native desktop application**: polished chat UI (7 themes, design system), sidebar with folders, multi-window, exports, unread badges, notifications, per-tab accent colors. For users who *want an app*, not a chat-bot-in-messenger.

### 3. Measured 100+ parallel sessions (process pool)
Our pool runs **100 concurrent streaming sessions with 0 timeouts** (measured enduro). OpenClaw/Hermes scale by spawning subagents per task; neither publishes parallel-session benchmarks. The multi-process sidecar pool (main router + lazy workers, reads on main, writes/LLM on workers, idle shrink) is documented and measurable.

### 4. In-app Market with auto-merge
OpenClaw: community skills scattered on GitHub, installed manually (or via ClawHub-style lists). Hermes: skills auto-generated *locally*. Neither has an **in-app marketplace with a publish flow**: login with GitHub → pick your items → license + ownership confirmation → fork + PR → automatic validation (structure, static scan, secret detection, VirusTotal) → auto-merge. Anti-theft registry included. Publishing is minutes, not days.

### 5. H24 scheduler native to the app
Scheduled agent work with full execution logs, recovery of interrupted turns, stuck-turn detection (45s), all built into the app. Hermes has scheduling via its gateway; OpenClaw via cron-like setups — both external to a UI. Ours is visible, editable and recoverable in-app.

### 6. Privacy by design (fact, not marketing promise)
Hermes funnels users into Nous Portal (paid tiers). OpenClaw has partnerships (OpenAI sign-in, X API). Quinki: zero servers, zero telemetry, everything local in `~/.quinki/`. NOTE: do NOT turn this into a "no subscription ever" claim — the future commercial model (paid market items, revenue share, cloud) stays an open option. The AGPL license protects against OTHERS selling forks; it does not constrain what WE charge.

### 7. Universal thinking
One toggle = always the provider's maximum reasoning, any provider. Neither competitor advertises an equivalent.

### 8. Community-built tabs — the real vision
The deepest moat: users create **their own tabs** (knowledge base, notes, RSS reader, email manager, anything) with the App Expert and publish them to the Market. Quinki becomes a platform of community-built AI tools. OpenClaw has scattered GitHub skills; nobody has a curated in-app Market with one-click publish. Plus multi-repo support (add your own repos to the catalog).

## Positioning corrections (owner, 28 ago)
- **NO "no upsell" promise in the README**: monetization (paid market items, subscriptions, cloud) is a possible future — never promise "no subscriptions forever" publicly. Privacy claims (zero telemetry, local data) stay; commercial promises don't.
- **Messaging (WhatsApp/Telegram/Discord) is NOT a gap**: it's a deliberate choice. The mobile surface will be the **Quinki mobile app + web app** (native, planned). In the future, agents can be exposed as bots on those platforms — the mechanism stays, the interface is ours.
- **Windows/Linux** = first thing after launch (roadmap). **Sandboxing**: will be implemented. **Voice (mic in the text box)**: will be implemented. **Automatic image generation**: will be implemented (almost nobody does it — requires aggregating services).
- **The Market in the README**: the market repo is a "hidden" repo (you must know it exists), but the app's README and docs INCLUDE the Market as a section (extracted from the main docs — the market repo gets a pointer README, not separate docs). The Market is a key selling point: multi-repo support makes item management effortless.
- **Tabs are the #1 feature** (per owner): via the App Expert, any user can CREATE their own tabs (knowledge, notes, RSS, mail) and publish them. Tabs are the most important part of the app AND the market. Say it clearly and briefly in the README.
- **Beta framing**: the app ships beta; **the Market is the least-tested feature (effectively alpha)** — say it explicitly in the README to manage expectations ("let's test it together").

| Gap | Who has it | Our answer (roadmap candidates) |
|---|---|---|
| **Messaging surfaces** (WhatsApp/Telegram/Discord/Slack/Email) | Both | Not in v1; gateway concept is a future possibility |
| **Sandboxing backends** (Docker/SSH/Modal) | Hermes (5 backends) | We have Plan/Build modes; sandboxing could be a future feature (Docker backend) |
| **Multi-platform** (Windows/Linux) | Both | macOS Apple Silicon first; Tauri makes ports feasible later |
| **Browser automation / vision / TTS / image gen built-in** | Both (Hermes native; OpenClaw plugins) | We have skills + MCP; native integrations could come as Market tabs/skills |
| **Community size** | OpenClaw = fastest-growing GitHub project ever; Hermes backed by Nous Research | We are day one; the Market + self-modification are our wedge |
| **Persistent auto-memory** ("it learns you") | Hermes markets it | We have skills + Expert-created skills; not an auto-memory feature yet |
| **Auto-generated skills** | Hermes | Our Expert creates skills on request, not automatically |

## Positioning line (draft, to refine)

> OpenClaw and Hermes are **agents that live in your messenger**. Quinki is a **desktop application**: a real interface for AI work — parallel chats, agents, a curated Market, scheduled work — plus an agent (the App Expert) that maintains the app itself. Your work is visible, manageable and local; nothing is sent anywhere except to the provider you choose.

## What the README should emphasize (in order)

1. **The App Expert** — the app that maintains itself (sync + rollback built in). No competitor has it as a product feature.
2. **Native desktop app** with a real UI — not a CLI gateway, not a chat-bot-in-Telegram. Chats you can see, organize, search, export.
3. **100+ parallel sessions** — measured, not claimed (process pool, 0 timeouts).
4. **H24 scheduler + recovery** — the agent works while you sleep, and survives crashes.
5. **Market with automatic validation** — publish in minutes, no gatekeeper, anti-theft built in.
6. **Privacy by design** — zero servers, zero telemetry, everything in `~/.quinki/`.
7. **Privacy as a fact** — zero telemetry, everything local in `~/.quinki/`, your provider keys. (No commercial-model promises in the README.)

## DECISIONI DEL FONDATORE (28 ago) — correggono i gap sopra

- **No messaging (WhatsApp/Telegram/Discord) = scelta DELIBERATA, non un gap**: la roadmap di Quinki prevede la **web app + app nativa mobile** come interfaccia mobile (non i chat-bot). In più: esportare gli agenti come bot su piattaforme che li supportano (WhatsApp/Telegram/Discord) è possibile in futuro — il meccanismo esiste, il canale cambia.
- **Windows/Linux = PRIMA priorità post-lancio** (dichiarata)
- **Sandboxing**: implementerà (futuro)
- **Voice (microfono nella text box) + generazione automatica immagini**: implementerà — la image-gen quasi nessuna app ce l'ha
- **Le TAB sono il punto di forza #1** (visione utente): tramite l'App Expert chiunque può CREARE le proprie tab (knowledge, appunti, RSS feed reader, gestione mail, qualsiasi funzione) e pubblicarle nel Market. "Le tab sono la parte più importante, sia dell'app che del market." La visione: un'app che aggrega soluzioni AI costruite dalla community.
- **Market multi-repo**: aggiungere repo propri al catalogo = superpotere della app (nessuna ricerca su internet).
- **Struttura docs market**: il market repo NON ha README/docs separati — la documentazione del market è una SEZIONE della documentazione della app principale (README + docs del repo Quinki). Il market repo resta "nascosto" (chi lo conosce lo usa), la documentazione vive tutta nel repo principale.
- **Beta tutela**: l'app esce beta; il MARKET è la funzione MENO testata → nel README/changelog dichiararlo esplicitamente ("the Market is the newest part — treat it as alpha inside the beta") e costruire insieme con i primi utenti.
- **"No upsell" da NON usare come slogan** (suona da scarso); formulare come "no subscription required — your keys, your data" e puntare sulla privacy.

## DECISIONE VERSIONE (28 ago) — release = 1.0.0-beta.1, changelog utente-oriented che parte da 1.0.0-beta.1
**GAPS CORRETTI (visione utente, 28 ago)**:
- WhatsApp/Telegram/Discord NON è un gap: è una SCELTA DELIBERATA (mobile app nativa + web app saranno le interfacce mobile; gli agenti potranno comunque essere esposti come bot su quelle piattaforme in futuro — "extract the agent from the app")
- Sandbox: arriverà (roadmap)
- Windows/Linux: PRIMA priorità post-lancio (roadmap)
- Voice input (mic nella text box) + image generation: implementerà (la image-gen quasi nessuna app ce l'ha)
- Market: il punto di forza #1 secondo l'owner — LE TAB community (knowledge, appunti, RSS, mail) sono il vero moat: "se tutti capiscono che possono creare e pubblicare le proprie tab, si gode tantissimo"
- Il market va presentato nel README come parte della documentazione della APP (il market repo è un repo "nascosto" che punta alla doc principale, non un repo con docs autonoma)
- Nel README: sezione roadmap "coming soon" (mobile, TTS, image-gen, sandbox, multi-platform)

- No messaging integrations (Telegram/WhatsApp/Discord) — their #1 feature
- No sandboxing backends (Docker/SSH/Modal) — Build mode has full filesystem access
- macOS Apple Silicon only (they ship Win/Linux)
- No browser automation / vision / TTS built in (available via skills/MCP)
- Community size: they are huge (OpenClaw = fastest-growing GitHub repo ever), we start at zero