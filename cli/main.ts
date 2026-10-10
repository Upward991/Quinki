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
    // T450 (regola utente): terminale chiuso = la CLI DEVE morire. Il SIGHUP è il
    // segnale della morte del terminale: ripristina e esci.
    try { require("fs").appendFileSync("/tmp/q-cli-survive.log", "SIGHUP -> exiting\n"); } catch {}
    restore();
    try { process.exit(0); } catch {}
  });
  // T450: belt — la morte del terminale arriva anche come EOF/EIO dello stdin
  // (chiusura brutale / pty uccisa): ripristina e esci.
  try {
    const qBye = () => { try { restore(); } catch {} try { process.exit(0); } catch {} };
    process.stdin.on("end", qBye);
    process.stdin.on("close", qBye);
    process.stdin.on("error", qBye);
  } catch {}
  process.on("SIGINT", () => {
    try { require("fs").appendFileSync("/tmp/q-cli-survive.log", "SIGINT received (ignored, surviving)\n"); } catch {}
  });
}

// --- 7. Update path: `quinki update` / `quinki update --check` / `--version` --
const { cliVersion, fetchLatestCli, isNewer, selfUpdate, askYesNo } = await import("./update");
{
  const first = String(argv[0] || "");
  if (["version", "--version", "-v"].includes(first)) {
    console.log("quinki CLI " + cliVersion());
    process.exit(0);
  }
  if (first === "update") {
    const checkOnly = argv.includes("--check");
    const cur = cliVersion();
    console.log("quinki CLI " + cur);
    const info = await fetchLatestCli(5000);
    if (!info) {
      console.log("Update check failed (no network?). Try again later.");
      process.exit(1);
    }
    if (!isNewer(info.version, cur)) {
      console.log("Already up to date.");
      process.exit(0);
    }
    console.log("New version available: " + info.version);
    if (checkOnly) process.exit(0);
    console.log("Downloading...");
    const r = await selfUpdate(info.url);
    if (r.ok) console.log("\u2713 Updated to " + info.version + ". The next launch uses the new version.");
    else { console.log("Update failed: " + r.error); process.exit(1); }
    process.exit(0);
  }
}

// --- 8. Route: interactive -> OUR TUI; everything else -> SDK modes ----------
// App Expert mode: `quinki expert` -> the SAME TUI, fixed to the expert session,
// orange accent, no chat-management commands.
try {
  if (["expert", "appexpert", "quinkiexpert"].includes(String(argv[0] || ""))) {
    process.env.QUINKI_EXPERT = "1";
    process.env.QUINKI_SESSION_KEY = "__app_expert__";
  }
} catch {}
if ((argv.length === 0 || ["expert", "appexpert", "quinkiexpert"].includes(String(argv[0] || ""))) && process.stdout.isTTY && process.stdin.isTTY) {
  // Check aggiornamenti A OGNI AVVIO (spec utente 10 ott): mostra la versione della
  // CLI e, se esiste una release piu' nuova, propone l'update (Y/n). Non blocca piu'
  // di ~2.5s; senza rete prosegue in silenzio. Skip: QUINKI_NO_UPDATE_CHECK=1.
  try {
    const cur = cliVersion();
    let info: { version: string; url: string } | null = null;
    if (!process.env.QUINKI_NO_UPDATE_CHECK) info = await fetchLatestCli(2500);
    const upd = info && isNewer(info.version, cur) ? info : null;
    process.stdout.write("\x1b[2mQuinki CLI " + cur + (upd ? "  \u00b7  update available: " + upd.version : "") + "\x1b[0m\n");
    if (upd) {
      const yes = await askYesNo("Update now? [Y/n] ");
      if (yes) {
        process.stdout.write("Downloading...\n");
        const r = await selfUpdate(upd.url);
        if (r.ok) {
          process.stdout.write("\u2713 Updated to " + upd.version + " \u2014 restarting.\n");
          // Rilancio pulito col nuovo binario (stesso terminale), poi si aspetta il figlio.
          try {
            const { spawn } = await import("node:child_process");
            const child = spawn(process.execPath, process.argv.slice(1), { stdio: "inherit" });
            child.on("exit", (code: number | null) => process.exit(code ?? 0));
            await new Promise(() => {});
          } catch {}
        } else {
          process.stdout.write("Update failed: " + r.error + "\n");
        }
      }
    }
  } catch {}
  const { runTui } = await import("./tui/app");
  await runTui({ cwd: process.cwd(), agentDir: AGENT_DIR, sessionDir: SESSION_DIR });
} else {
  await sdkMain.main(args);
}
