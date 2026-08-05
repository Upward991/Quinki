import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = process.cwd();
const PORT = parseInt(process.argv[2] || "9182", 10);

// Use bundled sidecar.js (esbuild) — 20x faster than npx tsx
// Fallback to tsx if bundle doesn't exist (dev mode)
const bundledPath = join(__dirname, "bundle", "sidecar.cjs");
const useBundle = existsSync(bundledPath);

// IMPORTANT: always use tsx for the sidecar (not bundle) — bundle has stdout buffering issues
// The ws-bridge itself can use the bundle (it just forwards data)
const sidecar = spawn("npx", ["tsx", "sidecar.ts"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: __dirname,
  env: { ...process.env },
});

let buffer = "";

const server = createServer();
const wss = new WebSocketServer({ server });

let activeClient: WebSocket | null = null;

// ORIGINAL APPROACH: broadcast ALL messages to ALL clients
// ID collisions are handled by the frontend using random IDs
sidecar.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.trim()) {
      // Broadcast to ALL WebSocket clients (responses + notifications)
      for (const ws of wss.clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(line, (err: any) => {
            if (err) console.error("[ws-bridge] send error:", err.message);
          });
        }
      }
    }
  }
});

sidecar.stderr.on("data", (d) => { process.stderr.write(d); });
sidecar.on("exit", (code) => {
  console.log(`[ws-bridge] Sidecar exited with code ${code}`);
  process.exit(1);
});

wss.on("connection", (ws) => {
  console.log("[ws-bridge] Client connected");
  activeClient = ws;
  ws.on("message", (data) => {
    if (sidecar.stdin.writable) sidecar.stdin.write(data.toString() + "\n");
  });
  ws.on("close", () => {
    if (activeClient === ws) activeClient = null;
  });
});

server.listen(PORT, () => {
  console.log(`[ws-bridge] WebSocket on ws://127.0.0.1:${PORT} (mode: ${useBundle ? "bundle" : "tsx"})`);
});