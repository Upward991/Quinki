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
import { spawn } from "node:child_process";
import { initPoolRouter, tryRoute } from "./pool-router";
import { refreshThinkingCapsEvolution } from "./providers";
import { loadAllTabPlugins, reloadTabPlugin, unloadTabPlugin, tryHandleTabPluginRpc, tabDir } from "./tab-plugins";
import {
  readMcpServers,
  saveMcpServers,
  installPackageServer,
  mcpInstallDir,
  killServerProcs,
} from "./mcp";
import {
  PiBridge,
  setPiBridgeInstance,
  getSystemPromptIPC,
  getStreamingStatusIPC,
  getSettings,
  getAppVersion,
  getProvidersConfig,
  setProvidersConfig,
  renameProvider,
  deleteProvider,
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
  writeSidecarLock,
  isExpertAlive,
  openRouterLogin,
  openRouterLogout,
  subscriptionProviderLogin,
  subscriptionProviderLogout,
  subscriptionProviderStatus,
  subscriptionProviderRefresh,
  subscriptionProviderGetApiKey,
} from "./pi-bridge";
import { readModelsFromDisk } from "./models";
import { readProvidersConfig, writeProvidersConfig, syncModelsJson, getOpenRouterUsage, getOllamaUsage, ollamaCloudKeySet, setOllamaCloudKey, clearOllamaCloudKey, getOllamaCloudUsage, ollamaInstalled, ollamaInstall, ollamaInstallStatus, refreshOpenRouterContextWindows } from "./providers";
import { buildSidecarEntry } from "./sidecar-helper";
import { createAgentHandlers } from "./agent-handlers";
import { seedDefaults } from "./seed-defaults";
import { ExecutionEngine } from "./executor";
import { Scheduler } from "./scheduler";
import { LongHorizon } from "./longhorizon";

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
        try { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: obj.type, params: obj }) + "\n"); } catch {}
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
(globalThis as any).__quinki_sendNotification = sendNotification;

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
  readAgentPrompt: "readAgentPrompt",
  getAgentConfig: "getAgentConfig",
  getGlobalConfig: "global_config",
};

// === PiBridge instance ===
let piBridge: PiBridge | null = null;
// === BOOT QUEUE (29 ago): le RPC arrivate durante il boot (piBridge null) NON
// si buttano: si bufferizzano e si processano tutte appena il boot finisce.
const pendingBootLines: string[] = [];
function flushBootQueue() {
  if (pendingBootLines.length === 0) return;
  const q = pendingBootLines.splice(0);
  process.stderr.write(`[boot-queue] flushing ${q.length} RPC buffered during boot
`);
  for (const line of q) { try { handleLine(line); } catch {} }
}
const agentDir = process.env.QUINKI_AGENT_DIR || path.join(homedir(), ".pi", "agent");

// Agente di default per le nuove chat: defaultAgentId dal config globale, fallback "quinki".
function readDefaultAgentId(): string {
  try {
    const gcf = fs.existsSync(path.join(agentDir, "quinki-global.json"))
      ? path.join(agentDir, "quinki-global.json")
      : path.join(agentDir, "dashboard-global.json");
    if (fs.existsSync(gcf)) {
      const cfg = JSON.parse(fs.readFileSync(gcf, "utf8"));
      if (cfg.defaultAgentId) return String(cfg.defaultAgentId);
    }
  } catch {}
  return "quinki";
}
const authPath = path.join(agentDir, "auth.json");
const modelsPath = path.join(agentDir, "models.json");
const attachmentsDir = path.join(agentDir, "quinki-attachments");
const settingsFile = path.join(agentDir, "quinki-settings.json");
const agentsDir = path.join(agentDir, "agents");
const globalConfigFile = fs.existsSync(path.join(agentDir, "quinki-global.json"))
  ? path.join(agentDir, "quinki-global.json")
  : path.join(agentDir, "dashboard-global.json");
// === A2.1: ExecutionEngine (task autonomi, fondamentale H24) ===
const executor = new ExecutionEngine();
executor.onUpdate = (payload) => { try { sendNotification("execution_update", payload); } catch {} };
executor.onNotification = (entry) => { try { piBridge?.appendNotification?.(entry); } catch {} };
// === A3: broadcast notifiche al frontend (chat message / task complete) ===

