// pool-router.ts — B4-C: process pool manager + router + shrink (SOLO nel main, pool-0)
//
// Il main (QUINKI_POOL_SIZE=N, QUINKI_POOL_INDEX=0) gestisce N-1 child (stesso binario,
// QUINKI_WS_PORT=9184+i, QUINKI_POOL_INDEX=i):
// - SPAWN LAZY: i child nascono quando serve la prima sessione del loro gruppo (o subito
//   al boot se QUINKI_POOL_EAGER=1). Le RPC per un child non ancora pronto restano in coda.
// - ROUTING: RPC per-sessione → child proprietario (hash djb2); eventi/risposte → stdout
//   (broadcast, stesso modello del single-process).
// - SHRINK: ogni 60s chiede lo stato al child (poolStatus); se idle (zero streaming,
//   zero sessioni attive) per 5 minuti consecutivi → lo spegne. Se poi serve → rispawna.
// - RESPAWN su crash: un child morto per errore viene rispawnato + il recovery lo riprende.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const POOL_BASE_PORT = 9184; // evita 9182 (main) e 9183 (Expert)
const IDLE_KILL_MS = parseInt(process.env.QUINKI_POOL_IDLE_MS || "", 10) || (10 * 60 * 1000); // child idle da 10 min → spento (compromesso utente: non troppo aggressivo, libera RAM quando non serve)
const STATUS_INTERVAL_MS = parseInt(process.env.QUINKI_POOL_STATUS_MS || "", 10) || (60 * 1000);
const CHILD_START_TIMEOUT = 30000; // max attesa per il primo forward dopo lo spawn (20s: il worker deve caricare Pi SDK)

let active = false;
let poolN = 1;
let initDone = false;
const childSockets = new Map<number, any>();
const childProcs = new Map<number, any>();
const childStarting = new Map<number, number>(); // owner → timestamp spawn
const childRetired = new Set<number>(); // shrink: NON rispawnare finché serve una sessione
const lastForwarded = new Map<string, number>(); // FIX A4.3: dedup eventi inoltrati (firma → timestamp)
const pendingRpc = new Map<number, (m: any) => void>();
let nextRpcId = 1_000_000;
const ensuredOnChild = new Set<string>();
const queuedRoutes = new Map<number, any[]>(); // RPC in coda mentre il child parte
const idleSince = new Map<number, number>();

// RPC per-sessione che DEVONO andare al child proprietario della sessione.
// FIX A4.3: le LETTURE NON vanno al worker (leggono da disco/registry in ms) —
// il worker lazy spawnerebbe in ~1.5s rendendo il caricamento chat lentissimo.
// Il worker resta per SCRITTURE/LLM (sendMessage, steer, set*, ecc.).
const ROUTABLE = new Set([
  "setModel", "setThinking", "setMode", "setAgent", "setChatAgents",
  "setAgentOverride", "getAgentOverrides", "injectErrorExchange",
  "reloadSession", "setWorkingDir", "resetSession", "setSessionCompaction",
  "abort", "abortCompaction", "stopStream", "sendMessage", "steer", "injectClip",
  "compactSession",
  "setSessionFallbacks",
  "injectSystemMessage", "setMessageSkills", "setMessageTaskClips", "setMessageAttachments",
  // FIX 084 (03 set): le RPC Long Horizon DEVONO girare sul worker OWNER — prima
  // giravano sul main e il worker lo scopriva solo al rescan (15s) → disattivazione
  // con fino a 30s di autoprompt in ritardo. Ora il worker applica il cambio di stato
  // NELLA SUA MEMORIA subito (e scrive state.json per gli altri processi).
  "longHorizonActivate", "longHorizonDeactivate", "longHorizonResume",
  "longHorizonSetPlan", "longHorizonSetGoal", "longHorizonSetPhase",
  "longHorizonNewDiscussion", "getLongHorizonState",
]);

function stderr(msg: string) { 
  try { process.stderr.write(`[pool-router] ${msg}\n`); } catch {}
  // FIX (31 ago): log anche nel debug log (visibile dal frontend) — senza questo,
  // se il main non spawnava i worker era IMPOSSIBILE capire perché (stderr perso)
  try { (globalThis as any).__quinki_piBridge?.logDebug?.("pool-router", { msg }); } catch {}
}

