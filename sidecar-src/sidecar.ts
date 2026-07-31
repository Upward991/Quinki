// src/main/sidecar.ts — Entry point per il sidecar Node.js (Flutter Dashboard)
// Comunicazione: JSON-RPC 2.0 via stdin/stdout (NDJSON)
//
// Questo file viene compilato da electron-vite insieme al main process,
// usando gli stessi alias di risoluzione (vendor, jiti, typebox).
// Il bundle risultante è un file JavaScript standalone che può essere
// lanciato con `node out/main/sidecar.js`.
//
// === M0.3 (Sessione 2) ===
// - P1: FakeWebSocket wrappa gli eventi WS {type:"..."} di pi-bridge in
//   notifiche JSON-RPC {method:"...",params:{...}} così il SidecarHandler
//   Dart (che legge msg['method']/msg['params']) può dispatcharli.
// - P2: il sidecar emette notifiche mirror di server.ts per i metodi
//   request/response quando chiamati senza id (notify), così i case Dart
//   history/session_meta/thinking_levels/context_usage/all_context_usage/
//   debug_log/full_state/models_list/commands_list/agents_list + onboarding
//   pi_config_* tornano vivi.
// - P3: aggiunti 20 handler mancanti (settings/providers/attachments/
//   folders/update/preflight) + alias per i nomi usati dal Flutter
//   (pi_check_config, pi_create_config, get_history, update_last_read).

import * as path from "node:path";
import * as fs from "node:fs";
import { homedir } from "node:os";
import {
  PiBridge,
  setPiBridgeInstance,
  getSystemPromptIPC,
  getStreamingStatusIPC,
  getSettings,
  getAppVersion,
  getProvidersConfig,
  setProvidersConfig,
  fetchProviderModelsIPC,
  testProviderConnectionIPC,
  getProviderApiKeyIPC,
  checkForPiUpdate,
  updatePi,
  getFullDebugLog,
  clearDebugLogFile,
  moveSessionIPC,
  deleteSessionsByKeysIPC,
  deleteSessionsByFolderIdIPC,
  getFolders,
  setFolders,
  computePreflightStats,
} from "./pi-bridge";
import { readModelsFromDisk } from "./models";
import { readProvidersConfig, writeProvidersConfig, syncModelsJson } from "./providers";
import { buildSidecarEntry } from "./sidecar-helper";
import { createAgentHandlers } from "./agent-handlers";

// === FORCE: stdout.write -> stderr.write TRANNE per messaggi JSON-RPC ===
// Alcuni moduli (Bun runtime, vendor SDK) scrivono su stdout con process.stdout.write
// bypassando console.log. Forza TUTTO a stderr tranne JSON-RPC valido.
const _origStdoutWrite2 = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: any, ...args: any[]): boolean => {
  const s = typeof chunk === "string" ? chunk : (chunk?.toString?.() ?? "");
  // Passa SOLO messaggi JSON-RPC validi (iniziano con { o sono risposte pure)
  const trimmed = s.trim();
  if (trimmed.startsWith("{") && (trimmed.includes('jsonrpc') || trimmed.includes('method') || trimmed.includes('result') || trimmed.includes('error') || trimmed.includes('id'))) {
    return (_origStdoutWrite2 as any)(chunk, ...args);
  }
  // Tutto il resto -> stderr
  return process.stderr.write(s);
}) as any;
process.stderr.write("[sidecar-init] stdout filter ACTIVE - solo JSON-RPC passa su stdout\n");

// === FakeWebSocket: redirige ws.send() a stdout NDJSON ===
// P1: wrappa gli eventi WS-style {type:"..."} di pi-bridge in notifiche
// JSON-RPC {jsonrpc, method, params} così il SidecarHandler Dart li dispatcha.
class FakeWebSocket {
  // pi-bridge emette solo se ws.readyState === ws.constructor.OPEN (riga 1544).
  // Senza questi static, il guard fallisce (1 === undefined) e nessun evento fluisce.
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = 1;

