# Guides and tutorials

Short, task-based walkthroughs. Each one assumes Quinki is installed and a model is connected ([Getting started](getting-started.html)).

## 1. Your first agent

Agents are folders with a prompt — you can create one in a minute.

1. Open the **Agents** tab and create a new agent: give it a name
2. Write its **PROMPT.md**: who it is, what it is good at, how it should behave. Plain language works best; this text is what the model reads at every turn
3. In the same panel, give it its own **model** and **thinking level** if you want (a fast model for simple work, the strongest one for hard work)
4. Add **skills** and **MCP servers** if it needs tools or references
5. Open a chat, use `@your-agent` (or add it to the chat from the composer) and talk to it

Good agents are narrow. "Summarises meetings and keeps notes tidy" beats "does everything".

## 2. A team, with an Orchestrator

One agent answering is fine; several agents cooperating is where Quinki starts to feel different.

1. In a chat, **add two or three agents** (composer → agents, or the Agents panel)
2. Choose one as the **Orchestrator** — the agent that receives your messages
3. Ask something that needs more than one skill: *"Plan the release notes for the 2.0 launch: the researcher gathers what changed, the writer drafts it."*
4. The Orchestrator hands work out with **delegations**: you will see them appear as collapsible blocks while they run (open them to watch the work)
5. When the delegated agents are done, the Orchestrator reads their answers and writes **one reply**

Delegations do not fill the Orchestrator's context: it gets the result, not the transcript. If a delegation goes wrong, open its block and read the steps.

## 3. Schedule a task you won't have to remember

1. Open the **Tasks** tab → **Create task**
2. Choose the **chat** it belongs to (the result will be reported there)
3. Set the **schedule**: once, or daily / weekly / monthly — with a time (each task keeps its own timezone)
4. Pick the **agent**, write the **prompt** (what should be done), and the **working directory** if it matters
5. Turn on **Keep Awake** if the Mac should stay awake while it runs

When it fires, an **execution** appears in the Tasks tab: a headless run with all the agent's tools. When it finishes, the chat receives a **task report** — a message asking the model to report only the result — or a red app message if Long Horizon is active (which takes precedence) or the context is nearly full.

If your Mac was asleep, don't worry: missed tasks run at the next launch.

## 4. Long Horizon: a project that keeps moving

For work that spans hours, Long Horizon drives the project while you are away.

1. Open a chat whose working directory is your project (**/directory** in the CLI, or the header in the app)
2. Activate **Long Horizon** (`/longhorizon` in the CLI, or the banner in the chat)
3. **Start the discussion**: describe the goal. The agent asks questions until the two of you agree
4. **Proceed to planning**: Quinki writes `plan.md` — one line per unit of work, like `- [ ] Add the import command`. Edit it freely: it is your plan
5. **Start**: from now on, after every finished turn the support process sends the next "continue", the agent updates `handoff.md` (what it did, how, why) and `progress.json`, and **each completed unit is committed to git** — so any step can be reverted
6. Pause (back to discussion) or disable whenever you like; the files stay on disk

Long Horizon only speaks when a turn is completely finished and clean. Stop a turn, and it stays quiet and waits for you.

## 5. Your phone, in two minutes

1. On the Mac: **Settings → Web app / Remote** → enable it
2. A private tunnel opens; open the shown address on your phone
3. Confirm the **pairing** page — that device now has its own token
4. Add the page to your home screen (Share → Add to Home Screen): it behaves like an app (PWA); on Android you can also install the APK
5. Notifications: allow them in the app's settings and on the phone — they arrive **even with Quinki closed**, and stop the moment you look at that chat on the Mac

The tunnel lives only while a Quinki window is open. Each device can be revoked from Settings, and the remote works with the App Expert too.

## 6. The CLI

1. The app already installed it: type `quinki` in any terminal
2. You land on the welcome: pick agents and a model, then start typing — it is the same engine and the same chats as the app
3. `/` opens the command menu. Some favourites: `/sessions` (switch chat), `/model`, `/directory`, `/skill`, `/longhorizon`, `/agents` (full admin), `/settings`, `/shortcuts`
4. Navigate the collapsible blocks with **Ctrl+Alt + arrows** (open, enter, close)
5. `quinki expert` opens the same TUI on the App Expert session
6. Updates: `quinki update` (or `quinki update --check` to look without installing). The app updates the CLI for you too

Installing on another machine without the app:

```bash
curl -fsSL https://raw.githubusercontent.com/Upward991/Quinki/main/install-cli.sh | sh
```
