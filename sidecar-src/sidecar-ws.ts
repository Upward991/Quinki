// Sidecar with built-in WebSocket server — no ws-bridge needed
import { WebSocketServer } from "ws";
import { homedir } from "node:os";
import { join } from "node:path";

const PORT = parseInt(process.env.QUINKI_WS_PORT || "9182");
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || join(homedir(), ".quinki");

process.env.QUINKI_AGENT_DIR = AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

// We'll import the sidecar module which has handleLine
// But we need to capture stdout. Let's monkey-patch it.
import { EventEmitter } from "node:events";
const stdoutEmitter = new EventEmitter();
let stdoutBuf = "";
const origWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = (chunk: any, ...args: any[]) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString();
  stdoutBuf += text;
  let idx;
  while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.substring(0, idx);
    stdoutBuf = stdoutBuf.substring(idx + 1);
    if (line.trim()) stdoutEmitter.emit("line", line);
  }
  return true;
};

// WebSocket server
const wss = new WebSocketServer({ port: PORT });
console.error(`[sidecar-ws] WebSocket server on :${PORT}, AGENT_DIR=${AGENT_DIR}`);

wss.on("connection", (ws) => {
  console.error(`[sidecar-ws] New connection`);
  
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // Call the sidecar's handleLine directly
      const handleLine = (globalThis as any).__quinki_handleLine;
      if (handleLine) {
        handleLine(JSON.stringify(msg));
      }
    } catch(e) {
      console.error(`[sidecar-ws] Error: ${e}`);
    }
  });
});

// Route stdout to all connected clients
const clients = new Set<any>();
wss.on("connection", (ws) => clients.add(ws));
stdoutEmitter.on("line", (line: string) => {
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(line);
  }
});

(globalThis as any).__quinki_combined = true;

// Now import sidecar — it sets up globalThis.__quinki_handleLine
import('./sidecar.js').then(() => {
  console.error(`[sidecar-ws] Sidecar loaded, handleLine=${typeof (globalThis as any).__quinki_handleLine}`);
}).catch((err) => {
  console.error(`[sidecar-ws] Import failed: ${err}`);
  process.exit(1);
});
