// =============================================================================
// Quinki CLI — entry point
//
// Two doors:
//   1. `quinki` (interactive)  -> OUR terminal UI (cli/tui) — the app's look.
//   2. `quinki -p ...` / json / rpc / help / ... -> the SDK's automation modes
//      (invisible engine; print output is plain and script-friendly).
//
// Everything reads/writes ~/.quinki — the single source of truth shared with
// the Quinki app (providers, keys, models, agents, skills, sessions).
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- 1. Point everything at ~/.quinki BEFORE the SDK loads ------------------
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || path.join(os.homedir(), ".quinki");
process.env.QUINKI_AGENT_DIR = AGENT_DIR;
// SDK env var names: PI_* (vendor default) + QUINKI_* (after CLI rename) — set both.
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
process.env.QUINKI_CODING_AGENT_DIR = AGENT_DIR;
const SESSION_DIR = path.join(AGENT_DIR, "sessions", "quinki");
if (!process.env.PI_CODING_AGENT_SESSION_DIR) {
  process.env.PI_CODING_AGENT_SESSION_DIR = SESSION_DIR;
}
if (!process.env.QUINKI_CODING_AGENT_SESSION_DIR) {
  process.env.QUINKI_CODING_AGENT_SESSION_DIR = SESSION_DIR;
}

// --- 2. Process identity -----------------------------------------------------
process.title = "quinki";
process.env.PI_CODING_AGENT = "true";
process.env.AI_AGENT = "pi";
process.emitWarning = (() => {}) as any;

// --- 3. SDK bootstrap (used by the automation modes) -------------------------
const sdkMain = await import(
  "../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/main.js"
);
const httpDispatcher = await import(
  "../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js"
);
try {
  httpDispatcher.configureHttpDispatcher();
} catch {}

// --- 4. Args + trust override (automation modes trust by default) ------------
const argv = process.argv.slice(2);
const hasTrustFlag = argv.some(
  (a) => a === "--approve" || a === "-a" || a === "--no-approve" || a === "-na"
);
const args = hasTrustFlag ? argv : [...argv, "--approve"];

// --- 5. Quiet startup (no skills listing / conflict clutter) ------------------
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
} catch {}

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
  // tmux defers OSC 11 to the next client: deliver it straight to the REAL
  // terminal behind tmux via the DCS passthrough (no painting, just asking).
  try {
    if (process.env.TMUX) {
      const osc = "\x1b]11;#08080b\x07";
      termWrite("\x1bPtmux;\x1b" + osc + "\x1b\\");
    }
  } catch {}
  termWrite("\x1b]2;" + (process.env.QUINKI_EXPERT === "1" ? "App Expert" : "quinki") + "\x07");
  const restore = () => termWrite("\x1b]111\x07");
  process.on("exit", restore);
  process.on("SIGTERM", () => {
    // NOT fatal: when the app (or a watchdog) closes, the CLI must survive and
    // let its websocket reconnect loop revive the sidecar. Only restore colours.
    try { require("fs").appendFileSync("/tmp/q-cli-survive.log", "SIGTERM received (ignored, surviving)\n"); } catch {}
    restore();
  });
  process.on("SIGHUP", () => {
    try { require("fs").appendFileSync("/tmp/q-cli-survive.log", "SIGHUP received (ignored, surviving)\n"); } catch {}
    restore();
  });
}

// --- 7. Route: interactive -> OUR TUI; everything else -> SDK modes ----------
// App Expert mode: `quinki expert` -> the SAME TUI, fixed to the expert session,
// orange accent, no chat-management commands.
try {
  if (["expert", "appexpert", "quinkiexpert"].includes(String(argv[0] || ""))) {
    process.env.QUINKI_EXPERT = "1";
    process.env.QUINKI_SESSION_KEY = "__app_expert__";
  }
} catch {}
if ((argv.length === 0 || ["expert", "appexpert", "quinkiexpert"].includes(String(argv[0] || ""))) && process.stdout.isTTY && process.stdin.isTTY) {
  const { runTui } = await import("./tui/app");
  await runTui({ cwd: process.cwd(), agentDir: AGENT_DIR, sessionDir: SESSION_DIR });
} else {
  await sdkMain.main(args);
}
