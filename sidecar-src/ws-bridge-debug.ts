import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 9182;

const sidecar = spawn("npx", ["tsx", "sidecar.ts"], {
  cwd: __dirname,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, QUINKI_AGENT_DIR: process.env.HOME + "/.pi/agent-quinki-dev" },
});

let buffer = "";

sidecar.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (line.trim()) {
      console.log(`[S→W] ${line.substring(0, 150)}`);
      for (const ws of wss.clients) {
        if (ws.readyState === ws.OPEN) ws.send(line);
      }
    }
  }
});

sidecar.stderr.on("data", (chunk: Buffer) => {
  const text = chunk.toString().trim();
  if (text) console.error(`[ERR] ${text.substring(0, 150)}`);
});

sidecar.on("exit", (code) => {
  console.log(`[EXIT] Sidecar exited code=${code}`);
  process.exit(1);
});

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[CONN] Client connected");
  ws.on("message", (data) => {
    console.log(`[W→S] ${data.toString().substring(0, 150)}`);
    if (sidecar.stdin.writable) sidecar.stdin.write(data.toString() + "\n");
  });
  ws.on("close", () => console.log("[DISC] Client disconnected"));
});

server.listen(PORT, () => console.log(`[READY] ws://127.0.0.1:${PORT}`));
