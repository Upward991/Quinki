// Standalone Quinki sidecar — WebSocket server + sidecar logic in one process
// No child process spawning needed

import { createServer } from "node:net";
import { WebSocketServer } from "ws";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = parseInt(process.env.QUINKI_WS_PORT || "9182");
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || join(homedir(), ".quinki");

// Import sidecar logic directly
process.env.QUINKI_AGENT_DIR = AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

// We need to import the sidecar module which sets up JSON-RPC handlers
// The sidecar reads from stdin and writes to stdout
// We'll intercept stdin/stdout and bridge them to WebSocket

import('./sidecar.js').then((sidecarModule) => {
  console.error(`[standalone] Sidecar module loaded`);
  // The sidecar module sets up its own stdin/stdout handlers
  // We need to create a fake stdin/stdout that we control
}).catch((err) => {
  console.error(`[standalone] Failed to load sidecar: ${err}`);
  process.exit(1);
});

// Actually, the sidecar.ts uses process.stdin/process.stdout directly
// We can't easily intercept those in the same process.
// 
// Better approach: keep the two-process model but use a SHELL SCRIPT
// instead of a compiled binary for the ws-bridge.
// The ws-bridge.ts is bundled with esbuild and runs with node.
// The sidecar.ts runs with npx tsx.
// 
// BUT we need Node.js for this. If the user doesn't have Node.js...
// 
// Let me try yet another approach: use bun to run the ORIGINAL ws-bridge.ts
// directly (not compiled) — bun can run TypeScript natively

console.error(`[standalone] Starting WebSocket server on :${PORT}`);

const wss = new WebSocketServer({ port: PORT });
const clientMap = new Map<any, string>();
const idToClient = new Map<string, any>();
let nextId = 1;

// Spawn the sidecar-full binary
import { spawn } from "node:child_process";
const sidecarDir = process.env.QUINKI_SIDECAR_DIR || ".";
const sidecarBinary = join(sidecarDir, "quinki-sidecar-full");

console.error(`[standalone] Spawning sidecar: ${sidecarBinary}`);

const sidecar = spawn(sidecarBinary, [], {
  env: { ...process.env, QUINKI_AGENT_DIR: AGENT_DIR, PI_CODING_AGENT_DIR: AGENT_DIR },
  stdio: ["pipe", "pipe", "pipe"],
});

sidecar.on("spawn", () => console.error(`[standalone] Sidecar spawned (PID: ${sidecar.pid})`));
sidecar.on("error", (err) => console.error(`[standalone] Spawn error: ${err}`));

let stdoutBuffer = "";
sidecar.stdout.on("data", (chunk: Buffer) => {
  stdoutBuffer += chunk.toString();
  console.error(`[standalone] stdout data: ${chunk.length} bytes`);
  let idx;
  while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.substring(0, idx);
    stdoutBuffer = stdoutBuffer.substring(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      console.error(`[standalone] Parsed: id=${msg.id}`);
      if (msg.id) {
        const ws = idToClient.get(msg.id);
        if (ws && ws.readyState === 1) {
          const origId = msg.id.replace(/^[^_]+_/, "");
          ws.send(JSON.stringify({ ...msg, id: origId }));
          console.error(`[standalone] Sent to client: ${origId}`);
        }
      } else {
        for (const ws of clientMap.keys()) {
          if (ws.readyState === 1) ws.send(line);
        }
      }
    } catch (e) {
      console.error(`[standalone] Parse error: ${e}`);
    }
  }
});

sidecar.stderr.on("data", (d) => process.stderr.write(d));
sidecar.on("exit", (code) => { console.error(`[standalone] Sidecar exited: ${code}`); process.exit(1); });

wss.on("connection", (ws) => {
  const prefix = `ws${nextId++}_`;
  clientMap.set(ws, prefix);
  console.error(`[standalone] Connection ${prefix}`);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id) {
        const rewritten = { ...msg, id: prefix + msg.id };
        idToClient.set(rewritten.id, ws);
      }
      const toSend = JSON.stringify(msg) + "\n";
      sidecar.stdin.write(toSend);
      console.error(`[standalone] Sent to sidecar: ${msg.method} id=${msg.id}`);
    } catch (e) {
      console.error(`[standalone] Error: ${e}`);
    }
  });

  ws.on("close", () => clientMap.delete(ws));
});