  send(data: string) {
    if (typeof data !== "string") data = JSON.stringify(data);
    try {
      const obj = JSON.parse(data);
      if (obj && typeof obj === "object" && typeof obj.type === "string") {
        // WS-style event → JSON-RPC notification. params = whole event (contiains type + all fields).
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: obj.type, params: obj }) + "\n");
        return;
      }
    } catch {
      // non-JSON o stringa già JSON-RPC: passa Through
    }
    // già JSON-RPC (es. ready/error da sendNotification) o fallback
    process.stdout.write(data + "\n");
  }
  close() {}
}

// === JSON-RPC helpers ===
function sendResult(id: number, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", result, id }) + "\n");
}

function sendError(id: number, error: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: error }, id }) + "\n");
}

function sendNotification(method: string, params: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method, params: params || {} }) + "\n");
}

// === P2: mappa method → evento notifica (mirror server.ts) ===
// Quando un metodo è chiamato SENZA id (notify), il sidecar emette la notifica
// corrispondente così i case Dart morti tornano vivi. Con id (call) restituisce
// solo il result (no doppio processaggio).
const notificationFor: Record<string, string> = {
  getHistory: "history",
  get_history: "history",
  getSessionMeta: "session_meta",
  get_session_meta: "session_meta",
  getThinkingLevels: "thinking_levels",
  get_thinking_levels: "thinking_levels",
  getContextUsage: "context_usage",
  get_context_usage: "context_usage",
  getAllContextUsage: "all_context_usage",
  get_all_context_usage: "all_context_usage",
  getDebugLog: "debug_log",
  get_debug_log: "debug_log",
  getFullDebugLog: "debug_log",
  getFullState: "full_state",
  get_full_state: "full_state",
  getModels: "models_list",
  get_models: "models_list",
  getCommands: "commands_list",
  get_commands: "commands_list",
  getAgents: "agents_list",
  get_agents: "agents_list",
  listAgents: "agents_list",
  listSkills: "skills_list",
  getGlobalConfig: "global_config",
};

// === PiBridge instance ===
let piBridge: PiBridge | null = null;
const agentDir = process.env.QUINKI_AGENT_DIR || path.join(homedir(), ".pi", "agent");
const authPath = path.join(agentDir, "auth.json");
const modelsPath = path.join(agentDir, "models.json");
const attachmentsDir = path.join(agentDir, "quinki-attachments");
const settingsFile = path.join(agentDir, "quinki-settings.json");
const agentsDir = path.join(agentDir, "agents");
const globalConfigFile = fs.existsSync(path.join(agentDir, "quinki-global.json"))
  ? path.join(agentDir, "quinki-global.json")
  : path.join(agentDir, "dashboard-global.json");

const formatName = (id: string) =>
  id.replace(":cloud", "").replace(":35b-mlx", "").replace(":567m", "").replace(":120b-cloud", " 120B")
    .split(/[-:]/).map((w: string) => w ? w.charAt(0).toUpperCase() + w.slice(1) : "").filter(Boolean).join(" ");

function getModelsList() {
  return readModelsFromDisk().map(m => ({
    provider: m.provider, id: m.id, name: m.name || formatName(m.id),
    reasoning: m.reasoning ?? true, contextWindow: m.contextWindow, maxTokens: m.maxTokens, input: m.input,
  }));
}

// === Helper onboarding: check + emit pi_config_needed/ok (mirror server.ts:171) ===
function piCheckAndNotify() {
  const ok = fs.existsSync(authPath) && fs.existsSync(modelsPath);
  sendNotification(ok ? "pi_config_ok" : "pi_config_needed", {});
  return ok;
}

