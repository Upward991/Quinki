# Troubleshooting and FAQ

The problems that actually happen, and what to do about them.

## The app won't open

macOS may block apps downloaded outside the App Store the first time: open **System Settings → Privacy & Security** and choose **Open Anyway** for Quinki. If it still doesn't start, download the DMG again from the [Releases page](https://github.com/Upward991/Quinki/releases) — re-running the installer always gets the latest build.

## Nothing responds / the chat list is empty

The engine starts with the app. If the window is up but nothing answers:

1. Open the **Log** tab: real errors show up there, with their reason
2. **Quit Quinki completely and reopen it** — this restarts the engine cleanly
3. If it repeats, check that a stale process isn't holding the engine's port (9182): quitting the app releases it; the engine also exits by itself when no window and no CLI is connected
4. The **CLI** can talk to the engine too (`quinki`) — if the CLI also says "not connected", the issue is the engine, not the window

## A reply stays on "Running" forever

Press **Stop** (or `Esc`). Then send again: Quinki detects the interrupted turn and recovers it. If it happens often, the provider is usually the cause (key, quota, rate limit) — try another model with `/model` to isolate it. A stuck chat can also be reloaded with `/reload` (CLI) or by reopening it.

## Provider problems

- **401 / invalid key**: re-enter the key in Settings → Providers. Keys are encrypted on disk; if a key was pasted with spaces or an old value, replacing it is enough
- **Model not found**: refresh the provider's model list in Settings → Providers → Models
- **Ollama "not installed"**: Settings → Providers → Ollama → **Install** (Quinki downloads and sets it up), then refresh models
- **Weird context sizes or early compactions**: the catalog repairs itself — at each launch Quinki re-fetches real limits from the providers and fixes wrong values
- **Thinking level rejected**: levels differ per provider; Quinki learns the supported ones automatically and falls back to the closest valid level

## Notifications don't arrive

1. Allow Quinki in **System Settings → Notifications**
2. Check the chat's notification mode: **Muted** means never
3. Quinki never notifies you about the chat you are **already watching** — that's by design
4. On the phone: notifications need the remote feature on, and arrive even with the app closed. If they stop after re-pairing, check the device list in Settings

## My phone can't connect

- The remote must be **on** (Settings → Web app / Remote)
- A **Quinki window must stay open** on the Mac: the tunnel exists only while the app is visible
- Open the address shown in Settings on the phone and confirm the **pairing** page; each device gets its own token, revocable in Settings
- If a device was revoked, pair it again — old tokens stop working immediately

## The CLI is old / says a different version

The app installs the CLI it ships. To update: `quinki update` (or `quinki update --check` to just look), or reinstall the app. New terminals pick up the new binary; `which quinki` should point at `~/.local/bin/quinki`.

## The App Expert looks different from Quinki

They are two apps sharing the same code. After Quinki updates, sync the Expert: **Settings → App Expert → Sync**, then reopen the Expert. If the Expert misbehaves, the same section offers a rollback to its previous version.

## Tasks didn't run

- If the Mac was asleep or Quinki closed, missed tasks run **at the next launch** — late, never skipped
- Check the task in the **Tasks** tab: every run leaves an **execution** with its event log
- For tasks that need the Mac awake, enable **Keep Awake** on the task
- If the chat doesn't show the result, look above the textbox: **"Task executed"** opens the full result (Long Horizon takes precedence, and a nearly-full context is protected the same way)

## Where do I find logs?

- **Log tab**: the three streams that matter — System Prompt, Thinking, LLM Catalog
- `~/.quinki/quinki-debug.log`: the same data on disk
- The Tasks tab keeps each execution's events, for scheduled work

## How do I delete or reset things?

- **One chat**: `/reset` clears its messages but keeps model, directory and settings. Deleting a chat is permanent — it never comes back
- **A task**: from the Tasks tab
- **An agent or skill**: from the Agents tab (installed Market items uninstall the same way)
- **Everything**: quit Quinki and delete `~/.quinki` — it contains chats, agents, skills, tasks and settings. Make a copy first if you're not sure

## Does Quinki send my data anywhere?

Your prompts, files and keys stay on your Mac and go only to the model provider you chose. The remote tunnel is the single door to the outside, it runs from your machine, it only exists while a Quinki window is open, and every device that uses it is explicitly paired and revocable.

## Still stuck?

Open an [issue](https://github.com/Upward991/Quinki/issues) with what you did, what happened, and (if you can) the relevant Log tab entries.
