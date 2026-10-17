# CLI reference

`quinki` is the same engine as the app, in your terminal: same chats, same agents, same skills, same tasks. The app installs it automatically; to install it alone:

```bash
curl -fsSL https://raw.githubusercontent.com/Upward991/Quinki/main/install-cli.sh | sh
```

## Commands

| Command | What it does |
|---|---|
| `quinki` | Opens the interactive UI (the app's look, in a terminal) |
| `quinki expert` | Same UI, fixed to the App Expert session (orange accent) |
| `quinki update` | Installs the latest CLI release |
| `quinki update --check` | Only checks whether a new version exists |
| `quinki --version` / `-v` | Prints the CLI version |
| `quinki --help` | The complete option list of the embedded engine |

Anything that isn't the interactive UI is passed to the embedded engine, which also provides **non-interactive modes** for scripting: `-p`/`--print` (run a prompt and exit), `--mode text|json|rpc`, `--model`, `--thinking`, `--continue`, `--session`, tool allow/deny lists, and more. The engine's help text is part of the bundled engine, so it keeps the engine's own naming — Quinki's data, accounts and settings are the same either way.

At startup the CLI also checks for a new version (about two seconds; it silently continues offline). Skip it with `QUINKI_NO_UPDATE_CHECK=1`.

## Slash commands

Type `/` in the composer to open the menu; the same set works as typed commands.

| Command | What it does |
|---|---|
| `/model` | Change model |
| `/thinking` | Thinking: on / off |
| `/compaction` | Compact now, or toggle auto-compaction |
| `/directory` | Working directory |
| `/attachments` | Attachments: new file, folder, last sent |
| `/skill` | Activate a skill |
| `/longhorizon` | Activate or disable Long Horizon mode. When active, Tab switches phase |
| `/reset` | Clear messages. Keeps model, directory and settings |
| `/sessions` | Switch to another chat |
| `/agentinsession` | Agents in this session |
| `/rename` | Rename this chat |
| `/reload` | Reload this chat (recover history, fix glitches) |
| `/syncexpert` | Sync the App Expert with the latest Quinki build |
| `/export` | Export this chat as Markdown |
| `/delete` | Delete this chat |
| `/shortcuts` | All the keyboard shortcuts |
| `/settings` | Settings |
| `/agents` | Agents, skills, MCP, tools, plan mode |
| `/quit` | Exit quinki (asks for confirmation) |

## Keyboard

**Chat**

| Key | Action |
|---|---|
| `Enter` | Send; during a reply it becomes a steer |
| `Esc` | Stop the running reply |
| `/` | Open the command menu |
| `Tab` | Switch Plan / Build (in Long Horizon: next phase) |
| `Ctrl+F` | Show/hide the detailed footers |

**Menu**

| Key | Action |
|---|---|
| `↑` / `↓` | Move through the rows |
| `→` / `←` | Forward / back one level (the forward arrow enters) |
| `Esc` | Close |
| `Enter` | Confirm (run / open) |
| `Tab` | Select (instant, on the ● rows) |

**Toggles** (the collapsible blocks)

| Key | Action |
|---|---|
| `Ctrl+Alt + ↑` / `↓` | Move between the toggles (they invert) |
| `Ctrl+Alt + →` / `←` | Open / close the selected toggle |

**Editor**

| Key | Action |
|---|---|
| `Shift+Enter` | New line (also `\` + Enter) |

## Notes

- The CLI connects to the local engine on loopback ports (main app 9182, App Expert 9183). If the engine isn't running, the CLI starts it.
- Everything is read from and written to the same `~/.quinki` folder as the app — see [Files & Environment](reference-config.html).
- The interface colours can be disabled with `QUINKI_CLI_NO_BG=1` (terminals that don't like background changes).
