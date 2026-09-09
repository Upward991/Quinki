import { WebSocketServer } from "ws";
import * as http from "node:http";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
// Import STATICO (bundled dal compilatore): il top-level di sidecar.ts è side-effect-free,
// il bootstrap gira DOPO l'avvio del WS server (vedi bootSidecar() sotto).

const PORT = parseInt(process.env.QUINKI_WS_PORT || "9182");
const AGENT_DIR = process.env.QUINKI_AGENT_DIR || join(homedir(), ".quinki");

process.env.QUINKI_AGENT_DIR = AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;

(globalThis as any).__quinki_combined = true;

// Capture ALL stdout output
const stdoutEmitter = new EventEmitter();
let stdoutBuf = "";

const origWrite = process.stdout.write.bind(process.stdout);
// FIX 2026-09-08: il worker ha BISOGNO di un fallback stdout. Il monkey-patch
// intercetta le write e le manda SOLO ai WebSocket clients. Nel worker, quando
// il router NON è ancora connesso, gli eventi andavano PERSI (nessun client).
// Ora: se non ci sono clients connessi, la riga va anche all'stdout ORIGINALE
// (ereditato dal parent = main), che la broadcasta al frontend. ZERO eventi persi.
(globalThis as any).__quinki_origWrite = origWrite;
(process.stdout as any).write = (chunk: any, ...args: any[]) => {
  const text = typeof chunk === 'string' ? chunk : chunk.toString();
  stdoutBuf += text;
  let idx;
  while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
    const line = stdoutBuf.substring(0, idx);
    stdoutBuf = stdoutBuf.substring(idx + 1);
    if (line.trim()) {
      stdoutEmitter.emit("line", line);
      // FALLBACK: se nessun WebSocket client è connesso, scrivi anche allo stdout
      // originale (ereditato dal parent). Nel worker: parent = main = frontend.
      try {
        const _clients = (globalThis as any).__quinki_ws_clients;
        if (!_clients || _clients.size === 0) {
          origWrite(line + "\n");
        }
      } catch {}
    }
  }
  return true;
};

