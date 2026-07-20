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
      console.log(`[OUT] ${line}`);
      for (const ws of wss.clients) {
        if (ws.readyState === ws.OPEN) ws.send(line);
      }
    }
  }
});

sidecar.stderr.on("data", (chunk: Buffer) => {
  console.error(`[ERR] ${chunk.toString().trim()}`);
});

sidecar.on("exit", (code) => { console.log(`[EXIT] code=${code}`); process.exit(1); });

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[CONN]");
  ws.on("message", (data) => {
    console.log(`[IN] ${data.toString()}`);
    if (sidecar.stdin.writable) sidecar.stdin.write(data.toString() + "\n");
  });
  ws.on("close", () => console.log("[DISC]"));
});

server.listen(PORT, () => console.log(`[READY]`));
