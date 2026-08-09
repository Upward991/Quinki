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
import { readProvidersConfig } from "./providers";
import { decryptString } from "./crypto";
import {
  readProvidersConfig,
  writeProvidersConfig,
  fetchProviderModels,
  testProviderConnection,
  syncModelsJson,
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
const SESSION_FILE = fs.existsSync(path.join(_agentDir, "quinki-sessions.json"))
  ? path.join(_agentDir, "quinki-sessions.json")
  : path.join(_agentDir, "dashboard-sessions.json");
const FOLDERS_FILE = fs.existsSync(path.join(_agentDir, "quinki-folders.json"))
  ? path.join(_agentDir, "quinki-folders.json")
  : path.join(_agentDir, "dashboard-folders.json");
const SETTINGS_FILE = fs.existsSync(path.join(_agentDir, "quinki-settings.json"))
  ? path.join(_agentDir, "quinki-settings.json")
  : path.join(_agentDir, "dashboard-settings.json");
const CONTEXT_USAGE_FILE = fs.existsSync(path.join(_agentDir, "quinki-context-usage.json"))
  ? path.join(_agentDir, "quinki-context-usage.json")
  : path.join(_agentDir, "dashboard-context-usage.json");
const ERRORS_FILE = path.join(_agentDir, "quinki-errors.json");
const DEBUG_LOG_FILE = path.join(_agentDir, "quinki-debug.log");
const DEBUG_LOG_MAX = 50000;
const SESSION_BASE = path.join(_agentDir, "sessions", "quinki");

function makeBackup() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const backupPath = `${SESSION_FILE}.bak-${ts}`;
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(SESSION_FILE, backupPath);
      }
    }
  } catch {}
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
  workingDir?: string;
  messageSkills?: Record<string, { agentId: string; skillName: string; agentName?: string }[]>;
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

