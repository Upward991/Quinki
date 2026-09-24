import { WebSocketServer } from "ws";
import { gzipSync } from "zlib";
import * as http from "node:http";
import { spawn } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, dirname, extname, normalize } from "node:path";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
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

// === WEB APP (F1): la stessa UI del desktop, servita sulla stessa porta del WS ===
// La cartella "web" (build `vite build -c vite.config.web.ts`) vive accanto al
// binario del sidecar (Quinki.app/Contents/Resources/sidecar/web). In dev si puo'
// forzare con QUINKI_WEB_DIR. Se la cartella non esiste, tutto resta identico a prima.
const WEB_DIR = (() => {
  try {
    const env = String(process.env.QUINKI_WEB_DIR || "");
    if (env && existsSync(env)) return normalize(env);
    const exeDir = dirname(process.execPath || "");
    if (exeDir) {
      const cand = join(exeDir, "web");
      if (existsSync(cand)) return normalize(cand);
      const dev = join(exeDir, "..", "resources", "sidecar", "web");
      if (existsSync(dev)) return normalize(dev);
    }
  } catch {}
  return "";
})();
const WEB_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".map": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json",
};
const WEB_VERSION = (() => {
  try {
    const dir = dirname(process.execPath || "");
    // app-version.txt = versione vera dell'app (es. 1.0.0-beta.15).
    // version.txt = git hash (serve all'Expert per il confronto): usato solo come fallback.
    const p1 = join(dir, "app-version.txt");
    if (existsSync(p1)) return String(readFileSync(p1, "utf8")).trim().slice(0, 40);
    const p = join(dir, "version.txt");
    if (existsSync(p)) return String(readFileSync(p, "utf8")).trim().slice(0, 40);
  } catch {}
  return "";
})();
const WEB_IS_EXPERT = String(process.env.QUINKI_ROLE || "").toLowerCase() === "expert" || Number(process.env.QUINKI_WS_PORT || "9182") === 9183;
// Cookie di accesso: nome DIVERSO per main ed Expert. I cookie NON conoscono le
// porte: stesso host = un solo cassetto per nome, e main/Expert si SOVRASCRIVEVANO
// a vicenda (il pair di una spegneva l'altra; il revoke pure). La main tiene il
// nome storico (le coppie esistenti restano valide), l'Expert usa il suo.
const COOKIE_NAME = WEB_IS_EXPERT ? "quinki_token_x" : "quinki_token";

// === F0.1 REMOTE AUTH (modello OpenClaw: auth "token" di default per i client remoti) ===
// Il token vive in ~/.quinki/remote.json (creato al primo avvio). I client LOOPBACK
// (app desktop, worker del pool) sono esenti; tutto il resto (LAN e tunnel) deve
// presentare il token: ?token=... (una volta, imposta il cookie) oppure il cookie.
// ATTENZIONE: il traffico del tunnel arriva DA 127.0.0.1 (cloudflared gira sul Mac)
// → i proxy che iniettano x-forwarded-for/cf-connecting-ip NON sono loopback.
const REMOTE_FILE = join(AGENT_DIR, WEB_IS_EXPERT ? "remote-expert.json" : "remote.json");
let _remoteTokenCache = { at: 0, v: "" };
function remoteToken(): string {
  const now = Date.now();
  if (_remoteTokenCache.v && now - _remoteTokenCache.at < 1000) return _remoteTokenCache.v;
  try {
    if (existsSync(REMOTE_FILE)) {
      const j = JSON.parse(readFileSync(REMOTE_FILE, "utf8"));
      if (j && typeof j.token === "string" && j.token.length >= 16) { _remoteTokenCache = { at: now, v: j.token }; return j.token; }
    }
  } catch {}
  const tok = randomBytes(24).toString("hex");
  try { writeFileSync(REMOTE_FILE, JSON.stringify({ token: tok, createdAt: new Date().toISOString() }, null, 2)); } catch {}
  _remoteTokenCache = { at: now, v: tok };
  return tok;
}

