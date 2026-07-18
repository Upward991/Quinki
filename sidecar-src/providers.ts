import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { encryptString, decryptString, isEncrypted } from "./crypto";

const agentDir = join(homedir(), ".pi", "agent");
const providersPath = join(agentDir, "quinki-providers.json");
const modelsPath = join(agentDir, "models.json");
const settingsPath = join(agentDir, "settings.json");

export interface ProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  enabledModels: string[];
}

export interface SafeProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  apiKeySet: boolean;
  enabledModels: string[];
}

export interface ProvidersConfig {
  providers: Record<string, ProviderConfig>;
  defaultModel: string;
  defaultThinking: string;
}

export interface SafeProvidersConfig {
  providers: Record<string, SafeProviderConfig>;
  defaultModel: string;
  defaultThinking: string;
}

export interface FetchedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

const DEFAULT_CONFIG: ProvidersConfig = {
  providers: {
    ollama: {
      enabled: true,
      baseUrl: "http://localhost:11434/v1",
      apiKey: "ollama",
      enabledModels: [],
    },
  },
  defaultModel: "",
  defaultThinking: "xhigh",
};

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return key.substring(0, 4) + "••••••••" + key.substring(key.length - 4);
}

export function readProvidersConfig(): ProvidersConfig {
  try {
    if (!existsSync(providersPath)) return structuredClone(DEFAULT_CONFIG);
    const raw = readFileSync(providersPath, "utf8");
    const json = JSON.parse(raw);
    const providers: Record<string, ProviderConfig> = {};
    let needsMigration = false;
    for (const [name, pcfg] of Object.entries(json.providers || {})) {
      const pc = pcfg as any;
      let apiKey = pc.apiKey || "";
      if (apiKey && !isEncrypted(apiKey)) {
        needsMigration = true;
      } else if (isEncrypted(apiKey)) {
        apiKey = decryptString(apiKey);
      }
      providers[name] = {
        enabled: !!pc.enabled,
        baseUrl: pc.baseUrl || "",
        apiKey,
        enabledModels: Array.isArray(pc.enabledModels) ? pc.enabledModels : [],
      };
    }
    if (needsMigration) {
      process.stderr.write("[providers] migrating plaintext apiKeys to encrypted storage...");
      const migrated: ProvidersConfig = {
        providers,
        defaultModel: json.defaultModel || "",
        defaultThinking: json.defaultThinking || "xhigh",
      };
      writeProvidersConfig(migrated);
    }
    return {
      providers,
      defaultModel: json.defaultModel || "",
      defaultThinking: json.defaultThinking || "xhigh",
    };
  } catch (e) {
    process.stderr.write("[providers] readProvidersConfig error:", e);
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function writeProvidersConfig(config: ProvidersConfig): void {
  try {
    const toWrite: any = {
      defaultModel: config.defaultModel,
      defaultThinking: config.defaultThinking,
      providers: {},
    };
    for (const [name, pcfg] of Object.entries(config.providers)) {
      const apiKeyToStore = pcfg.apiKey ? encryptString(pcfg.apiKey) : "";
      toWrite.providers[name] = {
        enabled: pcfg.enabled,
        baseUrl: pcfg.baseUrl,
        apiKey: apiKeyToStore,
        enabledModels: pcfg.enabledModels,
      };
    }
    writeFileSync(providersPath, JSON.stringify(toWrite, null, 2), "utf8");
    // === SICUREZZA: forza permessi restrittivi sul file providers ===
    try { require("fs").chmodSync(providersPath, 0o600); } catch {}
    // === AUDIT LOG: cosa è stato salvato (mai loggare la vera chiave) ===
    const summary = Object.entries(config.providers).map(([name, pcfg]) => ({
      name,
      enabled: pcfg.enabled,
      hasKey: !!pcfg.apiKey,
      modelsCount: pcfg.enabledModels.length,
    }));
    process.stderr.write(`[security-audit] writeProvidersConfig: ${JSON.stringify(summary)}`);
  } catch (e) {
    process.stderr.write("[providers] writeProvidersConfig error:", e);
  }
}

export function getSafeProvidersConfig(): SafeProvidersConfig {
  const full = readProvidersConfig();
  const safeProviders: Record<string, SafeProviderConfig> = {};
  for (const [name, pcfg] of Object.entries(full.providers)) {
    safeProviders[name] = {
      enabled: pcfg.enabled,
      baseUrl: pcfg.baseUrl,
      apiKey: maskApiKey(pcfg.apiKey),
      apiKeySet: !!pcfg.apiKey,
      enabledModels: pcfg.enabledModels,
    };
  }
  return {
    providers: safeProviders,
    defaultModel: full.defaultModel,
    defaultThinking: full.defaultThinking,
  };
}

export async function fetchProviderModels(
  providerName: string,
  baseUrl: string,
  apiKey: string
): Promise<FetchedModel[]> {
  try {
    if (providerName === "ollama") {
      const ollamaUrl = baseUrl.replace(/\/v1\/?$/, "");
      const res = await fetch(`${ollamaUrl}/api/tags`);
      if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
      const data = (await res.json()) as { models: Array<{ name: string; size?: number; details?: { parameter_size?: string; context_length?: number }; capabilities?: string[] }> };

      const models = await Promise.all(
        (data.models || []).map(async (m) => {
          let contextWindow: number | undefined = m.details?.context_length;
          let reasoning = (m.capabilities || []).includes("thinking");

          if (!contextWindow) {
            try {
              process.stderr.write(`[providers] ollama ${m.name}: no details.context_length, trying /api/show...`);
              const showRes = await fetch(`${ollamaUrl}/api/show`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: m.name, verbose: true }),
              });
              if (showRes.ok) {
                const showData = (await showRes.json()) as {
                  model_info?: Record<string, any>;
                  capabilities?: string[];
                };
                process.stderr.write(`[providers] ollama ${m.name}: /api/show keys:`, Object.keys(showData));
                process.stderr.write(`[providers] ollama ${m.name}: /api/show model_info:`, showData.model_info);
                if (showData.capabilities) {
                  reasoning = showData.capabilities.includes("thinking");
                }
                if (showData.model_info) {
                  for (const [key, val] of Object.entries(showData.model_info)) {
                    if (key.endsWith(".context_length") && typeof val === "number") {
                      contextWindow = val;
                      process.stderr.write(`[providers] ollama ${m.name}: found context_length=${val} in ${key}`);
                      break;
                    }
                  }
                }
                if (!contextWindow) {
                  process.stderr.write(`[providers] ollama ${m.name}: no context_length found in /api/show model_info`);
                }
              } else {
                const errText = await showRes.text();
                process.stderr.write(`[providers] ollama ${m.name}: /api/show responded ${showRes.status}: ${errText.substring(0, 200)}`);
              }
            } catch (e: any) {
              process.stderr.write(`[providers] ollama ${m.name}: /api/show error:`, e.message);
            }
          } else {
            process.stderr.write(`[providers] ollama ${m.name}: context_length=${contextWindow} from /api/tags details`);
          }

          return {
            id: m.name,
            name: m.name,
            contextWindow,
            reasoning,
          };
        })
      );

      return models;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const modelsUrl = baseUrl.endsWith("/models")
      ? baseUrl
      : `${baseUrl.replace(/\/+$/, "")}/models`;
    process.stderr.write(`[providers] fetchProviderModels: ${providerName} url=${modelsUrl} hasApiKey=${!!apiKey} keyPrefix=${apiKey.substring(0, 6)}...`);
    const res = await fetch(modelsUrl, { headers });
    process.stderr.write(`[providers] fetchProviderModels: ${providerName} status=${res.status} contentType=${res.headers.get("content-type")}`);
    if (!res.ok) {
      const errText = await res.text();
      process.stderr.write(`[providers] fetchProviderModels: ${providerName} ERROR ${res.status}: ${errText.substring(0, 500)}`);
      throw new Error(`${providerName} responded ${res.status}`);
    }
    const rawText = await res.text();
    process.stderr.write(`[providers] fetchProviderModels: ${providerName} rawResponseLength=${rawText.length} first200=${rawText.substring(0, 200)}`);
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch (e: any) {
      process.stderr.write(`[providers] fetchProviderModels: ${providerName} JSON parse error:`, e?.message, "raw:", rawText.substring(0, 500));
      throw e;
    }
    const rawData = data.data;
    if (!Array.isArray(rawData)) {
      process.stderr.write(`[providers] fetchProviderModels: ${providerName} data.data is not array. Keys: ${Object.keys(data).join(",")} dataType: ${typeof rawData}`);
    }
    const models = (Array.isArray(rawData) ? rawData : []).map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
      contextWindow: m.context_length,
      reasoning: true,
    }));
    process.stderr.write(`[providers] fetchProviderModels: ${providerName} returned ${models.length} models`);
    return models;
  } catch (e) {
    process.stderr.write(`[providers] fetchProviderModels error for ${providerName}:`, e);
    return [];
  }
}