// === Request handlers ===
const handlers: Record<string, (params: any) => Promise<any>> = {
  listSessions: async () => ({ sessions: piBridge ? piBridge.getSessionsWithFolder() : [] }),
  getFullState: async () => ({
    sessions: piBridge ? piBridge.getSessionsWithFolder() : [],
    models: getModelsList(),
  }),

  getModels: async () => ({ models: getModelsList() }),

  getAgents: async () => ({ agents: [{ id: "pi", name: "Pi Agent", desc: "Coding agent" }] }),

  getCommands: async () => ({ commands: [
    { name: "/model", desc: "Cambia modello" },
    { name: "/new", desc: "Nuova sessione" },
    { name: "/name", desc: "Rename session" },
    { name: "/help", desc: "Help" },
  ] }),

  // === Onboarding Pi ===
  // checkConfig + alias pi_check_config: emette pi_config_ok/needed
  checkConfig: async () => { const configured = piCheckAndNotify(); return { configured }; },
  pi_check_config: async () => { const configured = piCheckAndNotify(); return { configured }; },

  createConfig: async () => {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(authPath, "{}", "utf8");
    fs.writeFileSync(modelsPath, JSON.stringify({ providers: {} }, null, 2), "utf8");
    sendNotification("pi_config_created", {});
    return { created: true };
  },
  pi_create_config: async () => handlers.createConfig({}),

  createSession: async (p) => {
    const key = `pi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const s = piBridge!.create(key, p.label || "Chat");
    if (p.agentId) {
      piBridge!.setAgent(key, String(p.agentId));
      piBridge!.setChatAgents(key, String(p.agentId));
    }
    if (p.model) await piBridge!.setModel(key, p.model);
    if (p.thinkingLevel) piBridge!.setThinkingLevel(key, p.thinkingLevel);
    if (p.mode) piBridge!.setMode(key, String(p.mode));
    if (typeof p.compactionAuto === "boolean") {
      piBridge!.setSessionCompaction(key, p.compactionAuto, typeof p.compactionThreshold === "number" ? p.compactionThreshold : 80);
    }
    const meta = piBridge!.getSessionMeta(key);
    piBridge!.logDebug("session-created", { sessionKey: key, label: p.label, agentId: p.agentId || "pi", model: meta.model, thinkingLevel: meta.thinkingLevel, mode: meta.mode });
    return { key, label: s.label, agentId: p.agentId || "pi", model: meta.model, thinkingLevel: meta.thinkingLevel, compactionAuto: p.compactionAuto, compactionThreshold: p.compactionThreshold };
  },
  ensureSession: async (p) => {
    // Crea l'entry della sessione se non esiste (idempotente: se esiste già, ritorna quella).
    // Usato dall'Expert (chiave fissa __quinki_expert__) che NON passa da createSession:
    // senza entry, send() esce subito (no msg-in, nessuna risposta).
    const s = piBridge!.create(String(p.sessionKey), p.label || "Chat");
    return { sessionKey: p.sessionKey, label: s.label };
  },

  renameSession: async (p) => {
    piBridge!.rename(p.sessionKey, p.label);
    piBridge!.logDebug("session-renamed", { sessionKey: p.sessionKey, newLabel: p.label });
    return { sessionKey: p.sessionKey, label: p.label };
  },

  deleteSession: async (p) => {
    piBridge!.remove(p.sessionKey);
    piBridge!.logDebug("session-deleted", { sessionKey: p.sessionKey });
    return { sessionKey: p.sessionKey };
  },

  setModel: async (p) => {
    const oldMeta = piBridge!.getSessionMeta(p.sessionKey);
    const ok = await piBridge!.setModel(p.sessionKey, p.model);
    if (!ok) throw new Error("Model not found");
    piBridge!.logDebug("model-changed", { sessionKey: p.sessionKey, oldModel: oldMeta.model, newModel: p.model });
    return { model: p.model, sessionKey: p.sessionKey };
  },

  setThinking: async (p) => {
    const lvl = p.thinkingLevel || p.level;
    const oldMeta = piBridge!.getSessionMeta(p.sessionKey);
    piBridge!.setThinkingLevel(p.sessionKey, lvl);
    piBridge!.logDebug("thinking-changed", { sessionKey: p.sessionKey, oldLevel: oldMeta.thinkingLevel, newLevel: lvl });
    return { level: lvl, sessionKey: p.sessionKey };
  },
  setMode: async (p) => {
    const mode = p.mode === "plan" ? "plan" : "build";
    const oldMeta = piBridge!.getSessionMeta(String(p.sessionKey));
    piBridge!.setMode(String(p.sessionKey), mode);
    piBridge!.logDebug("mode-changed", { sessionKey: p.sessionKey, oldMode: oldMeta.mode, newMode: mode });
    return { sessionKey: p.sessionKey, mode };
  },
  setAgent: async (p) => {
    const oldMeta = piBridge!.getSessionMeta(String(p.sessionKey));
    piBridge!.setAgent(String(p.sessionKey), p.agentId ? String(p.agentId) : null);
    piBridge!.logDebug("agent-changed", { sessionKey: p.sessionKey, oldAgent: oldMeta.agentId, newAgent: p.agentId ?? null });
    return { sessionKey: p.sessionKey, agentId: p.agentId ?? null };
  },
  setChatAgents: async (p) => {
    piBridge!.setChatAgents(String(p.sessionKey), String(p.agentIds || ''));
    piBridge!.logDebug("chat-agents-changed", { sessionKey: p.sessionKey, agentIds: p.agentIds ?? '' });
    return { sessionKey: p.sessionKey, agentIds: p.agentIds ?? '' };
  },
  setAgentOverride: async (p) => {
    piBridge!.logDebug('set-agent-override-rpc', { sessionKey: p.sessionKey, agentId: p.agentId, model: p.model, thinking: p.thinkingLevel });
    piBridge!.setAgentOverride(String(p.sessionKey), String(p.agentId), p.model ?? null, p.thinkingLevel ?? null);
    return { ok: true };
  },
  getAgentOverrides: async (p) => {
    const overrides = piBridge!.getAgentOverrides(String(p.sessionKey));
    return { overrides };
  },
  reloadSession: async (p) => {
    piBridge!.reloadSession(String(p.sessionKey));
    piBridge!.logDebug("session-reloaded", { sessionKey: p.sessionKey });
    return { sessionKey: p.sessionKey };
  },
  setWorkingDir: async (p) => {
    piBridge!.setWorkingDir(String(p.sessionKey), String(p.path));
    piBridge!.logDebug("working-dir-changed", { sessionKey: p.sessionKey, path: p.path });
    return { sessionKey: p.sessionKey, path: p.path };
  },
  resetSession: async (p) => {
    piBridge!.resetSession(String(p.sessionKey));
    piBridge!.logDebug("session-reset", { sessionKey: p.sessionKey });
    return { sessionKey: p.sessionKey };
  },
  setExpertEnv: async (p) => {
    piBridge!.setExpertEnv(String(p.exePath));
    return { exePath: p.exePath };
  },

  setSessionCompaction: async (p) => {
    piBridge!.setSessionCompaction(p.sessionKey, p.auto, p.threshold);
    return {};
  },

  abort: async (p) => {
    piBridge!.abort(String(p.sessionKey));
    return { ok: true };
  },
  abortCompaction: async (p) => ({ sessionKey: p.sessionKey, ...piBridge!.abortCompaction(p.sessionKey) }),

  getThinkingLevels: async (p) => {
    const data = piBridge!.getOllamaThinkingLevels(p.sessionKey);
    return { levels: data.piLevels, ollamaLevels: data.ollamaLevels, sessionKey: p.sessionKey };
  },

  getSessionMeta: async (p) => ({ sessionKey: p.sessionKey, ...piBridge!.getSessionMeta(p.sessionKey) }),

  getContextUsage: async (p) => ({ sessionKey: p.sessionKey, usage: piBridge!.getContextUsage(p.sessionKey) }),

  getAllContextUsage: async () => ({ usage: piBridge!.getAllContextUsage() }),

  getModelContext: async (p) => ({ modelId: p.modelId, ...await piBridge!.getModelContext(p.modelId) }),

  getHistory: async (p) => ({ sessionKey: p.sessionKey, messages: piBridge!.getHistory(String(p.sessionKey)), delegations: piBridge ? piBridge.getDelegations(String(p.sessionKey || "")) : [] }),
  get_history: async (p) => handlers.getHistory(p),

  stopStream: async (p) => { if (piBridge && p?.sessionKey) piBridge.abort(p.sessionKey); return { success: true }; },
  sendMessage: async (p) => {
    const sk = String(p.sessionKey);
    const mid = p.messageId || `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const meta = piBridge!.getSessionMeta(sk);
    piBridge!.logDebug("send-message", {
      sessionKey: sk,
      agentId: p.agentId || meta.agentId || "(none)",
      model: p.model || meta.model || "(default)",
      thinking: p.thinkingLevel || meta.thinkingLevel || "off",
      mode: meta.mode || "plan",
      textPreview: (p.text || "").substring(0, 80)
    });
    if (p.model) await piBridge!.setModel(sk, p.model);
    if (p.thinkingLevel) piBridge!.setThinkingLevel(sk, p.thinkingLevel);
    // === Set agent BEFORE send (single call, no race condition) ===
    if (p.agentId) {
      piBridge!.setAgent(sk, String(p.agentId));
    }
    piBridge!.addUserMsg(sk, p.text, mid);
    const fakeWs = new FakeWebSocket();
    await piBridge!.send(fakeWs, { sessionKey: sk, text: p.text, files: p.files, workingDirs: p.workingDirs });
    piBridge!.logDebug("message-sent", { sessionKey: sk, messageId: mid, agent: p.agentId || meta.agentId, model: p.model || meta.model });
    return { messageId: mid, sessionKey: sk };
  },

  steer: async (p) => {
    piBridge!.steer(new FakeWebSocket(), { sessionKey: String(p.sessionKey), text: p.text });
    return {};
  },

  compactSession: async (p) => {
    piBridge!.logDebug("compact-session", { sessionKey: p.sessionKey });
    const fakeWs = new FakeWebSocket();
    return piBridge!.compact(String(p.sessionKey), fakeWs);
  },

  getSystemPrompt: async (p) => ({ prompt: getSystemPromptIPC(p.sessionKey) }),

  getStreamingStatus: async () => ({ streamingKeys: getStreamingStatusIPC() }),
  getDelegations: async (p) => ({ delegations: piBridge ? piBridge.getDelegations(String(p.sessionKey || "")) : [] }),
  getStreamingMessage: async (p) => ({ streaming: piBridge ? piBridge.getStreamingMessage(String(p.sessionKey)) : null }),

  getDebugLog: async () => ({ log: piBridge!.getDebugLog() }),
  debugLog: async (p) => { if (piBridge && p && typeof p.tag === 'string') piBridge.logDebug(p.tag, p.data); return { ok: true }; },
  log_debug: async (p) => handlers.debugLog(p),
  clearDebugLog: async () => { piBridge!.clearDebugLog(); return { log: [] }; },

  // === P3: metodi IPC mancanti (settings/providers/attachments/folders/update/preflight) ===
  getSettings: async () => getSettings(),
  saveSettings: async (p) => {
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      let existing: any = {};
      if (fs.existsSync(settingsFile)) {
        try { existing = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch { existing = {}; }
      }
      const merged = { ...existing, ...(p || {}) };
      fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2), "utf8");
      return { success: true };
    } catch (e: any) {
      process.stderr.write(`[settings] save failed: ${e.message}\n`);
      return { success: false, error: e.message };
    }
  },

  getAppVersion: async () => ({ version: getAppVersion() }),

  getProvidersConfig: async () => getProvidersConfig(),
  setProvidersConfig: async (p) => setProvidersConfig(p),
  fetchProviderModels: async (p) => fetchProviderModelsIPC(p.providerName, p.baseUrl, p.apiKey),
  testProviderConnection: async (p) => testProviderConnectionIPC(p.providerName, p.baseUrl, p.apiKey),
  getProviderApiKey: async (p) => ({ apiKey: getProviderApiKeyIPC(p.providerName) }),

  saveAttachments: async (p) => {
    try {
      fs.mkdirSync(attachmentsDir, { recursive: true });
      const filePath = path.join(attachmentsDir, `${p.sessionKey}.json`);
      let existing: Record<string, any[]> = {};
      if (fs.existsSync(filePath)) {
        try { existing = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { existing = {}; }
      }
      const next = buildSidecarEntry(existing, p.messageId, p.files, p.contentKey);
      fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
      return { success: true };
    } catch (e: any) {
      process.stderr.write(`[attachments] save failed: ${e.message}\n`);
      return { success: false };
    }
  },
  loadAttachments: async (p) => {
    try {
      const filePath = path.join(attachmentsDir, `${p.sessionKey}.json`);
      if (!fs.existsSync(filePath)) return {};
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e: any) {
      process.stderr.write(`[attachments] load failed: ${e.message}\n`);
      return {};
    }
  },

  getFolders: async () => ({ folders: getFolders() }),
  setFolders: async (p) => setFolders(p.folders),
  moveSession: async (p) => {
    process.stderr.write(`[moveSession] received: ${JSON.stringify(p)}\n`);
    const result = moveSessionIPC(p.sessionKey, p.folderId ?? null, p.order ?? Date.now());
    // Also update in-memory entries so getFullState returns correct data
    if (result.success && piBridge) {
      piBridge.updateSessionEntry(p.sessionKey, { folderId: p.folderId ?? null, order: p.order ?? Date.now() });
    }
    return result;
  },
  deleteSessionsByFolderId: async (p) => deleteSessionsByFolderIdIPC(p.folderId),
  deleteSessionsByKeys: async (p) => deleteSessionsByKeysIPC(p.keys),

  getFullDebugLog: async () => ({ log: getFullDebugLog() }),
  clearDebugLogFile: async () => clearDebugLogFile(),

  checkForPiUpdate: async () => checkForPiUpdate(),
  updatePi: async () => updatePi(),

  computePreflightStats: async (p) => computePreflightStats(p.messages || [], p.text, p.files, p.contextWindow || 0),

  // === Alias / stub per nomi usati dal Flutter ===
  // update_last_read: in Electron era gestito da server.ts (WS). Pi-bridge non espone
  // un metodo dedicato; stub (persistenza lastRead differita a M1). Il Flutter fa
  // clear unread ottimistico, quindi l'UX è preservata.
  update_last_read: async () => ({ success: true }),
  watch_session: async () => ({ success: true }),
  get_session_meta: async (p) => handlers.getSessionMeta(p),
  get_thinking_levels: async (p) => handlers.getThinkingLevels(p),
  get_context_usage: async (p) => handlers.getContextUsage(p),
  get_all_context_usage: async () => handlers.getAllContextUsage(),

  // === Agent management (Fase 1: tab Agenti) ===
  ...createAgentHandlers(agentDir, () => process.env.QUINKI_AGENT_CWD || path.join(homedir(), ".quinki", "workdir")),

  // === OVERRIDE agent-handlers: save API key to providers config too ===
  storeApiKey: async (p) => {
    try {
      // NON cifrare qui: writeProvidersConfig cifra. Doppia cifratura = chiave illeggibile.
      const cfg = readProvidersConfig();
      let key = Object.keys(cfg.providers).find((k: string) => k.toLowerCase() === p.service.toLowerCase());
      if (key) {
        cfg.providers[key].apiKey = p.key;
        writeProvidersConfig(cfg);
        // Propaga subito a models.json (il Pi SDK legge la chiave in chiaro da lì)
        syncModelsJson(readProvidersConfig());
        try { (piBridge as any)?.refreshModelRegistry?.(); } catch {}
      }
      process.stderr.write(`[storeApiKey] Saved key for ${p.service}\n`);
      return { success: true };
    } catch (e: any) {
      process.stderr.write(`[storeApiKey] Error: ${e.message}\n`);
      return { success: false, error: e.message };
    }
  },
  deleteApiKey: async (p) => {
    try {
      const cfg = readProvidersConfig();
      let key = Object.keys(cfg.providers).find((k: string) => k.toLowerCase() === p.service.toLowerCase());
      if (key) {
        cfg.providers[key].apiKey = "";
        writeProvidersConfig(cfg);
        syncModelsJson(readProvidersConfig());
        try { (piBridge as any)?.refreshModelRegistry?.(); } catch {}
      }
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  },
};

// === NDJSON reader su stdin ===
let inputBuffer = "";

process.stdin.setEncoding("utf8");
// === Die with parent: quando l'app chiude stdin (muore/quit/SIGKILL), il sidecar esce.
// Previene orphan sidecar che terrebbero il lock su ~/.pi/agent e bloccherebbero il
// sidecar dell'app al riavvio (dopo "Salva e riavvia" o flutter run dell'Expert).
// stdin EOF: non uscire (modalita standalone)
process.stdin.on("close", () => { try { process.exit(0); } catch {} });
// Belt-and-suspenders: se stdin EOF non fire (edge case), monitora il parent PID ogni 5s.
// parent check: disattivato in modalita standalone
process.stdin.on("data", (chunk) => {
  inputBuffer += chunk;
  let idx;
  while ((idx = inputBuffer.indexOf("\n")) >= 0) {
    const line = inputBuffer.slice(0, idx).trim();
    inputBuffer = inputBuffer.slice(idx + 1);
    if (line) handleLine(line);
  }
});

async function handleLine(line: string) {
  try {
    const msg = JSON.parse(line);
    const id = msg.id;
    const method = msg.method;
    const params = msg.params || {};
    if (!method) return;

    const handler = handlers[method];
    if (!handler) {
      if (id != null) sendError(id, `Unknown method: ${method}`);
      else process.stderr.write(`Unknown notify method: ${method}\n`);
      return;
    }

    try {
      const result = await handler(params);
      if (id != null) {
        sendResult(id, result);
      } else if (notificationFor[method]) {
        // P2: notify (no id) → emetti notifica mirror di server.ts
        sendNotification(notificationFor[method], result);
      }
    } catch (e: any) {
      if (id != null) sendError(id, e.message || String(e));
      process.stderr.write(`Handler error [${method}]: ${e.message}\n`);
    }
  } catch (e: any) {
    process.stderr.write(`Parse error: ${e.message}\n`);
  }
}

// === Bootstrap ===
async function bootstrap() {
  try {
    // Agent working dir: configurabile via env, default ~/.quinki/workdir.
    // Il SDK pi-coding-agent legge <cwd>/package.json al boot (project detection);
    // in standalone non c'è, quindi assicuriamo uno stub package.json.
    const workdir = process.env.QUINKI_AGENT_CWD || path.join(homedir(), ".quinki", "workdir");
    fs.mkdirSync(workdir, { recursive: true });
    // NON creiamo più uno stub package.json nel workdir. Il Pi SDK non lo richiede
    // (letto solo se esiste, guardato da existsSync/try-catch) — provato dal fatto che
    // chat su cartelle senza package.json (es. progetti Flutter) funzionano. Così il
    // workdir di default resta vuoto e "opera senza directory" non mostra file spuri.
    process.chdir(workdir);
    piBridge = new PiBridge({ cwd: workdir, agentDir });
    setPiBridgeInstance(piBridge);
    await piBridge.init();
    sendNotification("ready", { message: "PiBridge initialized" });
    // === NO periodic flush, NO SIGTERM handler ===
    // #save() è chiamato esplicitamente da create(), setModel(), setChatAgents(), rename(), etc.
    // Un flush periodico causava data loss con sidecar multipli (stale data sovrascriveva fresh data).
    process.stderr.write("[sidecar-marker] stdout-filter-active\n");
    // Onboarding check al boot (mirror server.ts)
    piCheckAndNotify();
  } catch (err: any) {
    process.stderr.write(`Bootstrap error: ${err.message}\n${err.stack}\n`);
    sendNotification("error", { message: err.message });
    process.exit(1);
  }
}

bootstrap();