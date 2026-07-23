import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const __dirname = process.cwd();
const PORT = parseInt(process.argv[2] || "9182", 10);

const sidecar = spawn("npx", ["tsx", "sidecar.ts"], {
  stdio: ["pipe", "pipe", "pipe"],
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
      for (const ws of wss.clients) {
        if (ws.readyState === ws.OPEN) ws.send(line);
      }
    }
  }
});

sidecar.stderr.on("data", (d) => { process.stderr.write(d); });
sidecar.on("exit", (code) => {
  console.log(`[ws-bridge] Sidecar exited with code ${code}`);
  process.exit(1);
});

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[ws-bridge] Client connected");
  ws.on("message", (data) => {
    if (sidecar.stdin.writable) sidecar.stdin.write(data.toString() + "\n");
  });
});

server.listen(PORT, () => {
  console.log(`[ws-bridge] WebSocket on ws://127.0.0.1:${PORT}`);
});
