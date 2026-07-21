import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const __dirname = process.cwd();
const PORT = 9182;

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
      try {
        const msg = JSON.parse(line);
        if (msg.id) console.log(`[RES] id=${msg.id} method=response`);
        else if (msg.method) console.log(`[NOTIFY] ${msg.method}`);
        else console.log(`[OUT] ${line.substring(0, 100)}`);
      } catch {
        console.log(`[RAW] ${line.substring(0, 100)}`);
      }
      for (const ws of wss.clients) {
        if (ws.readyState === ws.OPEN) ws.send(line);
      }
    }
  }
});

sidecar.stderr.on("data", (chunk: Buffer) => {
  const text = chunk.toString().trim();
  if (text && !text.includes("stdout-filter")) console.error(`[ERR] ${text.substring(0, 100)}`);
});

sidecar.on("exit", (code) => { console.log(`[EXIT] ${code}`); process.exit(1); });

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  console.log("[CONN]");
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[REQ] id=${msg.id} method=${msg.method}`);
    } catch {
      console.log(`[IN] ${data.toString().substring(0, 100)}`);
    }
    if (sidecar.stdin.writable) sidecar.stdin.write(data.toString() + "\n");
  });
  ws.on("close", () => console.log("[DISC]"));
});

server.listen(PORT, () => console.log(`[READY]`));
