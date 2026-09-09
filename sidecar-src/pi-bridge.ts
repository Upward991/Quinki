import * as path from "node:path";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { Type } from "typebox";
import { defineTool, formatSkillsForPrompt } from "./vendor/@earendil-works/pi-coding-agent/dist/index.js";
import {
  readMcpServers,
  StdioMcpClient,
  httpListTools,
  httpCallTool,
  mcpResultToText,
  mcpSchemaToTypeBox,
  mcpInstallDir,
  resolveCommandLaunch,
  findBunPath,
} from "./mcp";
import { getFirstAvailableModelId, readModelsFromDisk } from "./models";
import { readProvidersConfig, restoreProvidersFromBackup } from "./providers";
import { decryptString } from "./crypto";
import { sessionWorkerPort, poolActive, ownerPool, poolIndex, recoverOnWorker, isPoolWorkerAlive } from "./pool-router";
import {
  readProvidersConfig,
  writeProvidersConfig,
  fetchProviderModels,
  testProviderConnection,
  syncModelsJson,
  probeProviderCapabilities,
  probeSingleModelCaps,
  refreshThinkingCapsEvolution,
  syncSettingsJson,
  getDefaultModel as getProviderDefaultModel,
  getDefaultThinking as getProviderDefaultThinking,
  getSafeProvidersConfig,
  type ProvidersConfig,
  type SafeProvidersConfig,
  type FetchedModel,
} from "./providers";

// Use agentDir from env, fall back to default
const _agentDir = process.env.QUINKI_AGENT_DIR || path.join(homedir(), ".pi", "agent");
// marker di attribuzione per il debug log condiviso (chi scrive: main/expert/pool-N)
const _logSource = (() => {
  try {
    const role = process.env.QUINKI_ROLE || "main";
    const poolI = parseInt(process.env.QUINKI_POOL_INDEX || "0", 10);
    return poolI > 0 ? role + "-pool" + poolI : role;
  } catch { return "?"; }
})();
const SESSION_FILE = path.join(_agentDir, "quinki-sessions.json");
const FOLDERS_FILE = path.join(_agentDir, "quinki-folders.json");
const SETTINGS_FILE = path.join(_agentDir, "quinki-settings.json");
const CONTEXT_USAGE_FILE = path.join(_agentDir, "quinki-context-usage.json");
const ERRORS_FILE = path.join(_agentDir, "quinki-errors.json");
const DEBUG_LOG_FILE = path.join(_agentDir, "quinki-debug.log");
const DEBUG_LOG_MAX = 200;
const SESSION_BASE = path.join(_agentDir, "sessions", "quinki");

// === ROLE + OWNER.LOCK (niente porte hardcoded: il ruolo è esplicito via QUINKI_ROLE) ===
// - start.sh         → QUINKI_ROLE=main
// - start-expert.sh  → QUINKI_ROLE=expert
// Ogni sidecar scrive ~/.quinki/.sidecar-<role>.pid col proprio PID.
// L'owner-check usa quel PID (processo vivo), NON la porta (che può cambiare).
function sidecarRole(): "expert" | "main" {
  const r = (process.env.QUINKI_ROLE || "").toLowerCase();
  if (r === "expert" || r === "main") return r;
  // FIX B4: il fallback era isExpertSidecar() → ricorsione infinita se QUINKI_ROLE
  // manca (sidecarRole → isExpertSidecar → sidecarRole ...). Default sicuro: main.
  return "main";
}
export function isExpertSidecar(): boolean { return sidecarRole() === "expert"; }

// === APP PROCESS CHECK ( fonte di verità ASSOLUTA sul possesso di __app_expert__ ) ===
// isExpertAlive() guarda il SIDECAR: durante il riavvio dell'app Expert (sync,
// update, watchdog) il sidecar è giù ~15-20s — e la Main con la sola grace di 5s
// dichiarava l'expert morto e RIPRENDEVA i turni da sola (furto di sessione provato
// in produzione). La regola dell'utente è assoluta: se il PROCESSO App Expert.app
// è vivo, la Main NON tocca la sessione — nemmeno leggerla, nemmeno i recovery.
// Il processo app è l'unico polo stabile: vive prima, durante e dopo i restart
// del sidecar, e muore solo quando l'utente chiude davvero l'app.
let _expertAppRunningCache = { at: 0, v: false };
export function isExpertAppProcessRunning(): boolean {
  const now = Date.now();
  if (now - _expertAppRunningCache.at < 2000) return _expertAppRunningCache.v;
  try {
    // match SOLO l'eseguibile dell'app: il sidecar sta in Resources/ (no /MacOS/),
    // il watchdog è uno shell script. /MacOS/ matcha SOLO il processo app.
    const out = Bun.spawnSync(["pgrep", "-f", "/Applications/App Expert.app/Contents/MacOS/"]);
    _expertAppRunningCache = { at: now, v: out.exitCode === 0 };
  } catch { _expertAppRunningCache = { at: now, v: _expertAppRunningCache.v }; }
  return _expertAppRunningCache.v;
}

// === POOL (B4): il main può girare come N processi, ognuno con un sottoinsieme
// di sessioni. Env: QUINKI_POOL_SIZE=N (default 1 = nessun pool), QUINKI_POOL_INDEX=i.
// - Le sessioni headless __exec_* (scheduler) stanno SOLO nel pool 0 (main).
// - Il filtro è DETERMINISTICO: hash(sessionKey) % N === index.
function poolSize(): number {
  const v = parseInt(process.env.QUINKI_POOL_SIZE || "", 10);
  return Number.isFinite(v) && v > 1 ? v : 1;
}
function poolIndex(): number {
  const v = parseInt(process.env.QUINKI_POOL_INDEX || "0", 10);
  return Number.isFinite(v) && v >= 0 ? v : 0;
}
function hashSessionKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h;
}
export function isMyPoolSession(key: string): boolean {
  const n = poolSize();
  if (n <= 1) return true;
  const k = String(key || "");
  if (k.startsWith("__exec_")) return poolIndex() === 0;
  return hashSessionKey(k) % n === poolIndex();
}
export function writeSidecarLock() {
  const role = sidecarRole();
  // B4: i CHILD del pool hanno lock dedicato (non sovrascrivono il main)
  const poolN = parseInt(process.env.QUINKI_POOL_SIZE || "", 10);
  const poolI = parseInt(process.env.QUINKI_POOL_INDEX || "0", 10);
  const lockName = Number.isFinite(poolN) && poolN > 1 && poolI > 0
    ? `.sidecar-${role}-pool-${poolI}.pid`
    : `.sidecar-${role}.pid`;
  const lockPath = path.join(_agentDir, lockName);
  try { fs.writeFileSync(lockPath, String(process.pid)); } catch {}
}
// L'Expert è vivo se il suo file PID esiste e il processo esiste (owner.lock).
// Fallback per l'Expert VECCHIA (senza lock): porta 9183 — il fallback sparisce
// quando l'Expert viene syncrata (nuovo binario con QUINKI_ROLE + lock PID).
// === FORCE GC: i slab bmalloc/IOAccelerator di JSC non vengono MAI restituiti
// all'OS da bun (issue #28318: JSC__VM__shrinkFootprint mai chiamato). Bun.gc(true)
// (full GC sincrono) RILASCIA la memoria all'OS. Chiamarlo dopo la deattivazione
// di una sessione (LRU) e dopo la fine di un turno → il footprint torna giu'.
export function forceGC() {
  try {
    const BunAny = (globalThis as any).Bun;
    if (BunAny && typeof BunAny.gc === "function") {
      // async: il full GC sincrono blocca; posticipiamo di un tick
      setTimeout(() => { try { BunAny.gc(true); } catch {} }, 0);
    }
  } catch {}
}

export function isExpertAlive(): boolean {
  // FIX (29 ago): prima, un PID file con PID morto → EARLY RETURN FALSE senza provare
  // i fallback → durante ogni finestra di restart del sidecar expert (watchdog ~2-3s)
  // la main credeva l'expert morto e ADETTAVA __app_expert__ (turno rubato: lo streaming
  // andava alla main, invisibile nell'app Expert). Ora: PID → lsof → TCP probe, mai
  // decidere "morto" su una sola lettura.
  const lockPath = path.join(_agentDir, ".sidecar-expert.pid");
  try {
    if (fs.existsSync(lockPath)) {
      const pid = parseInt(fs.readFileSync(lockPath, "utf8").trim(), 10);
      if (pid && pid > 0) {
        try { process.kill(pid, 0); return true; } catch { /* PID morto → CONTINUA ai fallback */ }
      }
    }
  } catch {}
  try {
    const out = require("child_process").spawnSync("lsof", ["-ti:9183"], { encoding: "utf8", timeout: 3000 });
    if ((out.stdout || "").trim().length > 0) return true;
  } catch {}
  // TCP probe diretto (senza lsof): se qualcosa accetta connessioni su 9183, è vivo
  try {
    const { spawnSync: _sp } = require("child_process");
    const probe = _sp("bash", ["-c", "exec 3<>/dev/tcp/127.0.0.1/9183 && exec 3>&-"], { timeout: 2000 });
    if (probe.status === 0) return true;
  } catch {}
  return false;
}

// Grace double-check (29 ago): prima di adottare __app_expert__, la main deve
// confermare l'expert MORTO per un intero grace. Il watchdog riavvia il sidecar
// in ~2-3s: una lettura falsa durante la finestra di restart NON ruba più il turno.
export async function isExpertConfirmedDead(graceMs = 5000): Promise<boolean> {
  // IL PROCESSO APP è la fonte di verità: se App Expert.app è aperta, lo sidecar
  // può essere giù quanto vuole (sync/update/watchdog) — l'app è VIVA e la
  // sessione NON è adottabile. Senza questo check, il restart dell'app Expert
  // (~15-20s senza sidecar) superava la grace di 5s e la Main rubava il turno.
  if (isExpertAppProcessRunning()) return false;
  if (isExpertAlive()) return false;
  await new Promise((r) => setTimeout(r, graceMs));
  return !isExpertAlive() && !isExpertAppProcessRunning();
}

// ID stabile per i messaggi senza id: timestamp + hash del contenuto (NON random → niente re-render)
function contentFingerprint(c: any): string {
  // O(1): lunghezza + prefisso + suffisso — MAI stringificare il contenuto intero
  // (i messaggi possono essere da 1.3MB: JSON.stringify completo = picco RAM/Gigacage)
  if (typeof c === "string") {
    return c.length + "|" + c.slice(0, 200) + "|" + c.slice(-200);
  }
  if (Array.isArray(c)) {
    const parts: string[] = [];
    for (const b of c) {
      if (!b || typeof b !== "object") { parts.push("?"); continue; }
      if (b.type === "text" && typeof b.text === "string") parts.push("t" + b.text.length + ":" + b.text.slice(0, 100) + ":" + b.text.slice(-100));
      else if (b.type === "thinking" && typeof b.thinking === "string") parts.push("h" + b.thinking.length + ":" + b.thinking.slice(0, 100) + ":" + b.thinking.slice(-100));
      else if (b.type === "toolCall") parts.push("c" + (b.name || "") + ":" + (b.id || ""));
      else parts.push(String(b.type || "?"));
    }
    return parts.join("|");
  }
  if (c && typeof c === "object") {
    const s = JSON.stringify(c);
    return s.length + "|" + s.slice(0, 200) + "|" + s.slice(-200);
  }
  return "";
}

function stableMsgId(m: any): string {
  const ts = typeof m.timestamp === "number" ? m.timestamp : (m.timestamp ? new Date(m.timestamp).getTime() : 0);
  let h = 0;
  const str = JSON.stringify([m.role, m.parentId, m.toolName, m.toolCallId, m.message?.role]) + "|" + contentFingerprint(m.content);
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
  return "m-" + ts + "-" + Math.abs(h).toString(36).slice(0, 8);
}

interface SessionEntry {
  key: string;
  label: string;
  createdAt: number;
  model?: string;
  thinkingLevel?: string;
  mode?: string;
  agentId?: string;
  lastActivity?: number;
  order?: number;
  compactionAuto?: boolean;
  compactionThreshold?: number;
  fallbackModels?: string[];
  workingDir?: string;
  messageSkills?: Record<string, { agentId: string; skillName: string; agentName?: string }[]>;
  messageTaskClips?: Record<string, { id: string; label: string; text: string }[]>;
  messageAttachments?: Record<string, { originalName: string; path: string; uuid: string; size?: number }[]>;
}

type ProbeResult = { levels: string[]; map: Record<string, string>; ollamaLevels: string[] };
type ModelInfo = { contextLength: number; capabilities: string[] };

// === Fix 2/B2: helper esportato per testabilità ===
export interface PreflightStats {
  messagesCount: number;
  totalChars: number;
  textLen: number;
  filesCount: number;
  filesChars: number;
  estimatedTotalTokens: number;
  contextWindow: number;
  pct: number | null;
}

export function computePreflightStats(
  messages: any[],
  text: string,
  files: { data?: string }[] | undefined,
  contextWindow: number
): PreflightStats {
  const totalChars = (messages || []).reduce((acc: number, m: any) => {
    if (typeof m.content === "string") return acc + m.content.length;
    if (Array.isArray(m.content)) {
      return acc + m.content.reduce((a: number, b: any) => a + (b?.text?.length || 0), 0);
    }
    return acc;
  }, 0);
  const textLen = (text || "").length;
  const filesCount = (files || []).length;
  const filesChars = (files || []).reduce((a: number, f: any) => a + (f?.data?.length || 0), 0);
  const estimatedTotalTokens = Math.ceil((totalChars + textLen + filesChars) / 4);
  const pct = contextWindow > 0 ? Math.ceil((estimatedTotalTokens / contextWindow) * 100) : null;
  return {
    messagesCount: (messages || []).length,
    totalChars,
    textLen,
    filesCount,
    filesChars,
    estimatedTotalTokens,
    contextWindow,
    pct,
  };
}


// Rank universale dei thinking levels (04 set): i nomi NOTI hanno il loro ordine,
// gli SCONOSCIUTI (nuovi di un provider, es. "mega") rankano sopra OGNI noto.
const THINK_PROBE_ORDER_PI = ["none", "false", "true", "minimal", "low", "medium", "high", "max", "xhigh"];
function rankLevelVal(v: any): number {
  if (typeof v === "boolean") return v ? 2 : 0;
  const i = THINK_PROBE_ORDER_PI.indexOf(String(v));
  return i === -1 ? 99 : i;
}

class PiBridge {
  // screenshot: round-trip tool → frontend invoke → risposta (requestId correlato)
  #screenshotPending = new Map<string, (r: { path?: string; error?: string }) => void>();
  #sdk: any = null;
  #entries = new Map<string, SessionEntry>();
  #firstUserText = new Map<string, string>(); // primo msg utente per auto-title
  #active = new Map<string, any>();
  #lhPhase = new Map<string, string>();
  #bashReadonlySessions = new Set<string>();
  // === A2.11B: Permessi persistenti ===
  #permissions: any = null;
  #authorizedFolders: string[] | null = null;
  #stoppedSessions = new Set<string>();
  #recoveringTurns = new Set<string>();
  // Anti-ricorsione per il recovery on-open: getHistory → recoverPendingTurns →
  // getHistory (check no-marker) → ... senza questo Set è stack overflow →
  // getHistory crasha e la chat non carica i messaggi.
  #onOpenRecoveryTriggered = new Set<string>();
  #rePrompted = new Set<string>();
  #fallbackTried = new Map<string, string[]>();
  // FIX fallback totale: modello ORIGINALE della sessione (no-drift: si ripristina a fine turno)
  #fallbackOriginalModel = new Map<string, string>();
  #markerTurnStarted = new Set<string>();
  #mcpClients = new Map<string, StdioMcpClient>();  // chiave `${sessionKey}:${serverId}`
  #mcpToolNames = new Map<string, { name: string; serverId: string }[]>();  // per sessione: tool MCP per applyMode (plan/build)
  #mcpSig = new Map<string, string>();  // firma mcpServers con cui è stata costruita la sessione (auto-diff)
  #wss = new Map<string, any>();
  #unsubs = new Map<string, () => void>();
  #prompts = new Map<string, Promise<void>>();
  #pendingModels = new Map<string, string>();
  #thinkingMapsCache: { mtime: number; maps: Record<string, any> } | null = null;
  #thinkingCapsCache: { mtime: number; caps: Record<string, any> } | null = null;
  #pendingThinking = new Map<string, string>();
  #pendingMode = new Map<string, string>();
  #cwdOverride = new Map<string, string>();
  #pendingDelegationSkills = new Map<string, { agentId: string; skillName: string }[]>();
  #pendingDelegationAttachments = new Map<string, { originalName: string; path: string; uuid: string; size?: number }[]>();  // override cwd per cambio dir mid-sessione
  #scheduleHandler: ((params: any) => any) | null = null;  // A2.2: callback verso il Scheduler (settato da sidecar.ts)
  #scheduleCancelHandler: ((params: any) => any) | null = null;  // P2 #10: callback per cancellare una schedule
  #logBroadcast: ((entry: any) => void) | null = null;  // log live: notifica WS per ogni nuova entry (niente polling)

  setLogBroadcast(fn: (entry: any) => void) {
    this.#logBroadcast = fn;
  }
  // === Multi-window streaming buffer: traccia il messaggio in streaming per sessione ===
  // Permette alle nuove finestre di recuperare il contenuto parziale quando aprono durante la generazione
  #streamingBuffers = new Map<string, { text: string; thinking: string; toolCalls: any[]; currentPhase: string | null; messageId: string | null; model: string | null; provider: string | null; stopReason: string | null; thinkingLevel: string | null; }>();
  #lastEffectiveCwd = new Map<string, string>();  // ultimo effectiveCwd per sessione (per delega)
  #skillsMtime = new Map<string, number>();  // mtime .pi/skills/ al session-create (auto-reload skill, history preservata)
  // === A3: Notifiche — read-state per chat + log notifiche ===
  #readState = new Map<string, { lastReadTs: number; lastReadTaskTs: number; notifyMode: string; notifyModeTs: number }>();
  #notifications: any[] = [];
  #notifBroadcast: ((entry: any) => void) | null = null;
  #readStateBroadcast: ((key: string) => void) | null = null;
  // === Fix 3/B5: pending compaction auto per sessioni non ancora attivate ===
  #pendingCompactionAuto = new Map<string, boolean>();
  // === Anti-loop: firstKeptEntryId dell'ultima compaction per sessione ===
  #prevCompactionFirstKept = new Map<string, string>();
  #compactingSessions = new Set<string>();
  #contextUsage = new Map<string, { tokens: number | null; contextWindow: number; percent: number | null; model?: string; ts: number }>();
  #responseTimers = new Map<string, number>();
  #modelRegistry: any = null;
  #modelContextCache = new Map<string, { contextWindow: number; source: string; ts: number }>();
  #agentDir: string;
  #cwd: string;
  #debugLog: { ts: number; tag: string; data: any }[] = [];
  #debugMax = DEBUG_LOG_MAX;
  #debugLogBuffer: string[] = [];
  #debugFlushTimer: ReturnType<typeof setInterval> | null = null;
  #ollamaBaseUrl: string = "http://localhost:11434";
  #ollamaModelInfoCache = new Map<string, ModelInfo>();
  #ollamaProbeResults = new Map<string, ProbeResult>();

  constructor(opts: { agentDir: string; cwd: string }) {
    this.#agentDir = opts.agentDir;
    this.#cwd = opts.cwd;
  }

  async init() {
    // === Fase A: Pi SDK embedded in src/main/vendor/ ===
    try {
      this.#sdk = await import("./vendor/@earendil-works/pi-coding-agent/dist/index.js");
    } catch (e: any) {
      this.logDebug("pi-sdk-import-error", { error: e?.message || String(e), stack: e?.stack?.split('\n').slice(0, 5) });
      throw e;
    }
    this.#load();
    this.#loadReadState();
    this.#loadOllamaBaseUrl();
    // B0.1 (S9): monitoring heap — log periodico ogni 60s
    this.#startHeapStatsLog();
    // === Inizializza ModelRegistry di Pi SDK: stessa fonte di model.contextWindow usata dalle chat attive ===
    try {
      const authPath = path.join(this.#agentDir, "auth.json");
      const modelsPath = path.join(this.#agentDir, "models.json");
      this.#modelRegistry = await this.#createRegistry();
      this.logDebug("model-registry-initialized", { authPath, modelsPath });
      try { const restored = restoreProvidersFromBackup(); if (restored > 0) this.logDebug("providers-restored-from-backup", { restored }); } catch (e: any) { this.logDebug("providers-restore-error", { error: e?.message }); }
    } catch (e: any) {
      this.logDebug("model-registry-init-error", { error: e?.message || String(e) });
    }
    await this.#loadOllamaModelInfo();
    try {
      await this.#probeAllOllamaModels();
    } catch (e) {
      this.logDebug("ollama-probe-all-error", { error: String(e) });
    }
    // === Sync context lengths da tutti i provider enabled (Ollama, OpenRouter, custom) ===
    // Best-effort: se fallisce, models.json mantiene i valori esistenti.
    try {
      await this.#syncAllContextLengths();
    } catch (e) {
      this.logDebug("sync-all-init-error", { error: String(e) });
    }
  }

  #loadOllamaBaseUrl() {
    try {
      const modelsPath = path.join(_agentDir, "models.json");
      if (fs.existsSync(modelsPath)) {
        const data = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
        // Find Ollama by base URL (works after rename)
        let url: string | undefined;
        for (const [pname, pinfo] of Object.entries(data.providers || {})) {
          const p = pinfo as any;
          if (pname.toLowerCase() === 'ollama' || (p.baseUrl || '').includes('11434')) {
            url = p.baseUrl;
            break;
          }
        }
        if (typeof url === "string" && url.length > 0) {
          this.#ollamaBaseUrl = url.replace(/\/v1\/?$/, "");
          this.logDebug("ollama-baseurl-loaded", { url: this.#ollamaBaseUrl });
        }
      }
    } catch (e) {
      this.logDebug("ollama-baseurl-error", { error: String(e) });
    }
  }

  async #loadOllamaModelInfo() {
    try {
      const res = await fetch(`${this.#ollamaBaseUrl}/api/tags`);
      if (!res.ok) {
        this.logDebug("ollama-info-fetch-failed", { status: res.status });
        return;
      }
      const data = (await res.json()) as { models: Array<{ name: string; details?: { context_length?: number }; capabilities?: string[] }> };
      for (const m of data.models || []) {
        this.#ollamaModelInfoCache.set(m.name, {
          contextLength: m.details?.context_length || 0,
          capabilities: m.capabilities || [],
        });
      }
      this.logDebug("ollama-info-loaded", {
        count: this.#ollamaModelInfoCache.size,
        models: Array.from(this.#ollamaModelInfoCache.entries()).map(([k, v]) => ({ name: k, context: v.contextLength, hasThinking: v.capabilities.includes("thinking") })),
      });
      for (const [name, info] of this.#ollamaModelInfoCache) {
        if (info.contextLength === 0) {
          await this.#fetchContextFromShow(name, info);
        }
      }
    } catch (e) {
      this.logDebug("ollama-info-error", { error: String(e) });
    }
  }

  async #fetchContextFromShow(name: string, info: ModelInfo) {
    try {
      const res = await fetch(`${this.#ollamaBaseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, verbose: true }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { model_info?: Record<string, number> };
      for (const [k, v] of Object.entries(data.model_info || {})) {
        if (k.endsWith(".context_length") && typeof v === "number" && v > 0) {
          info.contextLength = v;
          this.logDebug("ollama-info-show-fallback", { name, contextLength: v });
          break;
        }
      }
    } catch (e) {
      this.logDebug("ollama-info-show-error", { name, error: String(e) });
    }
  }

  async #probeAllOllamaModels() {
    const thinkingModels: string[] = [];
    for (const [name, info] of this.#ollamaModelInfoCache) {
      if (info.capabilities.includes("thinking")) {
        thinkingModels.push(name);
      }
    }
    this.logDebug("ollama-probe-start", { models: thinkingModels, note: "trusting capabilities=thinking => off/low/medium/high/max accepted" });
    const ollamaToPi: Record<string, string> = { "false": "off", low: "low", medium: "medium", high: "high", max: "xhigh" };
    const testLevels = ["false", "low", "medium", "high", "max"];
    for (const modelId of thinkingModels) {
      const map: Record<string, string> = {};
      for (const o of testLevels) {
        const pi = ollamaToPi[o];
        if (pi) map[pi] = o;
      }
      const out: ProbeResult = { levels: Object.keys(map), map, ollamaLevels: [...testLevels] };
      this.#ollamaProbeResults.set(modelId, out);
      this.logDebug("ollama-probe-done", { modelId, accepted: testLevels, levels: Object.keys(map), map, source: "trust-capability" });
    }
  }

  async #probeModelLevels(modelId: string): Promise<ProbeResult> {
    const existing = this.#ollamaProbeResults.get(modelId);
    if (existing) return existing;
    const testLevels = ["low", "medium", "high", "max"];
    const ollamaToPi: Record<string, string> = { low: "low", medium: "medium", high: "high", max: "xhigh" };
    const accepted: string[] = [];
    const isLocal = !modelId.includes(":cloud");
    const baseTimeout = isLocal ? 30000 : 60000;
    const retryTimeout = isLocal ? 60000 : 120000;
    for (const level of testLevels) {
      let success = false;
      for (const timeout of [baseTimeout, retryTimeout]) {
        if (success) break;
        try {
          const res = await fetch(`${this.#ollamaBaseUrl}/api/generate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: modelId, prompt: ".", think: level, stream: false }),
            signal: AbortSignal.timeout(timeout),
          });
          if (res.ok) {
            const text = await res.text();
            if (!text.includes('"error"')) {
              accepted.push(level);
              success = true;
            } else {
              success = true;
            }
          } else {
            success = true;
          }
        } catch (e) {
          this.logDebug("ollama-probe-level-error", { modelId, level, timeout, error: String(e) });
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
    const map: Record<string, string> = {};
    for (const o of accepted) {
      const pi = ollamaToPi[o];
      if (pi) map[pi] = o;
    }
    const levels = Object.keys(map);
    const out: ProbeResult = { levels, map, ollamaLevels: accepted };
    this.#ollamaProbeResults.set(modelId, out);
    this.logDebug("ollama-probe-done", { modelId, accepted, levels, map, source: "verified" });
    return out;
  }

  // === Re-merge: re-reads the file and merges agentId/model/mode into #entries ===
  // Usato 3s dopo l'avvio per pickare il flush finale del vecchio sidecar
  reloadAndMerge() {
    try {
      if (!fs.existsSync(SESSION_FILE)) return;
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      let merged = 0;
      for (const s of data) {
        const existing = this.#entries.get(s.key);
        if (existing) {
          // Merge: if file has agentId/model that we don't, take it
          if (s.agentId && !(existing as any).agentId) {
            (existing as any).agentId = s.agentId;
            merged++;
          }
          if (s.model && !existing.model) {
            existing.model = s.model;
            merged++;
          }
          if (s.mode && !(existing as any).mode) {
            (existing as any).mode = s.mode;
          }
          if (s.agentOverrides && !(existing as any).agentOverrides) {
            (existing as any).agentOverrides = s.agentOverrides;
            merged++;
          }
          // Merge folderId and order from the file (not in session files, only in quinki-sessions.json)
          if (s.folderId !== undefined) (existing as any).folderId = s.folderId;
          if (typeof s.order === 'number') (existing as any).order = s.order;
          // Restore workingDir from disk to cwdOverride
          if (s.workingDir) {
            this.#cwdOverride.set(s.key, s.workingDir);
            (existing as any).workingDir = s.workingDir;
          }
          // Restore message skills and attachments (always, not just when workingDir exists)
          if (s.messageSkills) (existing as any).messageSkills = s.messageSkills;
          if (s.messageTaskClips) (existing as any).messageTaskClips = s.messageTaskClips;
          if (s.messageAttachments) (existing as any).messageAttachments = s.messageAttachments;
        }
      }
      if (merged > 0) {
        this.logDebug("reload-merge", { merged });
        this.#save(); // persist the merged data
      }
    } catch {}
  }

  // === Flush all data to disk (called on SIGTERM) ===
  flushAll() {
    this.#save();
    this.#saveContextUsage();
    this.logDebug("flush-all", { entries: this.#entries.size });
  }

  #save() {
    try {
      // DIAG POOL ORDER: logga se l'ordine della sessione Financial cambia rispetto al file
      try {
        const role = String(process.env.QUINKI_POOL_INDEX || "0");
        const fin = this.#entries.get("pi-1786919547834-v3ya32");
        if (fin) {
          let fileOrder: any = null;
          try { const fd = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); const ff = fd.find((x: any) => x.key === "pi-1786919547834-v3ya32"); if (ff) fileOrder = ff.order; } catch {}
          if (fileOrder !== null && fin.order !== fileOrder) {
            this.logDebug("order-write", { poolIndex: role, memOrder: fin.order, fileOrder, lastActivity: fin.lastActivity });
          }
        }
      } catch {}
      let data: SessionEntry[] = [];
      for (const [k, v] of this.#entries) {
        data.push({
          key: k,
          label: v.label,
          createdAt: v.createdAt,
          lastActivity: v.lastActivity,
          order: v.order,
          folderId: (v as any).folderId ?? null,
          compactionAuto: (v as any).compactionAuto,
          compactionThreshold: (v as any).compactionThreshold,
          model: v.model,
          thinkingLevel: v.thinkingLevel,
          mode: (v as any).mode,
          agentId: (v as any).agentId,
          agentOverrides: (v as any).agentOverrides,
          messageAgents: (v as any).messageAgents,
          messageThinking: (v as any).messageThinking,
          workingDir: (v as any).workingDir,
          messageSkills: (v as any).messageSkills,
          fallbackModels: ((v as any).fallbackModels || []).filter(Boolean),
          messageTaskClips: (v as any).messageTaskClips,
          messageAttachments: (v as any).messageAttachments,
        });
        // Backup per-sessione COMPLETO (chat-meta.json): agenti, directory, override
        // per-agente (model/thinking), mode, message settings → si ripristinano SEMPRE al boot.
        this.#writeChatMeta(k, {
          agentIds: (v as any).agentId || undefined,
          workingDir: (v as any).workingDir || undefined,
          agentOverrides: (v as any).agentOverrides,
          model: v.model,
          thinkingLevel: v.thinkingLevel,
          mode: (v as any).mode,
          messageAgents: (v as any).messageAgents,
          messageThinking: (v as any).messageThinking,
          messageSkills: (v as any).messageSkills,
          messageTaskClips: (v as any).messageTaskClips,
          messageAttachments: (v as any).messageAttachments,
          compactionAuto: (v as any).compactionAuto,
          compactionThreshold: (v as any).compactionThreshold,
          folderId: (v as any).folderId ?? null,
        });
      }
      // === MERGE (due sidecar main/Expert condividono lo stesso file) ===
      // Prima #save sovrascriveva TUTTO → una app cancellava le sessioni (e agenti/
      // workingDir) dell'altra ad ogni salvataggio. Ora uniamo le entry del disco
      // che non conosciamo in memoria (es. create dall'altra app).
      try {
        // TOMBSTONE: mai ri-aggiungere o riscrivere sessioni eliminate
        data = data.filter((d: any) => !(d && d.key && isSessionDeleted(d.key)));
        if (fs.existsSync(SESSION_FILE)) {
          const disk = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
          const known = new Set(data.map((d: any) => d.key));
          for (const d of Array.isArray(disk) ? disk : []) {
            if (d && d.key && !known.has(d.key) && !isSessionDeleted(d.key)) {
              data.push(d);
              known.add(d.key);
            }
          }
        }
      } catch {}
      // === RECOVERY: non distruggere MAI i dati di sessione se l'entry in memoria li ha persi ===
      try {
        const diskMap = new Map<string, any>();
        if (fs.existsSync(SESSION_FILE)) {
          const disk = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
          for (const d of Array.isArray(disk) ? disk : []) if (d && d.key) diskMap.set(d.key, d);
        }
        const FIELD_MAP: [string, string][] = [
          ["agentId", "agentIds"], ["workingDir", "workingDir"], ["model", "model"], ["thinkingLevel", "thinkingLevel"],
          ["mode", "mode"], ["agentOverrides", "agentOverrides"], ["messageAgents", "messageAgents"], ["messageThinking", "messageThinking"],
          ["messageSkills", "messageSkills"], ["messageTaskClips", "messageTaskClips"], ["messageAttachments", "messageAttachments"], ["compactionAuto", "compactionAuto"], ["compactionThreshold", "compactionThreshold"], ["folderId", "folderId"],
        ];
        for (const d of data) {
          // Backup per-sessione COMPLETO (l'Expert NON lo tocca): fonte di recovery se file/chat-meta vengono svuotati
          try {
            const bdir = this.#piSessionDir(d.key);
            fs.mkdirSync(bdir, { recursive: true });
            const bk: any = { ts: Date.now() };
            for (const [f, m] of FIELD_MAP) if ((d as any)[f] !== undefined && (d as any)[f] !== null) bk[m] = (d as any)[f];
            fs.writeFileSync(path.join(bdir, "session-backup.json"), JSON.stringify(bk), "utf8");
          } catch {}
          const diskE = diskMap.get(d.key);
          let meta: any = null;
          try {
            const metaP = path.join(this.#piSessionDir(d.key), "chat-meta.json");
            if (fs.existsSync(metaP)) meta = JSON.parse(fs.readFileSync(metaP, "utf8"));
          } catch {}
          let backup: any = null;
          try {
            const bp = path.join(this.#piSessionDir(d.key), "session-backup.json");
            if (fs.existsSync(bp)) backup = JSON.parse(fs.readFileSync(bp, "utf8"));
          } catch {}
          for (const [f, m] of FIELD_MAP) {
            if ((d as any)[f] === undefined || (d as any)[f] === null) {
              if (diskE && (diskE as any)[f] !== undefined && (diskE as any)[f] !== null) (d as any)[f] = (diskE as any)[f];
              else if (meta && (meta as any)[m] !== undefined && (meta as any)[m] !== null) (d as any)[f] = (meta as any)[m];
              else if (backup && (backup as any)[m] !== undefined && (backup as any)[m] !== null) (d as any)[f] = (backup as any)[m];
            }
          }
          // agentId: un sidecar stantio NON deve ridurre la lista agenti già salvata nel backup
          try {
            if (d && (backup as any)?.agentIds) {
              const cur = new Set(String((d as any).agentId || '').split(',').filter(Boolean));
              const bk = new Set(String((backup as any).agentIds).split(',').filter(Boolean));
              if (bk.size > cur.size) (d as any).agentId = Array.from(bk).join(',');
            }
          } catch {}
        }
      } catch {}
      // riscrive anche il file senza le sessioni tombstoned (pulizia progressiva)
      const cleanedDisk: any[] = [];
      try {
        if (fs.existsSync(SESSION_FILE)) {
          const disk = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
          for (const d of Array.isArray(disk) ? disk : []) {
            if (d && d.key && !isSessionDeleted(d.key)) cleanedDisk.push(d);
          }
          if (cleanedDisk.length !== (Array.isArray(disk) ? disk.length : -1)) {
            fs.writeFileSync(SESSION_FILE, JSON.stringify(cleanedDisk, null, 2), "utf8");
          }
        }
      } catch {}
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch (e: any) {
      this.logDebug("save-error", { error: e?.message || String(e), entriesCount: this.#entries.size });
      process.stderr.write(`[pi-bridge] #save() ERROR: ${e?.message || String(e)}\n`);
    }
  }

  #load() {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        // === RUOLO: l'Expert (QUINKI_ROLE=expert) carica SOLO __app_expert__ ===
        const expertLoad = isExpertSidecar();
        for (const s of data) {
          if (expertLoad && s.key !== "__app_expert__") continue;
          // B4 pool: questo processo esegue SOLO le sessioni del suo gruppo
          if (!isMyPoolSession(s.key)) continue;
          const dir = this.#piSessionDir(s.key);
          if (!fs.existsSync(dir)) continue;
          // === Fix 1/B4: ripristina lastActivity, order, compactionAuto/Threshold ===
          // Se mancanti, usa Date.now() così le sessioni vanno in alto (nuove in alto)
          const fallbackOrder = Date.now();
          this.#entries.set(s.key, {
            key: s.key,
            label: s.label || "Chat",
            createdAt: s.createdAt || Date.now(),
            lastActivity: typeof s.lastActivity === "number" ? s.lastActivity : fallbackOrder,
            order: typeof s.order === "number" ? s.order : fallbackOrder,
            compactionAuto: s.compactionAuto,
            compactionThreshold: s.compactionThreshold,
            model: s.model,
            thinkingLevel: s.thinkingLevel,
            mode: s.mode,
            agentId: s.agentId,
            agentOverrides: s.agentOverrides,
            messageAgents: s.messageAgents,
            messageThinking: s.messageThinking,
            workingDir: s.workingDir,
            fallbackModels: (s as any).fallbackModels || (readSettings().defaultFallbackModels || []),
            messageSkills: s.messageSkills,
            messageAttachments: s.messageAttachments,
          } as any);
        // Auto-ripristino: se il metadata condiviso ha perso agenti/workingDir,
        // li recuperiamo dal chat-meta.json DELLA CARTELLA DI SESSIONE.
        try {
          const metaP = path.join(dir, "chat-meta.json");
          if (fs.existsSync(metaP)) {
            const meta = JSON.parse(fs.readFileSync(metaP, "utf8"));
            const e = this.#entries.get(s.key);
            if (e) {
              // label: chat-meta.json (user intent) è AUTHORITATIVE — il rename
              // non si perde mai (reinstall, sync, sovrascritture del file condiviso).
              if (meta && typeof meta.label === 'string' && meta.label.trim()) {
                e.label = meta.label;
              }
              let backup: any = null;
              try {
                const bp = path.join(dir, "session-backup.json");
                if (fs.existsSync(bp)) backup = JSON.parse(fs.readFileSync(bp, "utf8"));
              } catch {}
              const rec = (f: string, m: string) => {
                if ((e as any)[f] === undefined || (e as any)[f] === null) {
                  if (meta && (meta as any)[m] !== undefined && (meta as any)[m] !== null) (e as any)[f] = (meta as any)[m];
                  else if (backup && (backup as any)[m] !== undefined && (backup as any)[m] !== null) (e as any)[f] = (backup as any)[m];
                }
              };
              // agentId: agents.json (user intent, scritto SOLO dal main) è AUTHORITATIVE.
              // In sua assenza, preferisci il valore con PIÙ agenti tra disco/chat-meta/backup.
              try {
                const intentP = path.join(dir, "agents.json");
                if (fs.existsSync(intentP)) {
                  try {
                    const intent = JSON.parse(fs.readFileSync(intentP, "utf8"));
                    if (typeof intent?.agentIds === 'string' && intent.agentIds.trim()) {
                      (e as any).agentId = intent.agentIds;
                    }
                  } catch {}
                } else {
                  const curSet = new Set(String((e as any).agentId || '').split(',').filter(Boolean));
                  let bestSet = curSet;
                  const trySet = (v: any) => {
                    if (!v) return;
                    const s = new Set(String(v).split(',').filter(Boolean));
                    if (s.size > bestSet.size) bestSet = s;
                  };
                  trySet((meta as any)?.agentIds);
                  trySet((backup as any)?.agentIds);
                  if (bestSet.size > 0 && bestSet.size > curSet.size) (e as any).agentId = Array.from(bestSet).join(',');
                }
              } catch {}
              rec("workingDir", "workingDir");
              rec("agentOverrides", "agentOverrides");
              rec("model", "model");
              rec("thinkingLevel", "thinkingLevel");
              rec("mode", "mode");
              rec("messageAgents", "messageAgents");
              rec("messageThinking", "messageThinking");
              rec("messageSkills", "messageSkills");
              rec("messageAttachments", "messageAttachments");
              rec("compactionAuto", "compactionAuto");
              rec("compactionThreshold", "compactionThreshold");
              rec("folderId", "folderId");
            }
          }
        } catch {}
        // Preferenze AUTHORITATIVE per-sessione (mode/model/thinking): mode.json è scritto
        // solo quando l'utente le cambia davvero → vince su file condiviso/chat-meta stantii.
        try {
          const prefsP = path.join(dir, "mode.json");
          if (fs.existsSync(prefsP)) {
            const prefs = JSON.parse(fs.readFileSync(prefsP, "utf8"));
            const e = this.#entries.get(s.key);
            if (e) {
              if (prefs.mode) e.mode = prefs.mode;
              if (prefs.model) e.model = prefs.model;
              if (prefs.thinkingLevel) e.thinkingLevel = prefs.thinkingLevel;
            }
          }
        } catch {}
        }
      }
      // Persisti i valori ripristinati (altrimenti un salvataggio dell'altra app
      // riporterebbe subito i None dal file condiviso).
      this.#save();
    } catch {}
    this.#loadContextUsage();
    try {
      if (fs.existsSync(ERRORS_FILE)) {
        const data = JSON.parse(fs.readFileSync(ERRORS_FILE, "utf8"));
        for (const [k, v] of Object.entries(data)) this.#errors.set(k, v as any[]);
      }
    } catch {}
  }

  // === Cleanup: remove temp delegation sessions from disk ===
  #cleanupDelegateSessions() {
    try {
      const base = path.join(this.#agentDir, "sessions", "quinki");
      if (!fs.existsSync(base)) return;
      const dirs = fs.readdirSync(base, { withFileTypes: true });
      for (const d of dirs) {
        if (d.name.startsWith("__delegate_")) {
          try {
            const fullPath = path.join(base, d.name);
            if (d.isDirectory()) {
              const files = fs.readdirSync(fullPath);
              for (const f of files) fs.unlinkSync(path.join(fullPath, f));
              fs.rmdirSync(fullPath);
            } else {
              fs.unlinkSync(fullPath);
            }
          } catch {}
        }
      }
    } catch {}
  }

  #loadContextUsage() {
    try {
      if (fs.existsSync(CONTEXT_USAGE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CONTEXT_USAGE_FILE, "utf8"));
        if (data && typeof data === "object") {
          for (const [k, v] of Object.entries(data)) {
            if (v && typeof v === "object" && typeof (v as any).contextWindow === "number") {
              this.#contextUsage.set(k, v as any);
            }
          }
        }
      }
    } catch {}
  }

  #saveContextUsage() {
    try {
      const data: Record<string, any> = {};
      for (const [k, v] of this.#contextUsage) data[k] = v;
      fs.writeFileSync(CONTEXT_USAGE_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch {}
  }

  // === Errori chat persistenti (isError nel file, come gli altri store) ===
  #errors = new Map<string, any[]>();
  #saveError(sessionKey: string, err: any) {
    try {
      const existing = this.#errors.get(sessionKey) || [];
      existing.push(err);
      this.#errors.set(sessionKey, existing);
      const data: Record<string, any> = {};
      for (const [k, v] of this.#errors) data[k] = v;
      fs.writeFileSync(ERRORS_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch {}
  }
  getErrors(sessionKey: string): any[] {
    return this.#errors.get(sessionKey) || [];
  }

  // Append delegation to .jsonl via SessionManager._appendEntry (puts it in the tree chain)
  // buildSessionContext() walks leaf→root, so delegation must be IN the chain to be included
  // agent-session.js filters role: "delegation" before LLM call → zero context cost
  #appendDelegationToJsonl(sessionKey: string, delegation: any) {
    try {
      // Use SessionManager._appendEntry to add delegation to the tree chain
      const pi = this.#active.get(sessionKey);
      if (pi?.sessionManager && typeof (pi.sessionManager as any)._appendEntry === 'function') {
        const entry = {
          type: "delegation",
          id: delegation.id,
          parentId: (pi.sessionManager as any).leafId, // link to current leaf
          timestamp: new Date(delegation.timestamp || Date.now()).toISOString(),
          delegationData: {
            agentName: delegation.agentName,
            delegatedMessage: delegation.delegatedMessage,
            content: delegation.content,
            model: delegation.model,
            thinkingLevel: delegation.thinkingLevel,
          },
        };
        (pi.sessionManager as any)._appendEntry(entry);
        this.logDebug("delegation-appended-to-chain", { sessionKey, id: delegation.id, leafId: entry.parentId });
      } else {
        // Fallback: write to file directly (delegation will be orphan but readable by #readDelegationEntries)
        const sessionDir = this.#piSessionDir(sessionKey);
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
          if (files.length > 0) {
            const entry = {
              type: "delegation",
              id: delegation.id,
              parentId: null,
              timestamp: new Date(delegation.timestamp || Date.now()).toISOString(),
              delegationData: { agentName: delegation.agentName, delegatedMessage: delegation.delegatedMessage, content: delegation.content, model: delegation.model, thinkingLevel: delegation.thinkingLevel },
            };
            fs.appendFileSync(path.join(sessionDir, files[0]), JSON.stringify(entry) + "\n", "utf8");
          }
        }
      }
    } catch (e: any) {
      this.logDebug("delegation-append-error", { error: e?.message });
    }
  }

  // FIX 084 (Pi SDK 0.84.x): AuthStorage non è piu esportato dall'index dell'SDK e
  // ModelRegistry.create(authStorage, path) e sparito — la costruzione passa da
  // ModelRuntime.create() + new ModelRegistry(runtime). Nessun network lookup
  // (allowModelNetwork/refreshOnCreate false): qui serve solo leggere models.json.
  async #createRegistry(): Promise<any> {
    const authPath = path.join(this.#agentDir, "auth.json");
    const modelsPath = path.join(this.#agentDir, "models.json");
    const runtime = await (this.#sdk as any).ModelRuntime.create({ authPath, modelsPath, allowModelNetwork: false, refreshOnCreate: false });
    return new (this.#sdk as any).ModelRegistry(runtime);
  }

  #findModelInRegistry(registry: any, modelId: string): any {
    // Cerca il modello in TUTTI i provider, non solo ollama
    const allModels = readModelsFromDisk();
    const modelInfo = allModels.find((m: any) => m.id === modelId);
    if (modelInfo) {
      return registry.find(modelInfo.provider, modelId);
    }
    // Fallback: prova ollama (per retrocompatibilità)
    return registry.find("ollama", modelId);
  }

  #piSessionDir(key: string) {
    return path.join(SESSION_BASE, key);
  }

  // === Legge il primo messaggio utente dal .jsonl per recuperare il label ===
  #readLabelFromJsonl(sessionKey: string): string {
    try {
      const sessionDir = path.join(SESSION_BASE, sessionKey);
      if (!fs.existsSync(sessionDir)) return "Chat";
      const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
      if (files.length === 0) return "Chat";
      const jsonlPath = path.join(sessionDir, files[files.length - 1]);
      const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === "message" && obj.message?.role === "user") {
            const content = obj.message.content;
            let text = "";
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block?.type === "text" && block.text) { text = block.text; break; }
              }
            } else if (typeof content === "string") {
              text = content;
            }
            if (text && text.trim().length > 0) {
              const cleaned = text.trim().replaceAll(/\s+/g, " ");
              const first = cleaned.split(/[.!?\n]/).map((s: string) => s.trim()).find((s: string) => s.length > 2) || cleaned;
              return first.length > 40 ? first.substring(0, 37) + "..." : first;
            }
          }
        } catch {}
      }
    } catch {}
    return "Chat";
  }


  getSessions() {
    // A2.1: le sessioni __exec_* sono headless (worker execution) → mai in sidebar
    // TOMBSTONE: le sessioni eliminate non devono MAI comparire nella mappa in memoria
    const out = [...this.#entries.values()].filter((s: any) => !String(s.key).startsWith("__exec_") && !isSessionDeleted(String(s.key))).map((s: any) => ({
      key: s.key, label: s.label, agentId: s.agentId || "",
      model: s.model, thinkingLevel: s.thinkingLevel, mode: s.mode,
      lastActivity: s.lastActivity, order: (s as any).order ?? s.lastActivity,
    }));

      try {
      if (fs.existsSync(SESSION_BASE)) {
        const dirs = fs.readdirSync(SESSION_BASE, { withFileTypes: true }).filter((d: fs.Dirent) => d.isDirectory());
        const existing = new Set(out.map((s: any) => s.key));
        const expertOnly = isExpertSidecar();
        for (const d of dirs) {
          if (expertOnly && d.name !== "__app_expert__") continue; // l'Expert NON adotta sessioni altrui
          if (!isMyPoolSession(d.name)) continue; // B4 pool: solo il mio gruppo
          if (d.name.startsWith("__delegate_") || d.name.startsWith("__exec_") || isSessionDeleted(d.name)) continue; // skip temp + execution + eliminate
          if (!existing.has(d.name)) {
            const files = fs.readdirSync(path.join(SESSION_BASE, d.name)).filter((f: string) => f.endsWith(".jsonl"));
            if (files.length > 0) {
              try {
                const orphanLabel2 = this.#readLabelFromJsonl(d.name);
                this.#entries.set(d.name, { key: d.name, label: orphanLabel2, createdAt: Date.now(), lastActivity: Date.now(), order: Date.now(), compactionAuto: true, compactionThreshold: 80, model: undefined as any, thinkingLevel: undefined as any, mode: "plan" } as any);
                this.#save();
              } catch {}
              const orphanLabelOut2 = this.#readLabelFromJsonl(d.name);
              out.push({ key: d.name, label: orphanLabelOut2, agentId: "pi", model: undefined as any, thinkingLevel: undefined as any, mode: "plan", lastActivity: Date.now(), order: Date.now() });
            }
          }
        }
      }
    } catch {}

    return out;
  }

  getSessionsWithFolder() {
    const fromFile = getSessionsFromFile();
    const folderByKey = new Map(fromFile.map((s: any) => [s.key, (s as any).folderId ?? null]));
    // === B6: leggo anche compactionAuto/compactionThreshold dal file per persistenza ===
    const compactionByKey = new Map(fromFile.map((s: any) => [s.key, { compactionAuto: (s as any).compactionAuto, compactionThreshold: (s as any).compactionThreshold }]));
    // === FIX: leggo l'order dal file (per persistere il riordino manuale) ===
    const orderByKey = new Map(fromFile.map((s: any) => [s.key, typeof (s as any).order === "number" ? (s as any).order : undefined]));
    // A2.1: sessioni __exec_* headless → mai nelle liste UI
    // TOMBSTONE: le eliminate non compaiono MAI (anche se ancora presenti nella mappa in memoria)
    const out = [...this.#entries.values()].filter((s: any) => !String(s.key).startsWith("__exec_") && !isSessionDeleted(String(s.key))).map((s: any) => {
      const c = compactionByKey.get(s.key);
      return {
        key: s.key, label: s.label, agentId: s.agentId || "",
        model: s.model, thinkingLevel: s.thinkingLevel, mode: s.mode,
        lastActivity: s.lastActivity, order: orderByKey.get(s.key) ?? s.lastActivity,
        folderId: folderByKey.get(s.key) ?? null,
        compactionAuto: c?.compactionAuto,
        compactionThreshold: c?.compactionThreshold,
        workerPort: sessionWorkerPort(s.key),
      };
    });

    // === B4 POOL: il MAIN (pool 0) è il ROUTER per la UI → mostra TUTTE le sessioni
    // (anche quelle degli altri gruppi, dal file) così la sidebar è completa.
    // I CHILD (pool > 0) restituiscono solo il loro gruppo (non usati dalla UI).
    if (poolSize() > 1 && poolIndex() === 0) {
      const known = new Set(out.map((s: any) => s.key));
      for (const s of fromFile) {
        if (!s || !s.key || known.has(s.key)) continue;
        if (String(s.key).startsWith("__exec_") || isSessionDeleted(String(s.key))) continue;
        out.push({
          key: s.key, label: s.label || "Chat", agentId: s.agentId || "",
          model: s.model, thinkingLevel: s.thinkingLevel, mode: s.mode,
          lastActivity: s.lastActivity, order: orderByKey.get(s.key) ?? s.lastActivity,
          folderId: folderByKey.get(s.key) ?? null,
          compactionAuto: compactionByKey.get(s.key)?.compactionAuto,
          compactionThreshold: compactionByKey.get(s.key)?.compactionThreshold,
          workerPort: sessionWorkerPort(s.key),
        });
        known.add(s.key);
      }
    }

    try {
      if (fs.existsSync(SESSION_BASE)) {
        const dirs = fs.readdirSync(SESSION_BASE, { withFileTypes: true }).filter((d: fs.Dirent) => d.isDirectory());
        const existing = new Set(out.map((s: any) => s.key));
        const expertOnlyScan = isExpertSidecar();
        for (const d of dirs) {
          if (expertOnlyScan && d.name !== "__app_expert__") continue; // l'Expert NON adotta sessioni altrui
          if (!isMyPoolSession(d.name)) continue; // B4 pool: solo il mio gruppo
          if (d.name.startsWith("__delegate_") || d.name.startsWith("__exec_") || isSessionDeleted(d.name)) continue; // skip temp + execution + eliminate
          if (!existing.has(d.name)) {
            const files = fs.readdirSync(path.join(SESSION_BASE, d.name)).filter((f: string) => f.endsWith(".jsonl"));
            if (files.length > 0) {
              const c = compactionByKey.get(d.name);
              // === Adopt orphan: add to #entries so it survives restart ===
              try {
                const orphanLabel = this.#readLabelFromJsonl(d.name);
                const orphanEntry = {
                  key: d.name, label: orphanLabel, createdAt: Date.now(),
                  lastActivity: Date.now(), order: Date.now(),
                  compactionAuto: c?.compactionAuto ?? true, compactionThreshold: c?.compactionThreshold ?? 80,
                  model: undefined as any, thinkingLevel: undefined as any, mode: "plan",
                };
                this.#entries.set(d.name, orphanEntry as any);
                this.#save(); // persist immediately
              } catch {}
              const orphanLabelOut = this.#readLabelFromJsonl(d.name);
              out.push({ key: d.name, label: orphanLabelOut, agentId: "pi", model: undefined as any, thinkingLevel: undefined as any, mode: "plan", lastActivity: Date.now(), order: orderByKey.get(d.name) ?? Date.now(), folderId: folderByKey.get(d.name) ?? null, compactionAuto: c?.compactionAuto, compactionThreshold: c?.compactionThreshold, workerPort: sessionWorkerPort(d.name) });
            }
          }
        }
      }
    } catch {}

    return out;
  }

  #parseContent(content: any): string {
    if (typeof content === "string") {
      if (content.startsWith("[")) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            return parsed.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
          }
        } catch {}
      }
      return content;
    }
    if (Array.isArray(content)) {
      return content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }
    if (content && typeof content === "object" && (content as any).text) return (content as any).text;
    return "";
  }

  #parseReasoning(content: any): string {
    const extract = (arr: any[]) =>
      arr.filter((b: any) => b.type === "thinking" && typeof b.thinking === "string")
         .map((b: any) => b.thinking)
         .join("");
    if (Array.isArray(content)) {
      return extract(content);
    }
    if (typeof content === "string" && content.startsWith("[")) {
      try {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) return extract(parsed);
      } catch {}
    }
    return "";
  }

  #mapMessage(m: any, thinkingLevel?: string, sessionKey?: string): any[] {
    const id = m.id || stableMsgId(m);
    const role = m.role || "assistant";
    // PRESERVA il timestamp REALE: i messaggi su disco hanno ISO string → converti in ms.
    // (prima usava Date.now() per le stringhe → tutti i messaggi avevano lo stesso
    // timestamp "adesso" → loadOlder chiedeva "prima di adesso" → restituiva gli
    // stessi 50 messaggi → dedup → niente caricava.)
    const tsRaw = m.timestamp;
    const ts = typeof tsRaw === "number" ? tsRaw : (typeof tsRaw === "string" ? new Date(tsRaw).getTime() : (tsRaw && typeof tsRaw === "object" && (tsRaw as any).$date ? new Date((tsRaw as any).$date).getTime() : 0)) || Date.now();
    const content = m.content;
    // === agentName + thinking persistence: lookup from session entry ===
    let agentName: string | undefined;
    let savedThinking: string | undefined;
    if (sessionKey) {
      try {
        const entry = this.#entries.get(sessionKey) as any;
        if (entry) {
          const mk = (id && entry.messageAgents?.[id]) ? id : (typeof ts === 'number' ? `ts-${ts}` : null);
          if (mk && entry.messageAgents) agentName = entry.messageAgents[mk];
          if (mk && entry.messageThinking) savedThinking = entry.messageThinking[mk];
          this.logDebug("mapMessage-agent-lookup", { sessionKey, msgId: id, msgTs: ts, mk, found: !!agentName, agentName, maCount: Object.keys(entry.messageAgents || {}).length });
        } else {
          this.logDebug("mapMessage-no-entry", { sessionKey });
        }
      } catch (e: any) { this.logDebug("mapMessage-lookup-error", { sessionKey, error: String(e) }); }
    }

    // === Compaction summary: marca come isCompactionSummary per il toggle blu ===
    if (role === "compactionSummary") {
      const summaryText = m.summary || (typeof content === "string" ? content : "");
      return [{ id, role: "assistant", content: summaryText, timestamp: ts, done: true, isCompactionSummary: true }];
    }

    if (role === "user" || role === "system") {
      return [{ id, role, content: this.#parseContent(content), timestamp: ts, done: true }];
    }

    if (role === "toolResult") {
      const text = this.#parseContent(content);
      return [{ id: `${id}-tool`, role: "tool_result", content: text, toolName: m.toolName, isError: !!m.isError, timestamp: ts, done: true }];
    }

    // QUINKI: delegation messages from buildSessionContext (with delegationData)
    if (role === "delegation") {
      const dd = (m as any).delegationData || {};
      return [{ id, role: "delegation", agentName: dd.agentName || "agent", delegatedMessage: dd.delegatedMessage || "", content: dd.content || [], model: dd.model || "", agentModel: dd.model || "", thinkingLevel: dd.thinkingLevel || "", thinkingTranslated: this.#translateThinkingForModel(dd.thinkingLevel, dd.model), timestamp: ts, done: true }];
    }
    if (role !== "assistant") {
      return [{ id, role, content: this.#parseContent(content), timestamp: ts, done: true }];
    }

    const blocks = Array.isArray(content) ? content
      : typeof content === "string" && content.startsWith("[")
        ? (() => { try { const p = JSON.parse(content); return Array.isArray(p) ? p : null; } catch { return null; } })()
        : null;

    if (!blocks) {
      return [{
        id, role: "assistant",
        content: this.#parseContent(content),
        reasoning: this.#parseReasoning(content) || undefined,
        timestamp: ts, done: true,
        model: m.model, provider: m.provider, responseId: m.responseId, stopReason: m.stopReason,
        thinkingLevel: savedThinking || thinkingLevel,
        thinkingTranslated: this.#translateThinkingForModel(savedThinking || thinkingLevel, m.model),
        agentName,
        isError: !!(m as any).isError,
      }];
    }

    const out: any[] = [];
    const reasoning = this.#extractReasoning(blocks);
    let textBuf = "";
    let bufIdx = 0;
    // === Preserve reasoning on reload: attach thinking to the FIRST emitted message ===
    // (text OR tool_call). Without this, turns like [thinking, toolCall] lose their
    // reasoning because thinking blocks are skipped in the loop and only text blocks
    // used to carry reasoning. Attaching to the first emitted message keeps the
    // thinking toggle visible after reload for tool-call turns.
    let reasoningAttached = false;
    const withReasoning = (): string | undefined => {
      if (reasoningAttached || !reasoning) return undefined;
      reasoningAttached = true;
      return reasoning;
    };
    const flushText = () => {
      if (!textBuf) return;
      out.push({
        id: `${id}-t${bufIdx++}`,
        role: "assistant",
        content: textBuf,
        reasoning: withReasoning(),
        timestamp: ts, done: true,
        model: m.model, provider: m.provider, responseId: m.responseId, stopReason: m.stopReason,
        thinkingLevel: savedThinking || thinkingLevel,
        thinkingTranslated: this.#translateThinkingForModel(savedThinking || thinkingLevel, m.model),
        agentName,
        isError: !!(m as any).isError,
      });
      textBuf = "";
    };

    for (const b of blocks) {
      if (b?.type === "text" && typeof b.text === "string") {
        textBuf += b.text;
      } else if (b?.type === "toolCall") {
        flushText();
        out.push({
          id: `${id}-tc${out.length}`,
          role: "tool_call",
          content: "",
          toolName: b.name,
          toolArgs: b.arguments,
          toolCallId: b.id,
          reasoning: withReasoning(),
          timestamp: ts, done: true,
        });
      }
    }
    flushText();
    if (out.length === 0) {
      out.push({ id, role: "assistant", content: "", reasoning: reasoning || undefined, timestamp: ts, done: true, thinkingLevel: savedThinking || thinkingLevel, thinkingTranslated: this.#translateThinkingForModel(savedThinking || thinkingLevel, m.model), sentEffort: (m as any).sentEffort || undefined, reasoningUsed: (m as any).reasoningUsed, reasoningTokens: (m as any).reasoningTokens, agentName, isError: !!(m as any).isError });
    }
    return out;
  }

  #extractReasoning(blocks: any[]): string {
    return blocks.filter((b: any) => b.type === "thinking" && typeof b.thinking === "string").map((b: any) => b.thinking).join("");
  }

  // === Universal thinking translation (29 ago): il livello Pi (xhigh/high/...) →
  // il valore REALE che il provider riceve. La mappa di models.json + la cache
  // delle capacità sondate (thinking-caps.json) per xhigh. ===
  #getThinkingMaps(): Record<string, any> {
    try {
      const modelsPath = path.join(this.#agentDir, "models.json");
      const st = fs.statSync(modelsPath);
      if (!this.#thinkingMapsCache || this.#thinkingMapsCache.mtime !== st.mtimeMs) {
        const models = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
        const maps: Record<string, any> = {};
        for (const prov of Object.values<any>(models.providers || {})) {
          for (const mm of prov.models || []) if (mm?.id && mm.thinkingLevelMap) maps[String(mm.id)] = mm.thinkingLevelMap;
        }
        this.#thinkingMapsCache = { mtime: st.mtimeMs, maps };
      }
      return this.#thinkingMapsCache.maps;
    } catch { return {}; }
  }

  #getThinkingCaps(): Record<string, any> {
    try {
      const capsPath = path.join(process.env.HOME || "", ".quinki", "thinking-caps.json");
      const st = fs.statSync(capsPath);
      if (!this.#thinkingCapsCache || this.#thinkingCapsCache.mtime !== st.mtimeMs) {
        this.#thinkingCapsCache = { mtime: st.mtimeMs, caps: JSON.parse(fs.readFileSync(capsPath, "utf8") || "{}") };
      }
      return this.#thinkingCapsCache.caps;
    } catch { return {}; }
  }

  
  // PUBLIC wrapper: executor e scheduler usano questa per tradurre il thinking
  // level ("on" → "max" per il modello specifico). Come nelle chat normali.
  translateThinkingForModel(level: string | undefined, modelId: string | undefined): string {
    return this.#translateThinkingForModel(level, modelId);
  }

#translateThinkingForModel(level: string | undefined, modelId: string | undefined): string {
    try {
      const lvl = String(level || "");
      if (!lvl || lvl === "off") return "";
      const mid = String(modelId || "");
      if (!mid) return "";
      let out = String(this.#getThinkingMaps()[mid]?.[lvl] || "");
      // FIX (01 set v2): "on" = massimale del modello. Se la mappa non ha "on",
      // cerca il MAX nei caps. Se anche i caps non hanno il modello, "on" = "max"
      // (universal thinking SEMPRE al massimo). MAI ritornare vuoto per "on".
      if (lvl === "on" || lvl === "xhigh") {
        const caps = this.#getThinkingCaps();
        const key = Object.keys(caps).find((k: string) => k.endsWith("/" + mid));
        if (key && caps[key]?.maxLevel) {
          out = String(caps[key].maxLevel);
        } else {
          out = "max"; // universal thinking default: sempre il massimo
        }
      }
      return out;
    } catch { return ""; }
  }

  getHistory(key: string, limit?: number) {
    // B0.5: aprire una chat = attività → touch + sweep LRU
    this.#touchSession(key);
    this.#sweepInactive();
    // Recovery ON-OPEN: se la sessione APERTA ha un turno interrotto, ri-promptata.
    // (Il boot recovery è stato rimosso: mai ri-promptare chat non guardate.)
    if (!this.#onOpenRecoveryTriggered.has(key)) {
      this.#onOpenRecoveryTriggered.add(key);
      this.recoverPendingTurns(key).catch(() => {}).finally(() => { this.#onOpenRecoveryTriggered.delete(key); });
    }
    const pageLimit = typeof limit === "number" && limit > 0 ? limit : 200;
    const pi = this.#active.get(key);
    const sessionEntry = this.#entries.get(key);
    const tlvl = sessionEntry?.thinkingLevel;
    // === Detect noop compactions: compaction entries with same firstKeptEntryId as previous ===
    const detectNoopCompactions = (entsIn: any[]): Set<number> => {
      const noopTs = new Set<number>();
      try {
        const ents = entsIn || [];
        let firstMsgIdx = -1;
        for (let i = 0; i < ents.length; i++) {
          if ((ents[i] as any)?.type === "message") { firstMsgIdx = i; break; }
        }
        let prevFirstKept: string | undefined;
        for (const e of ents) {
          if ((e as any)?.type === "compaction") {
            const ts = new Date((e as any).timestamp).getTime();
            const firstKept = (e as any).firstKeptEntryId;
            if (prevFirstKept && firstKept === prevFirstKept) {
              noopTs.add(ts);
            }
            else if (firstMsgIdx >= 0 && ents[firstMsgIdx] && firstKept === ents[firstMsgIdx].id) {
              noopTs.add(ts);
            }
            prevFirstKept = firstKept;
          }
        }
      } catch {}
      return noopTs;
    };
    const mapWithNoop = (messages: any[], noopTs: Set<number>) => {
      return messages.flatMap((m: any) => {
        if ((m as any).hidden) return [];
        if (m.role === "compactionSummary" && noopTs.has(m.timestamp)) {
          return [{ id: m.id || stableMsgId(m), role: "assistant", content: "⚠️ **Compaction non efficace**: La conversazione è troppo corta o i messaggi sono troppo grandi per essere compattati.\\n\\nIl contesto non è stato ridotto. Considera di iniziare una nuova chat se il contesto è pieno.", timestamp: m.timestamp, done: true, isCompactionWarning: true }];
        }
        return this.#mapMessage(m, tlvl, key);
      });
    };
    const collectAllCompactionMessages = (entsIn: any[], noopTs: Set<number>): any[] => {
      const result: any[] = [];
      try {
        const ents = entsIn || [];
        const compactionEntries = ents.filter((e: any) => e?.type === "compaction");
        for (let i = 0; i < compactionEntries.length; i++) {
          const e = compactionEntries[i];
          const ts = new Date(e.timestamp).getTime();
          if (noopTs.has(ts)) {
            result.push({ id: e.id || `comp-${i}`, role: "assistant", content: "⚠️ **Compaction non efficace**: La conversazione è troppo breve o i messaggi sono troppo grandi per essere compattati.\\n\\nIl contenuto non è stato ridotto. Considera di iniziare una nuova chat se il contesto è pieno.", timestamp: ts, done: true, isCompactionWarning: true });
          } else {
            result.push({ id: e.id || `comp-${i}`, role: "assistant", content: e.summary || "", timestamp: ts, done: true, isCompactionSummary: true });
          }
        }
      } catch {}
      return result;
    };
    const finalize = (ctxMessages: any[], entsIn: any[]): any[] => {
      const noopTs = detectNoopCompactions(entsIn);
      const prevCompactions = collectAllCompactionMessages(entsIn, noopTs);
      const mapped = mapWithNoop(ctxMessages, noopTs).filter((m: any) => !m.isCompactionSummary && !m.isCompactionWarning);
      const errs = (this.#errors.get(key) || []).map((er: any, i: number) => ({ id: `err-${i}-${er.timestamp}`, role: "assistant", content: "", errorContent: er.errorMessage, isError: true, timestamp: er.timestamp, done: true, model: er.model, agentName: er.agentName, thinkingLevel: er.thinkingLevel }));
      const allSorted = [...prevCompactions, ...mapped, ...errs].sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
      return allSorted.slice(-pageLimit);
    };

    // === B0.3: DISK PATH — legge SEMPRE dal file .jsonl (mai sessioni troncate).
    // L'utente NON deve MAI perdere messaggi: il file su disco è la verità, anche per
    // sessioni attive (l'in-memory può essere stale dopo stop/abort/reload). ===
    try {
      const dir = this.#piSessionDir(key);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
        if (files.length > 0) {
          const filePath = path.join(dir, files[0]);
          const tail = this.#readSessionTail(filePath, 1200);
          if (tail.length > 1) {
            const byId = new Map<any, any>();
            for (const e of tail) if (e?.id) byId.set(e.id, e);
            // leaf = l'ULTIMO MESSAGGIO (non l'ultima riga, che può essere metadata)
            let leafId: string | undefined;
            for (let i = tail.length - 1; i >= 0; i--) {
              const e = tail[i];
              if (e?.type === "message") { leafId = e.id; break; }
            }
            const ctx = this.#sdk.buildSessionContext(tail, leafId, byId) || { messages: [] };
            if (ctx.messages && ctx.messages.length > 0) {
              return finalize(ctx.messages, tail);
            }
          }
        }
      }
    } catch {}

    // === Path attivo (sessioni piccole): sessionManager in memoria ===
    if (pi?.sessionManager) {
      try {
        const ctx = pi.sessionManager.buildSessionContext();
        if (ctx?.messages) {
          return finalize(ctx.messages, pi.sessionManager.getEntries?.() || []);
        }
      } catch {}
    }
    // === Fallback (raro): apre il SessionManager dal disco se il tail non ha prodotto nulla ===
    try {
      const dir = this.#piSessionDir(key);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
        if (files.length > 0) {
          const sm = this.#sdk.SessionManager.open(path.join(dir, files[0]), dir, this.#cwd);
          const ctx = sm.buildSessionContext();
          if (ctx?.messages) {
            return finalize(ctx.messages, sm.getEntries?.() || []);
          }
        }
      }
    } catch {}
    return [];
  }

  // === B0.8: pagina PRECEDENTE della storia (messaggi più vecchi di ts) ===
  getHistoryBefore(key: string, ts: number, limit?: number): any[] {
    const pageLimit = typeof limit === "number" && limit > 0 ? limit : 50;
    const dir = this.#piSessionDir(key);
    const results: any[] = [];
    try {
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
      if (files.length > 0) {
        const filePath = path.join(dir, files[0]);
        const tlvl = this.#entries.get(key)?.thinkingLevel;
        const stat = fs.statSync(filePath);
        const CHUNK = 512 * 1024;
        let pos = stat.size;
        let buf = "";
        let done = false;
        // Legge il file a CHUNK dal FONDO (i messaggi nuovi sono in fondo):
        // raccoglie i 50 messaggi più vecchi di ts e si FERMA. Non legge tutto
        // il file (124MB+) a ogni chiamata (prima andava in timeout).
        while (pos > 0 && !done) {
          const start = Math.max(0, pos - CHUNK);
          const chunk = Buffer.alloc(pos - start);
          const fd = fs.openSync(filePath, "r");
          try { fs.readSync(fd, chunk, 0, pos - start, start); } finally { fs.closeSync(fd); }
          pos = start;
          buf = chunk.toString("utf8") + buf;
          // processa le righe complete da buf (dalla fine)
          let idx;
          while ((idx = buf.lastIndexOf("\n")) >= 0) {
            const line = buf.slice(idx + 1).trim();
            buf = buf.slice(0, idx);
            if (!line) continue;
            try {
              const entry = JSON.parse(line);
              if (entry?.type !== "message" || entry?.hidden) continue;
              const raw = entry.message && typeof entry.message === "object" ? entry.message : entry;
              const t = new Date(entry.timestamp || raw.timestamp).getTime();
              if (typeof t === "number" && !isNaN(t) && t < ts) {
                const msg = { ...raw, id: entry.id || raw.id, timestamp: entry.timestamp || raw.timestamp, parentId: entry.parentId };
                const mapped = this.#mapMessage(msg, tlvl, key);
                results.push(...mapped);
                if (results.length >= pageLimit) { done = true; break; }
              }
            } catch {}
          }
        }
        // ultimo residuo (prima riga del file senza newline)
        if (!done && buf.trim()) {
          try {
            const entry = JSON.parse(buf.trim());
            if (entry?.type === "message" && !entry?.hidden) {
              const raw = entry.message && typeof entry.message === "object" ? entry.message : entry;
              const t = new Date(entry.timestamp || raw.timestamp).getTime();
              if (typeof t === "number" && !isNaN(t) && t < ts) {
                const msg = { ...raw, id: entry.id || raw.id, timestamp: entry.timestamp || raw.timestamp, parentId: entry.parentId };
                const mapped = this.#mapMessage(msg, tlvl, key);
                results.push(...mapped);
              }
            }
          } catch {}
        }
      }
    } catch {}
    // i risultati sono in ordine inverso (dal fondo) → riordina per timestamp
    results.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
    return results.slice(-pageLimit);
  }

  // === B0.8: pagina precedente del DEBUG LOG (più vecchi di from) ===
  getDebugLogBefore(from: number, limit?: number): { entries: any[]; latestTs: number; total: number } {
    try {
      const all = this.getDebugLog();
      const older = all.filter((e: any) => typeof e.ts === "number" && e.ts < from);
      return { entries: older.slice(-(typeof limit === "number" && limit > 0 ? limit : 300)), latestTs: 0, total: older.length };
    } catch { return { entries: [], latestTs: 0, total: 0 }; }
  }

  // === B0.9: stream del jsonl riga per riga (senza caricare tutto) ===
  #forEachSessionLine(filePath: string, cb: (entry: any) => void) {
    try {
      const fd = fs.openSync(filePath, "r");
      const stat = fs.fstatSync(fd);
      const CHUNK = 1024 * 1024;
      let buf = "";
      let pos = 0;
      const chunk = Buffer.alloc(CHUNK);
      while (pos < stat.size) {
        const n = fs.readSync(fd, chunk, 0, CHUNK, pos);
        if (n <= 0) break;
        pos += n;
        buf += chunk.toString("utf8", 0, n);
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          try { cb(JSON.parse(line)); } catch {}
        }
      }
      if (buf.trim()) { try { cb(JSON.parse(buf.trim())); } catch {} }
      fs.closeSync(fd);
    } catch {}
  }

  // === Stale streaming buffer cleanup ===
  // Un buffer di streaming può restare appeso quando agent_end non scatta (sidecar
  // ucciso, recovery, race). Se l'ultimo messaggio nel jsonl è assistant done=true
  // (turno COMPLETATO) ma il buffer esiste ancora → è stale → va eliminato.
  // Altrimenti la UI mostra "Running" falso e la LRU tiene la sessione attiva.
  #cleanStaleStreamingBuffers() {
    for (const key of [...this.#streamingBuffers.keys()]) {
      if (this.#prompts.has(key) || this.#responseTimers.has(key)) continue; // turno davvero attivo
      try {
        const dir = this.#piSessionDir(key);
        const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
        if (files.length === 0) { this.#streamingBuffers.delete(key); continue; }
        const tail = this.#readSessionTail(path.join(dir, files[0]), 1);
        const last = tail[tail.length - 1];
        const m = last?.message || last;
        // STRICT done === true: solo turni COMPLETATI. Mai un turno in streaming
        // (l'ultimo msg jsonl sarebbe user o assistant done=false/undefined).
        if (m?.role === "assistant" && m.done === true) {
          this.#streamingBuffers.delete(key);
          this.logDebug("stale-streaming-buffer-cleaned", { sessionKey: key });
        }
      } catch {}
    }
  }

  // === B0.9: cerca in TUTTA la storia della sessione (jsonl) ===
  searchSessionMessages(key: string, query: string, limit?: number): any[] {
    const q = (query || "").toLowerCase();
    if (!q) return [];
    const max = typeof limit === "number" && limit > 0 ? limit : 10000;
    const matches: any[] = [];
    try {
      const dir = this.#piSessionDir(key);
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
      if (files.length === 0) return [];
      const filePath = path.join(dir, files[0]);
      this.#forEachSessionLine(filePath, (e: any) => {
        if (e?.type !== "message") return;
        const m = e.message || e;
        const role = m.role || "assistant";
        // Stessa logica del frontend: solo user/assistant, testo = #parseContent + strip code block
        if (role !== "user" && role !== "assistant") return;
        const text = this.#parseContent(m.content).replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "").toLowerCase();
        const ts = new Date(m.timestamp || e.timestamp || 0).getTime();
        let idx = 0;
        while ((idx = text.indexOf(q, idx)) !== -1) {
          matches.push({ timestamp: ts, charIdx: idx, role });
          idx += q.length;
        }
      });
    } catch {}
    return matches.slice(-max);
  }

  // === B0.9: pagina di messaggi ATTORNO a un timestamp (per saltare al match) ===
  getHistoryAround(key: string, ts: number, limit?: number): any[] {
    const half = Math.floor((typeof limit === "number" && limit > 0 ? limit : 50) / 2);
    const before: any[] = [];
    const after: any[] = [];
    try {
      const dir = this.#piSessionDir(key);
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
      if (files.length === 0) return [];
      const filePath = path.join(dir, files[0]);
      this.#forEachSessionLine(filePath, (e: any) => {
        if (e?.type !== "message") return;
        const m = e.message || e;
        const mts = new Date(m.timestamp || e.timestamp || 0).getTime();
        if (mts <= ts) {
          before.push(m);
          if (before.length > half) before.shift();
        } else {
          if (after.length < half) after.push(m);
        }
      });
    } catch {}
    const all = [...before, ...after];
    const tlvl = this.#entries.get(key)?.thinkingLevel;
    return all.flatMap((m: any) => this.#mapMessage(m, tlvl, key));
  }

  // === B0.9: cerca nel DEBUG LOG (file) ===
  searchDebugLog(query: string, limit?: number): any[] {
    const q = (query || "").toLowerCase();
    if (!q) return [];
    const max = typeof limit === "number" && limit > 0 ? limit : 50;
    const matches: any[] = [];
    try {
      if (!fs.existsSync(DEBUG_LOG_FILE)) return [];
      this.#forEachSessionLine(DEBUG_LOG_FILE, (e: any) => {
        const text = (e?.tag || "") + " " + JSON.stringify(e?.data || {});
        if (text.toLowerCase().includes(q)) {
          matches.push({ id: String(e?.ts || ""), ts: e?.ts || 0, tag: e?.tag || "", snippet: text.slice(0, 200) });
        }
      });
    } catch {}
    return matches.slice(-max);
  }

  // === B0.3: Legge la CODA del file (maxLines righe) senza materializzare tutto ===
  #readSessionTail(filePath: string, maxLines: number): any[] {
    try {
      const fd = fs.openSync(filePath, "r");
      const stat = fs.fstatSync(fd);
      if (stat.size <= 0) { fs.closeSync(fd); return []; }
      const CHUNK = 512 * 1024;
      const MAX_BUFFER = 8 * 1024 * 1024;
      let buffer = Buffer.alloc(0);
      let pos = stat.size;
      while (pos > 0 && buffer.length < MAX_BUFFER) {
        const readSize = Math.min(CHUNK, pos);
        pos -= readSize;
        const chunk = Buffer.alloc(readSize);
        fs.readSync(fd, chunk, 0, readSize, pos);
        buffer = Buffer.concat([chunk, buffer]);
        let nl = 0;
        for (let i = 0; i < buffer.length; i++) if (buffer[i] === 10) nl++;
        if (nl >= maxLines) break;
      }
      fs.closeSync(fd);
      const lines = buffer.toString("utf8").split("\n").filter((l: string) => l.trim().length > 0);
      const entries: any[] = [];
      for (const line of lines.slice(-maxLines)) {
        try { entries.push(JSON.parse(line)); } catch {}
      }
      return entries;
    } catch { return []; }
  }

  create(key: string, label: string): SessionEntry {
    const existing = this.#entries.get(key);
    if (existing) return existing;
    // POOL FIX: se la sessione esiste nel registry (file), il worker deve EREDITARE
    // order/label — altrimenti crea con order=now → la chat salta in cima alla sidebar
    // e perde il nome (il worker non sa che è una sessione esistente).
    let fileOrder: number | undefined;
    let fileLabel: string | undefined;
    let filePrefs: any = null;
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        const found = Array.isArray(data) ? data.find((s: any) => s.key === key) : null;
        if (found) {
          if (typeof found.order === "number") fileOrder = found.order;
          if (typeof found.label === "string" && found.label.trim()) fileLabel = found.label;
          // FIX 084 (03 set): eredita ANCHE mode/model/thinkingLevel/agentId/workingDir/
          // compaction dall'entry esistente sul file. Prima ereditava SOLO order/label →
          // quando il frontend chiama ensureSession per una chat appena creata con
          // mode:"build", create() la RICREAVA con mode:"plan" → il file tornava plan →
          // le nuove sessioni partivano sempre in PLAN MODE (oggetto del bug T2.7).
          filePrefs = {
            mode: typeof found.mode === "string" ? found.mode : undefined,
            model: found.model !== undefined ? found.model : undefined,
            thinkingLevel: found.thinkingLevel !== undefined ? found.thinkingLevel : undefined,
            agentId: found.agentId !== undefined ? found.agentId : undefined,
            agentOverrides: found.agentOverrides !== undefined ? found.agentOverrides : undefined,
            workingDir: found.workingDir !== undefined ? found.workingDir : undefined,
            compactionAuto: typeof found.compactionAuto === "boolean" ? found.compactionAuto : undefined,
            compactionThreshold: typeof found.compactionThreshold === "number" ? found.compactionThreshold : undefined,
          };
        }
      }
    } catch {}
    const dm = pickDefaultModel();
    const dt = dm ? pickDefaultThinkingLevelForModel(dm) : pickDefaultThinkingLevel();
    const now = Date.now();
    // === Fix 3/B5: inizializza compactionAuto leggendo il globale ===
    const globalSettings = readSettings();
    const globalAuto = typeof globalSettings.globalCompactionAuto === "boolean" ? globalSettings.globalCompactionAuto : true;
    const s: SessionEntry = {
      key,
      label: fileLabel || label || "Chat",
      createdAt: now,
      // === Fix 10: lastActivity e order alti per far apparire le nuove chat in cima ===
      // (per le sessioni ESISTENTI l'order arriva dal file → l'ordine manuale resta)
      lastActivity: now,
      order: fileOrder ?? now,
      // === Fix 3/B5: inizializza dal globale, NON undefined ===
      compactionAuto: globalAuto,
      compactionThreshold: 80,
      model: filePrefs?.model !== undefined ? filePrefs.model : (dm || undefined),
      thinkingLevel: filePrefs?.thinkingLevel !== undefined ? filePrefs.thinkingLevel : dt,
      mode: filePrefs?.mode || "plan",
      fallbackModels: filePrefs?.fallbackModels || (readSettings().defaultFallbackModels || []),
      ...(filePrefs?.agentId ? { agentId: filePrefs.agentId } : {}),
      ...(filePrefs?.agentOverrides ? { agentOverrides: filePrefs.agentOverrides } : {}),
      ...(filePrefs?.workingDir ? { workingDir: filePrefs.workingDir } : {}),
      ...(filePrefs?.compactionAuto !== undefined ? { compactionAuto: filePrefs.compactionAuto } : {}),
      ...(filePrefs?.compactionThreshold !== undefined ? { compactionThreshold: filePrefs.compactionThreshold } : {}),
    };
    this.#entries.set(key, s);
    this.#save();
    this.logDebug("session-create", { sessionKey: key, inheritedOrder: fileOrder ?? "(none)", order: s.order, label: s.label });
    this.#pendingModels.set(key, dm);
    this.#pendingThinking.set(key, dt);
    // === Fix 3/B5: notifica Pi SDK dell'impostazione globale ===
    // Sarà applicata quando la sessione viene attivata (vedi activateSession)
    this.#pendingCompactionAuto.set(key, globalAuto);
    // === A3: applica il default notify mode (persistente in quinki-settings.json) ===
    // NB: NON per le sessioni __exec_* (headless dei task — non sono chat reali)
    if (!key.startsWith("__exec_")) {
      try {
        const gs = readSettings();
        const dmode = gs.defaultNotifyMode;
        if (dmode && !this.#readState.has(key)) {
          this.#readState.set(key, { lastReadTs: 0, lastReadTaskTs: 0, notifyMode: dmode, notifyModeTs: 0 });
          this.#saveReadState();
        }
      } catch {}
    }
    return s;
  }

  rename(key: string, label: string) {
    const s = this.#entries.get(key);
    if (s) { s.label = label; this.#save(); }
    // USER INTENT (anti-loss): label per-sessione in chat-meta.json — sopravvive
    // a reinstall/aggiornamento e a sovrascritture del file condiviso da altri processi.
    this.#writeChatMeta(key, { label });
  }

  // A4.3 POOL SYNC: il worker rinomina/aggiorna la sessione — il MAIN deve
  // aggiornare la SUA entry in memoria, altrimenti il suo #save sovrascrive il
  // label/ordine aggiornato dal worker (la chat tornava a 'New chat' e riordinava).
  updateSessionFromEvent(key: string, p: any) {
    try {
      const s = this.#entries.get(key);
      if (!s) return;
      if (p && typeof p.label === 'string' && p.label.trim() && p.label !== s.label) { s.label = p.label; }
      if (p && typeof p.order === 'number' && p.order !== s.order) { s.order = p.order; }
      if (p && typeof p.model === 'string' && p.model) { s.model = p.model; }
      if (p && typeof p.thinkingLevel === 'string' && p.thinkingLevel) { s.thinkingLevel = p.thinkingLevel; }
      if (p && typeof p.mode === 'string' && p.mode) { (s as any).mode = p.mode; }
    } catch {}
  }

  updateSessionEntry(key: string, updates: { folderId?: string | null; order?: number }) {
    const s = this.#entries.get(key);
    if (s) {
      if (updates.folderId !== undefined) (s as any).folderId = updates.folderId;
      if (updates.order !== undefined) (s as any).order = updates.order;
      // Do NOT call #save() — it overwrites the file without folderId
      // moveSessionIPC already wrote the file correctly
    }
  }

  // === B6: persisti override compaction per-sessione su disco ===
  setSessionCompaction(key: string, auto: boolean | undefined, threshold: number | undefined) {
    const s = this.#entries.get(key);
    if (!s) return;
    (s as any).compactionAuto = auto;
    (s as any).compactionThreshold = threshold;
    // === Fix 3/B5: notifica Pi SDK del cambio auto-compaction ===
    // Se auto è definito, applica a Pi SDK (true=attivo, false=disattivo)
    if (typeof auto === "boolean") {
      this.applySessionCompactionSettings(key, auto);
    }
    this.#save();
    // Salva anche nel file di sessions per la sidebar
    try {
      const fromFile = getSessionsFromFile();
      const idx = fromFile.findIndex((x: any) => x.key === key);
      if (idx >= 0) {
        fromFile[idx].compactionAuto = auto;
        fromFile[idx].compactionThreshold = threshold;
        fs.writeFileSync(SESSION_FILE, JSON.stringify(fromFile, null, 2), "utf8");
      } else {
        fromFile.push({ key, compactionAuto: auto, compactionThreshold: threshold });
        fs.writeFileSync(SESSION_FILE, JSON.stringify(fromFile, null, 2), "utf8");
      }
    } catch (e: any) {
      this.logDebug("set-session-compaction-file-error", { key, error: e?.message || String(e) });
    }
    this.logDebug("set-session-compaction", { sessionKey: key, auto, threshold });
  }

  // === B0.1 (S9): monitoring heap (bun:jsc) ===
  async getHeapStats(): Promise<any> {
    try {
      const jsc: any = await import("bun:jsc");
      const h = (jsc.heapStats as any)();
      const mu = process.memoryUsage();
      return { heapSize: h.heapSize, heapCapacity: h.heapCapacity, extraMemorySize: h.extraMemorySize, objectCount: h.objectCount, protectedObjectCount: h.protectedObjectCount, rss: mu.rss, ts: Date.now() };
    } catch (e: any) { return { error: String(e?.message || e), ts: Date.now() }; }
  }

  #startHeapStatsLog() {
    // Log periodico (monitoring): 1 ogni 60s — NON è recovery, è solo osservabilità
    try {
      if ((this as any)._heapStatsTimer) return;
      (this as any)._heapStatsTimer = setInterval(() => {
        try { this.logDebug("heap-stats", this.getHeapStats()); } catch {}
        try { this.#cleanStaleStreamingBuffers(); } catch {}
      }, 60000);
    } catch {}
  }

  // === B0.2 (S4): dispose pulito di una sessione Pi (unsubscribe + dispose) ===
  // force=true: anche se c'è un turno/streaming (usato dalle DELETE esplicite — l'utente
  // ha eliminato la chat, il turno orfano va fermato). force=false: guardia (per LRU).
  #disposeSession(key: string, force: boolean) {
    const pi = this.#active.get(key);
    if (!pi) return;
    if (!force && (this.#streamingBuffers.has(key) || this.#prompts.has(key))) return;
    try {
      const unsub = this.#unsubs.get(key);
      if (unsub) { try { unsub(); } catch {} }
      try { (pi as any).dispose?.(); } catch {}
    } catch {}
  }

  // === B0.5: tocca la sessione (aggiorna lastActivity in memoria) — chiamato su uso ===
  // NB: NON tocca `order`: l'ordine in sidebar è MANUALE (drag&drop) — l'attività non
  // deve risistemare le chat. La LRU (idle) usa lastActivity, non order.
  #touchSession(key: string) {
    try {
      const s = this.#entries.get(key);
      if (s) {
        s.lastActivity = Date.now();
      }
    } catch {}
  }

  // === B0.5: disattiva una sessione dalla RAM (dispose + unsub) SENZA eliminarla ===
  #deactivateSession(key: string) {
    const pi = this.#active.get(key);
    if (!pi) return;
    // Guardie: mai disattivare sessioni in streaming / con turno attivo
    if (this.#streamingBuffers.has(key) || this.#prompts.has(key) || this.#responseTimers.has(key)) return;
    try {
      const unsub = this.#unsubs.get(key);
      if (unsub) { try { unsub(); } catch {} }
      try { (pi as any).dispose?.(); } catch {}
    } catch {}
    this.#active.delete(key);
    this.#unsubs.delete(key);
    this.#streamingBuffers.delete(key);
    this.#responseTimers.delete(key);
    this.logDebug("session-lru-deactivated", { sessionKey: key, activeNow: this.#active.size });
    // JSC non restituisce i slab all'OS da solo → GC pieno async per rilasciare la RAM
    forceGC();
  }

  // === B0.5: sweep LRU (event-based, mai timer) ===
  #sweepInactive() {
    try { this.#cleanStaleStreamingBuffers(); } catch {}
    try {
      const gs = readSettings();
      const maxActive = typeof gs.maxActiveSessions === "number" ? gs.maxActiveSessions : 5;
      const idleTimeout = typeof gs.sessionIdleTimeout === "number" ? gs.sessionIdleTimeout : 15 * 60 * 1000;
      const now = Date.now();
      const keys = [...this.#active.keys()];
      if (keys.length <= 1) return;
      const candidates = keys.filter(k => {
        if (this.#streamingBuffers.has(k)) return false;
        if (this.#prompts.has(k)) return false;
        if (this.#responseTimers.has(k)) return false;
        return true;
      });
      if (candidates.length <= 1) return;
      candidates.sort((a, b) => ((this.#entries.get(a)?.lastActivity) || 0) - ((this.#entries.get(b)?.lastActivity) || 0));
      const current = candidates[candidates.length - 1];
      for (const k of candidates) {
        if (k === current) continue;
        const idle = now - (this.#entries.get(k)?.lastActivity || 0);
        if (idle > idleTimeout) this.#deactivateSession(k);
      }
      let count = this.#active.size;
      if (count > maxActive) {
        for (const k of candidates) {
          if (count <= maxActive) break;
          if (k === current) continue;
          if (this.#active.has(k)) { this.#deactivateSession(k); count = this.#active.size; }
        }
      }
    } catch {}
  }

  #cleanSessionMaps(key: string) {
    this.#entries.delete(key);
    this.#active.delete(key);
    this.#wss.delete(key);
    this.#unsubs.delete(key);
    this.#prompts.delete(key);
    this.#pendingModels.delete(key);
    this.#pendingThinking.delete(key);
    this.#pendingMode.delete(key);
    this.#streamingBuffers.delete(key);
  }

  remove(key: string) {
    try { markSessionDeleted(String(key)); } catch {}
    this.#disposeSession(key, true);
    this.#entries.delete(key);
    this.#active.delete(key);
    this.#wss.delete(key);
    this.#unsubs.delete(key);
    this.#prompts.delete(key);
    this.#pendingModels.delete(key);
    this.#pendingThinking.delete(key);
    this.#pendingMode.delete(key);
    this.#streamingBuffers.delete(key);
    this.#save();
    try {
      const dir = this.#piSessionDir(key);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }

  // === B0.2 (S4): per i delete BULK — dispose SENZA riscrivere il file sessioni ===
  removeDispose(key: string) {
    try { markSessionDeleted(String(key)); } catch {}
    this.#disposeSession(key, true);
    this.#entries.delete(key);
    this.#active.delete(key);
    this.#wss.delete(key);
    this.#unsubs.delete(key);
    this.#prompts.delete(key);
    this.#pendingModels.delete(key);
    this.#pendingThinking.delete(key);
    this.#pendingMode.delete(key);
    this.#streamingBuffers.delete(key);
    try {
      const dir = this.#piSessionDir(key);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }

  getModel(key: string): string | null {
    const pi = this.#active.get(key);
    if (pi) {
      try { return pi.model?.id || null; } catch {}
    }
    return this.#entries.get(key)?.model || null;
  }

  refreshModelRegistry(): void {
    try { this.#modelRegistry?.refresh?.(); } catch {}
  }

  getThinkingLevel(key: string): string | null {
    const pi = this.#active.get(key);
    if (pi) {
      try { return pi.thinkingLevel || null; } catch {}
    }
    return this.#entries.get(key)?.thinkingLevel || null;
  }

  getSessionMeta(key: string): { model?: string; thinkingLevel?: string; availableThinkingLevels: string[]; mode: string; agentId?: string; agentOverrides?: any } {
    // Read session entry directly from disk (sync between sidecars)
    let s = this.#entries.get(key);
    try {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
      const diskEntry = (Array.isArray(data) ? data : []).find((e: any) => e.key === key);
      if (diskEntry) {
        // Force update in-memory entry from disk
        if (s) {
          if (diskEntry.model) s.model = diskEntry.model;
          if (diskEntry.thinkingLevel) s.thinkingLevel = diskEntry.thinkingLevel;
          if (diskEntry.mode) (s as any).mode = diskEntry.mode;
          if (diskEntry.agentId) (s as any).agentId = diskEntry.agentId;
          if (diskEntry.agentOverrides) (s as any).agentOverrides = diskEntry.agentOverrides;
          if (diskEntry.workingDir) { (s as any).workingDir = diskEntry.workingDir; this.#cwdOverride.set(key, diskEntry.workingDir); }
        }
      }
    } catch {}
    const pi = this.#active.get(key);
    let model: string | undefined;
    let thinkingLevel: string | undefined;
    let availableThinkingLevels: string[] = ["off"];
    let mode: string = s?.mode || "plan";
    if (pi) {
      try { model = pi.model?.id; } catch {}
      try { thinkingLevel = pi.thinkingLevel; } catch {}
      try { availableThinkingLevels = pi.getAvailableThinkingLevels?.() || ["off"]; } catch { availableThinkingLevels = ["off"]; }
    } else {
      model = s?.model;
      thinkingLevel = s?.thinkingLevel;
      availableThinkingLevels = ["off", "low", "medium", "high"];
    }
    return { model, thinkingLevel, availableThinkingLevels, mode, agentId: (s as any)?.agentId, agentOverrides: (s as any)?.agentOverrides || {}, workingDir: this.#cwdOverride.get(key) || '', label: s?.label, fallbackModels: (s as any)?.fallbackModels || [] };
  }

  setSessionFallbacks(key: string, models: string[]): { ok: boolean } {
    const s = this.#entries.get(key);
    if (!s) return { ok: false };
    (s as any).fallbackModels = Array.isArray(models) ? models.filter(Boolean).slice(0, 8) : [];
    this.#save();
    this.#writeSessionPrefs(key);
    this.logDebug("set-session-fallbacks", { sessionKey: key, list: (s as any).fallbackModels });
    return { ok: true };
  }

  getOllamaThinkingLevels(key: string): { piLevels: string[]; ollamaLevels: { pi: string; ollama: string }[] } {
    return this.#computeOllamaLevels(key);
  }

  #computeOllamaLevels(key: string): { piLevels: string[]; ollamaLevels: { pi: string; ollama: string }[] } {
    const s = this.#entries.get(key);
    const pi = this.#active.get(key);
    let piLevels: string[] = ["off"];
    let ollamaLevels: { pi: string; ollama: string }[] = [];
    let source: "pi-sdk" | "probe" | "fallback" = "fallback";

    if (pi) {
      try { piLevels = pi.getAvailableThinkingLevels?.() || ["off"]; } catch { piLevels = ["off"]; }
      try {
        const map = (pi.model as any)?.thinkingLevelMap;
        if (map) {
          ollamaLevels = piLevels.map((l: string) => {
            const mapped = map[l];
            return mapped ? { pi: l, ollama: mapped } : null;
          }).filter(Boolean) as { pi: string; ollama: string }[];
          if (ollamaLevels.length) source = "pi-sdk";
          // REGOLA UNIVERSALE (04 set): xhigh = il MASSIMO che il provider accetta.
          // 1) caps (thinking-caps.json) AUTORITATIVE se esistono (chiave host/modelId)
          // 2) altrimenti il massimo della mappa con rank robusto (sconosciuti > noti,
          //    tie-break sull'ultimo annunciato) — niente order fisso che schiaccia
          //    livelli nuovi (es. "mega" finiva sotto "high").
          try {
            const vals = Object.values(map).filter((v: any) => typeof v === "string" && v !== "none" && v !== "false");
            let highest = vals.length ? vals[0] : null;
            let bestRank = -Infinity;
            for (let vi = 0; vi < vals.length; vi++) {
              const r = rankLevelVal(vals[vi]);
              if (r >= bestRank) { highest = vals[vi]; bestRank = r; }
            }
            const mBase2 = String((pi.model as any)?.baseUrl || "");
            let capsMax: string | null = null;
            try {
              const caps = JSON.parse(fs.readFileSync(path.join(process.env.HOME || "", ".quinki", "thinking-caps.json"), "utf8") || "{}");
              const capKey2 = (() => { try { return new URL(mBase2).host + "/" + (pi.model as any).id; } catch { return (pi.model as any)?.id; } })();
              capsMax = caps[capKey2]?.maxLevel ?? null;
            } catch {}
            const target = capsMax || highest;
            if (target && map.xhigh !== target) {
              (pi.model as any).thinkingLevelMap = { ...map, xhigh: target };
              this.logDebug("thinking-map-xhigh-fix", { model: (pi.model as any)?.id, was: map.xhigh, now: target, capsMax, note: "xhigh = sempre il massimo reale del provider (caps > mappa)" });
            }
          } catch {}
          // === Thinking capabilities cache: AUTORITATIVE per OGNI provider/modello
          // (chiave host/modelId: es. "openrouter.ai/z-ai/glm-5.3-flash" => maxLevel
          // appreso da openrouter models API o probe). Fix 04 set: prima erano
          // applicate SOLO per Ollama → OpenRouter ignorava max e inviava high. ===
          try {
            const mBase = String((pi.model as any)?.baseUrl || "");
            const capsPath = path.join(process.env.HOME || "", ".quinki", "thinking-caps.json");
            const caps = JSON.parse(fs.readFileSync(capsPath, "utf8") || "{}");
            const capKey = (() => { try { return new URL(mBase).host + "/" + (pi.model as any).id; } catch { return (pi.model as any)?.id; } })();
            const learned = caps[capKey]?.maxLevel;
            if (learned && map.xhigh !== learned) {
              (pi.model as any).thinkingLevelMap = { ...map, xhigh: learned };
              this.logDebug("thinking-caps-applied", { model: (pi.model as any)?.id, maxLevel: learned, was: map.xhigh, provider: (pi.model as any)?.provider, note: "caps autoritative per ogni provider (fix 04 set)" });
            }
          } catch {}
        }
      } catch {}
    }

    if (!ollamaLevels.length && s?.model) {
      const modelId = this.#modelIdFromSession(s);
      const probeResult = this.#ollamaProbeResults.get(modelId);
      if (probeResult && probeResult.ollamaLevels.length) {
        piLevels = probeResult.levels.length ? probeResult.levels : piLevels;
        ollamaLevels = probeResult.ollamaLevels.map((o) => {
          const piKey = (Object.entries(probeResult.map).find(([, v]) => v === o)?.[0]) || o;
          return { pi: piKey, ollama: o };
        });
        source = "probe";
      }
    }

    if (!ollamaLevels.length) {
      piLevels = ["off", "low", "medium", "high"];
      ollamaLevels = [
        { pi: "off", ollama: "none" },
        { pi: "low", ollama: "low" },
        { pi: "medium", ollama: "medium" },
        { pi: "high", ollama: "high" },
      ];
      source = "fallback";
    }

    this.logDebug("ollama-levels-source", { key, source, piLevels, ollamaLevels });
    return { piLevels, ollamaLevels };
  }

  #modelIdFromSession(s: SessionEntry): string {
    if (!s.model) return "";
    if (s.model.includes("/")) return s.model.split("/").slice(1).join("/");
    return s.model;
  }

  async verifyThinking(modelId: string, level: string): Promise<{
    accepted: boolean;
    thinking_length: number;
    response_length: number;
    duration_ms: number;
    ollama_value: string;
    error?: string;
  }> {
    const ollamaLevel = level === "off" ? "false" : level;
    const start = Date.now();
    this.logDebug("verify-thinking", { modelId, requestedLevel: level, ollamaLevel, start });
    try {
      const res = await fetch(`${this.#ollamaBaseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, prompt: ".", think: ollamaLevel, stream: false }),
        signal: AbortSignal.timeout(90000),
      });
      const duration_ms = Date.now() - start;
      if (!res.ok) {
        const out = { accepted: false, thinking_length: 0, response_length: 0, duration_ms, ollama_value: ollamaLevel, error: `HTTP ${res.status}` };
        this.logDebug("verify-thinking", { modelId, requestedLevel: level, ...out });
        return out;
      }
      const text = await res.text();
      const hasError = text.includes('"error"');
      if (hasError) {
        const out = { accepted: false, thinking_length: 0, response_length: 0, duration_ms, ollama_value: ollamaLevel, error: "response contains error" };
        this.logDebug("verify-thinking", { modelId, requestedLevel: level, ...out });
        return out;
      }
      let thinking_length = 0;
      let response_length = 0;
      try {
        const data = JSON.parse(text);
        thinking_length = (data.thinking || "").length;
        response_length = (data.response || "").length;
      } catch {}
      const out = { accepted: true, thinking_length, response_length, duration_ms, ollama_value: ollamaLevel };
      this.logDebug("verify-thinking", { modelId, requestedLevel: level, ...out });
      return out;
    } catch (e: any) {
      const duration_ms = Date.now() - start;
      const out = { accepted: false, thinking_length: 0, response_length: 0, duration_ms, ollama_value: ollamaLevel, error: e?.message || String(e) };
      this.logDebug("verify-thinking", { modelId, requestedLevel: level, ...out });
      return out;
    }
  }

  getContextUsage(key: string): { tokens: number | null; contextWindow: number; percent: number | null } | null {
    // Cross-sidecar: rilegge il file condiviso (main ↔ App Expert) così i due processi
    // mostrano lo STESSO contesto per la stessa sessione, non lo stato stale del proprio sidecar.
    try { this.#loadContextUsage(); } catch {}
    const pi = this.#active.get(key);
    if (pi) {
      try {
        const u = pi.getContextUsage?.();
        if (u && typeof u.contextWindow === "number" && u.contextWindow > 0) {
          const s = this.#entries.get(key);
          const prev = this.#contextUsage.get(key);
          // Preserva l'ultimo tokens/percent REALE: il SDK a volte ritorna null (non sovrascrivere)
          const realTokens = u.tokens ?? prev?.tokens ?? null;
          const realPercent = u.percent ?? (realTokens != null && u.contextWindow > 0 ? (realTokens / u.contextWindow) * 100 : (prev?.percent ?? null));
          const stored = { tokens: realTokens, contextWindow: u.contextWindow ?? 0, percent: realPercent, model: s?.model, input: prev?.input || 0, output: prev?.output || 0, ts: Date.now() };
          // === FASE 0+B16: log diagnostico per context usage ===
          this.logDebug("context-usage-computed", {
            sessionKey: key,
            modelId: s?.model,
            tokens: stored.tokens,
            contextWindow: stored.contextWindow,
            percent: stored.percent,
            source: "pi-agent",
          });
          this.#contextUsage.set(key, stored);
          this.#saveContextUsage();
          return { tokens: stored.tokens, contextWindow: stored.contextWindow, percent: stored.percent, input: stored.input, output: stored.output };
        }
      } catch {}
    }
    const s = this.#entries.get(key);
    if (s?.model) {
      const modelId = this.#modelIdFromSession(s);
      const info = this.#ollamaModelInfoCache.get(modelId);
      if (info?.contextLength) {
        const cached = this.#contextUsage.get(key);
        const tokens = cached?.tokens ?? null;
        const percent = tokens != null ? (tokens / info.contextLength) * 100 : null;
        this.logDebug("context-usage-computed", { sessionKey: key, modelId, tokens, contextWindow: info.contextLength, percent, source: "ollama-probe" });
        return { tokens, contextWindow: info.contextLength, percent, input: (cached as any)?.input || 0, output: (cached as any)?.output || 0 };
      }
      // Fallback: se Ollama non ha restituito context_length, usa models.json
      const models = readModelsFromDisk();
      const m = models.find(x => x.id === modelId);
      if (m?.contextWindow) {
        const cached = this.#contextUsage.get(key);
        const tokens = cached?.tokens ?? null;
        const percent = tokens != null ? (tokens / m.contextWindow) * 100 : null;
        this.logDebug("context-usage-computed", { sessionKey: key, modelId, tokens, contextWindow: m.contextWindow, percent, source: "models-json-fallback" });
        return { tokens, contextWindow: m.contextWindow, percent, input: (cached as any)?.input || 0, output: (cached as any)?.output || 0 };
      }
    }
    const cached = this.#contextUsage.get(key);
    if (cached && cached.contextWindow > 0) {
      this.logDebug("context-usage-computed", { sessionKey: key, modelId: cached.model, tokens: cached.tokens, contextWindow: cached.contextWindow, percent: cached.percent, source: "persisted" });
      return { tokens: cached.tokens, contextWindow: cached.contextWindow, percent: cached.percent, input: (cached as any).input || 0, output: (cached as any).output || 0 };
    }
    return null;
  }

  getAllContextUsage(): Record<string, { tokens: number | null; contextWindow: number; percent: number | null; model?: string; ts: number }> {
    const out: Record<string, any> = {};
    for (const [k, v] of this.#contextUsage) out[k] = v;
    return out;
  }

  // === Fix 9/B11: ritorna le sessioni attualmente in streaming (hanno agent attivo) ===
  getStreamingSessionKeys(): string[] {
    return Array.from(this.#active.keys());
  }

  // === B4 POOL: stato per lo shrink del router (child idle → kill) ===
  getPoolStatus(): { active: number; streaming: number } {
    return { active: this.#active.size, streaming: this.#streamingBuffers.size };
  }

  // === Multi-window: ritorna il messaggio in streaming corrente (contenuto parziale + fase) ===
  getStreamingMessage(key: string): any | null {
    const buf = this.#streamingBuffers.get(key);
    if (!buf) return null;
    return {
      sessionKey: key,
      messageId: buf.messageId,
      text: buf.text,
      thinking: buf.thinking,
      toolCalls: buf.toolCalls,
      currentPhase: buf.currentPhase,
      model: buf.model,
      thinkingLevel: buf.thinkingLevel,
    };
  }

  // === Step 3c: ritorna la sessione attiva (per leggere system prompt) ===
  getActiveSession(key: string): any {
    return this.#active.get(key) ?? undefined;
  }

  // === Query contextWindow di un modello. Stessa fonte usata dalla chat attiva (pi.getContextUsage → model.contextWindow). ===
  // Ordine di priorità:
  //   1. Cache interna (#modelContextCache) per evitare lookup ripetuti
  //   2. ModelRegistry di Pi SDK (legge da models.json come fa la chat attiva) → identico alla chat
  //   3. Ollama cache (#ollamaModelInfoCache) per modelli locali
  //   4. Live fetch Ollama /api/show per modelli locali
  //   5. Fetch diretto dal provider (OpenRouter /api/v1/models) per provider non-Ollama
  //   6. models.json fallback
  async getModelContext(modelId: string): Promise<{ contextWindow: number; source: "model-registry" | "ollama-cache" | "ollama-live" | "provider-fetch" | "models-json" | "unknown" }> {
    if (!modelId) return { contextWindow: 0, source: "unknown" };

    // 1. Cache interna
    const cached = this.#modelContextCache.get(modelId);
    if (cached && Date.now() - cached.ts < 60000) {
      return { contextWindow: cached.contextWindow, source: cached.source as any };
    }

    // 2. ModelRegistry di Pi SDK — STESSA FONTE della chat attiva
    if (this.#modelRegistry) {
      try {
        // Prova ogni provider conosciuto
        const allModels = this.#modelRegistry.getAll?.() || [];
        for (const m of allModels) {
          if (m.id === modelId && typeof m.contextWindow === "number" && m.contextWindow > 0) {
            this.#modelContextCache.set(modelId, { contextWindow: m.contextWindow, source: "model-registry", ts: Date.now() });
            this.logDebug("model-context-source", { modelId, source: "model-registry", contextWindow: m.contextWindow, provider: m.provider });
            return { contextWindow: m.contextWindow, source: "model-registry" };
          }
        }
      } catch (e: any) {
        this.logDebug("model-registry-find-error", { modelId, error: e?.message });
      }
    }

    // 3. Ollama cache (modelli locali)
    const ollamaCached = this.#ollamaModelInfoCache.get(modelId);
    if (ollamaCached && ollamaCached.contextLength > 0) {
      this.#modelContextCache.set(modelId, { contextWindow: ollamaCached.contextLength, source: "ollama-cache", ts: Date.now() });
      this.logDebug("model-context-source", { modelId, source: "ollama-cache", contextWindow: ollamaCached.contextLength });
      return { contextWindow: ollamaCached.contextLength, source: "ollama-cache" };
    }

    // 4. Live fetch Ollama /api/show (funziona anche per modelli :cloud)
    if (!modelId.includes("/")) {
      try {
        const res = await fetch(`${this.#ollamaBaseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelId, verbose: true }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = (await res.json()) as { model_info?: Record<string, number> };
          for (const [k, v] of Object.entries(data.model_info || {})) {
            if (k.endsWith(".context_length") && typeof v === "number" && v > 0) {
              this.#modelContextCache.set(modelId, { contextWindow: v, source: "ollama-live", ts: Date.now() });
              this.logDebug("model-context-source", { modelId, source: "ollama-live", contextWindow: v });
              return { contextWindow: v, source: "ollama-live" };
            }
          }
        }
      } catch (e) {
        this.logDebug("model-context-fetch-error", { modelId, error: String(e) });
      }
    }

    // 5. Fetch diretto dal provider (OpenRouter /api/v1/models) per provider non-Ollama
    if (modelId.includes("/")) {
      try {
        const providers = readProvidersConfig();
        // Cerca provider che contiene questo modello
        for (const [provName, pcfg] of Object.entries(providers.providers)) {
          if (!pcfg.enabled || !pcfg.apiKey) continue;
          try {
            const headers: Record<string, string> = {};
            if (pcfg.apiKey) headers["Authorization"] = `Bearer ${decryptString(pcfg.apiKey)}`;
            const url = `${pcfg.baseUrl.replace(/\/+$/, "")}/models`;
            const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
            if (res.ok) {
              const data = (await res.json()) as { data?: Array<{ id: string; context_length?: number }> };
              const found = (data.data || []).find((m) => m.id === modelId || m.id === modelId.split("/").slice(1).join("/"));
              if (found && typeof found.context_length === "number" && found.context_length > 0) {
                this.#modelContextCache.set(modelId, { contextWindow: found.context_length, source: "provider-fetch", ts: Date.now() });
                this.logDebug("model-context-source", { modelId, source: "provider-fetch", contextWindow: found.context_length, provider: provName });
                return { contextWindow: found.context_length, source: "provider-fetch" };
              }
            }
          } catch {}
        }
      } catch (e) {
        this.logDebug("provider-fetch-error", { modelId, error: String(e) });
      }
    }

    // 6. Fallback finale a models.json
    try {
      const models = readModelsFromDisk();
      const m = models.find((x) => x.id === modelId);
      if (m?.contextWindow && m.contextWindow > 0) {
        this.#modelContextCache.set(modelId, { contextWindow: m.contextWindow, source: "models-json", ts: Date.now() });
        this.logDebug("model-context-source", { modelId, source: "models-json", contextWindow: m.contextWindow });
        return { contextWindow: m.contextWindow, source: "models-json" };
      }
    } catch {}

    this.logDebug("model-context-source", { modelId, source: "unknown", contextWindow: 0 });
    return { contextWindow: 0, source: "unknown" };
  }

  // === SYNC CONTEXT LENGTHS da tutti i provider enabled ===
  // Scopo: aggiornare ~/.pi/agent/models.json con i contextWindow reali di ogni modello,
  // in modo che welcome composer e chat attiva leggano dalla STESSA fonte (sempre aggiornata).
  // Best-effort: se una query fallisce, i modelli non aggiornati mantengono il valore esistente.
  // Riusa #ollamaModelInfoCache per Ollama (già popolata da /api/tags + /api/show al boot).
  async #syncAllContextLengths(): Promise<void> {
    this.logDebug("sync-all-start", { ollamaModels: Array.from(this.#ollamaModelInfoCache.keys()) });
    const allUpdates = new Map<string, number>();

    // 1. Ollama: riusa cache esistente + live fetch per modelli non in cache
    try {
      const ollamaUpdates = await this.#syncOllamaContextLengths();
      for (const [k, v] of ollamaUpdates) allUpdates.set(k, v);
    } catch (e) {
      this.logDebug("sync-ollama-error", { error: String(e) });
    }

    // 2. Tutti gli altri provider da quinki-providers.json
    try {
      const providers = readProvidersConfig();
      for (const [name, pcfg] of Object.entries(providers.providers)) {
        if (!pcfg.enabled) continue;
        if (name.toLowerCase() === "ollama") continue; // già fatto
        try {
          const updates = await this.#syncProviderContextLengths(name, pcfg);
          for (const [k, v] of updates) allUpdates.set(k, v);
        } catch (e) {
          this.logDebug(`sync-provider-${name}-error`, { error: String(e) });
        }
      }
    } catch (e) {
      this.logDebug("sync-providers-read-error", { error: String(e) });
    }

    // 3. Applica update a models.json solo se ci sono modifiche
    if (allUpdates.size > 0) {
      const changed = this.#writeModelsJsonIfChanged(allUpdates);
      if (changed) {
        // Ricarica ModelRegistry per riflettere i nuovi contextWindow
        try {
          this.#modelRegistry?.refresh?.();
          this.logDebug("sync-registry-refreshed", {});
        } catch (e) {
          this.logDebug("sync-registry-refresh-error", { error: String(e) });
        }
        this.logDebug("sync-context-applied", { count: allUpdates.size, models: Array.from(allUpdates.keys()) });
      } else {
        this.logDebug("sync-context-no-changes", { count: allUpdates.size });
      }
    } else {
      this.logDebug("sync-context-no-updates", {});
    }
  }

  // === Sync Ollama: riusa cache esistente (#ollamaModelInfoCache) + live fetch per modelli mancanti ===
  // Itera su tutti i modelli Ollama in models.json. Se un modello è nella cache, usa il context reale.
  // Altrimenti tenta una live fetch /api/show con timeout breve.
  async #syncOllamaContextLengths(): Promise<Map<string, number>> {
    const updates = new Map<string, number>();
    let modelsJson: any = null;
    try {
      const modelsPath = path.join(this.#agentDir, "models.json");
      if (!fs.existsSync(modelsPath)) return updates;
      modelsJson = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    } catch (e) {
      this.logDebug("sync-ollama-read-error", { error: String(e) });
      return updates;
    }
    // Find Ollama provider by base URL (not by name — works after rename)
    let ollamaModels: any[] = [];
    for (const [pname, pinfo] of Object.entries(modelsJson?.providers || {})) {
      const p = pinfo as any;
      if (pname.toLowerCase() === 'ollama' || (p.baseUrl || '').includes('11434')) {
        ollamaModels = p.models || [];
        break;
      }
    }
    if (ollamaModels.length === 0) {
      this.logDebug("sync-ollama-no-models", {});
      return updates;
    }
    this.logDebug("sync-ollama-models-found", { count: ollamaModels.length, models: ollamaModels.map((m) => m.id) });

    for (const m of ollamaModels) {
      const modelId = m.id;
      if (!modelId) continue;
      // 1. Cache esistente
      const cached = this.#ollamaModelInfoCache.get(modelId);
      if (cached && cached.contextLength > 0) {
        if (m.contextWindow !== cached.contextLength) {
          updates.set(modelId, cached.contextLength);
          this.logDebug("sync-ollama-update", { modelId, oldValue: m.contextWindow, newValue: cached.contextLength, source: "ollama-cache" });
        }
        continue;
      }
      // 2. Live fetch /api/show (funziona anche per modelli :cloud, l'ho verificato)
      try {
        const res = await fetch(`${this.#ollamaBaseUrl}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: modelId, verbose: true }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = (await res.json()) as { model_info?: Record<string, number> };
          for (const [k, v] of Object.entries(data.model_info || {})) {
            if (k.endsWith(".context_length") && typeof v === "number" && v > 0) {
              if (m.contextWindow !== v) {
                updates.set(modelId, v);
                this.logDebug("sync-ollama-update", { modelId, oldValue: m.contextWindow, newValue: v, source: "ollama-live" });
              }
              // Aggiorna anche la cache per usi futuri
              this.#ollamaModelInfoCache.set(modelId, { contextLength: v, capabilities: [] });
              break;
            }
          }
        }
      } catch (e) {
        this.logDebug("sync-ollama-fetch-error", { modelId, error: String(e) });
        // Non bloccare: passa al prossimo modello
      }
    }
    return updates;
  }

  // === Sync provider generico (OpenRouter, custom, ecc.) ===
  // Fa una query a {baseUrl}/models con auth header, matcha per ID, ritorna update map.
  // Ritorna Map vuota se la query fallisce o nessun match trovato.
  async #syncProviderContextLengths(providerName: string, pcfg: any): Promise<Map<string, number>> {
    const updates = new Map<string, number>();
    if (!pcfg.baseUrl) {
      this.logDebug(`sync-provider-${providerName}-no-baseurl`, {});
      return updates;
    }
    // Lista modelli del provider in models.json
    let modelsJson: any = null;
    try {
      const modelsPath = path.join(this.#agentDir, "models.json");
      if (!fs.existsSync(modelsPath)) return updates;
      modelsJson = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    } catch (e) {
      this.logDebug(`sync-provider-${providerName}-read-error`, { error: String(e) });
      return updates;
    }
    const providerModels: any[] = modelsJson?.providers?.[providerName]?.models || [];
    if (providerModels.length === 0) {
      this.logDebug(`sync-provider-${providerName}-no-models`, {});
      return updates;
    }
    this.logDebug(`sync-provider-${providerName}-models-found`, { count: providerModels.length, models: providerModels.map((m) => m.id) });

    // Query al provider
    let remoteModels: Array<{ id: string; context_length?: number }> = [];
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (pcfg.apiKey) {
        const apiKey = pcfg.apiKey.startsWith("enc:v1:") ? decryptString(pcfg.apiKey) : pcfg.apiKey;
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      }
      const url = `${pcfg.baseUrl.replace(/\/+$/, "")}/models`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string; context_length?: number }> };
        remoteModels = data.data || [];
        this.logDebug(`sync-provider-${providerName}-remote-fetched`, { count: remoteModels.length });
      } else {
        this.logDebug(`sync-provider-${providerName}-http-error`, { status: res.status });
        return updates;
      }
    } catch (e) {
      this.logDebug(`sync-provider-${providerName}-fetch-error`, { error: String(e) });
      return updates;
    }

    // Match per ID: varianti supportate
    const remoteByIdLower = new Map<string, number>();
    for (const r of remoteModels) {
      if (r.id && typeof r.context_length === "number" && r.context_length > 0) {
        remoteByIdLower.set(r.id.toLowerCase(), r.context_length);
        // Anche senza prefisso provider (es. "anthropic/claude-sonnet-4" → "claude-sonnet-4")
        const withoutPrefix = r.id.includes("/") ? r.id.split("/").slice(1).join("/").toLowerCase() : r.id.toLowerCase();
        if (!remoteByIdLower.has(withoutPrefix)) {
          remoteByIdLower.set(withoutPrefix, r.context_length);
        }
      }
    }

    for (const m of providerModels) {
      const modelId = m.id;
      if (!modelId) continue;
      const candidates = [modelId.toLowerCase()];
      if (modelId.includes("/")) candidates.push(modelId.split("/").slice(1).join("/").toLowerCase());
      for (const c of candidates) {
        const realCw = remoteByIdLower.get(c);
        if (realCw && m.contextWindow !== realCw) {
          updates.set(modelId, realCw);
          this.logDebug(`sync-provider-${providerName}-update`, { modelId, oldValue: m.contextWindow, newValue: realCw });
          break;
        }
      }
    }
    return updates;
  }

  // === Scrive models.json con gli update SOLO se almeno un campo è cambiato ===
  // Ritorna true se ha scritto, false altrimenti.
  #writeModelsJsonIfChanged(updates: Map<string, number>): boolean {
    if (updates.size === 0) return false;
    try {
      const modelsPath = path.join(this.#agentDir, "models.json");
      if (!fs.existsSync(modelsPath)) return false;
      const modelsJson = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
      let changed = false;
      for (const [modelId, newCw] of updates) {
        // Cerca il modello in tutti i provider
        for (const provName of Object.keys(modelsJson.providers || {})) {
          const arr: any[] = modelsJson.providers[provName]?.models || [];
          const m = arr.find((mm) => mm.id === modelId);
          if (m) {
            if (m.contextWindow !== newCw) {
              m.contextWindow = newCw;
              changed = true;
            }
            break;
          }
        }
      }
      if (changed) {
        fs.writeFileSync(modelsPath, JSON.stringify(modelsJson, null, 2), "utf8");
        try { fs.chmodSync(modelsPath, 0o600); } catch {}
        this.logDebug("sync-modelsjson-written", { path: modelsPath, updates: updates.size });
      }
      return changed;
    } catch (e) {
      this.logDebug("sync-modelsjson-write-error", { error: String(e) });
      return false;
    }
  }

  // === Hook pubblico per triggerare sync di un provider dopo setProvidersConfig ===
  // Chiamato dal codice di providers o da IPC dopo che l'utente salva un provider.
  async syncProviderContextLengthsNow(providerName: string): Promise<{ updated: number }> {
    const updates = new Map<string, number>();
    try {
      const providers = readProvidersConfig();
      const pcfg = providers.providers[providerName];
      if (!pcfg) return { updated: 0 };
      if (providerName.toLowerCase() === "ollama") {
        const o = await this.#syncOllamaContextLengths();
        for (const [k, v] of o) updates.set(k, v);
      } else {
        const u = await this.#syncProviderContextLengths(providerName, pcfg);
        for (const [k, v] of u) updates.set(k, v);
      }
      if (updates.size > 0) {
        this.#writeModelsJsonIfChanged(updates);
        try { this.#modelRegistry?.refresh?.(); } catch {}
      }
    } catch (e) {
      this.logDebug("sync-provider-now-error", { providerName, error: String(e) });
    }
    return { updated: updates.size };
  }

  async setModel(key: string, modelId: string): Promise<boolean> {
    const prevModel = this.#entries.get(key)?.model;
    this.logDebug("set-model", { sessionKey: key, prevModel, newModel: modelId });
    // FIX F8 (02 set): VALIDAZIONE PRIMA della scrittura — prima il modello veniva
    // scritto+persistito e SOLO POI validato → sessione avvelenata senza rollback
    // (un click su un modello inesistente distruggeva la chat al prossimo riavvio).
    try {
      const authPath0 = path.join(this.#agentDir, "auth.json");
      const modelsPath0 = path.join(this.#agentDir, "models.json");
      const registry0 = await this.#createRegistry();
      const found0 = this.#findModelInRegistry(registry0, modelId);
      if (!found0) {
        this.logDebug("set-model-rejected-before-write", { sessionKey: key, model: modelId });
        return false;
      }
    } catch { /* registry illeggibile: non blocchiamo (comportamento precedente) */ }
    // UNIVERSAL CAPS (29 ago): al cambio modello, riempi la cache in background
    // (thinking + vision del NUOVO modello) — l'utente non paga il costo di scoperta.
    probeSingleModelCaps(modelId).catch(() => {});
    const s = this.#entries.get(key);
    if (s) { s.model = modelId; this.#save(); this.#writeSessionPrefs(key); }
    // === B16: reset context usage al cambio modello ===
    if (prevModel && prevModel !== modelId) {
      this.logDebug("set-model-reset-context-usage", { sessionKey: key, prevModel, newModel: modelId });
      this.#contextUsage.delete(key);
      this.#saveContextUsage();
    }
    this.#logThinkingLevelIntent(key);
    const pi = this.#active.get(key);
    if (!pi) {
      this.#pendingModels.set(key, modelId);
      return true;
    }
    try {
      const authPath = path.join(this.#agentDir, "auth.json");
      const modelsPath = path.join(this.#agentDir, "models.json");
      const registry = await this.#createRegistry();
      const model = this.#findModelInRegistry(registry, modelId);
      if (model) {
        // === B16: log del contextWindow del nuovo modello ===
        this.logDebug("set-model-new-context", { sessionKey: key, newModel: modelId, newContextWindow: model.contextWindow, provider: model.provider });
        await pi.setModel(model);
        // === Fix 11: ripristinare system prompt minimale dopo setModel (che lo ricostruisce) ===
        try {
          pi.agent.state.systemPrompt = "quinki";
          this.logDebug("set-model-system-prompt-restored", { sessionKey: key });
        } catch (e: any) {
          this.logDebug("set-model-system-prompt-restore-error", { sessionKey: key, error: e?.message });
        }
        return true;
      }
    } catch (e: any) {
      this.logDebug("set-model-error", { sessionKey: key, modelId, error: e?.message || String(e) });
    }
    return false;
  }

  getThinkingLevels(key: string): string[] {
    const pi = this.#active.get(key);
    if (!pi) return ["off", "low", "medium", "high"];
    try { return pi.getAvailableThinkingLevels?.() || ["off", "low", "medium", "high"]; } catch { return ["off", "low", "medium", "high"]; }
  }

  setThinkingLevel(key: string, level: string) {
    const s = this.#entries.get(key);
    this.logDebug("set-thinking", { sessionKey: key, level: String(level), levelType: typeof level, entryFound: !!s, prevLevel: s?.thinkingLevel ?? null });
    const pi = this.#active.get(key);
    if (!pi) {
      // === Map "on" to a real level before pending ===
      if (level === 'on') level = pickDefaultThinkingLevel();
      if (s) { s.thinkingLevel = level; this.#save(); this.#writeSessionPrefs(key); }
      this.#pendingThinking.set(key, level);
      this.logDebug("set-thinking-pending", { sessionKey: key, level });
      this.#logThinkingMapResolved(key, level, null);
      return;
    }
    try {
      const piModel = (() => { try { return pi.model?.id; } catch { return undefined; } })();
      const piReasoning = (() => { try { return pi.model?.reasoning; } catch { return undefined; } })();
      const piAvailable = (() => { try { return pi.getAvailableThinkingLevels?.(); } catch { return undefined; } })();
      this.logDebug("set-thinking-pi-state", { sessionKey: key, piModel, piReasoning, piAvailable, requested: level });
      // === Map "on" to a real thinking level (Pi SDK doesn't accept "on") ===
      let actualLevel = level;
      if (level === 'on') {
        const currentPi = (() => { try { return pi.thinkingLevel; } catch { return undefined; } })();
        if (currentPi && currentPi !== 'off') {
          actualLevel = currentPi;
        } else {
          const defaultLevel = pickDefaultThinkingLevel();
          const avail = piAvailable || ['off', 'low', 'medium', 'high', 'xhigh'];
          actualLevel = avail.includes(defaultLevel) ? defaultLevel : (avail.filter(l => l !== 'off').pop() || 'medium');
        }
      }
      pi.setThinkingLevel(actualLevel);
      const actual = (() => { try { return pi.thinkingLevel; } catch { return actualLevel; } })();
      const accepted = actual === actualLevel;
      this.logDebug("set-thinking-applied", { sessionKey: key, requested: level, resolvedTo: actualLevel, actual, accepted });
      this.logDebug("post-set-thinking-state", { sessionKey: key, requested: level, resolvedTo: actualLevel, pi_thinking_level: actual, s_thinking_level: s?.thinkingLevel, accepted, note: accepted ? "ok" : "pi-thinks-ignored-keeping-user-intent" });
      this.#logThinkingMapResolved(key, actualLevel, piModel ? (() => { try { return (pi.model as any)?.thinkingLevelMap; } catch { return null; } })() : null);
      if (s) {
        s.thinkingLevel = actualLevel;
        this.#save();
        this.logDebug("set-thinking-saved", { sessionKey: key, requested: level, resolvedTo: actualLevel, savedAs: s.thinkingLevel, accepted, note: accepted ? "pi-thinks-applied" : "pi-thinks-ignored-keeping-user-intent" });
      }
      if (!accepted) {
        this.#sendToWs(this.#wss.get(key), { type: "thinking_updated", sessionKey: key, level: actualLevel, requested: level, accepted: false, note: "pi-thinks-ignored-keeping-user-intent" });
      }
    } catch (e: any) { this.logDebug("set-thinking-error", { sessionKey: key, error: e?.message }); }
  }

  #logThinkingMapResolved(key: string, requested: string, map: Record<string, string> | null) {
    const resolved = map ? (map[requested] ?? null) : null;
    this.logDebug("thinking-map-resolved", {
      sessionKey: key,
      requested,
      mapKey: requested,
      mapValue: resolved,
      ollamaWillReceive: resolved ?? (requested === "off" ? "false" : requested),
      map,
      note: resolved
        ? `Thinking level MAXIMUM: sent to the provider as "${resolved}" (your choice: ${requested})`
        : "No map translation; Pi SDK will use raw value or Ollama may ignore",
    });
  }

  #logThinkingLevelIntent(key: string) {
    const s = this.#entries.get(key);
    if (!s) return;
    const modelId = this.#modelIdFromSession(s);
    const probe = this.#ollamaProbeResults.get(modelId);
    const map = probe ? (Object.fromEntries(Object.entries(probe.map || {}).map(([k, v]) => [k, v])) as Record<string, string>) : null;
    const savedLevel = s.thinkingLevel || "off";
    const translatedOllamaValue = map ? (map[savedLevel] ?? null) : null;
    this.logDebug("thinking-level-intent", {
      sessionKey: key,
      model: modelId,
      savedThinkingLevel: savedLevel,
      thinkingLevelMap: map,
      translatedOllamaValue,
      ollamaWillReceive: translatedOllamaValue ?? (savedLevel === "off" ? "false" : savedLevel),
      note: translatedOllamaValue
        ? `Your choice: ${savedLevel} → sent to the provider as "${translatedOllamaValue}" (the provider's maximum)`
        : "No map found; check models.json thinkingLevelMap",
    });
  }

  #computeProviderHttpIntent(modelId: string, level: string): {
    providerName: string;
    providerFormat: string;
    thinkingEnabled: boolean;
    httpParamName: string;
    httpParamValue: any;
    ollamaNativeValue: string | null;
    mapOffValue: string | null;
    additionalHttpParam?: any;
    note: string;
  } | null {
    try {
      const modelsPath = path.join(_agentDir, "models.json");
      if (!fs.existsSync(modelsPath)) return null;
      const data = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
      const providers = data.providers || {};
      let foundModel: any = null;
      let foundProviderName: string | null = null;
      for (const [pname, pdata] of Object.entries(providers)) {
        const models = (pdata as any).models || [];
        const m = models.find((mm: any) => mm.id === modelId);
        if (m) { foundModel = m; foundProviderName = pname; break; }
      }
      if (!foundModel || !foundProviderName) return null;
      const providerData = providers[foundProviderName];
      const compat = providerData.compat || {};
      const format = compat.thinkingFormat || "openai-fallback";
      const map = (foundModel.thinkingLevelMap || {}) as Record<string, string>;
      const isOff = level === "off" || level === undefined;
      const supportsReasoning = compat.supportsReasoningEffort !== false && foundModel.reasoning;

      const baseOffValue = map["off"] ?? null;
      const translatedLevel = isOff ? null : (map[level] ?? null);

      if (format === "deepseek") {
        if (isOff) {
          return {
            providerName: foundProviderName,
            providerFormat: "deepseek",
            thinkingEnabled: false,
            httpParamName: "thinking",
            httpParamValue: { type: "disabled" },
            ollamaNativeValue: baseOffValue ?? "false",
            mapOffValue: baseOffValue,
            note: supportsReasoning
              ? `Pi SDK will send thinking.type=disabled to ${foundProviderName}; model will NOT think`
              : `Pi SDK will send thinking.type=disabled to ${foundProviderName}`,
          };
        }
        return {
          providerName: foundProviderName,
          providerFormat: "deepseek",
          thinkingEnabled: true,
          httpParamName: "reasoning_effort",
          httpParamValue: translatedLevel ?? level,
          ollamaNativeValue: translatedLevel ?? level,
          mapOffValue: baseOffValue,
          additionalHttpParam: { thinking: { type: "enabled" } },
          note: `Pi SDK will send reasoning_effort=${translatedLevel ?? level} to ${foundProviderName} based on thinkingLevelMap.${level}=${translatedLevel ?? "(unmapped)"}`,
        };
      }

      if (format === "zai" || format === "qwen") {
        return {
          providerName: foundProviderName,
          providerFormat: format,
          thinkingEnabled: !isOff,
          httpParamName: "enable_thinking",
          httpParamValue: isOff ? false : true,
          ollamaNativeValue: null,
          mapOffValue: baseOffValue,
          note: `Pi SDK will send enable_thinking=${!isOff} to ${foundProviderName}`,
        };
      }

      if (format === "qwen-chat-template") {
        return {
          providerName: foundProviderName,
          providerFormat: format,
          thinkingEnabled: !isOff,
          httpParamName: "chat_template_kwargs.enable_thinking",
          httpParamValue: isOff ? false : true,
          ollamaNativeValue: null,
          mapOffValue: baseOffValue,
          note: `Pi SDK will send chat_template_kwargs.enable_thinking=${!isOff} to ${foundProviderName}`,
        };
      }

      if (format === "openrouter") {
        if (isOff) {
          return {
            providerName: foundProviderName,
            providerFormat: "openrouter",
            thinkingEnabled: false,
            httpParamName: "reasoning.effort",
            httpParamValue: baseOffValue ?? "none",
            ollamaNativeValue: baseOffValue ?? "none",
            mapOffValue: baseOffValue,
            note: `Pi SDK will send reasoning.effort=${baseOffValue ?? "none"} to ${foundProviderName}`,
          };
        }
        return {
          providerName: foundProviderName,
          providerFormat: "openrouter",
          thinkingEnabled: true,
          httpParamName: "reasoning.effort",
          httpParamValue: translatedLevel ?? level,
          ollamaNativeValue: translatedLevel ?? level,
          mapOffValue: baseOffValue,
          note: `Pi SDK will send reasoning.effort=${translatedLevel ?? level} to ${foundProviderName} based on thinkingLevelMap.${level}=${translatedLevel ?? "(unmapped)"}`,
        };
      }

      if (format === "together") {
        return {
          providerName: foundProviderName,
          providerFormat: "together",
          thinkingEnabled: !isOff,
          httpParamName: "reasoning",
          httpParamValue: isOff
            ? { enabled: false }
            : { enabled: true, effort: translatedLevel ?? level },
          ollamaNativeValue: isOff ? null : (translatedLevel ?? level),
          mapOffValue: baseOffValue,
          note: isOff
            ? `Pi SDK will send reasoning.enabled=false to ${foundProviderName}`
            : `Pi SDK will send reasoning={enabled:true, effort:${translatedLevel ?? level}} to ${foundProviderName}`,
        };
      }

      if (format === "string-thinking") {
        if (isOff) {
          return {
            providerName: foundProviderName,
            providerFormat: "string-thinking",
            thinkingEnabled: false,
            httpParamName: "(none)",
            httpParamValue: null,
            ollamaNativeValue: null,
            mapOffValue: baseOffValue,
            note: `Pi SDK will OMIT thinking param for ${foundProviderName}`,
          };
        }
        return {
          providerName: foundProviderName,
          providerFormat: "string-thinking",
          thinkingEnabled: true,
          httpParamName: "thinking",
          httpParamValue: translatedLevel ?? level,
          ollamaNativeValue: translatedLevel ?? level,
          mapOffValue: baseOffValue,
          note: `Pi SDK will send thinking=${translatedLevel ?? level} to ${foundProviderName}`,
        };
      }

      // Fallback OpenAI-style
      if (isOff) {
        return {
          providerName: foundProviderName,
          providerFormat: format,
          thinkingEnabled: false,
          httpParamName: "reasoning_effort",
          httpParamValue: baseOffValue ?? "none",
          ollamaNativeValue: baseOffValue ?? "none",
          mapOffValue: baseOffValue,
          note: `Pi SDK will send reasoning_effort=${baseOffValue ?? "none"} to ${foundProviderName}`,
        };
      }
      return {
        providerName: foundProviderName,
        providerFormat: format,
        thinkingEnabled: true,
        httpParamName: "reasoning_effort",
        httpParamValue: translatedLevel ?? level,
        ollamaNativeValue: translatedLevel ?? level,
        mapOffValue: baseOffValue,
        note: `Pi SDK will send reasoning_effort=${translatedLevel ?? level} to ${foundProviderName} based on thinkingLevelMap.${level}=${translatedLevel ?? "(unmapped)"}`,
      };
    } catch (e: any) {
      this.logDebug("thinking-http-intent-error", { modelId, level, error: e?.message });
      return null;
    }
  }

  addUserMsg(key: string, _text: string, _msgId: string) {
    const s = this.#entries.get(key);
    if (!s) return;
    void s;
  }

  // === A2.10: injectClip — inietta un messaggio utente nella storia (clip "invia in chat") ===
  // Appende un messaggio utente alla catena della sessione (persistito nel jsonl, visibile in chat,
  // incluso nel prossimo contesto) SENZA triggerare una risposta.
  async injectClip(sessionKey: string, text: string): Promise<boolean> {
    try {
      if (!this.#active.has(sessionKey)) {
        // Sessione non attiva: attivala (come send()) così la catena è corretta
        await this.#ensureActive(sessionKey);
      }
      const pi = this.#active.get(sessionKey);
      if (pi?.sessionManager && typeof (pi.sessionManager as any)._appendEntry === 'function') {
        const entry = {
          type: "message",
          id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          parentId: (pi.sessionManager as any).leafId,
          timestamp: new Date().toISOString(),
          message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
        };
        (pi.sessionManager as any)._appendEntry(entry);
        this.logDebug("clip-injected", { sessionKey, text: text.slice(0, 120) });
        return true;
      }
      // Fallback: append diretto al jsonl (messaggio orfano ma leggibile)
      const sessionDir = this.#piSessionDir(sessionKey);
      if (fs.existsSync(sessionDir)) {
        const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
        if (files.length > 0) {
          const entry = {
            type: "message",
            id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            parentId: null,
            timestamp: new Date().toISOString(),
            message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
          };
          fs.appendFileSync(path.join(sessionDir, files[0]), JSON.stringify(entry) + "\n", "utf8");
          this.logDebug("clip-injected-fallback", { sessionKey });
          return true;
        }
      }
      return false;
    } catch (e: any) {
      this.logDebug("clip-inject-error", { sessionKey, error: e?.message || String(e) });
      return false;
    }
  }

  // === A2.11: sendHiddenUserMessage — messaggio utente NASCOSTO che TRIGGERA il modello.
  // Entra nel contesto (il modello lo vede), ma NON è visibile in chat (flag hidden:true,
  // filtrato in getHistory). Usato per le transizioni di fase Long Horizon.
  // Tecnica: wrap di _appendEntry — il prossimo messaggio utente appeso dal prompt flow
  // viene marcato hidden. Niente duplicati: il messaggio è appeso UNA volta (dal prompt flow). ===
  async sendHiddenUserMessage(sessionKey: string, text: string): Promise<boolean> {
    try {
      if (!this.#active.has(sessionKey)) {
        await this.#ensureActive(sessionKey);
      }
      const pi = this.#active.get(sessionKey);
      if (!pi?.sessionManager) return false;
      const sm = pi.sessionManager as any;
      if (typeof sm._appendEntry === 'function') {
        if (!sm._quinkiHiddenWrapped) {
          const orig = sm._appendEntry.bind(sm);
          sm._appendEntry = (entry: any) => {
            if (sm._quinkiNextHidden && entry?.type === "message" && entry?.message?.role === "user") {
              entry.message.hidden = true;
              sm._quinkiNextHidden = false;
            }
            return orig(entry);
          };
          sm._quinkiHiddenWrapped = true;
        }
        sm._quinkiNextHidden = true;
        // Rebuild del system prompt PRIMA di triggerare: la nuova fase deve essere nel contesto
        try {
          const effCwd = this.#cwdOverride.get(sessionKey) ?? (this.#entries.get(sessionKey) as any)?.workingDir ?? this.#cwd;
          const sessionMode = this.#entries.get(sessionKey)?.mode || "plan";
          const built = this.#buildSystemPrompt(sessionKey, effCwd, undefined, sessionMode, undefined, undefined, undefined);
          pi.agent.state.systemPrompt = built;
          (pi as any)._baseSystemPrompt = built;
          this.logDebug("hidden-user-system-prompt-rebuilt", { sessionKey, phase: this.#lhPhase.get(sessionKey) });
        } catch (e: any) { this.logDebug("hidden-user-sysprompt-error", { sessionKey, error: e?.message || String(e) }); }
        const { content } = await this.#buildUserMessage(text, undefined);
        await pi.sendUserMessage(content, { deliverAs: "followUp" });
        this.logDebug("hidden-user-sent", { sessionKey, text: text.slice(0, 80) });
        return true;
      }
      return false;
    } catch (e: any) {
      this.logDebug("hidden-user-send-error", { sessionKey, error: e?.message || String(e) });
      return false;
    }
  }

  // === A2.11: injectSystemMessage — messaggio di SISTEMA visibile in chat (bubble speciale)
  // ed entra nel contesto della conversazione (il modello lo vede). Hardcoded, non generato dal modello.
  async injectSystemMessage(sessionKey: string, text: string): Promise<boolean> {
    try {
      if (!this.#active.has(sessionKey)) {
        await this.#ensureActive(sessionKey);
      }
      const pi = this.#active.get(sessionKey);
      if (pi?.sessionManager && typeof (pi.sessionManager as any)._appendEntry === 'function') {
        const entry = {
          type: "message",
          id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          parentId: (pi.sessionManager as any).leafId,
          timestamp: new Date().toISOString(),
          message: { role: "system", content: [{ type: "text", text }], timestamp: Date.now() },
        };
        (pi.sessionManager as any)._appendEntry(entry);
        this.logDebug("system-message-injected", { sessionKey, text: text.slice(0, 80) });
        return true;
      }
      const sessionDir = this.#piSessionDir(sessionKey);
      if (fs.existsSync(sessionDir)) {
        const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
        if (files.length > 0) {
          const entry = {
            type: "message",
            id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            parentId: null,
            timestamp: new Date().toISOString(),
            message: { role: "system", content: [{ type: "text", text }], timestamp: Date.now() },
          };
          fs.appendFileSync(path.join(sessionDir, files[0]), JSON.stringify(entry) + "\n", "utf8");
          this.logDebug("system-message-injected-fallback", { sessionKey });
          return true;
        }
      }
      return false;
    } catch (e: any) {
      this.logDebug("system-message-inject-error", { sessionKey, error: e?.message || String(e) });
      return false;
    }
  }

  // === Attiva una sessione se non è già attiva (usato da compact() e send()) ===
  async #ensureActive(key: string, ws?: any): Promise<any> {
    let pi = this.#active.get(key);
    if (pi) return pi;

    const sessionDir = this.#piSessionDir(key);
    fs.mkdirSync(sessionDir, { recursive: true });

    const effCwdEntry = (this.#entries.get(key) as any)?.workingDir
    const effectiveCwd = this.#cwdOverride.get(key) ?? (effCwdEntry || this.#cwd);
    let sm: any;
    const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
    if (files.length > 0) {
      const sessionPath = path.join(sessionDir, files[0]);
      sm = this.#sdk.SessionManager.open(sessionPath, sessionDir, effectiveCwd);
    } else {
      sm = this.#sdk.SessionManager.create(effectiveCwd, sessionDir);
    }

    // === Expert vs normale: loader diverso (#ensureActive usato da compact) ===
    const customResourceLoader = this.#buildResourceLoader(effectiveCwd, (() => { let a = this.#resolveAgentId(key); if (a && typeof a === 'string' && a.includes(',')) { const ids = a.split(',').map(s => s.trim()).filter(Boolean); a = ids.find(id => id === 'orchestrator') || ids[0] || null; } return a; })());
    await customResourceLoader.reload();

    const result = await this.#sdk.createAgentSession({
      cwd: effectiveCwd,
      agentDir: this.#agentDir,
      sessionManager: sm,
      resourceLoader: customResourceLoader,
    });

    pi = result.session;
    try { pi.toolExecution = "sequential"; } catch {}
    // Fallback: set runtime API key from models.json
    try {
      const _modelsJson = JSON.parse(fs.readFileSync(path.join(this.#agentDir, "models.json"), "utf-8"));
      for (const [provName, pcfg] of Object.entries(_modelsJson.providers || {})) {
        const key = (pcfg as any).apiKey;
        if (key && key.length > 0) {
          let realKey = key;
          if (key.startsWith("enc:v1:")) { try { realKey = decryptString(key); } catch {} }
          try { pi.modelRegistry?.authStorage?.setRuntimeApiKey?.(provName, realKey); } catch {}
        }
      }
    } catch (e: any) { this.logDebug("fallback-apikey-error", { error: e?.message }); }
    this.#active.set(key, pi);

    // === D3 fix: leggi session entry per modello e thinking ===
    const sessionEntry = this.#entries.get(key);

    // Applica modello: pending se presente, altrimenti dalla session entry
    const pendingModel = this.#pendingModels.get(key);
    const modelToApply = pendingModel || sessionEntry?.model;
    if (pendingModel) this.#pendingModels.delete(key);
    if (modelToApply) {
      try {
        const authPath = path.join(this.#agentDir, "auth.json");
        const modelsPath = path.join(this.#agentDir, "models.json");
        const registry = await this.#createRegistry();
        const model = this.#findModelInRegistry(registry, modelToApply);
        if (model) {
          await pi.setModel(model);
          try { pi.agent.state.systemPrompt = this.#buildSystemPrompt(key, this.#cwd, undefined, sessionEntry?.mode || "plan"); } catch {}
        }
      } catch (e: any) { this.logDebug("ensureActive-model-error", { sessionKey: key, error: e?.message }); }
    }

    // Applica thinking level pendente se presente, altrimenti usa quello del session entry
    const pendingThinking = this.#pendingThinking.get(key);
    if (pendingThinking) {
      this.#pendingThinking.delete(key);
      try { pi.setThinkingLevel(pendingThinking); } catch {}
    } else {
      // Applica il thinking level dal session entry (es. "on" → xhigh)
      const savedLevel = sessionEntry?.thinkingLevel;
      if (savedLevel) {
        let level = savedLevel;
        if (level === 'on') {
          const currentPi = (() => { try { return pi.thinkingLevel; } catch { return undefined; } })();
          if (currentPi && currentPi !== 'off') {
            level = currentPi;
          } else {
            const defaultLevel = pickDefaultThinkingLevel();
            const avail = (() => { try { return pi.getAvailableThinkingLevels?.(); } catch { return undefined; } })() || ['off', 'low', 'medium', 'high', 'xhigh'];
            level = avail.includes(defaultLevel) ? defaultLevel : (avail.filter(l => l !== 'off').pop() || 'medium');
          }
        }
        try { pi.setThinkingLevel(level); } catch {}
      }
    }

    // Disattiva sempre l'auto-compaction del Pi SDK (la gestiamo noi a 80%)
    try { pi.setAutoCompactionEnabled(false); } catch {}

    // === Anti-loop: inizializza #prevCompactionFirstKept leggendo l'ultima compaction dal disco ===
    try {
      const sm = (pi as any)?.sessionManager || (pi as any)?.agent?.state?.sessionManager;
      const ents = sm?.getEntries?.() || [];
      for (let i = ents.length - 1; i >= 0; i--) {
        if ((ents[i] as any)?.type === "compaction") {
          this.#prevCompactionFirstKept.set(key, (ents[i] as any)?.firstKeptEntryId);
          break;
        }
      }
    } catch {}

    // Setup listener
    this.#listen(pi, key);

    this.logDebug("ensureActive-session-created", { sessionKey: key });
    return pi;
  }

  // === Recovery turni interrotti: se l'app è morta a metà turno, o il provider fallisce,
  // ri-prompta il modello. Salta le sessioni Long Horizon (le gestisce il support agent)
  // e le sessioni in streaming (il turno è attivo). Retry massimo 3 volte. ===
  async recoverPendingTurns(onlyKey?: string): Promise<number> {
    let recovered = 0;
    // LOCK anti-doppione (31 ago): due chiamate simultanee (on-open forward + driver 30s)
    // recuperavano la STESSA sessione 7ms dopo → doppio autoprompt → doppio badge.
    const recoveringMap: any = (this as any).__recoveringSessions || ((this as any).__recoveringSessions = new Set());
    // FIX (01 set): SERIALIZZA l'intera scansione. Il lock sotto proteggeva SOLO le
    // chiamate con onlyKey (on-open): il driver 30s (senza key) passava SEMPRE e
    // partiva in PARALLELO con l'on-open → DUE autoprompt sulla stessa sessione
    // (turni duplicati, streaming in tilt). Se uno scan è in volo si ASPETTA (max
    // 5s); dopo, il marker nextRetryAt scritto dal primo recovery impedisce il doppio.
    const waitStart = Date.now();
    while ((this as any).__recoveringScanActive && Date.now() - waitStart < 5000) {
      await new Promise((r: any) => setTimeout(r, 50));
    }
    // FIX 2026-09-08: rimosso il check — il recoveringMap non blocca più nulla
    (this as any).__recoveringScanActive = true;
    if (onlyKey) {
      recoveringMap.add(onlyKey);
    }
    try {
      const base = path.join(this.#agentDir, "sessions", "quinki");
      if (!fs.existsSync(base)) return 0;
      // Recovery SOLO della sessione aperta (on-open) o di tutte (solo se chiamato
      // esplicitamente). Mai un boot-scan di tutte le sessioni: ri-promptare chat
      // che l'utente non sta guardando era un bug (agente che rispondeva da solo).
      const streaming = new Set(this.getStreamingStatus?.() || []);
      // NB: `streaming` = TUTTE le sessioni in #active (caricate), NON solo quelle
      // con un turno in corso. Usiamo #streamingBuffers per le sessioni DAVVERO
      // in streaming — altrimenti il recovery salta sessioni appena caricate
      // (es. __app_expert__ all'apertura dell'app Expert) e non le ri-promptata.
      const isExpert = isExpertSidecar();
      for (const sk of fs.readdirSync(base)) {
        if (onlyKey && sk !== onlyKey) continue; // recovery SOLO della sessione aperta
        const p = path.join(base, sk, "pending-turn.json");
        const hasMarker = fs.existsSync(p);
        this.logDebug("recovery-scan-session", { sessionKey: sk, hasMarker, isExpert });
        // === ESCLUSIVITA' OWNER (prima di getHistory — niente sessioni altrui in RAM) ===
        // L'Expert sidecar gestisce SOLO __app_expert__: le sessioni della main non
        // vengono nemmeno aperte/lette qui (prima chiamavamo getHistory su ogni
        // sessione → l'Expert toccava/attivava le sessioni della main e pesava come la main).
        if (isExpert && sk !== "__app_expert__") { this.logDebug("recovery-skip", { sessionKey: sk, reason: "non-app-expert-su-expert-sidecar" }); continue; }
        // === POOL OWNERSHIP (29 ago — fix autoprompt-fantasma) ===
        // Il recovery gira SU OGNI processo del pool (main + worker). Ogni processo
        // deve recuperare SOLO le sessioni di cui è OWNER. Senza questa guardia, il
        // main vedeva le sessioni dei worker come "morte" (non ha il loro buffer)
        // e sparava l'autoprompt su turni VIVI — duplicazione totale dello streaming.
        // Simmetricamente, ogni worker vede solo le proprie sessioni (hash % poolN).
        // ON-OPEN FIX (29 ago): quando `onlyKey` è fornito (l'utente HA aperto la
        // chat), il main NON salta e basta — dice al worker di recuperarla SUBITO.
        // Senza questo, l'utente apriva la chat e non vedeva lo streaming: il worker
        // la recuperava solo dopo 30s (driver) e il frontend non era connesso al WS.
        if (poolActive() && ownerPool(sk) !== poolIndex()) {
          if (onlyKey) {
            // On-open: inoltra al worker. FIX 2026-09-08: CONTINUE dopo il forward.
            // Prima: fall-through → main processava ANCHE localmente → DOPPIO recovery.
            // Ora: SOLO il worker processa. Gli eventi del worker arrivano al frontend
            // via stdout fallback (fix sidecar-ws.ts) anche prima che il router si connetta.
            const forwarded = recoverOnWorker(sk);
            this.logDebug("recovery-forward-to-worker", { sessionKey: sk, forwarded, owner: ownerPool(sk) });
            continue; // ← IL FIX: mai processare localmente dopo il forward
          } else if (poolIndex() === 0 && !isPoolWorkerAlive(ownerPool(sk))) {
            // FIX 2026-09-08: al BOOT tutti i worker sono "morti" (non spawnati).
            // Prima: main prendeva TUTTO → quando i worker spawnavano facevano
            // il recovery ANCHE LORO → DOPPIO. Ora: main SPAWNA il worker owner
            // (recoverOnWorker fa spawn + queue RPC) e CONTINUE. Il worker
            // farà il recovery da solo. ZERO doppio.
            recoverOnWorker(sk);
            this.logDebug("recovery-boot-spawn-worker", { sessionKey: sk, owner: ownerPool(sk), note: "main spawna il worker owner, worker recovera da solo" });
            continue; // ← IL FIX: main NON processa, spawna e continua
          } else {
            this.logDebug("recovery-skip", { sessionKey: sk, reason: "pool-not-my-session", myIndex: poolIndex(), owner: ownerPool(sk) });
            continue;
          }
        }
        // La main gestisce __app_expert__ SOLO se l'Expert è confermata SPENTA
        // (owner.lock su PID + lsof + TCP + GRACE 5s: mai adottare durante la
        // finestra di restart del watchdog, altrimenti il turno viene rubato).
        if (sk === "__app_expert__" && !isExpert) {
          // REGOLA ASSOLUTA (utente): se l'APP Expert è aperta, la sessione NON gira mai
          // nella Main — qualunque cosa dicano i probe del sidecar. Il processo app è
          // vivo anche mentre il sidecar riparte (sync/update) — è lì che i turni
          // venivano rubati durante le finestre di restart.
          if (isExpertAppProcessRunning()) { this.logDebug("recovery-skip", { sessionKey: sk, reason: "expert-app-processo-vivo" }); continue; }
          if (isExpertAlive()) { this.logDebug("recovery-skip", { sessionKey: sk, reason: "app-expert-non-expert-sidecar" }); continue; }
          const confirmedDead = await isExpertConfirmedDead(15000);
          if (!confirmedDead) { this.logDebug("recovery-skip", { sessionKey: sk, reason: "app-expert-riapparso-durante-grace" }); continue; }
          this.logDebug("recovery-expert-down-main-recovers", { sessionKey: sk });
        }
        // Recovery ROBUSTO: anche SENZA marker, se l'ultimo messaggio nel jsonl è un
        // turno utente senza risposta assistant, il turno è stato interrotto → ri-promptata.
        let interrupted = hasMarker;
        let markerText = "";
        let retries = 0;
        // FIX ROOT: `marker` DEVE essere dichiarato QUI (scope del loop), non nel try.
        // Prima era `const marker` dentro il try → `marker.retries` più sotto lanciava
        // "marker is not defined" → il recovery CRASHAVA a ogni sessione con
        // pending-turn.json → l'autoprompt non arrivava MAI (il .catch lo ingoiava).
        let marker: any = null;
        if (!hasMarker) {
          try {
            const hist = this.getHistory(sk);
            if (Array.isArray(hist) && hist.length > 0) {
              const last = hist[hist.length - 1];
              // Turno interrotto se: ultimo messaggio è un utente SENZA risposta,
              // OPPURE è un assistant NON completato (done=false — interrotto a metà,
              // es. thinking/toolCall senza risposta finale).
              const userNoResp = last.role === "user" && last.content;
              const asstNotDone = last.role === "assistant" && !last.done;
              if (userNoResp || asstNotDone) {
                interrupted = true;
                markerText = String(last.content || "");
                this.logDebug("recovery-jsonl-interrupted", { sessionKey: sk, lastRole: last.role, done: !!last.done, lastText: markerText.slice(0, 60) });
              }
            }
          } catch (e: any) { this.logDebug("recovery-jsonl-error", { sessionKey: sk, error: e?.message || String(e) }); }
        } else {
          this.logDebug("recovery-check", { sessionKey: sk, marker: true });
          try {
            marker = JSON.parse(fs.readFileSync(p, "utf8"));
            retries = marker.retries || 0;
            markerText = String(marker.text || "");
          } catch {}
        }
        if (!interrupted) continue;
        // === DISTINZIONE main vs expert ===
        // Le sessioni __exec_* le gestisce l'executor recovery (separato).
        // (I check owner sono gia' stati fatti IN TESTA al loop, prima di getHistory.)
        // FIX (01 set): lock PER-SESSIONE in-flight — due scan concorrenti passavano
        // tutti i check INSIEME (il lock vecchio copriva solo le chiamate onlyKey)
        // → doppio autoprompt. Il finally in fondo al try lo rilascia SEMPRE,
        // anche quando il corpo esce con `continue` (skip) o con errore.
        // FIX 2026-09-08: RIMOSSO il lock recoveringMap. Era REDUNDANTE:
        // la promise chain (#prompts) GIÀ serializza i turni per sessione.
        // Se due recovery partono per la stessa chat, il secondo si mette in coda
        // sul primo (naturale, senza lock). Il lock causava solo problemi:
        // stuck perenne, recovery bloccati per sempre. Ora: nessun lock.
        recoveringMap.add(sk); // tenuto solo per logging/cleanup, NON blocca
        try {
          // Salta Long Horizon attivo (il support agent ri-prompta da solo)
          try {
            const lhState = JSON.parse(fs.readFileSync(path.join(this.#agentDir, "longhorizon", sk, "state.json"), "utf8"));
            if (lhState.active) { this.logDebug("recovery-skip", { sessionKey: sk, reason: "longhorizon-active" }); continue; }
          } catch {}
          // Salta se il turno è attivo (streaming in corso) — MA se il buffer è STALE
          // (> 45s senza aggiornamenti), il turno è BLOCCATO → ri-prompta per sbloccarlo.
          // NB: 45s per non doppiare i turni LENTI (contesto enorme di __app_expert__:
          // il modello può metterci decine di secondi a produrre il primo token).
          // === NESSUN TIMER: se il turno è ATTIVO (buffer presente), il sidecar è vivo
          // e sta lavorando (modello lento, tool lungo, contesto enorme) → NON si
          // ri-prompta MAI, a prescindere da quanto tempo passa. I timer (45s, 20min)
          // causavano falsi autoprompt (modelli locali lenti, build lunghe).
          // Il recovery scatta SOLO quando il processo è morto/riavviato (al boot il
          // buffer non c'è) e il marker pending-turn è presente → turno DAVVERO
          // interrotto. L'utente può sempre fermare o mandare un messaggio. ===
          if (this.#streamingBuffers.has(sk)) {
            this.logDebug("recovery-skip", { sessionKey: sk, reason: "turn-active" });
            continue;
          }
          // FIX (31 ago — STEERING BUG): durante lo steering il Pi SDK può scrivere
          // il messaggio utente nel jsonl e chiudere il buffer per un attimo (tra
          // agent_end del turno vecchio e agent_start del nuovo). Il recovery vedeva
          // quel momento come “turno interrotto” e sparava l'autoprompt mentre il
          // modello stava già girando. Fix: controlla ANCHE lo stato del Pi SDK —
          // se il session.isStreaming è true, la sessione è VIVA, non recuperarla.
          try {
            const _pi = this.#active.get(sk);
            if (_pi && (_pi as any).isStreaming) {
              const lastAct = this.#entries.get(sk)?.lastActivity || 0;
              const inactive = Date.now() - lastAct;
              if (inactive < 10000) {
                this.logDebug("recovery-skip", { sessionKey: sk, reason: "pi-streaming-active", inactiveMs: inactive });
                continue;
              } else {
                this.logDebug("recovery-force-stale-streaming", { sessionKey: sk, inactiveMs: inactive });
              }
            }
          } catch {}
          // Salta se l'utente ha premuto STOP (non ri-promptare)
          if (this.#stoppedSessions.has(sk)) { this.logDebug("recovery-skip", { sessionKey: sk, reason: "stopped" }); continue; }
          // FIX F3 (02 set): il vecchio limite "retries >= 3" è RIMOSSO — faceva scattare il
          // silenzio PRIMA del cap-6, rendendo irraggiungibile il messaggio finale visibile.
          // Ora la scala completa arriva fino al 6° tentativo e lì l'utente vede l'errore.
          const origText = markerText;
          // Se il messaggio originale NON è nel jsonl (app riavviata prima che venisse salvato),
          // ri-invia il messaggio originale — altrimenti il modello non sa cosa continuare.
          let hasOrig = false;
          try {
            const hist = this.getHistory(sk);
            if (Array.isArray(hist)) {
              const probe = origText.slice(0, 50);
              // FIX 2026-09-08 (BUG CRITICO): findIndex trovava la PRIMA occorrenza
              // del testo del marker. Se l'utente ha mandato lo stesso testo più volte
              // (es. "ancora" ripetuto), il PRIMO era già risposto → "already-answered" →
              // marker CANCELLATO → il recovery NON partiva MAI per l'ULTIMO messaggio
              // (quello davvero interrotto). Ora: findLastIndex trova l'ULTIMA occorrenza.
              // Solo se l'ULTIMA ha una risposta → davvero già risposto.
              let uIdx = -1;
              for (let _i = hist.length - 1; _i >= 0; _i--) {
                if (hist[_i]?.role === "user" && String(hist[_i]?.content || "").includes(probe)) { uIdx = _i; break; }
              }
              hasOrig = uIdx >= 0;
              // FIX #13b (02 set): se il messaggio del marker HA GIÀ una risposta assistant
              // nel jsonl, il turno era già stato completato → NESSUN autoprompt (anti-fantasma:
              // copre anche i marker stantii scritti prima di questo fix).
              if (hasOrig) {
                const answered = hist.slice(uIdx + 1).some((m: any) => m.role === "assistant" && (m as any).done !== false);
                if (answered) {
                  this.logDebug("recovery-skip", { sessionKey: sk, reason: "already-answered" });
                  try { const mp2 = path.join(this.#piSessionDir(sk), "pending-turn.json"); if (fs.existsSync(mp2)) fs.unlinkSync(mp2); } catch {}
                  continue;
                }
              }
            }
          } catch {}
          // === AUTOPROMPT 2.0 (29 ago, piano utente): stop persistito → MAI ripetere
          // un lavoro fermato dall'utente; scala di tentativi persistita (3×1min, poi
          // 5/15/30 min); cap 6 → messaggio di errore visibile e stop.
          try {
            const sp = path.join(this.#piSessionDir(sk), "stopped-turn.json");
            if (fs.existsSync(sp)) {
              try { const st = JSON.parse(fs.readFileSync(sp, "utf8")); const stoppedTs = st?.ts || 0; const markerTs = marker?.ts || 0;
                if (stoppedTs >= markerTs) { this.logDebug("recovery-skip", { sessionKey: sk, reason: "stopped-by-user-persisted" }); continue; }
              } catch {}
            }
          } catch {}
          // nextRetryAt: non è ancora ora? (la scala sopravvive ai riavvii)
          const nextAt = (marker as any)?.nextRetryAt || 0;
          if (nextAt > 0 && Date.now() < nextAt) { this.logDebug("recovery-skip", { sessionKey: sk, reason: "not-yet", nextRetryAt: nextAt - Date.now() }); continue; }
          // CAP: 6 tentativi fatti → messaggio finale visibile e archiviazione
          // FIX F3 (02 set): messaggio stile-errore (rosso nel frontend) + PERSISTITO nell'error
          // store (sopravvive al reload) ma FUORI dal contesto LLM (lo store errori non è nel jsonl).
          if (retries >= 6) {
            const gaveUpMsg = "Could not recover this turn after " + retries + " attempts (connection or provider down?). Send a message to try again.";
            this.logDebug("recovery-gave-up", { sessionKey: sk, retries });
            try { this.#sendToWs(this.#getSessionWs(sk), { type: "done", sessionKey: sk, stopReason: "error", errorMessage: gaveUpMsg, text: "" }); } catch {}
            try { this.#saveError(sk, { timestamp: Date.now(), errorMessage: gaveUpMsg, model: undefined, agentName: undefined, thinkingLevel: undefined }); } catch {}
            try { const mp = path.join(this.#piSessionDir(sk), "pending-turn.json"); if (fs.existsSync(mp)) fs.renameSync(mp, mp + ".gave-up"); } catch {}
            continue;
          }
          // === PROMPT CON GLI APPUNTI (il recovery 'cieco' diventa informato):
          // ricostruisco dove si era fermato dall'ultimo output parziale nel jsonl.
          let lastPartial = "";
          try {
            const hist = this.getHistory(sk);
            if (Array.isArray(hist)) {
              const lastA = [...hist].reverse().find((m: any) => m.role === "assistant");
              const c = lastA && lastA.content;
              if (typeof c === "string" && c.length > 0) lastPartial = c.slice(-200);
              else if (Array.isArray(c)) { const t = c.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join(" "); if (t) lastPartial = t.slice(-200); }
            }
          } catch {}
          const prompt = hasOrig ? "The app was interrupted while processing. Please continue and complete your response." : origText;
          // Incrementa e scrive la SCALA: 1,2,3 a +60s; poi 300s, 900s, 1800s
          if (!marker) marker = { text: markerText || prompt, ts: Date.now(), retries: 0 };
          marker.retries = retries + 1;
          const gaps = [60000, 60000, 60000, 300000, 900000, 1800000];
          const gap = gaps[Math.min(marker.retries, gaps.length) - 1];
          (marker as any).nextRetryAt = Date.now() + gap;
          fs.writeFileSync(p, JSON.stringify(marker), "utf8");
          this.logDebug("pending-turn-recover", { sessionKey: sk, retry: marker.retries, nextInMs: gap, hasOrig, rich: !!lastPartial });
          // FIX F2 (02 set): l'emissione esplicita del user_message è RIMOSSA — la fa già
          // send() nel ramo _preserveWs. Le due insieme → bubble DUPLICATO in chat.
          try { this.#sendToWs(this.#getSessionWs(sk), { type: "agent_status", sessionKey: sk, status: "retrying", attempt: marker.retries, maxAttempts: 6 }); } catch {}
          // FIX (31 ago): il recovery marca come LETTO tutto ciò che c'era PRIMA
          // dell'autoprompt. SENZA CREARE l'entry se manca: il worker può non avere
          // la sessione nel suo readState (non mai letta lì) → st era undefined
          // → l'update era SALTATO → il main contava 2 badge per sempre.
          try {
            const st = this.#readState.get(sk) || { lastReadTs: 0, lastReadTaskTs: 0, notifyMode: "none", notifyModeTs: 0 };
            st.lastReadTs = Date.now();
            this.#readState.set(sk, st);
            this.#saveReadState();
          } catch {}
          // FIX (01 set): NON usare il fakeWs no-op (send: () => {}) — quando #wss non
          // ha la sessione (sidecar riavviato, nessun invio dal frontend) #sendToWs
          // faceva target.send() nel VUOTO: message_ack/status/done ingoiati, turno
          // invisibile finché non ricaricavi. #getSessionWs scrive SEMPRE (ws
          // registrato o fallback stdout broadcast). _preserveWs non tocca #wss.
          const fakeWs = this.#getSessionWs(sk);
          await this.send(fakeWs, { sessionKey: sk, text: prompt, _preserveWs: true });
          recovered++;
        } catch (e: any) { this.logDebug("pending-turn-recover-error", { sessionKey: sk, error: e?.message || String(e) }); } finally { recoveringMap.delete(sk); try { ((this as any).__recoveringSessionsTS || new Map()).delete(sk); } catch {} }
      }
    } catch (e: any) { this.logDebug("pending-turn-recover-scan-error", { error: e?.message || String(e) }); }
    finally { (this as any).__recoveringScanActive = false; if (onlyKey) recoveringMap.delete(onlyKey); }
    return recovered;
  }

  // === Recovery MID-SESSION basato su EVENTO (nessun timer): il turno è finito
  // (errore/abort) SENZA il segnale di completamento (agent_end stop/length).
  // Il marker pending-turn è ancora lì → il turno è stato interrotto → ri-prompta
  // SUBITO per farlo continuare. Stessa logica del boot recovery, ma scatta
  // quando il turno fallisce mentre il sidecar è vivo. ===
  async #recoverInterruptedTurn(sk: string): Promise<boolean> {
    try {
      if (this.#stoppedSessions.has(sk)) return false;
      if (this.#recoveringTurns.has(sk)) return false; // già in corso (send-catch + agent_end possono scattare insieme)
      this.#recoveringTurns.add(sk);
      // Long Horizon attivo → il support agent ri-prompta da solo
      try {
        const lhState = JSON.parse(fs.readFileSync(path.join(this.#agentDir, "longhorizon", sk, "state.json"), "utf8"));
        if (lhState.active) return false;
      } catch {}
      const p = path.join(this.#piSessionDir(sk), "pending-turn.json");
      let marker: any = null;
      let retries = 0;
      try {
        if (fs.existsSync(p)) {
          marker = JSON.parse(fs.readFileSync(p, "utf8"));
          retries = marker.retries || 0;
        }
      } catch {}
      // FIX F3 (02 set): limite 3 rimosso (scala unica fino al cap-6 visibile)
      const markerText = marker?.text ? String(marker.text) : "";
      let hasOrig = false;
      try {
        const hist = this.getHistory(sk);
        if (Array.isArray(hist)) {
          const probe = markerText.slice(0, 50);
          hasOrig = hist.some((m: any) => m.role === "user" && String(m.content || "").includes(probe));
        }
      } catch {}
      const prompt = hasOrig ? "The app was interrupted while processing. Please continue and complete your response." : (markerText || "Please continue.");
      if (!marker) marker = { text: markerText || prompt, ts: Date.now(), retries: 0 };
      marker.retries = retries + 1;
      try { fs.writeFileSync(p, JSON.stringify(marker), "utf8"); } catch {}
      this.logDebug("pending-turn-recover-mid", { sessionKey: sk, retry: retries + 1, text: prompt.slice(0, 60) });
      // FIX F2 (02 set): emissione user_message rimossa qui — la fa già send() (_preserveWs).
      // FIX F3 (02 set): limite 3 rimosso anche nel mid-recovery — scala unica fino al cap-6.
      try { this.#sendToWs(this.#getSessionWs(sk), { type: "agent_status", sessionKey: sk, status: "retrying", attempt: retries + 1, maxAttempts: 6 }); } catch {}
      // FIX (01 set): vedi sopra — niente più fakeWs no-op che ingoia gli eventi.
      const fakeWs = this.#getSessionWs(sk);
      // FIX 2026-09-08: TIMEOUT 90s sul recovery send. Se il send muore senza
      // completare (sessione ghost, rete, SDK rotto), la promise non si risolve
      // MAI → il lock #recoveringTurns e recoveringMap restano attivi per SEMPRE
      // → concurrent-recovery-in-flight per sempre → chat bloccata su "Recovering".
      // Con il timeout: dopo 90s il lock si rilascia, la promise chain si azzera,
      // e il prossimo tentativo di recovery può ripartire pulito.
      const _sendPromise = this.send(fakeWs, { sessionKey: sk, text: prompt, _preserveWs: true });
      const _timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('recovery-send-timeout-30s')), 30 * 1000);
      });
      await Promise.race([_sendPromise, _timeoutPromise]);
      return true;
    } catch (e: any) {
      this.logDebug("pending-turn-recover-mid-error", { sessionKey: sk, error: e?.message || String(e) });
      // FIX 2026-09-08 (SCRITTA REALE): il recovery è MORTO → CANCELLA il marker.
      // Il marker pending-turn.json è la FONTE DI VERITÀ per il flag 'recovering'
      // nel getHistory. Se il recovery muore e il marker RESTA, la chat mostra
      // "Recovering" per sempre (FALSO). Con il cleanup: marker cancellato →
      // recovering: false → la chat torna normale (l'utente può mandare messaggi).
      try {
        const _mp = path.join(this.#piSessionDir(sk), "pending-turn.json");
        if (fs.existsSync(_mp)) fs.unlinkSync(_mp);
        this.logDebug("recovery-marker-cleaned", { sessionKey: sk, note: "recovery died — marker deleted, status will be truthful" });
      } catch {}
      // Azzera la promise chain (senza, il prossimo messaggio si incatena alla promise morta)
      this.#prompts.delete(sk);
      this.#promptsAt.delete(sk);
      this.#streamingBuffers.delete(sk);
      this.#responseTimers.delete(sk);
      this.logDebug("recovery-chain-reset", { sessionKey: sk, note: "promise chain cleared after timeout/error" });
      return false;
    } finally {
      this.#recoveringTurns.delete(sk);
    }
  }

  // === Helper: ws della sessione, o fallback a stdout (broadcast al frontend via sidecar-ws) ===
  // Dopo un restart del sidecar la mappa #wss è vuota: senza fallback gli eventi del
  // support agent (Long Horizon) andrebbero persi. Il fallback scrive su stdout,
  // che sidecar-ws.ts broadcasta a tutti i client connessi.
  #getSessionWs(key: string): any {
    const ws = this.#wss.get(key);
    if (ws && ws.readyState === ws.constructor.OPEN) return ws;
    // Fallback: scrive su stdout nel formato JSON-RPC (method=type) come il FakeWebSocket,
    // così il frontend (che dispatca su msg.method) riceve gli eventi.
    return {
      readyState: 1,
      constructor: { OPEN: 1 },
      send: (data: string) => {
        try {
          const obj = JSON.parse(data);
          if (obj && typeof obj === "object" && typeof obj.type === "string") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: obj.type, params: obj }) + "\n");
            return;
          }
        } catch {}
        process.stdout.write(data + "\n");
      },
    };
  }

  // screenshot: risposta dal frontend (invoke take_screenshot) risolta
  resolveScreenshotRequest(requestId: string, payload: any) {
    const res = this.#screenshotPending.get(requestId);
    if (res) {
      this.#screenshotPending.delete(requestId);
      try { res({ path: payload?.path || "", error: payload?.error || "" }); } catch {}
    }
  }

  #buildScreenshotTool(sk: string): any | null {
    const self = this;
    try {
      return defineTool({
        name: "screenshot",
        label: "Take a screenshot",
        description: "Capture a screenshot of the Quinki app window (saved as PNG on disk). Use it when you need to SEE the app's UI — e.g. to verify a UI change you made, debug a layout, or when the user asks you to look at the screen. Then read the returned file to inspect it.",
        promptSnippet: "screenshot: capture the Quinki app and get the PNG path",
        promptGuidelines: [
          "Use it when you need to visually verify a UI change or when the user asks you to look at the screen.",
          "The result is the path of the saved PNG — read that file to inspect the capture.",
        ],
        parameters: Type.Object({}),
        async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
          const requestId = "ss-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
          const send = (globalThis as any).__quinki_sendNotification as ((m: string, p: any) => void) | undefined;
          if (!send) {
            return { content: [{ type: "text", text: "Screenshot failed: app GUI notification bridge not available." }], isError: true };
          }
          const res = await new Promise<{ path?: string; error?: string }>((resolve) => {
            self.#screenshotPending.set(requestId, resolve);
            try { send("screenshot_request", { requestId, sessionKey: sk }); } catch (e: any) {
              self.#screenshotPending.delete(requestId);
              resolve({ path: "", error: "emit failed: " + (e?.message || String(e)) });
              return;
            }
            setTimeout(() => {
              if (self.#screenshotPending.has(requestId)) {
                self.#screenshotPending.delete(requestId);
                resolve({ path: "", error: "timeout — the app GUI did not respond (is the app running? Screen Recording permission granted?)" });
              }
            }, 15000);
          });
          if (res.error || !res.path) {
            return { content: [{ type: "text", text: `Screenshot failed: ${res.error || "no response from the app GUI (Screen Recording permission missing?)"}` }], isError: true };
          }
          return { content: [{ type: "text", text: `Screenshot captured and saved: ${res.path}
Read this file to view it.` }] };
        },
      });
    } catch (e: any) { this.logDebug("screenshot-tool-error", { sessionKey: sk, error: e?.message }); return null; }
  }

  #sendToWs(ws: any, payload: any) {
    // FIX DEFINITIVO (01 set): TUTTI gli eventi da #sendToWs vanno in formato
    // JSON-RPC {method: ..., params: ...}. Prima il payload grezzo {type: ...}
    // era inviato direttamente al WS → il frontend dispatcha SOLO msg.method →
    // evento PERSO. Funzionava solo nel fallback stdout (che convertiva).
    // Ora: SEMPRE JSON-RPC, su OGNI percorso (direct WS, pool broadcast, stdout).
    try {
      const jsonrpc = JSON.stringify({ jsonrpc: "2.0", method: payload?.type || "event", params: payload });
      const isPoolWorker = (globalThis as any).__quinki_poolIndex != null && (globalThis as any).__quinki_poolIndex > 0;
      if (isPoolWorker) {
        try { const bcast = (globalThis as any).__quinki_broadcast; if (bcast) bcast(JSON.parse(jsonrpc)); return; } catch {}
      }
      const sk = payload?.sessionKey;
      let target = ws;
      if (sk) {
        const cur = this.#wss.get(sk);
        if (cur && cur.readyState === cur.constructor?.OPEN) target = cur;
      }
      if (target && target.readyState === target.constructor?.OPEN) { target.send(jsonrpc); return; }
      try { process.stdout.write(jsonrpc + "\n"); } catch {}
    } catch {}
  }

  logDebug(tag: string, data: any) {
    try {
      // ATTRIBUZIONE (29 ago): ogni entry dichiara CHI la scrive (main/expert/pool-N)
      // — il debug log è condiviso: senza marker è impossibile dire chi ha fatto cosa.
      const src0 = (data && typeof data === "object") ? (data as any).__src : undefined;
      const entry = { ts: Date.now(), tag, src: src0 || _logSource, data };
      this.#debugLog.push(entry);
      if (this.#debugLog.length > this.#debugMax) this.#debugLog.shift();
      // === Fix lag: buffer in memoria + flush async ogni 5s, NO appendFileSync ===
      this.#debugLogBuffer.push(JSON.stringify(entry) + "\n");
      if (this.#debugLogBuffer.length > 200) this.#flushDebugLog();
      if (!this.#debugFlushTimer) {
        this.#debugFlushTimer = setInterval(() => this.#flushDebugLog(), 5000);
      }
    } catch {}
  }

  #flushDebugLog() {
    if (this.#debugLogBuffer.length === 0) return;
    const data = this.#debugLogBuffer.join("");
    this.#debugLogBuffer = [];
    try {
      fs.writeFile(DEBUG_LOG_FILE, data, { flag: "a" }, () => {});
    } catch {}
  }

  // Log real-time: solo le entry successive a ts (payload leggero per il polling della UI)
  getDebugLogSince(ts: number) {
    const all = this.getDebugLog();
    const entries = all.filter((e: any) => typeof e.ts === "number" && e.ts > ts);
    let latestTs = 0;
    for (const e of all) if (typeof e.ts === "number" && e.ts > latestTs) latestTs = e.ts;
    return { entries, latestTs, total: all.length };
  }

  getDebugLog() {
    if (this.#debugLog.length > 0) return [...this.#debugLog];
    try {
      if (fs.existsSync(DEBUG_LOG_FILE)) {
        const raw = fs.readFileSync(DEBUG_LOG_FILE, "utf8");
        const lines = raw.split("\n").filter((l) => l.trim().length > 0);
        const out: { ts: number; tag: string; data: any }[] = [];
        for (const line of lines.slice(-this.#debugMax)) {
          try {
            const obj = JSON.parse(line);
            if (typeof obj.ts === "number" && typeof obj.tag === "string") {
              out.push({ ts: obj.ts, tag: obj.tag, data: obj.data });
            }
          } catch {}
        }
        this.#debugLog = out;
        return out;
      }
    } catch {}
    return [];
  }

  clearDebugLog() {
    this.#debugLog = [];
    try { if (fs.existsSync(DEBUG_LOG_FILE)) fs.unlinkSync(DEBUG_LOG_FILE); } catch {}
  }

  #emitContextUsage(ws: any, key: string, tag = "ctx") {
    const u = this.getContextUsage(key);
    if (u && u.contextWindow > 0) {
      this.logDebug(tag, { sessionKey: key, ...u });
      this.#sendToWs(ws, { type: "context_usage", sessionKey: key, usage: u });
    } else {
      this.logDebug(tag, { sessionKey: key, usage: null, reason: "no contextWindow or getContextUsage returned null" });
    }
  }

  // === Bash read-only: rileva comandi che modificano/eseguono (bloccati in read-only mode) ===
  #isWriteCommand(cmd: string): boolean {
    if (!cmd) return false;
    const c = cmd.trim();
    // Redirezione di scrittura
    if (/>>|>|2>|2>>/.test(c) && !/grep|cat|head|tail|diff|sort|uniq|wc|find|ls/.test(c.split(/[>]/)[0] || "")) return true;
    // Comandi di modifica/creazione/eliminazione
    if (/\b(rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|truncate|dd|tee)\b/.test(c)) return true;
    // Editor / scrittura
    if (/\b(nano|vim|vi|emacs|sed\s+-i|perl\s+-i|python3?\s+-c|node\s+-e|ruby\s+-e|sqlite3)\b/.test(c)) return true;
    // Installazione / esecuzione di comandi esterni
    if (/\b(curl|wget|npm\s+(install|run|start|build|publish)|yarn\s+(add|install|run)|pnpm\s+(add|install|run)|pip\s+install|pip3\s+install|brew\s+install|apt(-get)?\s+install|git\s+(add|commit|push|init|reset|revert|checkout\s+-b|merge|rebase|clone))\b/.test(c)) return true;
    // Processi / kill
    if (/\b(kill|pkill|killall|nohup|daemonize|launchctl|systemctl|service)\b/.test(c)) return true;
    // FIX 084 (03 set): wrapper shell che nascondono scritture (es. sh -c 'echo x > f')
    if (/\b(sh|bash|zsh|dash|fish)\s+(-[a-z]*\s+)?-?c\b/.test(c)) return true;
    if (/\b(command|exec|source)\b/.test(c)) return true;
    // Script di build
    if (/\b(build|deploy|make|cmake|gradle|mvn|docker\s+(build|run|compose))\b/.test(c)) return true;
    return false;
  }

  #captureSessionMeta(key: string) {
    const s = this.#entries.get(key);
    const pi = this.#active.get(key);
    if (!s || !pi) return;
    let changed = false;
    try {
      const m = pi.model?.id;
      if (m && m !== s.model) { s.model = m; changed = true; }
    } catch {}
    try {
      const tl = pi.thinkingLevel;
      if (tl && s.thinkingLevel === undefined) { s.thinkingLevel = tl; changed = true; }
    } catch {}
    if (changed) this.#save();
  }

  // Preferenze per-sessione AUTHORITATIVE (mode/model/thinking): scritte SOLO quando l'utente
  // le cambia davvero → un salvataggio stantio dell'altro processo non può sovrascriverle.
  #writeSessionPrefs(key: string) {
    try {
      const s = this.#entries.get(key);
      if (!s) return;
      const dir = this.#piSessionDir(key);
      if (!fs.existsSync(dir)) return;
      const prefs = { mode: s.mode, model: s.model, thinkingLevel: s.thinkingLevel, ts: Date.now() };
      fs.writeFileSync(path.join(dir, "mode.json"), JSON.stringify(prefs, null, 2), "utf8");
    } catch {}
  }

  setMode(key: string, mode: string) {
    const m = mode === "build" ? "build" : "plan";
    const s = this.#entries.get(key);
    this.logDebug("set-mode", { sessionKey: key, mode: m, entryFound: !!s });
    if (s) { s.mode = m; this.#save(); this.#writeSessionPrefs(key); }
    const pi = this.#active.get(key);
    if (!pi) { this.#pendingMode.set(key, m); this.logDebug("set-mode-pending", { sessionKey: key, mode: m }); return; }
    try { this.#applyMode(pi, key, m); this.logDebug("set-mode-applied", { sessionKey: key, mode: m }); }
    catch (e: any) { this.logDebug("set-mode-error", { sessionKey: key, error: e?.message }); }
  }

  // === Cambio agente attivo mid-session (routing @tag) ===
  // Setta solo l'override per #applyMode. NON persiste nella session entry.
  // Per persistere la lista agenti, usare setChatAgents.
  setAgent(key: string, agentId: string | null) {
    if (agentId) {
      this.#agentOverride.set(key, agentId);
    } else {
      this.#agentOverride.delete(key);
    }
    // Dispose la sessione attiva SOLO se l'agente cambia: prima dispose sempre a ogni
    // sendMessage → sessione ricreata + MCP ricollegati a OGNI messaggio (hang/stabilità).
    const prev = this.#agentOverridePrior.get(key);
    const changed = prev !== agentId;
    this.#agentOverridePrior.set(key, agentId);
    if (!changed) {
      this.logDebug("set-agent-same", { sessionKey: key, agentId });
      return;
    }
    // NON sovrascrivere agentId nella session entry — quello è la lista COMPLETA gestita da setChatAgents
    const pi = this.#active.get(key);
    if (pi) {
      try { (pi as any).dispose?.(); } catch (e: any) { this.logDebug("set-agent-dispose-error", { sessionKey: key, error: e?.message }); }
      this.#active.delete(key);
      this.logDebug("set-agent-reload", { sessionKey: key, agentId });
    } else {
      this.logDebug("set-agent-pending", { sessionKey: key, agentId });
    }
  }

  // === Persiste la lista agenti nella session entry (comma-separated) ===
  // Non chiama #applyMode. Solo persistenza per sopravvivere al riavvio.
  // Persiste agenti/workingDir ANCHE nel file meta della cartella di sessione:
  // così sopravvivono anche se quinki-sessions.json viene sovrascritto dall'altra app.
  #writeChatMeta(key: string, patch: Record<string, any>) {
    try {
      const dir = this.#piSessionDir(key);
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, "chat-meta.json");
      let cur: any = {};
      try { cur = JSON.parse(fs.readFileSync(p, "utf8")); } catch {}
      // Non sovrascrivere MAI con undefined: i campi assenti preservano il valore esistente
      const clean: any = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) clean[k] = v;
      fs.writeFileSync(p, JSON.stringify({ ...cur, ...clean, ts: Date.now() }, null, 2));
    } catch {}
  }

  // === Long Horizon: legge gli ultimi tool call della sessione (per rilevare loop per PATTERN) ===
  getRecentToolCalls(key: string, limit = 12): { name: string; args: string }[] {
    const out: { name: string; args: string }[] = [];
    try {
      const hist = this.getHistory(key);
      if (Array.isArray(hist)) {
        for (const m of hist) {
          if (m.role === "tool_call" && m.toolName) {
            let args = "";
            try { args = JSON.stringify(m.toolArgs || {}); } catch {}
            out.push({ name: m.toolName, args });
          }
        }
      }
    } catch {}
    return out.slice(-limit);
  }

  // === Snapshot dello streaming in corso: per mostrare il messaggio parziale quando
  // il frontend si riconnette a metà turno (dopo crash/riavvio). ===
  getStreamingSnapshot(key: string): any | null {
    const buf = this.#streamingBuffers.get(key);
    if (!buf) return null;
    // STALE GUARD (29 ago — il bug 'Running eterno senza streaming'): se il buffer
    // non riceve aggiornamenti da >90s il turno NON è più vivo (abort che non ha
    // generato agent_end, fallimento silenzioso) → NON è streaming: cancellalo e
    // ritorna null. La UI non deve dipingere MAI un fantasma in 'Running'.
    if (buf.ts && Date.now() - buf.ts > 90000) {
      this.#streamingBuffers.delete(key);
      this.logDebug("stale-buffer-dropped", { sessionKey: key, ageMs: Date.now() - buf.ts });
      return null;
    }
    return { ...buf };
  }

  // === A2.11B: rileva lo stato TCC (per la sezione macOS Permissions) ===
  detectTccStatus(): any {
    const home = process.env.HOME || "/";
    let fullDisk = false, filesFolders = false, network = false, screenRecording = false, accessibility = false;
    try { fullDisk = fs.readdirSync(path.join(home, "Library", "Application Support", "com.apple.TCC")).length >= 0; } catch {}
    if (!fullDisk) { try { fullDisk = fs.readdirSync(path.join(home, "Library", "Safari")).length >= 0; } catch {} }
    try { filesFolders = fullDisk; } catch {}
    try {
      const r = require("child_process").spawnSync("curl", ["-sI", "--max-time", "3", "https://www.apple.com"], { encoding: "utf8", timeout: 5000 });
      network = r.status === 0;
    } catch {}
    try {
      // CGPreflightScreenCaptureAccess NON scatena il prompt (API non-invasiva)
      const r = require("child_process").spawnSync("swift", ["-e", "import CoreGraphics; print(CGPreflightScreenCaptureAccess())"], { encoding: "utf8", timeout: 15000 });
      screenRecording = r.status === 0 && (r.stdout || "").trim() === "true";
    } catch {}
    try {
      const r = require("child_process").spawnSync("osascript", ["-e", 'tell application "System Events" to get name of first process'], { encoding: "utf8", timeout: 5000 });
      accessibility = r.status === 0;
    } catch {}
    return { fullDisk, filesFolders, network, screenRecording, accessibility };
  }

  // L'Expert (porta 9183) scrive il suo stato TCC in un file condiviso, così la main lo legge.
  writeExpertTccStatus() {
    try {
      const isExpert = isExpertSidecar();
      if (!isExpert) return;
      const st = this.detectTccStatus();
      fs.mkdirSync(this.#agentDir, { recursive: true });
      fs.writeFileSync(path.join(this.#agentDir, "quinki-expert-tcc.json"), JSON.stringify({ ...st, ts: Date.now() }, null, 2), "utf8");
    } catch {}
  }

  // === A2.11B: Permessi persistenti ===
  // Default: executeCommands ON (serve per build mode), il resto OFF.
  // La working directory è SEMPRE autorizzata.
  getPermissions(): any {
    // Legge SEMPRE il file (è minuscolo) — così le modifiche dalla UI sono subito attive
    const p = path.join(this.#agentDir, "quinki-permissions.json");
    let perm: any = { readFilesAnywhere: false, writeFilesAnywhere: false, executeCommands: true, networkAccess: false, openApps: false, installPackages: false };
    try {
      if (fs.existsSync(p)) perm = { ...perm, ...JSON.parse(fs.readFileSync(p, "utf8")) };
    } catch {}
    this.#permissions = perm;
    return perm;
  }

  setPermissions(patch: any) {
    const cur = this.getPermissions();
    const next = { ...cur, ...(patch || {}) };
    this.#permissions = next;
    try {
      fs.mkdirSync(this.#agentDir, { recursive: true });
      fs.writeFileSync(path.join(this.#agentDir, "quinki-permissions.json"), JSON.stringify(next, null, 2), "utf8");
    } catch {}
    return next;
  }

  // === A2.11B: verifica se un path è permesso (working dir sempre OK, altrimenti il flag globale) ===
  loadAuthorizedFolders(): string[] {
    // Legge SEMPRE il file (è minuscolo) — così le modifiche dalla UI sono subito attive
    try {
      const p = path.join(this.#agentDir, "quinki-authorized-folders.json");
      if (fs.existsSync(p)) {
        const d = JSON.parse(fs.readFileSync(p, "utf8"));
        this.#authorizedFolders = Array.isArray(d?.folders) ? d.folders.map((f: any) => String(f)) : [];
      } else {
        this.#authorizedFolders = [];
      }
    } catch { this.#authorizedFolders = []; }
    return this.#authorizedFolders;
  }

  isInAuthorizedFolder(fullPath: string): boolean {
    try {
      const norm = path.normalize(fullPath);
      for (const f of this.loadAuthorizedFolders()) {
        const nf = path.normalize(f);
        if (norm === nf || norm.startsWith(nf + path.sep)) return true;
      }
    } catch {}
    return false;
  }

  isPathAllowed(sk: string, fullPath: string, write: boolean): boolean {
    try {
      if (!fullPath) return true;
      const perms = this.getPermissions();
      if (write && perms.writeFilesAnywhere) return true;
      if (!write && perms.readFilesAnywhere) return true;
      // Working directory sempre autorizzata
      const cwd = this.getEffectiveCwd(sk);
      if (cwd && (fullPath === cwd || fullPath.startsWith(cwd + "/") || fullPath.startsWith(cwd + "\\"))) return true;
      // Cartelle autorizzate (app-level)
      if (this.isInAuthorizedFolder(fullPath)) return true;
      // Path di sistema (agent dir: config, skills, attachments, sessioni)
      const agentDir = path.normalize(this.#agentDir);
      if (fullPath === agentDir || fullPath.startsWith(agentDir + path.sep)) return true;
      return false;
    } catch { return true; }
  }

  getEffectiveCwd(key: string): string {
    return this.#cwdOverride.get(key) ?? (this.#entries.get(key) as any)?.workingDir ?? this.#cwd;
  }

  setLongHorizonPhase(key: string, phase: string) {
    this.#lhPhase.set(key, phase);
    this.logDebug("lh-phase-set", { sessionKey: key, phase });
  }

  setChatAgents(key: string, agentIds: string) {
    const s = this.#entries.get(key);
    // Se l'entry non esiste in memoria la salviamo comunque nel meta file (e #load la riporterà)
    if (s) { (s as any).agentId = agentIds || ''; this.#save(); }
    this.#writeChatMeta(key, { agentIds: agentIds || '' });
    // === USER INTENT (anti-loss): agents.json per-sessione, scritto SOLO dal main.
    // Un sidecar stantio (Expert vecchio) non conosce questo file → non può sovrascriverlo. ===
    try {
      const dir = this.#piSessionDir(key);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "agents.json"), JSON.stringify({ agentIds: agentIds || '', ts: Date.now() }, null, 2), "utf8");
    } catch {}
    this.logDebug("set-chat-agents", { sessionKey: key, agentIds, saved: true });
    // === EVENT-DRIVEN: la lista agenti della chat è cambiata → i tool cambiano con
    // essa. Refresh SICURO della sessione (se libera ora, a fine turno se gira).
    if (this.#active.has(key)) this.#safeRecreateSession(key, "chat-agents-changed");
  }

  // === Per-chat agent overrides (model + thinking per agent, scoped to this session) ===
  setAgentOverride(key: string, agentId: string, model: string | null, thinkingLevel: string | null) {
    const s = this.#entries.get(key);
    if (!s) return;
    if (!(s as any).agentOverrides) (s as any).agentOverrides = {};
    const override = (s as any).agentOverrides[agentId] || {};
    // '__skip__' = don't change this field; null = clear it; string = set it
    if (model !== '__skip__') {
      if (model === null) delete override.model;
      else override.model = model;
    }
    if (thinkingLevel !== '__skip__') {
      if (thinkingLevel === null) delete override.thinkingLevel;
      else override.thinkingLevel = thinkingLevel;
    }
    if (Object.keys(override).length === 0) {
      delete (s as any).agentOverrides[agentId];
    } else {
      (s as any).agentOverrides[agentId] = override;
    }
    if (Object.keys((s as any).agentOverrides).length === 0) delete (s as any).agentOverrides;
    this.#save();
    this.logDebug("set-agent-override", { sessionKey: key, agentId, model, thinkingLevel });
  }

  getAgentOverrides(key: string): Record<string, { model?: string; thinkingLevel?: string }> {
    const s = this.#entries.get(key);
    return (s as any)?.agentOverrides || {};
  }

  // === Cambio directory mid-sessione ===
  // Dispose della sessione attiva + registra il nuovo cwd (#cwdOverride). Al prossimo send()
  // la sessione viene riaperta (SessionManager.open con cwdOverride) preservando il .jsonl
  // (history). Risolve: "sposto la cartella e devo ricominciare da capo" → non più.
  setWorkingDir(key: string, newPath: string) {
    const pi = this.#active.get(key);
    if (pi) {
      try { (pi as any).dispose?.(); } catch (e: any) { this.logDebug("set-working-dir-dispose-error", { sessionKey: key, error: e?.message }); }
      this.#active.delete(key);
    }
    if (newPath && newPath.length > 0) {
      this.#cwdOverride.set(key, newPath);
      // Persist to session entry + meta file per-sessione (sopravvive a wipe del metadata condiviso)
      const s = this.#entries.get(key);
      if (s) { (s as any).workingDir = newPath; this.#save(); }
      this.#writeChatMeta(key, { workingDir: newPath });
    } else {
      this.#cwdOverride.delete(key);
      const s = this.#entries.get(key);
      if (s) { (s as any).workingDir = undefined; this.#save(); }
      this.#writeChatMeta(key, { workingDir: "" });
    }
    this.logDebug("set-working-dir", { sessionKey: key, newPath: newPath || "(default)" });
  }

  setMessageSkills(key: string, messageId: string, skills: any[], messageText?: string) {
    const s = this.#entries.get(key);
    if (s && skills && skills.length > 0) {
      if (!(s as any).messageSkills) (s as any).messageSkills = {};
      // Use message text (first 200 chars) as key — message IDs from Pi SDK don't match our mid
      const textKey = (messageText || messageId || '').substring(0, 200);
      (s as any).messageSkills[textKey] = skills;
      this.#save();
      this.logDebug("set-message-skills", { sessionKey: key, textKey, skillCount: skills.length });
    }
  }

  getMessageSkills(key: string): Record<string, any[]> {
    const s = this.#entries.get(key);
    return (s as any)?.messageSkills || {};
  }

  setMessageTaskClips(key: string, messageId: string, clips: any[], messageText?: string) {
    const s = this.#entries.get(key);
    if (s && clips && clips.length > 0) {
      if (!(s as any).messageTaskClips) (s as any).messageTaskClips = {};
      const textKey = (messageText || messageId || '').substring(0, 200);
      (s as any).messageTaskClips[textKey] = clips;
      this.#save();
      this.logDebug("set-message-task-clips", { sessionKey: key, textKey, clipCount: clips.length });
    }
  }

  getMessageTaskClips(key: string): Record<string, any[]> {
    const s = this.#entries.get(key);
    return (s as any)?.messageTaskClips || {};
  }

  setMessageAttachments(key: string, messageId: string, attachments: any[], messageText?: string) {
    const s = this.#entries.get(key);
    if (s && attachments && attachments.length > 0) {
      if (!(s as any).messageAttachments) (s as any).messageAttachments = {};
      const textKey = (messageText || messageId || '').substring(0, 200);
      (s as any).messageAttachments[textKey] = attachments;
      this.#save();
      this.logDebug("set-message-attachments", { sessionKey: key, textKey, attachmentCount: attachments.length });
    }
  }

  getMessageAttachments(key: string): Record<string, any[]> {
    const s = this.#entries.get(key);
    return (s as any)?.messageAttachments || {};
  }

  // === Reload session: dispose Pi + il prossimo send riapre rileggendo il .jsonl aggiornato ===
  // Usato dopo injectErrorExchange per far "vedere" al modello i messaggi iniettati.
  reloadSession(key: string) {
    const pi = this.#active.get(key);
    if (pi) {
      // NON disporre se c'è un turno in corso (streaming buffer attivo):
      // altrimenti la riapertura dell'app uccide la risposta in corso
      // (bug: la sessione Expert moriva a ogni riapertura).
      const buf = this.#streamingBuffers.get(key);
      if (buf) { this.logDebug("reload-session-skip-streaming", { sessionKey: key }); return; }
      try { (pi as any).dispose?.(); } catch (e: any) { this.logDebug("reload-session-dispose-error", { sessionKey: key, error: e?.message }); }
      this.#active.delete(key);
      this.logDebug("reload-session", { sessionKey: key });
    }
  }

  // === Inject error exchange: scrive user msg + error msg nel .jsonl ===
  // Per persistere errori UI (es: multi-agent senza @tag) cross-reload
  injectErrorExchange(key: string, userMessage: string, errorContent: string, timestamp?: number) {
    const ts = timestamp || Date.now();
    const isoTs = new Date(ts).toISOString();
    const sessionDir = this.#piSessionDir(key);
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
    const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
    if (files.length === 0) return; // no session file yet
    const jsonlPath = path.join(sessionDir, files[0]);
    const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter((l: string) => l.trim());
    const lastLine = lines[lines.length - 1];
    let parentId = null;
    try { parentId = JSON.parse(lastLine).id || null; } catch {}

    // User message
    const userEntry = {
      type: "message",
      id: `inj-u-${ts}`,
      parentId,
      timestamp: isoTs,
      message: { role: "user", content: [{ type: "text", text: userMessage }], timestamp: ts }
    };
    // Error (assistant) message — FIX 084: una entry error DEVE essere well-formed per il Pi SDK:
    // stopReason "error" (i guard del vendor e di pi-ai skippano i messaggi abort/error) + usage a zero
    // (pi-ai estimate.js legge usage.totalTokens sui messaggi assistant con stopReason valido →
    // senza questi campi la prossima chiamata LLM crasha con TypeError). Retrocompatibile con le
    // entry malformate già su disco grazie al guard aggiunto in pi-ai/utils/estimate.js.
    const errEntry = {
      type: "message",
      id: `inj-e-${ts + 1}`,
      parentId: `inj-u-${ts}`,
      timestamp: new Date(ts + 1).toISOString(),
      message: { role: "assistant", content: [{ type: "text", text: errorContent }], isError: true, stopReason: "error", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, timestamp: ts + 1 }
    };
    fs.appendFileSync(jsonlPath, JSON.stringify(userEntry) + "\n" + JSON.stringify(errEntry) + "\n", "utf8");

    // Also save to errors store
    this.#saveError(key, { errorMessage: errorContent, timestamp: ts, model: undefined, agentName: undefined, thinkingLevel: undefined });

    // Dispose active session so next send() reloads from .jsonl
    const pi = this.#active.get(key);
    if (pi) { try { (pi as any).dispose?.(); } catch {} this.#active.delete(key); }
    this.logDebug("inject-error-exchange", { sessionKey: key, userLen: userMessage.length, errLen: errorContent.length });
  }

  // === Reset sessione: azzera la conversazione (dispose Pi + elimina .jsonl) ===
  // Mantiene key/model/mode/cwd. Il prossimo send crea una sessione Fresca (nessuna history).
  // Risolve: /reset cancellava solo i messaggi Flutter, ma la sessione Pi conservava
  // la history → il modello "ricordava" i messaggi precedenti.
  resetSession(key: string) {
    const pi = this.#active.get(key);
    if (pi) {
      try { (pi as any).dispose?.(); } catch (e: any) { this.logDebug("reset-session-dispose-error", { sessionKey: key, error: e?.message }); }
      this.#active.delete(key);
    }
    try {
      const dir = this.#piSessionDir(key);
      if (fs.existsSync(dir)) {
        for (const f of fs.readdirSync(dir).filter((x: string) => x.endsWith(".jsonl"))) {
          fs.unlinkSync(path.join(dir, f));
        }
      }
    } catch (e: any) { this.logDebug("reset-session-error", { sessionKey: key, error: e?.message }); }
    this.#firstUserText.delete(key); // pulisci per auto-title dopo reset
    // FIX 2026-09-08 (P1 #2): resetSession lasciava la promise chain e i set di guardia
    // sporchi → il prossimo sendMessage si accodava a una promessa morta e restava
    // in running eterno (chat inghiottita). Ora: azzera TUTTO lo stato del turno.
    this.#prompts.delete(key);           // promise chain: azzera (il prossimo send riparte pulito)
    this.#promptsAt.delete(key);         // timestamp chain
    this.#stoppedSessions.delete(key);   // guardia "stopped" — la sessione nuova non è stopped
    this.#rePrompted.delete(key);       // guardia re-prompt — la sessione nuova non è re-prompted
    this.#streamingBuffers.delete(key);  // buffer di streaming (se rimasto sporco)
    this.#responseTimers.delete(key);    // timer di response (se rimasto appeso)
    // FIX aggiuntivo: pulisci ANCHE i client MCP della sessione (cached in #mcpClients).
    // Senza questo, il secondo send dopo reset riusa il client MCP morto → hang infinito
    // su listTools() → la sessione non viene mai creata → chat muta.
    for (const mk of [...this.#mcpClients.keys()]) {
      if (mk.startsWith(key + ':')) {
        try { (this.#mcpClients.get(mk) as any)?.close?.(); } catch {}
        this.#mcpClients.delete(mk);
      }
    }
    this.logDebug("reset-session-state-cleared", { sessionKey: key, note: "promise chain + guards + buffers + MCP clients cleared" });
    // Clear errors for this session
    this.#errors.delete(key);
    try {
      const data: Record<string, any> = {};
      for (const [k, v] of this.#errors) data[k] = v;
      fs.writeFileSync(ERRORS_FILE, JSON.stringify(data, null, 2), "utf8");
    } catch {}
    this.logDebug("reset-session", { sessionKey: key });
  }

  // Max mtime dei file in <cwd>/.pi/skills/ (per auto-reload skill quando l'Expert li edita).
  // History preservata: il reload fa dispose + SessionManager.open (rilegge il .jsonl).
  #skillsDirMtime(cwd: string): number {
    try {
      const skillsDir = path.join(cwd, ".pi", "skills");
      if (!fs.existsSync(skillsDir)) return 0;
      let max = 0;
      const walk = (d: string) => {
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, ent.name);
          try {
            const st = fs.statSync(p);
            if (st.isDirectory()) walk(p);
            else if (st.mtimeMs > max) max = st.mtimeMs;
          } catch {}
        }
      };
      walk(skillsDir);
      return max;
    } catch { return 0; }
  }

  // === Fase C: leggere config globale e agente ===
  #readGlobalConfig(): any {
    try {
      const file = path.join(this.#agentDir, "quinki-global.json");
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    return { tools: ["read", "grep", "find", "ls", "skill"], planModeTools: { read: true, grep: true, find: true, ls: true, skill: true, bash_readonly: true, schedule_task: true, cancel_schedule: true, getTaskStatus: true, getTaskResult: true, readHandoff: true, market: true, delegate_to_agent: true, screenshot: true, write: false, edit: false, bash: false }, defaultMode: "plan" };
  }

  #readAgentConfigFile(agentId: string): any | null {
    try {
      const file = path.join(this.#agentDir, "agents", agentId, "config.json");
      if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    return null;
  }

  #resolveSkillPaths(agentConfig: any, cwd: string): string[] {
    if (!agentConfig?.skills?.length) return [];
    const paths: string[] = [];
    for (const skillName of agentConfig.skills) {
      if (agentConfig.workspace) {
        const wsPath = path.join(agentConfig.workspace, ".pi", "skills", skillName, "SKILL.md");
        if (fs.existsSync(wsPath)) { paths.push(wsPath); continue; }
      }
      const agentPath = path.join(this.#agentDir, "skills", skillName, "SKILL.md");
      if (fs.existsSync(agentPath)) { paths.push(agentPath); continue; }
      const cwdPath = path.join(cwd, ".pi", "skills", skillName, "SKILL.md");
      if (fs.existsSync(cwdPath)) { paths.push(cwdPath); continue; }
    }
    return paths;
  }

  // Auto-diff MCP (safe): se i mcpServers dell'agente sono CAMBIATI da quando la sessione è nata,
  // aggiorna SOLO i customTool MCP della sessione viva (niente dispose/ricreazione, history intatta).
  // Chiamato a OGNI invio dopo l'ensure della sessione.
  async #maybeRefreshMcp(sk: string, pi: any): Promise<boolean> {
    try {
      const raw = this.#resolveAgentId(sk);
      let agentId: string | null = raw || null;
      if (agentId && typeof agentId === 'string' && agentId.includes(',')) {
        const ids = agentId.split(',').map((x) => x.trim()).filter(Boolean);
        agentId = ids.find((x) => x === 'orchestrator') || ids[0] || null;
      }
      const cfg = agentId ? this.#readAgentConfigFile(agentId) : null;
      // La firma copre mcpServers E tools: assegnare/rimuovere un tool mid-session
      // triggera il refresh del registry (stesso meccanismo degli MCP).
      // === FIX BUG RADICALE (29 ago — 'lo streaming si perde in continuazione'):
      // questo confronto non combaciava MAI: il punto di CREAZIONE (#buildMcpTools)
      // salvava la firma in un FORMATO DIVERSO (solo id MCP) rispetto a questo
      // confronto ({mcp, tools}) → dispose+recreate della sessione A OGNI SEND,
      // e se il dispose beccava un turno in volo → turno morto → pill Running
      // bloccata per sempre. Ora: firma deterministica (arrays ordinati) e
      // MAI dispose mentre un turno è attivo (defer al prossimo giro).
      const sortArr = (a: any[]) => Array.isArray(a) ? [...a].map(String).sort() : [];
      const idsNow = JSON.stringify({ mcp: sortArr(Array.isArray(cfg?.mcpServers) ? cfg.mcpServers : []), tools: sortArr(Array.isArray(cfg?.tools) ? cfg.tools : []) });
      // === ADOPT-IF-MISSING (29 ago): la sessione è appena (ri)creata col config
      // ATTUALE — una firma mancante (sidecar riavviato) si ADOTTA, non è un cambio.
      // Era il bug dell'autoprompt post-boot: firma vuota → dispose → turno morto.
      if (this.#mcpSig.get(sk) === undefined) {
        this.#mcpSig.set(sk, idsNow);
        return false;
      }
      if (this.#mcpSig.get(sk) !== idsNow) {
        const mcpTools = await this.#buildMcpTools(sk, agentId);
        const keep = ((pi as any)._customTools || []).filter((t: any) => t?.name === 'skill' || t?.name === 'delegate_to_agent' || t?.name === 'schedule_task' || t?.name === 'cancel_schedule' || t?.name === 'getTaskStatus' || t?.name === 'getTaskResult' || t?.name === 'readHandoff' || t?.name === 'screenshot' || t?.name === 'market');
        // === Re-registra TUTTI i custom tool che l'agente ha nel config ma che NON sono
        // ancora nel registry della sessione viva (assegnazione mid-session, come gli MCP):
        // delegate_to_agent, schedule_task, task tools, screenshot, market ===
        const has = (name: string) => keep.some((t: any) => t?.name === name);
        const wants = (name: string) => Array.isArray(cfg?.tools) && cfg.tools.includes(name);
        if (wants('delegate_to_agent') && !has('delegate_to_agent')) {
          try { const t = this.#buildDelegateTool(sk); if (t) keep.push(t); } catch {}
        }
        if (wants('bash_readonly') && !has('bash_readonly')) {
          try { const t = this.#buildBashReadonlyTool(sk); if (t) keep.push(t); } catch {}
        }
        if (wants('schedule_task') && !has('schedule_task')) {
          try { const t = this.#buildScheduleTool(sk); if (t) keep.push(t); } catch {}
        }
        // P2 #10: cancel_schedule — l'agente può cancellare le schedule che ha creato
        if (wants('cancel_schedule') && !has('cancel_schedule')) {
          try { const t = this.#buildCancelScheduleTool(sk); if (t) keep.push(t); } catch {}
        }
        if (wants('getTaskStatus') || wants('getTaskResult') || wants('readHandoff')) {
          try { const tt = this.#buildTaskTools(sk); if (tt.length > 0) for (const t of tt) { if (!has((t as any).name)) keep.push(t); } } catch {}
        }
        if (!has('market')) {
          try { const t = this.#buildMarketTool(); if (t) keep.push(t); } catch {}
        }
        if (wants('screenshot') && !has('screenshot')) {
          try { const st = this.#buildScreenshotTool(sk); if (st) keep.push(st); } catch {}
        }
        // Rimuovi i custom tool NON più richiesti dal config (mid-session removal corretto)
        const cfgToolsNow = Array.isArray(cfg?.tools) ? (cfg.tools as string[]) : [];
        const filtered = keep.filter((t: any) => {
          const n = t?.name || "";
          const alwaysKeep = ['skill', 'market'].includes(n);
          if (alwaysKeep) return true;
          return cfgToolsNow.includes(n);
        });
        (pi as any)._customTools = [...filtered, ...mcpTools];
        try { (pi as any)._refreshToolRegistry?.(); } catch (e: any) { this.logDebug("mcp-refresh-registry-error", { sessionKey: sk, error: e?.message }); }
        this.#mcpSig.set(sk, idsNow);
        // === MaterIALIZZAZIONE MID-SESSION: la sessione Pi viva ha i customTools
        // della CREAZIONE — i tool aggiunti/rimossi mid-session NON entrano finché
        // la sessione non viene ricreata. Stesso pattern del skills reload:
        // dispose + reopen (SessionManager.open → history PRESERVATA, nessun messaggio perso).
        // La sessione si ricrea automaticamente al prossimo invio. ===
        // === MAI dispose con un turno ATTIVO (fix del bug 'Running bloccato'):
        // se la sessione sta streammando (buffer o timer vivi), il dispose uccideva
        // il turno in volo senza done → pill Running eterna. Rimanda al prossimo
        // giro (il turno finisce, il prossimo send ricontrolla).
        const turnActive = this.#streamingBuffers.has(sk) || this.#responseTimers.has(sk) || this.#prompts.has(sk);
        if (turnActive) {
          this.logDebug("mcp-reload-deferred", { sessionKey: sk, reason: "turno-attivo-non-scarto" });
          return false;
        }
        try {
          (pi as any).dispose?.();
          this.#active.delete(sk);
          this.logDebug("mcp-reload-dispose", { sessionKey: sk, reason: "tools-changed-mid-session", added: mcpTools.map((t: any) => (t as any).name), kept: filtered.map((t: any) => t?.name) });
        } catch (e: any) { this.logDebug("mcp-reload-dispose-error", { sessionKey: sk, error: String(e?.message || e) }); }
        // Il refresh tool rebuilda il system prompt BASE → la mode note si perde →
        // re-applica la modalità della sessione così non si resetta a plan.
        try {
          const entryMode = this.#entries.get(sk)?.mode || "plan";
          this.#applyMode(pi, sk, entryMode === "build" ? "build" : "plan");
          this.logDebug("mcp-refresh-mode-reapplied", { sessionKey: sk, mode: entryMode });
        } catch (e: any) { this.logDebug("mcp-refresh-mode-error", { sessionKey: sk, error: String(e?.message || e) }); }
        this.logDebug("mcp-config-refresh", { sessionKey: sk, mcpTools: mcpTools.length, keep: keep.length, screenshotRegistered: keep.some((t: any) => t?.name === 'screenshot') });
        return true;
      }
    } catch (e: any) { this.logDebug("mcp-refresh-error", { sessionKey: sk, error: e?.message || String(e) }); return false; }
  }

  // === EVENT-DRIVEN CONFIG REFRESH (29 ago — redesign): il refresh NON è più nel
  // percorso dei messaggi. I CAMBIAMENTI reali (updateAgent, setChatAgents)
  // chiamano refreshSessionsForAgent → le sessioni vive si rinfrescano SOLO in
  // un momento sicuro: subito se libere, a fine turno se stanno girando.
  #needsConfigRefresh = new Set<string>();
  #promptsAt = new Map<string, number>();

  // Ri-applica #applyMode su TUTTE le sessioni attive (niente dispose).
  // Chiamato da updateGlobalConfig quando planModeTools/planModeMcp/tools cambiano:
  // il runtime legge il global config fresco e setta i tool attivi senza uccidere la sessione.
  reapplyModeOnActiveSessions() {
    try {
      for (const sk of [...this.#active.keys()]) {
        const pi = this.#active.get(sk);
        if (!pi) continue;
        const entry = this.#entries.get(sk);
        const mode = entry?.mode === "build" ? "build" : "plan";
        try {
          this.#applyMode(pi, sk, mode);
          this.logDebug("global-config-reapplied", { sessionKey: sk, mode });
        } catch (e: any) {
          this.logDebug("global-config-reapply-error", { sessionKey: sk, error: e?.message });
        }
      }
    } catch (e: any) { this.logDebug("global-config-reapply-scan-error", { error: String(e?.message || e) }); }
  }

  refreshSessionsForAgent(agentId: string) {
    try {
      for (const sk of [...this.#active.keys()]) {
        // Match ESTESO: controlla il resolved agent (override), la entry completa
        // (agentId può essere una lista multi-agente) e il resolved raw.
        // Prima matchava SOLO #resolveAgentId → le sessioni multi-agente con
        // override non venivano mai rinfrescate.
        const resolved = String(this.#resolveAgentId(sk) || "");
        const entry = this.#entries.get(sk);
        const entryAgents = String(entry?.agentId || "").split(",").map((s: string) => s.trim()).filter(Boolean);
        const resolvedList = resolved.split(",").map((s: any) => s.trim()).filter(Boolean);
        const matches = resolvedList.includes(agentId)
          || resolved === agentId
          || entryAgents.includes(agentId)
          || entry?.agentId === agentId;
        if (!matches) continue;
        this.#safeRecreateSession(sk, `agent-config-changed:${agentId}`);
      }
    } catch (e: any) { this.logDebug("config-refresh-scan-error", { error: String(e?.message || e) }); }
  }

  #safeRecreateSession(sk: string, reason: string) {
    try {
      // === PRESERVA LA MODE: il dispose non deve MAI far perdere plan/build.
      // #writeSessionPrefs salva mode/model/thinking in mode.json — il prossimo
      // giro (recreate) la rilegge AUTHORITATIVA. Senza questo, il fallback "plan"
      // nel send path scattava a ogni ricreazione → mode che si resetta da sola.
      try { this.#writeSessionPrefs(sk); } catch {}
      const turnActive = this.#streamingBuffers.has(sk) || this.#responseTimers.has(sk) || this.#prompts.has(sk);
      if (turnActive) {
        this.#needsConfigRefresh.add(sk);
        this.logDebug("config-refresh-deferred", { sessionKey: sk, reason, note: "a fine turno" });
        return;
      }
      const pi = this.#active.get(sk);
      try { const un = this.#unsubs.get(sk); if (un) { try { un(); } catch {} } this.#unsubs.delete(sk); } catch {}
      try { (pi as any)?.dispose?.(); } catch {}
      this.#active.delete(sk);
      this.#mcpSig.delete(sk);
      this.logDebug("config-refresh-dispose", { sessionKey: sk, reason });
    } catch (e: any) { this.logDebug("config-refresh-dispose-error", { sessionKey: sk, error: String(e?.message || e) }); }
  }

  // Dump delle definizioni dei tool ATTIVI che verranno inviati al modello (canale tools):
  // nome + descrizione + schema parametri, customTool MCP inclusi. Usato dal log system_prompt.
  #activeToolDefs(pi: any, key?: string): any[] {
    const out: any[] = [];
    try {
      const names = (pi?.getActiveToolNames?.() || []) as string[];
      for (const name of names) {
        try {
          const d = pi?.getToolDefinition?.(name);
          let params = "";
          try { params = JSON.stringify(d?.parameters ?? {}); } catch { try { params = String(d?.parameters || ""); } catch {} }
          // bash_readonly: mostra "bash_readonly" invece di "bash" quando la sessione è in modalità read-only
          let displayName = d?.name || name;
          if (name === "bash" && key && this.#bashReadonlySessions.has(key)) {
            displayName = "bash_readonly";
          }
          out.push({ name: displayName, description: (d?.description || "").slice(0, 400), params: params.slice(0, 500) });
        } catch {}
      }
    } catch {}
    return out;
  }

  #applyMode(pi: any, key: string, mode: string, workingDirs?: string[], cwd?: string, hasDelegateTool = false) {
    const m = mode === "build" ? "build" : "plan";
    // === Universal thinking (04 set): caps AUTORITATIVE applicate a OGNI TURNO.
    // models.json puo conservare mappe stantie (old.thinkingLevelMap vince nel
    // sync) — qui la mappa del modello VIVO viene corretta con il maxLevel
    // appreso (thinking-caps.json, chiave host/modelId) per OGNI provider. ===
    try {
      const mBase = String((pi as any)?.model?.baseUrl || "");
      if (mBase) {
        const capsPath = path.join(process.env.HOME || "", ".quinki", "thinking-caps.json");
        const caps = JSON.parse(fs.readFileSync(capsPath, "utf8") || "{}");
        const capKey = (() => { try { return new URL(mBase).host + "/" + (pi as any).model.id; } catch { return (pi as any)?.model?.id; } })();
        const learned = caps[capKey]?.maxLevel;
        const map = (pi as any)?.model?.thinkingLevelMap;
        // Request layer (vendored openai-completions) legge i caps da QUI: l'ultimo
        // miglio non puo essere bypassato da refresh del registry o mappe stantie.
        (globalThis as any).__quinkiThinkingCaps = caps;
        if (learned && map && map.xhigh !== learned) {
          (pi as any).model.thinkingLevelMap = { ...map, xhigh: learned };
          this.logDebug("thinking-caps-applied", { sessionKey: key, model: (pi as any)?.model?.id, maxLevel: learned, was: map.xhigh, provider: (pi as any)?.model?.provider, note: "caps a ogni turno (fix 04 set)" });
        }
      }
    } catch {}
    // Fase C: merge tool globali + agent, filtra per plan mode
    const globalConfig = this.#readGlobalConfig();
    // Generalizzato: carica config di qualsiasi agente
    const rawAgentId = this.#resolveAgentId(key);
    // Extract single agent from comma-separated list (same logic as #buildSystemPrompt)
    let agentId: string | null = rawAgentId;
    if (agentId && typeof agentId === 'string' && agentId.includes(',')) {
      const ids = agentId.split(',').map(s => s.trim()).filter(Boolean);
      agentId = ids.find(id => id === 'orchestrator') || ids[0] || null;
    }
    let agentConfig: any = null;
    if (agentId) {
      agentConfig = this.#readAgentConfigFile(agentId);
      if (!agentConfig && agentId === "app-expert") {
        // Fallback: Expert senza config.json
        agentConfig = { id: "app-expert", name: "App Expert", tools: [], skills: ["app-expert"] };
      }
    }
    // Inject API keys per-agent (solo le skill dell'agente attivo)
    if (agentConfig) this.#injectApiKeysForAgent(agentConfig);
    else this.#clearActiveApiKeys();
    const globalTools = globalConfig.tools || ["read", "grep", "find", "ls", "skill"];
    const agentTools = agentConfig?.tools || [];
    const merged = [...new Set([...globalTools, ...agentTools])];
    let names: string[] = [];
    try {
      const all = (pi.getAllTools?.() ?? []).map((t: any) => t.name) as string[];
      // Filter merged tools to only those available in Pi SDK
      names = merged.filter(n => all.includes(n));
      // Always include custom tools (delegate_to_agent, skill) even if not in getAllTools
      // — they were registered via createAgentSession customTools
      const customToolNames = ["delegate_to_agent", "skill", "bash_readonly", "schedule_task", "cancel_schedule", "getTaskStatus", "getTaskResult", "readHandoff", "screenshot"];
      for (const ct of customToolNames) {
        if (merged.includes(ct) && !names.includes(ct)) names.push(ct);
      }
      // schedule_task: presente SOLO se l'agente lo ha nel config tools (lo gestisce customToolNames)
      // Plan mode: remove tools not allowed in plan (but keep custom tools)
      if (m === "plan") {
        const planFlags = globalConfig.planModeTools || {};
        names = names.filter(n => planFlags[n] !== false || customToolNames.includes(n));
        // bash_readonly: ora è un TOOL REALE e autonomo (registrato tra le custom
        // tools dall'agente che lo ha nel config). Niente piu alias su bash:
        // in plan mode il bash COMPLETO non viene mai assegnato (planFlags.bash=false).
      } else {
        this.#bashReadonlySessions.delete(key);
      }
      // MCP: in Build mode tutti i tool dei server assegnati; in Plan mode solo i tool
      // dei server abilitati globalmente nella sezione Plan mode (planModeMcp, vale per tutti gli agenti).
      const mcpEntries = this.#mcpToolNames.get(key) || [];
      const planMcp = globalConfig.planModeMcp || {};
      for (const entry of mcpEntries) {
        const ok = m === "plan" ? planMcp[entry.serverId] === true : true;
        if (ok && !names.includes(entry.name)) names.push(entry.name);
      }
    } catch {}
    try { pi.setActiveToolsByName?.(names); } catch {}
    // setActiveToolsByName rebuilda _baseSystemPrompt (date+cwd+tools, SENZA nota mode).
    // A inizio turno il Pi SDK fa agent.state.systemPrompt = _baseSystemPrompt (sovrascrive
    // un set manuale). Per far sopravvivere la nota mode, la appendiamo a _baseSystemPrompt.
    try {
      let base = (pi as any)._baseSystemPrompt;
      const note = this.#modeNote(m, hasDelegateTool);
      // Prepend la persona dell'agente (PROMPT.md) + cwd effettivo a _baseSystemPrompt
      // Use the already-extracted agentId (from comma-separated list)
      if (agentId && typeof base === "string" && !base.includes(agentConfig?.name || "§§")) {
        const effCwd = cwd || (workingDirs && workingDirs[0]) || this.#cwd;
        const agentPrompt = this.#readAgentPrompt(agentId, effCwd);
        base = agentPrompt + `\n\nWorking directory: ${effCwd}\n\n` + base;
      }
      if (typeof base === "string" && base.length > 0 && note) {
        // Strip old mode note before adding new one (fix: mode change not detected)
        const planIdx = base.indexOf("\n\nSei in MODALITÀ PIANO");
        const buildIdx = base.indexOf("\n\nSei in MODALITÀ BUILD");
        const planIdxEn = base.indexOf("\n\nYou are in PLAN MODE");
        const buildIdxEn = base.indexOf("\n\nYou are in BUILD MODE");
        const cut = Math.max(planIdx, buildIdx, planIdxEn, buildIdxEn);
        if (cut >= 0) base = base.substring(0, cut);
        base = base + note;
      }
      if (typeof base === "string" && base.length > 0) {
        (pi as any)._baseSystemPrompt = base;
        pi.agent.state.systemPrompt = base;
      }
    } catch (e: any) { this.logDebug("apply-mode-prompt-error", { sessionKey: key, error: e?.message }); }
    this.logDebug("apply-mode", { sessionKey: key, mode: m, toolCount: names.length, tools: names });
  }

  #modeNote(mode: string, _hasDelegateTool = false): string {
    const m = mode === "build" ? "build" : "plan";
    if (m === "plan") {
      // Nota COMPLETA, senza le liste dinamiche dei tool (quelle le abbiamo tolte:
      // il modello conosce i tool attivi dall'array tools, non dal testo).
      return `\n\nYou are in PLAN MODE (Plan mode). Explore freely to understand the problem well. Do NOT attempt to call the not-available tools. Collaborate with the user to create a DETAILED, feasible PLAN of how to solve the problem. If an operation requires an unavailable tool, TELL the user that, after approving the plan, they must switch to BUILD MODE. In Plan mode the user wants certainty that you will not make changes without their permission.`;
    }
    return `\n\nYou are in BUILD MODE. All tools are available. Make the necessary changes to solve the problem. Respect the user's instructions and constraints.`;
  }

  #isExpertKey(sk: string): boolean {
    return sk === "__app_expert__";
  }

  // Estrae l'agent ID dalla session key (supporta __app_expert__ e __agent_<id>__)
  #getAgentIdFromKey(sk: string): string | null {
    if (sk === "__app_expert__") return "app-expert";
    const match = sk.match(/^__agent_(.+)$/);
    if (match) return match[1];
    return null;
  }

  // Legge il PROMPT.md di qualsiasi agente da ~/.pi/agent/agents/<id>/PROMPT.md
  #readAgentPrompt(agentId: string, cwd?: string): string {
    const promptPath = path.join(this.#agentDir, "agents", agentId, "PROMPT.md");
    try {
      if (fs.existsSync(promptPath)) {
        let text = fs.readFileSync(promptPath, "utf8");
        // Sostituisci placeholder per l'Expert
        if (agentId === "app-expert") {
          text = text.replaceAll("{{FLUTTER_RUN}}", this.#flutterRunCmd());
          text = text.replaceAll("{{FLUTTER_BUILD}}", this.#flutterBuildCmd());
          text = text.replaceAll("{{CONTROL_A}}", this.#expertControlASection());
        }
        return text;
      }
    } catch (e: any) { this.logDebug("agent-prompt-file-error", { agentId, error: e?.message }); }
    // Fallback hardcoded solo per Expert
    if (agentId === "app-expert") return this.#expertSystemPromptFallback(cwd);
    // Moderatore: prompt speciale di coordinamento
    if (agentId === "orchestrator") {
      return `You are the **Moderator**, the coordinator of the agents in the chat. The user talks directly with you.\n\n## What you do\n- Analyze the user's request\n- Decide which agent to delegate for each task\n- Coordinate the agents to solve the problem\n- Report the results to the user\n\n## Rules\n- You have no skills or direct tools — coordination only\n- Be concise: explain what you do and who you delegate`;  
    }
    // Per altri agenti senza PROMPT.md: prompt minimo
    const cfg = this.#readAgentConfigFile(agentId);
    const name = cfg?.name || agentId;
    return `Sei ${name}.`;
  }

  #expertExePath: string | null = null;
  setExpertEnv(exePath: string) {
    this.#expertExePath = exePath;
    this.logDebug("set-expert-env", { exePath });
  }

  // A2.2: il sidecar registra il bridge verso il Scheduler (tool schedule_task degli agenti)
  setScheduleHandler(fn: (params: any) => any) {
    this.#scheduleHandler = fn;
  }

  // P2 #10: il sidecar registra il bridge per CANCELLARE una schedule (tool cancel_schedule)
  setScheduleCancelHandler(fn: (params: any) => any) {
    this.#scheduleCancelHandler = fn;
  }

  // === A2.10: tool agente — leggere la cronologia dei task su richiesta (senza iniettarla) ===
  // getTaskStatus / getTaskResult / readHandoff. Leggono da schedules.json + executions/ + handoffs/.
  #buildTaskTools(sessionKey: string): any[] {
    const self = this;
    const agentDir = this.#agentDir;
    const schedFile = path.join(agentDir, "schedules.json");
    const execDir = path.join(agentDir, "executions");
    const handoffFile = path.join(agentDir, "handoffs", sessionKey, "handoff.md");

    const readSchedules = (): any[] => {
      try { if (!fs.existsSync(schedFile)) return []; return JSON.parse(fs.readFileSync(schedFile, "utf8") || "[]"); } catch { return []; }
    };
    const readExec = (id: string): any | null => {
      try {
        const p = path.join(execDir, id, "execution.json");
        if (!fs.existsSync(p)) return null;
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch { return null; }
    };
    const readExecEvents = (id: string): any[] => {
      try {
        const p = path.join(execDir, id, "events.jsonl");
        if (!fs.existsSync(p)) return [];
        return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l: string) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      } catch { return []; }
    };
    const lastAssistantText = (id: string): string => {
      const evs = readExecEvents(id);
      for (let i = evs.length - 1; i >= 0; i--) {
        const e = evs[i];
        if (e?.type === "assistant" && e?.text) return String(e.text);
      }
      return "";
    };

    const statusTool = defineTool({
      name: "getTaskStatus",
      label: "Get task status",
      description: "List the status of all tasks (scheduled and executed) belonging to this chat/session. Use it when the user asks 'what's the status of my tasks?', 'a che punto sono i task?', or wants to know what is scheduled. Returns scheduled tasks (with their time) and executed tasks (with their status).",
      promptSnippet: "getTaskStatus: list scheduled and executed tasks of this session with their status",
      promptGuidelines: [
        "Use this when the user asks about the status/progress of their tasks.",
        "Scheduled tasks show when they will run; executed tasks show their status (executed/running).",
      ],
      parameters: Type.Object({}),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        try {
          const scheds = readSchedules().filter((s: any) => s?.sourceSession?.key === sessionKey);
          const execs: any[] = [];
          try {
            if (fs.existsSync(execDir)) {
              for (const d of fs.readdirSync(execDir)) {
                const ex = readExec(d);
                if (ex && ex?.sourceSession?.key === sessionKey) execs.push(ex);
              }
            }
          } catch {}
          const lines: string[] = [];
          if (scheds.length === 0 && execs.length === 0) {
            lines.push("No tasks found for this session.");
          }
          if (scheds.length > 0) {
            lines.push("SCHEDULED TASKS:");
            for (const s of scheds) {
              const when = s.when || {};
              let w = `type=${when.type}`;
              if (when.type === "once" && when.date) w += ` at ${when.date}`;
              else if (when.at) w += ` at ${when.at}`;
              // FIX P2 #11 (2026-09-08): tempo LOCALE (non UTC) — il modello confondeva
              // i tempi UTC con quelli locali e diceva "it ran late" quando era in orario.
              lines.push(`- [${s.enabled ? "enabled" : "disabled"}] ${s.title || s.id} — ${w}${s.nextFireAt ? " (next: " + new Date(s.nextFireAt).toLocaleString("en-US", { timeZoneName: "short" }) + ")" : ""}`);
            }
          }
          if (execs.length > 0) {
            lines.push("EXECUTED TASKS:");
            for (const ex of execs) {
              // FIX P2 #11: tempo LOCALE con timezone per chiarezza
              lines.push(`- ${ex.label || ex.id} — status=${ex.status}${ex.endedAt ? " ended " + new Date(ex.endedAt).toLocaleString("en-US", { timeZoneName: "short" }) : ""}`);
            }
          }
          return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error reading task status: ${e?.message || String(e)}` }], isError: true };
        }
      },
    });

    const resultTool = defineTool({
      name: "getTaskResult",
      label: "Get task result",
      description: "Read the full result of a specific task execution (by execution id). Use it when the user asks 'what did task X do?', 'che ne pensi del risultato di X?', or wants to discuss a task's outcome. Returns the task label, status, the final text produced, and the model used.",
      promptSnippet: "getTaskResult: read the full result of a specific task execution by id",
      promptGuidelines: [
        "The execution id looks like ex_<timestamp>_<random>.",
        "Use getTaskStatus first to find the execution id if the user doesn't provide it.",
      ],
      parameters: Type.Object({
        executionId: Type.String({ description: "The execution id (ex_...) of the task" }),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        try {
          const id = String(params?.executionId || "");
          const ex = readExec(id);
          if (!ex) return { content: [{ type: "text", text: `Execution ${id} not found.` }], isError: true };
          const final = lastAssistantText(id);
          const parts: string[] = [];
          parts.push(`Task: ${ex.label || id}`);
          parts.push(`Status: ${ex.status}`);
          if (ex.model) parts.push(`Model: ${ex.model}`);
          if (ex.thinkingLevel) parts.push(`Thinking: ${ex.thinkingLevel}`);
          if (ex.scheduledFor) parts.push(`Scheduled for: ${new Date(ex.scheduledFor).toISOString()}`);
          if (ex.endedAt) parts.push(`Ended: ${new Date(ex.endedAt).toISOString()}`);
          if (ex.error) parts.push(`Error: ${ex.error}`);
          parts.push("");
          parts.push("RESULT:");
          parts.push(final || "(no final text)");
          return { content: [{ type: "text", text: parts.join("\n") }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error reading result: ${e?.message || String(e)}` }], isError: true };
        }
      },
    });

    const handoffTool = defineTool({
      name: "readHandoff",
      label: "Read handoff",
      description: "Read the handoff file of this session (the memory of what the scheduled tasks have done). Use it when the user asks 'what have the tasks done?', 'cosa hanno fatto i task?', or wants the history of task work. Returns the full handoff content (or the last N lines / a search).",
      promptSnippet: "readHandoff: read the handoff memory of this session's tasks",
      promptGuidelines: [
        "The handoff is the persistent memory of the tasks of this session.",
        "Use lastLines to read only the most recent part, or search to find a specific topic.",
      ],
      parameters: Type.Object({
        lastLines: Type.Optional(Type.Number({ description: "Read only the last N lines (default: all)" })),
        search: Type.Optional(Type.String({ description: "Only return lines containing this text" })),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        try {
          if (!fs.existsSync(handoffFile)) {
            return { content: [{ type: "text", text: "No handoff file yet for this session (no task has run yet)." }] };
          }
          let content = fs.readFileSync(handoffFile, "utf8");
          const search = String(params?.search || "");
          if (search) {
            content = content.split("\n").filter((l: string) => l.toLowerCase().includes(search.toLowerCase())).join("\n");
          }
          const lastLines = Number(params?.lastLines || 0);
          if (lastLines > 0) {
            content = content.split("\n").slice(-lastLines).join("\n");
          }
          if (!content.trim()) return { content: [{ type: "text", text: "(no matching lines)" }] };
          return { content: [{ type: "text", text: content.slice(0, 20000) }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Error reading handoff: ${e?.message || String(e)}` }], isError: true };
        }
      },
    });

    return [statusTool, resultTool, handoffTool];
  }

  // === Tool personalizzato: schedule_task (A2.2) — l'agente può PROGRAMMARE un compito dal dialogo ===
  // "domani alle 7 fammi X" → il modello chiama schedule_task → il Scheduler crea la schedule.
  #buildScheduleTool(sessionKey: string): any {
    const self = this;
    return defineTool({
      name: "schedule_task",
      label: "Schedule task",
      description: "Schedule an autonomous task that runs later or on a recurring basis (once, daily, weekly, monthly). Use it when the user asks to run something at a specific time or repeatedly (e.g. 'tomorrow at 7am do X', 'every morning at 8 run Y'). The task runs automatically at the chosen time; if the app is closed at that moment, it runs as soon as possible afterwards (late, never skipped).",
      promptSnippet: "schedule_task: schedule a task for automatic execution at a chosen time/recurrence",
      promptGuidelines: [
        "When the user asks to do something later or on a schedule, use schedule_task instead of doing it now.",
        "CURRENT DATE AND TIME (use this to compute when dates/times): " + new Date().toString() + " (ISO: " + new Date().toISOString() + ").",
        "when.type: once = specific date; daily = every day at HH:MM; weekly = specific weekdays; monthly = specific day of month.",
        "at is LOCAL time in 24h HH:MM (e.g. 07:00). For weekly, daysOfWeek uses 1=Monday ... 7=Sunday.",
        "text must be the exact task the agent must perform when it fires.",
        "agentIds: optional. The system automatically assigns the task to the agent that schedules it. Only set agentIds if the user explicitly names a different agent.",
        "If the user asks for a specific model or thinking level for the task, pass model and thinkingLevel.",
        "After scheduling, confirm to the user what was scheduled and when.",
      ],
      parameters: Type.Object({
        title: Type.Optional(Type.String({ description: "Short label for the scheduled task" })),
        text: Type.String({ description: "The exact task/prompt to execute when the schedule fires" }),
        when: Type.Object({
          type: Type.Union([Type.Literal("once"), Type.Literal("daily"), Type.Literal("weekly"), Type.Literal("monthly")], { description: "once | daily | weekly | monthly" }),
          at: Type.Optional(Type.String({ description: "Local time HH:MM (24h), e.g. 07:00 (daily/weekly/monthly)" })),
          daysOfWeek: Type.Optional(Type.Array(Type.Number(), { description: "1=Monday ... 7=Sunday (weekly)" })),
          dayOfMonth: Type.Optional(Type.Number({ description: "Day of month 1-31 (monthly)" })),
          date: Type.Optional(Type.String({ description: "ISO date+time for once, e.g. 2026-08-10T07:00:00" })),
        }),
        agentIds: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: "Agent(s) to run the task, default ['orchestrator']" })),
        workingDir: Type.Optional(Type.String({ description: "Working directory for the task" })),
        mode: Type.Optional(Type.String({ description: "plan or build (default build)" })),
        model: Type.Optional(Type.String({ description: "Model to run this task with (e.g. 'deepseek/deepseek-v4-flash-0731'). Only if the user specifies one." })),
        thinkingLevel: Type.Optional(Type.String({ description: "Thinking level: off | low | medium | high | xhigh. Only if the user specifies one." })),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        try {
          self.logDebug("schedule-task-call", { sessionKey, params: JSON.stringify(params)?.slice(0, 400) });
          // FIX (01 set): se l'utente NON specifica agentIds, il task lo esegue
          // L'AGENTE CHE LO SCHEDULA (non orchestrator). Solo se l'utente nomina
          // esplicitamente un agente diverso, viene usato quello.
          if (!params.agentIds || (Array.isArray(params.agentIds) && params.agentIds.length === 0)) {
            const sessionAgentId = (self.#entries.get(sessionKey) as any)?.agentId || '';
            const callingAgent = String(sessionAgentId).split(',').map((s: string) => s.trim()).filter(Boolean);
            if (callingAgent.length > 0) {
              // Se è una sessione multi-agente, usa l'agente ATTIVO (quello che ha chiamato il tool)
              // Per ora prendiamo il primo agente valido della sessione
              params.agentIds = [callingAgent[0]];
              self.logDebug("schedule-task-default-agent", { sessionKey, callingAgent: callingAgent[0] });
            }
          }
          if (!self.#scheduleHandler) {
            return { content: [{ type: "text", text: "Scheduling is not available in this sidecar yet." }], isError: true };
          }
          const srcLabel = (self.#entries.get(sessionKey) as any)?.label || sessionKey;
          const r = self.#scheduleHandler({ ...params, sourceSession: { key: sessionKey, label: srcLabel } });
          const when = params.when || {};
          let whenText = `type=${when.type}`;
          if (when.type === "once" && when.date) whenText += ` at ${when.date}`;
          else if (when.at) {
            whenText += ` at ${when.at}`;
            if (when.type === "weekly") whenText += ` (days ${(when.daysOfWeek || []).join(",")})`;
            if (when.type === "monthly") whenText += ` (day ${when.dayOfMonth})`;
          }
          self.logDebug("schedule-task-created", { sessionKey, scheduleId: r?.id, whenText, text: params.text?.substring(0, 200) });
          return { content: [{ type: "text", text: `Task scheduled successfully. Schedule ID: ${r?.id}. When: ${whenText}. It runs automatically; if the app is closed at that time it will run as soon as possible afterwards.` }] };
        } catch (e: any) {
          self.logDebug("schedule-task-error", { sessionKey, error: e?.message || String(e) });
          return { content: [{ type: "text", text: `Unable to schedule: ${e?.message || String(e)}` }], isError: true };
        }
      },
    });
  }

  // === Tool personalizzato: cancel_schedule (P2 #10) — l'agente può CANCELLARE una schedule ===
  // L'utente dice "cancel the task I scheduled" → il modello chiama cancel_schedule.
  #buildCancelScheduleTool(sessionKey: string): any {
    const self = this;
    return defineTool({
      name: "cancel_schedule",
      label: "Cancel schedule",
      description: "Cancel/delete a scheduled task by its schedule ID. Use it when the user asks to cancel, delete, or stop a task that was previously scheduled (e.g. 'cancel the 7am task', 'stop the daily report').",
      promptSnippet: "cancel_schedule: cancel a previously scheduled task by its ID",
      promptGuidelines: [
        "Use cancel_schedule when the user asks to cancel or stop a scheduled task.",
      ],
      parameters: Type.Object({
        scheduleId: Type.String({ description: "The ID of the schedule to cancel (e.g. 'sch-...')" }),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        try {
          self.logDebug("cancel-schedule-call", { sessionKey, scheduleId: params.scheduleId });
          if (!self.#scheduleCancelHandler) {
            return { content: [{ type: "text", text: "Schedule cancellation is not available in this sidecar." }], isError: true };
          }
          const r = self.#scheduleCancelHandler({ id: String(params.scheduleId) });
          self.logDebug("cancel-schedule-done", { sessionKey, scheduleId: params.scheduleId, ok: r?.ok });
          return { content: [{ type: "text", text: r?.ok ? `Schedule ${params.scheduleId} cancelled successfully. It will no longer fire.` : `Schedule ${params.scheduleId} not found or already cancelled.` }] };
        } catch (e: any) {
          self.logDebug("cancel-schedule-error", { sessionKey, error: e?.message || String(e) });
          return { content: [{ type: "text", text: `Unable to cancel: ${e?.message || String(e)}` }], isError: true };
        }
      },
    });
  }

  // === Per-agent API key injection ===
  #activeApiKeys: string[] = []; // env vars attualmente caricate
  #agentOverride: Map<string, string> = new Map(); // sessionKey -> agentId (cambio agente mid-session)
  #agentOverridePrior: Map<string, string | null> = new Map(); // ultimo agentId per cui è stato chiamato setAgent (anti-recreate)

  #clearActiveApiKeys() {
    for (const v of this.#activeApiKeys) {
      delete process.env[v];
    }
    this.#activeApiKeys = [];
  }

  #injectApiKeysForAgent(agentConfig: any) {
    // Clear key dell'agente precedente
    this.#clearActiveApiKeys();
    if (!agentConfig?.skills?.length) return;
    try {
      for (const skillName of agentConfig.skills) {
        const skillPath = path.join(this.#agentDir, "skills", skillName, "SKILL.md");
        if (!fs.existsSync(skillPath)) continue;
        const content = fs.readFileSync(skillPath, "utf8");
        const matches = content.matchAll(/\$\{?([A-Z][A-Z_]{5,})\}?/g);
        for (const m of matches) {
          const v = m[1];
          if (['CONTENT','QUERY','HOME','PATH'].includes(v)) continue;
          if (this.#activeApiKeys.includes(v)) continue;
          try {
            if (process.platform === "darwin") {
              const key = execSync(`security find-generic-password -a "quinki" -s "${v}" -w`, { stdio: "pipe", encoding: "utf8" }).trim();
              if (key) { process.env[v] = key; this.#activeApiKeys.push(v); this.logDebug("api-key-injected", { envVar: v, agent: agentConfig.id }); }
            } else {
              const keyFile = path.join(this.#agentDir, "api-keys.json");
              try { const keys = JSON.parse(fs.readFileSync(keyFile, "utf8")); if (keys[v]) { process.env[v] = keys[v]; this.#activeApiKeys.push(v); this.logDebug("api-key-injected", { envVar: v, agent: agentConfig.id }); } } catch {}
            }
          } catch {} // key non nel Keychain, skip
        }
      }
    } catch (e: any) { this.logDebug("inject-api-keys-error", { error: e?.message }); }
  }
  #flutterTarget(): string {
    const os = process.platform;
    return os === "win32" ? "windows" : os === "darwin" ? "macos" : "linux";
  }
  #flutterRunCmd(): string { return `flutter run -d ${this.#flutterTarget()}`; }
  #flutterBuildCmd(): string { return `flutter build ${this.#flutterTarget()} --release`; }
  #expertPidFile(): string {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return path.join(home, ".quinki", "main.pid");
  }
  #expertControlASection(): string {
    const os = process.platform;
    const pid = this.#expertPidFile();
    // A e B sono la STESSA applicazione (multi-window, un solo processo). Killare A = killare l'Expert.
    if (os === "darwin") {
      return `## Come controlli A (PRECISIONE — multi-window, CRITICO)
A (finestra main) e B (tu, finestra Expert) sono **la STESSA applicazione, un solo processo** (multi-window). **Killare A = killare TE STESSO** + tutti i messaggi/risposte in corso.
- **NON usare MAI** \`kill $(cat ${pid})\`, \`pkill -f Dashboard\`, \`pkill -f Quinki\`: ucciderebbero anche te.
- Il PID in \`${pid}\` è il processo condiviso (A+B): informativo, **NON killarlo**.
- A gira l\`.app\` installata in /Applications/Quinki.app (binary compilato, separato dal repo). Le tue modifiche al repo NON la toccano finché non si installa una nuova versione.
- **Durante lo sviluppo**: testa su **C** (dev \`flutter run\` con \`QUINKI_AGENT_DIR=~/.pi/agent-dev\`, sidecar isolato). NON toccare A.
- **MAI "Salva e riavvia" + MAI \`cp\` in /Applications** durante lo sviluppo. A continua a girare col vecchio .app; le tue modifiche restano nel repo.
- **Installa SOLO su ordine esplicito "installa" dell'utente**: builda (\`${this.#flutterBuildCmd()}\`) + \`cp -R build/${this.#flutterTarget()}/Build/Products/Release/quinki.app /Applications/Quinki.app\`. Poi **l'utente riavvia A quando vuole** (non tu). **NON fare questo senza "installa" esplicito.**
- Per riavviare **C** (dev): killa il PID di C (lo lanci tu con flutter run), NON A. Quando C muore, il suo sidecar muore con lui (die-with-parent).`;
    }
    if (os === "win32") {
      return `## Come controlli A (PRECISIONE — multi-window, CRITICO)
A (finestra main) e B (tu, finestra Expert) sono **la STESSA applicazione, un solo processo** (multi-window). **Killare A = killare TE STESSO**.
- **NON usare MAI** \`taskkill /im quinki.exe\`, \`kill $(cat ${pid})\`, \`Stop-Process\` sul PID di A: ucciderebbero anche te.
- Il PID in \`${pid}\` è il processo condiviso (A+B): informativo, **NON killarlo**.
- A gira l'app installata (binary compilato, separato dal repo). Le tue modifiche al repo NON la toccano finché non si installa.
- **Durante lo sviluppo**: testa su **C** (dev \`flutter run\` con \`QUINKI_AGENT_DIR=~/.pi/agent-dev\`, sidecar isolato). NON toccare A.
- **MAI "Salva e riavvia" + MAI installa** durante lo sviluppo. A continua a girare; le tue modifiche restano nel repo.
- **Installa SOLO su ordine esplicito "installa" dell'utente**: builda (\`${this.#flutterBuildCmd()}\`) + installa. Poi **l'utente riavvia A quando vuole** (non tu). **NON fare questo senza "installa" esplicito.**
- Per riavviare **C** (dev): killa il PID di C, NON A.`;
    }
    // linux
    return `## Come controlli A (PRECISIONE — multi-window, CRITICO)
A (finestra main) e B (tu, finestra Expert) sono **la STESSA applicazione, un solo processo** (multi-window). **Killare A = killare TE STESSO**.
- **NON usare MAI** \`kill $(cat ${pid})\`, \`pkill -f quinki\`, \`pkill -f quinki\`: ucciderebbero anche te.
- Il PID in \`${pid}\` è il processo condiviso (A+B): informativo, **NON killarlo**.
- A gira l'app installata (binary compilato, separato dal repo). Le tue modifiche al repo NON la toccano finché non si installa.
- **Durante lo sviluppo**: testa su **C** (dev \`flutter run\` con \`QUINKI_AGENT_DIR=~/.pi/agent-dev\`, sidecar isolato). NON toccare A.
- **MAI "Salva e riavvia" + MAI \`cp\` in /Applications (o dove installi)** durante lo sviluppo. A continua a girare; le tue modifiche restano nel repo.
- **Installa SOLO su ordine esplicito "installa" dell'utente**: builda (\`${this.#flutterBuildCmd()}\`) + installa. Poi **l'utente riavvia A quando vuole** (non tu). **NON fare questo senza "installa" esplicito.**
- Per riavviare **C** (dev): killa il PID di C, NON A.`;
  }

  #expertSystemPrompt(cwd?: string): string {
    // Delega a #readAgentPrompt che legge da ~/.pi/agent/agents/app-expert/PROMPT.md
    return this.#readAgentPrompt("app-expert", cwd);
  }

  #expertSystemPromptFallback(cwd?: string): string {
    return `Sei il **Quinki Expert**, lo sviluppatore automatico dell'app Quinki.

## Chi sei
Sei un agente sviluppatore che lavora al posto dell'utente: implementi feature, correggi bug, scrivi test, buildi e installi nuove versioni di Dashboard. L'utente ti dice cosa fare e tu arrivi al prodotto finito.

## Conoscenza del codice
La mappa completa del codebase è nella skill **app-expert** (caricata automaticamente): architettura, ruolo dei file, convenzioni, flussi. Consultala SEMPRE prima di operare. Per le modifiche precise leggi i file veri col tool \`read\`.

## Architettura (riassunto)
Dashboard = app di chat in **Flutter** (desktop: macOS/Windows/Linux) (lib/) + **sidecar Node/bun** (sidecar-src/) che bridga il **Pi SDK** (@earendil-works/pi-coding-agent). Dettagli nella skill app-expert.

## Dove lavori
Lavori nel **clone locale** del repo (la tua cwd). Tutte le modifiche avvengono qui.

## Supervisore — finestre e processi (CRITICO, multi-window)
- **A** = l'app **installata** (finestra main), quella che l'utente usa. **RESTA APERTA mentre tu sviluppi. NON toccarla durante il dev.**
- **B** = **tu** (finestra Expert). A e B sono **la STESSA applicazione, un solo processo** (multi-window): **se A muore, muori anche tu.** Quindi **non killare mai A** (vedi "Come controlli A").
- **C** = l'istanza **DEV** che lanci tu con \`flutter run\` dal clone (processo separato). È il **bersaglio dei test**, NON A.

## Workflow di sviluppo
1. Pianifica (Plan mode per capire, poi Build per eseguire).
2. Modifica i file nel clone (write/edit).
3. Testa in dev: \`${this.#flutterRunCmd()}\` (dal clone) → apre **C** (dev, separata da A). Verifica su C.
4. Test automatici: \`flutter test\`.
5. Se serve riavviare per testare → killa **C** (NON A) e rilancia \`flutter run\`. Tu resti vivo.
6. Tutto perfetto → \`${this.#flutterBuildCmd()}\` + installa, poi **chiedi all'utente di cliccare "Salva e riavvia"** in Impostazioni (NON killare A tu — moriresti, vedi "Come controlli A").

${this.#expertControlASection()}

## Tool
read, grep, glob, ls, write, edit, bash, skill. Usa \`bash\` per flutter/git/kill/open.

## Regole
- Lavora solo nel clone. Non toccare A finché non è il momento dell'update finale.
- Spiega all'utente cosa fai. Chiedi conferma prima dell'update finale di A.
- Tieni aggiornata la skill app-expert quando cambi qualcosa d'importante nel codice.`;
  }

  // Risolve l'agentId per una session: override > entry > key parse
  #resolveAgentId(key: string): string | null {
    return this.#agentOverride.get(key) ?? this.#entries.get(key)?.agentId ?? this.#getAgentIdFromKey(key);
  }

  // === Tool personalizzato: delegate_to_agent per l'Orchestrator ===
async sendDirect(ws: any, data: { sessionKey: string; text: string; agentId: string; files?: any[]; workingDirs?: string[] }) {
    const sk = data.sessionKey;
    const targetId = data.agentId;
    const s = this.#entries.get(sk);
    if (!s) return;

    const effEntryWd = (this.#entries.get(sk) as any)?.workingDir
    const effectiveCwd = this.#cwdOverride.get(sk) ?? ((data.workingDirs && data.workingDirs.length > 0) ? data.workingDirs[0] : (effEntryWd || this.#cwd));
    this.#lastEffectiveCwd.set(sk, effectiveCwd);

    // Resolve agent config
    const agentConfig = this.#readAgentConfigFile(targetId) || { skills: [] };
    const agentName = agentConfig?.name || targetId;
    const agentPrompt = this.#readAgentPrompt(targetId, this.#cwd);
    const skillPaths = this.#resolveSkillPaths(agentConfig, this.#cwd);

    this.logDebug("send-direct-start", { sessionKey: sk, agentId: targetId, agentName, text: data.text?.substring(0, 100) });

    // Inject API keys for this agent
    const savedKeys = [...this.#activeApiKeys];
    this.#injectApiKeysForAgent(agentConfig);

    // Create temp session (clean, no orchestrator history)
    const tempKey = `__direct_${sk}_${targetId}_${Date.now()}`;
    const tempSessionDir = path.join(this.#agentDir, "sessions", "quinki", tempKey);
    if (!fs.existsSync(tempSessionDir)) fs.mkdirSync(tempSessionDir, { recursive: true });
    const tempLoader = new this.#sdk.DefaultResourceLoader({
      cwd: effectiveCwd,
      agentDir: this.#agentDir,
      systemPrompt: agentPrompt,
      appendSystemPrompt: [],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalSkillPaths: skillPaths,
    });
    await tempLoader.reload();
    const tempSm = this.#sdk.SessionManager.open(
      path.join(tempSessionDir, "session.jsonl"),
      tempSessionDir,
      effectiveCwd
    );
    const tempResult = await this.#sdk.createAgentSession({
      cwd: effectiveCwd,
      agentDir: this.#agentDir,
      sessionManager: tempSm,
      resourceLoader: tempLoader,
    });
    const tempPi = tempResult.session;
    try { tempPi.toolExecution = "sequential"; } catch {}
    this.#active.set(tempKey, tempPi);
    // Apply tools first (setActiveToolsByName rebuilds _baseSystemPrompt)
    const mainModeSD = s.mode || "plan";
    try {
      const globalConfig = this.#readGlobalConfig();
      const globalTools = globalConfig.tools || ["read", "grep", "find", "ls", "skill"];
      const agentTools = agentConfig?.tools || [];
      const mergedTools = [...new Set([...globalTools, ...agentTools])];
      const all = (tempPi.getAllTools?.() ?? []).map((t: any) => t.name) as string[];
      let tempToolNames = mergedTools.filter(n => all.includes(n));
      if (mainModeSD === "plan") {
        const planFlags = globalConfig.planModeTools || {};
        tempToolNames = tempToolNames.filter(n => planFlags[n] !== false);
      }
      try { tempPi.setActiveToolsByName?.(tempToolNames); } catch {}
    } catch {}
    // Build system prompt AFTER setActiveToolsByName (same as #applyMode + skills)
    try {
      let base = (tempPi as any)._baseSystemPrompt || tempPi.agent.state.systemPrompt || "";
      const note = this.#modeNote(mainModeSD);
      if (typeof base === "string" && !base.includes(agentConfig?.name || "§§")) {
        base = agentPrompt + `\n\nWorking directory: ${this.#cwd}\n\n` + base;
      }
      if (typeof base === "string" && base.length > 0 && note) {
        const planIdx = base.indexOf("\n\nSei in MODALITÀ PIANO");
        const buildIdx = base.indexOf("\n\nSei in MODALITÀ BUILD");
        const planIdxEn = base.indexOf("\n\nYou are in PLAN MODE");
        const buildIdxEn = base.indexOf("\n\nYou are in BUILD MODE");
        const cut = Math.max(planIdx, buildIdx, planIdxEn, buildIdxEn);
        if (cut >= 0) base = base.substring(0, cut);
        base = base + note;
      }
      if (tempPi?.resourceLoader) {
        try {
          const skills = tempPi.resourceLoader.getSkills().skills;
          if (skills && skills.length > 0 && typeof base === "string" && !base.includes("skill tool")) {
            base = base + `\n\nYou have ${skills.length} skill(s) available. Use the skill tool with command='list' to see them, command='search' to find relevant ones, and command='load' to read full instructions. Always check your skills before answering.`;
          }
        } catch {}
      }
      if (typeof base === "string" && base.length > 0) {
        (tempPi as any)._baseSystemPrompt = base;
        tempPi.agent.state.systemPrompt = base;
      }
      this.logDebug("send-direct-system-prompt", { sessionKey: sk, mode: mainModeSD, promptLen: base?.length || 0, hasSkills: base?.includes("available_skills"), hasModeNote: base?.includes("MODALITÀ") });
      // Log delegated agent system prompt for debugging
    } catch {}

    // Apply model: session override > agent config > main session
    const sessionOverrides = (s as any)?.agentOverrides || {};
    const agentOverride = sessionOverrides[targetId] || {};
    const agentModelId = agentOverride.model;
    const mainSession = this.#active.get(sk);
    if (agentModelId) {
      try {
        const authPath = path.join(this.#agentDir, "auth.json");
        const modelsPath = path.join(this.#agentDir, "models.json");
        const registry = await this.#createRegistry();
        const agentModel = this.#findModelInRegistry(registry, agentModelId);
        if (agentModel) {
          await tempPi.setModel(agentModel);
          this.logDebug("send-direct-model", { sessionKey: sk, model: agentModelId });
        } else if (mainSession?.model) {
          try { await tempPi.setModel(mainSession.model); } catch {}
        }
      } catch (e: any) { this.logDebug("send-direct-model-error", { sessionKey: sk, error: e?.message }); }
    } else if (mainSession?.model) {
      try { await tempPi.setModel(mainSession.model); } catch {}
    }

    // Apply thinking level: session override > main session
    const agentThinking = agentOverride.thinkingLevel;
    if (agentThinking === 'on') {
      const sessionLevel = mainSession?.thinkingLevel;
      const level = (sessionLevel && sessionLevel !== 'off') ? sessionLevel : 'xhigh';
      try { tempPi.setThinkingLevel(level); } catch {}
    } else if (agentThinking === 'off') {
      try { tempPi.setThinkingLevel('off'); } catch {}
    } else if (mainSession?.thinkingLevel) {
      try { tempPi.setThinkingLevel(mainSession.thinkingLevel); } catch {}
    }

    // Emit delegation_start (reuse delegation UI)
    const delegationId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.#sendToWs(ws, { type: "stream_event", sessionKey: sk, eventType: "delegation_start", messageId: delegationId, agentName, task: data.text });

    // Subscribe to temp session events → forward to main WS
    let delegationContent: any[] = [];
    const tempSub = tempPi.subscribe((e: any) => {
      if (e.type === "tool_execution_start") {
        this.#sendToWs(ws, { type: "stream_event", sessionKey: sk, eventType: "toolcall_start", delta: e.toolName || "", messageId: delegationId });
        let argsStr = "";
        try { argsStr = typeof e.args === "string" ? e.args : JSON.stringify(e.args, null, 2); } catch {}
        if (argsStr) this.#sendToWs(ws, { type: "stream_event", sessionKey: sk, eventType: "toolcall_delta", delta: argsStr, messageId: delegationId });
      } else if (e.type === "tool_execution_end") {
        let resultText = "";
        try {
          const r = e.result;
          if (r?.content) {
            if (Array.isArray(r.content)) {
              resultText = r.content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("");
            } else if (typeof r.content === "string") { resultText = r.content; }
          }
        } catch {}
        this.#sendToWs(ws, { type: "stream_event", sessionKey: sk, eventType: "toolcall_end", delta: resultText, messageId: delegationId, isError: !!e.isError });
      } else if (e.type === "message_update" && e.assistantMessageEvent && e.message?.role === "assistant") {
        const ame = e.assistantMessageEvent;
        if (ame.type === "toolcall_start" || ame.type === "toolcall_delta" || ame.type === "toolcall_end") return;
        this.#sendToWs(ws, { type: "stream_event", sessionKey: sk, eventType: ame.type, delta: ame.delta || "", messageId: delegationId });
      }
    });

    // === Unified agent_llm_config log: what the LLM actually receives ===
    {
      let actualModel = ""; try { actualModel = tempPi.model?.id || ""; } catch {}
      let actualThinking = ""; try { actualThinking = tempPi.thinkingLevel || ""; } catch {}
      const sEntry = this.#entries.get(sk);
      let thinkingTranslated = this.#translateThinkingForModel(actualThinking, actualModel);
      this.logDebug("agent_llm_config", {
        sessionKey: sk,
        source: "direct",
        agentId: targetId,
        agentName,
        model: actualModel,
        thinkingLevel: actualThinking,
        thinkingTranslated,
        chatModel: sEntry?.model || "",
        chatThinking: sEntry?.thinkingLevel || "",
        agentOverrideModel: agentOverride.model || null,
        agentOverrideThinking: agentOverride.thinkingLevel || null,
        systemPromptLen: (tempPi as any)._baseSystemPrompt?.length || 0,
      });
    }

    // Send the user's message to the temp session
    this.logDebug("send-direct-sending", { sessionKey: sk, agentName, text: data.text?.substring(0, 100) });
    const { content } = await this.#buildUserMessage(data.text, data.files);
    await tempPi.sendUserMessage(content, { deliverAs: "followUp" });

    // Cleanup subscription
    try { tempSub(); } catch {}

    // Collect response
    let responseText = "";
    try {
      const msgs = (tempPi.agent?.state?.messages || []) as any[];
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i]?.role === "assistant") {
          const c = msgs[i]?.content;
          if (Array.isArray(c)) {
            for (const block of c) {
              if (block?.type === "text" && block.text) { responseText = block.text; break; }
            }
          } else if (typeof c === "string") { responseText = c; }
          if (responseText) break;
        }
      }
    } catch (e: any) { this.logDebug("send-direct-collect-error", { sessionKey: sk, error: e?.message }); }

    // Collect delegation content for persistence
    try {
      // Prova getEntries prima (più completo di buildSessionContext)
      const tempSm = (tempPi as any)?.sessionManager || (tempPi as any)?.agent?.state?.sessionManager;
      const tempEntries = tempSm?.getEntries?.() || [];
      for (const ent of tempEntries) {
        if (ent?.type === "message" && ent?.message?.role === "assistant") {
          const blocks = Array.isArray(ent.message?.content) ? ent.message.content : [];
          for (const b of blocks) {
            if (b?.type === "thinking" && b.thinking) delegationContent.push({ type: "thinking", thinking: b.thinking, timestamp: Date.now() });
            if (b?.type === "text" && b.text) delegationContent.push({ type: "text", text: b.text, timestamp: Date.now() });
            if (b?.type === "toolCall") {
              const argsStr = typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments || {}, null, 2);
              delegationContent.push({ type: "toolCall", text: b.name || 'tool', thinking: argsStr, streaming: false, timestamp: Date.now() });
            }
          }
        } else if (ent?.type === "message" && ent?.message?.role === "tool") {
          const resultText = typeof ent.message?.content === 'string' ? ent.message.content : this.#parseContent(ent.message?.content);
          delegationContent.push({ type: "toolResult", text: ent.message?.toolName || 'tool', thinking: resultText, streaming: false, isError: !!ent.message?.isError, timestamp: Date.now() });
        }
      }
      for (const m of tempMsgs) {
        if (m?.role === "tool" || m?.role === "toolResult") {
          // Messaggio tool result: content è stringa o array
          const resultText = typeof m?.content === 'string' ? m.content : this.#parseContent(m?.content);
          delegationContent.push({ type: "toolResult", text: m?.toolName || m?.name || 'tool', thinking: resultText, streaming: false, isError: !!m?.isError, timestamp: Date.now() });
        } else {
          // Messaggio assistant: blocks nell'array content
          const blocks = Array.isArray(m?.content) ? m.content : [];
          for (const b of blocks) {
            if (b?.type === "thinking" && b.thinking) delegationContent.push({ type: "thinking", thinking: b.thinking, timestamp: Date.now() });
            if (b?.type === "text" && b.text) delegationContent.push({ type: "text", text: b.text, timestamp: Date.now() });
            if (b?.type === "toolCall") {
              const argsStr = typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments || {}, null, 2);
              delegationContent.push({ type: "toolCall", text: b.name || 'tool', thinking: argsStr, streaming: false, timestamp: Date.now() });
            }
            if (b?.type === "toolResult") {
              delegationContent.push({ type: "toolResult", text: b.name || 'tool', thinking: this.#parseContent(b.content), streaming: false, isError: !!b.isError, timestamp: Date.now() });
            }
          }
        }
      }
    } catch {}

    // Get actual model + thinking from temp session
    const delModel = (tempPi?.model?.id ?? '') || agentOverride.model || (mainSession?.model?.id ?? '') || '';
    const delThinking = tempPi?.thinkingLevel || agentOverride.thinkingLevel || mainSession?.thinkingLevel || '';

    // Emit delegation_end
    this.#sendToWs(ws, { type: "stream_event", sessionKey: sk, eventType: "delegation_end", messageId: delegationId, agentName, response: responseText, model: delModel, thinkingLevel: delThinking });

    // Save delegation for persistence
    this.#appendDelegationToJsonl(sk, { id: delegationId, agentName, delegatedMessage: data.text, content: delegationContent, timestamp: Date.now(), model: delModel, thinkingLevel: delThinking });

    // Save agentName for this message
    try {
      const entry = this.#entries.get(sk) as any;
      if (entry) {
        if (!entry.messageAgents) entry.messageAgents = {};
        entry.messageAgents[delegationId] = agentName;
        this.#save();
        this.logDebug("send-direct-agent-saved", { sessionKey: sk, delegationId, agentName });
      }
    } catch {}

    // Cleanup temp session
    this.#active.delete(tempKey);
    try { (tempPi as any).dispose?.(); } catch {}
    try { fs.rmSync(tempSessionDir, { recursive: true, force: true }); } catch {}

    // Restore API keys
    this.#activeApiKeys = savedKeys;

    this.logDebug("send-direct-done", { sessionKey: sk, agentName, responseLen: responseText.length });
  }

  async #buildMcpTools(sk: string, agentId: string | null): Promise<any[]> {
    const agentCfg = agentId ? this.#readAgentConfigFile(agentId) : null;
    const ids: string[] = Array.isArray(agentCfg?.mcpServers) ? agentCfg.mcpServers : [];
    this.#mcpToolNames.delete(sk);
    if (ids.length === 0) return [];
    const self = this;
    const tools: any[] = [];
    const used = new Set<string>(["skill", "delegate_to_agent", "schedule_task"]);
    for (const sid of ids) {
      const server = readMcpServers().find((s: any) => s.id === sid);
      if (!server) {
        this.logDebug("mcp-server-missing", { sessionKey: sk, serverId: sid });
        continue;
      }
      try {
        let list: any[] = [];
        if (server.type === "url") {
          list = await httpListTools(server.source, server.env);
        } else {
          const client = this.#getMcpClient(sk, server);
          list = await client.listTools();
        }
        if (!Array.isArray(list)) list = [];
        for (const t of list) {
          const rawName = typeof t?.name === "string" && t.name ? t.name : "";
          if (!rawName) continue;
          let name = rawName;
          let i = 1;
          while (used.has(name)) name = `${rawName}_${i++}`;
          used.add(name);
          const desc = `${t?.description || ""} (MCP server: ${server.name})`.trim();
          const parameters = mcpSchemaToTypeBox(t?.inputSchema || {});
          const serverRef = server;
          tools.push(defineTool({
            name,
            label: server.name,
            description: desc || `Tool from MCP server ${server.name}`,
            promptSnippet: `${name}: MCP tool from server "${server.name}"`,
            promptGuidelines: [`Tool provided by MCP server "${server.name}". Call it with the documented arguments.`],
            parameters,
            async execute(_toolCallId: string, params: any): Promise<any> {
              try {
                let res: any;
                if (serverRef.type === "url") {
                  res = await httpCallTool(serverRef.source, rawName, params || {}, serverRef.env);
                } else {
                  res = await self.#getMcpClient(sk, serverRef).callTool(rawName, params || {});
                }
                return { content: [{ type: "text", text: mcpResultToText(res) }] };
              } catch (e: any) {
                return { content: [{ type: "text", text: `MCP tool error (${serverRef.name} / ${rawName}): ${e?.message || e}` }], isError: true };
              }
            },
          }));
        }
        // Registra i tool per sessione → applyMode li attiva (plan: solo da server in planModeMcp)
        const prev = self.#mcpToolNames.get(sk) || [];
        for (const t of list) {
          const nm = typeof t?.name === 'string' && t.name ? t.name : '';
          if (nm) prev.push({ name: nm, serverId: sid });
        }
        self.#mcpToolNames.set(sk, prev);
        // FIX (29 ago): NON salvare più la firma qui — il formato era DIVERSO da
        // quello del confronto in #maybeRefreshMcp → non combaciava MAI → dispose
        // a ogni send (il bug 'lo streaming si perde in continuazione'). La firma
        // la salva solo #maybeRefreshMcp, nel formato GIUSTO e deterministico.
        this.logDebug("mcp-tools-registered", { sessionKey: sk, serverId: sid, toolCount: list.length });
      } catch (e: any) {
        this.logDebug("mcp-connect-error", { sessionKey: sk, serverId: sid, error: String(e?.message || e) });
      }
    }
    return tools;
  }

  #getMcpClient(sk: string, server: any): StdioMcpClient {
    const key = `${sk}:${server.id}`;
    let c = this.#mcpClients.get(key);
    if (!c) {
      let launch: string[] = [];
      let dir: string | undefined;
      if (server.type === "command") {
        launch = resolveCommandLaunch(Array.isArray(server.command) ? server.command : []);
        dir = undefined;
      } else {
        const bin = server.bin || "";
        const bun = findBunPath();
        dir = mcpInstallDir(server.id);
        const binPath = path.join(dir, "node_modules", ".bin", bin);
        if (bun) launch = [bun, binPath, ...(server.args || [])];
        else launch = [binPath, ...(server.args || [])];
      }
      c = new StdioMcpClient(server.id, launch, dir, server.env);
      this.#mcpClients.set(key, c);
    }
    return c;
  }

  // ── MCP custom tools (registrate in createAgentSession) ──
  #buildMarketTool(): any {
    const self = this;
    return defineTool({
      name: "market",
      label: "Quinki Market",
      description: "Quinki Market: search and install packages (tabs, skills, agents, MCP servers, themes) from the market directly in the app. Actions: search <query> to find packages, list <category> (tabs|agents|skills|mcp|themes), install <id> to install a package by its id. The app installs it natively.",
      promptSnippet: "market: search and install packages from the Quinki Market",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("search"), Type.Literal("list"), Type.Literal("install")], { description: "Action to perform" }),
        query: Type.Optional(Type.String({ description: "Search text (for action='search')" })),
        category: Type.Optional(Type.String({ description: "Package category: tabs | agents | skills | mcp | themes (for search/list)" })),
        id: Type.Optional(Type.String({ description: "Package id to install (for action='install')" })),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        const action = params?.action;
        const query = params?.query;
        const category = params?.category;
        const id = params?.id;
        const cat: any[] = (globalThis as any).__quinki_market_catalog || []
        try {
          if (action === "search") {
            const q = String(query || "").toLowerCase()
            const res = cat.filter((i: any) => (!q || (i.name || "").toLowerCase().includes(q) || (i.description || "").toLowerCase().includes(q)) && (!category || i.category === category)).slice(0, 15)
            if (res.length === 0) return { content: [{ type: "text", text: "No packages found for that query." }] };
            return { content: [{ type: "text", text: "Packages found (" + res.length + "):\n" + res.map((i: any) => "- " + i.id + " [" + (i.category || "?") + "] " + (i.name || i.id) + (i.description ? " (" + String(i.description).slice(0, 60) + ")" : "")).join("\n") + "\n\nUse market install <id> to install one." }] };
          }
          if (action === "list") {
            const res = cat.filter((i: any) => (!category || i.category === category)).slice(0, 20)
            if (res.length === 0) return { content: [{ type: "text", text: "No packages in this category." }] };
            return { content: [{ type: "text", text: "Packages (" + res.length + "):\n" + res.map((i: any) => "- " + i.id + " [" + (i.category || "?") + "] " + (i.name || i.id)).join("\n") }] };
          }
          if (action === "install") {
            const found = cat.find((i: any) => String(i.id) === String(id || ""))
            if (!found) return { content: [{ type: "text", text: "Package not found: " + String(id || "") + ". Use market search <query> to find it." }] };
            try {
              process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "market_install", params: { id: found.id, category: found.category || "", name: found.name || found.id, source: found.remoteSource || "quinki-market", author: found.author || "", version: found.version || "1.0.0" } }) + "\n");
            } catch {}
            return { content: [{ type: "text", text: "Install requested for " + (found.name || found.id) + " (id: " + found.id + "). The app will install it natively." }] };
          }
          return { content: [{ type: "text", text: "Unknown action. Use: market search <query>, market list <category>, market install <id>." }] };
        } catch (e: any) { return { content: [{ type: "text", text: "market tool error: " + String(e?.message || e) }] }; }
      },
    });
  }

  #buildSkillTool(getPi: () => any): any {
    const self = this;
    return defineTool({
      name: "skill",
      label: "Skill",
      description: "List, search, and load agent skills. Use command='list' to see all available skills, command='search' with a query to find relevant skills, or command='load' with a skill_name to load its full SKILL.md instructions. Always check available skills before answering — they may contain specialized knowledge for your task.",
      promptSnippet: "skill: list, search, and load agent skills",
      promptGuidelines: [
        "Before answering any request, use the skill tool with command='list' to check if any skill is relevant to the task.",
        "If a skill matches, use command='load' to read its full instructions, then follow them.",
        "Skills contain specialized knowledge that can help you respond better — do not ignore them.",
      ],
      parameters: Type.Object({
        command: Type.Union([Type.Literal("list"), Type.Literal("search"), Type.Literal("load")], { description: "Command: 'list' to see all skills, 'search' to find skills by query, 'load' to read a skill's full content" }),
        query: Type.Optional(Type.String({ description: "Search query (for command='search'). Searches skill names and descriptions." })),
        skill_name: Type.Optional(Type.String({ description: "Skill name to load (for command='load'). Use command='list' first to see available names." })),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        const { command, query, skill_name } = params;
        try {
          const pi = getPi();
          if (!pi?.resourceLoader) {
            return { content: [{ type: "text", text: "No skills available (session not initialized)." }] };
          }
          const skillsResult = pi.resourceLoader.getSkills();
          const skills = skillsResult?.skills || [];
          if (skills.length === 0) {
            return { content: [{ type: "text", text: "No skills installed." }] };
          }
          if (command === "list") {
            const lines = ["Available skills:", ""];
            for (const s of skills) {
              lines.push(`- ${s.name}: ${s.description || "(no description)"}`);
            }
            lines.push("", `Total: ${skills.length} skill(s). Use command='load' with skill_name to read full instructions.`);
            return { content: [{ type: "text", text: lines.join("\n") }] };
          }
          if (command === "search") {
            if (!query) {
              return { content: [{ type: "text", text: "Please provide a search query with the 'query' parameter." }] };
            }
            const q = query.toLowerCase();
            const matches = skills.filter((s: any) =>
              s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
            );
            if (matches.length === 0) {
              return { content: [{ type: "text", text: `No skills found matching '${query}'.` }] };
            }
            const lines = [`Skills matching '${query}':`, ""];
            for (const s of matches) {
              lines.push(`- ${s.name}: ${s.description || "(no description)"}`);
            }
            lines.push("", `Use command='load' with skill_name to read full instructions.`);
            return { content: [{ type: "text", text: lines.join("\n") }] };
          }
          if (command === "load") {
            if (!skill_name) {
              return { content: [{ type: "text", text: "Please provide a skill_name with the 'skill_name' parameter." }] };
            }
            const skill = skills.find((s: any) => s.name === skill_name);
            if (!skill) {
              return { content: [{ type: "text", text: `Skill '${skill_name}' not found. Use command='list' to see available skills.` }], isError: true };
            }
            const fs = await import("node:fs");
            const filePath = skill.filePath;
            if (!filePath || !fs.existsSync(filePath)) {
              return { content: [{ type: "text", text: `Skill file not found: ${filePath}` }], isError: true };
            }
            const content = fs.readFileSync(filePath, "utf-8");
            return { content: [{ type: "text", text: content }] };
          }
          return { content: [{ type: "text", text: `Unknown command: ${command}. Use 'list', 'search', or 'load'.` }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `Skill tool error: ${e?.message || String(e)}` }], isError: true };
        }
      },
    });
  }

  #buildBashReadonlyTool(sessionKey: string): any {
    const self = this;
    const { exec } = require("node:child_process");
    return defineTool({
      name: "bash_readonly",
      label: "Bash (read-only)",
      description: "Execute READ-ONLY shell commands (ls, cat, grep, find, git status/log, etc.). Commands that modify, create, delete files, install anything, or write anywhere are BLOCKED.",
      promptSnippet: "bash_readonly: execute read-only shell commands (writes blocked)",
      parameters: Type.Object({
        command: Type.String({ description: "The read-only shell command to execute" }),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        const cmd = String(params?.command || "").trim();
        if (!cmd) return { content: [{ type: "text", text: "[bash_readonly] Empty command." }], isError: true };
        if (self.#isWriteCommand(cmd)) {
          self.logDebug("bash-readonly-tool-blocked", { sessionKey, cmd: cmd.slice(0, 160) });
          return { content: [{ type: "text", text: `[bash_readonly] BLOCKED: this command writes/modifies. Use the full bash tool (if available in this mode) or a read-only command.` }], isError: true };
        }
        try {
          const out: any = await new Promise((resolve, reject) => {
            const child = exec(cmd, { timeout: 120000, maxBuffer: 10 * 1024 * 1024, cwd: self.#cwdOverride?.get(sessionKey) || undefined }, (err, stdout, stderr) => {
              resolve({ err, stdout: String(stdout || ""), stderr: String(stderr || "") });
            });
            try { signal?.addEventListener?.("abort", () => { try { child.kill("SIGKILL"); } catch {} }); } catch {}
          });
          const parts: string[] = [];
          if (out.stdout.trim()) parts.push(out.stdout);
          if (out.stderr.trim()) parts.push("[stderr] " + out.stderr);
          if (out.err && out.err.code !== 0) parts.push(`[exit code: ${out.err.code}]`);
          return { content: [{ type: "text", text: parts.join("\n") || "(no output)" }] };
        } catch (e: any) {
          return { content: [{ type: "text", text: `[bash_readonly] execution error: ${e?.message || e}` }], isError: true };
        }
      },
    });
  }

  #buildDelegateTool(sessionKey: string): any {
    const self = this;
    return defineTool({
      name: "delegate_to_agent",
      label: "Delegate to agent",
      description: "Delegate a task to a specific agent in the chat. Use this tool when the user asks something that requires a specific agent's expertise. The agent receives the task, executes it, and returns the response. You then synthesize and report it to the user.",
      promptSnippet: "delegate_to_agent: delegate a task to a specific agent in the chat",
      promptGuidelines: [
        "When you need to delegate a task to an agent, use the delegate_to_agent tool with the agent's name and the task to perform.",
        "Do not try to do the work of a specialized agent yourself. Always delegate.",
        "After receiving the response, synthesize and report it to the user.",
      ],
      parameters: Type.Object({
        agent_name: Type.String({ description: "Name of the agent to delegate to (e.g. Notion, App Expert)" }),
        task: Type.String({ description: "Description of the task to assign to the agent" }),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        const { agent_name, task } = params;
        try {
          self.logDebug("delegate-tool-call", { sessionKey, agent_name, task: task?.substring(0, 200) });
          // Trova l'agente nella sessione
          const sessionEntry = self.#entries.get(sessionKey);
          const sessionAgents = (sessionEntry as any)?.agentId;
          if (!sessionAgents) {
            return { content: [{ type: "text", text: "Error: no agent found in the chat." }], isError: true };
          }
          const agentIds = String(sessionAgents).split(',').filter((id: string) => id && id !== 'orchestrator');
          // Trova l'agente per nome (case-insensitive)
          let targetId: string | null = null;
          for (const id of agentIds) {
            try {
              const cfg = self.#readAgentConfig(id);
              if (cfg?.name?.toLowerCase() === agent_name.toLowerCase()) {
                targetId = id;
                break;
              }
            } catch {}
          }
          if (!targetId) {
            return { content: [{ type: "text", text: `Error: agent "${agent_name}" not found in the chat.` }], isError: true };
          }
          // === INIETTA API KEY dell'agente target ===
          const agentConfig = self.#readAgentConfigFile(targetId) || { skills: [] };
          const savedKeys = [...self.#activeApiKeys]; // salva key correnti (Orchestrator)
          self.#injectApiKeysForAgent(agentConfig);
          self.logDebug("delegate-api-keys-injected", { sessionKey, agent: targetId, keys: self.#activeApiKeys.length });
          // Crea sessione temporanea per l'agente target
          const tempKey = `__delegate_${sessionKey}_${targetId}_${Date.now()}`;
          const agentPrompt = self.#readAgentPrompt(targetId, self.#cwd);
          const skillPaths = self.#resolveSkillPaths(agentConfig, self.#cwd);
          // Usa la stessa cwd della chat principale (ultimo effectiveCwd dal send)
          const tempCwd = self.#lastEffectiveCwd.get(sessionKey) ?? self.#cwd;
          const tempLoader = new self.#sdk.DefaultResourceLoader({
            cwd: tempCwd,
            agentDir: self.#agentDir,
            systemPrompt: agentPrompt,
            appendSystemPrompt: [],
            noExtensions: true,
            noSkills: true, // Solo skill specifiche dell'agente, non tutte le managed
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            additionalSkillPaths: skillPaths,
          });
          await tempLoader.reload();
          const tempSessionDir = path.join(self.#agentDir, "sessions", "quinki", tempKey);
          if (!fs.existsSync(tempSessionDir)) fs.mkdirSync(tempSessionDir, { recursive: true });
          const tempSm = self.#sdk.SessionManager.open(
            path.join(tempSessionDir, "session.jsonl"),
            tempSessionDir,
            self.#cwd
          );
          // Build skill tool for temp session (so delegated agents can also use skills)
          let tempPiRef: any = null;
          const tempSkillTool = self.#buildSkillTool(() => tempPiRef);
          const tempResult = await self.#sdk.createAgentSession({
            cwd: tempCwd,
            agentDir: self.#agentDir,
            sessionManager: tempSm,
            resourceLoader: tempLoader,
            customTools: tempSkillTool ? [tempSkillTool] : undefined,
          });
          const tempPi = tempResult.session;
          tempPiRef = tempPi;
          // Store in #active so abort() can stop it
          self.#active.set(tempKey, tempPi);
          // === Imposta system prompt dell'agente — NON sovrascrivere il prompt del resource loader (ha skills) ===
          try {
            const rlPrompt = tempPi.agent.state.systemPrompt || agentPrompt;
            (tempPi as any)._baseSystemPrompt = rlPrompt;
            self.logDebug("delegate-system-prompt-keep", { sessionKey, promptLen: rlPrompt.length, hasSkills: rlPrompt.includes("available_skills") });
          } catch {}
          // Setta modello: prima controlla session override, poi agent config, poi sessione
          const mainSession = self.#active.get(sessionKey);
          const sessionOverrides = (self.#entries.get(sessionKey) as any)?.agentOverrides || {};
          const agentOverride = sessionOverrides[targetId] || {};
          const agentModelId = agentOverride.model;
          if (agentModelId) {
            try {
              const authPath = path.join(self.#agentDir, "auth.json");
              const modelsPath = path.join(self.#agentDir, "models.json");
              const registry = await self.#createRegistry();
              const agentModel = self.#findModelInRegistry(registry, agentModelId);
              if (agentModel) {
                // FEATURE fallback 401: se il modello dell'override e' bruciato nel turno
                // corrente, usa direttamente il primo fallback della sessione.
                let chosenOverride = agentModel;
                try {
                  const _tried2 = self.#fallbackTried.get(sessionKey) || [];
                  if (_tried2.includes(agentModelId)) {
                    const _fb2 = (((self.#entries.get(sessionKey)) as any)?.fallbackModels || []) as string[];
                    const _next2 = _fb2.find((m: string) => !_tried2.includes(m));
                    if (_next2) { chosenOverride = _next2; self.logDebug("delegate-override-fallback", { sessionKey, agentId: targetId, from: agentModelId, to: _next2 }); }
                  }
                } catch {}
                await tempPi.setModel(chosenOverride);
                self.logDebug("delegate-model-agent", { sessionKey, agentId: targetId, model: agentModelId });
              } else {
                self.logDebug("delegate-model-not-found", { sessionKey, agentId: targetId, model: agentModelId });
                if (mainSession?.model) { try { await tempPi.setModel(mainSession.model); } catch {} }
              }
            } catch (e: any) {
              self.logDebug("delegate-model-error", { sessionKey, error: e?.message });
              if (mainSession?.model) { try { await tempPi.setModel(mainSession.model); } catch {} }
            }
          } else if (mainSession?.model) {
            // FEATURE fallback 401: se il modello di sessione e' stato bruciato (401)
            // nel turno corrente, usa direttamente il primo fallback disponibile.
            let chosenModel = mainSession.model;
            try {
              const _tried = self.#fallbackTried.get(sessionKey) || [];
              const _fb = (((self.#entries.get(sessionKey)) as any)?.fallbackModels || []) as string[];
              if (_tried.includes(chosenModel)) {
                const _next = _fb.find((m: string) => !_tried.includes(m));
                if (_next) { chosenModel = _next; self.logDebug("delegate-fallback-chain", { sessionKey, from: mainSession.model, to: _next }); }
              }
            } catch {}
            try { await tempPi.setModel(chosenModel); } catch {}
          }
          // === Set thinking level: agent override > main session thinking ===
          // Map "on" → pickDefaultThinkingLevel() (xhigh) — "on" is not a valid Pi SDK level
          let agentThinkingLevel = agentOverride.thinkingLevel;
          if (agentThinkingLevel === 'on') agentThinkingLevel = pickDefaultThinkingLevel();
          const mainThinkingLevel = self.#entries.get(sessionKey)?.thinkingLevel || "off";
          const mainThinking = mainThinkingLevel === 'on' ? pickDefaultThinkingLevel() : mainThinkingLevel;
          const effectiveThinking = agentThinkingLevel || mainThinking;
          try { tempPi.setThinkingLevel(effectiveThinking); self.logDebug("delegate-thinking-agent", { sessionKey, agentId: targetId, thinking: effectiveThinking, source: agentThinkingLevel ? "override" : "session" }); } catch {}
          // === Apply plan/build mode + agent tool list to temp session (same as #applyMode for main) ===
          const mainMode = self.#entries.get(sessionKey)?.mode || "plan";
          try {
            const globalConfig = self.#readGlobalConfig();
            const globalTools = globalConfig.tools || ["read", "grep", "find", "ls", "skill"];
            const agentTools2 = agentConfig?.tools || [];
            const mergedTools = [...new Set([...globalTools, ...agentTools2])];
            let tempToolNames: string[] = [];
            try {
              const all = (tempPi.getAllTools?.() ?? []).map((t: any) => t.name) as string[];
              tempToolNames = mergedTools.filter(n => all.includes(n));
              if (mainMode === "plan") {
                const planFlags = globalConfig.planModeTools || {};
                tempToolNames = tempToolNames.filter(n => planFlags[n] !== false);
              }
            } catch {}
            try { tempPi.setActiveToolsByName?.(tempToolNames); } catch {}
            // Build system prompt — same logic as #applyMode + #buildSystemPrompt (skills)
            try {
              const tempCwd2 = self.#lastEffectiveCwd.get(sessionKey) ?? self.#cwd;
              // After setActiveToolsByName, _baseSystemPrompt is just "Current date: ..."
              let base = (tempPi as any)._baseSystemPrompt || tempPi.agent.state.systemPrompt || "";
              const note = self.#modeNote(mainMode);
              // Prepend agent PROMPT.md + cwd (same as #applyMode)
              if (typeof base === "string" && !base.includes(agentConfig?.name || "§§")) {
                base = agentPrompt + `\n\nWorking directory: ${tempCwd2}\n\n` + base;
              }
              // Add mode note (same as #applyMode)
              if (typeof base === "string" && base.length > 0 && note) {
                const planIdx = base.indexOf("\n\nSei in MODALITÀ PIANO");
                const buildIdx = base.indexOf("\n\nSei in MODALITÀ BUILD");
                if (planIdx >= 0) base = base.substring(0, planIdx);
                else if (buildIdx >= 0) base = base.substring(0, buildIdx);
                base = base + note;
              }
              // Skill: short instruction instead of <available_skills> (skill tool handles it)
              if (tempPi?.resourceLoader) {
                try {
                  const skills = tempPi.resourceLoader.getSkills().skills;
                  if (skills && skills.length > 0 && typeof base === "string" && !base.includes("skill tool")) {
                    base = base + `\n\nYou have ${skills.length} skill(s) available. Use the skill tool with command='list' to see them, command='search' to find relevant ones, and command='load' to read full instructions. Always check your skills before answering.`;
                  }
                } catch {}
              }
              if (typeof base === "string" && base.length > 0) {
                (tempPi as any)._baseSystemPrompt = base;
                tempPi.agent.state.systemPrompt = base;
              }
              // Inject user-activated skills into the delegated agent's system prompt
              const pendingSkills = self.#pendingDelegationSkills.get(sessionKey);
                              if (pendingSkills && pendingSkills.length > 0) {
                for (const ps of pendingSkills) {
                                    if (ps.agentId === targetId) {
                    try {
                                            const delegCwd = (typeof effectiveCwd !== "undefined" && effectiveCwd) || self.#cwd; const skillPath = self.#findSkillPath(ps.skillName, delegCwd);
                                            if (skillPath && fs.existsSync(skillPath)) {
                        const skillContent = fs.readFileSync(skillPath, 'utf-8');
                        const skillBody = skillContent.replace(/^---\n[\s\S]*?\n---\n?/, '');
                        base = base + '\n\n=== USER ACTIVATED SKILL: ' + ps.skillName + ' ===\n\n' + skillBody + '\n\n=== END USER ACTIVATED SKILL ===\n\nCRITICAL: The skill instructions above were explicitly activated by the user via /skill command. They are ALREADY in your system prompt — do NOT use the skill tool to verify them. Follow them directly.';
                        self.logDebug("delegate-skill-injected", { sessionKey, agentId: targetId, skillName: ps.skillName, skillLen: skillBody.length });
                      }
                    } catch (e: any) { self.logDebug("delegate-skill-inject-error", { sessionKey, skillName: ps.skillName, error: e?.message }); }
                  }
                }
                (tempPi as any)._baseSystemPrompt = base;
                tempPi.agent.state.systemPrompt = base;
              }
              // === Attachment directory + specific files for delegated agent ===
              try {
                const home2 = process.env.HOME || process.env.USERPROFILE || '';
                const attDir = `${home2}/.quinki/attachments/${sessionKey}`;
                if (fs.existsSync(attDir)) {
                  let attSection = `\n\n**Attachment directory:** ${attDir}\nYou can use \`ls\` and \`read\` tools to access files the user has attached to this chat.`;
                  // Add specific files if available
                  const pendingAtts = self.#pendingDelegationAttachments.get(sessionKey);
                  if (pendingAtts && pendingAtts.length > 0) {
                    attSection += `\n\n=== ATTACHED FILES ===\nThe user attached the following file(s):`;
                    for (const att of pendingAtts) {
                      attSection += `\n- ${att.originalName} → ${att.path}`;
                    }
                    attSection += `\nUse the \`read\` tool to access these files. If a file is too large, use \`read\` with offset/limit.\n=== END ATTACHED FILES ===`;
                  }
                  base = (typeof base === 'string' ? base : '') + attSection;
                  (tempPi as any)._baseSystemPrompt = base;
                  tempPi.agent.state.systemPrompt = base;
                }
              } catch {}
              self.logDebug("delegate-system-prompt-built", { sessionKey, mode: mainMode, promptLen: base?.length || 0, hasModeNote: base?.includes("MODALITÀ"), hasSkills: base?.includes("available_skills"), hasAgentPrompt: (base?.length || 0) > 100 });
              self.logDebug("system_prompt", { sessionKey: tempKey, len: base?.length || 0, hasSkills: (base?.includes("USER ACTIVATED SKILL") || false), skills: pendingSkills ? pendingSkills.filter((p: any) => p.agentId === targetId).map((p: any) => p.skillName) : [], agentId: targetId, agentName: agent_name, isDelegation: true, isOrchestrator: false, delegatedBy: sessionKey, messageText: (task || "").substring(0, 200), prompt: base || "" });
            } catch (e2: any) { self.logDebug("delegate-system-prompt-error", { sessionKey, error: e2?.message }); }
            self.logDebug("delegate-apply-mode", { sessionKey, mode: mainMode, agentId: targetId, toolCount: tempToolNames.length, tools: tempToolNames });
          } catch (e: any) { self.logDebug("delegate-apply-mode-error", { sessionKey, error: e?.message }); }
          // === Multi-window delegation: emit events to main session ===
          const mainWs = self.#wss.get(sessionKey);
          const delegationId = `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          // === Reuse stream_event channel (proven to work) with del- prefix messageId ===
          self.#sendToWs(self.#wss.get(sessionKey), { type: "stream_event", sessionKey, eventType: "delegation_start", messageId: delegationId, agentName: agent_name, task: task });
          // Yield to event loop: lets ws-bridge process the delegation_start before temp session streams
          await new Promise(r => setTimeout(r, 0));
          // Subscribe to temp session events → forward as delegation_stream
          let delegationContent: any[] = [];
          // Helper: accumula blocchi cronologicamente (merge consecutive same-type)
          const pushDel = (type: string, data: any) => {
            const last = delegationContent[delegationContent.length - 1];
            if (last && last.type === type) {
              // Merge: appendi al contenuto dell'ultimo blocco
              if (type === 'thinking') last.thinking = (last.thinking || '') + (data.thinking || '');
              else if (type === 'text') last.text = (last.text || '') + (data.text || '');
            } else {
              delegationContent.push({ ...data, type, timestamp: Date.now() });
            }
          };
          // Direct forwarding with fs.writeSync — no queue, no delay
          const tempSub = tempPi.subscribe((e: any) => {
            const fwdWs = self.#wss.get(sessionKey);
            if (e.type === "tool_execution_start") {
              self.#sendToWs(fwdWs, { type: "stream_event", sessionKey, eventType: "toolcall_start", delta: e.toolName || "", messageId: delegationId });
              let argsStr = "";
              try { argsStr = typeof e.args === "string" ? e.args : JSON.stringify(e.args, null, 2); } catch {}
              if (argsStr) self.#sendToWs(fwdWs, { type: "stream_event", sessionKey, eventType: "toolcall_delta", delta: argsStr, messageId: delegationId });
              delegationContent.push({ type: "toolCall", text: e.toolName || 'tool', thinking: argsStr, streaming: false, timestamp: Date.now() });
            } else if (e.type === "tool_execution_end") {
              let resultText = "";
              try {
                const r = e.result;
                if (r?.content) {
                  if (Array.isArray(r.content)) {
                    resultText = r.content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("");
                  } else if (typeof r.content === "string") { resultText = r.content; }
                }
              } catch {}
              if (!resultText && e.isError) { try { resultText = String((e as any).error || (r as any)?.error || 'Tool execution failed'); } catch { resultText = 'Tool execution failed'; } }
              self.#sendToWs(fwdWs, { type: "stream_event", sessionKey, eventType: "toolcall_end", delta: resultText, messageId: delegationId, isError: !!e.isError });
              delegationContent.push({ type: "toolResult", text: e.toolName || 'tool', thinking: resultText, streaming: false, isError: !!e.isError, timestamp: Date.now() });
            } else if (e.type === "message_update" && e.assistantMessageEvent && e.message?.role === "assistant") {
              const ame = e.assistantMessageEvent;
              if (ame.type === "toolcall_start" || ame.type === "toolcall_delta" || ame.type === "toolcall_end") return;
              self.#sendToWs(fwdWs, { type: "stream_event", sessionKey, eventType: ame.type, delta: ame.delta || "", messageId: delegationId });
              if (ame.type === "thinking_delta" || ame.type === "thinking_start") pushDel('thinking', { thinking: ame.delta || '' });
              else if (ame.type === "text_delta" || ame.type === "text_start") pushDel('text', { text: ame.delta || '' });
            }
          });

          // === Set thinking level (last moment, after all system prompt work) ===
          const agentThinking2 = agentOverride.thinkingLevel;
          if (agentThinking2 === 'on') {
            const sessionLevel2 = mainSession?.thinkingLevel;
            const level2 = (sessionLevel2 && sessionLevel2 !== 'off') ? sessionLevel2 : 'xhigh';
            try { tempPi.setThinkingLevel(level2); } catch {}
          } else if (agentThinking2 === 'off') {
            try { tempPi.setThinkingLevel('off'); } catch {}
          } else if (mainSession?.thinkingLevel) {
            try { tempPi.setThinkingLevel(mainSession.thinkingLevel); } catch {}
          }
          // === Unified agent_llm_config log: what the LLM actually receives ===
          {
            let actualModel = ""; try { actualModel = tempPi.model?.id || ""; } catch {}
            let actualThinking = ""; try { actualThinking = tempPi.thinkingLevel || ""; } catch {}
            const sEntry = self.#entries.get(sessionKey);
            let thinkingTranslated = self.#translateThinkingForModel(actualThinking, actualModel);
            self.logDebug("agent_llm_config", {
              sessionKey,
              source: "delegation",
              agentId: targetId,
              agentName: agent_name,
              model: actualModel,
              thinkingLevel: actualThinking,
              thinkingTranslated,
              chatModel: sEntry?.model || "",
              chatThinking: sEntry?.thinkingLevel || "",
              agentOverrideModel: agentOverride.model || null,
              agentOverrideThinking: agentOverride.thinkingLevel || null,
              systemPromptLen: (tempPi as any)._baseSystemPrompt?.length || 0,
            });
          }
          // === Invia il task e attendi il completamento (sendUserMessage risolve a turno finito) ===
          self.logDebug("delegate-sending-task", { sessionKey, agent_name, task: task?.substring(0, 100) });
          await tempPi.sendUserMessage(task, { deliverAs: "followUp" });
          // Cleanup subscription + flush timer
          try { tempSub(); } catch {}
          // === Raccogli la risposta dall'ultimo messaggio assistant ===
          let responseText = "";
          try {
            const msgs = (tempPi.agent?.state?.messages || []) as any[];
            // Cerca l'ultimo messaggio assistant con testo
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i]?.role === "assistant") {
                const content = msgs[i]?.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block?.type === "text" && block.text) {
                      responseText = block.text;
                      break;
                    }
                  }
                } else if (typeof content === "string") {
                  responseText = content;
                }
                if (responseText) break;
              }
            }
          } catch (e: any) {
            self.logDebug("delegate-collect-response-error", { sessionKey, error: e?.message });
          }
          // === Emit delegation_ended + persist ===
          // Include model + thinking used by the delegated agent
          const delModel = (tempPi?.model?.id ?? '') || agentOverride.model || (mainSession?.model?.id ?? '') || '';
          const delThinking = tempPi?.thinkingLevel || agentOverride.thinkingLevel || mainSession?.thinkingLevel || '';
          self.#sendToWs(self.#wss.get(sessionKey), { type: "stream_event", sessionKey, eventType: "delegation_end", messageId: delegationId, agentName: agent_name, response: responseText, model: delModel, thinkingLevel: delThinking });
          // Collect delegation content from temp session entries (include tool results)
          try {
            const tempSm = (tempPi as any)?.sessionManager || (tempPi as any)?.agent?.state?.sessionManager;
            const tempEntries = tempSm?.getEntries?.() || [];
            self.logDebug("delegate-entries", { count: tempEntries.length, types: tempEntries.map((e: any) => e?.type) });
            for (const ent of tempEntries) {
              if (ent?.type === "message" && ent?.message?.role === "assistant") {
                const blocks = Array.isArray(ent.message?.content) ? ent.message.content : [];
                for (const b of blocks) {
                  if (b?.type === "thinking" && b.thinking) delegationContent.push({ type: "thinking", thinking: b.thinking, timestamp: Date.now() });
                  if (b?.type === "text" && b.text) delegationContent.push({ type: "text", text: b.text, timestamp: Date.now() });
                  if (b?.type === "toolCall") {
                    const argsStr = typeof b.arguments === "string" ? b.arguments : JSON.stringify(b.arguments || {}, null, 2);
                    delegationContent.push({ type: "toolCall", text: b.name || 'tool', thinking: argsStr, streaming: false, timestamp: Date.now() });
                  }
                }
              } else if (ent?.type === "message" && ent?.message?.role === "tool") {
                // Tool result message
                const resultText = typeof ent.message?.content === 'string' ? ent.message.content : self.#parseContent(ent.message?.content);
                delegationContent.push({ type: "toolResult", text: ent.message?.toolName || 'tool', thinking: resultText, streaming: false, isError: !!ent.message?.isError, timestamp: Date.now() });
              }
            }
          } catch (e2: any) { self.logDebug("delegate-entries-error", { error: e2?.message }); }
          // Save delegation for persistence
          self.#appendDelegationToJsonl(sessionKey, { id: delegationId, agentName: agent_name, delegatedMessage: task, content: delegationContent, timestamp: Date.now(), model: delModel, thinkingLevel: delThinking });
          // Cleanup: dispose sessione temporanea + remove from #active
          self.#active.delete(tempKey);
          try { (tempPi as any).dispose?.(); } catch {}
          // Pulisci temp files
          try {
            const tempFiles = fs.readdirSync(tempSessionDir);
            for (const f of tempFiles) fs.unlinkSync(path.join(tempSessionDir, f));
            fs.rmdirSync(tempSessionDir);
          } catch {}
          // === RIPRISTINA API KEY precedenti ===
          self.#clearActiveApiKeys();
          for (const v of savedKeys) {
            // Re-inject the saved key from Keychain
            try {
              if (process.platform === "darwin") {
                const key = execSync(`security find-generic-password -a "quinki" -s "${v}" -w`, { stdio: "pipe", encoding: "utf8" }).trim();
                if (key) { process.env[v] = key; self.#activeApiKeys.push(v); }
              }
            } catch {}
          }
          self.logDebug("delegate-tool-response", { sessionKey, agent_name, responseLength: responseText.length });
          if (!responseText || responseText.trim().length === 0) {
            return { content: [{ type: "text", text: `L'agente ${agent_name} non ha prodotto una risposta testuale. Potrebbe aver eseguito il task senza output testuale.` }], isError: false };
          }
          return { content: [{ type: "text", text: responseText }], isError: false };
        } catch (e: any) {
          self.logDebug("delegate-tool-error", { sessionKey, error: e?.message || String(e) });
          return { content: [{ type: "text", text: `Error during delegation to ${agent_name}: ${e?.message || String(e)}` }], isError: true };
        }
      },
    });
  }

  #buildResourceLoader(cwd: string, agentId: string | null, sessionKey?: string): any {
    if (agentId) {
      const agentConfig = this.#readAgentConfigFile(agentId) || { skills: [] };
      const skillPaths = this.#resolveSkillPaths(agentConfig, cwd);
      // Build full system prompt (includes agent list for Orchestrator)
      let systemPrompt = this.#readAgentPrompt(agentId, cwd);
      // === Orchestrator: add agent list to system prompt ===
      if (agentId === 'orchestrator' && sessionKey) {
        const sessionEntry = this.#entries.get(sessionKey);
        const sessionAgents = (sessionEntry as any)?.agentId;
        if (sessionAgents && sessionAgents !== 'orchestrator') {
          const agentIds = String(sessionAgents).split(',').filter((id: string) => id && id !== 'orchestrator');
          const agentNames: string[] = [];
          for (const id of agentIds) {
            try {
              const agentCfg = this.#readAgentConfig(id);
              if (agentCfg?.name) agentNames.push(agentCfg.name);
              else agentNames.push(id);
            } catch { agentNames.push(id); }
          }
          if (agentNames.length > 0) {
            systemPrompt += `\n\n**Agents available in this chat (use @name to tag them):**\n`;
            for (const name of agentNames) {
              systemPrompt += `- @${name}\n`;
            }
            systemPrompt += `\nWhen the user makes a request, analyze it and delegate to the most suitable agent. If the request is simple, answer directly.\n`;
            systemPrompt += `\n**Agent descriptions:**\n`;
            for (const id of agentIds) {
              try {
                const cfg = this.#readAgentConfig(id);
                if (cfg?.name) {
                  const skills = (cfg.skills || []).join(', ');
                  const tools = (cfg.tools || []).join(', ');
                  systemPrompt += `- **${cfg.name}**: ${cfg.description || 'Agente'}${skills ? ` (skill: ${skills})` : ''}${tools ? ` (tool: ${tools})` : ''}\n`;
                }
              } catch {}
            }
          }
        }
      }
      return new this.#sdk.DefaultResourceLoader({
        cwd,
        agentDir: this.#agentDir,
        systemPrompt,
        appendSystemPrompt: [],
        noExtensions: true,
        noSkills: true, // Solo skill specifiche dell'agente, non tutte le managed
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalSkillPaths: skillPaths,
      });
    }
    return new this.#sdk.DefaultResourceLoader({
      cwd,
      agentDir: this.#agentDir,
      systemPrompt: "quinki",
      appendSystemPrompt: [],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
  }

  #buildSystemPrompt(key: string, cwd: string, workingDirs?: string[], mode?: string, skillNames?: { agentId: string; skillName: string }[], attachments?: { originalName: string; path: string; uuid: string; size?: number }[], taskClips?: { id: string; label: string; text: string }[]): string {
    const rawAgentId = this.#resolveAgentId(key);
    // If agentId is a comma-separated list (e.g. "orchestrator,notion,frontend-designer"),
    // extract the first valid agent for reading PROMPT.md
    let agentId: string | null = rawAgentId;
    if (agentId && agentId.includes(',')) {
      const ids = agentId.split(',').map(s => s.trim()).filter(Boolean);
      // Prefer orchestrator if present
      agentId = ids.find(id => id === 'orchestrator') || ids[0] || null;
    }
    const hasAgent = agentId !== null;
    let prompt = hasAgent ? this.#readAgentPrompt(agentId!, cwd) : "quinki";
    const lead = hasAgent ? "You work" : "You are an assistant who works";
    if (workingDirs && workingDirs.length > 0) {
      if (workingDirs.length === 1) {
        prompt += `\n\n${lead} in the directory: ${workingDirs[0]}`;
      } else {
        prompt += `\n\n${lead} in the following directories:`;
        for (const d of workingDirs) {
          prompt += `\n- ${d}`;
        }
        prompt += `\nThe main directory (where commands are executed) is: ${workingDirs[0]}`;
      }
    } else {
      prompt += `\n\n${lead} in the directory: ${cwd}`;
    }
    // === Long Horizon: messaggio di SISTEMA (hardcoded, entra nel contesto, non è una bubble) ===
    // Spiega le fasi + blocca il modello nella fase corrente. Il modello NON può avanzare:
    // la fase cambia SOLO quando l'utente preme il bottone nella sezione in chat.
    const lhPhase = this.#lhPhase.get(key);
    if (lhPhase) {
      prompt += `\n\n=== LONG HORIZON MODE ===\nLong Horizon is active for this session. It works in three phases, and you CANNOT advance to the next phase on your own. The user controls the transitions with the buttons in the chat.\n\n1. DISCUSSION: you discuss the problem with the user and understand the goal. You MUST NOT execute, create files, or start any work. Only discuss.\n2. PLANNING: you propose a plan divided into units in '- [ ]' format (one per line). You MUST NOT execute or start any work. Only plan.\n3. START (EXECUTION): you work through the plan units one at a time, autonomously.\n\nYou are currently in the ${lhPhase === "running" ? "EXECUTION" : lhPhase.toUpperCase()} phase.`;
      if (lhPhase === "discussion") {
        prompt += ` You MUST discuss the problem with the user and understand the goal. You MUST NOT execute, create files, or start any work. Only discuss.`;
      } else if (lhPhase === "planning") {
        prompt += ` You MUST create a plan with the user, divided into units in '- [ ]' format. You MUST NOT execute or start any work. Only plan.`;
      } else if (lhPhase === "running") {
        prompt += ` Follow the plan units one at a time. Update handoff.md after each unit and commit to git.`;
      }
    }
    // === Plan/Build mode: nota mode-aware (il modello sa in che mode è) ===
    // In Long Horizon la nota plan/build NON viene aggiunta: il prompt di fase LH è sufficiente,
    // altrimenti il modello si confonderebbe pensando di essere in troppe modalità contemporaneamente.
    const lhPhaseNow = this.#lhPhase.get(key);
    if (!lhPhaseNow) {
      const m = mode === "build" ? "build" : "plan";
      // Check if this agent has delegate_to_agent tool (orchestrator or agent with it in config)
      const hasDelegate = !!(agentId && (agentId === 'orchestrator' || (this.#readAgentConfigFile(agentId)?.tools?.includes('delegate_to_agent'))));
      prompt += this.#modeNote(m, hasDelegate);
    }
    // === Orchestrator: aggiungi lista agenti disponibili nella chat ===
    // Check: agentId could be 'orchestrator' (from setAgent) OR contain it
    // (e.g. 'agent-123,orchestrator' from session entry, before setAgent is processed)
    if (agentId && (agentId === 'orchestrator' || agentId.includes('orchestrator'))) {
      const sessionEntry = this.#entries.get(key);
      const sessionAgents = (sessionEntry as any)?.agentId;
            this.logDebug("orchestrator-agents", { sessionKey: key, agentId: agentId, sessionAgents: sessionAgents, agentDir: this.#agentDir });
      if (sessionAgents && sessionAgents !== 'orchestrator') {
        const agentIds = String(sessionAgents).split(',').filter((id: string) => id && id !== 'orchestrator');
        const agentNames: string[] = [];
        for (const id of agentIds) {
          try {
            const agentCfg = this.#readAgentConfig(id);
            if (agentCfg?.name) agentNames.push(agentCfg.name);
            else agentNames.push(id);
          } catch { agentNames.push(id); }
        }
        if (agentNames.length > 0) {
          prompt += `\n\n**Agents available in this chat (use @name to tag them):**\n`;
          for (const name of agentNames) {
            prompt += `- @${name}\n`;
          }
          prompt += `\nWhen the user makes a request, analyze it and delegate to the most suitable agent. If the request is simple, answer directly.`;
        }
      }
    }
    // === Skill: short instruction instead of <available_skills> ===
    const pi = this.#active.get(key);
    if (pi?.resourceLoader) {
      try {
        const skills = pi.resourceLoader.getSkills().skills;
        if (skills && skills.length > 0) {
          prompt += `\n\nYou have ${skills.length} skill(s) available. Use the skill tool with command='list' to see them, command='search' to find relevant ones, and command='load' to read full instructions. Always check your skills before answering.`;
        }
      } catch {}
    }
    // === User-invoked skills: load SKILL.md and add to system prompt ===
    if (skillNames && skillNames.length > 0) {
      const isOrchestrator = agentId && (agentId === 'orchestrator' || agentId.includes('orchestrator'));
      for (const { skillName, agentId: targetAgentId } of skillNames) {
        try {
          const skillPath = this.#findSkillPath(skillName, cwd);
          if (skillPath && fs.existsSync(skillPath)) {
            const content = fs.readFileSync(skillPath, 'utf-8');
            const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
            if (isOrchestrator && targetAgentId === 'orchestrator') {
              // Orchestrator's OWN skill: follow directly, no delegation
              prompt += `\n\n=== USER ACTIVATED SKILL: ${skillName} ===\n\n${body}\n\n=== END USER ACTIVATED SKILL ===\n\nCRITICAL: The skill instructions above were explicitly activated by the user via /skill command. They are ALREADY in your system prompt — do NOT use the skill tool to verify them. Follow them directly.`;
            } else if (isOrchestrator) {
              // Other agent's skill: delegate
              const targetCfg = this.#readAgentConfig(targetAgentId);
              const targetName = targetCfg?.name || targetAgentId;
              prompt += `\n\n=== USER ACTIVATED SKILL: ${skillName} ===\nTarget agent: ${targetName}\n\n${body}\n\n=== END USER ACTIVATED SKILL ===\n\nCRITICAL: The skill instructions above were explicitly activated by the user via /skill command. They are ALREADY in your system prompt — do NOT use the skill tool to verify them. When you delegate to ${targetName}, you MUST include the full skill instructions above in your delegation message so ${targetName} follows them.`;
            } else {
              prompt += `\n\n=== USER ACTIVATED SKILL: ${skillName} ===\n\n${body}\n\n=== END USER ACTIVATED SKILL ===\n\nCRITICAL: The skill instructions above were explicitly activated by the user via /skill command. They are ALREADY in your system prompt — do NOT use the skill tool to verify them. Follow them directly.`;
            }
            this.logDebug('skill-invoked', { sessionKey: key, skillName, targetAgentId, isOrchestrator, contentLen: body.length });
          }
        } catch (e: any) { this.logDebug('skill-invoke-error', { skillName, error: e?.message }); }
      }
    }
    // === Task clips: risultati di task clippati dall'utente (come le skill, nel system prompt) ===
    if (taskClips && taskClips.length > 0) {
      for (const tc of taskClips) {
        const body = String(tc.text || '').trim();
        if (!body) continue;
        const execId = String(tc.id || '').trim();
        const pointer = execId
          ? `\n\nExecution ID: ${execId}\nTo read the FULL task result (reasoning, tool calls, tool results, delegations), use the getTaskResult tool with executionId "${execId}". For the full task history of this session, use the readHandoff tool.`
          : `\n\nTo read the FULL task result (reasoning, tool calls, tool results, delegations), use the getTaskResult tool or the readHandoff tool.`;
        prompt += `\n\n=== TASK RESULT: ${tc.label} ===\n\n${body}${pointer}\n\n=== END TASK RESULT ===\n\nThe task result above was explicitly attached by the user. It is ALREADY in your system prompt — use it as context for the current request. The user expects you to be aware of this task: read the full result if needed before answering.`;
        this.logDebug('task-clip-injected', { sessionKey: key, label: tc.label, execId: execId || null, contentLen: body.length });
      }
    }
    // === Attachment directory path (always present for this chat) ===
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const attachmentDir = `${home}/.quinki/attachments/${key}`;
    if (fs.existsSync(attachmentDir)) {
      prompt += `\n\n**Attachment directory:** ${attachmentDir}\nYou can use \`ls\` and \`read\` tools to access files the user has attached to this chat.`;
    }
    // === Specific attachments for this message ===
    if (attachments && attachments.length > 0) {
      prompt += `\n\n=== ATTACHED FILES ===\nThe user attached the following file(s) in this message:`;
      for (const att of attachments) {
        prompt += `\n- ${att.originalName} → ${att.path}`;
      }
      prompt += `\nUse the \`read\` tool to access these files. If a file is too large, use \`read\` with offset/limit.\n=== END ATTACHED FILES ===`;
    }
    return prompt;
  }

  #readAgentConfig(agentId: string): any {
    try {
      const agentsBase = path.join(this.#agentDir, "agents");
      const cfgPath = path.join(agentsBase, agentId, "config.json");
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
        // Also try to read description from PROMPT.md (first paragraph after title)
        try {
          const promptPath = path.join(agentsBase, agentId, "PROMPT.md");
          if (fs.existsSync(promptPath) && !cfg.description) {
            const promptContent = fs.readFileSync(promptPath, "utf8");
            const lines = promptContent.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith("#") && !trimmed.startsWith("---")) {
                cfg.description = trimmed.substring(0, 100);
                break;
              }
            }
          }
        } catch {}
        return cfg;
      }
    } catch {}
    return null;
  }

  #findSkillPath(skillName: string, cwd: string): string | null {
    // Search in: agentDir/skills, cwd/.pi/skills, cwd/.agents/skills
    const searchDirs = [
      path.join(this.#agentDir, "skills"),
      path.join(cwd, ".pi", "skills"),
      path.join(cwd, ".agents", "skills"),
    ];
    for (const dir of searchDirs) {
      const skillPath = path.join(dir, skillName, "SKILL.md");
      if (fs.existsSync(skillPath)) return skillPath;
    }
    return null;
  }

  async send(ws: any, data: { sessionKey: string; text: string; files?: { name: string; type: string; path?: string; data?: string }[]; workingDirs?: string[]; skillNames?: { agentId: string; skillName: string }[]; attachments?: { originalName: string; path: string; uuid: string; size?: number }[]; taskClips?: { id: string; label: string; text: string }[] }) {
    const sk = data.sessionKey;
    // === MESSAGE-ACK (29 ago, richiesta utente: 'running non mi dà nessuna garanzia
    // che il messaggio sia arrivato'): PRIMA riga del send — conferma IMMEDIATA al
    // frontend che il messaggio è stato ricevuto dal sidecar. La pill mostra
    // 'Sending…' finché questo ack non arriva, poi 'Running' quando il modello
    // parte davvero. Se 'Sending…' resta bloccato = il messaggio NON è arrivato
    // (rete/ws): l'utente lo vede subito invece di aspettare nel buio.
    try { this.#sendToWs(ws, { type: "message_ack", sessionKey: sk, ts: Date.now() }); } catch {}
    // === ACK DI CONSEGNA (29 ago, richiesta utente): 'Sending...' vs 'Running' ===
    // La PRIMA cosa che fa il sidecar quando riceve un messaggio: conferma al
    // frontend che il messaggio è ARRIVATO. Prima il pill 'Running' era puramente
    // ottimistico (restava anche se il messaggio non partiva mai: buio totale).
    try { this.#sendToWs(ws, { type: "message_ack", sessionKey: sk }); } catch {}
    const s = this.#entries.get(sk);
    // B0.5: invio = attività → touch + sweep LRU
    this.#touchSession(sk);
    this.#sweepInactive();
    if (!s) {
      // Sessione inesistente (es. eliminata ma il frontend ha continuato a mandare) → errore esplicito, MAI silenzio
      this.logDebug("send-no-session", { sessionKey: sk });
      try { ws.send(JSON.stringify({ type: "done", sessionKey: sk, stopReason: "error", errorMessage: "Session not found (deleted?). Start a new chat.", text: "" })); } catch {}
      return;
    }

    // === ESCLUSIVITÀ APP EXPERT (29 ago): la sessione __app_expert__ appartiene
    // all'app Expert quando è ACCESA. La main NON deve streammarla (il bug: apri la
    // sessione Expert nella main, poi accendi l'app Expert → la main teneva lo
    // streaming). Guardia autorevole: se l'app Expert è viva → rifiuta l'invio E
    // rilascia la sessione in memoria della main (memoria + ownership). ===
      if (sk === "__app_expert__" && !isExpertSidecar() && (isExpertAlive() || isExpertAppProcessRunning())) {
      this.logDebug("send-refused-expert-alive", { sessionKey: sk, note: "la sessione vive nell'app Expert", viaAppProcess: !isExpertAlive() && isExpertAppProcessRunning() });
      try { ws.send(JSON.stringify({ type: "done", sessionKey: sk, stopReason: "error", errorMessage: "The App Expert app is running and owns this session. Use the App Expert app, or close it first.", text: "" })); } catch {}
      try {
        const piOwned = this.#active.get(sk);
        if (piOwned) { try { (piOwned as any).dispose?.(); } catch {} this.#active.delete(sk); this.logDebug("send-refused-expert-released", { sessionKey: sk }); }
      } catch {}
      return;
    }

    // Salva il primo messaggio utente per auto-title
    if (!this.#firstUserText.has(sk) && data.text && data.text.trim().length > 0) {
      this.#firstUserText.set(sk, data.text.slice(0, 500));
    }

    // === Auto-title: se il label è ancora default, estrai dal primo messaggio (come Flutter _autoLabel) ===
    if ((s.label === 'Chat' || s.label === 'New chat' || s.label === 'New Chat') && data.text && data.text.trim().length > 0) {
      const t = data.text.trim();
      const cleaned = t.replace(/\s+/g, ' ').replace(/^```[a-z]*\n?/, '').trim();
      if (cleaned.length > 0) {
        const first = cleaned.split(new RegExp('[.!?\\n]')).map((x: string) => x.trim()).find((x: string) => x.length > 2) || cleaned;
        const title = first.length > 40 ? first.substring(0, 37) + '...' : first;
        if (title && title !== 'Chat') {
          s.label = title.charAt(0).toUpperCase() + title.slice(1);
          this.#save();
          this.logDebug('auto-title', { sessionKey: sk, label: s.label });
          // Notifica il frontend
          try { ws.send(JSON.stringify({ type: 'session_updated', sessionKey: sk, label: s.label })); } catch {}
        }
      }
    }

    const effEntryWd = (this.#entries.get(sk) as any)?.workingDir
    const effectiveCwd = this.#cwdOverride.get(sk) ?? ((data.workingDirs && data.workingDirs.length > 0) ? data.workingDirs[0] : (effEntryWd || this.#cwd));
    this.#lastEffectiveCwd.set(sk, effectiveCwd);

    this.logDebug("msg-in", {
      effectiveCwd,
      workingDirs: data.workingDirs || [],
      sessionKey: sk,
      text: data.text?.slice(0, 200),
      files: data.files?.map((f: any) => ({ name: f.name, type: f.type, path: f.path || "(empty)", hasData: !!f.data, dataLen: f.data?.length || 0 })) || [],
      requestedThinkingLevel: s?.thinkingLevel,
    });

    if (!(data as any)._preserveWs) this.#wss.set(sk, ws);
    else {
      this.logDebug("lh-preserve-ws", { sessionKey: sk, note: "Long Horizon: streaming al ws del frontend" });
      // Emetti un evento user_message così il frontend mostra in TEMPO REALE
      // il messaggio inviato dal support agent (niente più reload per vederlo).
      try { this.#sendToWs(this.#getSessionWs(sk), { type: "user_message", sessionKey: sk, text: data.text, ts: Date.now() }); } catch {}
    }
    
    let pi = this.#active.get(sk);
    this.logDebug("send-resolved-agent", { sessionKey: sk, override: this.#agentOverride.get(sk), resolvedAgentId: this.#resolveAgentId(sk), hasActiveSession: !!pi });
    // === SAFETY NET mid-session (rianimato, FIX 10 set): #maybeRefreshMcp con ADOPT-IF-MISSING
    // è sicuro — controlla la firma (mcp+tools) del config agente a ogni send. Se la firma
    // è MANCANTE (boot) la ADOTTA senza dispose (fix 29 ago). Se è CAMBIATA → rebuild tool +
    // refresh registry + dispose → recreate al prossimo giro. Questo copre i casi in cui
    // l'event-driven (refreshSessionsForAgent) non ha trovato la sessione o il match è
    // fallito: il prossimo send rileva comunque il cambio e aggiorna.
    try {
      if (pi) {
        const refreshed = await this.#maybeRefreshMcp(sk, pi);
        if (refreshed) {
          // La sessione è stata disposta dal refresh — la ricrea sotto (if (!pi))
          pi = this.#active.get(sk) as any;
          this.logDebug("send-mcp-refreshed", { sessionKey: sk, note: "config agente cambiato — sessione ricreata" });
        }
      }
    } catch (e: any) { this.logDebug("send-mcp-refresh-error", { sessionKey: sk, error: e?.message }); }
    // === REDESIGN (29 ago): QUI non si controlla PIÙ NESSUNA configurazione a ogni
    // messaggio. Prima: #maybeRefreshMcp leggeva il config agente da disco e calcolava
    // la firma a OGNI send → con la firma vuota al boot (sidecar riavviato) il PRIMO
    // invio (spesso l'AUTOPROMPT del recovery) scartava la sessione e il turno partiva
    // sulla sessione morta (pi stantio) → autoprompt perso SEMPRE. Ora: il refresh è
    // EVENT-DRIVEN — lo triggerano i cambiamenti reali (updateAgent, setChatAgents:
    // vedi refreshSessionsForAgent) e avviene SOLO a turno finito, mai nel flusso dei
    // messaggi. Il send è pulito e veloce per sempre.
    // === Auto-reload skill: se .pi/skills/ è cambiato da quando la sessione è stata creata,
    // dispose + reopen (SessionManager.open → history PRESERVATA, no /reset, no message loss).
    // Così l'Expert edita SKILL.md / aggiunge skill senza perdere la conversazione.
    if (pi && this.#isExpertKey(sk)) {
      const curM = this.#skillsDirMtime(effectiveCwd);
      const savedM = this.#skillsMtime.get(sk) ?? 0;
      if (curM > savedM) {
        try { (pi as any).dispose?.(); } catch (e: any) { this.logDebug("skill-reload-dispose-error", { sessionKey: sk, error: e?.message }); }
        this.#active.delete(sk);
        pi = undefined as any;  // force re-creation sotto (if (!pi)) con nuovo loader
        this.logDebug("skill-auto-reload", { sessionKey: sk, oldMtime: savedM, newMtime: curM });
      }
    }
    if (!pi) {
      const sessionDir = this.#piSessionDir(sk);
      fs.mkdirSync(sessionDir, { recursive: true });

      let sm: any;
      const files = fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl"));
      if (files.length > 0) {
        const sessionPath = path.join(sessionDir, files[0]);
        sm = this.#sdk.SessionManager.open(sessionPath, sessionDir, effectiveCwd);
      } else {
        sm = this.#sdk.SessionManager.create(effectiveCwd, sessionDir);
      }

      // === A: resourceLoader custom per disabilitare system prompt di default ===
      // === Fix 11: workaround system prompt minimale ===
      // Pi SDK include di default: ruolo "coding assistant", tools descriptions, guidelines,
      // === Fase C.1: system prompt personalizzato nel vendor (date + cwd + tools) ===
      // Il vendor buildSystemPrompt restituisce solo date + cwd + tools list.
      // Passiamo customPrompt truthy per attivare il ramo personalizzato.
      // === Expert vs normale: loader diverso (Expert carica la skill + system prompt Expert) ===
      const customResourceLoader = this.#buildResourceLoader(effectiveCwd, (() => { let a = this.#resolveAgentId(sk); if (a && a.includes(',')) { const ids = a.split(',').map(s => s.trim()).filter(Boolean); a = ids.find(id => id === 'orchestrator') || ids[0] || null; } return a; })(), sk);
      await customResourceLoader.reload();

      // === Tool personalizzati: delegate_to_agent per agenti che lo hanno nel config ===
      const rawResolvedAgentId = (data as any).agentId || this.#resolveAgentId(sk);
      // Extract single agent from comma-separated list (same logic as #buildSystemPrompt)
      let resolvedAgentId: string | null = rawResolvedAgentId;
      if (resolvedAgentId && typeof resolvedAgentId === 'string' && resolvedAgentId.includes(',')) {
        const ids = resolvedAgentId.split(',').map(s => s.trim()).filter(Boolean);
        resolvedAgentId = ids.find(id => id === 'orchestrator') || ids[0] || null;
      }
      if ((data as any).agentId) this.#agentOverride.set(sk, String((data as any).agentId));
      const customTools: any[] = [];
      // Always register skill tool (so agents can list/search/load skills)
      const skillTool = this.#buildSkillTool(() => this.#active.get(sk));
      if (skillTool) customTools.push(skillTool);
      // market tool: gli agenti possono usare il Quinki Market (skill quinki-market)
      try {
        const marketTool = this.#buildMarketTool();
        if (marketTool) customTools.push(marketTool);
      } catch (e: any) { this.logDebug("market-tool-error", { sessionKey: sk, error: String(e?.message || e) }); }
      if (resolvedAgentId) {
        // Check if the agent has delegate_to_agent in its config tools
        const agentCfg = this.#readAgentConfigFile(resolvedAgentId);
        const isOrchestrator = resolvedAgentId === 'orchestrator';
        const hasDelegateTool = agentCfg?.tools?.includes('delegate_to_agent');
        if (hasDelegateTool) {
          const delegateTool = this.#buildDelegateTool(sk);
          if (delegateTool) customTools.push(delegateTool);
          this.logDebug("delegate-tool-registered", { sessionKey: sk, agentId: resolvedAgentId, isOrchestrator });
        }
        // bash_readonly: TOOL REALE e autonomo — registrato alla creazione se l'agente lo ha nel config
        const hasBashReadonly = agentCfg?.tools?.includes('bash_readonly');
        if (hasBashReadonly) {
          try {
            const broTool = this.#buildBashReadonlyTool(sk);
            if (broTool) customTools.push(broTool);
            this.logDebug("bash-readonly-tool-registered", { sessionKey: sk, agentId: resolvedAgentId });
          } catch (e: any) {
            this.logDebug("bash-readonly-tool-error", { sessionKey: sk, error: String(e?.message || e) });
          }
        }
        // A2.2: schedule_task SOLO se l'agente lo ha nel config tools (assegnabile dalla tab Agents)
        const hasScheduleTool = !!(agentCfg?.tools?.includes('schedule_task'));
        if (hasScheduleTool) {
          try {
            const schedTool = this.#buildScheduleTool(sk);
            if (schedTool) customTools.push(schedTool);
            this.logDebug("schedule-tool-registered", { sessionKey: sk, agentId: resolvedAgentId });
          } catch (e: any) {
            this.logDebug("schedule-tool-error", { sessionKey: sk, error: String(e?.message || e) });
          }
        }
        // P2 #10: cancel_schedule — l'agente può cancellare le schedule che ha creato
        const hasCancelScheduleTool = !!(agentCfg?.tools?.includes('cancel_schedule'));
        if (hasCancelScheduleTool) {
          try {
            const cancelTool = this.#buildCancelScheduleTool(sk);
            if (cancelTool) customTools.push(cancelTool);
            this.logDebug("cancel-schedule-tool-registered", { sessionKey: sk, agentId: resolvedAgentId });
          } catch (e: any) {
            this.logDebug("cancel-schedule-tool-error", { sessionKey: sk, error: String(e?.message || e) });
          }
        }
        // A2.10: tool task (getTaskStatus/getTaskResult/readHandoff) SOLO se l'agente li ha nel config
        const hasTaskTools = !!(agentCfg?.tools?.includes('getTaskStatus') || agentCfg?.tools?.includes('getTaskResult') || agentCfg?.tools?.includes('readHandoff'));
        if (hasTaskTools) {
          try {
            const taskTools = this.#buildTaskTools(sk);
            if (taskTools.length > 0) customTools.push(...taskTools);
            this.logDebug("task-tools-registered", { sessionKey: sk, agentId: resolvedAgentId, count: taskTools.length });
          } catch (e: any) {
            this.logDebug("task-tools-error", { sessionKey: sk, error: String(e?.message || e) });
          }
        }
        // screenshot: solo per l'App Expert o agenti che lo hanno nel config tools
        const hasScreenshotTool = !!(agentCfg?.tools?.includes('screenshot')) || resolvedAgentId === 'app-expert';
        if (hasScreenshotTool) {
          try {
            const screenshotTool = this.#buildScreenshotTool(sk);
            if (screenshotTool) customTools.push(screenshotTool);
          } catch (e: any) { this.logDebug("screenshot-tool-reg-error", { sessionKey: sk, error: String(e?.message || e) }); }
        }
      }
      // MCP tools: server abilitati sull'agente (mcpServers nel config)
      try {
        const mcpTools = await this.#buildMcpTools(sk, resolvedAgentId);
        if (mcpTools.length > 0) customTools.push(...mcpTools);
      } catch (e: any) {
        this.logDebug("mcp-tools-error", { sessionKey: sk, error: String(e?.message || e) });
      }
      this.logDebug("createAgentSession-customTools", { sessionKey: sk, resolvedAgentId, customToolsCount: customTools.length, toolNames: customTools.map((t: any) => t?.name || '?') });
      const result = await this.#sdk.createAgentSession({
        cwd: effectiveCwd,
        agentDir: this.#agentDir,
        sessionManager: sm,
        resourceLoader: customResourceLoader,
        customTools: customTools.length > 0 ? customTools : undefined,
      });

      pi = result.session;
      try { pi.toolExecution = "sequential"; } catch {}
      this.#active.set(sk, pi);
      // Salva l'mtime dei skill file (per auto-reload alla prossima send se l'Expert li edita)
      if (this.#isExpertKey(sk)) this.#skillsMtime.set(sk, this.#skillsDirMtime(effectiveCwd));

      this.logDebug("agent-session-created", {
        sessionKey: sk,
        systemPromptCustomLoader: true,
      });

      const pendingModel = this.#pendingModels.get(sk);
      if (pendingModel) {
        this.#pendingModels.delete(sk);
        try {
          const authPath = path.join(this.#agentDir, "auth.json");
          const modelsPath = path.join(this.#agentDir, "models.json");
          const registry = await this.#createRegistry();
          const model = this.#findModelInRegistry(registry, pendingModel);
          if (model) {
            await pi.setModel(model);
            // === Fix 11: ripristinare system prompt minimale dopo setModel ===
            try {
              pi.agent.state.systemPrompt = this.#buildSystemPrompt(sk, effectiveCwd, data.workingDirs, undefined, undefined);
            } catch {}
            const actualModel = (() => { try { return pi.model?.id; } catch { return pendingModel; } })();
            this.logDebug("pending-model-applied", { sessionKey: sk, requested: pendingModel, actual: actualModel, accepted: actualModel === pendingModel });
          }
          else { this.logDebug("pending-model-not-found", { sessionKey: sk, model: pendingModel }); }
        } catch (e: any) { this.logDebug("pending-model-error", { sessionKey: sk, error: e?.message }); }
      }

      const pendingThinking = this.#pendingThinking.get(sk);
      const sessionEntryForThinking = s ?? this.#entries.get(sk);
      const intendedThinking = pendingThinking || sessionEntryForThinking?.thinkingLevel;
      this.logDebug("send-thinking-intent", { sessionKey: sk, pendingThinking, savedThinking: sessionEntryForThinking?.thinkingLevel, intendedThinking });
      if (intendedThinking) {
        this.#pendingThinking.delete(sk);
        // Map "on" to a real level before applying to Pi SDK
        let levelToApply = intendedThinking;
        if (levelToApply === 'on') {
          const currentPi = (() => { try { return pi.thinkingLevel; } catch { return undefined; } })();
          if (currentPi && currentPi !== 'off') {
            levelToApply = currentPi;
          } else {
            const defaultLevel = pickDefaultThinkingLevel();
            const avail = (() => { try { return pi.getAvailableThinkingLevels?.(); } catch { return undefined; } })() || ['off', 'low', 'medium', 'high', 'xhigh'];
            levelToApply = avail.includes(defaultLevel) ? defaultLevel : (avail.filter(l => l !== 'off').pop() || 'medium');
          }
        }
        try {
          pi.setThinkingLevel(levelToApply);
          const actual = (() => { try { return pi.thinkingLevel; } catch { return levelToApply; } })();
          const accepted = actual === levelToApply;
          this.logDebug("pending-thinking-applied", { sessionKey: sk, requested: intendedThinking, resolvedTo: levelToApply, actual, accepted, source: pendingThinking ? "pendingThinking" : "savedThinking" });
          // [v0.0.61] Deduce cosa Pi SDK costruirà nel body HTTP per il livello applicato
          const modelId = this.#modelIdFromSession(s);
          const intent = this.#computeProviderHttpIntent(modelId, intendedThinking);
          if (intent) {
            this.logDebug("thinking-http-intent", {
              sessionKey: sk,
              model: modelId,
              userRequest: intendedThinking === "xhigh" ? "On" : (intendedThinking === "off" ? "Off" : intendedThinking),
              piSdkLevel: intendedThinking,
              providerName: intent.providerName,
              providerFormat: intent.providerFormat,
              thinkingEnabled: intent.thinkingEnabled,
              httpParamName: intent.httpParamName,
              httpParamValue: intent.httpParamValue,
              ollamaNativeValue: intent.ollamaNativeValue,
              mapOffValue: intent.mapOffValue,
              additionalHttpParam: intent.additionalHttpParam ?? null,
              note: intent.note,
            });
          }
          if (s) { s.thinkingLevel = levelToApply; this.#save(); }
          this.#sendToWs(ws, { type: "thinking_updated", sessionKey: sk, level: levelToApply, requested: intendedThinking, accepted, note: accepted ? "ok" : "pi-thinks-ignored-keeping-user-intent" });
          this.logDebug("send-thinking-state", { sessionKey: sk, saved: sessionEntryForThinking?.thinkingLevel, applied: intendedThinking, pi_state_after: actual, accepted, note: accepted ? "ok" : "pi-thinks-ignored-keeping-user-intent" });
        } catch (e: any) { this.logDebug("pending-thinking-error", { sessionKey: sk, error: e?.message }); }
      } else {
        this.logDebug("send-thinking-state", { sessionKey: sk, saved: sessionEntryForThinking?.thinkingLevel, applied: null, note: "no saved thinking level" });
        // [v0.0.61] Emetti anche per il caso default (off) così abbiamo sempre il log
        const modelId = this.#modelIdFromSession(s);
        const intent = this.#computeProviderHttpIntent(modelId, "off");
        if (intent) {
          this.logDebug("thinking-http-intent", {
            sessionKey: sk,
            model: modelId,
            userRequest: "Off",
            piSdkLevel: "off",
            providerName: intent.providerName,
            providerFormat: intent.providerFormat,
            thinkingEnabled: intent.thinkingEnabled,
            httpParamName: intent.httpParamName,
            httpParamValue: intent.httpParamValue,
            ollamaNativeValue: intent.ollamaNativeValue,
            mapOffValue: intent.mapOffValue,
            additionalHttpParam: intent.additionalHttpParam ?? null,
            note: intent.note,
          });
        }
      }

      // === Apply Plan/Build mode (pending or saved, default build) ===
      // Long Horizon: discussion/planning FORZA plan mode, running FORZA build mode.
      const pendingMode = this.#pendingMode.get(sk);
      const lhPhaseNow = this.#lhPhase.get(sk);
      let intendedMode = pendingMode || (s ?? this.#entries.get(sk))?.mode || "plan";
      // FIX 084 (03 set): il worker spawnato lazy puo' non avere l'entry in memoria
      // (#load al boot prima della save del main) -> mode/model persi -> fallback "plan".
      // Ricarica on-demand dal file quando l'entry manca o non ha mode.
      const entryNow = s ?? this.#entries.get(sk);
      if ((!entryNow?.mode) && this.#entries.has(sk) === false) {
        try {
          const onDisk = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
          const found = (Array.isArray(onDisk) ? onDisk : []).find((x: any) => x.key === sk);
          if (found && found.mode) {
            this.#entries.set(sk, { ...(this.#entries.get(sk) || {}), key: sk, label: found.label || "Chat", order: found.order || Date.now(), lastActivity: found.lastActivity || Date.now(), createdAt: found.createdAt || Date.now(), mode: found.mode, model: found.model, thinkingLevel: found.thinkingLevel, agentId: found.agentId, agentOverrides: found.agentOverrides, workingDir: found.workingDir } as any);
            intendedMode = found.mode || intendedMode;
            this.logDebug("mode-entry-reloaded", { sessionKey: sk, mode: found.mode });
          }
        } catch {}
      }
      if (lhPhaseNow === "discussion" || lhPhaseNow === "planning") intendedMode = "plan";
      else if (lhPhaseNow === "running") intendedMode = "build";
      this.#pendingMode.delete(sk);
      try { this.#applyMode(pi, sk, intendedMode, data.workingDirs, effectiveCwd, !!(resolvedAgentId && (resolvedAgentId === 'orchestrator' || this.#readAgentConfigFile(resolvedAgentId)?.tools?.includes('delegate_to_agent')))); this.logDebug("mode-applied-send", { sessionKey: sk, mode: intendedMode }); }
      catch (e: any) { this.logDebug("mode-apply-error", { sessionKey: sk, error: e?.message }); }

      // === Apply per-agent model/thinking override (for direct @tag — MAIN path) ===
      // When the resolved agent is NOT the orchestrator and has an override, apply it.
      // This covers @tag direct: the agent was set via setAgent() before send(),
      // and the override model/thinking should take precedence over chat defaults.
      const directAgentOverride = (s as any)?.agentOverrides?.[resolvedAgentId];
      if (directAgentOverride && resolvedAgentId !== 'orchestrator' && !resolvedAgentId.includes('orchestrator')) {
        this.logDebug("send-agent-override-check", { sessionKey: sk, agentId: resolvedAgentId, override: directAgentOverride });
        // Apply model override
        if (directAgentOverride.model) {
          try {
            const authPath = path.join(this.#agentDir, "auth.json");
            const modelsPath = path.join(this.#agentDir, "models.json");
            const registry = await this.#createRegistry();
            const overrideModel = this.#findModelInRegistry(registry, directAgentOverride.model);
            if (overrideModel) {
              await pi.setModel(overrideModel);
              this.logDebug("send-agent-override-model", { sessionKey: sk, agentId: resolvedAgentId, model: directAgentOverride.model, applied: true });
            } else {
              this.logDebug("send-agent-override-model", { sessionKey: sk, agentId: resolvedAgentId, model: directAgentOverride.model, applied: false, reason: "not found in registry" });
            }
          } catch (e: any) { this.logDebug("send-agent-override-model-error", { sessionKey: sk, error: e?.message }); }
        }
        // Apply thinking override
        if (directAgentOverride.thinkingLevel) {
          const oThink = directAgentOverride.thinkingLevel;
          // FIX F9-FINALE (02 set, specifica utente): 'on' NON imposta MAI un livello
          // concreto. Il massimo-per-modello/provider lo garantisce la macchina del
          // SESSION level (universal thinking: sonda caps, evoluzione a ogni boot,
          // mappature per provider — riconoscerà anche livelli futuri tipo 'ultra').
          // Qui: 'off' → off; 'on' → garantiamo solo che NON sia spento (se lo è,
          // riportiamo il livello sessione, che l'app tiene già al massimo).
          // MAI passare 'max' al Pi SDK (non è un livello Pi valido → l'SDK riporta OFF).
          if (oThink === 'off') {
            try { pi.setThinkingLevel('off'); this.logDebug("send-agent-override-thinking", { sessionKey: sk, agentId: resolvedAgentId, requested: 'off', applied: 'off' }); }
            catch (e: any) { this.logDebug("send-agent-override-thinking-error", { sessionKey: sk, error: e?.message }); }
          } else if (['minimal', 'low', 'medium', 'high', 'xhigh'].includes(oThink)) {
            // FIX F9c (03 set — finding #3 completo): i livelli CONCRETI dell'override per agente
            // vanno applicati DIRETTAMENTE (validati contro i livelli disponibili del modello).
            try {
              const avail: string[] = (() => { try { return (pi.getAvailableThinkingLevels?.() || []) as string[]; } catch { return []; } })();
              if (avail.length === 0 || avail.includes(oThink)) {
                pi.setThinkingLevel(oThink);
                this.logDebug("send-agent-override-thinking", { sessionKey: sk, agentId: resolvedAgentId, requested: oThink, applied: oThink, note: 'concrete-override' });
              } else {
                this.logDebug("send-agent-override-thinking", { sessionKey: sk, agentId: resolvedAgentId, requested: oThink, applied: 'rejected', reason: 'level-not-available-for-model', available: avail });
              }
            } catch (e: any) { this.logDebug("send-agent-override-thinking-error", { sessionKey: sk, error: e?.message }); }
          } else {
            try {
              const cur = (() => { try { return pi.thinkingLevel; } catch { return ''; } })();
              if (!cur || cur === 'off') {
                const sLevel = ((s ?? this.#entries.get(sk)) as any)?.thinkingLevel || 'xhigh';
                const up = sLevel === 'off' ? 'xhigh' : sLevel;
                pi.setThinkingLevel(up);
                this.logDebug("send-agent-override-thinking", { sessionKey: sk, agentId: resolvedAgentId, requested: oThink, applied: up, note: 'was-off-returned-to-session-level' });
              } else {
                this.logDebug("send-agent-override-thinking", { sessionKey: sk, agentId: resolvedAgentId, requested: oThink, applied: cur, note: 'session-level-machinery-owns-the-max' });
              }
            } catch (e: any) { this.logDebug("send-agent-override-thinking-error", { sessionKey: sk, error: e?.message }); }
          }
        }
      }

    // (skill rebuild moved to right before sendUserMessage)

      this.#captureSessionMeta(sk);

      // === Fix 3/B5+B3: applica pending compaction auto (o leggi da session) ===
      // IMPORTANTE: Pi SDK auto-compaction a 96% (shouldCompact di default) → disattiviamola SEMPRE.
      // La nostra logica a 80% in ChatArea gestisce la compaction.
      const pendingCompactionAuto = this.#pendingCompactionAuto.get(sk);
      const sessionCompactionAuto = (s as any)?.compactionAuto;
      // intendedCompactionAuto è il valore UTENTE (checkbox impostazioni), NON il valore Pi SDK.
      // Lo usiamo per popolare il flag di sessione e l'UI, ma Pi SDK resta sempre disattivato.
      const intendedCompactionAuto = typeof pendingCompactionAuto === "boolean"
        ? pendingCompactionAuto
        : (typeof sessionCompactionAuto === "boolean" ? sessionCompactionAuto : true);
      this.#pendingCompactionAuto.delete(sk);
      try {
        // === Fix 3/B3: disattivare SEMPRE l'auto-compaction di Pi SDK.
        // La nostra auto-compaction a 80% sostituisce quella di Pi SDK a 96%. ===
        pi.setAutoCompactionEnabled(false);
        this.logDebug("compaction-auto-applied", {
          sessionKey: sk,
          intended: intendedCompactionAuto,
          piSdkAutoCompaction: "disabled",
          source: pendingCompactionAuto !== undefined ? "pending" : "sessionOrDefault",
          note: "Pi SDK auto-compaction always disabled, quinki compaction at 80% takes over",
        });
      } catch (e: any) { this.logDebug("compaction-auto-apply-error", { sessionKey: sk, error: e?.message }); }

      const levels = (() => { try { return pi.getAvailableThinkingLevels?.() || ["off"]; } catch { return ["off"]; } })();
      // Estrai i valori Ollama REALI (mapped) dal thinkingLevelMap per la UI
      const ollamaLevels = (() => {
        try {
          const map = (pi.model as any)?.thinkingLevelMap;
          if (map) {
            return levels.map((l: string) => {
              const mapped = map[l];
              return mapped ? { pi: l, ollama: mapped } : null;
            }).filter(Boolean);
          }
        } catch {}
        return levels.map((l: string) => ({ pi: l, ollama: l }));
      })();
      this.logDebug("available-thinking-levels", {
        sessionKey: sk,
        model: s?.model,
        piLevels: levels,
        ollamaLevels,
      });
      // Invia sia i livelli Pi SDK che i valori Ollama
      const payload = { type: "thinking_levels", sessionKey: sk, levels, ollamaLevels };
      this.logDebug("sending-thinking-levels", { sessionKey: sk, levels, ollamaLevels, payloadKeys: Object.keys(payload) });
      this.#sendToWs(ws, payload);

      this.#listen(pi, sk);
    }

    this.#emitContextUsage(ws, sk, "ctx-pre-prompt");

    // === Fix 2/B2: log diagnostico send-preflight per indagine modello bloccato con messaggi grossi ===
    try {
      const messages = (pi.agent?.state?.messages || []) as any[];
      const contextWindow = (() => { try { return pi.model?.contextWindow ?? 0; } catch { return 0; } })();
      const stats = computePreflightStats(messages, data.text, data.files, contextWindow);
      this.logDebug("send-preflight", { sessionKey: sk, ...stats });
    } catch (e: any) {
      this.logDebug("send-preflight-error", { sessionKey: sk, error: e?.message || String(e) });
    }

    // Log effettivo dello stato del thinking al momento del prompt
    const piThinkingAtPrompt = (() => { try { return pi.thinkingLevel; } catch { return undefined; } })();
    const piReasoningAtPrompt = (() => { try { return pi.model?.reasoning; } catch { return undefined; } })();
    this.logDebug("prompt-thinking-state", {
      sessionKey: sk,
      model: s?.model,
      savedThinkingLevel: s?.thinkingLevel,
      effectiveThinkingLevel: piThinkingAtPrompt,
      modelSupportsReasoning: piReasoningAtPrompt,
    });

    // === D: build content con supporto completo file ===
    const { content } = await this.#buildUserMessage(data.text, data.files);
    // === FASE 0: log diagnostico del payload costruito ===
    this.logDebug("stream-send-payload", {
      sessionKey: sk,
      textLen: (data.text || "").length,
      filesCount: (data.files || []).length,
      filesInfo: (data.files || []).map((f: any) => ({ name: f.name, type: f.type, size: f.size, hasData: !!f.data, hasPath: !!f.path })),
      contentArrLen: content.length,
      contentArrTypes: content.map((c: any) => ({ type: c.type, len: c.text?.length || c.data?.length || 0, mime: c.mimeType })),
      contentArrPreview: content.map((c: any) => ({ type: c.type, preview: (c.text || "").substring(0, 100) })),
    });

    let prev = this.#prompts.get(sk) || Promise.resolve();
      // === STALE CHAIN RESET (29 ago — la variante 'il turno era finito ma il
      // backend non lo sapeva'): la promessa del turno precedente poteva restare
      // APPESA anche se il frontend aveva visto tutto finito (eventi consegnati,
      // pill spenta). Il messaggio nuovo si accodava alla promessa morta → Running
      // eterno. Ora: catena pendente da >10 minuti + nessun turno vivo in streaming
      // = catena morta → si azzera e si riparte puliti.
      try {
        const pAt = this.#promptsAt.get(sk) || 0;
        const chainStale = pAt > 0 && (Date.now() - pAt > 10 * 60 * 1000);
        if (chainStale && !this.#streamingBuffers.has(sk) && !this.#responseTimers.has(sk)) {
          this.logDebug("stale-chain-reset", { sessionKey: sk, ageMs: Date.now() - pAt, note: "promessa pendente del turno precedente: azzerata" });
          this.#prompts.delete(sk);
          this.#promptsAt.delete(sk);
          prev = Promise.resolve();
        }
      } catch {}
    // === Aggiorna system prompt ad ogni messaggio (agenti possono cambiare mid-chat) ===
    try {
      let builtPrompt: string | undefined;
      if (pi.agent?.state) {
        const sessionMode = this.#entries.get(sk)?.mode || "plan";
        builtPrompt = this.#buildSystemPrompt(sk, effectiveCwd, data.workingDirs, sessionMode, undefined, undefined, data.taskClips);
        pi.agent.state.systemPrompt = builtPrompt;
        (pi as any)._baseSystemPrompt = builtPrompt;
      }
      this.logDebug("system-prompt-updated", { sessionKey: sk, promptLen: builtPrompt?.length || 0, hasSkills: builtPrompt?.includes("available_skills") || false, hasModeNote: builtPrompt?.includes("MODALITÀ") || false, hasAgentPrompt: (builtPrompt?.length || 0) > 100 });
    } catch (overrideErr) {
      this.logDebug("system-prompt-update-error", { sessionKey: sk, error: (overrideErr as any)?.message || String(overrideErr) });
    }
    // === ALWAYS rebuild system prompt RIGHT BEFORE sendUserMessage ===
    // This ensures skills are one-shot: present only for the message they're attached to
    try {
      const skillNames = (data.skillNames && data.skillNames.length > 0) ? data.skillNames : undefined;
      const resolvedAgent = this.#resolveAgentId(sk);
      const isOrchestrator = resolvedAgent === 'orchestrator' || (resolvedAgent && resolvedAgent.includes('orchestrator'));
      const skillsForPrompt = skillNames ? skillNames.filter((s: any) => {
        if (isOrchestrator) return s.agentId === 'orchestrator';
        return true;
      }) : undefined;
      const agentCfg = resolvedAgent ? this.#readAgentConfig(resolvedAgent) : null;
      const sessionModeNow = this.#entries.get(sk)?.mode || "plan";
            // IMPORTANTE: passa la modalità così la nota "Sei in MODALITÀ PIANO/BUILD" NON viene persa
            // (il rebuild senza mode faceva sembrare al modello di essere sempre in plan).
            let prompt = this.#buildSystemPrompt(sk, effectiveCwd, data.workingDirs, sessionModeNow, skillsForPrompt, data.attachments, data.taskClips);
      // When NO skill is attached, add explicit note that previous skills are deactivated
      if (!skillNames) {
      }
      try { (pi as any)._customSystemPromptOverride = true; } catch {}
      try { (pi as any)._baseSystemPrompt = prompt; } catch {}
      pi.agent.state.systemPrompt = prompt;
            // Log system prompt via logDebug (uses existing debug_log flow)
      // Include le definizioni COMPLETE dei tool attivi inviati al modello (canale tools),
      // customTool MCP inclusi — così il log mostra esattamente tutto ciò che arriva all'agente.
      const activeTools = this.#activeToolDefs(pi, sk);
      this.logDebug("system_prompt", { sessionKey: sk, len: prompt.length, hasSkills: !!(skillsForPrompt && skillsForPrompt.length > 0), skills: skillsForPrompt ? skillsForPrompt.map((s: any) => s.skillName) : [], agentId: resolvedAgent || "unknown", agentName: agentCfg?.name || resolvedAgent || "unknown", isDelegation: false, isOrchestrator, messageText: (data.text || "").substring(0, 200), activeToolCount: activeTools.length, activeTools, prompt: prompt });
      // Store skills for delegation — #buildDelegateTool will inject them into the delegated agent's system prompt
      if (skillNames && skillNames.length > 0) {
        this.#pendingDelegationSkills.set(sk, skillNames);
      } else {
        this.#pendingDelegationSkills.delete(sk);
      }
      // Store attachments for delegation — #buildDelegateTool will inject them
      if (data.attachments && data.attachments.length > 0) {
        this.#pendingDelegationAttachments.set(sk, data.attachments);
      } else {
        this.#pendingDelegationAttachments.delete(sk);
      }
    } catch (e: any) { this.logDebug("skill-rebuild-error", { sessionKey: sk, error: e?.message }); }

    // === Unified agent_llm_config log: what the LLM actually receives ===
    {
      const rawAgent = this.#resolveAgentId(sk);
      // Extract single agent from comma-separated list (same logic as #buildSystemPrompt)
      let resolvedAgent: string | null = rawAgent;
      if (resolvedAgent && resolvedAgent.includes(',')) {
        const ids = resolvedAgent.split(',').map(s => s.trim()).filter(Boolean);
        resolvedAgent = ids.find(id => id === 'orchestrator') || ids[0] || null;
      }
      const agentCfg = resolvedAgent ? this.#readAgentConfig(resolvedAgent) : null;
      const agentName = agentCfg?.name || resolvedAgent || "unknown";
      const sEntry = this.#entries.get(sk);
      const overrides = (sEntry as any)?.agentOverrides?.[resolvedAgent] || {};
      let actualModel = ""; try { actualModel = pi.model?.id || ""; } catch {}
      let actualThinking = ""; try { actualThinking = pi.thinkingLevel || ""; } catch {}
      let thinkingTranslated = this.#translateThinkingForModel(actualThinking, actualModel);
      this.logDebug("agent_llm_config", {
        sessionKey: sk,
        source: "main",
        agentId: resolvedAgent || "unknown",
        agentName,
        model: actualModel,
        thinkingLevel: actualThinking,
        thinkingTranslated,
        chatModel: sEntry?.model || "",
        chatThinking: sEntry?.thinkingLevel || "",
        agentOverrideModel: overrides.model || null,
        agentOverrideThinking: overrides.thinkingLevel || null,
        systemPromptLen: pi?.agent?.state?.systemPrompt?.length || 0,
      });
    }

    // === AUTO-COMPACTION: se il contesto SUPERA la soglia (es. > 80%), compatta PRIMA del turno ===
    try {
      const sEntry2 = this.#entries.get(sk);
      const auto2 = (sEntry2 as any)?.compactionAuto ?? true;
      if (auto2 && !this.#compactingSessions.has(sk)) {
        const threshold2 = (sEntry2 as any)?.compactionThreshold ?? 80;
        const u2 = this.getContextUsage(sk);
        const pct2 = u2?.percent ?? (u2?.tokens != null && u2.contextWindow > 0 ? (u2.tokens / u2.contextWindow) * 100 : null);
        if (pct2 != null && pct2 > threshold2) {
          this.logDebug("auto-compaction-trigger", { sessionKey: sk, percent: pct2, threshold: threshold2 });
          await this.compact(sk, ws);
        }
      }
    } catch (e: any) {
      this.logDebug("auto-compaction-error", { sessionKey: sk, error: e?.message || String(e) });
    }

    // === Pending-turn marker: persiste il turno in corso (per recovery dopo crash/riavvio) ===
    // Se l'app muore a metà turno, o il provider fallisce, il sidecar ri-prompta il modello.
    // NB: per __app_expert__ il marker lo gestisce SOLO il sidecar Expert (9183). Il
    // sidecar main (9182) NON deve scriverlo/cancellarlo: la sessione è condivisa e
    // l'interferenza della main cancella il marker → il recovery dell'Expert non parte.
    const isExpertSidecarMark = isExpertSidecar();
    // DIAGNOSTIC: il marker-write non viene MAI eseguito nei worker. Questo log
    // ci dice se il codice ARRIVA qui.
    this.logDebug("pre-marker-write", { sessionKey: sk, isExpert: isExpertSidecarMark, poolIdx: poolIndex() });
    if (!(sk === "__app_expert__" && !isExpertSidecarMark)) {
    try {
      const pdir = this.#piSessionDir(sk);
      fs.mkdirSync(pdir, { recursive: true });
      let retries = 0;
      // Un messaggio NUOVO dell'utente azzera il contatore retries (il budget di
      // recovery si resetta). Solo un re-prompt di recovery (_preserveWs) lo preserva.
      const isRecovery = !!(data as any)._preserveWs;
      if (isRecovery) {
        try { const ex = JSON.parse(fs.readFileSync(path.join(pdir, "pending-turn.json"), "utf8")); retries = ex.retries || 0; } catch {}
      }
      fs.writeFileSync(path.join(pdir, "pending-turn.json"), JSON.stringify({ text: data.text, ts: Date.now(), retries }), "utf8");
      // Il turno per QUESTO marker non è ancora partito (potrebbe essere in coda
      // dietro un turno precedente). Finché non parte, agent_end di altri turni
      // NON deve cancellare il marker.
      this.#markerTurnStarted.delete(sk);
      this.logDebug("marker-write", { sessionKey: sk, where: "send", isExpert: isExpertSidecar(), retries });
    } catch {}
    }

    // Un nuovo invio = l'utente vuole riprendere: togli dalle liste "stopped" e "rePrompted"
    this.#stoppedSessions.delete(sk);
    this.#rePrompted.delete(sk);

    const next = prev.then(async () => {
      // Il turno per QUESTO marker è ora partito: l'agent_end di questo turno
      // può cancellare il marker (se completato).
      this.#markerTurnStarted.add(sk);
      // === STUCK SESSION HARD RESET (29 ago — bug 'stop → rimando → Running eterno') ===
      // Se l'SDK crede di essere ANCORA in streaming (abort non assestato, o richiesta
      // appesa che ignora l'abort), sendUserMessage con deliverAs:"followUp" ACCODA il
      // messaggio a un turno FANTASMA: non parte MAI → chat muta + pill Running.
      // Succede anche su sessioni appena create (4 messaggi): non è il peso, è lo stato.
      // Se isStreaming è vero ma non tracciamo NESSUN turno attivo (niente buffer, niente
      // timer) = fantasma → dispose + sessione pulita + invio. Mai più messaggi inghiottiti.
      try {
        const buf = this.#streamingBuffers.get(sk);
        const bufStale = !!buf && (!buf.ts || Date.now() - buf.ts > 90000);
        const ghost = (pi as any).isStreaming === true
          && (!this.#streamingBuffers.has(sk) || bufStale)
          && !this.#responseTimers.has(sk);
        if (ghost) {
          this.logDebug("send-stuck-session-hard-reset", { sessionKey: sk, note: "SDK fantasma isStreaming senza turno reale" });
          try { const un = this.#unsubs.get(sk); if (un) { try { un(); } catch {} } this.#unsubs.delete(sk); } catch {}
          try { (pi as any).dispose?.(); } catch {}
          this.#active.delete(sk);
          pi = await this.#ensureActive(sk);
        }
      } catch {}
      // Retry di sicurezza per errori THROWN (503/overloaded/rate limit) che bypassano
      // il retry interno dell'SDK. Backoff: 5s, 15s, 30s. Rispetta lo STOP.
      const delays = [5000, 15000, 30000];
      const maxAttempts = 3;
      for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        if (this.#stoppedSessions.has(sk)) return;
        try {
          await pi.sendUserMessage(content, { deliverAs: "followUp" });
          return;
        } catch (err: any) {
          const msg = String(err?.message || err);
          const retryable = /overloaded|503|429|rate.?limit|service.?unavailable|server.?error|temporarily|too many requests/i.test(msg);
          if (!retryable || attempt >= maxAttempts) {
            this.logDebug("send-user-message-error", { sessionKey: sk, message: msg, attempt });
            this.#sendToWs(ws, { type: "error", message: msg, sessionKey: sk });
            // Il turno è finito SENZA completamento (nessun agent_end stop/length):
            // il marker è ancora lì → autoprompt per farlo continuare (evento, no timer).
            this.#recoverInterruptedTurn(sk).catch(() => {});
            return;
          }
          this.logDebug("send-user-message-retry", { sessionKey: sk, attempt: attempt + 1, message: msg.slice(0, 120) });
          await new Promise((r) => setTimeout(r, delays[attempt]));
        }
      }
    }).catch((err: Error) => {
      this.logDebug("send-user-message-error", { sessionKey: sk, message: err?.message, name: err?.name, stack: err?.stack?.slice(0, 600) });
      ws.send(JSON.stringify({ type: "error", message: err.message, sessionKey: sk }));
      // Turno finito senza completamento → autoprompt per continuare
      this.#recoverInterruptedTurn(sk).catch(() => {});
    });
    this.#promptsAt.set(sk, Date.now());
    this.#prompts.set(sk, next);
    await next;
  }

  // === D: Build user message con supporto completo file ===
  // Ritorna { content: (TextContent | ImageContent)[], images: ImageContent[] }
  // - Immagini (≤ 20MB): ImageContent
  // - PDF/DOCX/XLSX (≤ 20MB): testo estratto
  // - Audio/video: solo path
  // - Testo (.txt .md .csv ecc.): inline
  // - File > 20MB: solo path
  async #buildUserMessage(text: string, files?: { name: string; type: string; path?: string; data?: string; size?: number }[]): Promise<{ content: any[] }> {
    const MAX_INLINE_SIZE = 20 * 1024 * 1024; // 20MB
    const contentArr: any[] = [];
    if (text) contentArr.push({ type: "text", text });

    if (files && files.length > 0) {
      for (const f of files) {
        const mime = f.type || "";
        const name = f.name || "";
        const size = f.size ?? (f.data ? Math.floor(f.data.length * 0.75) : 0);
        const ext = name.toLowerCase().split(".").pop() || "";
        const isText = mime.startsWith("text/") || mime === "application/json" || /\.(txt|md|csv|log|json|xml|html|yaml|yml|env|sh|js|ts|py|css|html)$/i.test(name);
        const isImage = mime.startsWith("image/");
        const isPdf = mime === "application/pdf" || ext === "pdf";
        const isDocx = mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx";
        const isXlsx = mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "xlsx";
        const isZip = mime === "application/zip" || ext === "zip";
        const isAudio = mime.startsWith("audio/");
        const isVideo = mime.startsWith("video/");

        // === Caso: solo path o file grande → solo path nel testo ===
        if (!f.data || size > MAX_INLINE_SIZE) {
          if (f.path) {
            contentArr.push({ type: "text", text: `\n[File: ${name} (${(size / 1024 / 1024).toFixed(1)} MB) salvato in ${f.path} — leggi direttamente dal filesystem per accedere al contenuto]` });
          } else {
            contentArr.push({ type: "text", text: `\n[File: ${name} (${(size / 1024 / 1024).toFixed(1)} MB) — non inviato (troppo grande o non ha path locale)]` });
          }
          continue;
        }

        // === Immagini: ImageContent ===
        if (isImage) {
          const raw = f.data.includes(",") ? f.data.split(",")[1] : f.data;
          contentArr.push({ type: "image", data: raw, mimeType: mime || "image/png" });
          continue;
        }

        // === Testo semplice: inline ===
        if (isText) {
          const raw = f.data.includes(",") ? f.data.split(",")[1] : f.data;
          try {
            const txt = Buffer.from(raw, "base64").toString("utf8");
            contentArr.push({ type: "text", text: `\n--- Contenuto di ${name} ---\n${txt}\n--- Fine ${name} ---` });
          } catch {
            contentArr.push({ type: "text", text: `\n[File: ${name} — errore lettura contenuto]` });
          }
          continue;
        }

        // === PDF: estrai testo con pdf-parse ===
        if (isPdf) {
          try {
            const pdfParse = require("pdf-parse");
            const raw = f.data.includes(",") ? f.data.split(",")[1] : f.data;
            const buf = Buffer.from(raw, "base64");
            const result = await pdfParse(buf);
            contentArr.push({ type: "text", text: `\n--- Contenuto PDF di ${name} ---\n${result.text}\n--- Fine ${name} ---` });
          } catch (e: any) {
            this.logDebug("extract-pdf-error", { name, error: String(e) });
            contentArr.push({ type: "text", text: `\n[File PDF: ${name} — errore estrazione testo: ${e?.message || e}]` });
          }
          continue;
        }

        // === DOCX: mammoth ===
        if (isDocx) {
          try {
            const mammoth = require("mammoth");
            const raw = f.data.includes(",") ? f.data.split(",")[1] : f.data;
            const buf = Buffer.from(raw, "base64");
            const result = await mammoth.extractRawText({ buffer: buf });
            contentArr.push({ type: "text", text: `\n--- Contenuto DOCX di ${name} ---\n${result.value}\n--- Fine ${name} ---` });
          } catch (e: any) {
            this.logDebug("extract-docx-error", { name, error: String(e) });
            contentArr.push({ type: "text", text: `\n[File DOCX: ${name} — errore estrazione testo: ${e?.message || e}]` });
          }
          continue;
        }

        // === XLSX: leggi con xlsx ===
        if (isXlsx) {
          try {
            const XLSX = require("xlsx");
            const raw = f.data.includes(",") ? f.data.split(",")[1] : f.data;
            const buf = Buffer.from(raw, "base64");
            const wb = XLSX.read(buf, { type: "buffer" });
            let csv = "";
            for (const sheetName of wb.SheetNames) {
              const sheet = wb.Sheets[sheetName];
              csv += `\n=== Foglio: ${sheetName} ===\n${XLSX.utils.sheet_to_csv(sheet)}\n`;
            }
            contentArr.push({ type: "text", text: `\n--- Contenuto XLSX di ${name} ---\n${csv}\n--- Fine ${name} ---` });
          } catch (e: any) {
            this.logDebug("extract-xlsx-error", { name, error: String(e) });
            contentArr.push({ type: "text", text: `\n[File XLSX: ${name} — errore estrazione testo: ${e?.message || e}]` });
          }
          continue;
        }

        // === ZIP: lista file + estrai piccoli ===
        if (isZip) {
          try {
            const AdmZip = require("adm-zip");
            const raw = f.data.includes(",") ? f.data.split(",")[1] : f.data;
            const buf = Buffer.from(raw, "base64");
            const zip = new AdmZip(buf);
            const entries = zip.getEntries();
            const list = entries.map((e: any) => `${e.isDirectory ? "[DIR]" : "[FILE]"} ${e.entryName} (${e.header.size} bytes)`).join("\n");
            contentArr.push({ type: "text", text: `\n--- Contenuto ZIP di ${name} (${entries.length} entries) ---\n${list}\n--- Fine ${name} ---` });
          } catch (e: any) {
            this.logDebug("extract-zip-error", { name, error: String(e) });
            contentArr.push({ type: "text", text: `\n[File ZIP: ${name} — errore estrazione: ${e?.message || e}]` });
          }
          continue;
        }

        // === Audio/Video: solo path (Pi SDK non supporta nativamente) ===
        if (isAudio || isVideo) {
          if (f.path) {
            contentArr.push({ type: "text", text: `\n[File ${isAudio ? "audio" : "video"}: ${name} (${(size / 1024 / 1024).toFixed(1)} MB) salvato in ${f.path} — usa strumenti per leggere se il modello lo supporta]` });
          } else {
            contentArr.push({ type: "text", text: `\n[File ${isAudio ? "audio" : "video"}: ${name} — non supportato senza path locale]` });
          }
          continue;
        }

        // === Default: solo path ===
        if (f.path) {
          contentArr.push({ type: "text", text: `\n[File: ${name} (${(size / 1024 / 1024).toFixed(1)} MB) salvato in ${f.path}]` });
        } else {
          contentArr.push({ type: "text", text: `\n[File: ${name} — non supportato]` });
        }
      }
    }

    return { content: contentArr };
  }

  steer(ws: any, data: { sessionKey: string; text: string }) {
    const pi = this.#active.get(data.sessionKey);
    if (!pi) { this.logDebug("steer-no-session", { sessionKey: data.sessionKey }); return; }
    if (data.text === "/stop") { pi.abort(); this.logDebug("steer-stop", { sessionKey: data.sessionKey }); }
    else { pi.steer(data.text); this.logDebug("steer-sent", { sessionKey: data.sessionKey, text: data.text.slice(0, 120) }); }
  }

  abort(key: string) {
    // Marca come "stopped" così il recovery NON ri-promptava, e cancella il marker
    this.#stoppedSessions.add(key);
    // === AUTOPROMPT 2.0: lo STOP PERSISTITO SU DISCO — il recovery non deve
    // MAI ripetere un lavoro che l'utente ha fermato, nemmeno dopo i riavvii.
    try {
      const sp = path.join(this.#piSessionDir(key), "stopped-turn.json");
      fs.writeFileSync(sp, JSON.stringify({ ts: Date.now() }), "utf8");
      this.logDebug("stop-persisted", { sessionKey: key });
    } catch {}
    // FIX (01 set): NON cancellare stopped-turn.json qui! Veniva scritto e
    // IMMEDIATAMENTE cancellato nella stessa funzione → il recovery dopo il
    // riavvio non trovava il file → ri-promptava nonostante lo stop.
    // stopped-turn.json si cancella SOLO quando l'utente manda un nuovo messaggio.
    // Solo l'Expert sidecar gestisce il marker di __app_expert__ (la main non lo tocca)
    {
      const isExp = isExpertSidecar();
      if (!(key === "__app_expert__" && !isExp)) {
        try { const p = path.join(this.#piSessionDir(key), "pending-turn.json"); if (fs.existsSync(p)) { fs.unlinkSync(p); this.logDebug("marker-delete", { sessionKey: key, where: "abort", isExpert: isExp }); } } catch {}
      } else {
        this.logDebug("marker-delete-guarded", { sessionKey: key, where: "abort", isExpert: isExp });
      }
    }
    const pi = this.#active.get(key);
    if (pi) {
      try { pi.abort(); } catch {}
    }
    // === HARD CLEANUP (29 ago — il killer di 'send incastrato in Running'):
    // l'abort NON garantisce che agent_end arrivi → il buffer restava STANTIO e
    // l'SDK credeva di essere ancora in streaming → il messaggio dopo veniva
    // ACCODATO al fantasma e non partiva MAI. Ora: 2.5s dopo lo stop, se il
    // buffer è ancora lì (nessun agent_end) → CANCELLA + done visibile + pulizia.
    {
      const sk = key;
      setTimeout(() => {
        try {
          const buf = this.#streamingBuffers.get(sk);
          if (buf && (!buf.ts || Date.now() - buf.ts > 2000)) {
            this.#streamingBuffers.delete(sk);
            this.#responseTimers.delete(sk);
            this.logDebug("stop-hard-cleanup", { sessionKey: sk, note: "agent_end non arrivato, pulizia forzata" });
            try { this.#sendToWs(this.#getSessionWs(sk), { type: "streaming_stopped", sessionKey: sk, stopReason: "aborted" }); } catch {}
            try { this.#sendToWs(this.#getSessionWs(sk), { type: "done", sessionKey: sk, stopReason: "stopped", text: "" }); } catch {}
          }
        } catch {}
      }, 2500);
    }
    // Stop ALL temp sessions (delegations) — dispose kills them
    const tempKeys: string[] = [];
    for (const [tempKey, tempPi] of this.#active) {
      if (tempKey.startsWith('__delegate_')) {
        try { (tempPi as any).abort?.(); } catch (e) {}
        try { (tempPi as any).dispose?.(); } catch (e) {}
        tempKeys.push(tempKey);
      }
    }
    for (const tk of tempKeys) this.#active.delete(tk);
  }

  // === C: Compaction manuale ===
  async compact(key: string, ws?: any): Promise<{ ok: boolean; error?: string; noop?: boolean }> {
    this.logDebug("compact-request", { sessionKey: key });
    // Sopprimi lo streaming del summary durante la compaction (non deve apparire come testo in chat)
    this.#compactingSessions.add(key);
    try {
      // === Attiva la sessione se non è già attiva (come fa send()) ===
      let pi = await this.#ensureActive(key);

      // === Assicura che ci sia un WebSocket per forwardare gli eventi ===
      if (ws) this.#wss.set(key, ws);

      // === Anti-loop: leggi firstKeptEntryId della compaction precedente (se esiste) ===
      const entries = (() => {
        try {
          const sm = (pi as any)?.sessionManager || (pi as any)?.agent?.state?.sessionManager;
          return sm?.getEntries?.() || [];
        } catch { return []; }
      })();
      let prevFirstKept: string | undefined;
      for (let i = entries.length - 1; i >= 0; i--) {
        if ((entries[i] as any)?.type === "compaction") {
          prevFirstKept = (entries[i] as any)?.firstKeptEntryId;
          break;
        }
      }

      // === Anti-loop: se l'ultima entry è già un compaction, non compattare ===
      const lastEntry = entries[entries.length - 1];
      if (lastEntry && (lastEntry as any)?.type === "compaction") {
        this.logDebug("compact-noop-last-is-compaction", { sessionKey: key });
        return { ok: false, error: "Nothing to compact (last entry is already a compaction)", noop: true };
      }

      // === Conta messaggi prima della compaction ===
      const messagesBefore = entries.filter((e: any) => e?.type === "message").length;

      pi.setAutoCompactionEnabled(false);
      // === NO timeout interno: la compaction può impiegare anche molto tempo con sessioni grandi.
      // Un timeout qui interrompeva compaction lunghe → la chat non compattava mai. ===
      const result = await pi.compact();

      // === Noop detection intelligente ===
      const newFirstKept = (result as any)?.firstKeptEntryId;
      const messagesAfter = (() => { try { return (pi?.agent?.state?.messages || []).length; } catch { return messagesBefore; } })();

      // Check 1: stesso firstKeptEntryId della compaction precedente
      if (prevFirstKept && newFirstKept && prevFirstKept === newFirstKept) {
        this.logDebug("compact-noop-same-firstKept", { sessionKey: key, firstKeptEntryId: newFirstKept });
        return { ok: true, noop: true };
      }

      // Check 2: i messaggi sono stati ridotti di meno del 10%
      if (messagesBefore > 0 && messagesAfter >= messagesBefore * 0.9) {
        this.logDebug("compact-noop-barely-reduced", { sessionKey: key, messagesBefore, messagesAfter, ratio: messagesAfter / messagesBefore });
        return { ok: true, noop: true };
      }

      this.logDebug("compact-success", { sessionKey: key, firstKeptEntryId: newFirstKept, prevFirstKept, messagesBefore, messagesAfter });
      return { ok: true };
    } catch (e: any) {
      this.logDebug("compact-error", { sessionKey: key, error: e?.message || String(e) });
      return { ok: false, error: e?.message || String(e) };
    } finally {
      this.#compactingSessions.delete(key);
    }
  }

  // === E: Set auto-compaction per sessione (per init/load) ===
  applySessionCompactionSettings(key: string, enabled: boolean): void {
    try {
      const pi = this.#active.get(key);
      if (pi) pi.setAutoCompactionEnabled(enabled);
    } catch {}
  }

  // === Fix 7/B9: abort compaction manuale ===
  abortCompaction(key: string): { ok: boolean; error?: string } {
    try {
      const pi = this.#active.get(key);
      if (!pi) return { ok: false, error: "Session not active" };
      pi.abortCompaction();
      this.logDebug("abort-compaction", { sessionKey: key });
      return { ok: true };
    } catch (e: any) {
      this.logDebug("abort-compaction-error", { sessionKey: key, error: e?.message || String(e) });
      return { ok: false, error: e?.message || String(e) };
    }
  }

  #listen(pi: any, key: string) {
    // === Authorized folders + bash read-only: hook unico su beforeToolCall ===
    try {
      const origBefore = pi.agent?.beforeToolCall;
      pi.agent.beforeToolCall = async ({ toolCall, args }: any) => {
        const name = toolCall?.name;
        // 1) Authorized folders: blocca i tool file su path fuori dalle cartelle autorizzate
        const fileTools = ["read", "write", "edit", "grep", "find", "ls"];
        if (fileTools.includes(name)) {
          const p = String((args as any)?.path || (args as any)?.filePath || "");
          if (p && !this.isPathAllowed(key, p, name === "write" || name === "edit")) {
            const ws2 = this.#wss.get(key);
            try { this.#sendToWs(ws2, { type: "tool_call", sessionKey: key, toolCallId: toolCall.id, toolName: name, toolArgs: args, ts: Date.now() }); } catch {}
            this.logDebug("authorized-folder-blocked", { sessionKey: key, tool: name, path: p });
            return { content: [{ type: "text", text: `[Access denied] This path is not in an authorized folder. Agents can only access files in the working directory and the folders listed in Settings → macOS Permissions → Authorized Folders.` }], isError: true };
          }
        }
        // 2) Bash read-only: se la sessione è in modalità bash_readonly, blocca i comandi di scrittura
        if (this.#bashReadonlySessions.has(key) && (name === "bash" || name === "shell")) {
          const cmd = String((args as any)?.command || (args as any)?.cmd || (args as any)?.script || "").trim();
          if (this.#isWriteCommand(cmd)) {
            const ws2 = this.#wss.get(key);
            try { this.#sendToWs(ws2, { type: "tool_call", sessionKey: key, toolCallId: toolCall.id, toolName: name, toolArgs: args, ts: Date.now() }); } catch {}
            this.logDebug("bash-readonly-blocked", { sessionKey: key, cmd: cmd.slice(0, 120) });
            return { content: [{ type: "text", text: `[Bash read-only] This command is not allowed in read-only mode because it modifies or executes something. Use read-only commands (ls, cat, grep, find, pwd, head, tail, wc, diff, git status, git log, git diff).` }], isError: true };
          }
        }
        if (origBefore) return origBefore({ toolCall, args });
        return undefined;
      };
    } catch (e: any) { this.logDebug("tool-hook-error", { sessionKey: key, error: e?.message || String(e) }); }

    const old = this.#unsubs.get(key);
    if (old) { try { old(); } catch {} }

    const sub = pi.subscribe(async (e: any) => {
      // FIX (29 ago — bug 'Running bloccato per sempre + streaming perso'): il
      // vecchio `if (!ws || !open) return;` BUTTAVA VIA TUTTI gli eventi del turno
      // quando il socket catturato era morto (app chiusa/riaperta a metà turno,
      // restart, reconnect) → niente messaggi, niente done → pill 'Running'
      // bloccata e risposta visibile solo alla fine. Ora: MAI droppare eventi.
      // Se il ws catturato è morto usiamo un pseudo-ws che reinvia al ws PIÙ
      // RECENTE della sessione (#wss) e in mancanza fa broadcast via stdout.
      const wsReal = this.#getSessionWs(key);
      const ws = (wsReal && wsReal.readyState === wsReal.constructor?.OPEN) ? wsReal : {
        readyState: 1, constructor: { OPEN: 1 },
        send: (raw: any) => {
          try {
            const payload = JSON.parse(String(raw));
            const cur = this.#wss.get(key);
            if (cur && cur.readyState === cur.constructor?.OPEN) { cur.send(raw); return; }
            try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: payload?.type || "event", params: payload }) + "\n"); } catch {}
          } catch {}
        }
      };
      // === TAKEOVER IMMEDIATO (29 ago — richiesta utente: 'se la sessione passa
      // nella Main, alla riapertura dell'app Expert devo vederla SUBITO lì') ===
      // Se QUESTO sidecar è la Main e sta girando un turno __app_expert__ mentre
      // il processo dell'app Expert è VIVO, la Main abbandona SUBITO il turno:
      // abort + rilascio + done. L'app Expert recovery-rprompta e l'utente vede
      // lo streaming DAL VIVO. Mai più turni invisibili girati nella Main.
      if (key === "__app_expert__" && !isExpertSidecar() && isExpertAppProcessRunning()) {
        this.logDebug("takeover-expert-app-aperta-aborto-turno", { sessionKey: key });
        try { this.abort(key); } catch {}
        try { const piOwned = this.#active.get(key); if (piOwned) { try { (piOwned as any).dispose?.(); } catch {} this.#active.delete(key); this.logDebug("takeover-sessione-rilasciata", { sessionKey: key }); } } catch {}
        try { this.#sendToWs(ws, { type: "done", sessionKey: key, stopReason: "stopped", text: "" }); } catch {}
        return;
      }

      switch (e.type) {
        case "agent_start":
          this.#responseTimers.set(key, Date.now());
          ws.send(JSON.stringify({ type: "progress_start", sessionKey: key }));
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "running" });
          // === A5: streaming started event per aggiornare streamingSet nel renderer ===
          this.#sendToWs(ws, { type: "streaming_started", sessionKey: key });
          // === Multi-window: inizializza streaming buffer ===
          this.#streamingBuffers.set(key, { text: "", thinking: "", toolCalls: [], currentPhase: null, messageId: null, model: this.#active.get(key)?.model?.id || null, provider: null, stopReason: null, thinkingLevel: this.#entries.get(key)?.thinkingLevel || null, ts: Date.now() });
          // System prompt già disabilitato alla radice via resourceLoader custom in createAgentSession
          break;
        case "message_update": {
          if (this.#compactingSessions.has(key)) break; // sopprimi streaming compaction
          const ame = e.assistantMessageEvent;
          if (!ame) break;
          if (e.message?.role !== "assistant") break;

          // === Fase C.4: streaming unificato cronologico ===
          // Inoltra SOLO eventType + delta (payload minimo per performance)
          // Il renderer ricostruisce i blocchi localmente in ordine cronologico.
          // === Fase C.4: estrai nome tool dal message.content se ame.name non c'è ===
          let toolName = (ame as any)?.name || undefined;
          if (!toolName && ame.type === "toolcall_start" && Array.isArray(e.message?.content)) {
            const toolBlock = e.message.content.find((b: any) => b?.type === "toolCall");
            if (toolBlock?.name) toolName = toolBlock.name;
          }

          // messageId STABILE per turno: se l'SDK non espone l'id (path pool/worker),
          // usa quello dello streaming buffer (impostato al primo messaggio del turno)
          // così il renderer può raggruppare i delta dello stesso turno in UN messaggio.
          const buf0 = this.#streamingBuffers.get(key);
          const midForEvent = e.message?.id || (buf0?.messageId) || `turn-${key}-${Date.now()}`;
          if (buf0 && !buf0.messageId) buf0.messageId = midForEvent;
          ws.send(JSON.stringify({
            type: "stream_event",
            sessionKey: key,
            messageId: midForEvent,
            eventType: ame.type,
            delta: ame.delta || "",
            toolName,
          }));

          // === Multi-window: aggiorna streaming buffer ===
          const buf = this.#streamingBuffers.get(key);
          if (buf) buf.ts = Date.now();
          if (buf) {
            if (e.message?.id) buf.messageId = e.message.id;
            if (ame.type === "thinking_start") buf.currentPhase = "thinking";
            else if (ame.type === "thinking_delta") { buf.currentPhase = "thinking"; buf.thinking += (ame.delta || ""); }
            else if (ame.type === "thinking_end") buf.currentPhase = null;
            else if (ame.type === "text_start") buf.currentPhase = "text";
            else if (ame.type === "text_delta") { buf.currentPhase = "text"; buf.text += (ame.delta || ""); }
            else if (ame.type === "text_end") buf.currentPhase = null;
            else if (ame.type === "toolcall_start") { buf.currentPhase = "tool_call"; buf.toolCalls.push({ name: toolName || "", id: e.message?.id || "", args: "" }); }
            else if (ame.type === "toolcall_delta") buf.currentPhase = "tool_call";
            else if (ame.type === "toolcall_end") { buf.currentPhase = null; buf.ts = Date.now(); }
          }

          // Agent status per text/thinking durante streaming
          if (ame.type === "text_delta" || ame.type === "text_start") {
            this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "writing" });
          }
          if (ame.type === "thinking_delta" || ame.type === "thinking_start") {
            this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "thinking" });
          }
          // Agent status per tool calls durante streaming
          if (ame.type === "toolcall_start" || ame.type === "toolcall_delta") {
            this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "tool", detail: (ame as any)?.name });
          }
          break;
        }
        case "message_end": {
          if (this.#compactingSessions.has(key)) break;
          if (e.message?.role === "assistant") {
            const currentThinking = (() => { try { return pi.thinkingLevel; } catch { return undefined; } })();
            const sessionEntry = this.#entries.get(key);
            const requestedThinking = sessionEntry?.thinkingLevel;
            // Determina se il modello ha effettivamente fatto thinking
            let reasoningActuallyUsed = false;
            let reasoningLength = 0;
            try {
              const rc = (e.message as any).reasoning_content;
              if (typeof rc === "string" && rc.length > 0) {
                reasoningActuallyUsed = true;
                reasoningLength = rc.length;
              }
            } catch {}
            try {
              const blocks = e.message.content;
              if (Array.isArray(blocks)) {
                for (const b of blocks) {
                  if (b && b.type === "thinking" && typeof b.thinking === "string" && b.thinking.length > 0) {
                    reasoningActuallyUsed = true;
                    reasoningLength += b.thinking.length;
                  }
                }
              }
            } catch {}
            const durationMs = (() => {
              const t = this.#responseTimers.get(key);
              if (t) { this.#responseTimers.delete(key); return Date.now() - t; }
              return 0;
            })();
            const responseLen = (() => {
              try {
                if (typeof e.message.content === "string") return e.message.content.length;
                if (Array.isArray(e.message.content)) {
                  return e.message.content.filter((b: any) => b?.type === "text").map((b: any) => b.text || "").join("").length;
                }
              } catch {}
              return 0;
            })();
            const verdict = (() => {
              const wantOn = requestedThinking && requestedThinking !== "off";
              if (wantOn && !reasoningActuallyUsed) return "fail-on-without-thinking";
              if (!wantOn && reasoningActuallyUsed) return "fail-off-with-thinking";
              return "ok";
            })();
            // === THINKING TRACE (04 set): log dedicato e permanente della catena
            // thinking completa — livello richiesto, effort inviato (mapping),
            // caps del provider, uso OSSERVATO nella risposta. File dedicato:
            // ~/.quinki/thinking-trace.jsonl + logDebug "thinking-trace" (tab Log).
            try {
              const piT = this.#active.get(key);
              const sentEffort = (() => { try { const m = (piT as any)?.model?.thinkingLevelMap; return m ? (m[requestedThinking ?? ""] ?? null) : null; } catch { return null; } })();
              const capsMax = (() => { try {
                const mBase = String((piT as any)?.model?.baseUrl || "");
                const caps = JSON.parse(fs.readFileSync(path.join(process.env.HOME || "", ".quinki", "thinking-caps.json"), "utf8") || "{}");
                const capKey = (() => { try { return new URL(mBase).host + "/" + (piT as any).model.id; } catch { return (piT as any)?.model?.id; } })();
                return caps[capKey]?.maxLevel ?? null;
              } catch { return null; } })();
              const trace: any = {
                ts: Date.now(), sessionKey: key,
                model: e.message.model, provider: e.message.provider,
                requested: requestedThinking ?? null,
                sentEffort,
                capsMax,
                reasoningActuallyUsed,
                reasoningLength,
                reasoningTokens: (e.message as any)?.usage?.reasoning ?? null,
                stopReason: e.message.stopReason,
                verdict,
              };
              try { fs.appendFileSync(path.join(process.env.HOME || "", ".quinki", "thinking-trace.jsonl"), JSON.stringify(trace) + "\n", "utf8"); } catch {}
              (e.message as any).sentEffort = sentEffort;
              (e.message as any).reasoningUsed = reasoningActuallyUsed;
              (e.message as any).reasoningTokens = trace.reasoningTokens;
              this.logDebug("thinking-trace", trace);
            } catch {}
            this.logDebug("response-thinking-verified", {
              sessionKey: key,
              model: e.message.model,
              provider: e.message.provider,
              userSetThinkingLevel: requestedThinking ?? null,
              effectiveThinkingLevel: currentThinking ?? null,
              thinkingLevelMatches: requestedThinking === currentThinking,
              reasoningLength,
              reasoningActuallyUsed,
              responseLength: responseLen,
              durationMs,
              stopReason: e.message.stopReason,
              usage: (e.message as any).usage ?? null,
              verdict,
              note: verdict === "ok"
                ? "Thinking behavior matches user intent"
                : verdict === "fail-on-without-thinking"
                  ? "User set ON but model produced NO thinking — possible bug"
                  : "User set OFF but model produced thinking — possible bug",
            });
            this.logDebug("msg-content", {
              sessionKey: key,
              id: e.message.id,
              model: e.message.model,
              provider: e.message.provider,
              requestedThinkingLevel: requestedThinking,
              effectiveThinkingLevel: currentThinking,
              thinkingMismatch: requestedThinking !== currentThinking,
              reasoningActuallyUsed,
              reasoningLength,
              stopReason: e.message.stopReason,
              content: e.message.content,
              rawNewlines: typeof e.message.content === "string"
                ? (e.message.content.match(/\n/g) || []).length
                : "n/a",
              rawDoubleNewlines: typeof e.message.content === "string"
                ? (e.message.content.match(/\n\n/g) || []).length
                : "n/a",
            });
            // === DIAGNOSTICO CODE BLOCK VUOTI (FASE 1) ===
            // Log dettagliato di ogni blocco ricevuto da Pi SDK per capire
            // se il problema è upstream (modello/Pi SDK) o downstream (parsing/rendering).
            try {
              const rawContent = e.message.content;
              if (typeof rawContent === "string") {
                this.logDebug("assistant-blocks-raw", {
                  sessionKey: key,
                  msgId: e.message.id,
                  contentType: "string",
                  length: rawContent.length,
                  first500: rawContent.substring(0, 500),
                  last500: rawContent.substring(Math.max(0, rawContent.length - 500)),
                  codeBlockCount: (rawContent.match(/```/g) || []).length / 2,
                });
              } else if (Array.isArray(rawContent)) {
                const blocksInfo = rawContent.map((b: any, idx: number) => ({
                  index: idx,
                  type: b?.type,
                  hasText: typeof b?.text === "string",
                  textLength: typeof b?.text === "string" ? b.text.length : 0,
                  first300: typeof b?.text === "string" ? b.text.substring(0, 300) : null,
                  last300: typeof b?.text === "string" ? b.text.substring(Math.max(0, b.text.length - 300)) : null,
                  isEmptyText: typeof b?.text === "string" && b.text.trim().length === 0,
                  hasThinking: typeof b?.thinking === "string" && b.thinking.length > 0,
                  thinkingLength: typeof b?.thinking === "string" ? b.thinking.length : 0,
                }));
                this.logDebug("assistant-blocks-raw", {
                  sessionKey: key,
                  msgId: e.message.id,
                  contentType: "array",
                  blockCount: rawContent.length,
                  blocks: blocksInfo,
                  textBlocks: blocksInfo.filter((b: any) => b.type === "text").length,
                  emptyTextBlocks: blocksInfo.filter((b: any) => b.type === "text" && b.isEmptyText).length,
                  toolCallBlocks: blocksInfo.filter((b: any) => b.type === "toolCall").length,
                });
              }
            } catch (diagErr) {
              this.logDebug("assistant-blocks-raw-error", { error: String(diagErr) });
            }
            const mappedMessages = this.#mapMessage(e.message);
            const textContent = mappedMessages[0]?.content ?? "";
            const reasoningContent = mappedMessages[0]?.reasoning;
            // === Log del contenuto PARSED (dopo #mapMessage) per confrontare con raw ===
            this.logDebug("assistant-content-parsed", {
              sessionKey: key,
              msgId: e.message.id,
              parsedLength: textContent.length,
              first500: textContent.substring(0, 500),
              last500: textContent.substring(Math.max(0, textContent.length - 500)),
              parsedCodeBlockCount: (textContent.match(/```/g) || []).length / 2,
              parsedNewlines: (textContent.match(/\n/g) || []).length,
              deltaVsRaw: typeof e.message.content === "string"
                ? e.message.content.length - textContent.length
                : "n/a-array",
            });
            const doneAgentId = this.#resolveAgentId(key);
            let doneAgentName = '';
            if (doneAgentId && doneAgentId !== 'orchestrator') {
              try { const doneCfg = this.#readAgentConfig(doneAgentId); doneAgentName = doneCfg?.name || doneAgentId; } catch {}
            } else if (doneAgentId === 'orchestrator') {
              doneAgentName = 'Orchestrator';
            }
            // Get actual model + thinking from the Pi session (truth source)
            let actualModel = e.message.model || '';
            let actualThinking = '';
            try { if (!actualModel) actualModel = pi.model?.id || ''; } catch {}
            try { actualThinking = pi.thinkingLevel || ''; } catch {}
            // Persist agentName + thinkingLevel per message for reload
            if (doneAgentName) {
              try {
                const entry = this.#entries.get(key) as any;
                if (entry) {
                  if (!entry.messageAgents) entry.messageAgents = {};
                  if (!entry.messageThinking) entry.messageThinking = {};
                  const msgTs = typeof e.message?.timestamp === 'number' ? e.message.timestamp : Date.now();
                  const msgKey = e.message?.id || `ts-${msgTs}`;
                  entry.messageAgents[msgKey] = doneAgentName;
                  const piLevelForSave = (() => { try { return pi.thinkingLevel; } catch { return actualThinking; } })();
                  entry.messageThinking[msgKey] = piLevelForSave;
                  this.#save();
                }
              } catch {}
            }
            // FIX 084 (03 set): done via #getSessionWs, NON ws raw — i turni LH/recovery
            // passano un fakeWs (send: noop) → il done finiva nel vuoto (la pill del
            // frontend non riceveva mai la fine del turno). Per i turni normali
            // #getSessionWs è esattamente lo stesso ws registrato: zero differenze.
            this.#sendToWs(this.#getSessionWs(key), {
              type: "done",
              sessionKey: key,
              messageId: e.message.id,
              model: actualModel,
              provider: e.message.provider,
              agentName: doneAgentName || undefined,
              thinkingLevel: (() => {
                // Footer shows ACTUAL thinking level from Pi SDK (truth source)
                const piLevel = (() => { try { return pi.thinkingLevel; } catch { return ''; } })();
                return piLevel || actualThinking || '';
              })(),
              thinkingTranslated: (() => {
                // Il livello REALE inviato al provider (mappa + caps sondate)
                const piLevel = (() => { try { return pi.thinkingLevel; } catch { return ''; } })();
                return this.#translateThinkingForModel(piLevel || actualThinking, actualModel);
              })(),
              requestedThinkingLevel: requestedThinking,
              sentEffort: (() => { try { return (pi.model?.thinkingLevelMap || {})[requestedThinking ?? ""] ?? null; } catch { return null; } })(),
              reasoningActuallyUsed,
              reasoningLength,
              responseId: e.message.responseId,
              stopReason: e.message.stopReason,
              errorMessage: (e.message as any)?.errorMessage || undefined,
              text: textContent,
              reasoning: reasoningContent,
              usage: (e.message as any)?.usage ?? undefined,
            });
            // Persisti l'errore in chat (deve ricomparire al reload)
            if (e.message?.stopReason === "error" && (e.message as any)?.errorMessage) {
              this.#saveError(key, { timestamp: Date.now(), errorMessage: (e.message as any).errorMessage, model: actualModel, agentName: doneAgentName, thinkingLevel: actualThinking });
              // Re-prompt UNA volta DOPO i 3 tentativi dell'SDK (solo errori retryable: 503/overloaded).
              // L'SDK ritenta già 3 volte con backoff; qui, se ha fallito comunque, ri-promptiamo
              // la sessione una sola volta dopo 30s (il provider potrebbe essersi liberato).
              const errMsg = String((e.message as any).errorMessage);
              const retryable = /overloaded|503|429|rate.?limit|service.?unavailable|server.?error|temporarily|too many requests/i.test(errMsg);
              if (retryable && !this.#rePrompted.has(key) && !this.#stoppedSessions.has(key)) {
                this.#rePrompted.add(key);
                this.logDebug("auto-reprompt-scheduled", { sessionKey: key, error: errMsg.slice(0, 120) });
                // FIX (01 set): 2 secondi invece di 30. Il provider ha il tempo di
                // "respirare" ma l'utente vede il recovery partire SUBITO (la pill
                // Recovering appare immediatamente, l'autoprompt arriva entro 2s).
                setTimeout(() => {
                  if (this.#stoppedSessions.has(key)) return;
                  const fakeWs = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
                  this.send(fakeWs, { sessionKey: key, text: "The app was interrupted while processing. Please continue and complete your response.", _preserveWs: true });
                }, 2000);
              }
            }
            // Accumula input/output totali della sessione (persistiti)
            try {
              const mu: any = (e.message as any)?.usage;
              if (mu) {
                const prevU: any = this.#contextUsage.get(key) || {};
                const inD = mu.input ?? mu.input_tokens ?? 0;
                const outD = mu.output ?? mu.output_tokens ?? 0;
                if (inD > 0 || outD > 0) {
                  this.#contextUsage.set(key, { ...prevU, tokens: prevU.tokens ?? null, contextWindow: prevU.contextWindow ?? 0, percent: prevU.percent ?? null, input: (prevU.input || 0) + inD, output: (prevU.output || 0) + outD, model: prevU.model, ts: Date.now() } as any);
                  this.#saveContextUsage();
                }
              }
            } catch {}
            this.#captureSessionMeta(key);
            this.#emitContextUsage(ws, key, "ctx-post-done");
          }
          break;
        }
        case "tool_execution_start":
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "tool", detail: e.toolName });
          this.#sendToWs(ws, {
            type: "tool_call",
            sessionKey: key,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            toolArgs: e.args,
            ts: Date.now(),
          });
          ws.send(JSON.stringify({ type: "typing_broadcast", action: "tool_calling", sessionKey: key }));
          break;
        case "tool_execution_end": {
          ws.send(JSON.stringify({ type: "typing_stop_broadcast", sessionKey: key }));
          const r = e.result;
          let resultText = "";
          try {
            if (r?.content) {
              if (Array.isArray(r.content)) {
                resultText = r.content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("");
              } else if (typeof r.content === "string") {
                resultText = r.content;
              }
            }
          } catch {}
          // Errori: se il contenuto è vuoto, usa il messaggio d'errore dell'evento
          if (!resultText && e.isError) {
            try { resultText = String((e as any).error || (r as any)?.error || (r as any)?.message || 'Tool execution failed'); } catch { resultText = 'Tool execution failed'; }
          }
          this.logDebug("tool-result", {
            sessionKey: key,
            toolName: e.toolName,
            isError: !!e.isError,
            contentLength: resultText.length,
            contentPreview: resultText.slice(0, 200),
          });
          this.#sendToWs(ws, {
            type: "tool_result",
            sessionKey: key,
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            content: resultText,
            isError: !!e.isError,
            ts: Date.now(),
          });
          this.#emitContextUsage(ws, key, "ctx-post-tool");
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "running" });
          break;
        }
        case "agent_end":
          if (this.#compactingSessions.has(key)) break; // sopprimi fine agente durante compaction
          // Cancella il marker pending-turn SOLO se il turno è COMPLETATO davvero:
          // l'ultimo messaggio assistant ha stopReason === "stop" (risposta finale).
          // Se il turno è fallito (error), interrotto (aborted/toolUse) o non c'è
          // risposta, il marker RESTA → il recovery al boot ri-promptata.
          let turnCompleted = false;
          let completingUserText = "";
          let markerText = "";
          let lastStopReason = "";
          try {
            const msgs = (e as any)?.messages || [];
            // NB: e.messages può contenere l'INTERA sessione, non solo il turno
            // corrente. Il turno corrente è DOPO l'ULTIMO messaggio utente.
            let lastUserIdx = -1;
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i]?.role === "user") { lastUserIdx = i; break; }
            }
            // Cerca l'ultimo assistant DOPO l'ultimo user (il turno corrente)
            for (let i = msgs.length - 1; i > lastUserIdx; i--) {
              const m = msgs[i];
              if (m?.role === "assistant") {
                turnCompleted = m.stopReason === "stop" || m.stopReason === "length";
                lastStopReason = String(m.stopReason || "");
                break;
              }
            }
            // Testo del messaggio utente del turno che sta completando
            if (lastUserIdx >= 0) {
              const u = msgs[lastUserIdx];
              const uc = u?.content;
              if (typeof uc === "string") completingUserText = uc;
              else if (Array.isArray(uc)) completingUserText = uc.filter((b: any) => b?.type === "text").map((b: any) => b.text).join(" ");
            }
            // Testo del marker (se esiste)
            try {
              const mp = path.join(this.#piSessionDir(key), "pending-turn.json");
              if (fs.existsSync(mp)) {
                const mk = JSON.parse(fs.readFileSync(mp, "utf8"));
                markerText = String(mk.text || "");
              }
            } catch {}
            this.logDebug("agent-end-messages", { sessionKey: key, msgCount: msgs.length, lastUserIdx, turnCompleted, completingUserText: completingUserText.slice(0, 40), markerText: markerText.slice(0, 40) });
          } catch {}
          // Il marker appartiene a QUESTO turno solo se il testo coincide col
          // messaggio utente che sta completando. Altrimenti è di un messaggio
          // in coda (turno precedente che completa) → NON cancellare.
          const sameMessage = completingUserText.slice(0, 40) !== "" && completingUserText.slice(0, 40) === markerText.slice(0, 40);
          {
            const isExp = isExpertSidecar();
            // Cancella SOLO se: turno completato E il turno di QUESTO marker è partito
            // (se il marker appartiene a un messaggio ancora in coda, non cancellarlo).
            const markerTurnStarted = this.#markerTurnStarted.has(key);
            // === Recovery MID-SESSION basato su EVENTO (nessun timer):
            // agent_end è arrivato ma il turno NON è completato (stopReason error/aborted/
            // altro) → il turno è finito SENZA la risposta completa → il marker è ancora
            // lì → autoprompt SUBITO per farlo continuare. Escluso toolUse (il loop
            // dell'agente continua da solo) e stopped (l'utente ha fermato). ===
            // FIX #9 (02 set): NON chiamare il mid-session recovery se l'auto-reprompt
            // per errori provider è GIÀ programmato (2s): prima i DUE sparavano insieme
            // → doppio autoprompt a ~2s di distanza (2 msg-in nei log dell'utente).
            // FEATURE [FALLBACK401] — modello non disponibile per auth/crediti.
            const authFlag = (() => {
              try {
                const _dir = this.#piSessionDir(key);
                const _files = fs.readdirSync(_dir).filter((f: string) => f.endsWith(".jsonl"));
                if (_files.length === 0) return false;
                const _lines = fs.readFileSync(path.join(_dir, _files[0]), "utf8").trim().split("\n").filter(Boolean);
                const _last = _lines[_lines.length - 1] ? JSON.parse(_lines[_lines.length - 1]) : null;
                return /401|402|403|insufficient|credit|quota|not.?found|not.?available|model.?not|unauthorized|authentication|timeout|timed.?out|econnrefused|fetch.?failed|network|enotfound|dns|connection|refused|unreachable|socket|502|503|504|service.?unavailable/i.test(String(_last?.message?.errorMessage || _last?.message?.error || ""));
              } catch { return false; }
            })();
            let fallbackSwitched = false;
            const _fbTried0 = this.#fallbackTried.get(key) || [];
            if (!turnCompleted && lastStopReason === "error" && authFlag && !this.#stoppedSessions.has(key) && _fbTried0.length < 8) {
              try {
                const _tried = this.#fallbackTried.get(key) || [];
                const _flist = ((this.#entries.get(key) as any)?.fallbackModels || []) as string[];
                const _cur = (this.#entries.get(key))?.model || actualModel;
                // FIX (07 set) FALLBACK TOTALE: se il modello in uso NON è il default, il PRIMO
                // fallback è il modello DEFAULT, poi gli altri in ordine. Mai ripetere un provato.
                let _defaultModel: string | null = null;
                try { const _st = JSON.parse(fs.readFileSync(path.join(this.#agentDir, "settings.json"), "utf8")); _defaultModel = _st?.defaultModel || null; } catch {}
                let _cands = _flist.filter((m: string) => m !== _cur && !_tried.includes(m));
                if (_defaultModel && _cur !== _defaultModel && !_tried.includes(_defaultModel)) {
                  _cands = [_defaultModel, ..._cands.filter((m: string) => m !== _defaultModel)];
                }
                const _next = _cands[0];
                if (_next) {
                  _tried.push(_next);
                  this.#fallbackTried.set(key, _tried);
                  // no-drift: ricorda il modello ORIGINALE (si ripristina a fine turno)
                  // FIX loop: l'ORIGINALE (già fallito) entra nei tried al primo hop — mai ri-provato
                  if (!this.#fallbackOriginalModel.has(key)) {
                    this.#fallbackOriginalModel.set(key, _cur);
                    if (!_tried.includes(_cur)) { _tried.push(_cur); this.#fallbackTried.set(key, _tried); }
                  }
                  const _ok = await this.setModel(key, _next);
                  if (_ok) {
                    fallbackSwitched = true;
                    this.logDebug("fallback-401-triggered", { sessionKey: key, from: _cur, to: _next });
                    try { this.#sendToWs(this.#getSessionWs(key), { type: "fallback_notice", sessionKey: key, from: _cur, to: _next, ts: Date.now() }); } catch {}
                    // Riproduci l'ULTIMA domanda utente (dal jsonl) cosi' il fallback risponde
                    // alla richiesta originale, non a un messaggio di spiegazione.
                    let lastUserText = "";
                    try {
                      const _dir2 = this.#piSessionDir(key);
                      const _files2 = fs.readdirSync(_dir2).filter((f: string) => f.endsWith(".jsonl"));
                      if (_files2.length > 0) {
                        const _ls2 = fs.readFileSync(path.join(_dir2, _files2[0]), "utf8").trim().split("\n").filter(Boolean);
                        for (let _i = _ls2.length - 1; _i >= 0; _i--) {
                          try {
                            const _en = JSON.parse(_ls2[_i]);
                            if (_en?.message?.role === "user" && _en?.message?.content) {
                              lastUserText = typeof _en.message.content === "string" ? _en.message.content : String(_en.message.content?.[0]?.text || "");
                              break;
                            }
                          } catch {}
                        }
                      }
                    } catch {}
                    if (!lastUserText) lastUserText = "Please continue.";
                    // FIX 2026-09-08 (P1 #3): connection-refused/timeout lasciano la catena interna
                    // del Pi SDK rotta ANCHE se isStreaming=false (il ghost-check in send() non
                    // scatta perché il flag non è attivo, ma la promise chain dell'SDK è morta).
                    // Hard-reset SEMPRE nel re-send del fallback: dispose + sessione pulita.
                    try {
                      const _piOld = this.#active.get(key);
                      if (_piOld) {
                        this.logDebug("fallback-resend-hard-reset", { sessionKey: key, note: "dispose sessione prima del re-send (catena SDK può essere rotta dopo connection-refused)" });
                        const _un = this.#unsubs.get(key); if (_un) { try { _un(); } catch {} }
                        this.#unsubs.delete(key);
                        try { (_piOld as any).dispose?.(); } catch {}
                        this.#active.delete(key);
                      }
                      this.#prompts.delete(key);
                      this.#promptsAt.delete(key);
                    } catch {}
                    const _fw = { readyState: 1, constructor: { OPEN: 1 }, send: () => {} };
                    await this.send(_fw, { sessionKey: key, text: lastUserText, _preserveWs: true, __fallbackRetry: true }).catch(() => {});
                  } else {
                    this.logDebug("fallback-401-model-invalid", { sessionKey: key, to: _next });
                  }
                } else {
                  this.logDebug("fallback-401-exhausted", { sessionKeySet: key, list: _flist });
                  // esauriti: ripristina il modello originale (no-drift). I tried NON si azzerano
                  // (sopravvivono al recovery-reprompt) e la guardia #rePrompted BLOCCA il re-prompt
                  // del recovery su questo turno: MAI loop infinito quando tutto è morto.
                  const _origEx = this.#fallbackOriginalModel.get(key);
                  if (_origEx) { this.#fallbackOriginalModel.delete(key); try { await this.setModel(key, _origEx); this.logDebug("fallback-restore-original", { sessionKey: key, where: "exhausted", back: _origEx }); } catch {} }
                  this.#rePrompted.add(key);
                  this.logDebug("fallback-exhausted-no-reprompt", { sessionKey: key, tried: this.#fallbackTried.get(key) });
                }
              } catch (e2: any) { this.logDebug("fallback-401-error", { sessionKey: key, error: String(e2?.message || e2) }); }
            }
if (!turnCompleted && lastStopReason && lastStopReason !== "toolUse" && !this.#stoppedSessions.has(key) && !this.#rePrompted.has(key) && !fallbackSwitched) {
              this.logDebug("agent-end-not-complete", { sessionKey: key, stopReason: lastStopReason, isExpert: isExpertSidecar() });
              this.#recoverInterruptedTurn(key).catch(() => {});
            }
            // Fallback attivo: NON far ripartire il recovery mid-session (il re-prompt e' gia' partito).
            if (fallbackSwitched) { this.logDebug("fallback-401-switched-skip-mid", { sessionKey: key }); }
            // FIX #13 (02 set): un turno COMPLETO rende stantio QUALSIASI marker pending
            // (anche di un turno precedente). Prima il guard `sameMessage` lasciava vivi
            // i marker vecchi → il driver li vedeva → autoprompt per messaggi GIÀ RISPOSTI
            // (gli "autoprompt insensati" dopo turni regolari — riprodotto 5 volte live).
            if (turnCompleted) {
              // FIX (07 set) FALLBACK TOTALE no-drift: a fine turno il modello di sessione
              // torna quello ORIGINALE (mai drift permanente sui fallback provati)
              const _origModel = this.#fallbackOriginalModel.get(key);
              if (_origModel) {
                this.#fallbackOriginalModel.delete(key);
                this.#fallbackTried.delete(key);
                try { await this.setModel(key, _origModel); this.logDebug("fallback-restore-original", { sessionKey: key, where: "turnCompleted", back: _origModel }); } catch (e3: any) { this.logDebug("fallback-restore-error", { sessionKey: key, error: String(e3?.message || e3) }); }
              }
              if (!(key === "__app_expert__" && !isExp)) {
                try { const p = path.join(this.#piSessionDir(key), "pending-turn.json"); if (fs.existsSync(p)) { fs.unlinkSync(p); this.logDebug("marker-delete", { sessionKey: key, where: "agent_end", isExpert: isExp, turnCompleted, markerTurnStarted }); } } catch {}
              } else {
                this.logDebug("marker-delete-guarded", { sessionKey: key, where: "agent_end", isExpert: isExp });
              }
            } else {
              this.logDebug("marker-keep-turn-not-complete", { sessionKey: key, where: "agent_end", isExpert: isExp, turnCompleted, markerTurnStarted, sameMessage });
            }
          }
          // === A3: notifica chat — quando un turno completa (risposta arrivata) ===
          if (turnCompleted) {
            try {
              // Body = anteprima dell'ULTIMO WRITING (testo finale, niente thinking/tool)
              let respText = "";
              try {
                const msgs = (e as any).messages || [];
                for (let i = msgs.length - 1; i >= 0; i--) {
                  const m = msgs[i];
                  if (m?.role === "assistant" && m.content) {
                    if (typeof m.content === "string") { respText = m.content; break; }
                    if (Array.isArray(m.content)) {
                      for (let j = m.content.length - 1; j >= 0; j--) {
                        const b = m.content[j];
                        if (b?.type === "text" && b.text) { respText = b.text; break; }
                      }
                      if (respText) break;
                    }
                  }
                }
              } catch {}
              this.appendNotification({ kind: "chat_message", sessionKey: key, title: "New response", body: respText.slice(0, 100) || "A response arrived" });
            } catch {}
          }
          ws.send(JSON.stringify({ type: "typing_stop_broadcast", sessionKey: key }));
          this.#captureSessionMeta(key);
          this.#emitContextUsage(ws, key, "ctx-post-agent-end");
          try { this.logDebug("heap-stats-agent-end", this.getHeapStats()); } catch {}
          forceGC();
          this.logDebug("agent-end", {
            sessionKey: key,
            finalModel: this.#active.get(key)?.model?.id,
            finalThinking: this.#active.get(key)?.thinkingLevel,
          });
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "idle" });
          // === A5: streaming stopped event ===
          this.#sendToWs(ws, { type: "streaming_stopped", sessionKey: key, stopReason: (e as any)?.stopReason || "unknown" });
          // === Multi-window: pulisci streaming buffer ===
          this.#streamingBuffers.delete(key);
          // === CONFIG REFRESH DIFFERITO (29 ago): se un cambio di config agente è
          // arrivato mentre il turno girava, ORA è il momento sicuro: scarta la
          // sessione → il prossimo invio la ricrea coi tool nuovi.
          try {
            if (this.#needsConfigRefresh.has(key)) {
              this.#needsConfigRefresh.delete(key);
              // === PRESERVA LA MODE prima del dispose (stesso fix di #safeRecreateSession):
              // mode.json AUTHORITATIVO → il recreate non può defaultare a "plan".
              try { this.#writeSessionPrefs(key); } catch {}
              const piEnd = this.#active.get(key);
              try { const un = this.#unsubs.get(key); if (un) { try { un(); } catch {} } this.#unsubs.delete(key); } catch {}
              try { (piEnd as any)?.dispose?.(); } catch {}
              this.#active.delete(key);
              this.#mcpSig.delete(key);
              this.logDebug("config-refresh-at-turn-end", { sessionKey: key });
            }
          } catch {}
          // B0.5: il turno è finito → tocca la sessione e sweep LRU (libera le parcheggiate)
          this.#touchSession(key);
          this.#sweepInactive();
          break;
        case "thinking_level_changed":
          this.#captureSessionMeta(key);
          ws.send(JSON.stringify({ type: "thinking_updated", level: e.level, sessionKey: key }));
          break;
        case "auto_retry_start":
          this.#sendToWs(ws, {
            type: "agent_status",
            sessionKey: key,
            status: "retrying",
            attempt: e.attempt,
            maxAttempts: e.maxAttempts,
            delayMs: e.delayMs,
            errorMessage: e.errorMessage,
          });
          break;
        case "auto_retry_end":
          if (e.success) {
            this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "running" });
          } else {
            this.#sendToWs(ws, {
              type: "agent_status",
              sessionKey: key,
              status: "failed",
              attempt: e.attempt,
              errorMessage: e.finalError,
            });
          }
          break;
        case "compaction_start":
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "compacting" });
          // === C: inoltra evento compaction_status al renderer ===
          this.#sendToWs(ws, {
            type: "compaction_status",
            sessionKey: key,
            status: "start",
            reason: e.reason,
          });
          break;
        case "compaction_end": {
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "running" });
          // === C: inoltra evento compaction_status con summary al renderer ===
          const result = e.result;
          const summary = result?.summary || "";
          const firstKeptEntryId = result?.firstKeptEntryId;

          // === Noop detection: controlla se la compaction ha ridotto davvero ===
          const prevFirstKept = this.#prevCompactionFirstKept.get(key);
          let isNoop = false;
          // Check 1: stesso firstKeptEntryId della compaction precedente
          if (prevFirstKept && firstKeptEntryId && prevFirstKept === firstKeptEntryId) {
            isNoop = true;
          }
          // Check 2: firstKeptEntryId è il primo messaggio (niente da riassumere)
          if (!isNoop) {
            try {
              const sm = (this.#active.get(key) as any)?.sessionManager;
              const ents = sm?.getEntries?.() || [];
              const firstMsg = ents.find((e: any) => e?.type === "message");
              if (firstMsg && firstKeptEntryId === firstMsg.id) isNoop = true;
            } catch {}
          }
          // Check 3: messaggi appena ridotti
          if (!isNoop) {
            try {
              const pi = this.#active.get(key);
              const msgsAfter = (pi?.agent?.state?.messages || []).length;
              // Se dopo la compaction ci sono ancora tantissimi messaggi e il summary è corto → probabilmente noop
              const ents = (() => { try { return (pi as any)?.sessionManager?.getEntries?.() || []; } catch { return []; } })();
              const msgEntries = ents.filter((e: any) => e?.type === "message").length;
              if (msgEntries > 0 && msgsAfter >= msgEntries * 0.9) isNoop = true;
            } catch {}
          }

          if (isNoop) {
            this.logDebug("compaction-noop-detected", { sessionKey: key, firstKeptEntryId });
            // Invia noop con messaggio di errore invece del summary
            this.#sendToWs(ws, {
              type: "compaction_status",
              sessionKey: key,
              status: "noop",
              message: "La conversazione è troppo corta o i messaggi sono troppo grandi per essere compattati.",
            });
          } else {
            // Compazione normale: aggiorna prevFirstKept e invia end con summary
            this.#prevCompactionFirstKept.set(key, firstKeptEntryId);
            this.#sendToWs(ws, {
              type: "compaction_status",
              sessionKey: key,
              status: "end",
              summary,
              tokensBefore: result?.tokensBefore,
              firstKeptEntryId,
            });
          }

          // Emetti nuovo context usage (Pi SDK ricalcolerà al primo assistant post-compaction)
          this.#emitContextUsage(ws, key, "ctx-post-compaction");
          // === Step 2: log diagnostico compatto per capire perché la stima tokens non si riduce ===
          try {
            const pi = this.#active.get(key);
            const model = pi?.model;
            const ctxWindow = model?.contextWindow ?? 0;
            const u = pi?.getContextUsage?.();
            const messages = (pi?.agent?.state?.messages || []) as any[];
            const messagesCount = messages.length;
            const totalChars = messages.reduce((acc: number, m: any) => {
              if (typeof m.content === "string") return acc + m.content.length;
              if (Array.isArray(m.content)) {
                return acc + m.content.reduce((a: number, b: any) => a + (b?.text?.length || 0), 0);
              }
              return acc;
            }, 0);
            this.logDebug("compaction-diagnostic", {
              sessionKey: key,
              tokensBefore: result?.tokensBefore,
              tokensAfter: u?.tokens,
              percentAfter: u?.percent,
              ctxWindow,
              messagesCountAfter: messagesCount,
              totalCharsAfter: totalChars,
              summaryLength: summary.length,
              firstKeptEntryId: result?.firstKeptEntryId,
              compactionSucceeded: typeof result?.tokensBefore === "number",
              note: "Se messagesCountAfter è ancora alto (= numero totale di messaggi), la compaction non ha ridotto davvero il context",
            });
          } catch (e: any) {
            this.logDebug("compaction-diagnostic-error", { sessionKey: key, error: e?.message });
          }
          break;
        }
        case "queue_update":
          this.#sendToWs(ws, {
            type: "queue_update",
            sessionKey: key,
            steering: e.steering?.length || 0,
            followUp: e.followUp?.length || 0,
          });
          break;
      }
    });
    this.#unsubs.set(key, sub);
  }

  // === A3: Notifiche — read-state per chat + log notifiche ===
  setNotificationBroadcast(fn: (entry: any) => void) { this.#notifBroadcast = fn; }
  setReadStateBroadcast(fn: (key: string) => void) { this.#readStateBroadcast = fn; }

  #readStateFile() { return path.join(this.#agentDir, "read-state.json"); }
  #notificationsFile() { return path.join(this.#agentDir, "notifications.jsonl"); }

  #loadReadState() {
    try {
      if (fs.existsSync(this.#readStateFile())) {
        const data = JSON.parse(fs.readFileSync(this.#readStateFile(), "utf8") || "{}");
        for (const [k, v] of Object.entries(data)) this.#readState.set(k, v as any);
      }
    } catch {}
    try {
      if (fs.existsSync(this.#notificationsFile())) {
        const lines = fs.readFileSync(this.#notificationsFile(), "utf8").trim().split("\n").filter((l: string) => l.trim());
        this.#notifications = lines.slice(-500).map((l: string) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      }
    } catch {}
  }

  #saveReadState() {
    try {
      // MERGE con il file esistente: main (9182) e Expert (9183) condividono lo STESSO
      // read-state.json. Senza merge, il sidecar con lo stato più vecchio in memoria
      // sovrascrive i valori più recenti dell'altro → i badge ricompaiono dopo la reinstall.
      const obj: any = {};
      try {
        if (fs.existsSync(this.#readStateFile())) {
          const data = JSON.parse(fs.readFileSync(this.#readStateFile(), "utf8") || "{}");
          for (const [k, v] of Object.entries(data)) obj[k] = { ...(v as any) };
        }
      } catch {}
      for (const [k, v] of this.#readState) {
        const cur = obj[k] || {};
        const lastReadTs = Math.max(typeof cur.lastReadTs === "number" ? cur.lastReadTs : 0, v.lastReadTs || 0);
        const lastReadTaskTs = Math.max(typeof cur.lastReadTaskTs === "number" ? cur.lastReadTaskTs : 0, v.lastReadTaskTs || 0);
        // notifyMode: vince quello col timestamp PIÙ RECENTE (merge-safe tra main ed Expert —
        // senza, il sidecar con lo stato stantio sovrascriveva la modalità appena cambiata).
        const vTs = v.notifyModeTs || 0;
        const cTs = cur.notifyModeTs || 0;
        const notifyMode = vTs >= cTs ? (v.notifyMode || cur.notifyMode || "none") : (cur.notifyMode || v.notifyMode || "none");
        const notifyModeTs = Math.max(vTs, cTs);
        obj[k] = { lastReadTs, lastReadTaskTs, notifyMode, notifyModeTs };
      }
      const tmp = this.#readStateFile() + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
      fs.renameSync(tmp, this.#readStateFile());
    } catch {}
  }

  // Ricarica il file (l'altro sidecar potrebbe aver aggiornato lo stato condiviso).
  // Prende il max lastReadTs per chat → i badge restano sincronizzati tra le due app.
  #syncReadStateFromFile() {
    try {
      if (!fs.existsSync(this.#readStateFile())) return;
      const data = JSON.parse(fs.readFileSync(this.#readStateFile(), "utf8") || "{}");
      for (const [k, v] of Object.entries(data)) {
        const cur = this.#readState.get(k);
        const lastReadTs = Math.max(cur?.lastReadTs || 0, (v as any)?.lastReadTs || 0);
        const lastReadTaskTs = Math.max(cur?.lastReadTaskTs || 0, (v as any)?.lastReadTaskTs || 0);
        const vTs = (v as any)?.notifyModeTs || 0;
        const cTs = cur?.notifyModeTs || 0;
        const notifyMode = cTs >= vTs ? (cur?.notifyMode || (v as any)?.notifyMode || "none") : ((v as any)?.notifyMode || cur?.notifyMode || "none");
        const notifyModeTs = Math.max(cTs, vTs);
        this.#readState.set(k, { lastReadTs, lastReadTaskTs, notifyMode, notifyModeTs });
      }
    } catch {}
  }

  startReadStateSync() {
    this.#syncReadStateFromFile();
    setInterval(() => { this.#syncReadStateFromFile(); }, 10000);
  }

  getReadState(key: string) {
    const s = this.#readState.get(key) || { lastReadTs: 0, lastReadTaskTs: 0, notifyMode: "none", notifyModeTs: 0 };
    return { ...s };
  }

  setReadState(key: string, patch: any) {
    const cur = this.#readState.get(key) || { lastReadTs: 0, lastReadTaskTs: 0, notifyMode: "none" };
    if (typeof patch.lastReadTs === "number") cur.lastReadTs = patch.lastReadTs;
    if (typeof patch.lastReadTaskTs === "number") cur.lastReadTaskTs = patch.lastReadTaskTs;
    if (typeof patch.notifyMode === "string") { cur.notifyMode = patch.notifyMode; cur.notifyModeTs = Date.now(); }
    this.#readState.set(key, cur);
    this.#saveReadState();
    try { this.#readStateBroadcast?.(key); } catch {}
    return { ...cur };
  }

  getDefaultNotifyMode(): string {
    try { return String(readSettings().defaultNotifyMode || "none"); } catch { return "none"; }
  }

  setDefaultNotifyMode(mode: string) {
    try {
      const s = readSettings();
      s.defaultNotifyMode = mode;
      writeSettings(s);
    } catch {}
    return mode;
  }

  setNotifyMode(key: string, mode: string) {
    // A3 semplificato: solo "none" (muted) o "all" (non muted). Legacy mappati a "all".
    if (mode === "messages-only" || mode === "tasks-only") mode = "all";
    this.logDebug("a3-set-notify-mode", { sessionKey: key, mode });
    const cur = this.#readState.get(key) || { lastReadTs: 0, lastReadTaskTs: 0, notifyMode: "none", notifyModeTs: 0 };
    cur.notifyMode = mode;
    cur.notifyModeTs = Date.now();
    this.#readState.set(key, cur);
    this.#saveReadState();
    try { this.#readStateBroadcast?.(key); } catch {}
    return { ...cur };
  }

  // === Unread counts: messaggi assistant dopo lastReadTs + task completate dopo lastReadTaskTs ===
  getUnreadCounts(): { [key: string]: { messages: number; tasks: number } } {
    // FIX (31 ago): sync dal file PRIMA di contare — il recovery può girare su un
    // pool worker e aggiornare read-state.json; senza sync, questo processo conta
    // con una copia STALE → doppio badge.
    try { this.#syncReadStateFromFile(); } catch {}
    const out: { [key: string]: { messages: number; tasks: number } } = {};
    const base = path.join(this.#agentDir, "sessions", "quinki");
    try {
      if (!fs.existsSync(base)) return out;
      for (const sk of fs.readdirSync(base)) {
        if (sk.startsWith("__exec_")) continue; // sessioni headless dei task — non sono chat
        const st = this.#readState.get(sk);
        if (!st) continue;
        const dir = path.join(base, sk);
        let messages = 0;
        try {
          const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
          if (files.length > 0) {
            const lines = fs.readFileSync(path.join(dir, files[0]), "utf8").split("\n");
            // FIX (31 ago): conta TURNI, non singoli messaggi. Un turno con 2 messaggi
            // assistant (thinking + risposta, continuazione + finale) contava come 2
            // badge per UNA risposta percepita dall'utente. Ora: gruppi consecutivi di
            // assistant messages = 1 turno = 1 badge.
            let inGroup = false;
            let groupHasUnread = false;
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const d = JSON.parse(line);
                const m = d?.message;
                if (d?.type === "message" && m?.role === "user") {
                  if (inGroup && groupHasUnread) messages++;
                  inGroup = false; groupHasUnread = false;
                } else if (d?.type === "message" && m?.role === "assistant" && typeof m.timestamp === "number") {
                  inGroup = true;
                  const hasText = Array.isArray(m.content) ? m.content.some((b: any) => b?.type === "text" && b.text) : (typeof m.content === "string" && m.content.trim());
                  if (hasText && m.timestamp > st.lastReadTs) groupHasUnread = true;
                }
              } catch {}
            }
            if (inGroup && groupHasUnread) messages++;
          }
        } catch {}
        let tasks = 0;
        try {
          const execBase = path.join(this.#agentDir, "executions");
          if (fs.existsSync(execBase)) {
            for (const exId of fs.readdirSync(execBase)) {
              try {
                const st2 = JSON.parse(fs.readFileSync(path.join(execBase, exId, "execution.json"), "utf8"));
                // Le task contano come MESSAGGI: unread se endedAt > lastReadTs (stessa logica dei messaggi)
                if (st2?.sourceSession?.key === sk && st2?.status === "executed" && typeof st2.endedAt === "number" && st2.endedAt > st.lastReadTs) tasks++;
              } catch {}
            }
          }
        } catch {}
        if (messages > 0 || tasks > 0) out[sk] = { messages, tasks };
      }
    } catch {}
    return out;
  }

  // === A3: tutti gli stati di lettura (per caricare notifyModes all'avvio) ===
  getAllReadStates(): { [key: string]: { lastReadTs: number; lastReadTaskTs: number; notifyMode: string } } {
    const out: any = {};
    for (const [k, v] of this.#readState) out[k] = { ...v };
    return out;
  }

  // === Notifications log (per la campanella Agents Tasks) ===
  listNotifications() { return this.#notifications.slice().reverse(); }

  markAllNotificationsRead() {
    const now = Date.now();
    for (const [k, v] of this.#readState) v.lastReadTaskTs = now;
    this.#saveReadState();
    return { ok: true };
  }

  appendNotification(entry: any) {
    this.logDebug("a3-notification-appended", { kind: entry.kind, sessionKey: entry.sessionKey, src: entry.sourceSession?.key });
    const e = { id: `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, read: false, ...entry, ts: entry.ts || Date.now() };
    this.#notifications.push(e);
    if (this.#notifications.length > 500) this.#notifications = this.#notifications.slice(-500);
    try { fs.appendFileSync(this.#notificationsFile(), JSON.stringify(e) + "\n", "utf8"); } catch {}
    // Cap anche il FILE: se supera 2MB lo riscrive con le sole ultime 500 (mai crescere senza limite)
    try {
      const nf = this.#notificationsFile();
      if (fs.existsSync(nf) && fs.statSync(nf).size > 2 * 1024 * 1024) {
        fs.writeFileSync(nf, this.#notifications.map((x: any) => JSON.stringify(x)).join("\n") + "\n", "utf8");
      }
    } catch {}
    try { this.#notifBroadcast?.(e); } catch {}
    return e;
  }
}

export { PiBridge, SessionEntry };

// === Singleton accessor: permette a funzioni exported (es. setProvidersConfig) di chiamare
// metodi sull'istanza PiBridge attiva, evitando dipendenza circolare con server.ts ===
let piBridgeInstance: PiBridge | null = null;
export function setPiBridgeInstance(instance: PiBridge | null): void {
  piBridgeInstance = instance;
}
export function getPiBridgeInstance(): PiBridge | null {
  return piBridgeInstance;
}
function logDebugStatic(tag: string, data: any): void {
  // Best-effort logging when instance is not yet available
  try {
    piBridgeInstance?.logDebug(tag, data);
  } catch {
    // ignore
  }
}

// ─── Settings persistence (per-user, per-device sync-ready) ─────────────────

const DEFAULT_SETTINGS = {
  interfaceFont: "IBM Plex Sans",
  codeFont: "IBM Plex Mono",
  interfaceFontSize: 100,
  codeFontSize: 13,
  spacingDensity: 100,
  inputBarOffset: 0,
  statusPillPosition: "inline" as "inline" | "header",
  defaultModel: "",
  defaultThinkingLevel: "medium",
  defaultFallbackModels: [] as string[],
  // === Fix D3: global compaction settings persistiti ===
  globalCompactionAuto: true,
  globalCompactionThreshold: 80,
  // Tema default: "Vision Comfort (Neutral Black)" — palette neutra (IBM Carbon-inspired)
  // I 3 colori strutturali della UI. Gli accent (azzurro, rosso, ecc.) NON cambiano con il tema.
  theme: {
    bg: "#121212",                // sfondo principale (Neutral Black)
    bgPanel: "#1F1F1F",           // floating panel (sidebar, navbar, header, composer, menu, quadrati impostazioni)
    bgBubbleUser: "#383838",      // sfondo bubble user
    bubbleUserText: "#EAEAEA",    // testo bubble user
  },
};

function pickDefaultModel(): string {
  // Read from providers config (where the UI saves), not quinki-settings.json
  try {
    const cfg = readProvidersConfig();
    if (cfg.defaultModel && cfg.defaultModel.length > 0) return cfg.defaultModel;
  } catch {}
  try {
    const first = getFirstAvailableModelId();
    if (first) return first;
  } catch {}
  return "";
}

function pickDefaultThinkingLevel(): string {
  // Read from providers config (where the UI saves), not quinki-settings.json
  try {
    const cfg = readProvidersConfig();
    if (cfg.defaultThinking && cfg.defaultThinking.length > 0) return cfg.defaultThinking;
  } catch {}
  // [v0.0.62] Default per modelli reasoning: true è "xhigh" (massimo), altrimenti "off"
  return pickDefaultModelHasReasoning() ? "xhigh" : "off";
}

function pickDefaultModelHasReasoning(): boolean {
  try {
    const modelsPath = path.join(_agentDir, "models.json");
    if (!fs.existsSync(modelsPath)) return false;
    const data = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
    const dm = pickDefaultModel();
    if (dm) {
      for (const pdata of Object.values(data.providers || {})) {
        const models = (pdata as any).models || [];
        const m = models.find((mm: any) => mm.id === dm);
        if (m) return m.reasoning === true;
      }
    }
    // Se nessun modello di default, controlla se QUALSIASI modello ha reasoning
    for (const pdata of Object.values(data.providers || {})) {
      const models = (pdata as any).models || [];
      if (models.some((mm: any) => mm.reasoning === true)) return true;
    }
  } catch {}
  return false;
}

function pickDefaultThinkingLevelForModel(modelId: string): string {
  try {
    const modelsPath = path.join(_agentDir, "models.json");
    if (fs.existsSync(modelsPath)) {
      const data = JSON.parse(fs.readFileSync(modelsPath, "utf8"));
      for (const pdata of Object.values(data.providers || {})) {
        const models = (pdata as any).models || [];
        const m = models.find((mm: any) => mm.id === modelId);
        if (m) return m.reasoning === true ? "xhigh" : "off";
      }
    }
  } catch {}
  return "xhigh";
}

function readSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function writeSettings(settings: any) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
  } catch (e) {
    process.stderr.write(`[settings] write failed: ${(e as Error).message}`);
  }
}

export function getSettings() {
  const s = readSettings();
  return {
    ...s,
    defaultFallbackModels: (readSettings().defaultFallbackModels || []),
    defaultModel: pickDefaultModel(),
    defaultThinkingLevel: pickDefaultThinkingLevel(),
    theme: { ...DEFAULT_SETTINGS.theme, ...(s.theme || {}) },
  };
}

export function getDefaultModel(): string {
  return pickDefaultModel();
}

export function getDefaultThinkingLevel(): string {
  return pickDefaultThinkingLevel();
}

export function getFolders(): any[] {
  try {
    if (!fs.existsSync(FOLDERS_FILE)) return [];
    const raw = fs.readFileSync(FOLDERS_FILE, "utf8");
    const json = JSON.parse(raw);
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.folders)) return json.folders;
    return [];
  } catch (e) {
    process.stderr.write(`[pi-bridge] getFolders error: ${e}`);
    return [];
  }
}

export function setFolders(folders: any[]): { success: boolean; error?: string } {
  try {
    const toWrite = { folders: Array.isArray(folders) ? folders : [] };
    fs.mkdirSync(path.dirname(FOLDERS_FILE), { recursive: true });
    fs.writeFileSync(FOLDERS_FILE, JSON.stringify(toWrite, null, 2), "utf8");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

export function moveSessionIPC(sessionKey: string, folderId: string | null, order: number): { success: boolean; error?: string } {
  try {
    const arr = getSessionsFromFile();
    const session = arr.find((s: any) => s.key === sessionKey);
    if (!session) return { success: false, error: "session not found" };
    session.folderId = folderId;
    session.order = order;
    fs.writeFileSync(SESSION_FILE, JSON.stringify(arr, null, 2), "utf8");
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

export function deleteSessionsByFolderIdIPC(folderId: string): { success: boolean; deletedCount: number; error?: string } {
  try {
    const arr = getSessionsFromFile();
    const before = arr.length;
    const next = arr.filter((s: any) => (s.folderId ?? null) !== folderId);
    const deletedCount = before - next.length;
    fs.writeFileSync(SESSION_FILE, JSON.stringify(next, null, 2), "utf8");
    // B0.2 (S4): dispose le sessioni in RAM + elimina le dir (niente leak)
    try {
      const pb = getPiBridgeInstance();
      if (pb && deletedCount > 0) {
        for (const k of keys) { try { (pb as any).removeDispose?.(k); } catch {} }
      }
    } catch {}
    return { success: true, deletedCount };
  } catch (e: any) {
    return { success: false, deletedCount: 0, error: e.message || String(e) };
  }
}

export function deleteSessionsByKeysIPC(keys: string[]): { success: boolean; deletedCount: number; error?: string } {
  try {
    const arr = getSessionsFromFile();
    const keySet = new Set(keys);
    const before = arr.length;
    const next = arr.filter((s: any) => !keySet.has(s.key));
    const deletedCount = before - next.length;
    fs.writeFileSync(SESSION_FILE, JSON.stringify(next, null, 2), "utf8");
    return { success: true, deletedCount };
  } catch (e: any) {
    return { success: false, deletedCount: 0, error: e.message || String(e) };
  }
}

// === TOMBSTONE sessioni eliminate (bug "ricompaiono nella sidebar") ===
// Quando una sessione viene eliminata, scriviamo qui il suo key in modo persistente.
// TUTTI i processi/letture (getSessionsFromFile, #load, getSessions, orphan adoption, #save)
// lo rispettano → nessun altro sidecar può ri-aggiungerla nel file condiviso.
const DELETED_SESSIONS_FILE = path.join(_agentDir, "quinki-deleted-sessions.json");
let __deletedSessions: Set<string> | null = null;
function deletedSessionsSet(): Set<string> {
  if (__deletedSessions) return __deletedSessions;
  __deletedSessions = new Set();
  try {
    if (fs.existsSync(DELETED_SESSIONS_FILE)) {
      const arr = JSON.parse(fs.readFileSync(DELETED_SESSIONS_FILE, "utf8"));
      if (Array.isArray(arr)) for (const k of arr) if (typeof k === "string") __deletedSessions.add(k);
    }
  } catch {}
  return __deletedSessions;
}
export function markSessionDeleted(key: string) {
  const s = deletedSessionsSet();
  s.add(key);
  try {
    fs.writeFileSync(DELETED_SESSIONS_FILE, JSON.stringify([...s], null, 2), "utf8");
  } catch {}
}
export function isSessionDeleted(key: string): boolean {
  return deletedSessionsSet().has(key);
}

export function getSessionsFromFile(): any[] {
  try {
    if (!fs.existsSync(SESSION_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    // Il file è scritto come array bare da #save (riga 321). Gestisco entrambi i formati.
    let arr: any[] = [];
    if (Array.isArray(data)) arr = data;
    else if (data && Array.isArray(data.sessions)) arr = data.sessions;
    else return [];
    // TOMBSTONE: filtra le sessioni eliminate definitivamente
    const del = deletedSessionsSet();
    if (del.size > 0) arr = arr.filter((s: any) => !(s && s.key && del.has(s.key)));
    // === RUOLO: l'Expert vede SOLO __app_expert__ ===
    if (isExpertSidecar()) arr = arr.filter((s: any) => s && s.key === "__app_expert__");
    // === B4 POOL: i CHILD (pool > 0) vedono SOLO il loro gruppo; il MAIN (pool 0,
    // router della UI) vede TUTTE le sessioni (il filtro esecuzione è in #load) ===
    else if (poolSize() > 1 && poolIndex() > 0) arr = arr.filter((s: any) => s && isMyPoolSession(s.key));
    return arr;
  } catch (e) {
    process.stderr.write(`[pi-bridge] getSessionsFromFile error: ${e}`);
    return [];
  }
}

export function getAppVersion() {
  // Prima prova QUINKI_PKG (env var, usata dal sidecar standalone).
  const pkgPath = process.env.QUINKI_PKG;
  if (pkgPath) {
    try {
      const pkg = require(pkgPath);
      return pkg.version || "0.0.0";
    } catch {
      // fallback sotto
    }
  }
  try {
    const pkg = require(path.join(__dirname, "../../package.json"));
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function getProvidersConfig(): SafeProvidersConfig {
  return getSafeProvidersConfig();
}

// === FEATURE login OpenRouter (04 set): OAuth PKCE via SDK, nessun fallback manuale ===
let _openRouterOAuth: any = null;
async function getOpenRouterOAuth() {
  if (!_openRouterOAuth) {
    try { _openRouterOAuth = (await import("@earendil-works/pi-ai/auth/oauth/openrouter.js")).openRouterOAuth; } catch (e: any) { throw new Error("OpenRouter OAuth SDK not available: " + String(e?.message || e)); }
  }
  return _openRouterOAuth;
}

export async function openRouterLogin(): Promise<{ success: boolean; error?: string }> {
  // Il flusso: avvia PKCE+loopback (SDK), apre il browser sull'auth_url,
  // al callback salva la key cifrata nel config provider.
  // NIENTE fallback manuale: se il loopback non torna entro 5 min, errore.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5 * 60 * 1000);
  try {
    const oauth = await getOpenRouterOAuth();
    const interaction: any = {
      signal: abort.signal,
      notify: (n: any) => {
        if (n?.type === "auth_url" && n?.url) {
          // apre il browser sul macOS
          try { require("child_process").execSync(`open "${String(n.url).replace(/"/g, '\"')}"`, { stdio: "ignore" }); } catch {}
          logDebugStatic("openrouter-login-browser", { url: String(n.url).slice(0, 60) });
        } else if (n?.type === "progress") {
          logDebugStatic("openrouter-login-progress", { message: String(n?.message || "") });
        }
      },
      // Nessun fallback manuale: prompt mai risolto (l'SDK lo invoca solo se il
      // loopback non arriva; in tal caso il timeout/abort chiude tutto).
      prompt: () => new Promise<never>(() => {}),
    };
    const credential: any = await oauth.login(interaction);
    if (!credential || !credential.access) {
      return { success: false, error: "Login returned no API key" };
    }
    const key = String(credential.access);
    // Salva cifrata nel config provider
    try {
      const cfg = readProvidersConfig();
      if (!cfg.providers.OpenRouter) cfg.providers.OpenRouter = { enabled: true, baseUrl: "https://openrouter.ai/api/v1", apiKey: key, enabledModels: [] };
      cfg.providers.OpenRouter.apiKey = key;
      // NO auto-selection: l'utente sceglie i modelli da solo dopo il login
      writeProvidersConfig(cfg);
      logDebugStatic("openrouter-login-ok", { keyLen: key.length });
      return { success: true };
    } catch (e: any) {
      return { success: true, error: "Login ok ma salvataggio key fallito: " + String(e?.message || e) };
    }
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function openRouterLogout(): Promise<{ success: boolean; error?: string }> {
  try {
    const cfg = readProvidersConfig();
    if (cfg.providers.OpenRouter) {
      (cfg.providers.OpenRouter as any).apiKey = "";
      // apiKeyDelete=true: senza, writeProvidersConfig considera la chiave vuota
      // come "da preservare" (anti-loss) e il logout non cancella mai nulla.
      (cfg.providers.OpenRouter as any).apiKeyDelete = true;
    }
    writeProvidersConfig(cfg);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SUBSCRIPTION OAUTH PROVIDERS (2026-09-08): Anthropic, OpenAI Codex, GitHub Copilot, xAI
// Pattern: lazy-load SDK OAuth module → browser/device flow → credential (access+refresh)
// → store encrypted in providers config → models available after connection.
// Auto-refresh: quando access token scade, refresh automatico prima dell'uso.
// ═══════════════════════════════════════════════════════════════════════════

interface SubscriptionProviderDef {
  sdkId: string;               // "anthropic" | "openai-codex" | "github-copilot" | "xai"
  configKey: string;           // Key in providers config: "Anthropic" | "OpenAI" | "GitHub Copilot" | "xAI"
  displayName: string;         // "Anthropic (Claude)" | "OpenAI (ChatGPT)" | "GitHub Copilot" | "xAI (Grok)"
  baseUrl: string;            // API endpoint
  oauthModule: string;         // SDK module path
  oauthExport: string;         // Export name in the module
  loginLabel: string;          // UI button text
  description: string;         // UI description
  autoSelect?: string;         // For OpenAI Codex: auto-select browser method
}

const SUBSCRIPTION_PROVIDERS: Record<string, SubscriptionProviderDef> = {
  anthropic: {
    sdkId: "anthropic",
    configKey: "Anthropic",
    displayName: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com",
    oauthModule: "@earendil-works/pi-ai/auth/oauth/anthropic.js",
    oauthExport: "anthropicOAuth",
    loginLabel: "Sign in with Claude",
    description: "Use your Claude Pro/Max subscription. No API key needed — sign in with your Anthropic account and use Claude models with your existing plan.",
  },
  "openai-codex": {
    sdkId: "openai-codex",
    configKey: "OpenAI",
    displayName: "OpenAI (ChatGPT)",
    baseUrl: "https://chatgpt.com/backend-api",
    oauthModule: "@earendil-works/pi-ai/auth/oauth/openai-codex.js",
    oauthExport: "openaiCodexOAuth",
    loginLabel: "Sign in with ChatGPT",
    description: "Use your ChatGPT Plus/Pro subscription. Sign in with your OpenAI account and use GPT models with your existing plan.",
    autoSelect: "browser",  // OpenAI Codex prompts for browser vs device — auto-select browser
  },
  "github-copilot": {
    sdkId: "github-copilot",
    configKey: "GitHub Copilot",
    displayName: "GitHub Copilot",
    baseUrl: "https://api.individual.githubcopilot.com",
    oauthModule: "@earendil-works/pi-ai/auth/oauth/github-copilot.js",
    oauthExport: "githubCopilotOAuth",
    loginLabel: "Sign in with GitHub Copilot",
    description: "Use your GitHub Copilot subscription ($10/month). Sign in with GitHub and access Claude and GPT models through your Copilot plan.",
  },
  xai: {
    sdkId: "xai",
    configKey: "xAI",
    displayName: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    oauthModule: "@earendil-works/pi-ai/auth/oauth/xai.js",
    oauthExport: "xaiOAuth",
    loginLabel: "Sign in with Grok",
    description: "Use your SuperGrok or X Premium subscription. Sign in with your X account and use Grok models.",
  },
}

// Cache dei moduli OAuth (lazy-load)
// (la Map _oauthModules non serve più: ogni provider ha il suo cache variable)
// IMPORT LITERAL (Bun --compile richiede import statici per il bundling):
// `import(variable)` NON viene risolto da bun build --compile. Ogni provider
// usa il suo import literal, esattamente come fa openRouterLogin.
let _anthropicOAuth: any = null;
let _openAICodexOAuth: any = null;
let _githubCopilotOAuth: any = null;
let _xaiOAuth: any = null;

async function getSubscriptionOAuth(providerId: string): Promise<any> {
  switch (providerId) {
    case "anthropic":
      if (!_anthropicOAuth) {
        try { _anthropicOAuth = (await import("@earendil-works/pi-ai/auth/oauth/anthropic.js")).anthropicOAuth; } catch (e: any) { throw new Error(`Anthropic OAuth load failed: ${String(e?.message || e)}`); }
      }
      return _anthropicOAuth;
    case "openai-codex":
      if (!_openAICodexOAuth) {
        try { _openAICodexOAuth = (await import("@earendil-works/pi-ai/auth/oauth/openai-codex.js")).openaiCodexOAuth; } catch (e: any) { throw new Error(`OpenAI Codex OAuth load failed: ${String(e?.message || e)}`); }
      }
      return _openAICodexOAuth;
    case "github-copilot":
      if (!_githubCopilotOAuth) {
        try { _githubCopilotOAuth = (await import("@earendil-works/pi-ai/auth/oauth/github-copilot.js")).githubCopilotOAuth; } catch (e: any) { throw new Error(`GitHub Copilot OAuth load failed: ${String(e?.message || e)}`); }
      }
      return _githubCopilotOAuth;
    case "xai":
      if (!_xaiOAuth) {
        try { _xaiOAuth = (await import("@earendil-works/pi-ai/auth/oauth/xai.js")).xaiOAuth; } catch (e: any) { throw new Error(`xAI OAuth load failed: ${String(e?.message || e)}`); }
      }
      return _xaiOAuth;
    default:
      throw new Error(`Unknown subscription provider: ${providerId}`);
  }
}

// Login generico per subscription provider
export async function subscriptionProviderLogin(providerId: string): Promise<{ success: boolean; error?: string }> {
  const def = SUBSCRIPTION_PROVIDERS[providerId];
  if (!def) return { success: false, error: `Unknown provider: ${providerId}` };
  
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 5 * 60 * 1000); // 5 min timeout
  
  try {
    const oauth = await getSubscriptionOAuth(providerId);
    logDebugStatic(`subscription-login-start`, { provider: providerId, name: def.displayName });
    
    const interaction: any = {
      signal: abort.signal,
      notify: (n: any) => {
        if (n?.type === "auth_url" && n?.url) {
          // Browser OAuth (Anthropic, OpenAI): apri il browser
          try { require("child_process").execSync(`open "${String(n.url).replace(/"/g, '\"')}"`, { stdio: "ignore" }); } catch {}
          logDebugStatic("subscription-login-browser", { provider: providerId, url: String(n.url).slice(0, 80) });
        } else if (n?.type === "device_code" && n?.verificationUri) {
          // Device code flow (GitHub Copilot, xAI): apri il browser con il device code
          try { require("child_process").execSync(`open "${String(n.verificationUri).replace(/"/g, '\"')}"`, { stdio: "ignore" }); } catch {}
          logDebugStatic("subscription-login-device-code", { provider: providerId, userCode: n.userCode, verificationUri: String(n.verificationUri).slice(0, 80) });
        } else if (n?.type === "progress") {
          logDebugStatic("subscription-login-progress", { provider: providerId, message: String(n?.message || "") });
        }
      },
      prompt: (p: any) => {
        // Auto-select per OpenAI Codex (browser vs device code)
        if (p?.type === "select" && def.autoSelect) {
          return Promise.resolve(def.autoSelect);
        }
        // Per GitHub Copilot: Enterprise URL — vuoto per github.com normale
        if (p?.type === "text" && p?.message?.includes("Enterprise")) {
          return Promise.resolve("");
        }
        // Nessun fallback manuale: il timeout/abort chiude tutto
        return new Promise<never>(() => {});
      },
    };
    
    const credential: any = await oauth.login(interaction);
    if (!credential || !credential.access) {
      return { success: false, error: "Login returned no access token" };
    }
    
    // Salva i token nel config provider (access + refresh + expiry)
    try {
      const cfg = readProvidersConfig();
      if (!cfg.providers[def.configKey]) {
        (cfg.providers as any)[def.configKey] = {
          enabled: true,
          baseUrl: def.baseUrl,
          enabledModels: [],
        };
      }
      const p = (cfg.providers as any)[def.configKey];
      p.subscription = {
        access: credential.access,
        refresh: credential.refresh || "",
        expires: credential.expires || 0,
        connectedAt: Date.now(),
        availableModelIds: credential.availableModelIds || [],
      };
      writeProvidersConfig(cfg);
      logDebugStatic("subscription-login-ok", { provider: providerId, configKey: def.configKey, expires: credential.expires });
      return { success: true };
    } catch (e: any) {
      return { success: true, error: "Login ok ma salvataggio token fallito: " + String(e?.message || e) };
    }
  } catch (e: any) {
    logDebugStatic("subscription-login-error", { provider: providerId, error: String(e?.message || e) });
    return { success: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// Logout generico per subscription provider
export async function subscriptionProviderLogout(providerId: string): Promise<{ success: boolean; error?: string }> {
  const def = SUBSCRIPTION_PROVIDERS[providerId];
  if (!def) return { success: false, error: `Unknown provider: ${providerId}` };
  try {
    const cfg = readProvidersConfig();
    const p = (cfg.providers as any)[def.configKey];
    if (p) {
      delete p.subscription;
      // subscriptionDelete=true: dice a writeProvidersConfig di NON preservare
      // il token esistente (anti-loss non deve applicarsi al logout)
      (p as any).subscriptionDelete = true;
      // Rimuovi anche l'API key derivata (il token access)
      p.apiKey = "";
      (p as any).apiKeyDelete = true;
    }
    writeProvidersConfig(cfg);
    logDebugStatic("subscription-logout", { provider: providerId });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: String(e?.message || e) };
  }
}

// Status: controlla se un provider subscription è connesso e se il token è valido
export async function subscriptionProviderStatus(providerId: string): Promise<{ connected: boolean; expires?: number; needsRefresh?: boolean }> {
  const def = SUBSCRIPTION_PROVIDERS[providerId];
  if (!def) return { connected: false };
  try {
    const cfg = readProvidersConfig();
    const p = (cfg.providers as any)[def.configKey];
    if (!p?.subscription?.access) return { connected: false };
    const expires = p.subscription.expires || 0;
    const needsRefresh = expires > 0 && Date.now() > expires - 5 * 60 * 1000; // 5 min before expiry
    return { connected: true, expires, needsRefresh };
  } catch {
    return { connected: false };
  }
}

// Refresh token (per mantenere la connessione attiva)
export async function subscriptionProviderRefresh(providerId: string): Promise<{ success: boolean; error?: string }> {
  const def = SUBSCRIPTION_PROVIDERS[providerId];
  if (!def) return { success: false, error: `Unknown provider: ${providerId}` };
  try {
    const cfg = readProvidersConfig();
    const p = (cfg.providers as any)[def.configKey];
    if (!p?.subscription?.refresh) return { success: false, error: "No refresh token" };
    
    const oauth = await getSubscriptionOAuth(providerId);
    const credential = await oauth.refresh(
      { refresh: p.subscription.refresh, access: p.subscription.access },
      new AbortController().signal
    );
    if (!credential?.access) return { success: false, error: "Refresh returned no token" };
    
    p.subscription.access = credential.access;
    if (credential.refresh) p.subscription.refresh = credential.refresh;
    if (credential.expires) p.subscription.expires = credential.expires;
    writeProvidersConfig(cfg);
    logDebugStatic("subscription-refresh-ok", { provider: providerId, expires: credential.expires });
    return { success: true };
  } catch (e: any) {
    logDebugStatic("subscription-refresh-error", { provider: providerId, error: String(e?.message || e) });
    return { success: false, error: String(e?.message || e) };
  }
}

// Ottiene l'API key corrente per un provider subscription (con auto-refresh se necessario)
export async function subscriptionProviderGetApiKey(providerId: string): Promise<string | null> {
  const def = SUBSCRIPTION_PROVIDERS[providerId];
  if (!def) return null;
  try {
    const cfg = readProvidersConfig();
    const p = (cfg.providers as any)[def.configKey];
    if (!p?.subscription?.access) return null;
    
    // Auto-refresh se il token sta per scadere
    const expires = p.subscription.expires || 0;
    if (expires > 0 && Date.now() > expires - 5 * 60 * 1000) {
      const r = await subscriptionProviderRefresh(providerId);
      if (!r.success) {
        logDebugStatic("subscription-auto-refresh-failed", { provider: providerId, error: r.error });
        // Token scaduto ma refresh fallito — l'utente deve rifare il login
        return null;
      }
      // Rileggi il config aggiornato
      const cfg2 = readProvidersConfig();
      return ((cfg2.providers as any)[def.configKey]?.subscription?.access) || null;
    }
    
    return p.subscription.access;
  } catch {
    return null;
  }
}

export async function deleteProvider(name: string): Promise<{ success: boolean; error?: string; removed?: string }> {
  // FIX (01 set): eliminazione REALE del provider. Prima il bottone delete dell UI
  // chiamava solo deleteApiKey (cancellava la CHIAVE, il provider restava) e il
  // backup-restore lo risuscitava → "se elimini un provider ricompare da solo".
  // FEATURE 04 set: OpenRouter e Ollama sono provider FISSI — si disattivano (toggle
  // off) e si fa logout, ma NON si eliminano. L'UI nasconde il tasto delete; qui il
  // blocco è la rete di sicurezza server-side.
  const _ln = String(name || "").toLowerCase();
  if (_ln === "openrouter" || _ln === "ollama") {
    return { success: false, error: `Provider "${name}" is a built-in provider. You can disable it or log out, but you cannot delete it.` };
  }
  try {
    const existing = readProvidersConfig();
    let targetKey: string | null = null;
    for (const k of Object.keys(existing.providers)) {
      if (k.toLowerCase() === String(name || "").toLowerCase()) { targetKey = k; break; }
    }
    if (!targetKey) return { success: false, error: `Provider "${name}" not found` };
    const fullConfig: ProvidersConfig = {
      providers: { ...(existing.providers as any) },
      defaultModel: existing.defaultModel,
      defaultThinking: existing.defaultThinking,
    };
    (fullConfig.providers as any)[targetKey] = { ...(existing.providers[targetKey] as any), providerDelete: true };
    writeProvidersConfig(fullConfig);
    // Prune sezione da models.json (il Pi SDK non deve piu vedere il provider)
    try {
      const pruned: any = { providers: {} };
      for (const [pn, p] of Object.entries(fullConfig.providers)) {
        if (pn === targetKey || (p as any).providerDelete) continue;
        pruned.providers[pn] = p;
      }
      // mantieni i modelli gia presenti in models.json per i provider superstiti
      try {
        const modelsNow = JSON.parse(require("fs").readFileSync(join(homedir(), ".quinki", "models.json"), "utf8"));
        for (const pn of Object.keys(pruned.providers)) {
          if (modelsNow.providers?.[pn]) pruned.providers[pn] = modelsNow.providers[pn];
        }
      } catch {}
      const { syncModelsJson } = require("./providers");
      // rebuild senza il provider eliminato: usiamo syncModelsJson(fullConfig) che
      // scrive solo i provider enabled superstiti
    } catch {}
    await syncModelsJson(fullConfig);
    syncSettingsJson(fullConfig);
    logDebugStatic("delete-provider", { name: targetKey, success: true });
    return { success: true, removed: targetKey };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

export function getProvidersConfigFull(): ProvidersConfig {
  return readProvidersConfig();
}

export async function renameProvider(oldName: string, newName: string): Promise<{ success: boolean; error?: string }> {
  // FEATURE 04 set: i provider fissi non si rinomina (nome preservato per logica UI/usage)
  const _ln2 = String(oldName || "").toLowerCase();
  if (_ln2 === "openrouter" || _ln2 === "ollama") {
    return { success: false, error: "OpenRouter and Ollama are built-in providers. Their name cannot be changed." };
  }
  try {
    const existing = readProvidersConfig();
    let oldKey: string | null = null;
    for (const k of Object.keys(existing.providers)) {
      if (k.toLowerCase() === oldName.toLowerCase()) { oldKey = k; break; }
    }
    if (!oldKey) return { success: false, error: `Provider "${oldName}" not found` };
    if (oldKey === newName) return { success: true };
    const oldCfg = existing.providers[oldKey];
    const newProviders: Record<string, any> = {};
    for (const [k, v] of Object.entries(existing.providers)) {
      if (k === oldKey) {
        newProviders[newName] = v;
      } else {
        newProviders[k] = v;
      }
    }
    const fullConfig: ProvidersConfig = {
      providers: newProviders,
      defaultModel: existing.defaultModel,
      defaultThinking: existing.defaultThinking,
    };
    writeProvidersConfig(fullConfig);
    await syncModelsJson(fullConfig);
      // UNIVERSAL CAPS PROBE (29 ago): scopre thinking/vision REALI in background
      probeProviderCapabilities(newName).catch(() => {});
    syncSettingsJson(fullConfig);
    const pcfg = fullConfig.providers[newName];
    if (pcfg?.enabled) {
      piBridgeInstance?.syncProviderContextLengthsNow(newName).catch(() => {});
    }
    logDebugStatic("rename-provider", { oldName: oldKey, newName, success: true });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

export async function setProvidersConfig(config: any): Promise<{ success: boolean; error?: string }> {
  try {
    const fullConfig: ProvidersConfig = {
      providers: {},
      defaultModel: config.defaultModel || "",
      defaultThinking: config.defaultThinking || "xhigh",
      defaultMode: config.defaultMode || "plan",
    };
    const existing = readProvidersConfig();
    // === BUGFIX: mappa case-insensitive per recuperare chiavi esistenti indipendentemente dal case ===
    const existingByLower = new Map<string, { key: string; cfg: any }>();
    for (const [k, v] of Object.entries(existing.providers)) {
      existingByLower.set(k.toLowerCase(), { key: k, cfg: v });
    }
    for (const [name, pcfg] of Object.entries(config.providers || {})) {
      const pc = pcfg as any;
      let apiKey = pc.apiKey || "";
      // Cerca la chiave esistente case-insensitive
      const matched = existingByLower.get(name.toLowerCase());
      const existingApiKey = matched?.cfg?.apiKey || "";
      // Se l'apiKey è mascherata, recupera sempre la vera chiave dal file
      if (apiKey && apiKey.includes("••••")) {
        apiKey = existingApiKey;
      } else if (!apiKey && pc.apiKeySet !== false) {
        // Campo vuoto MA apiKeySet non è esplicitamente false → mantieni la chiave esistente
        // (apiKeySet=true, null, o undefined = mantieni; apiKeySet=false = cancella)
        apiKey = existingApiKey;
      }
      // Se apiKeySet=false E apiKey vuota → utente vuole cancellare la chiave
      // === NOTA: manteniamo il nome originale (case-preserving) per non rompere
      // riferimenti in models.json e settings.json ===
      fullConfig.providers[name] = {
        enabled: !!pc.enabled,
        baseUrl: pc.baseUrl || "",
        apiKey,
        enabledModels: Array.isArray(pc.enabledModels) ? pc.enabledModels : [],
        modelData: Array.isArray(pc.modelData) ? pc.modelData : [],
      };
    }
    writeProvidersConfig(fullConfig);
    await syncModelsJson(fullConfig);
      // UNIVERSAL CAPS PROBE (29 ago): scopre thinking/vision REALI in background
      probeProviderCapabilities(newName).catch(() => {});
    syncSettingsJson(fullConfig);
    // === Sync context lengths per i provider enabled ===
    // Aggiorna models.json con i contextWindow reali di Ollama/cloud provider,
    // così welcome e chat attiva leggono gli stessi valori.
    // Best-effort: non blocca se fallisce.
    for (const [name, pcfg] of Object.entries(fullConfig.providers)) {
      if (pcfg.enabled) {
        piBridgeInstance?.syncProviderContextLengthsNow(name).catch((e) => {
          logDebugStatic("sync-after-set-error", { provider: name, error: String(e) });
        });
      }
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

export async function fetchProviderModelsIPC(
  providerName: string,
  baseUrl: string,
  apiKey: string
): Promise<FetchedModel[]> {
  // Se apiKey è mascherata o vuota, recupera la vera chiave dal file
  let realApiKey = apiKey;
  if (!apiKey || apiKey.includes("••••")) {
    const full = readProvidersConfig();
    // === BUGFIX: lookup case-insensitive per gestire differenze "OpenRouter" vs "openrouter" ===
    const requestedLower = providerName.toLowerCase();
    let actualKey: string | null = null;
    for (const k of Object.keys(full.providers)) {
      if (k.toLowerCase() === requestedLower) { actualKey = k; break; }
    }
    if (actualKey) {
      const stored = full.providers[actualKey]?.apiKey || "";
      if (stored && stored.startsWith("enc:v1:")) {
        realApiKey = decryptString(stored);
      } else {
        realApiKey = stored;
      }
    } else {
      realApiKey = "";
    }
    // FIX 2026-09-08: subscription OAuth providers — il token è nel campo subscription.access
    // (non in apiKey). Se il provider è un subscription e ha un token, usalo.
    if (!realApiKey) {
      const subscriptionMap: Record<string, string> = {
        "openai": "openai-codex",
        "anthropic": "anthropic",
        "github copilot": "github-copilot",
        "xai": "xai",
      };
      const subId = subscriptionMap[requestedLower];
      if (subId) {
        try {
          const token = await subscriptionProviderGetApiKey(subId);
          if (token) {
            realApiKey = token;
            process.stderr.write(`[subscription-models] provider=${providerName} using OAuth token (${token.length} chars)`);
          }
        } catch {}
      }
    }
    process.stderr.write(`[security-audit] fetchProviderModelsIPC: provider=${providerName} resolvedKey=${actualKey || "NOT-FOUND"} recoveredKeyLen=${realApiKey.length} success=${realApiKey.length > 0}`);
  }
  // === Localhost/127.0.0.1 non richiede API key (server locale, qualsiasi porta) ===
  const isLocal = baseUrl.includes("11434") || baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1") || providerName.toLowerCase() === "ollama" || providerName.toLowerCase() === "openrouter" || baseUrl.includes("openrouter.ai");
  if (!realApiKey && !isLocal) {
    process.stderr.write(`[security-audit] fetchProviderModelsIPC: provider=${providerName} FAILED — no apiKey`);
    return [];
  }
  return await fetchProviderModels(providerName, baseUrl, realApiKey || "");
}

export async function testProviderConnectionIPC(
  providerName: string,
  baseUrl: string,
  apiKey: string
): Promise<{ success: boolean; count: number; error?: string }> {
  // Se apiKey è mascherata (contiene ••••) o vuota, recupera la vera chiave dal file
  let realApiKey = apiKey;
  if (!apiKey || apiKey.includes("••••")) {
    const full = readProvidersConfig();
    // === BUGFIX: lookup case-insensitive per gestire differenze "OpenRouter" vs "openrouter" ===
    const requestedLower = providerName.toLowerCase();
    let actualKey: string | null = null;
    for (const k of Object.keys(full.providers)) {
      if (k.toLowerCase() === requestedLower) { actualKey = k; break; }
    }
    if (actualKey) {
      const stored = full.providers[actualKey]?.apiKey || "";
      if (stored && stored.startsWith("enc:v1:")) {
        realApiKey = decryptString(stored);
      } else {
        realApiKey = stored;
      }
    } else {
      realApiKey = "";
    }
    process.stderr.write(`[security-audit] testProviderConnectionIPC: provider=${providerName} resolvedKey=${actualKey || "NOT-FOUND"} recoveredKeyLen=${realApiKey.length} success=${realApiKey.length > 0}`);
  }
  // Recover baseUrl from config if empty (same approach as apiKey)
  let realBaseUrl = baseUrl;
  if (!realBaseUrl) {
    const full = readProvidersConfig();
    const requestedLower = providerName.toLowerCase();
    for (const k of Object.keys(full.providers)) {
      if (k.toLowerCase() === requestedLower) {
        realBaseUrl = full.providers[k]?.baseUrl || "";
        break;
      }
    }
  }
  // Try connection with whatever key we have (empty = no auth header)
  // The test will fail naturally with 401 if the provider requires auth
  return await testProviderConnection(providerName, realBaseUrl || baseUrl, realApiKey || "");
}

export function getProviderApiKeyIPC(providerName: string): string {
  // === SICUREZZA: validazione input ===
  if (typeof providerName !== "string" || !providerName || providerName.length > 64) {
    process.stderr.write(`[security] getProviderApiKeyIPC rejected: invalid providerName`);
    return "";
  }
  // Whitelist caratteri ammessi (no path traversal, no injection)
  if (!/^[a-zA-Z0-9_\-]+$/.test(providerName)) {
    process.stderr.write(`[security] getProviderApiKeyIPC rejected: providerName contains invalid chars`);
    return "";
  }
  try {
    const full = readProvidersConfig();
    // === BUGFIX: lookup case-insensitive per gestire differenze "OpenRouter" vs "openrouter" ===
    const requestedLower = providerName.toLowerCase();
    let actualKey: string | null = null;
    for (const [k, v] of Object.entries(full.providers)) {
      if (k.toLowerCase() === requestedLower) { actualKey = k; break; }
    }
    if (!actualKey) {
      process.stderr.write(`[security-audit] getProviderApiKeyIPC: provider=${providerName} NOT FOUND in config (existing providers: ${Object.keys(full.providers).join(", ")})`);
      return "";
    }
    const provider = full.providers[actualKey];
    const storedKey = provider?.apiKey || "";
    const isEncryptedStored = storedKey.startsWith("enc:v1:");
    const decryptedKey = storedKey && !isEncryptedStored ? storedKey : (isEncryptedStored ? decryptString(storedKey) : "");
    // === AUDIT LOG dettagliato ===
    process.stderr.write(`[security-audit] getProviderApiKeyIPC: provider=${providerName} resolvedKey=${actualKey} storedKeyLen=${storedKey.length} isEncrypted=${isEncryptedStored} decryptedKeyLen=${decryptedKey.length} success=${decryptedKey.length > 0} preview=${decryptedKey.substring(0, 8)}...`);
    return decryptedKey;
  } catch (e: any) {
    process.stderr.write(`[security-audit] getProviderApiKeyIPC error:`, e?.message);
    return "";
  }
}

export function getDefaultModelFromProviders(): string {
  return getProviderDefaultModel();
}

export function getDefaultThinkingFromProviders(): string {
  return getProviderDefaultThinking();
}

// === C: Compaction IPC ===
export async function compactSessionIPC(sessionKey: string): Promise<{ ok: boolean; error?: string }> {
  const bridge = getPiBridgeInstance();
  if (!bridge) return { ok: false, error: "Bridge not ready" };
  return await bridge.compact(sessionKey);
}

export async function checkForPiUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
  // === Fase A: Pi SDK embedded, versione fissa nel vendor ===
  let current = "0.78.0";
  try {
    const pkg = require("./vendor/@earendil-works/pi-coding-agent/package.json");
    current = pkg.version || "0.78.0";
  } catch (e) {
    // Fallback su hardcoded
  }
  // Versione embedded: niente update disponibile (il SDK è congelato nel vendor)
  return { current, latest: current, hasUpdate: false };
}

export function updatePi(): Promise<{ success: boolean; error?: string }> {
  // === Fase A: Pi SDK embedded, update non disponibile ===
  return Promise.resolve({ success: false, error: "Pi SDK è embedded (versione congelata). Aggiornamento non disponibile." });
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

export function getFullDebugLog(): { ts: number; tag: string; data: any }[] {
  const out: { ts: number; tag: string; data: any }[] = [];
  try {
    if (!fs.existsSync(DEBUG_LOG_FILE)) return out;
    // FIX performance: NON leggere l'intero file (può essere decine di MB e congela il sidecar).
    // Leggiamo solo l'ultimo MB e teniamo le ultime 300 entry.
    const st = fs.statSync(DEBUG_LOG_FILE);
    const fd = fs.openSync(DEBUG_LOG_FILE, "r");
    const len = Math.min(st.size, 1_500_000);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    const raw = buf.toString("utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const last = lines.slice(-300);
    for (const line of last) {
      try {
        const obj = JSON.parse(line);
        if (typeof obj.ts === "number" && typeof obj.tag === "string") {
          out.push({ ts: obj.ts, tag: obj.tag, data: obj.data });
        }
      } catch {}
    }
  } catch (e) {
    process.stderr.write(`[pi-bridge] getFullDebugLog error: ${e}`);
  }
  return out;
}

export function clearDebugLogFile(): { success: boolean; error?: string } {
  try {
    if (fs.existsSync(DEBUG_LOG_FILE)) fs.unlinkSync(DEBUG_LOG_FILE);
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message || String(e) };
  }
}

// === Fix 9/B11: get streaming status per riconnessione WS ===
export function getStreamingStatusInstance(): Set<string> {
  try {
    const inst = (typeof piBridgeInstance !== "undefined" ? piBridgeInstance : getPiBridgeInstance?.()) as any;
    if (!inst) return new Set<string>();
    // Usa il metodo pubblico getStreamingSessionKeys della classe
    if (typeof inst.getStreamingSessionKeys === "function") {
      return new Set(inst.getStreamingSessionKeys());
    }
    return new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function getStreamingStatusIPC(): string[] {
  return Array.from(getStreamingStatusInstance());
}

// === Step 3c: ritorna il system prompt effettivo di Pi SDK per la sessione ===
export function getSystemPromptIPC(sessionKey: string): string {
  try {
    const inst = (typeof piBridgeInstance !== "undefined" ? piBridgeInstance : getPiBridgeInstance?.()) as any;
    if (!inst) return "";
    const pi = typeof inst.getActiveSession === "function" ? inst.getActiveSession(sessionKey) : undefined;
    if (!pi) return "";
    const sp = pi?.agent?.state?.systemPrompt;
    return typeof sp === "string" ? sp : "";
  } catch {
    return "";
  }
}
