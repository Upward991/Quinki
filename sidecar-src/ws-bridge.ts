// ws-bridge.ts — WebSocket bridge for the sidecar
// Spawns sidecar.ts as child process, accepts WebSocket connections,
// forwards WS → stdin, stdout → WS (NDJSON)
//
// Usage: npx tsx ws-bridge.ts [port]
// Default port: 9182

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2] || "9182", 10);

// Spawn sidecar.ts via tsx
const sidecar = spawn("npx", ["tsx", "sidecar.ts"], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

let buffer = "";

sidecar.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.trim()) {
      const msg = line.trim();
      // Broadcast to all connected WS clients
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN) ws.send(msg);
      }
    }
  }
});

sidecar.stderr.on("data", (chunk: Buffer) => {
  // Log stderr but don't forward to clients
  process.stderr.write(chunk);
});

sidecar.on("exit", (code) => {
  console.log(`[ws-bridge] Sidecar exited with code ${code}`);
  process.exit(code || 0);
});

// HTTP + WebSocket server
const server = createServer();
const wss = new WebSocketServer({ server });
const clients = new Set<any>();

wss.on("connection", (ws) => {
  console.log(`[ws-bridge] WebSocket client connected (total: ${clients.size + 1})`);
  clients.add(ws);

  ws.on("message", (data) => {
    // Forward WS message → sidecar stdin
    const msg = data.toString();
    if (msg.trim()) {
      sidecar.stdin.write(msg + "\n");
    }
  });

  ws.on("close", () => {
    console.log(`[ws-bridge] WebSocket client disconnected`);
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error(`[ws-bridge] WebSocket error:`, err);
    clients.delete(ws);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ws-bridge] WebSocket server on ws://127.0.0.1:${PORT}`);
  console.log(`[ws-bridge] Sidecar spawned (PID ${sidecar.pid})`);
});