class PiBridge {
  #sdk: any = null;
  #entries = new Map<string, SessionEntry>();
  #firstUserText = new Map<string, string>(); // primo msg utente per auto-title
  #active = new Map<string, any>();
  #mcpClients = new Map<string, StdioMcpClient>();  // chiave `${sessionKey}:${serverId}`
  #mcpToolNames = new Map<string, { name: string; serverId: string }[]>();  // per sessione: tool MCP per applyMode (plan/build)
  #wss = new Map<string, any>();
  #unsubs = new Map<string, () => void>();
  #prompts = new Map<string, Promise<void>>();
  #pendingModels = new Map<string, string>();
  #pendingThinking = new Map<string, string>();
  #pendingMode = new Map<string, string>();
  #cwdOverride = new Map<string, string>();
  #pendingDelegationSkills = new Map<string, { agentId: string; skillName: string }[]>();
  #pendingDelegationAttachments = new Map<string, { originalName: string; path: string; uuid: string; size?: number }[]>();  // override cwd per cambio dir mid-sessione
  // === Multi-window streaming buffer: traccia il messaggio in streaming per sessione ===
  // Permette alle nuove finestre di recuperare il contenuto parziale quando aprono durante la generazione
  #streamingBuffers = new Map<string, { text: string; thinking: string; toolCalls: any[]; currentPhase: string | null; messageId: string | null; model: string | null; provider: string | null; stopReason: string | null; thinkingLevel: string | null; }>();
  #lastEffectiveCwd = new Map<string, string>();  // ultimo effectiveCwd per sessione (per delega)
  #skillsMtime = new Map<string, number>();  // mtime .pi/skills/ al session-create (auto-reload skill, history preservata)
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
    this.#loadOllamaBaseUrl();
    // === Inizializza ModelRegistry di Pi SDK: stessa fonte di model.contextWindow usata dalle chat attive ===
    try {
      const authPath = path.join(this.#agentDir, "auth.json");
      const modelsPath = path.join(this.#agentDir, "models.json");
      this.#modelRegistry = this.#sdk.ModelRegistry.create(
        this.#sdk.AuthStorage.create(authPath),
        modelsPath
      );
      this.logDebug("model-registry-initialized", { authPath, modelsPath });
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
      const data: SessionEntry[] = [];
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
          messageAttachments: (v as any).messageAttachments,
        });
      }
      // === MERGE (due sidecar main/Expert condividono lo stesso file) ===
      // Prima #save sovrascriveva TUTTO → una app cancellava le sessioni (e agenti/
      // workingDir) dell'altra ad ogni salvataggio. Ora uniamo le entry del disco
      // che non conosciamo in memoria (es. create dall'altra app).
      try {
        if (fs.existsSync(SESSION_FILE)) {
          const disk = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
          const known = new Set(data.map((d: any) => d.key));
          for (const d of Array.isArray(disk) ? disk : []) {
            if (d && d.key && !known.has(d.key)) {
              data.push(d);
              known.add(d.key);
            }
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
    makeBackup();
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
        for (const s of data) {
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
              if (!e.agentId && meta.agentIds) e.agentId = meta.agentIds;
              if (!e.workingDir && meta.workingDir) e.workingDir = meta.workingDir;
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
    const out = [...this.#entries.values()].map((s: any) => ({
      key: s.key, label: s.label, agentId: s.agentId || "pi",
      model: s.model, thinkingLevel: s.thinkingLevel, mode: s.mode,
      lastActivity: s.lastActivity, order: s.lastActivity,
    }));

    try {
      if (fs.existsSync(SESSION_BASE)) {
        const dirs = fs.readdirSync(SESSION_BASE, { withFileTypes: true }).filter((d: fs.Dirent) => d.isDirectory());
        const existing = new Set(out.map((s: any) => s.key));
        for (const d of dirs) {
          if (d.name.startsWith("__delegate_")) continue; // skip temp delegation sessions
          if (!existing.has(d.name)) {
            const files = fs.readdirSync(path.join(SESSION_BASE, d.name)).filter((f: string) => f.endsWith(".jsonl"));
            if (files.length > 0) {
              try {
                const orphanLabel2 = this.#readLabelFromJsonl(d.name);
                this.#entries.set(d.name, { key: d.name, label: orphanLabel2, createdAt: Date.now(), lastActivity: Date.now(), order: Date.now(), compactionAuto: true, compactionThreshold: 80, model: undefined as any, thinkingLevel: undefined as any, mode: "plan" } as any);
                this.#save();
              } catch {}
              const orphanLabelOut2 = this.#readLabelFromJsonl(d.name);
              out.push({ key: d.name, label: orphanLabelOut2, agentId: "pi", model: undefined as any, thinkingLevel: undefined as any, lastActivity: Date.now(), order: Date.now() });
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
    const out = [...this.#entries.values()].map((s: any) => {
      const c = compactionByKey.get(s.key);
      return {
        key: s.key, label: s.label, agentId: s.agentId || "pi",
        model: s.model, thinkingLevel: s.thinkingLevel, mode: s.mode,
        lastActivity: s.lastActivity, order: orderByKey.get(s.key) ?? s.lastActivity,
        folderId: folderByKey.get(s.key) ?? null,
        compactionAuto: c?.compactionAuto,
        compactionThreshold: c?.compactionThreshold,
      };
    });

    try {
      if (fs.existsSync(SESSION_BASE)) {
        const dirs = fs.readdirSync(SESSION_BASE, { withFileTypes: true }).filter((d: fs.Dirent) => d.isDirectory());
        const existing = new Set(out.map((s: any) => s.key));
        for (const d of dirs) {
          if (d.name.startsWith("__delegate_")) continue; // skip temp delegation sessions
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
              out.push({ key: d.name, label: orphanLabelOut, agentId: "pi", model: undefined as any, thinkingLevel: undefined as any, lastActivity: Date.now(), order: orderByKey.get(d.name) ?? Date.now(), folderId: folderByKey.get(d.name) ?? null, compactionAuto: c?.compactionAuto, compactionThreshold: c?.compactionThreshold });
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
    const id = m.id || `m-${Date.now()}${Math.random().toString(36).slice(2, 4)}`;
    const role = m.role || "assistant";
    const ts = typeof m.timestamp === "number" ? m.timestamp : Date.now();
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
      return [{ id, role: "delegation", agentName: dd.agentName || "agent", delegatedMessage: dd.delegatedMessage || "", content: dd.content || [], model: dd.model || "", thinkingLevel: dd.thinkingLevel || "", timestamp: ts, done: true }];
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
      out.push({ id, role: "assistant", content: "", reasoning: reasoning || undefined, timestamp: ts, done: true, thinkingLevel: savedThinking || thinkingLevel, agentName, isError: !!(m as any).isError });
    }
    return out;
  }

  #extractReasoning(blocks: any[]): string {
    return blocks.filter((b: any) => b.type === "thinking" && typeof b.thinking === "string").map((b: any) => b.thinking).join("");
  }

  getHistory(key: string) {
    const pi = this.#active.get(key);
    const sessionEntry = this.#entries.get(key);
    const tlvl = sessionEntry?.thinkingLevel;
    // === Detect noop compactions: compaction entries with same firstKeptEntryId as previous ===
    const detectNoopCompactions = (sm: any): Set<number> => {
      const noopTs = new Set<number>();
      try {
        const ents = sm?.getEntries?.() || [];
        // Trova l'indice del primo messaggio
        let firstMsgIdx = -1;
        for (let i = 0; i < ents.length; i++) {
          if ((ents[i] as any)?.type === "message") { firstMsgIdx = i; break; }
        }
        let prevFirstKept: string | undefined;
        for (const e of ents) {
          if ((e as any)?.type === "compaction") {
            const ts = new Date((e as any).timestamp).getTime();
            const firstKept = (e as any).firstKeptEntryId;
            // Check 1: stesso firstKeptEntryId della compaction precedente
            if (prevFirstKept && firstKept === prevFirstKept) {
              noopTs.add(ts);
            }
            // Check 2: firstKeptEntryId è il primo messaggio (niente da riassumere)
            else if (firstMsgIdx >= 0 && ents[firstMsgIdx] && firstKept === ents[firstMsgIdx].id) {
              noopTs.add(ts);
            }
            prevFirstKept = firstKept;
          }
        }
      } catch {}
      return noopTs;
    };
    // === Map messages, marking noop compactions as warnings ===
    const mapWithNoop = (messages: any[], noopTs: Set<number>) => {
      return messages.flatMap((m: any) => {
        if (m.role === "compactionSummary" && noopTs.has(m.timestamp)) {
          return [{ id: m.id || `m-${Date.now()}`, role: "assistant", content: "⚠️ **Compaction non efficace**: La conversazione è troppo corta o i messaggi sono troppo grandi per essere compattati.\\n\\nIl contesto non è stato ridotto. Considera di iniziare una nuova chat se il contesto è pieno.", timestamp: m.timestamp, done: true, isCompactionWarning: true }];
        }
        return this.#mapMessage(m, tlvl, key);
      });
    };
    // === Raccogli tutte le compaction entries dal disco per la persistenza dei toggle ===
    const collectAllCompactionMessages = (sm: any, noopTs: Set<number>): any[] => {
      const result: any[] = [];
      try {
        const ents = sm?.getEntries?.() || [];
        const compactionEntries = ents.filter((e: any) => e?.type === "compaction");
        // Prendi TUTTE le compaction entries (non length-1). Le compaction da buildSessionContext()
        // verranno filtrate dal mapped per evitare duplicati.
        for (let i = 0; i < compactionEntries.length; i++) {
          const e = compactionEntries[i];
          const ts = new Date(e.timestamp).getTime();
          if (noopTs.has(ts)) {
            result.push({ id: e.id || `comp-${i}`, role: "assistant", content: "⚠️ **Compaction non efficace**: La conversazione è troppo corta o i messaggi sono troppo grandi per essere compattati.\\n\\nIl contesto non è stato ridotto. Considera di iniziare una nuova chat se il contesto è pieno.", timestamp: ts, done: true, isCompactionWarning: true });
          } else {
            result.push({ id: e.id || `comp-${i}`, role: "assistant", content: e.summary || "", timestamp: ts, done: true, isCompactionSummary: true });
          }
        }
      } catch {}
      return result;
    };
    if (pi?.sessionManager) {
      try {
        const ctx = pi.sessionManager.buildSessionContext();
        if (ctx?.messages) {
          const noopTs = detectNoopCompactions(pi.sessionManager);
          const prevCompactions = collectAllCompactionMessages(pi.sessionManager, noopTs);
                              const mapped = mapWithNoop(ctx.messages, noopTs).filter((m: any) => !m.isCompactionSummary && !m.isCompactionWarning);
          // Prepend le compaction precedenti, ordinate per timestamp
          const errs = (this.#errors.get(key) || []).map((er: any, i: number) => ({ id: `err-${i}-${er.timestamp}`, role: "assistant", content: "", errorContent: er.errorMessage, isError: true, timestamp: er.timestamp, done: true, model: er.model, agentName: er.agentName, thinkingLevel: er.thinkingLevel }));
          const allSorted1 = [...prevCompactions, ...mapped, ...errs].sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
          return allSorted1.slice(-200);
        }
      } catch {}
    }
    try {
      const dir = this.#piSessionDir(key);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".jsonl"));
        if (files.length > 0) {
          const sm = this.#sdk.SessionManager.open(path.join(dir, files[0]), dir, this.#cwd);
          const ctx = sm.buildSessionContext();
          if (ctx?.messages) {
            const noopTs = detectNoopCompactions(sm);
            const prevCompactions = collectAllCompactionMessages(sm, noopTs);
                                    const mapped = mapWithNoop(ctx.messages, noopTs).filter((m: any) => !m.isCompactionSummary && !m.isCompactionWarning);
            const errs = (this.#errors.get(key) || []).map((er: any, i: number) => ({ id: `err-${i}-${er.timestamp}`, role: "assistant", content: "", errorContent: er.errorMessage, isError: true, timestamp: er.timestamp, done: true, model: er.model, agentName: er.agentName, thinkingLevel: er.thinkingLevel }));
            const allSorted2 = [...prevCompactions, ...mapped, ...errs].sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));
            return allSorted2.slice(-200);
          }
        }
      }
    } catch {}
    return [];
  }

  create(key: string, label: string): SessionEntry {
    const existing = this.#entries.get(key);
    if (existing) return existing;
    const dm = pickDefaultModel();
    const dt = dm ? pickDefaultThinkingLevelForModel(dm) : pickDefaultThinkingLevel();
    const now = Date.now();
    // === Fix 3/B5: inizializza compactionAuto leggendo il globale ===
    const globalSettings = readSettings();
    const globalAuto = typeof globalSettings.globalCompactionAuto === "boolean" ? globalSettings.globalCompactionAuto : true;
    const s: SessionEntry = {
      key,
      label: label || "Chat",
      createdAt: now,
      // === Fix 10: lastActivity e order alti per far apparire le nuove chat in cima ===
      lastActivity: now,
      order: now,
      // === Fix 3/B5: inizializza dal globale, NON undefined ===
      compactionAuto: globalAuto,
      compactionThreshold: 80,
      model: dm || undefined,
      thinkingLevel: dt,
      mode: "plan",
    };
    this.#entries.set(key, s);
    this.#save();
    this.#pendingModels.set(key, dm);
    this.#pendingThinking.set(key, dt);
    // === Fix 3/B5: notifica Pi SDK dell'impostazione globale ===
    // Sarà applicata quando la sessione viene attivata (vedi activateSession)
    this.#pendingCompactionAuto.set(key, globalAuto);
    return s;
  }

  rename(key: string, label: string) {
    const s = this.#entries.get(key);
    if (s) { s.label = label; this.#save(); }
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

  remove(key: string) {
    this.#entries.delete(key);
    this.#active.delete(key);
    this.#wss.delete(key);
    this.#unsubs.delete(key);
    this.#prompts.delete(key);
    this.#pendingModels.delete(key);
    this.#pendingThinking.delete(key);
    this.#pendingMode.delete(key);
    this.#save();
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
    return { model, thinkingLevel, availableThinkingLevels, mode, agentId: (s as any)?.agentId, agentOverrides: (s as any)?.agentOverrides || {}, workingDir: this.#cwdOverride.get(key) || '' };
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
    const s = this.#entries.get(key);
    if (s) { s.model = modelId; this.#save(); }
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
      const authStorage = this.#sdk.AuthStorage.create(authPath);
      const registry = this.#sdk.ModelRegistry.create(authStorage, modelsPath);
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
      if (s) { s.thinkingLevel = level; this.#save(); }
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
        ? `Pi SDK will send reasoning_effort=${resolved} to Ollama`
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
        ? `When chat sends, Pi SDK will send reasoning_effort=${translatedOllamaValue} to Ollama`
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
        const authStorage = this.#sdk.AuthStorage.create(authPath);
        const registry = this.#sdk.ModelRegistry.create(authStorage, modelsPath);
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

  #sendToWs(ws: any, payload: any) {
    try {
      if (ws && ws.readyState === ws.constructor.OPEN) ws.send(JSON.stringify(payload));
    } catch {}
  }

  logDebug(tag: string, data: any) {
    try {
      const entry = { ts: Date.now(), tag, data };
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

  setMode(key: string, mode: string) {
    const m = mode === "build" ? "build" : "plan";
    const s = this.#entries.get(key);
    this.logDebug("set-mode", { sessionKey: key, mode: m, entryFound: !!s });
    if (s) { s.mode = m; this.#save(); }
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
      fs.writeFileSync(p, JSON.stringify({ ...cur, ...patch, ts: Date.now() }, null, 2));
    } catch {}
  }

  setChatAgents(key: string, agentIds: string) {
    const s = this.#entries.get(key);
    // Se l'entry non esiste in memoria la salviamo comunque nel meta file (e #load la riporterà)
    if (s) { (s as any).agentId = agentIds || ''; this.#save(); }
    this.#writeChatMeta(key, { agentIds: agentIds || '' });
    this.logDebug("set-chat-agents", { sessionKey: key, agentIds, saved: true });
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
    // Error (assistant) message
    const errEntry = {
      type: "message",
      id: `inj-e-${ts + 1}`,
      parentId: `inj-u-${ts}`,
      timestamp: new Date(ts + 1).toISOString(),
      message: { role: "assistant", content: [{ type: "text", text: errorContent }], isError: true, timestamp: ts + 1 }
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
    return { tools: ["read", "grep", "find", "ls", "skill"], planModeTools: { read: true, grep: true, find: true, ls: true, skill: true, write: false, edit: false, bash: false }, defaultMode: "plan" };
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

  #applyMode(pi: any, key: string, mode: string, workingDirs?: string[], cwd?: string, hasDelegateTool = false) {
    const m = mode === "build" ? "build" : "plan";
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
      const customToolNames = ["delegate_to_agent", "skill"];
      for (const ct of customToolNames) {
        if (merged.includes(ct) && !names.includes(ct)) names.push(ct);
      }
      // Plan mode: remove tools not allowed in plan (but keep custom tools)
      if (m === "plan") {
        const planFlags = globalConfig.planModeTools || {};
        names = names.filter(n => planFlags[n] !== false || customToolNames.includes(n));
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
        base = agentPrompt + `\n\nLavori nella directory: ${effCwd}\n\n` + base;
      }
      if (typeof base === "string" && base.length > 0 && note) {
        // Strip old mode note before adding new one (fix: mode change not detected)
        const planIdx = base.indexOf("\n\nSei in MODALITÀ PIANO");
        const buildIdx = base.indexOf("\n\nSei in MODALITÀ BUILD");
        if (planIdx >= 0) base = base.substring(0, planIdx);
        else if (buildIdx >= 0) base = base.substring(0, buildIdx);
        base = base + note;
      }
      if (typeof base === "string" && base.length > 0) {
        (pi as any)._baseSystemPrompt = base;
        pi.agent.state.systemPrompt = base;
      }
    } catch (e: any) { this.logDebug("apply-mode-prompt-error", { sessionKey: key, error: e?.message }); }
    this.logDebug("apply-mode", { sessionKey: key, mode: m, toolCount: names.length, tools: names });
  }

  #modeNote(mode: string, hasDelegateTool = false): string {
    const m = mode === "build" ? "build" : "plan";
    if (m === "plan") {
      const cfg = this.#readGlobalConfig();
      const planTools = cfg.planModeTools || {};
      const allTools = ["read", "write", "edit", "bash", "grep", "find", "ls", "skill"];
      if (hasDelegateTool) allTools.push("delegate_to_agent");
      const enabled = allTools.filter((t: string) => planTools[t] === true || t === "delegate_to_agent");
      const disabled = allTools.filter((t: string) => planTools[t] !== true && t !== "delegate_to_agent");
      const enabledStr = enabled.length > 0 ? enabled.join(", ") : "nessuno";
      const disabledStr = disabled.length > 0 ? disabled.join(", ") : "nessuno";
      return `\n\nSei in MODALITÀ PIANO (Plan mode). Puoi esplorare liberamente per capire bene il problema. Tool disponibili: ${enabledStr}. Tool NON disponibili: ${disabledStr}. NON tentare di chiamare i tool non disponibili. Collabora con l'utente per creare un PIANO dettagliato e fattibile di come risolvere il problema. Se un'operazione richiede un tool non disponibile, AVVISA l'utente che, dopo aver approvato il piano, deve passare in MODALITÀ BUILD. In Plan mode l'utente vuole la certezza che non fai modifiche senza il suo permesso.`;
    }
    return `\n\nSei in MODALITÀ BUILD. Tutti i tool sono disponibili. Esegui le modifiche necessarie per risolvere il problema. Rispetta le istruzioni e i vincoli dell'utente.`;
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
      return `Sei il **Moderatore**, il coordinatore degli agenti nella chat. L'utente parla direttamente con te.\n\n## Cosa fai\n- Analizzi la richiesta dell'utente\n- Decidi quale agente delegare per ogni task\n- Coordini gli agenti per risolvere il problema\n- Riporti i risultati all'utente\n\n## Regole\n- Non hai skill o tool diretti — solo coordinamento\n- Rispondi in italiano\n- Sii conciso: spiega cosa fai e chi deleghi`;  
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
        base = agentPrompt + `\n\nLavori nella directory: ${this.#cwd}\n\n` + base;
      }
      if (typeof base === "string" && base.length > 0 && note) {
        const planIdx = base.indexOf("\n\nSei in MODALITÀ PIANO");
        const buildIdx = base.indexOf("\n\nSei in MODALITÀ BUILD");
        if (planIdx >= 0) base = base.substring(0, planIdx);
        else if (buildIdx >= 0) base = base.substring(0, buildIdx);
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
        const authStorage = this.#sdk.AuthStorage.create(authPath);
        const registry = this.#sdk.ModelRegistry.create(authStorage, modelsPath);
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
      this.logDebug("agent_llm_config", {
        sessionKey: sk,
        source: "direct",
        agentId: targetId,
        agentName,
        model: actualModel,
        thinkingLevel: actualThinking,
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
    const used = new Set<string>(["skill", "delegate_to_agent"]);
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

  #buildDelegateTool(sessionKey: string): any {
    const self = this;
    return defineTool({
      name: "delegate_to_agent",
      label: "Delega ad agente",
      description: "Delega un task a un agente specifico nella chat. Usa questo tool quando l'utente chiede qualcosa che richiede competenze specifiche di un agente. L'agente riceve il task, lo esegue, e ti ritorna la risposta. Tu poi sintetizzi e riporti all'utente.",
      promptSnippet: "delegate_to_agent: delega un task a un agente specifico nella chat",
      promptGuidelines: [
        "Quando devi delegare un task a un agente, usa il tool delegate_to_agent con il nome dell'agente e il task da svolgere.",
        "Non provare a fare tu il lavoro di un agente specializzato. Delega sempre.",
        "Dopo aver ricevuto la risposta, sintetizza e riportala all'utente.",
      ],
      parameters: Type.Object({
        agent_name: Type.String({ description: "Nome dell'agente a cui delegare (es: Notion, Quinki Expert)" }),
        task: Type.String({ description: "Descrizione del task da assegnare all'agente" }),
      }),
      async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any): Promise<any> {
        const { agent_name, task } = params;
        try {
          self.logDebug("delegate-tool-call", { sessionKey, agent_name, task: task?.substring(0, 200) });
          // Trova l'agente nella sessione
          const sessionEntry = self.#entries.get(sessionKey);
          const sessionAgents = (sessionEntry as any)?.agentId;
          if (!sessionAgents) {
            return { content: [{ type: "text", text: "Errore: nessun agente trovato nella chat." }], isError: true };
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
            return { content: [{ type: "text", text: `Errore: agente "${agent_name}" non trovato nella chat.` }], isError: true };
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
              const authStorage = self.#sdk.AuthStorage.create(authPath);
              const registry = self.#sdk.ModelRegistry.create(authStorage, modelsPath);
              const agentModel = self.#findModelInRegistry(registry, agentModelId);
              if (agentModel) {
                await tempPi.setModel(agentModel);
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
            try { await tempPi.setModel(mainSession.model); } catch {}
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
                base = agentPrompt + `\n\nLavori nella directory: ${tempCwd2}\n\n` + base;
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
            self.logDebug("agent_llm_config", {
              sessionKey,
              source: "delegation",
              agentId: targetId,
              agentName: agent_name,
              model: actualModel,
              thinkingLevel: actualThinking,
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
          return { content: [{ type: "text", text: `Errore durante la delega a ${agent_name}: ${e?.message || String(e)}` }], isError: true };
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
            systemPrompt += `\n\n**Agenti disponibili in questa chat (usa @nome per taggarli):**\n`;
            for (const name of agentNames) {
              systemPrompt += `- @${name}\n`;
            }
            systemPrompt += `\nQuando l'utente fa una richiesta, analizza e delega all'agente più adatto. Se la richiesta è semplice, rispondi tu direttamente.\n`;
            systemPrompt += `\n**Descrizione agenti:**\n`;
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

  #buildSystemPrompt(key: string, cwd: string, workingDirs?: string[], mode?: string, skillNames?: { agentId: string; skillName: string }[], attachments?: { originalName: string; path: string; uuid: string; size?: number }[]): string {
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
    const lead = hasAgent ? "Lavori" : "Sei un assistente che lavora";
    if (workingDirs && workingDirs.length > 0) {
      if (workingDirs.length === 1) {
        prompt += `\n\n${lead} nella directory: ${workingDirs[0]}`;
      } else {
        prompt += `\n\n${lead} nelle seguenti directory:`;
        for (const d of workingDirs) {
          prompt += `\n- ${d}`;
        }
        prompt += `\nLa directory principale (dove i comandi vengono eseguiti) è: ${workingDirs[0]}`;
      }
    } else {
      prompt += `\n\n${lead} nella directory: ${cwd}`;
    }
    // === Plan/Build mode: nota mode-aware (il modello sa in che mode è) ===
    const m = mode === "build" ? "build" : "plan";
    // Check if this agent has delegate_to_agent tool (orchestrator or agent with it in config)
    const hasDelegate = !!(agentId && (agentId === 'orchestrator' || (this.#readAgentConfigFile(agentId)?.tools?.includes('delegate_to_agent'))));
    prompt += this.#modeNote(m, hasDelegate);
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
          prompt += `\n\n**Agenti disponibili in questa chat (usa @nome per taggarli):**\n`;
          for (const name of agentNames) {
            prompt += `- @${name}\n`;
          }
          prompt += `\nQuando l'utente fa una richiesta, analizza e delega all'agente più adatto. Se la richiesta è semplice, rispondi tu direttamente.`;
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

  async send(ws: any, data: { sessionKey: string; text: string; files?: { name: string; type: string; path?: string; data?: string }[]; workingDirs?: string[]; skillNames?: { agentId: string; skillName: string }[]; attachments?: { originalName: string; path: string; uuid: string; size?: number }[] }) {
    const sk = data.sessionKey;
    const s = this.#entries.get(sk);
    if (!s) {
      // Sessione inesistente (es. eliminata ma il frontend ha continuato a mandare) → errore esplicito, MAI silenzio
      this.logDebug("send-no-session", { sessionKey: sk });
      try { ws.send(JSON.stringify({ type: "done", sessionKey: sk, stopReason: "error", errorMessage: "Session not found (deleted?). Start a new chat.", text: "" })); } catch {}
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

    this.#wss.set(sk, ws);
    
    let pi = this.#active.get(sk);
    this.logDebug("send-resolved-agent", { sessionKey: sk, override: this.#agentOverride.get(sk), resolvedAgentId: this.#resolveAgentId(sk), hasActiveSession: !!pi });
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
      if (resolvedAgentId) {
        // Check if the agent has delegate_to_agent in its config tools
        const agentCfg = this.#readAgentConfigFile(resolvedAgentId);
        const isOrchestrator = resolvedAgentId === 'orchestrator';
        const hasDelegateTool = agentCfg?.tools?.includes('delegate_to_agent') || isOrchestrator;
        if (hasDelegateTool) {
          const delegateTool = this.#buildDelegateTool(sk);
          if (delegateTool) customTools.push(delegateTool);
          this.logDebug("delegate-tool-registered", { sessionKey: sk, agentId: resolvedAgentId, isOrchestrator });
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
          const authStorage = this.#sdk.AuthStorage.create(authPath);
          const registry = this.#sdk.ModelRegistry.create(authStorage, modelsPath);
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
      const pendingMode = this.#pendingMode.get(sk);
      const intendedMode = pendingMode || (s ?? this.#entries.get(sk))?.mode || "plan";
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
            const authStorage = this.#sdk.AuthStorage.create(authPath);
            const registry = this.#sdk.ModelRegistry.create(authStorage, modelsPath);
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
          let levelToApply2: string | undefined;
          if (oThink === 'on') {
            const sessionLevel = (() => { try { return pi.thinkingLevel; } catch { return undefined; } })();
            levelToApply2 = (sessionLevel && sessionLevel !== 'off') ? sessionLevel : 'xhigh';
          } else if (oThink === 'off') {
            levelToApply2 = 'off';
          }
          if (levelToApply2) {
            try { pi.setThinkingLevel(levelToApply2); this.logDebug("send-agent-override-thinking", { sessionKey: sk, agentId: resolvedAgentId, requested: oThink, applied: levelToApply2 }); }
            catch (e: any) { this.logDebug("send-agent-override-thinking-error", { sessionKey: sk, error: e?.message }); }
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

    const prev = this.#prompts.get(sk) || Promise.resolve();
    // === Aggiorna system prompt ad ogni messaggio (agenti possono cambiare mid-chat) ===
    try {
      let builtPrompt: string | undefined;
      if (pi.agent?.state) {
        const sessionMode = this.#entries.get(sk)?.mode || "plan";
        builtPrompt = this.#buildSystemPrompt(sk, effectiveCwd, data.workingDirs, sessionMode);
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
            let prompt = this.#buildSystemPrompt(sk, effectiveCwd, data.workingDirs, undefined, skillsForPrompt, data.attachments);
      // When NO skill is attached, add explicit note that previous skills are deactivated
      if (!skillNames) {
      }
      try { (pi as any)._customSystemPromptOverride = true; } catch {}
      try { (pi as any)._baseSystemPrompt = prompt; } catch {}
      pi.agent.state.systemPrompt = prompt;
            // Log system prompt via logDebug (uses existing debug_log flow)
      this.logDebug("system_prompt", { sessionKey: sk, len: prompt.length, hasSkills: !!(skillsForPrompt && skillsForPrompt.length > 0), skills: skillsForPrompt ? skillsForPrompt.map((s: any) => s.skillName) : [], agentId: resolvedAgent || "unknown", agentName: agentCfg?.name || resolvedAgent || "unknown", isDelegation: false, isOrchestrator, messageText: (data.text || "").substring(0, 200), prompt: prompt });
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
      this.logDebug("agent_llm_config", {
        sessionKey: sk,
        source: "main",
        agentId: resolvedAgent || "unknown",
        agentName,
        model: actualModel,
        thinkingLevel: actualThinking,
        chatModel: sEntry?.model || "",
        chatThinking: sEntry?.thinkingLevel || "",
        agentOverrideModel: overrides.model || null,
        agentOverrideThinking: overrides.thinkingLevel || null,
        systemPromptLen: pi?.agent?.state?.systemPrompt?.length || 0,
      });
    }

    const next = prev.then(() => pi.sendUserMessage(content, { deliverAs: "followUp" })).catch((err: Error) => {
      ws.send(JSON.stringify({ type: "error", message: err.message, sessionKey: sk }));
    });
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
    if (!pi) return;
    if (data.text === "/stop") pi.abort();
    else pi.steer(data.text);
  }

  abort(key: string) {
    const pi = this.#active.get(key);
    if (pi) {
      try { pi.abort(); } catch {}
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
    const old = this.#unsubs.get(key);
    if (old) { try { old(); } catch {} }

    const sub = pi.subscribe((e: any) => {
      const ws = this.#wss.get(key);
      if (!ws || ws.readyState !== ws.constructor.OPEN) return;

      switch (e.type) {
        case "agent_start":
          this.#responseTimers.set(key, Date.now());
          ws.send(JSON.stringify({ type: "progress_start", sessionKey: key }));
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "running" });
          // === A5: streaming started event per aggiornare streamingSet nel renderer ===
          this.#sendToWs(ws, { type: "streaming_started", sessionKey: key });
          // === Multi-window: inizializza streaming buffer ===
          this.#streamingBuffers.set(key, { text: "", thinking: "", toolCalls: [], currentPhase: null, messageId: null, model: this.#active.get(key)?.model?.id || null, provider: null, stopReason: null, thinkingLevel: this.#entries.get(key)?.thinkingLevel || null });
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

          ws.send(JSON.stringify({
            type: "stream_event",
            sessionKey: key,
            messageId: e.message?.id,
            eventType: ame.type,
            delta: ame.delta || "",
            toolName,
          }));

          // === Multi-window: aggiorna streaming buffer ===
          const buf = this.#streamingBuffers.get(key);
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
            ws.send(JSON.stringify({
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
              requestedThinkingLevel: requestedThinking,
              reasoningActuallyUsed,
              reasoningLength,
              responseId: e.message.responseId,
              stopReason: e.message.stopReason,
              errorMessage: (e.message as any)?.errorMessage || undefined,
              text: textContent,
              reasoning: reasoningContent,
              usage: (e.message as any)?.usage ?? undefined,
            }));
            // Persisti l'errore in chat (deve ricomparire al reload)
            if (e.message?.stopReason === "error" && (e.message as any)?.errorMessage) {
              this.#saveError(key, { timestamp: Date.now(), errorMessage: (e.message as any).errorMessage, model: actualModel, agentName: doneAgentName, thinkingLevel: actualThinking });
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
          ws.send(JSON.stringify({ type: "typing_stop_broadcast", sessionKey: key }));
          this.#captureSessionMeta(key);
          this.#emitContextUsage(ws, key, "ctx-post-agent-end");
          this.logDebug("agent-end", {
            sessionKey: key,
            finalModel: this.#active.get(key)?.model?.id,
            finalThinking: this.#active.get(key)?.thinkingLevel,
          });
          this.#sendToWs(ws, { type: "agent_status", sessionKey: key, status: "idle" });
          // === A5: streaming stopped event ===
          this.#sendToWs(ws, { type: "streaming_stopped", sessionKey: key });
          // === Multi-window: pulisci streaming buffer ===
          this.#streamingBuffers.delete(key);
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

export function getSessionsFromFile(): any[] {
  try {
    if (!fs.existsSync(SESSION_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    // Il file è scritto come array bare da #save (riga 321). Gestisco entrambi i formati.
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.sessions)) return data.sessions;
    return [];
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

export function getProvidersConfigFull(): ProvidersConfig {
  return readProvidersConfig();
}

export function renameProvider(oldName: string, newName: string): { success: boolean; error?: string } {
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
    syncModelsJson(fullConfig);
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

export function setProvidersConfig(config: any): { success: boolean; error?: string } {
  try {
    const fullConfig: ProvidersConfig = {
      providers: {},
      defaultModel: config.defaultModel || "",
      defaultThinking: config.defaultThinking || "xhigh",
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
    syncModelsJson(fullConfig);
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
    const raw = fs.readFileSync(DEBUG_LOG_FILE, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
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