export function poolIndex(): number {
  const v = parseInt(process.env.QUINKI_POOL_INDEX || "0", 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}

function hashKey(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function ownerPool(key: string): number {
  if (String(key).startsWith("__exec_")) return 0; // scheduler headless → main
  if (String(key) === "__app_expert__") return 0; // Expert session sempre sul main
  // Le sessioni delegate temporanee NON esistono nel router (nascono e muoiono
  // dentro un solo turno) → il main le gestisce
  if (String(key).startsWith("__delegate_")) return 0;
  return hashKey(String(key)) % poolN;
}

export function poolActive(): boolean { return active; }
// FIX 084 (03 set): esiste un worker vivo per questo index? Ha senso SOLO nel main
// (index 0 = il router, che possiede childSockets/childProcs). Nei worker ritorna
// false (le loro mappe router sono vuote). Usato dai driver recovery/LH del main
// per capire se possono processare una sessione il cui owner NON e' mai stato
// spawnato (spawn lazy: senza questo, i marker sul disco di sessioni senza
// traffico non venivano MAI processati → recovery e LH morti).
export function isPoolWorkerAlive(i: number): boolean {
  if (!active) return true; // pool off → nessun owner check
  if (i === 0) return true;
  return childSockets.has(i) || childProcs.has(i);
}

// Porta WS che serve gli eventi STREAMING di una sessione:
// - pool OFF: 0 → il frontend usa la connessione principale (9182)
// - pool ON, pool-0: 0 → idem (le sessioni del main streamano via main)
// - pool ON, altro gruppo: POOL_BASE_PORT + owner → il frontend si connette DIRETTAMENTE
//   al worker (così gli eventi NON passano dal router: niente crescita memoria/wedge).
export function sessionWorkerPort(key: string): number {
  if (!active) return 0;
  const owner = ownerPool(key);
  if (owner === 0) return 0;
  return POOL_BASE_PORT + owner;
}

// Dimensione del pool: SOLO env QUINKI_POOL_SIZE (dev/test). DEFAULT 1 (29 ago):
// il routing del pool uccide lo streaming alla DISCONNESSIONE del mittente (provato
// sperimentalmente: router-child-vivo, eventi ricevuti dal router, il frontend NO).
// Il percorso DIRETTO (pool=1) è provato affidabile al 100%. Il pool tornerà dopo
// il redesign del router.
function effectivePoolSize(): number {
  const envN = parseInt(process.env.QUINKI_POOL_SIZE || "", 10);
  if (Number.isFinite(envN) && envN >= 1) return envN;
  // Il sistema decide: quanti core hai, quanti worker massimi.
  // Nessun cap artificiale (l'utente ha ragione: è inutile).
  // Con lazy spawning, il numero REALE è sempre quello che serve.
  return Math.max(1, os.cpus().length);
}

export function initPoolRouter(): void {
  if (initDone) return;
  initDone = true;
  // L'Expert (QUINKI_ROLE=expert) NON attiva MAI il pool: ha 1 sola sessione
  if (String(process.env.QUINKI_ROLE || "").toLowerCase() === "expert") return;
  const n = effectivePoolSize();
  if (n <= 1) return; // pool OFF
  // FIX (31 ago): `active` e `poolN` vanno impostati su TUTTI i processi del pool,
  // non solo sul main. Senza questo, sui worker poolActive() = false → il check
  // di ownership in recoverPendingTurns era SALTATO → ogni worker cercava di
  // recuperare TUTTE le sessioni (duplicati!). Il routing resta solo sul main
  // (tryRoute/spawnChild controllano già poolIndex).
  active = true;
  poolN = n;
  if (poolIndex() !== 0) return; // routing: solo il main è router
  // NUKE rimosso (causava crash nel binary compilato) — cleanup per-worker in spawnChild
  // === NUKE DEFINITIVO (31 ago): gli orfani della sessione precedente tengono
  // le porte del pool. Il nuovo main li uccide TUTTI prima di spawnare i nuovi worker.
  // UNA sola chiamata lsof (non blocca l'event loop più di ~100ms).
  try {
    const ports = Array.from({ length: n - 1 }, (_, idx) => `tcp:${POOL_BASE_PORT + idx + 1}`).join(",");
    const out = require("child_process").execSync(`lsof -ti ${ports} 2>/dev/null || true`, { encoding: "utf8", timeout: 5000 });
    if (out && out.trim()) {
      const pids = [...new Set(out.trim().split(/\s+/).filter(Boolean))];
      for (const p of pids) { try { process.kill(parseInt(p, 10), "SIGKILL"); } catch {} }
      stderr(`nuke: killed ${pids.length} orphaned workers on pool ports`);
    }
  } catch {}
  const eager = process.env.QUINKI_POOL_EAGER !== "0"; // DEFAULT: eager (31 ago)
  // Perché eager: se i worker nascono lazy, il frontend prova a connettersi al loro
  // WS appena l'app apre → connessione RIFIUTATA (il worker non esiste) → nessun
  // retry → MAI connesso → recovery e streaming MAI visibili in tempo reale.
  // Con eager, tutti i worker partono subito (~1s) e i loro WS sono pronti.
  stderr(`pool attivo: ${n} processi max (${eager ? "eager" : "lazy"}) su :${POOL_BASE_PORT + 1}...`);
  // FIX (01 set): TUTTI i worker nascono LAZY. Zero RAM quando inattivo.
  // Quando arriva un messaggio → tryRoute spawn il worker → 2-3 secondi → messaggio processato.
  // Shrink loop: worker inattivo 5 min → morto → 0 RAM. MAI "Sending infinito"
  // perché il respawn è affidabile (port cleanup + retry + timeout 30s).
  startShrinkLoop();
  // NB: NIENTE Bun.gc(true) periodico qui — su un heap cresciuto (forwarding eventi)
  // il full GC sincrono blocca l'event loop per MINUTI → main wedged.
  // La memoria del router si controlla NON facendolo crescere: il frontend si
  // connette DIRETTAMENTE ai worker per lo streaming (v. workerPort nelle sessioni).
}

// ─── spawn / connect ───────────────────────────────────────────────

function spawnChild(i: number): void {
  if (childRetired.has(i)) childRetired.delete(i);
  if (childProcs.has(i) || childStarting.has(i)) return;
  childStarting.set(i, Date.now());
  childSockets.delete(i);
  const port = POOL_BASE_PORT + i;
  // FIX A4.3: uccidi un eventuale worker STALE (binario vecchio sopravvissuto a un
  // reinstall) che occupa già questa porta — altrimenti il nuovo worker crasha
  // (EADDRINUSE) e il loop di respawn riaccumula connessioni.
  // FIX (31 ago — LOOP INFINITO): dopo il kill, ASPETTA che la porta sia DAVVERO
  // libera (fino a 3s) prima di spawnare. Senza questo, l'orfano morente teneva
  // la porta per un momento → EADDRINUSE → crash → respawn → EADDRINUSE → il
  // main moriva per il loop infinito di respawn.
  try {
    const out = require("child_process").execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { encoding: "utf8", timeout: 3000 });
    if (out && out.trim()) {
      const pids = out.trim().split(/\s+/).filter(Boolean);
      for (const p of pids) { try { process.kill(parseInt(p, 10), "SIGKILL"); } catch {} }
      stderr(`child ${i} killed stale worker on :${port}`);
    }
  } catch {}
  const env: Record<string, string> = { ...process.env as any };
  env.QUINKI_POOL_INDEX = String(i);
  env.QUINKI_WS_PORT = String(port);
  let child: any = null;
  try {
    // FIX A4.3: NON detached — con detached:true il ppid del child è 1 da subito e
    // il watchdog (ppid !== origPpid) non scatta MAI → i worker vecchi sopravvivono
    // ai reinstall, tengono le porte e processano con codice vecchio (order=now).
    // Con ppid = main, alla morte del main il child viene ri-parentato → watchdog esce.
    child = spawn(process.execPath, [], { env, stdio: ["ignore", "inherit", "inherit"] });
    child.unref();
    childProcs.set(i, child);
    child.on("exit", (code: any, sig: any) => {
      stderr(`child ${i} (${port}) exit code=${code} sig=${sig}`);
      childProcs.delete(i);
      childSockets.delete(i);
      childStarting.delete(i);
      // Se non è stato spento intenzionalmente (retired) → rispawna con RETRY
      if (active && !childRetired.has(i)) {
        let retries = 0;
        const attemptSpawn = () => {
          if (!active || childRetired.has(i)) return;
          if (childProcs.has(i)) return; // già ripartito
          retries++;
          stderr(`child ${i} respawn attempt ${retries}`);
          spawnChild(i);
          // Se dopo 3s il child non è nei procs, RIPROVA (max 3 tentativi)
          setTimeout(() => {
            if (!childProcs.has(i) && !childStarting.has(i) && retries < 3) {
              // lo spawn è fallito — uccidi eventuali zombie sulla porta e riprova
              try {
                const out = require("child_process").execSync(`lsof -ti tcp:${port} 2>/dev/null`, { encoding: "utf8", timeout: 2000 });
                if (out && out.trim()) {
                  for (const p of out.trim().split(/\s+/)) { try { process.kill(parseInt(p,10), "SIGKILL"); } catch {} }
                  stderr(`child ${i}: killed zombie on :${port} before retry`);
                }
              } catch {}
              attemptSpawn();
            }
          }, 3000);
        };
        setTimeout(attemptSpawn, 2000);
      }
    });
  } catch (e: any) {
    stderr(`child ${i} spawn error: ${e?.message || String(e)}`);
  }
  connectChild(i, port);
}

function connectChild(i: number, port: number): void {
  const connect = () => {
    if (childRetired.has(i)) return; // spento per shrink: NON riconnettere
    // FIX A4.3: chiudi SEMPRE la vecchia connessione prima di aprirne una nuova
    // (il retry senza close accumulava decine di connessioni per worker → eventi
    // ricevuti N volte → testo duplicato).
    const old = childSockets.get(i);
    if (old) { try { old.close(); } catch {} childSockets.delete(i); }
    let ws: any = null;
    try { ws = new WebSocket(`ws://127.0.0.1:${port}`); } catch (e: any) { stderr(`ws error: ${e?.message}`); scheduleRetry(); return; }
    ws.onopen = () => {
      childSockets.set(i, ws);
      childStarting.delete(i);
      idleSince.delete(i);
      stderr(`child ${i} connected :${port}`);
      flushQueue(i);
    };
    ws.onmessage = (ev: any) => {
      const raw = String(ev.data);
      if (raw.length === 0) return;
      let m: any;
      try { m = JSON.parse(raw); } catch { return; }
      if (m && m.id != null) {
        const p = pendingRpc.get(m.id);
        if (p) { pendingRpc.delete(m.id); try { p(m); } catch {} }
      } else if (m && m.method) {
        // Inoltra gli eventi streaming alla connessione principale (fallback).
        // NB: NESSUN dedup per contenuto qui. Il dedup per firma (metodo+sessionKey+
        // messageId+delta) con finestra 300ms BUTTAVA i delta RIPETUTI legittimi
        // (un modello locale veloce emette "the the the" a <300ms → il secondo "the"
        // veniva scartato → risposta INFEDELE, testo mancante). I duplicati veri
        // (connessioni multiple al worker) sono già prevenuti da "chiudi la vecchia
        // connessione prima di connettersi" (FIX A4.3): il router ha UN socket per
        // worker → ogni evento arriva UNA volta.
        try {
          const p2 = m.params || {};
          // POOL SYNC: aggiorna l'entry in memoria del MAIN dagli eventi del worker
          // (label/order) — altrimenti il #save del main sovrascrive le modifiche
          // del worker (chat che torna a 'New chat', sidebar che si riordina).
          if (m.method === 'session_updated' || m.method === 'session_meta') {
            try { (globalThis as any).__quinki_piBridge?.updateSessionFromEvent?.(p2.sessionKey || p2.key || '', p2); } catch {}
          }
          try { const bcast = (globalThis as any).__quinki_broadcast; if (bcast) bcast({ jsonrpc: "2.0", method: m.method, params: p2 }); else process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: m.method, params: p2 }) + "\n"); } catch {}
        } catch {}
      }
    };
    ws.onclose = () => {
      childSockets.delete(i);
      if (!childRetired.has(i) && childProcs.has(i)) scheduleRetry();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };
  const scheduleRetry = () => {
    setTimeout(() => { if (active && !childRetired.has(i)) connect(); }, 1500);
  };
  connect();
}

