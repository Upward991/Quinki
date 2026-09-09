import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = process.cwd();
const PORT = parseInt(process.env.QUINKI_WS_PORT || process.argv[2] || "9182", 10);

const bundledPath = join(__dirname, "bundle", "ws-bridge.cjs");
const useBundle = existsSync(bundledPath);

// Always use tsx for the sidecar (bundle has stdout buffering issues)
const sidecar = spawn("npx", ["tsx", "sidecar.ts"], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: __dirname,
  env: { ...process.env },
});

let buffer = "";
const server = createServer();
const wss = new WebSocketServer({ server });

// Routing: each client gets unique ID prefixes
// Client sends {id: 1} → sidecar gets {id: "ws1_1"} → response {id: "ws1_1"} → client gets {id: 1}
let clientCounter = 0;
const clientMap = new Map<WebSocket, string>(); // ws → prefix
const idToClient = new Map<string, WebSocket>(); // "ws1_1" → ws

sidecar.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.trim()) {
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined) {
          // Response — route to the specific client that sent the request
          const idStr = String(msg.id);
          const client = idToClient.get(idStr);
          if (client && client.readyState === client.OPEN) {
            // Rewrite ID back to original (strip prefix)
            const originalId = idStr.includes("_") ? idStr.split("_").slice(1).join("_") : idStr;
            const rewritten = line.replace(`"id":${JSON.stringify(msg.id)}`, `"id":${originalId}`);
            client.send(rewritten);
          }
          idToClient.delete(idStr);
        } else {
          // Notification (streaming events, agent_status, etc.) — broadcast to ALL
          for (const ws of wss.clients) {
            if (ws.readyState === ws.OPEN) {
              ws.send(line);
            }
          }
        }
      } catch {
        // Not valid JSON — broadcast to all
        for (const ws of wss.clients) {
          if (ws.readyState === ws.OPEN) ws.send(line);
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
  clientCounter++;
  const prefix = `ws${clientCounter}`;
  clientMap.set(ws, prefix);
  console.log(`[ws-bridge] Client ${prefix} connected`);

  ws.on("message", (data) => {
    if (!sidecar.stdin.writable) return;
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        // Rewrite ID with client prefix before sending to sidecar
        const prefix = clientMap.get(ws);
        const newId = `${prefix}_${msg.id}`;
        idToClient.set(newId, ws);
        msg.id = newId;
        sidecar.stdin.write(JSON.stringify(msg) + "\n");
        return;
      }
    } catch {}
    // Notification or unparseable — pass through as-is
    sidecar.stdin.write(data.toString() + "\n");
  });

  ws.on("close", () => {
    const prefix = clientMap.get(ws);
    clientMap.delete(ws);
    for (const [id, client] of idToClient) {
      if (client === ws) idToClient.delete(id);
    }
    if (prefix) console.log(`[ws-bridge] Client ${prefix} disconnected`);
  });
});

server.listen(PORT, () => {
  console.log(`[ws-bridge] WebSocket on ws://127.0.0.1:${PORT} (routing mode, sidecar: tsx)`);
});