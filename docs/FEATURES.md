# Inside Quinki

Quinki is not a chat window with plugins bolted on. It is an **engine** that runs AI agents on your Mac, and a window that shows you exactly what they are doing. This page explains the moving parts — useful before you trust it with real work.

## One engine, two faces

Everything you see is driven by a local process (the **engine**) that owns the sessions, the models, the tools and the tasks. The **app window** and the **CLI** are two views on the same engine and the same data: change something in one and it appears in the other, live.

Nothing goes through a Quinki server. Your prompts go straight from your Mac to the provider you chose; everything the app knows lives in one folder, `~/.quinki`.

When work gets heavy, the engine can split into a small **pool of processes** (one per group of chats) so that a long turn never freezes the rest. You don't configure this; it happens by itself.

## Chats are sessions on disk

A chat is not "a tab": it is a **folder of append-only logs**. Every message, every thinking block, every tool call and every result is written in order, as it happens. If Quinki crashes mid-reply, nothing is lost — the turn is marked as pending and picked up when you open the chat again (you will see a "Recovering" pill, then the recovery message appear in the chat like any other message).

Long chats are handled in two ways: older messages are **paged in on demand** as you scroll back, and a **compaction** replaces the far past with a summary so the model's context stays healthy. Compaction can be manual (`/compaction`) or automatic, per chat.

Deleting a chat is deliberate and permanent: it disappears everywhere and never comes back.

## Agents

An **agent** is a folder in `~/.quinki/agents/<id>/`: a `PROMPT.md` (who it is), a `config.json` (its default model, thinking level, tools, skills, MCP servers) and any files it needs. That's the whole definition — agents are as editable as text files, and you can hand one to a friend.

Agents don't own chats: they are **invited** into them. A chat can hold one agent, or a whole team.

### The Orchestrator and delegation

One agent in a chat can be given the **Orchestrator** role. Messages go to it; when a task fits another agent better, it hands the work over with a **delegation**:

- the delegated agent runs in its own temporary session, with its own persona, model and tools
- its progress streams into the chat **inside a collapsible block** you can open and read
- the orchestrator only receives the final answer — delegations cost **zero context** in its conversation
- **any agent can have its own sub-agents**: delegations nest to any depth (`root → A → B → C`)
- each agent is told its **own subtree** at every turn, but it can delegate **only to its direct children** — so the route is chosen by the agents, not hard-coded
- every tool answer reports who replied, the current `graph_version` and the agents it can call next, so a stale prompt is always detectable
- you always see who did what, and can inspect the steps, level by level

This is the core idea of Quinki: small, specialised agents, orchestrated — instead of one giant prompt trying to be everything.

## Skills and MCP

**Skills** are folders with a `SKILL.md` (plus optional scripts and references) — knowledge modules an agent can open when relevant. Attach them to an agent, or inject one per message with `/skill`.

**MCP servers** (Model Context Protocol) work like everywhere else: Quinki runs them locally over stdio or connects over HTTP, and their tools simply appear to the agent.

Both install with one click from the **Market** (Settings → Market, or the Market section in Home).

## Plan and Build

Every turn runs in one of two modes:

- **Plan** — read-only tools (`read`, `grep`, `find`, `ls`). The agent explores, reasons and proposes; it changes nothing.
- **Build** — the full toolset, including `write`, `edit` and `bash`.

**Tab** switches the mode at any moment, and it applies from the next turn. File tools are additionally fenced by your **Authorized Folders** (Settings → macOS Permissions): an agent can only touch the chat's own working directory and the folders you explicitly listed.

## Working directories

Every chat gets its **own** working directory, created automatically. Change it whenever you like (`/directory`, or from the chat header), and the agent can also work in any other authorized folder.

The default rule is simple and stated to every agent: *anything you create goes in the chat's working directory, unless the user says otherwise.* Ask for another location and it will use it.

## Tasks: schedules, executions, reports

A **task** is a schedule: a time (once / daily / weekly / monthly, each with its own timezone), an agent, a prompt, and a working directory.

When it fires, the engine creates an **execution**: a headless chat that runs the agent exactly like a normal turn — tools included — while you do something else. When it finishes:

- the result comes back to the chat it belongs to, as a **task report**: a visible bubble that asks the model to report only what matters
- if the chat is under Long Horizon, or its context is nearly full, you get a **red app message** instead, telling you where to read the result (the "Task executed" section above the textbox)
- each task can ask the Mac to **stay awake** while it runs

If the Mac was asleep or Quinki closed, missed tasks **run at the next launch** — late, never skipped. Everything about tasks lives in the **Tasks** tab (calendar and executions), and in the chat, "Task executed" shows exactly what happened on that chat's tasks.

## Long Horizon

For long projects — the ones that take hours, not minutes — **Long Horizon** keeps the work moving while you're away:

1. **Start a discussion**: you explain the goal, the agent asks what it needs; you iterate
2. **Plan**: Quinki writes `plan.md` — the units of work, each a checkbox you can edit
3. **Run**: a support process sends "continue" prompts unit by unit, checks the agent's `handoff.md` (the memory of what was done, how, and why), updates `progress.json`, and **commits each unit to git** so any step can be reverted

The support agent is not an AI: it is a careful timer that reads your files and writes in the chat. It speaks **only when a turn is completely finished and clean** — it never interrupts, never talks over an error or a stop of yours. You can pause (back to discussion), edit the plan, or disable it and keep the files.

## Notifications and your phone

Each chat has a notification mode (**All / Messages / Tasks / Muted**). Quinki uses native macOS notifications, and it never notifies you about the chat you are already watching.

Your phone connects through a **private tunnel** that runs on your Mac (nothing to configure in your router):

- enable it in Settings → Web app / Remote
- open the address it shows on your phone and confirm the **pairing** page — the device gets its own token, revocable at any time
- install the web app on your home screen (PWA), or use the Android APK
- notifications reach the phone **even with Quinki closed**, and are silenced the moment you look at that chat on the Mac

The tunnel exists **only while a Quinki window is open**: close the app and the door closes.

## The CLI

`quinki` in any terminal is the same engine with a different face: same chats, same agents, same skills, same tasks — with a fast slash-command menu, keyboard navigation of the collapsible blocks (Ctrl+Alt + arrows), and `/syncexpert` when you need to push a new build to the App Expert. The app installs the CLI for you, and keeps it updated.

## Logs you can actually read

The **Log** tab has exactly three streams, on purpose:

- **System Prompt** — what the model really received as instructions
- **Thinking** — the model's reasoning, per model
- **LLM Catalog** — every model of every provider, with capabilities and levels

Nothing else is written to disk. Chat content is never used as a log.

## The App Expert

Quinki can work on itself: the **App Expert** is a second app (same code, orange accent) whose agent knows the Quinki codebase, docs and decisions. It has its own chats and its own data. When the two versions drift apart, **Settings → App Expert → Sync** brings them together again.

## Where your data lives

One folder: `~/.quinki` — sessions, attachments, working directories, agents, skills, tasks, keys (encrypted), settings. The [Files & Environment reference](reference-config.html) documents it file by file, so nothing here is a black box.