function flushQueue(i: number): void {
  const q = queuedRoutes.get(i);
  if (!q || q.length === 0) return;
  queuedRoutes.delete(i);
  for (const msg of q) {
    try {
      if (!tryRoute(msg)) {
        // fallback: risposta di errore (non dovrebbe accadere: il child è connesso)
        try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: "worker starting timeout" }) + "\n"); } catch {}
      }
    } catch {}
  }
}

function sendToChild(sock: any, method: string, params: any, cb: (m: any) => void): void {
  const id = nextRpcId++;
  pendingRpc.set(id, cb);
  try { sock.send(JSON.stringify({ jsonrpc: "2.0", id, method, params })); } catch {}
}

// Recovery on-open per sessioni POOL (29 ago — fix streaming invisibile):
// quando l'utente apre una chat che è di proprietà di un worker, il main
// NON può recuperarla da solo (skip per ownership) e il worker non sa che
// l'utente l'ha aperta. Questa funzione dice al worker di recuperarla SUBITO
// (non aspettare il driver 30s). Il worker recupera → streama sul SUO WS →
// il frontend (connesso direttamente al worker) vede lo streaming in tempo reale.
export function recoverOnWorker(sessionKey: string): boolean {
  if (!active) return false;
  const owner = ownerPool(sessionKey);
  if (owner === 0) return false; // sessione del main → il main la gestisce
  const sock = childSockets.get(owner);
  if (!sock || sock.readyState !== 1) {
    // FIX 2026-09-08: spawn + ACCODA la RPC specifica. Prima: spawn + return false
    // (si affidava al boot scan del worker — inaffidabile). Ora: la RPC viene
    // consegnata quando il router si connette (flushQueue). Affidabile al 100%.
    if (!childStarting.has(owner) && !childProcs.has(owner) && !childRetired.has(owner)) {
      spawnChild(owner);
    }
    const q = queuedRoutes.get(owner) || [];
    q.push({ jsonrpc: "2.0", method: "recoverSession", params: { sessionKey }, id: nextRpcId++ });
    queuedRoutes.set(owner, q);
    return true;
  }
  sendToChild(sock, "recoverSession", { sessionKey }, () => {});
  return true;
}

