import { WebSocketServer } from "ws";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

const PORT = parseInt(process.env.QUINKI_WS_PORT || "9182");
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || join(homedir(), ".quinki");

process.env.QUINKI_AGENT_DIR = AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

(globalThis as any).__quinki_combined = true;

// Capture ALL stdout output
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
const clients = new Set<any>();

stderr("WebSocket server on :" + PORT);

const DIAG_FILE = join(homedir(), ".quinki", "lh-diag.log");
function diag(msg: string) {
  try { require("fs").appendFileSync(DIAG_FILE, new Date().toISOString() + " " + msg + "\n"); } catch {}
}
stdoutEmitter.on("line", (line: string) => {
  if (line.includes("user_message") || line.includes("agent_status") || line.includes("stream_event")) {
    diag("broadcast clients=" + clients.size + " line=" + line.slice(0, 150));
  }
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(line);
  }
});
wss.on("connection", (ws) => {
  diag("client connected, clients=" + (clients.size + 1));
});

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const handleLine = (globalThis as any).__quinki_handleLine;
      if (handleLine) handleLine(JSON.stringify(msg));
    } catch(e) { stderr("Error: " + e); }
  });
  ws.on("close", () => { clients.delete(ws); });
});

function stderr(msg: string) { process.stderr.write("[sidecar-ws] " + msg + "\n"); }

import('./sidecar.ts').then(() => {
  stderr("Sidecar loaded, handleLine=" + typeof (globalThis as any).__quinki_handleLine);
}).catch((err) => {
  stderr("Import failed: " + err);
  process.exit(1);
});