export async function testProviderConnection(
  providerName: string,
  baseUrl: string,
  apiKey: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const models = await fetchProviderModels(providerName, baseUrl, apiKey);
  if (models.length === 0) {
    return { success: false, count: 0, error: "Nessun modello trovato" };
  }
  return { success: true, count: models.length };
}

export function syncModelsJson(config: ProvidersConfig): void {
  try {
    let existing: any = { providers: {} };
    if (existsSync(modelsPath)) {
      existing = JSON.parse(readFileSync(modelsPath, "utf8"));
    }

    const newProviders: Record<string, any> = {};
    const removedProviders: string[] = [];

    for (const [name, pcfg] of Object.entries(config.providers)) {
      if (!pcfg.enabled) continue;

      const oldProvider = existing.providers?.[name] || {};
      const oldModels: any[] = oldProvider.models || [];

      const newModels = pcfg.enabledModels.map((modelId) => {
        const old = oldModels.find((m: any) => m.id === modelId || m === modelId);
        const modelInfo: any = {
          id: modelId,
          name: modelId,
          reasoning: true,
          contextWindow: 32768,
          maxTokens: 32768,
        };
        if (old && typeof old === "object") {
          modelInfo.id = modelId;
          modelInfo.name = old.name || modelId;
          modelInfo.reasoning = old.reasoning ?? true;
          if (old.contextWindow) modelInfo.contextWindow = old.contextWindow;
          if (old.maxTokens) modelInfo.maxTokens = old.maxTokens;
          if (old.input) modelInfo.input = old.input;
          if (old.thinkingLevelMap) modelInfo.thinkingLevelMap = old.thinkingLevelMap;
        }
        // Ensure ALL thinking levels are mapped for reasoning models
        if (modelInfo.reasoning) {
          const map = (modelInfo.thinkingLevelMap || {}) as Record<string, string>;
          const fullMap = {
            off: map.off || "none",
            low: map.low || "low",
            medium: map.medium || "medium",
            high: map.high || "high",
            xhigh: map.xhigh || "max",
          };
          // For OpenAI-style (no max support), xhigh maps to high
          const format = oldProvider?.compat?.thinkingFormat || "openai-fallback";
          if (format === "openai-fallback" && !map.xhigh) {
            fullMap.xhigh = map.high || "high";
          }
          modelInfo.thinkingLevelMap = fullMap;
        }
        return modelInfo;
      });

      newProviders[name] = {
        ...oldProvider,
        baseUrl: pcfg.baseUrl,
        api: oldProvider.api || "openai-completions",
        // === Ollama locale non ha bisogno di API key, ma il Pi SDK la richiede non vuota ===
        apiKey: pcfg.apiKey || (name.toLowerCase() === "ollama" ? "ollama" : ""),
        models: newModels,
      };
    }

    // Rileva provider rimossi
    for (const name of Object.keys(existing.providers || {})) {
      if (!config.providers[name]) {
        removedProviders.push(name);
      }
    }

    const newModelsJson = { ...existing, providers: newProviders };
    writeFileSync(modelsPath, JSON.stringify(newModelsJson, null, 2), "utf8");
    process.stderr.write(`[providers] syncModelsJson: ${Object.keys(newProviders).length} providers, removed: [${removedProviders.join(", ")}]`);
  } catch (e) {
    process.stderr.write("[providers] syncModelsJson error:", e);
  }
}

export function syncSettingsJson(config: ProvidersConfig): void {
  try {
    let existing: any = {};
    if (existsSync(settingsPath)) {
      existing = JSON.parse(readFileSync(settingsPath, "utf8"));
    }

    const defaultModel = config.defaultModel;
    let defaultProvider = "";
    for (const [name, pcfg] of Object.entries(config.providers)) {
      if (pcfg.enabled && pcfg.enabledModels.includes(defaultModel)) {
        defaultProvider = name;
        break;
      }
    }

    const newSettings = {
      ...existing,
      defaultModel,
      defaultProvider,
      defaultThinkingLevel: config.defaultThinking,
    };

    writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), "utf8");
  } catch (e) {
    process.stderr.write("[providers] syncSettingsJson error:", e);
  }
}

export function getDefaultModel(): string {
  const config = readProvidersConfig();
  return config.defaultModel;
}

export function getDefaultThinking(): string {
  const config = readProvidersConfig();
  return config.defaultThinking;
}