// ─── routing ───────────────────────────────────────────────────────

export function tryRoute(msg: any): boolean {
  if (!active) return false;
  if (poolIndex() !== 0) return false; // FIX (31 ago): SOLO il main è router — sui worker active=true (per l'ownership check) MAI route/spawn
  const method = msg?.method;
  const params = msg?.params || {};
  if (!ROUTABLE.has(method)) return false;
  const sk = params.sessionKey || params.key;
  if (!sk) return false;
  const owner = ownerPool(sk);
  if (owner === 0) return false; // sessione del main → handler locale
  const sock = childSockets.get(owner);
  if (!sock || sock.readyState !== 1) {
    // child non pronto (mai partito / shrink / crash) → SPAWN LAZY + coda.
    // FIX 084 (03 set): una RPC instradata È "serve una sessione" → il respawn è
    // sempre legittimo, ANCHE per un child RETIRED (shrunk): il vecchio guard
    // `!childRetired.has(owner)` bloccava il respawn PER SEMPRE (l'intento del
    // retire era solo: non resuscitare sul crash-reconnect) → le send restavano
    // in coda all'infinito. spawnChild pulisce il retire (riga ~170).
    if (!childStarting.has(owner) && !childProcs.has(owner)) {
      spawnChild(owner);
    }
    const q = queuedRoutes.get(owner) || [];
    q.push(msg);
    queuedRoutes.set(owner, q);
    // timeout di sicurezza: se il child non parte, rispondi errore dopo CHILD_START_TIMEOUT
    setTimeout(() => {
      const qq = queuedRoutes.get(owner) || [];
      const idx = qq.indexOf(msg);
      if (idx >= 0) {
        qq.splice(idx, 1);
        if (qq.length === 0) queuedRoutes.delete(owner);
        try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: "worker starting timeout" }) + "\n"); } catch {}
      }
    }, CHILD_START_TIMEOUT).unref?.();
    return true;
  }
  const ek = `${owner}:${sk}`;
  if (!ensuredOnChild.has(ek)) {
    ensuredOnChild.add(ek);
    sendToChild(sock, "ensureSession", { sessionKey: sk }, () => {});
  }
  sendToChild(sock, method, params, (resp) => {
    try {
      try { const bcast = (globalThis as any).__quinki_broadcast; if (bcast) bcast({ jsonrpc: "2.0", id: msg.id, result: resp.result, error: resp.error }); else process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: resp.result, error: resp.error }) + "\n"); } catch {}
    } catch {}
  });
  return true;
}

