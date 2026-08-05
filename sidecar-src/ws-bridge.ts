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

const sidecar = useBundle
  ? spawn("node", [bundledPath], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: __dirname,
      env: { ...process.env },
    })
  : spawn("npx", ["tsx", "sidecar.ts"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: __dirname,
      env: { ...process.env },
    });

let buffer = "";

const server = createServer();
const wss = new WebSocketServer({ server });

// Track which client sent which request ID — route responses correctly
const requestIdToClient = new Map<number, WebSocket>();

let activeClient: WebSocket | null = null;

sidecar.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.trim()) {
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) {
          // Response — route to the client that sent the request
          const client = requestIdToClient.get(msg.id);
          if (client && client.readyState === client.OPEN) {
            client.send(line);
          }
          requestIdToClient.delete(msg.id);
        } else {
          // Notification (no id) — broadcast to all clients
          for (const ws of wss.clients) {
            if (ws.readyState === ws.OPEN) {
              ws.send(line);
            }
          }
        }
      } catch {
        // Not valid JSON — broadcast to all
        for (const ws of wss.clients) {
          if (ws.readyState === ws.OPEN) {
            ws.send(line);
          }
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
    if (sidecar.stdin.writable) {
      try {
        const msg = JSON.parse(data.toString());
        // Track which client sent this request ID
        if (msg.id !== undefined) {
          requestIdToClient.set(msg.id, ws);
        }
      } catch {}
      sidecar.stdin.write(data.toString() + "\n");
    }
  });
  ws.on("close", () => {
    if (activeClient === ws) activeClient = null;
    // Clean up request mappings for this client
    for (const [id, client] of requestIdToClient) {
      if (client === ws) requestIdToClient.delete(id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[ws-bridge] WebSocket on ws://127.0.0.1:${PORT} (mode: ${useBundle ? "bundle" : "tsx"})`);
});