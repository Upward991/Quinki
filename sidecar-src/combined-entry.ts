import { WebSocketServer } from "ws";
import { homedir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";

const PORT = parseInt(process.env.QUINKI_WS_PORT || "9182");
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || join(homedir(), ".quinki");

process.env.QUINKI_AGENT_DIR = AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

// Mark combined mode — prevents stdin close exit
(globalThis as any).__quinki_combined = true;

// Monkey-patch process.stdout to capture output
const stdoutEmitter = new EventEmitter();
let stdoutBuffer = "";
(process.stdout as any).write = (chunk: any, ...args: any[]) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString();
  stdoutBuffer += text;
  let idx;
  while ((idx = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.substring(0, idx);
    stdoutBuffer = stdoutBuffer.substring(idx + 1);
    if (line.trim()) stdoutEmitter.emit("line", line);
  }
  return true;
};

// WebSocket server
const wss = new WebSocketServer({ port: PORT });
const clientMap = new Map<any, string>();
const idToClient = new Map<string, any>();
let nextId = 1;

console.error(`[combined] WebSocket server on :${PORT}`);

stdoutEmitter.on("line", (line: string) => {
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
});

wss.on("connection", (ws) => {
  const prefix = `ws${nextId++}_`;
  clientMap.set(ws, prefix);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id) {
        const rewritten = { ...msg, id: prefix + msg.id };
        idToClient.set(rewritten.id, ws);
      }
      const handleLine = (globalThis as any).__quinki_handleLine;
      if (handleLine) {
        handleLine(JSON.stringify(msg));
      }
    } catch(e) {
      console.error(`[combined] Error: ${e}`);
    }
  });

  ws.on("close", () => clientMap.delete(ws));
});

import('./sidecar.js').then(() => {
  console.error(`[combined] Sidecar loaded, handleLine=${typeof (globalThis as any).__quinki_handleLine}`);
}).catch((err) => {
  console.error(`[combined] Sidecar import failed: ${err}`);
  process.exit(1);
});