// ─── shrink (spegnimento child idle) ───────────────────────────────

function startShrinkLoop(): void {
  setInterval(() => { shrinkTick(); }, STATUS_INTERVAL_MS).unref?.();
}

function shrinkTick(): void {
  if (!active) return;
  for (const i of childSockets.keys()) {
    const sock = childSockets.get(i);
    if (!sock || sock.readyState !== 1) continue;
    sendToChild(sock, "poolStatus", {}, (m) => {
      try {
        const st = m.result || {};
        const busy = (st.active > 0) || (st.streaming > 0);
        if (busy) { idleSince.delete(i); return; }
        const since = idleSince.get(i) ?? Date.now();
        idleSince.set(i, since);
        if (Date.now() - since >= IDLE_KILL_MS) {
          stderr(`child ${i} idle da 10min → shrink (sessioni al sicuro su disco)`);
          killChild(i);
        }
      } catch {}
    });
  }
}

function killChild(i: number): void {
  childRetired.add(i);
  idleSince.delete(i);
  const sock = childSockets.get(i);
  try { sock?.close(); } catch {}
  childSockets.delete(i);
  const proc = childProcs.get(i);
  childProcs.delete(i);
  if (proc) {
    try { proc.kill("SIGTERM"); } catch {}
    // kill di sicurezza dopo 3s
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000).unref?.();
  }
  stderr(`child ${i} killed (shrink)`);
}