// WebSocket server
// === OAuth GitHub (flusso classico: si apre il BROWSER) ===
// GitHub NON ha CORS → il server locale nel sidecar intercetta il callback
// (http://localhost:<PORT>/callback) e scambia il code col token.
const GH_CLIENT_ID = "Ov23liskJJuKGs1NAsON";
// OAuth secret: NEVER stored in the git repo. Read at runtime from (in order):
// 1) process.env.QUINKI_GH_SECRET — injected at build time via `bun build --define`
//    (value comes from ~/.quinki/oauth.conf on the build machine, never from the repo)
// 2) ~/.quinki/oauth.conf (local file, outside the repo)
function readGhClientSecret(): string {
  try {
    if (process.env.QUINKI_GH_SECRET) return String(process.env.QUINKI_GH_SECRET);
  } catch {}
  try {
    const p = homedir() + "/.quinki/oauth.conf";
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/^GH_CLIENT_SECRET=(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch {}
  return "";
}
const GH_CLIENT_SECRET: string = readGhClientSecret();
(globalThis as any).__quinki_oauth_state = { token: "", pending: false, error: "" };

const httpServer = http.createServer((req: any, res: any) => {
  const url = String(req.url || "");
  if (url.startsWith("/callback")) {
    const q = new URL(url, "http://localhost");
    const code = q.searchParams.get("code") || "";
    const st = (globalThis as any).__quinki_oauth_state || {};
    res.writeHead(200, { "Content-Type": "text/html" });
    if (code) {
      res.end("<html><body style='font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f0f13;color:#e6e6e6'><p>\u2705 Quinki authorized. You can close this tab and go back to the app.</p></body></html>");
      st.pending = true;
      st.error = "";
      (async () => {
        try {
          const r = await fetch("https://github.com/login/oauth/access_token", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ client_id: GH_CLIENT_ID, client_secret: GH_CLIENT_SECRET, code, redirect_uri: "http://localhost:" + PORT + "/callback" }),
          });
          const data = await r.json().catch(() => ({}));
          if (data.access_token) { st.token = data.access_token; st.pending = false; }
          else { st.error = String(data.error_description || data.error || "exchange failed"); st.pending = false; }
        } catch (e: any) { st.error = String(e?.message || e); st.pending = false; }
      })();
    } else {
      st.error = "No code in callback"; st.pending = false;
      res.end("<html><body style='font-family:sans-serif;background:#0f0f13;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh'><p>Authorization failed (no code). Close this tab.</p></body></html>");
    }
    return;
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({ server: httpServer });

// === BROADCAST DIRETTO (29 ago — router pool redesign): funzione esplicita,
// senza passare dall'indirezione stdout. Ogni client protetto singolarmente:
// una socket morta viene espulsa e NON uccide la riga per gli altri.
(globalThis as any).__quinki_broadcast = (payload: any) => {
  const line = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const ws of clients) {
    try { if (ws.readyState === 1) ws.send(line); } catch { try { clients.delete(ws); } catch {} }
  }
};
httpServer.listen(PORT);
const clients = new Set<any>();
(globalThis as any).__quinki_ws_clients = clients; // per il fallback stdout

// FIX A4.3: heartbeat — chiude i client morti (niente accumulo di connessioni stale)
const hb = setInterval(() => {
  for (const ws of clients) {
    if ((ws as any).isAlive === false) { try { ws.terminate(); } catch {} clients.delete(ws); continue; }
    (ws as any).isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);
try { (hb as any).unref?.(); } catch {}

stderr("WebSocket server on :" + PORT);

stdoutEmitter.on("line", (line: string) => {
  // === FIX (29 ago — IL KILLER DELLO STREAMING ALLA RICONNESSIONE): la send su
  // una socket in CHIUSURA lancia un'eccezione che UCCIDEVA l'intera riga →
  // TUTTI gli altri client perdevano l'evento (provato: mittente disconnesso →
  // secondo client riceve ZERO da quel momento). Ora: try/catch PER CLIENT +
  // espulsione immediata della socket morta — la riga sopravvive sempre.
  for (const ws of clients) {
    try {
      if (ws.readyState === 1) ws.send(line);
    } catch {
      try { clients.delete(ws); } catch {}
    }
  }
});

wss.on("connection", (ws) => {
  clients.add(ws);
  (ws as any).isAlive = true;
  ws.on("pong", () => { (ws as any).isAlive = true; });
  ws.on("close", () => { clients.delete(ws); });
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      // registrata con orario su stderr (catturato dal watchdog log). Alla prossima
      const line = JSON.stringify(msg);
      const handleLine = (globalThis as any).__quinki_handleLine;
      if (handleLine) {
        // FIX (29 ago — streaming invisibile alla riapertura): i messaggi arrivati PRIMA
        // della fine del boot del sidecar venivano DROPPATI in silenzio → la selectSession
        // del frontend non riceveva MAI risposta → activeSessionId nullo → TUTTI gli
        // eventi del turno in corso scartati dal filtro del renderer (chat muta, pill
        // assente) finché l'utente non faceva refresh a mano. Ora: coda + flush.
        if (earlyQueue.length) { for (const q of earlyQueue.splice(0)) { try { handleLine(q); } catch {} } }
        handleLine(line);
      } else {
        earlyQueue.push(line);
        if (earlyQueue.length > 300) earlyQueue.shift(); // guardia anti-buca infinita
      }
    } catch(e) { stderr("Error: " + e); }
  });
  ws.on("close", () => { clients.delete(ws); });
});

// Coda dei messaggi arrivati durante il boot: svuotata appena handleLine esiste
const earlyQueue: string[] = [];

function stderr(msg: string) { process.stderr.write("[sidecar-ws] " + msg + "\n"); }

import { bootSidecar } from "./sidecar";
bootSidecar().then(() => {
  stderr("Sidecar loaded, handleLine=" + typeof (globalThis as any).__quinki_handleLine);
  // Flush della coda di boot (se il frontend ha già mandato RPC prima della fine del boot)
  const h = (globalThis as any).__quinki_handleLine;
  if (h && earlyQueue.length) {
    stderr("flush " + earlyQueue.length + " early messages");
    for (const q of earlyQueue.splice(0)) { try { h(q); } catch {} }
  }
}).catch((err) => {
  stderr("Import failed: " + err);
  process.exit(1);
});
