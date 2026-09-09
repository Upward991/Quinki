import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = parseInt(process.env.QUINKI_WS_PORT || "9182");
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || join(homedir(), ".quinki");
const SIDECAR_DIR = process.env.QUINKI_SIDECAR_DIR || ".";

const sidecarBinary = join(SIDECAR_DIR, "quinki-sidecar-full");

const wss = new WebSocketServer({ port: PORT });
const clientMap = new Map<any, string>();
const idToClient = new Map<string, any>();
let nextId = 1;

console.log(`WebSocket server on :${PORT}`);
console.error(`Sidecar binary: ${sidecarBinary}`);
console.error(`SIDECAR_DIR: ${SIDECAR_DIR}`);

const sidecar = spawn(sidecarBinary, [], {
  env: {
    ...process.env,
    QUINKI_AGENT_DIR: AGENT_DIR,
    PI_CODING_AGENT_DIR: AGENT_DIR,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

sidecar.on("spawn", () => {
  console.error(`Sidecar spawned successfully (PID: ${sidecar.pid})`);
});

sidecar.on("error", (err) => {
  console.error(`Sidecar spawn error: ${err}`);
});

let stdoutBuffer = "";
sidecar.stdout.on("data", (chunk: Buffer) => {
  stdoutBuffer += chunk.toString();
  let idx;
  while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.substring(0, idx);
    stdoutBuffer = stdoutBuffer.substring(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id) {
        const ws = idToClient.get(msg.id);
        if (ws && ws.readyState === 1) {
          const origId = msg.id.replace(/^[^_]+_/, "");
          ws.send(JSON.stringify({ ...msg, id: origId }));
        }
      } else {
        for (const ws of clientMap.keys()) {
          if (ws.readyState === 1) ws.send(line);
        }
      }
    } catch {}
  }
});

sidecar.stderr.on("data", (d) => process.stderr.write(d));
sidecar.on("exit", (code) => { console.error(`Sidecar exited with code ${code}`); process.exit(1); });

wss.on("connection", (ws) => {
  const prefix = `ws${nextId++}_`;
  clientMap.set(ws, prefix);
  console.error(`[ws-bridge] New connection, prefix=${prefix}`);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id) {
        const rewritten = { ...msg, id: prefix + msg.id };
        idToClient.set(rewritten.id, ws);
        if (sidecar.stdin.writable) {
          sidecar.stdin.write(JSON.stringify(rewritten) + "\n");
        }
      } else {
        if (sidecar.stdin.writable) {
          sidecar.stdin.write(JSON.stringify(msg) + "\n");
        }
      }
    } catch(e) {}
  });

  ws.on("close", () => { console.error(`[ws-bridge] Connection closed`); clientMap.delete(ws); });
});
