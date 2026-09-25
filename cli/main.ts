// =============================================================================
// Quinki CLI — entry point (E1: DIRECT mode)
//
// What this is: the terminal door into the same house as the app.
// It wires the environment to ~/.quinki (the single source of truth shared
// with the Quinki app: providers, keys, models, agents, skills, sessions)
// and boots the vendored Pi SDK CLI, which provides the full terminal UI
// (interactive TUI, print/one-shot mode, json mode, rpc mode).
//
// No separate config: whatever the app configures, the CLI reads (and vice
// versa once write-paths are wired). Zero migration in both directions.
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- 1. Point everything at ~/.quinki BEFORE the SDK loads ------------------
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || path.join(os.homedir(), ".quinki");
process.env.QUINKI_AGENT_DIR = AGENT_DIR;
// SDK env var names: PI_* (current APP_NAME) + QUINKI_* (after the CLI rename
// via its own package.json next to the binary — set both, harmless either way).
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
process.env.QUINKI_CODING_AGENT_DIR = AGENT_DIR;
// Session store: the exact layout the app/sidecar uses.
if (!process.env.PI_CODING_AGENT_SESSION_DIR) {
  process.env.PI_CODING_AGENT_SESSION_DIR = path.join(AGENT_DIR, "sessions", "quinki");
}
if (!process.env.QUINKI_CODING_AGENT_SESSION_DIR) {
  process.env.QUINKI_CODING_AGENT_SESSION_DIR = path.join(AGENT_DIR, "sessions", "quinki");
}

// --- 2. Process identity (same markers the upstream bin sets) ----------------
process.title = "quinki";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
process.emitWarning = (() => {}) as any;

// --- 3. Boot the full SDK CLI ------------------------------------------------
const sdkMain = await import(
  "../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/main.js"
);
const httpDispatcher = await import(
  "../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js"
);

try {
  httpDispatcher.configureHttpDispatcher();
} catch {
  // best-effort: not critical for local use
}

// --- 4. Project trust: trust by default (same zero-friction behavior as the app)
// The SDK prompts "Trust project folder?" when a folder looks like it has
// project resources — and running from $HOME hits that because ~/.quinki (the
// data dir) literally sits there. The app never asks; the CLI shouldn't either.
// Users can still opt back in to the prompt with --no-approve.
const argv = process.argv.slice(2);
const hasTrustFlag = argv.some(
  (a) => a === "--approve" || a === "-a" || a === "--no-approve" || a === "-na"
);
const args = hasTrustFlag ? argv : [...argv, "--approve"];

// --- 5. Quiet startup: no skills listing / conflict diagnostics clutter -----
// Same settings store as the app (syncSettingsJson preserves unknown keys, so
// this survives app-side writes). Only set when the user never chose a value.
try {
  const settingsPath = path.join(AGENT_DIR, "settings.json");
  let settings: any = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {}
  if (settings.quietStartup === undefined) {
    settings.quietStartup = true;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
  }
} catch {
  // best-effort
}

// --- 6. Terminal chrome: Quinki background + window title, restored on exit --
// OSC 11 sets the terminal background to the app's bg color (#08080b); OSC 111
// resets it on exit. Unsupported terminals ignore these harmlessly.
// Opt out with QUINKI_CLI_NO_BG=1.
if (process.stdout.isTTY && !process.env.QUINKI_CLI_NO_BG) {
  const termWrite = (sq: string) => {
    try {
      process.stdout.write(sq);
    } catch {}
  };
  termWrite("\x1b]11;#08080b\x07");
  termWrite("\x1b]2;quinki\x07");
  const restore = () => termWrite("\x1b]111\x07");
  process.on("exit", restore);
  process.on("SIGTERM", () => {
    restore();
    process.exit(143);
  });
}

await sdkMain.main(args);
