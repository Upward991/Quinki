# The Quinki Market

The Market is Quinki's catalog of community-made content: **tabs**, **skills**, **agents**, **MCP servers** and **themes**.

## How it works

- The Market **lives on GitHub** (this repository). Quinki is just a client: the app reads the catalog through the GitHub API and installs packages straight from it. No servers, no accounts on our side.
- Anyone can **publish**: the app forks this repo, commits your package, and opens a pull request. Continuous integration validates it and merges automatically: no manual review, no waiting for a human.
- **Multi-source**: you can also browse your own GitHub repos as additional catalogs (skills as `SKILL.md`, agents as `agents/*.md`, MCP configs as `*mcp.json`).

## Publishing an item

1. Open **Market → Publish** in Quinki and log in with GitHub (browser OAuth, token stays on your machine)
2. Pick **what you created** (the app only lists your own items, per category)
3. Set a version for each item
4. Choose a **license** (default: MIT; options: Apache-2.0, CC0-1.0, CC BY 4.0)
5. Confirm: *"I confirm I own this content and release it under the selected license"*
6. Submit → a pull request opens → automatic validation → merge

## Package format

Every package lives in `packages/<category>/<id>/` with a `manifest.json`:

```json
{
  "id": "my-item",
  "name": "My Item",
  "version": "1.0.0",
  "author": "your-github-handle",
  "description": "What it does",
  "icon": "📦",
  "color": "#888888",
  "license": "MIT",
  "category": "skill",
  "downloadUrl": "https://raw.githubusercontent.com/Upward991/quinki-market/main/packages/skill/my-item/",
  "source": "Upward991/quinki-market"
}
```

### Category details

**tab**: an interactive panel inside Quinki
```
packages/tab/my-tab/
├── manifest.json
├── index.html      # frontend (rendered in the tab runtime)
├── app.js          # optional extra assets
└── server.js       # optional back-end (runs in the sidecar; RPC as "<tabId>:<method>")
```
The back-end gets a limited context: its own data dir and a whitelist of sidecar calls (agent queries, logging). It cannot touch the filesystem outside its own directory.

**skill**: a single `SKILL.md` with YAML frontmatter (`name`, `description`) and Markdown body. Injected into agent prompts on demand.

**agent**: `config.json` (name, model, thinking level, tools, skills) + `PROMPT.md` (the agent's system prompt).

**mcp**: a `*.mcp.json` server config (stdio command or url endpoint).

**theme**: a JSON with the CSS variables (background, panel, accents, radius).

## Automatic validation (why your PR merges itself)

Every PR runs the market CI:

1. **Structure**: manifest fields, category path, required files present
2. **Static scan**: the app's own safety scanner (dangerous patterns, file operations)
3. **Secret detection**: leaked API keys/tokens block the merge
4. **VirusTotal**: binary attachments are scanned
5. **Merge**: all green → the PR merges itself. No human review needed

If your PR fails, the check output tells you why; fix and push to the same branch.

## Licenses and rights

- Every package declares a license (default **MIT**) chosen by its author at publish time
- By publishing you declare that you own the content: false declarations are your responsibility
- Report abuse or copyright issues by opening an Issue here: content is removed after verification (DMCA-compatible takedown process)

## Commercial items and author earnings

- **Authors own their items 100%.** Market items are the author's content, not part of the Quinki source code. The project CLA (`docs/CLA.md`) applies only to contributions to the app's source code, **never** to market items.
- Authors may publish **free or paid** items. For paid items, the author sets the price and the license; the purchase is between the buyer and the author.
- The platform applies a **10% fee** on paid transactions (processing costs and market maintenance). The rest is the author's.
- Paid item mechanics: the buyer purchases a license key from the author (or the author's checkout link, declared in the manifest); the app verifies the key and unlocks the item. Quinki never holds author money — the app simply checks the license.
- Free items remain the default and the recommended path: they build reputation, installs and followers inside the app.

## Anti-theft

A local registry tracks what you installed and published (hashes + origin). Re-publishing someone else's package is blocked. If you believe an item infringes your work, open an Issue with the details.

## Removing your item

Market → Publish → *Your published* → Remove. The app opens a removal PR; auto-merge takes care of it. Installed copies on other machines get a "Removed from repo" notice.