function isLoopbackReq(req: any): boolean {
  try {
    const h = req.headers || {};
    if (h["x-forwarded-for"] || h["cf-connecting-ip"] || h["x-real-ip"] || h["x-forwarded-proto"]) return false;
    const addr = String(req.socket && req.socket.remoteAddress || "");
    return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  } catch { return false; }
}
function tokenFromReq(req: any, url: string): string {
  try {
    const q = new URL(url, "http://localhost");
    const t = q.searchParams.get("token");
    if (t) return t;
  } catch {}
  try {
    const c = String((req.headers && req.headers.cookie) || "");
    const m = new RegExp(COOKIE_NAME + "=([^;]+)").exec(c);
    if (m) return decodeURIComponent(m[1]);
  } catch {}
  return "";
}
function tokenOk(t: string): boolean {
  try {
    const a = Buffer.from(String(t));
    const b = Buffer.from(remoteToken());
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}

// === DISPOSITIVI ACCOPPIATI ===
// Ogni dispositivo ha il SUO token (mai piu' quello master): revoca per dispositivo,
// e il refresh del token master NON scollega i dispositivi gia' accoppiati.
// Il file vive in ~/.quinki → sopravvive a update/reinstall/riavvii dell'app.
const DEVICES_FILE = join(AGENT_DIR, WEB_IS_EXPERT ? "remote-devices-expert.json" : "remote-devices.json");
type RemoteDevice = { id: string; name: string; token: string; createdAt: number; lastSeen: number };

function loadDevices(): RemoteDevice[] {
  try {
    if (existsSync(DEVICES_FILE)) {
      const j = JSON.parse(readFileSync(DEVICES_FILE, "utf8"));
      if (Array.isArray(j)) return j.filter((d: any) => d && typeof d.token === "string");
    }
  } catch {}
  return [];
}
function saveDevices(list: RemoteDevice[]): void {
  try { writeFileSync(DEVICES_FILE, JSON.stringify(list, null, 2)); } catch {}
}
function deviceNameFromUA(ua: string): string {
  const u = String(ua || "");
  // App Android native: nomi dedicati, cosi' non collidono col browser del telefono
  if (/QuinkiAppExpert\//.test(u)) return "App Expert · Android";
  if (/QuinkiApp\//.test(u)) return "Quinki · Android";
  const os = /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Macintosh/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : /Linux/.test(u) ? "Linux" : "Device";
  const br = /Edg\//.test(u) ? "Edge" : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : /Firefox\//.test(u) ? "Firefox" : "Browser";
  return os + " · " + br;
}
function findDeviceByToken(t: string): RemoteDevice | null {
  const list = loadDevices();
  for (const d of list) {
    try {
      const a = Buffer.from(String(t)); const b = Buffer.from(d.token);
      if (a.length === b.length && timingSafeEqual(a, b)) return d;
    } catch {}
  }
  return null;
}
function touchDevice(id: string): void {
  const list = loadDevices();
  const d = list.find(x => x.id === id);
  if (!d) return;
  if (Date.now() - (d.lastSeen || 0) < 60000) return; // non scrivere a ogni richiesta
  d.lastSeen = Date.now();
  saveDevices(list);
}
// Accoppia (o riaccoppia) un dispositivo: se ha gia' un cookie valido lo riusa,
// altrimenti crea una nuova voce (dedup per user-agent visto di recente).
function pairDevice(req: any): string {
  const ua = String((req.headers && req.headers["user-agent"]) || "");
  const list = loadDevices();
  const now = Date.now();
  const same = list.find(d => d.name === deviceNameFromUA(ua) && now - (d.lastSeen || 0) < 24 * 3600 * 1000);
  if (same) { same.lastSeen = now; saveDevices(list); return same.token; }
  const token = randomBytes(24).toString("hex");
  const d: RemoteDevice = { id: randomBytes(6).toString("hex"), name: deviceNameFromUA(ua), token, createdAt: now, lastSeen: now };
  list.push(d);
  saveDevices(list);
  return token;
}
// File pubblici: identità PWA + bundle statico (nessun dato sensibile; la sicurezza
// resta su pagina app e WebSocket). Chrome li scarica SENZA credenziali durante il
// controllo di installazione: se rispondono 401 la PWA "cannot be installed".
const PUBLIC_PATH = /^\/(manifest\.webmanifest|manifest-expert\.webmanifest|sw\.js|quinki-logo\.png|favicon\.ico|icons\/|assets\/|fonts\/)/;

function pairingPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quinki — pair this device</title><style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#040406;color:#e8e8ec;font-family:-apple-system,Geist,sans-serif}
form{display:flex;flex-direction:column;gap:12px;width:min(340px,86vw)}
h1{font-size:17px;margin:0 0 4px 0}p{color:#888892;font-size:13px;margin:0 0 6px 0;line-height:1.5}
input{height:40px;border-radius:10px;border:1px solid #ffffff14;background:#0e0e10;color:#e8e8ec;padding:0 12px;font-size:14px;outline:none}
button{height:40px;border-radius:8px;border:1px solid #7aa2f7;background:transparent;color:#7aa2f7;font-size:14px;font-weight:600;cursor:pointer}
</style></head><body><form method="get" action="/">
<h1>Pair this device</h1>
<p>Paste the access token shown in Quinki → Settings → Web app on the Mac. You do this only once per device.</p>
<input name="token" placeholder="access token" autocomplete="off" autofocus>
<button type="submit">Connect</button>
</form></body></html>`;
}


const _gzCache = new Map<string, { key: string; buf: Buffer }>();

// Path del binario helper per la dettatura (compilato da tools/dictation-helper,
// spedito accanto al sidecar nel bundle; in dev si usa la build locale).
function dictationBinPath(): string {
  const exeDir = dirname(process.execPath || "");
  const cands = [
    join(exeDir, "..", "dictation-helper", "dictate"),
    join(exeDir, "dictation-helper", "dictate"),
    join(process.cwd(), "tools", "dictation-helper", ".build", "release", "dictate"),
  ];
  for (const c of cands) { try { if (existsSync(c)) return c; } catch {} }
  return cands[0];
}

function serveWebApp(req: any, res: any, url: string): boolean {
  if (!WEB_DIR) return false;
  let rel = url.split("?")[0].split("#")[0];
  try { rel = decodeURIComponent(rel); } catch {}
  if (rel === "/" || rel === "") rel = "/index.html";
  if (!extname(rel)) rel = "/index.html"; // SPA fallback
  const full = normalize(join(WEB_DIR, rel));
  if (!full.startsWith(WEB_DIR)) return false; // traversal guard
  if (!existsSync(full)) return false;
  try { if (!statSync(full).isFile()) return false; } catch { return false; }
  const ext = extname(full).toLowerCase();
  const isHtml = full.endsWith("index.html");
  const noStore = isHtml || full.endsWith("sw.js"); // sw.js: mai cache, ma MAI iniettare HTML!
  const compressible = ["js", "css", "html", "json", "svg", "webmanifest", "txt"].includes(ext.replace(/^\./, ""));
  const acceptsGz = String(req.headers["accept-encoding"] || "").toLowerCase().includes("gzip");
  let body = readFileSync(full);
  if (isHtml) {
    // Pagina Expert: o il sidecar E' l'Expert (app Expert), o e' la pagina
    // aperta col parametro ?expert=1 (secondo link web dedicato). In quel caso
    // il frontend parte direttamente in modalita' Expert e la pagina porta
    // l'identita' PWA propria: manifest, icona e nome "Quinki Expert".
    const isExpertPage = WEB_IS_EXPERT || /[?&]expert=1(?:&|$)/.test(String(req.url || ""));
    // Payload per il frontend: server WS (stesso host del browser, anche dietro
    // reverse proxy) + ruolo + versione. Il token arrivera' qui (F0.1).
    const proto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const host = String(req.headers["host"] || `127.0.0.1:${PORT}`);
    const payload: any = { web: true, server: `${proto === "https" ? "wss" : "ws"}://${host}`, expert: isExpertPage };
    if (WEB_VERSION) payload.version = WEB_VERSION;
    const tag = `<script>window.__QUINKI__=${JSON.stringify(payload)};</script>`;
    let html = body.toString("utf8");
    if (isExpertPage) {
      html = html
        .replace("/icons/apple-touch-icon.png", "/icons/expert-apple-touch.png")
        .replace("/manifest.webmanifest", "/manifest-expert.webmanifest")
        .replace('content="Quinki"', 'content="App Expert"')
        .replace("<title>Quinki</title>", "<title>App Expert</title>");
    }
    body = Buffer.from(html.includes("</head>") ? html.replace("</head>", tag + "</head>") : tag + html, "utf8");
  }
  // gzip per i testi (il bundle e' grande: 1.4MB -> ~350KB). Con cache in memoria
  // per file (chiave = size+mtime): la prima richiesta comprime, le altre no.
  let useGz = false;
  if (compressible && acceptsGz && body.length > 1024) {
    if (isHtml) {
      body = gzipSync(body);
    } else {
      try {
        const st = statSync(full);
        const key = st.size + ":" + st.mtimeMs;
        const hit = _gzCache.get(full);
        if (hit && hit.key === key) body = hit.buf;
        else {
          const buf = gzipSync(body);
          _gzCache.set(full, { key, buf });
          if (_gzCache.size > 80) { const first = _gzCache.keys().next().value; if (first) _gzCache.delete(first); }
          body = buf;
        }
      } catch { body = gzipSync(body); }
    }
    useGz = true;
  }
  // Cache: assets con hash nel nome = immutabili per sempre; il resto 1 giorno;
  // html/sw.js mai (cosi' la web app prende sempre l'ultima versione).
  const hashed = rel.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": WEB_MIME[ext] || "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": noStore ? "no-store" : hashed ? "public, max-age=31536000, immutable" : "public, max-age=86400",
    ...(useGz ? { "Content-Encoding": "gzip", "Vary": "Accept-Encoding" } : {}),
  });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

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
  // === F0.1: auth per i client remoti (loopback esente) ===
  try {
    const pathOnly = url.split("?")[0];
    if (!isLoopbackReq(req) && !url.startsWith("/callback") && !PUBLIC_PATH.test(pathOnly)) {
      const t = tokenFromReq(req, url);
      const dev = t ? findDeviceByToken(t) : null;
      const accept = String(req.headers["accept"] || "");
      const isDoc = accept.includes("text/html") || url === "/" || url.startsWith("/?");
      const hasQueryToken = /[?&]token=/.test(url);
      const appHeader = String(req.headers["x-quinki-app"] || "") === "1";
      if (dev) {
        touchDevice(dev.id);
      } else if (tokenOk(t)) {
        // token MASTER: serve SEMPRE (manifest/icone/service worker non devono mai
        // prendere un redirect, altrimenti Chrome non puo' installare la PWA).
        // Solo per le PAGINE: imposta/aggiorna il cookie col token del dispositivo.
        const dt = pairDevice(req);
        if (hasQueryToken && isDoc) {
          res.writeHead(302, {
            "Set-Cookie": `${COOKIE_NAME}=${encodeURIComponent(dt)}; Path=/; Max-Age=31536000; SameSite=Lax`,
            "Location": "/",
          });
          res.end();
          return;
        }
        try { res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(dt)}; Path=/; Max-Age=31536000; SameSite=Lax`); } catch {}
      } else {
        // pagina app -> pairing (200: e' un documento valido, il controllo di
        // installazione non deve fallire; l'accesso ai dati resta protetto dal token)
        if (isDoc && appHeader) {
          // App Android non accoppiata: 401 esplicito, cosi' l'app mostra la sua
          // schermata di abbinamento interna invece della pagina web.
          res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Unauthorized");
        } else if (isDoc) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          res.end(pairingPage());
        } else {
          res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Unauthorized");
        }
        return;
      }
    }
  } catch {}

  // === DETTATURA (locale): l'audio arriva dal composer (WAV 16k mono, prodotto
  // dal browser col decoder + encoder WAV in JS). Il sidecar lancia l'helper swift
  // (Parakeet v3 via FluidAudio, CoreML/ANE): prima esecuzione in assoluto ~1 min
  // (compilazione CoreML), poi ~0.2s. Risponde {ok, text}. Autenticato dal gate sopra.
  if (req.method === "POST" && url.startsWith("/transcribe")) {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      let tooBig = false;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 40 * 1024 * 1024) { tooBig = true; try { req.destroy(); } catch {} return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (tooBig) { res.writeHead(413, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "audio too big" })); return; }
        const buf = Buffer.concat(chunks);
        if (buf.length < 200) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "empty audio" })); return; }
        const tmp = join(tmpdir(), "quinki-dict-" + Date.now().toString(36) + ".wav");
        try { writeFileSync(tmp, buf); } catch (e: any) { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "write failed" })); return; }
        let child: any = null;
        try {
          child = spawn(dictationBinPath(), ["transcribe", tmp]);
        } catch (e: any) {
          try { rmSync(tmp, { force: true }); } catch {}
          res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: "helper spawn failed" })); return;
        }
        let out = "", err = "";
        child.stdout.on("data", (d: any) => { out += d.toString(); });
        child.stderr.on("data", (d: any) => { err += d.toString(); });
        const timer = setTimeout(() => { try { child.kill(); } catch {} }, 300000);
        child.on("close", (code: number) => {
          clearTimeout(timer);
          try { rmSync(tmp, { force: true }); } catch {}
          const text = String(out || "").trim();
          if (code === 0 && text) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, text }));
          } else {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: String(err || ("exit " + code)).slice(-300) }));
          }
        });
      });
    } catch (e: any) {
      try { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: String(e?.message || e) })); } catch {}
    }
    return;
  }

  // === UPLOAD (F1): allegati dal browser/telefono -> file sul Mac ===
  // Autenticato dal gate qui sopra (cookie del dispositivo). Il nome arriva in
  // query, i byte nel body: il file finisce in ~/.quinki/web-uploads/<id>/ e
  // torna il percorso locale, che il flusso allegati tratterà come al solito.
  if (req.method === "POST" && url.startsWith("/upload")) {
    try {
      const q = new URLSearchParams(url.split("?")[1] || "");
      const rawName = (q.get("name") || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
      const dir = join(process.env.HOME || "/tmp", ".quinki", "web-uploads", Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8));
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, rawName);
      const chunks: Buffer[] = [];
      let size = 0;
      let tooBig = false;
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > 200 * 1024 * 1024) { tooBig = true; try { req.destroy(); } catch {} return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (tooBig) { res.writeHead(413); res.end("too big"); return; }
        try {
          writeFileSync(dest, Buffer.concat(chunks));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, path: dest }));
        } catch (e: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(e) }));
        }
      });
    } catch {
      res.writeHead(500); res.end("upload error");
    }
    return;
  }

  // === WEB APP (F1): la stessa UI del desktop, servita sulla stessa porta del WS ===
  if (req.method === "GET" || req.method === "HEAD") {
    try { if (serveWebApp(req, res, url)) return; } catch {}
  }
  res.writeHead(404); res.end();
});
const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info: any, cb: (ok: boolean, code?: number, message?: string) => void) => {
    try {
      if (isLoopbackReq(info.req)) return cb(true);
      const t = tokenFromReq(info.req, String(info.req.url || ""));
      if (tokenOk(t)) return cb(true);
      const dev = t ? findDeviceByToken(t) : null;
      if (dev) { touchDevice(dev.id); return cb(true); }
      return cb(false, 401, "Unauthorized");
    } catch { return cb(false, 401, "Unauthorized"); }
  },
});

// === BROADCAST DIRETTO (29 ago — router pool redesign): funzione esplicita,
// senza passare dall'indirezione stdout. Ogni client protetto singolarmente:
// una socket morta viene espulsa e NON uccide la riga per gli altri.
(globalThis as any).__quinki_broadcast = (payload: any) => {
  const line = typeof payload === "string" ? payload : JSON.stringify(payload);
  for (const ws of clients) {
    try { if (ws.readyState === 1) ws.send(line); } catch { try { clients.delete(ws); } catch {} }
  }
};
httpServer.listen(PORT, "127.0.0.1"); // F0: solo loopback. L'accesso da fuori passa SOLO dal tunnel (cloudflared e' locale); la LAN e' volutamente chiusa.
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

wss.on("connection", (ws, req: any) => {
  clients.add(ws);
  (ws as any).isAlive = true;
  // Chi e' questa connessione? (device token -> id): serve a legare le push al
  // dispositivo, cosi' al Revoke spariscono quelle del device rimosso.
  try {
    const t = tokenFromReq(req, String(req?.url || ""));
    const dev = t ? findDeviceByToken(t) : null;
    (ws as any).__devId = dev ? dev.id : "";
  } catch { (ws as any).__devId = ""; }
  ws.on("pong", () => { (ws as any).isAlive = true; });
  ws.on("close", () => { clients.delete(ws); });
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      try { if (msg && msg.params && typeof msg.params === "object") msg.params.__dev = (ws as any).__devId || ""; } catch {}
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
