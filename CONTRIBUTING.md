
# Contributing

> **Before your first pull request:** you agree to the [Contributor License Agreement](docs/CLA.md).
> It keeps the code open for everyone while ensuring the project stays sustainable.
> By submitting a PR you accept it — no extra paperwork. For larger contributions, add `Signed-off: I agree to the Quinki CLA (docs/CLA.md)` to your commit. to Quinki

Thank you for considering contributing! Quinki is AGPL-3.0 licensed: by contributing you agree that your contributions are released under the same license.

## Ways to contribute

1. **Publish items to the Market** (easiest): tabs, skills, agents, MCP servers, themes. See the Market page in the app or the market repository docs.
2. **Fix bugs or improve the app**: see "Development" below.
3. **Report bugs**: open a GitHub Issue with steps to reproduce.

## Development setup

```bash
git clone <repo-url>
cd Quinki
npm install

# Frontend dev build
npm run build

# Full app build (frontend + Rust + DMG)
export PATH="$HOME/.cargo/bin:$PATH"
npx tauri build

# Sidecar (MUST use the dedicated script: it injects the OAuth secret from
# ~/.quinki/oauth.conf; never put secrets in the repo)
export PATH="$HOME/.bun/bin:$PATH" && bash scripts/build-sidecar.sh
```

## Rules

- All code and UI text in **English**
- Colors via CSS variables (`var(--q-*)`), never hardcoded hex
- No animated transitions (`transition: none`)
- Commit before and after every change; small, focused commits
- Test on the installed app before submitting a PR

## Publishing to the Market

- Items are packages: tab (JS/HTML), skill (SKILL.md), agent (config + PROMPT), MCP config, theme (JSON)
- Each item has a `manifest.json` with an explicit **license** (default: MIT)
- You must own what you publish; the upload flow requires a rights declaration
- PRs are auto-validated (structure, static scan, secret detection, VirusTotal for binaries) and merged automatically

## Code style

- TypeScript, English comments, no animations (design system rule: `transition: none`)
- Keep PRs focused: one feature or fix per PR