// === A2.2: Scheduler (programmazione compiti, catch-up "si fa comunque in ritardo") ===
const scheduler = new Scheduler(agentDir, executor);
const longHorizon = new LongHorizon(agentDir);
scheduler.setLogger((tag, data) => { try { piBridge?.logDebug?.(tag, data); } catch {} });
scheduler.onNotify = (payload) => { try { sendNotification("schedule_update", payload); } catch {} };
longHorizon.setLogger((tag, data) => { try { piBridge?.logDebug?.(tag, data); } catch {} });
longHorizon.onNotify = (payload) => { try { sendNotification("longhorizon_update", payload); } catch {} };

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
    // Ogni chat nasce con ALMENO un agente: quello passato, oppure il default (config → quinki)
    const defaultAgentId = readDefaultAgentId();
    const agentId = p.agentId || (defaultAgentId ? defaultAgentId : null);
    if (agentId) {
      piBridge!.setAgent(key, String(agentId));
      piBridge!.setChatAgents(key, String(agentId));
    }
    if (p.model) await piBridge!.setModel(key, p.model);
    if (p.thinkingLevel) piBridge!.setThinkingLevel(key, p.thinkingLevel);
    if (p.mode) piBridge!.setMode(key, String(p.mode));
    if (p.workingDir) await piBridge!.setWorkingDir(key, p.workingDir);
    if (typeof p.compactionAuto === "boolean") {
      piBridge!.setSessionCompaction(key, p.compactionAuto, typeof p.compactionThreshold === "number" ? p.compactionThreshold : 80);
    }
    const meta = piBridge!.getSessionMeta(key);
    piBridge!.logDebug("session-created", { sessionKey: key, label: p.label, agentId: p.agentId || "pi", model: meta.model, thinkingLevel: meta.thinkingLevel, mode: meta.mode });
    return { key, label: s.label, agentId: agentId || "pi", model: meta.model, thinkingLevel: meta.thinkingLevel, compactionAuto: p.compactionAuto, compactionThreshold: p.compactionThreshold };
  },
  ensureSession: async (p) => {
    // Crea l'entry della sessione se non esiste (idempotente: se esiste già, ritorna quella).
    // Usato dall'Expert (chiave fissa __app_expert__) che NON passa da createSession:
    // senza entry, send() esce subito (no msg-in, nessuna risposta).
    const s = piBridge!.create(String(p.sessionKey), p.label || "Chat");
    return { sessionKey: p.sessionKey, label: s.label };
  },
  recoverSession: async (p) => {
    // RPC dal pool-router (main): recupera SUBITO una sessione di cui questo
    // worker è owner (on-open recovery — l'utente ha aperto la chat).
    try {
      const n = await piBridge!.recoverPendingTurns(String(p.sessionKey));
      piBridge!.logDebug("pool-worker-recover-on-open", { sessionKey: p.sessionKey, recovered: n });
      return { recovered: n };
    } catch (e: any) { return { recovered: 0, error: String(e?.message || e) }; }
  },

  renameSession: async (p) => {
    piBridge!.rename(p.sessionKey, p.label);
    piBridge!.logDebug("session-renamed", { sessionKey: p.sessionKey, newLabel: p.label });
    return { sessionKey: p.sessionKey, label: p.label };
  },

  deleteSession: async (p) => {
    try { longHorizon.disable(String(p.sessionKey || '')); } catch {}
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
    // undefined = skip (field not provided), null = clear, string = set
    piBridge!.setAgentOverride(String(p.sessionKey), String(p.agentId), p.model === undefined ? '__skip__' : p.model, p.thinkingLevel === undefined ? '__skip__' : p.thinkingLevel);
    return { ok: true };
  },
  getAgentOverrides: async (p) => {
    const overrides = piBridge!.getAgentOverrides(String(p.sessionKey));
    return { overrides };
  },
  injectErrorExchange: async (p) => {
    piBridge!.injectErrorExchange(String(p.sessionKey), String(p.userMessage || ''), String(p.errorContent || ''), p.timestamp || Date.now());
    return {};
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

  getHistory: async (p) => { const sk = String(p.sessionKey); let recovering = false; try { recovering = fs.existsSync(path.join(agentDir, "sessions", "quinki", sk, "pending-turn.json")); } catch {} try { piBridge!.logDebug("getHistory-recovering-flag", { sessionKey: sk, recovering, hasMarker: recovering }); } catch {} return { sessionKey: p.sessionKey, messages: piBridge!.getHistory(sk, typeof p.limit === "number" ? p.limit : undefined), messageSkills: piBridge!.getMessageSkills(sk), messageTaskClips: piBridge!.getMessageTaskClips(sk), messageAttachments: piBridge!.getMessageAttachments(sk), recovering } },
  // B0.8: pagina precedente della storia + log
  getHistoryBefore: async (p) => ({ sessionKey: p.sessionKey, messages: piBridge!.getHistoryBefore(String(p.sessionKey), Number(p.ts || 0), typeof p.limit === "number" ? p.limit : undefined) }),
  getDebugLogBefore: async (p) => piBridge!.getDebugLogBefore(Number(p.from || 0), typeof p.limit === "number" ? p.limit : undefined),
  // B0.9: search sidecar (chat + log) + salto al match
  searchSessionMessages: async (p) => ({ matches: piBridge!.searchSessionMessages(String(p.sessionKey || ""), String(p.query || ""), typeof p.limit === "number" ? p.limit : undefined) }),
  getHistoryAround: async (p) => ({ sessionKey: p.sessionKey, messages: piBridge!.getHistoryAround(String(p.sessionKey || ""), Number(p.ts || 0), typeof p.limit === "number" ? p.limit : undefined) }),
  searchDebugLog: async (p) => ({ matches: piBridge!.searchDebugLog(String(p.query || ""), typeof p.limit === "number" ? p.limit : undefined) }),
  // === A3: Notifiche ===
  getReadState: async (p) => ({ state: piBridge!.getReadState(String(p.sessionKey || "")) }),
  getAllReadStates: async () => ({ states: piBridge!.getAllReadStates() }),
  setReadState: async (p) => ({ state: piBridge!.setReadState(String(p.sessionKey || ""), p.patch || {}) }),
  setNotifyMode: async (p) => ({ state: piBridge!.setNotifyMode(String(p.sessionKey || ""), String(p.mode || "none")) }),
  getDefaultNotifyMode: async () => ({ mode: piBridge!.getDefaultNotifyMode() }),
  setDefaultNotifyMode: async (p) => ({ mode: piBridge!.setDefaultNotifyMode(String(p.mode || "none")) }),
  getUnreadCounts: async () => ({ counts: piBridge!.getUnreadCounts() }),
  listNotifications: async () => ({ notifications: piBridge!.listNotifications() }),
// FIX P2 #16 (2026-09-08): rimossa RPC orfana _testAppendNotification (test-only, zero references)
  markAllNotificationsRead: async () => ({ ok: piBridge!.markAllNotificationsRead() }),
  get_history: async (p) => handlers.getHistory(p),

  screenshot_response: async (p) => { try { (piBridge as any)?.resolveScreenshotRequest?.(p?.requestId || "", p); } catch {} return { ok: true }; },
  stopStream: async (p) => { if (piBridge && p?.sessionKey) piBridge.abort(p.sessionKey); return { success: true }; },
  sendMessage: async (p) => {
    const sk = String(p.sessionKey);
    const mid = p.messageId || `u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const meta = piBridge!.getSessionMeta(sk);
    piBridge!.logDebug("send-message", { skillNames: p.skillNames || "(none)", attachments: p.attachments || "(none)",
      sessionKey: sk,
      agentId: p.agentId || meta.agentId || "(none)",
      model: p.model || meta.model || "(default)",
      thinking: p.thinkingLevel || meta.thinkingLevel || "off",
      mode: meta.mode || "plan",
      textPreview: (p.text || "").substring(0, 80)
    });
    if (p.model) await piBridge!.setModel(sk, p.model);
    if (p.mode && p.mode !== meta.mode) await piBridge!.setMode(sk, p.mode);
    if (p.thinkingLevel) piBridge!.setThinkingLevel(sk, p.thinkingLevel);
    if (p.workingDir) await piBridge!.setWorkingDir(sk, p.workingDir);
    // === Set agent BEFORE send (single call, no race condition) ===
    if (p.agentId) {
      piBridge!.setAgent(sk, String(p.agentId));
    }
    piBridge!.addUserMsg(sk, p.text, mid);
    process.stderr.write('[SKILL-DEBUG] sendMessage received: skillNames=' + JSON.stringify(p.skillNames) + ' attachments=' + JSON.stringify(p.attachments) + '\n');
    if (p.skillNames && p.skillNames.length > 0) {
      piBridge!.setMessageSkills(sk, mid, p.skillNames, p.text);
    }
    if (p.attachments && p.attachments.length > 0) {
      piBridge!.setMessageAttachments(sk, mid, p.attachments, p.text);
    }
    if (p.taskClips && p.taskClips.length > 0) {
      piBridge!.setMessageTaskClips(sk, mid, p.taskClips, p.text);
    }
    const fakeWs = new FakeWebSocket();
    await piBridge!.send(fakeWs, { sessionKey: sk, text: p.text, files: p.files, workingDirs: p.workingDirs, skillNames: p.skillNames, attachments: p.attachments, taskClips: p.taskClips });
    piBridge!.logDebug("message-sent", { sessionKey: sk, messageId: mid, agent: p.agentId || meta.agentId, model: p.model || meta.model });
    return { messageId: mid, sessionKey: sk };
  },

  // === A4.3: installazione pacchetto tab (manifest + bundle + server opzionale) ===
  // Scrive il pacchetto in ~/.quinki/tabs/<id>/ e carica il back-end (server.js).
  installTabPackage: async (p) => {
    const id = String(p.id || "");
    if (!id) return { ok: false, error: "id required" };
    try {
      const dir = tabDir(id);
      fs.mkdirSync(dir, { recursive: true });
      if (p.manifest) fs.writeFileSync(path.join(dir, "quinki.config.json"), JSON.stringify(p.manifest, null, 2), "utf8");
      if (p.bundle) fs.writeFileSync(path.join(dir, "bundle.js"), String(p.bundle), "utf8");
      if (p.server) fs.writeFileSync(path.join(dir, "server.js"), String(p.server), "utf8");
      const hasServer = reloadTabPlugin(id);
      return { ok: true, id, hasServer };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },

  uninstallTabPackage: async (p) => {
    const id = String(p.id || "");
    if (!id) return { ok: false, error: "id required" };
    try {
      unloadTabPlugin(id);
      fs.rmSync(tabDir(id), { recursive: true, force: true });
      return { ok: true, id };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },

  // === A4.3: installazione pacchetti per le ALTRE categorie (skill/agent/mcp/theme) ===
  // L'app ha già i meccanismi nativi: scriviamo il pacchetto nel posto giusto e la
  // UI nativa lo vede (skill nel pannello Agents, agenti nel pannello Agents, MCP
  // nel registro MCP, temi nel theme picker).
  installPackage: async (p) => {
    const category = String(p.category || "");
    const id = String(p.id || "");
    if (!id || !category) return { ok: false, error: "category and id required" };
    try {
      const manifest = p.manifest || {};
      const files = p.files || {};
      if (category === "skill") {
        const dir = path.join(agentDir, "skills", id);
        fs.mkdirSync(dir, { recursive: true });
        // NB: NIENTE quinki.config.json qui — è un file INTERNO, non va nella cartella
        // dell'utente (il manifest di provenienza vive nel registro market/anti-furto).
        if (files["SKILL.md"]) fs.writeFileSync(path.join(dir, "SKILL.md"), String(files["SKILL.md"]), "utf8");
      } else if (category === "agent") {
        const dir = path.join(agentDir, "agents", id);
        fs.mkdirSync(dir, { recursive: true });
        if (files["config.json"]) fs.writeFileSync(path.join(dir, "config.json"), String(files["config.json"]), "utf8");
        if (files["PROMPT.md"]) fs.writeFileSync(path.join(dir, "PROMPT.md"), String(files["PROMPT.md"]), "utf8");
      } else if (category === "mcp") {
        const r = await handlers.addMcpServer({ id, name: manifest.name || id, type: "url", source: String(files["source"] || "") });
        return r;
      } else if (category === "theme") {
        const dir = path.join(agentDir, "themes", id);
        fs.mkdirSync(dir, { recursive: true });
        if (files["theme.json"]) fs.writeFileSync(path.join(dir, "theme.json"), String(files["theme.json"]), "utf8");
      } else {
        return { ok: false, error: "unknown category: " + category };
      }
      return { ok: true, category, id };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },

  uninstallPackage: async (p) => {
    const category = String(p.category || "");
    const id = String(p.id || "");
    if (!id || !category) return { ok: false, error: "category and id required" };
    try {
      if (category === "skill") fs.rmSync(path.join(agentDir, "skills", id), { recursive: true, force: true });
      else if (category === "agent") fs.rmSync(path.join(agentDir, "agents", id), { recursive: true, force: true });
      else if (category === "mcp") return handlers.removeMcpServer({ id });
      else if (category === "theme") fs.rmSync(path.join(agentDir, "themes", id), { recursive: true, force: true });
      else return { ok: false, error: "unknown category: " + category };
      return { ok: true, category, id };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e) };
    }
  },

  steer: async (p) => {
    piBridge!.steer(new FakeWebSocket(), { sessionKey: String(p.sessionKey), text: p.text });
    return {};
  },

  // === A2.10: injectClip — inietta un messaggio utente nella storia (clip "invia in chat") ===
  injectClip: async (p) => {
    const sk = String(p.sessionKey || "");
    const text = String(p.text || "");
    if (!sk || !text) return { ok: false, error: "sessionKey and text required" };
    const ok = await piBridge!.injectClip(sk, text);
    return { ok, sessionKey: sk };
  },

  compactSession: async (p) => {
    piBridge!.logDebug("compact-session", { sessionKey: p.sessionKey });
    const fakeWs = new FakeWebSocket();
    return piBridge!.compact(String(p.sessionKey), fakeWs);
  },

  getSystemPrompt: async (p) => ({ prompt: getSystemPromptIPC(p.sessionKey) }),

  // A4.3: l'app Expert (sidecar 9183) è in esecuzione? La main NON deve caricare
  // la sessione __app_expert__ (107MB+) se l'Expert è aperto — la sessione vive lì.
  isExpertAlive: async () => ({ alive: isExpertAlive() }),
  // B4 POOL: stato per lo shrink del router (child idle → kill). Innocuo se non usato.
  poolStatus: async () => ({ active: piBridge ? piBridge.getStreamingSessionKeys().length : 0, streaming: piBridge ? (piBridge.getPoolStatus ? piBridge.getPoolStatus().streaming : 0) : 0 }),
  getStreamingSnapshot: async (p) => piBridge!.getStreamingSnapshot(String(p.sessionKey || '')),
  getDelegations: async (p) => ({ delegations: piBridge ? piBridge.getDelegations(String(p.sessionKey || "")) : [] }),
  getStreamingMessage: async (p) => ({ streaming: piBridge ? piBridge.getStreamingMessage(String(p.sessionKey)) : null }),

  getDebugLog: async () => ({ log: piBridge!.getDebugLog() }),
  // B0.1 (S9): monitoring heap (bun:jsc)
  getHeapStats: async () => ({ stats: piBridge ? await piBridge.getHeapStats() : null }),
  getDebugLogSince: async (p) => ({
    ...piBridge!.getDebugLogSince(typeof p.ts === "number" ? p.ts : 0),
  }),

  // === A2.1: Execution engine (task autonomi) ===
  runTask: async (p) => {
    try { executor.setPiBridge(piBridge); } catch {}


    const r = await executor.runTask({
      label: p.label,
      agentIds: p.agentIds,
      workingDir: p.workingDir,
      mode: p.mode,
      model: p.model,
      thinkingLevel: p.thinkingLevel,
      text: String(p.text || ""),
      owner: p.owner === "expert" ? "expert" : "main",
      scheduleId: p.scheduleId,
      scheduledFor: p.scheduledFor,
      keepAwake: !!p.keepAwake,
      sourceSession: p.sourceSession,
      failAfterMs: p.failAfterMs,
    });
    return r;
  },
  listExecutions: async (p) => {
    const all = executor.list();
    const limit = typeof p?.limit === "number" && p.limit > 0 ? p.limit : all.length;
    const offset = typeof p?.offset === "number" && p.offset > 0 ? p.offset : 0;
    return { executions: all.slice(-(offset + limit)).slice(0, limit), total: all.length };
  },
  getExecution: async (p) => ({ execution: executor.get(String(p.executionId)) }),
  getExecutionEvents: async (p) => ({ events: executor.events(String(p.executionId)) }),
  getExecutionMessages: async (p) => ({ messages: executor.messages(String(p.executionId)) }),
  cancelExecution: async (p) => { const r = await executor.cancel(String(p.executionId)); return r; },
  stopExecution: async (p) => { const r = await executor.stop(String(p.executionId)); return r; },
  deleteExecution: async (p) => ({ ...executor.remove(String(p.executionId)) }),
  updateExecution: async (p) => ({ ...executor.updateExecution(String(p.executionId), { model: p.model, thinkingLevel: p.thinkingLevel }) }),
  resumeExecution: async (p) => ({ ...(await executor.resumeExecution(String(p.executionId))) }),
  recoverExecutions: async (p) => ({ ...(await executor.recover(p.autoResume !== false)) }),

  // === A2.2: Scheduler ===
  listSchedules: async () => ({ schedules: scheduler.readSchedules() }),

  // === A2.11: Long Horizon ===
  longHorizonActivate: async (p) => longHorizon.activate(String(p.sessionKey || '')),
  longHorizonDeactivate: async (p) => longHorizon.deactivate(String(p.sessionKey || '')),
  longHorizonResume: async (p) => longHorizon.resume(String(p.sessionKey || '')),
  longHorizonSetPlan: async (p) => longHorizon.setPlan(String(p.sessionKey || ''), String(p.plan || '')),
  longHorizonSetGoal: async (p) => longHorizon.setGoal(String(p.sessionKey || ''), String(p.goal || '')),
  longHorizonSetPhase: async (p) => longHorizon.setPhase(String(p.sessionKey || ''), String(p.phase || '')),
  longHorizonNewDiscussion: async (p) => longHorizon.newDiscussion(String(p.sessionKey || '')),
  injectSystemMessage: async (p) => piBridge!.injectSystemMessage(String(p.sessionKey || ''), String(p.text || '')),
  getLongHorizonState: async (p) => longHorizon.getState(String(p.sessionKey || '')),
  getSessionFiles: async (p) => ({ files: longHorizon.getSessionFiles(String(p.sessionKey || '')) }),
  saveSessionFile: async (p) => longHorizon.saveSessionFile(String(p.sessionKey || ''), String(p.name || ''), String(p.content || '')),
  longHorizonGitLog: async (p) => ({ commits: longHorizon.gitLog(String(p.sessionKey || '')) }),
  longHorizonGitDiff: async (p) => ({ diff: longHorizon.gitDiff(String(p.sessionKey || ''), p.commit) }),
  longHorizonGitRevert: async (p) => longHorizon.gitRevert(String(p.sessionKey || ''), p.commit),
  createSchedule: async (p) => scheduler.createSchedule(p),
  updateSchedule: async (p) => scheduler.updateSchedule(p),
  deleteSchedule: async (p) => scheduler.deleteSchedule(p),
  runScheduleNow: async (p) => ({ ...(await scheduler.runScheduleNow(p)) }),
  debugLog: async (p) => { if (piBridge && p && typeof p.tag === 'string') piBridge.logDebug(p.tag, p.data); return { ok: true }; },
  log_debug: async (p) => handlers.debugLog(p),
  clearDebugLog: async () => { piBridge!.clearDebugLog(); return { log: [] }; },

  // === MCP (Model Context Protocol) ===
  listMcpServers: async () => {
    // Backfill descrizioni per i server package installati prima della feature
    let servers = readMcpServers();
    let changed = false;
    for (const s of servers) {
      if (s.type === 'package' && !s.description) {
        try {
          const ctrl = new AbortController();
          const to = setTimeout(() => ctrl.abort(), 8000);
          const resp = await fetch('https://registry.npmjs.org/' + encodeURIComponent(s.source), { signal: ctrl.signal });
          clearTimeout(to);
          if (resp.ok) {
            const meta = await resp.json();
            if (meta && typeof meta.description === 'string') { s.description = meta.description; changed = true; }
          }
        } catch {}
      }
    }
    if (changed) saveMcpServers(servers);
    return { servers };
  },
  addMcpServer: async (p) => {
    const id = String(p?.id || '').trim();
    const name = String(p?.name || '').trim();
    const type = p?.type === 'url' ? 'url' : p?.type === 'command' ? 'command' : 'package';
    const source = String(p?.source || '').trim();
    const command: string[] = Array.isArray(p?.command) ? p.command.map(String) : (typeof p?.command === 'string' && p.command.trim() ? p.command.trim().split(/\s+/) : []);
    if (!id || !name) return { ok: false, error: 'id and name are required.' };
    if (type !== 'command' && !source) return { ok: false, error: 'Source is required.' };
    if (type === 'command' && command.length === 0) return { ok: false, error: 'Command is required.' };
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) return { ok: false, error: 'Invalid id: use letters, digits, . _ -' };
    let bin: string | undefined;
    if (type === 'package') {
      const r = installPackageServer(id, source);
      if (r.error) return { ok: false, error: r.error };
      bin = r.bin;
    }
    // Descrizione: per package dal registro npm, per url/command generica
    let description = '';
    if (type === 'package') {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch('https://registry.npmjs.org/' + encodeURIComponent(source), { signal: ctrl.signal });
        clearTimeout(to);
        if (resp.ok) {
          const meta = await resp.json();
          if (meta && typeof meta.description === 'string') description = meta.description;
        }
      } catch {}
    } else if (type === 'url') {
      try { const u = new URL(source); description = 'Remote MCP server at ' + u.host; } catch {}
    } else if (type === 'command') {
      description = 'Custom MCP server (' + (command[0] || 'command') + ')';
    }
    const servers = readMcpServers().filter((s) => s.id !== id);
    const server = { id, name, type, source, command: type === 'command' ? command : undefined, args: Array.isArray(p?.args) ? p.args.map(String) : [], env: (p?.env && typeof p.env === 'object') ? p.env : {}, bin, description, planSafe: p?.planSafe === true, createdAt: Date.now() };
    servers.push(server);
    saveMcpServers(servers);
    return { ok: true, server };
  },
  updateMcpServer: async (p) => {
    const id = String(p?.id || '').trim();
    if (!id) return { ok: false, error: 'id is required.' };
    const servers = readMcpServers();
    const s = servers.find((x) => x.id === id);
    if (!s) return { ok: false, error: 'MCP server not found.' };
    if (typeof p?.planSafe === 'boolean') s.planSafe = p.planSafe;
    saveMcpServers(servers);
    return { ok: true, server: s };
  },
  removeMcpServer: async (p) => {
    const id = String(p?.id || '').trim();
    if (!id) return { ok: false, error: 'id is required.' };
    // Rimuovi dai config di tutti gli agenti
    try {
      const agentsDir = path.join(homedir(), '.quinki', 'agents');
      if (fs.existsSync(agentsDir)) {
        for (const dir of fs.readdirSync(agentsDir)) {
          const cfgPath = path.join(agentsDir, dir, 'config.json');
          if (!fs.existsSync(cfgPath)) continue;
          try {
            const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
            if (Array.isArray(cfg.mcpServers) && cfg.mcpServers.includes(id)) {
              cfg.mcpServers = cfg.mcpServers.filter((x) => x !== id);
              fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
            }
          } catch {}
        }
      }
    } catch {}
    // Kill processi attivi e rimozione TOTALE della cartella installata
    killServerProcs(id);
    try { fs.rmSync(mcpInstallDir(id), { recursive: true, force: true }); } catch {}
    // Rimuovi dal registro
    const servers = readMcpServers().filter((s) => s.id !== id);
    saveMcpServers(servers);
    // Pulizia planModeMcp nel global config (evita id orfani)
    try {
      const gcPath = fs.existsSync(path.join(homedir(), '.quinki', 'quinki-global.json'))
        ? path.join(homedir(), '.quinki', 'quinki-global.json')
        : path.join(homedir(), '.quinki', 'dashboard-global.json');
      if (fs.existsSync(gcPath)) {
        const gc = JSON.parse(fs.readFileSync(gcPath, 'utf-8'));
        if (gc && gc.planModeMcp && typeof gc.planModeMcp === 'object') {
          delete gc.planModeMcp[id];
          fs.writeFileSync(gcPath, JSON.stringify(gc, null, 2));
        }
      }
    } catch {}
    piBridge?.logDebug('mcp-removed', { id });
    return { ok: true };
  },

  // === P3: metodi IPC mancanti (settings/providers/attachments/folders/update/preflight) ===
  getSettings: async () => getSettings(),
  // Publish: legge i file di una tab installata (manifest + bundle + server) dal disco
  readTabPackageFiles: async (p) => {
    try {
      const id = String(p?.id || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!id) return { error: 'id required' };
      const dir = tabDir(id);
      const out: any = {};
      const cfgP = path.join(dir, 'quinki.config.json');
      if (fs.existsSync(cfgP)) out.manifest = fs.readFileSync(cfgP, 'utf8');
      const bP = path.join(dir, 'bundle.js');
      if (fs.existsSync(bP)) out.bundle = fs.readFileSync(bP, 'utf8');
      const sP = path.join(dir, 'server.js');
      if (fs.existsSync(sP)) out.server = fs.readFileSync(sP, 'utf8');
      if (!out.manifest && !out.bundle) return { error: 'not found' };
      return out;
    } catch (e: any) { return { error: String(e?.message || e) }; }
  },
  // Publish: legge un tema utente (per pubblicarlo)
  readThemeFile: async (p) => {
    try {
      const id = String(p?.id || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!id) return { error: 'id required' };
      const dir = path.join(agentDir, 'themes', id);
      const f = path.join(dir, 'theme.json');
      if (!fs.existsSync(f)) return { error: 'not found' };
      return { content: fs.readFileSync(f, 'utf8') };
    } catch (e: any) { return { error: String(e?.message || e) }; }
  },
  // INSTRUMENTAZIONE TEST: errori del frontend (React/JS) → file leggibile da remoto
  logFrontendError: async (params: any) => {
    try {
      const fs = require("fs");
      const path = require("path");
      const dir = process.env.QUINKI_AGENT_DIR || require("os").homedir() + "/.quinki";
      const line = JSON.stringify({ ts: Date.now(), kind: String(params?.kind || ""), message: String(params?.message || "").slice(0, 800), stack: String(params?.stack || "").slice(0, 1200) }) + "\n";
      fs.appendFileSync(path.join(dir, "frontend-errors.jsonl"), line, "utf8");
      process.stderr.write("[frontend-error] " + String(params?.kind) + ": " + String(params?.message).slice(0, 150) + "\n");
      return { ok: true };
    } catch { return { ok: false }; }
  },
  getPermissions: async () => piBridge!.getPermissions(),
  setPermissions: async (p) => piBridge!.setPermissions(p || {}),
  setDefaultFallbacks: async (p) => {
    try {
      // NB: usa ~/.quinki (come SETTINGS_FILE di pi-bridge), NON agentDir di sidecar.ts
      const sf = path.join(process.env.QUINKI_AGENT_DIR || path.join(homedir(), ".quinki"), "quinki-settings.json");
      fs.mkdirSync(path.dirname(sf), { recursive: true });
      let existing: any = {};
      if (fs.existsSync(sf)) { try { existing = JSON.parse(fs.readFileSync(sf, "utf8")); } catch { existing = {}; } }
      existing.defaultFallbackModels = Array.isArray(p?.models) ? p.models.filter(Boolean).slice(0, 8) : [];
      fs.writeFileSync(sf, JSON.stringify(existing, null, 2), "utf8");
      return { success: true };
    } catch (e: any) { return { success: false, error: String(e?.message || e) }; }
  },
  setSettings: async (p) => {
    // FIX: writeSettings non era definito qui (bug: la RPC falliva sempre).
    // Usiamo la stessa logica merge di saveSettings (funzionante).
    try {
      const sf = path.join(agentDir, "quinki-settings.json");
      fs.mkdirSync(path.dirname(sf), { recursive: true });
      let existing: any = {};
      if (fs.existsSync(sf)) {
        try { existing = JSON.parse(fs.readFileSync(sf, "utf8")); } catch { existing = {}; }
      }
      const merged = { ...existing, ...(p || {}) };
      fs.writeFileSync(sf, JSON.stringify(merged, null, 2), "utf8");
      return { success: true };
    } catch (e: any) {
      return { success: false, error: String(e?.message || e) };
    }
  },
  saveSettings: async (p) => {
    try {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      let existing: any = {};
      if (fs.existsSync(settingsFile)) {
        try { existing = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch { existing = {}; }
      }
      const merged = { ...existing, ...(p || {}) };
      // NB: NESSUN merge union qui. Il frontend salva il SUO stato completo (as-is):
      // l'ultimo salvataggio vince, così le ELIMINAZIONI restano (repo rimossi, item
      // disinstallati non ricompaiono). Il ripristino (restore) fa il merge sul
      // localStorage del client, non qui.
      fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2), "utf8");
      return { success: true };
    } catch (e: any) {
      process.stderr.write(`[settings] save failed: ${e.message}\n`);
      return { success: false, error: e.message };
    }
  },

  // GitHub OAuth DEVICE FLOW — le API di GitHub NON hanno CORS, quindi il browser
  // non può chiamarle: le chiama il sidecar (bun, niente CORS).
  openExternal: async (p) => {
    try { spawn("open", [String(p?.url || '')]).unref(); return { ok: true }; }
    catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
  publishedGet: async () => {
    try {
      const p = path.join(homedir(), '.quinki', 'published.json');
      if (!fs.existsSync(p)) return { list: [] };
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { list: Array.isArray(d?.list) ? d.list : [] };
    } catch (e: any) { return { list: [] }; }
  },
  publishedSet: async (p) => {
    try {
      const dir = path.join(homedir(), '.quinki');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'published.json'), JSON.stringify({ list: Array.isArray(p?.list) ? p.list : [] }, null, 2));
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
  tutorialGet: async () => {
    try {
      const p = path.join(homedir(), '.quinki', 'tutorial.json');
      if (!fs.existsSync(p)) return {};
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return {}; }
  },
  tutorialSet: async (p) => {
    try {
      const dir = path.join(homedir(), '.quinki');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'tutorial.json'), JSON.stringify(p || {}, null, 2));
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
  githubTokenGet: async () => {
    try {
      const p = path.join(homedir(), '.quinki', 'github-auth.json');
      if (!fs.existsSync(p)) return { token: '' };
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { token: String(d?.token || '') };
    } catch (e: any) { return { token: '' }; }
  },
  githubTokenSet: async (p) => {
    try {
      const dir = path.join(homedir(), '.quinki');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'github-auth.json'), JSON.stringify({ token: String(p?.token || '') }, null, 2));
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
  githubTokenClear: async () => {
    try {
      const p = path.join(homedir(), '.quinki', 'github-auth.json');
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
  githubOAuthStart: async (p) => {
    try {
      const st = (globalThis as any).__quinki_oauth_state || {};
      st.token = ""; st.pending = true; st.error = "";
      const url = "https://github.com/login/oauth/authorize?client_id=Ov23liskJJuKGs1NAsON&redirect_uri=http%3A%2F%2Flocalhost%3A9182%2Fcallback&scope=repo+workflow&prompt=select_account";
      try { spawn("open", [url]).unref(); } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
      return { ok: true };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },
  githubOAuthStatus: async () => {
    const st = (globalThis as any).__quinki_oauth_state || {};
    return { token: st.token || "", pending: !!st.pending, error: st.error || "" };
  },
  githubDeviceCode: async (p) => {
    try {
      const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: String(p?.clientId || ''), scope: String(p?.scope || 'repo') }),
      });
      const data = await res.json().catch(() => ({}));
      return data;
    } catch (e: any) { return { error: String(e?.message || e) }; }
  },
  githubDevicePoll: async (p) => {
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: String(p?.clientId || ''),
          device_code: String(p?.deviceCode || ''),
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const data = await res.json().catch(() => ({}));
      return data;
    } catch (e: any) { return { error: String(e?.message || e) }; }
  },
  setMarketCatalog: async (p) => {
    try { (globalThis as any).__quinki_market_catalog = Array.isArray(p?.items) ? p.items : []; return { ok: true } }
    catch (e: any) { return { ok: false, error: String(e?.message || e) } }
  },
  getAppVersion: async () => ({ version: getAppVersion() }),
  recoverPendingTurns: async () => {
    try {
      const n = await piBridge!.recoverPendingTurns();
      return { recovered: n };
    } catch (e: any) { return { recovered: 0, error: String(e?.message || e) }; }
  },
  getSidecarVersion: async () => {
    try {
      const p = path.join(path.dirname(process.execPath), "version.txt");
      if (fs.existsSync(p)) return { version: fs.readFileSync(p, "utf8").trim() };
    } catch {}
    return { version: "unknown" };
  },

  getProvidersConfig: async () => getProvidersConfig(),
  setProvidersConfig: async (p) => setProvidersConfig(p),
  renameProvider: async (p) => renameProvider(String(p.oldName), String(p.newName)),
  deleteProvider: async (p) => deleteProvider(String(p.name)),
  openRouterLogin: async () => openRouterLogin(),
  openRouterLogout: async () => openRouterLogout(),
  // === Subscription OAuth providers (2026-09-08): Anthropic, OpenAI, GitHub Copilot, xAI ===
  subscriptionLogin: async (p) => subscriptionProviderLogin(String(p?.providerId || "")),
  subscriptionLogout: async (p) => subscriptionProviderLogout(String(p?.providerId || "")),
  subscriptionStatus: async (p) => subscriptionProviderStatus(String(p?.providerId || "")),
  subscriptionRefresh: async (p) => subscriptionProviderRefresh(String(p?.providerId || "")),
  subscriptionGetApiKey: async (p) => ({ apiKey: await subscriptionProviderGetApiKey(String(p?.providerId || "")) }),
  fetchProviderModels: async (p) => fetchProviderModelsIPC(p.providerName, p.baseUrl, p.apiKey),
  testProviderConnection: async (p) => testProviderConnectionIPC(p.providerName, p.baseUrl, p.apiKey),
  getProviderApiKey: async (p) => ({ apiKey: getProviderApiKeyIPC(p.providerName) }),
  setSessionFallbacks: async (p) => piBridge!.setSessionFallbacks(String(p.sessionKey || ''), Array.isArray(p.models) ? p.models : []),
  ollamaCloudStatus: async () => ({ set: ollamaCloudKeySet() }),
  setOllamaCloudKey: async (p) => {
    if (!p || !p.key || typeof p.key !== "string" || p.key.trim().length < 8) return { ok: false, error: "invalid key" };
    setOllamaCloudKey(p.key.trim());
    return { ok: true };
  },
  clearOllamaCloudKey: async () => { clearOllamaCloudKey(); return { ok: true }; },
  getOllamaCloudUsage: async () => await getOllamaCloudUsage(),
  ollamaInstalled: async () => await ollamaInstalled(),
  ollamaInstall: async () => await ollamaInstall(),
  ollamaInstallStatus: async () => ollamaInstallStatus(),
  getProviderUsage: async (p) => {
    const name = String(p.providerName || "").toLowerCase();
    try {
      const cfg = readProvidersConfig();
      const prov = (cfg.providers as any)[name === "ollama" ? "Ollama" : (name === "openrouter" ? "OpenRouter" : p.providerName)];
      if (!prov) return { ok: false, error: "provider not found" };
      if (name === "openrouter") {
        if (!prov.apiKey) return { ok: false, error: "no api key" };
        return await getOpenRouterUsage(prov.apiKey);
      }
      if (name === "ollama") {
        return await getOllamaUsage(prov.baseUrl);
      }
      // Provider custom OpenAI-compatibile: prova l'endpoint usage se c'è la chiave
      if (prov.apiKey) {
        try {
          const base = String(prov.baseUrl || "").replace(/\/$/, "");
          const kr = await fetch(`${base}/auth/key`, { headers: { Authorization: `Bearer ${prov.apiKey}` } });
          if (kr.ok) { const kd = await kr.json(); return { ok: true, usage: kd?.data ?? null, credits: null, provider: name }; }
          const ur = await fetch(`${base}/usage`, { headers: { Authorization: `Bearer ${prov.apiKey}` } });
          if (ur.ok) return { ok: true, usage: await ur.json(), credits: null, provider: name };
        } catch {}
      }
      return { ok: false, error: "unsupported provider for usage" };
    } catch (e: any) { return { ok: false, error: String(e?.message || e) }; }
  },

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

  saveUiState: async (p) => {
    try {
      const f = path.join(homedir(), '.quinki', 'ui-state.json');
      fs.mkdirSync(path.join(homedir(), '.quinki'), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(p.state || {}, null, 2), 'utf-8');
      return { success: true };
    } catch (e: any) {
      process.stderr.write(`[ui-state] save failed: ${e.message}\n`);
      return { success: false, error: e.message };
    }
  },
  getUiState: async () => {
    try {
      const f = path.join(homedir(), '.quinki', 'ui-state.json');
      if (!fs.existsSync(f)) return {};
      return JSON.parse(fs.readFileSync(f, 'utf-8'));
    } catch (e: any) {
      process.stderr.write(`[ui-state] load failed: ${e.message}\n`);
      return {};
    }
  },
  getHandoff: async (p) => { try { const f = path.join(homedir(), '.quinki', 'handoffs', String(p.chatKey || '').replace(/[^a-zA-Z0-9_-]/g, '_'), 'handoff.md'); if (!fs.existsSync(f)) return { content: '' }; return { content: fs.readFileSync(f, 'utf8') }; } catch (e: any) { return { content: '', error: e.message }; } },
  saveHandoff: async (p) => { try { const d = path.join(homedir(), '.quinki', 'handoffs', String(p.chatKey || '').replace(/[^a-zA-Z0-9_-]/g, '_')); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'handoff.md'), String(p.content || ''), 'utf8'); return { success: true }; } catch (e: any) { return { success: false, error: e.message }; } },
  getPlan: async (p) => { try { const f = path.join(homedir(), '.quinki', 'handoffs', String(p.chatKey || '').replace(/[^a-zA-Z0-9_-]/g, '_'), 'plan.md'); if (!fs.existsSync(f)) return { content: '' }; return { content: fs.readFileSync(f, 'utf8') }; } catch (e: any) { return { content: '', error: e.message }; } },
  savePlan: async (p) => { try { const d = path.join(homedir(), '.quinki', 'handoffs', String(p.chatKey || '').replace(/[^a-zA-Z0-9_-]/g, '_')); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'plan.md'), String(p.content || ''), 'utf8'); return { success: true }; } catch (e: any) { return { success: false, error: e.message }; } },
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
  deleteSessionsByFolderId: async (p) => {
    try {
      const arr = getSessionsFromFile();
      for (const s of arr) if ((s.folderId ?? null) === p.folderId) longHorizon.disable(String(s.key || ''));
    } catch {}
    return deleteSessionsByFolderIdIPC(p.folderId);
  },
  deleteSessionsByKeys: async (p) => {
    try { for (const k of (p.keys || [])) longHorizon.disable(String(k)); } catch {}
    return deleteSessionsByKeysIPC(p.keys);
  },

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
// FIX P2 #16: rimossa RPC orfana watch_session (stub Flutter legacy, zero references)
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
        await syncModelsJson(readProvidersConfig());
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

// === NDJSON reader su stdin (setup dentro bootSidecar — il top-level è side-effect-free
// così il bundler può includere sidecar.ts come import STATICO nel binario compilato) ===
export async function bootSidecar() {
  let inputBuffer = "";

  process.stdin.setEncoding("utf8");
  // === Die with parent: quando l'app chiude stdin (muore/quit/SIGKILL), il sidecar esce.
  // Previene orphan sidecar che terrebbero il lock su ~/.pi/agent e bloccherebbero il
  // sidecar dell'app al riavvio (dopo "Salva e riavvia" o flutter run dell'Expert).
  // stdin EOF: non uscire (modalita standalone)
  process.stdin.on("close", () => { if (!globalThis.__quinki_combined) { try { process.exit(0); } catch {} } });
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
  // Expose for combined entry mode — SUBITO (come nel vecchio flusso: i globali erano
  // impostati subito dopo bootstrap() NON awaitato). Senza questo, le RPC inviate dal
  // frontend durante il boot vengono DROPPATE (handleLine non ancora registrato) →
  // sessioni/agenti vuoti all'apertura.
  if (typeof globalThis !== 'undefined') {
    (globalThis as any).__quinki_handleLine = handleLine;
    (globalThis as any).__quinki_sendError = sendError;
    (globalThis as any).__quinki_send = (msg: any) => { process.stdout.write(JSON.stringify(msg) + "\n"); };
  }
  await bootstrap();
  // UNIVERSAL THINKING EVOLUTION (29 ago): re-probe dei thinking levels a ogni avvio
  // (costo zero: valore invalido → errore elenca i valori). Se un provider aggiunge
  // un livello nuovo (es. "ultra"), il max si aggiorna da SOLO.
  setTimeout(() => { refreshThinkingCapsEvolution().catch(() => {}); }, 15000);
  // === AUTOPROMPT 2.0 — DRIVER: ogni 30s controlla i marker con nextRetryAt scaduto.
  // La scala sopravvive ai riavvii perché il prossimo orario è scritto sul marker.
  try { setInterval(() => { try { piBridge?.recoverPendingTurns?.().catch(() => {}); } catch {} }, 30000); } catch {}
  // OpenRouter: contesto REALE (top_provider) per TUTTI i modelli, a ogni boot
  setTimeout(() => { try {
    const cfg = readProvidersConfig();
    const orKey = (cfg.providers as any).OpenRouter?.apiKey;
    if (orKey) refreshOpenRouterContextWindows(orKey).catch(() => {});
  } catch {} }, 10000);
}

// Esecuzione diretta (dev/tsx) — il binario compilato usa sidecar-ws.ts → bootSidecar()
try { if ((import.meta as any).main) { bootSidecar(); } } catch {}

async function handleLine(line: string) {
  try {
    const msg = JSON.parse(line);
    const id = msg.id;
    const method = msg.method;
    const params = msg.params || {};
    if (!method) return;

    // === BOOT QUEUE (29 ago — drop RPC durante il boot): handleLine viene
    // registrato SUBITO in bootSidecar, MA piBridge è creato SOLO quando
    // bootstrap() è COMPLETATO (setup pesante: probes, recovery, file).
    // Durante quei secondi ogni RPC toccava piBridge NULL → errore/perso →
    // la promise del frontend restava appesa PER SEMPRE: turno che non
    // partiva mai, 'Running' falso, selezione sessione morta (niente retry).
    // NON si butta MAI una RPC: il buffer viene svuotato a boot finito.
    if (!piBridge && method !== "ping") {
      pendingBootLines.push(line);
      process.stderr.write(`[boot-queue] buffered ${method} (piBridge not ready)
`);
      return;
    }

    // B4: router — RPC per-sessione di un altro pool → al child proprietario
    // NB setSessionCompaction: il worker deve aggiornare la SUA entry (per l'auto-compaction),
    // ma anche il MAIN deve aggiornare la propria (per la UI/sidebar) — esegui entrambi.
    try {
      if (method === "setSessionCompaction" && params?.sessionKey) {
        const localH = handlers[method];
        try { if (localH) localH(params); } catch {}
      }
      // setSessionFallbacks: esegue su MAIN (UI/entry) E sul worker (che processa il turno)
      if (method === "setSessionFallbacks" && params?.sessionKey) {
        const localH2 = handlers[method];
        try { if (localH2) localH2(params); } catch {}
      }
      if (tryRoute(msg)) return;
    } catch {}

    // A4.3: RPC dei plugin delle tab (back-end server.js) — formato "<tabId>:<method>"
    try {
      const pr = await tryHandleTabPluginRpc(method, params);
      if (pr.handled) {
        if (pr.error) { if (id != null) sendError(id, pr.error); }
        else if (id != null) sendResult(id, pr.result);
        return;
      }
    } catch {}

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
    // FIX RAM/perf: ruota il debug log se > 15MB (un file enorme viene letto tutto dalla tab Log)
    try {
      const debugFile = path.join(agentDir, "quinki-debug.log");
      if (fs.existsSync(debugFile)) {
        const s = fs.statSync(debugFile);
        if (s.size > 15 * 1024 * 1024) {
          const old = debugFile + ".old";
          if (fs.existsSync(old)) fs.rmSync(old, { force: true });
          fs.renameSync(debugFile, old);
          process.stderr.write("[sidecar-marker] debug-log-rotated\n");
        }
      }
    } catch {}
    // Agent working dir: configurabile via env, default ~/.quinki/workdir.
    // Il SDK pi-coding-agent legge <cwd>/package.json al boot (project detection);
    // in standalone non c'è, quindi assicuriamo uno stub package.json.
    const workdir = process.env.QUINKI_AGENT_CWD || path.join(homedir(), ".quinki", "workdir");
    fs.mkdirSync(workdir, { recursive: true });
    // === First-run seed: default agents (Orchestrator, Quinki Expert) + app-expert skill ===
    try {
      seedDefaults(agentDir);
      process.stderr.write("[sidecar-marker] seed-defaults-ok\n");
    } catch (e: any) {
      process.stderr.write(`[sidecar-marker] seed-defaults-error: ${e?.message || String(e)}\n`);
    }
    // === FIX 084 BOOT REPAIR (03 set): models.json avvelenato dal vecchio fallback ===
    // `contextWindow || 32768` del sync ha scritto finestre FINTES su modelli enormi
    // (deepseek reale 1310720 → 32768). La 0.78 mascherava (catalogo), la 0.84.x no.
    // Al boot: se trovo entry sospette (32768 esatto su modelli di provider remote),
    // re-synco CON FETCH LIVE (async, non blocca il boot). One-shot: dopo la prima
    // riparazione riuscita il valore giusto resta e il check non trova piu niente.
    try {
      const mj = JSON.parse(fs.readFileSync(path.join(agentDir, "models.json"), "utf8"));
      let suspicious = 0;
      for (const [pn, pv] of Object.entries<any>(mj.providers || {})) {
        for (const m of pv.models || []) {
          if (m?.contextWindow === 32768) suspicious++;
        }
      }
      if (suspicious > 0) {
        process.stderr.write(`[boot-repair] models.json: ${suspicious} entry con contextWindow 32768 sospetto → re-sync live\n`);
        import("./providers").then(async (mod) => {
          try {
            const cfg = readProvidersConfig();
            await mod.syncModelsJson(cfg);
            process.stderr.write("[boot-repair] models.json re-synced con dati live\n");
          } catch (e: any) {
            process.stderr.write(`[boot-repair] fallito: ${e?.message || String(e)}\n`);
          }
        }).catch(() => {});
      }
    } catch {}
    // NON creiamo più uno stub package.json nel workdir. Il Pi SDK non lo richiede
    // (letto solo se esiste, guardato da existsSync/try-catch) — provato dal fatto che
    // chat su cartelle senza package.json (es. progetti Flutter) funzionano. Così il
    // workdir di default resta vuoto e "opera senza directory" non mostra file spuri.
    process.chdir(workdir);
    piBridge = new PiBridge({ cwd: workdir, agentDir });
    setPiBridgeInstance(piBridge);
    (globalThis as any).__quinki_piBridge = piBridge;
    // Boot completato: processa le RPC che erano arrivate a sidecar spento
    flushBootQueue();
    // A4.3: dispatch RPC per il ctx.call dei plugin tab (solo metodi permessi dal manifest)
    (globalThis as any).__quinki_handleRpc = async (method: string, params: any) => {
      const h = handlers[method];
      if (!h) throw new Error(`Unknown method: ${method}`);
      return h(params || {});
    };
    // A4.3: carica i back-end (server.js) delle tab installate
    try { const n = loadAllTabPlugins(); if (n > 0) process.stderr.write(`[sidecar-marker] tab-plugins-loaded: ${n}\n`); } catch (e: any) { process.stderr.write(`[sidecar-marker] tab-plugins-error: ${e?.message || String(e)}\n`); }
    try { executor.setPiBridge(piBridge); } catch {}
    // === B4 POOL: il child è un processo senza scheduler (lo gestisce il main) ===
    const isPoolChild = (() => { const n = parseInt(process.env.QUINKI_POOL_SIZE || "", 10); const i = parseInt(process.env.QUINKI_POOL_INDEX || "0", 10); return Number.isFinite(n) && n > 1 && i > 0; })();
    // FIX POOL (31 ago): espone l'index del pool → #sendToWs sa di essere su un worker
    // e usa __quinki_broadcast (non il socket del router che perde gli eventi)
    (globalThis as any).__quinki_poolIndex = parseInt(process.env.QUINKI_POOL_INDEX || "0", 10) || 0;
    // === B4 POOL: watchdog parent nei CHILD — se il main muore, il child esce
    // (altrimenti restano orfani e occupano la porta → EADDRINUSE al prossimo boot) ===
    if (isPoolChild) {
      // FIX: confronta il ppid ATTUALE con quello ORIGINALE. Se il main muore, il child
      // viene ri-parentato (ppid cambia, spesso a 1) → esce. Il vecchio controllo
      // kill(ppid,0) falliva perché launchd (pid 1) è sempre vivo.
      const origPpid = process.ppid;
      const t = setInterval(() => {
        try {
          if (process.ppid !== origPpid) process.exit(0);
        } catch { process.exit(0); }
      }, 1000);
      try { t.unref?.(); } catch {}
      process.stderr.write(`[sidecar-marker] pool-child-parent-watchdog: ${origPpid}\n`);
    }
    // === A3: broadcast notifiche al frontend (DOPO la creazione di piBridge!) ===
    try { piBridge.setNotificationBroadcast?.((entry: any) => { try { sendNotification("notification", entry); } catch {} }); } catch {}
    try { piBridge.setReadStateBroadcast?.((key: string) => { try { sendNotification("read_state_changed", { sessionKey: key }); } catch {} }); } catch {}


    await piBridge.init();
    // owner.lock: scrive il PID del sidecar (role esplicito, niente porte)
    try { writeSidecarLock(); } catch {}
    // === B4 POOL: il main (pool-0) spawna i child e diventa router ===
    try { initPoolRouter(); } catch (e: any) { process.stderr.write(`[sidecar-marker] pool-router-error: ${e?.message || String(e)}\n`); }
    try { piBridge.startReadStateSync?.(); } catch (e: any) { process.stderr.write(`[sidecar-marker] readstate-sync-error: ${e?.message}
`); }
    piBridge.reloadAndMerge();
    // A2.2: scheduler parte DOPO init (il primo scan è il catch-up al boot)
    // B4: i CHILD del pool NON avviano scheduler/LH/executor (li gestisce SOLO il main)
    if (!isPoolChild) {
      try { scheduler.start(); } catch (e: any) { process.stderr.write(`[sidecar-marker] scheduler-start-error: ${e?.message}\n`); }
      try { executor.startRecovery(true); } catch (e: any) { process.stderr.write(`[sidecar-marker] recovery-start-error: ${e?.message}\n`); }
    } else {
      process.stderr.write(`[sidecar-marker] pool-child: scheduler/executor OFF\n`);
    }
    // FIX (31 ago — DEFINITIVO): Long Horizon su TUTTI i processi del pool.
    // Il crash precedente NON era causato da Long Horizon ma da os.cpus() nel binary
    // compilato (fixato con QUINKI_POOL_SIZE=16 esplicito in start.sh). Ora ogni
    // processo ha il SUO Long Horizon che gestisce SOLO le proprie sessioni:
    // - MAIN: attiva/disattiva (RPC) + support agent per sessioni owner=0
    // - WORKER N: support agent per sessioni owner=N (via #rescan da disco)
    // Killer feature: FUNZIONA SU OGNI SESSIONE, non solo su 1/16.
    try { longHorizon.setPiBridge(piBridge); longHorizon.start(); } catch (e: any) { process.stderr.write(`[sidecar-marker] longhorizon-start-error: ${e?.message}\n`); }
    // A2.2: tool schedule_task degli agenti → crea schedule nel Scheduler
    try { piBridge.setScheduleHandler((p: any) => scheduler.createSchedule(p)); } catch (e: any) { process.stderr.write(`[sidecar-marker] schedule-handler-error: ${e?.message}\n`); }
    try { piBridge.setScheduleCancelHandler((p: any) => scheduler.deleteSchedule(p)); } catch (e: any) { process.stderr.write(`[sidecar-marker] schedule-cancel-handler-error: ${e?.message}\n`); }
    // Recovery session AL BOOT (feature A2 H24): riprende i turni interrotti quando
    // l'app è stata chiusa/uccisa a metà. Il filtro owner (main salta __app_expert__
    // se l'Expert è su; l'Expert fa solo __app_expert__) + la pulizia stale-buffer
    // evitano falsi ripristini (sessioni complete non vengono ri-promptate).
    // NESSUN tick periodico: il recovery scatta SOLO al boot (crash/riavvio) quando il
    // marker pending-turn è presente (turno davvero interrotto). I timer causavano
    // falsi autoprompt (modelli lenti, tool lunghi). Un turno attivo non si tocca mai.
    try { piBridge!.writeExpertTccStatus(); } catch (e: any) { process.stderr.write(`[sidecar-marker] expert-tcc-error: ${e?.message}\n`); }
    try { piBridge!.recoverPendingTurns().then((n: number) => { if (n > 0) process.stderr.write(`[sidecar-marker] pending-turns-recovered: ${n}\n`); }).catch(() => {}); } catch (e: any) { process.stderr.write(`[sidecar-marker] pending-turns-error: ${e?.message}\n`); }
    // NIENTE tick 30s: il re-prompt avviene SOLO dopo i 3 tentativi dell'SDK (in pi-bridge),
    // non a intervalli fissi (causava autoprompt spuri). Il recovery al boot resta per i crash.
    sendNotification("ready", { message: "PiBridge initialized" });
    // === AUTO CAPABILITY REFRESH (2026-09-08): fetch capabilities dal provider
    // a ogni BOOT + ogni 24 ORE. Background, non-blocking. Aggiorna SOLO le
    // capabilities (vision, thinking, contextWindow) — NON tocca i modelli
    // abilitati/disabilitati dall'utente. Funziona per qualsiasi capability
    // presente e FUTURA (il fetch legge quello che il provider espone, senza
    // hardcode). L'invio NON filtra MAI — il provider decide sempre.
    try {
      const refreshCaps = async () => {
        try {
          const cfg = readProvidersConfig();
          let refreshed = 0;
          for (const [name, prov] of Object.entries(cfg.providers)) {
            if (!prov.enabled) continue;
            try {
              const models = await fetchProviderModelsIPC(name, prov.baseUrl || "", "");
              if (Array.isArray(models) && models.length > 0) {
                // Aggiorna SOLO le capabilities nel modelData esistente
                const existing = prov.modelData || [];
                for (const m of models) {
                  const ex = existing.find((e: any) => e.id === m.id);
                  if (ex) {
                    if (m.input && JSON.stringify(m.input) !== JSON.stringify(ex.input || [])) {
                      ex.input = m.input;
                      refreshed++;
                    }
                    if (m.contextWindow && m.contextWindow !== ex.contextWindow) {
                      ex.contextWindow = m.contextWindow;
                    }
                    if (m.reasoning !== undefined && m.reasoning !== ex.reasoning) {
                      ex.reasoning = m.reasoning;
                    }
                  }
                }
                // Salva (solo se qualcosa è cambiato)
                if (refreshed > 0) {
                  writeProvidersConfig(cfg);
                  await syncModelsJson(cfg);
                  process.stderr.write(`[capability-refresh] ${name}: ${refreshed} capabilities updated\n`);
                }
              }
            } catch {}
          }
        } catch {}
      };
      // BOOT: refresh subito (background, non-blocking)
      refreshCaps().catch(() => {});
      // OGNI 24 ORE: re-refresh (background)
      const capInterval = setInterval(() => { refreshCaps().catch(() => {}); }, 24 * 60 * 60 * 1000);
      try { (capInterval as any).unref?.(); } catch {}
      process.stderr.write("[sidecar-marker] capability-auto-refresh: boot + 24h interval\n");
    } catch (e: any) {
      process.stderr.write(`[sidecar-marker] capability-refresh-setup-error: ${e?.message}\n`);
    }
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

