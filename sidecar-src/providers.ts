import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { encryptString, decryptString, isEncrypted } from "./crypto";

const agentDir = process.env.QUINKI_AGENT_DIR || join(homedir(), ".pi", "agent");
const providersPath = join(agentDir, "quinki-providers.json");
const providersBackupPath = join(agentDir, "quinki-providers-backup.json");
const modelsPath = join(agentDir, "models.json");
const settingsPath = join(agentDir, "settings.json");

export interface ProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  enabledModels: string[];
  modelData?: any[];
  cloudApiKey?: string;
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
  defaultMode?: string;
}

export interface SafeProvidersConfig {
  providers: Record<string, SafeProviderConfig>;
  defaultModel: string;
  defaultThinking: string;
  defaultMode?: string;
}

export interface FetchedModel {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];  // model.input: ["text"] or ["text","image"] (vision capability)
}

const DEFAULT_CONFIG: ProvidersConfig = {
  providers: {
    // FEATURE 2026-09-08: sei provider di DEFAULT. L'utente nuovo li trova
    // gia presenti — fa solo login (OAuth o Ollama install).
    // ORDINE (l'utente può riordinare col drag):
    //   1. OpenAI (ChatGPT Plus/Pro — subscription OAuth)
    //   2. Anthropic (Claude Pro/Max — subscription OAuth)
    //   3. Ollama (locale, gratis)
    //   4. OpenRouter (pay-per-use, flessibile)
    //   5. GitHub Copilot (Copilot subscription)
    //   6. xAI (SuperGrok/X Premium — subscription OAuth)
    OpenAI: { enabled: true, baseUrl: "https://chatgpt.com/backend-api", apiKey: "", enabledModels: [] },
    Anthropic: { enabled: true, baseUrl: "https://api.anthropic.com", apiKey: "", enabledModels: [] },
    Ollama: { enabled: true, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", enabledModels: [] },
    OpenRouter: { enabled: true, baseUrl: "https://openrouter.ai/api/v1", apiKey: "", enabledModels: [] },
    "GitHub Copilot": { enabled: true, baseUrl: "https://api.individual.githubcopilot.com", apiKey: "", enabledModels: [] },
    xAI: { enabled: true, baseUrl: "https://api.x.ai/v1", apiKey: "", enabledModels: [] },
  },
  defaultModel: "",
  defaultThinking: "xhigh",
  defaultMode: "plan",
};

function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return key.substring(0, 4) + "••••••••" + key.substring(key.length - 4);
}

export function readProvidersConfig(): ProvidersConfig {
  try {
    if (!existsSync(providersPath)) return ensureBuiltinProviders(structuredClone(DEFAULT_CONFIG));
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
        modelData: Array.isArray(pc.modelData) ? pc.modelData : [],
        ...(pc.cloudApiKey ? { cloudApiKey: pc.cloudApiKey } : {}),
        ...(pc.subscription ? { subscription: pc.subscription } : {}),
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
    // FEATURE 04 set: i provider FISSI (OpenRouter/Ollama) non si eliminano — se nel
    // file mancano (primo avvio, reset), vengono ri-abilitati come default.
    if (!providers.OpenRouter) providers.OpenRouter = { enabled: true, baseUrl: "https://openrouter.ai/api/v1", apiKey: "", enabledModels: [] };
    if (!providers.Ollama) providers.Ollama = { enabled: true, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", enabledModels: [] };
    // FEATURE 2026-09-08: subscription OAuth providers — aggiunti come default
    // per gli utenti esistenti. Se MANCA anche uno solo dei 4 nuovi, li inseriamo
    // tutti nel POSTO GIUSTO (ordine di default), non in coda. Se l'utente li ha
    // già (ha già girato la nuova versione), NON riordiniamo (potrebbe averli
    // trascinati col drag).
    const needsOrderMigration = !providers.OpenAI || !providers.Anthropic || !(providers as any)["GitHub Copilot"] || !(providers as any)["xAI"];
    if (needsOrderMigration) {
      // Aggiungi i mancanti
      if (!providers.OpenAI) providers.OpenAI = { enabled: true, baseUrl: "https://chatgpt.com/backend-api", apiKey: "", enabledModels: [] };
      if (!providers.Anthropic) providers.Anthropic = { enabled: true, baseUrl: "https://api.anthropic.com", apiKey: "", enabledModels: [] };
      if (!(providers as any)["GitHub Copilot"]) (providers as any)["GitHub Copilot"] = { enabled: true, baseUrl: "https://api.individual.githubcopilot.com", apiKey: "", enabledModels: [] };
      if (!(providers as any)["xAI"]) (providers as any)["xAI"] = { enabled: true, baseUrl: "https://api.x.ai/v1", apiKey: "", enabledModels: [] };
      // RICOSTRUISCI con l'ordine di default: i 6 built-in prima (in ordine), poi i custom
      const builtinOrder = ["OpenAI", "Anthropic", "Ollama", "OpenRouter", "GitHub Copilot", "xAI"];
      const rebuilt: Record<string, ProviderConfig> = {} as any;
      for (const name of builtinOrder) {
        if ((providers as any)[name]) (rebuilt as any)[name] = (providers as any)[name];
      }
      for (const [name, cfg] of Object.entries(providers)) {
        if (!builtinOrder.includes(name)) (rebuilt as any)[name] = cfg;
      }
      // Sostituisci la mappa con quella riordinata
      for (const k of Object.keys(providers)) delete (providers as any)[k];
      for (const [k, v] of Object.entries(rebuilt)) (providers as any)[k] = v;
      process.stderr.write("[providers] migration: reordered to default (OpenAI→Anthropic→Ollama→OpenRouter→Copilot→xAI)\n");
    }
    return ensureBuiltinProviders({
      providers,
      defaultModel: json.defaultModel || "",
      defaultThinking: json.defaultThinking || "xhigh",
    });
  } catch (e) {
    process.stderr.write(`[providers] readProvidersConfig error: ${e}`);
    const base = structuredClone(DEFAULT_CONFIG);
    if (!base.providers.OpenRouter) base.providers.OpenRouter = { enabled: true, baseUrl: "https://openrouter.ai/api/v1", apiKey: "", enabledModels: [] };
    if (!base.providers.Ollama) base.providers.Ollama = { enabled: true, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", enabledModels: [] };
    return base;
  }
}

export function writeProvidersConfig(config: ProvidersConfig): void {
  try {
    // === ANTI-LOSS: le chiavi NON si perdono mai più ===
    // 1) Preserva i provider NON presenti nella nuova config (evita drop accidentali).
    // 2) Se una apiKey nuova è vuota e ce n'era una esistente, la mantiene
    //    (salvo esplicita richiesta di cancellazione con apiKeyDelete=true).
    const existing = readProvidersConfig();
    const toWrite: any = {
      defaultModel: config.defaultModel,
      defaultThinking: config.defaultThinking,
      providers: {},
    };
    // FIX (01 set): supporto alla DELETE REALE di un provider. Il campo
    // providerDelete=true (inviato dal deleteProvider RPC) dice all'anti-loss
    // di NON preservare il provider: l'utente l'ha cancellato DAVVERO.
    const explicitlyDeleted = new Set<string>();
    for (const [name, pcfg] of Object.entries(config.providers || {})) {
      if ((pcfg as any)?.providerDelete === true) explicitlyDeleted.add(name);
    }
    for (const [name, pcfg] of Object.entries(existing.providers)) {
      if (!config.providers[name] && !explicitlyDeleted.has(name)) toWrite.providers[name] = pcfg;
    }
    for (const [name, pcfg] of Object.entries(config.providers)) {
      const pc = pcfg as any;
      if (pc.providerDelete === true) continue; // FIX (01 set): provider esplicitamente eliminato — NON riscrivere
      let apiKeyToStore = pc.apiKey ? encryptString(String(pc.apiKey)) : "";
      const existingKey = existing.providers[name]?.apiKey || "";
      // FIX CRITICO 084 (03 set): una chiave MASCherata ("sk-o••••••••") NON è una chiave!
      // getSafeProvidersConfig restituisce placeholder mascherati al frontend, che li
      // rimanda indietro a OGNI save delle impostazioni → il vecchio codice cifrava il
      // placeholder e DISTRUGGEVA la chiave vera. Se l'input è mascherato e ne esiste
      // una reale, PRESERVA quella reale (stesso principio dell'anti-loss per vuoto).
      const incoming = pc.apiKey ? String(pc.apiKey) : "";
      const isMasked = incoming.includes("••") || incoming.includes("...");
      const wasLegit = existingKey.startsWith("enc:v1:");
      if (isMasked && wasLegit && pc.apiKeyDelete !== true) {
        apiKeyToStore = existingKey;
      } else if (!apiKeyToStore && existingKey && pc.apiKeyDelete !== true) {
        apiKeyToStore = existingKey;
      }
      const existingCloud = (existing.providers[name] as any)?.cloudApiKey;
      const incomingCloud = (pc as any).cloudApiKey;
      // cloudApiKeyDelete=true (logout): NON preservare la chiave esistente
      const cloudDeleted = (pc as any).cloudApiKeyDelete === true;
      const cloudToStore = cloudDeleted ? undefined : (incomingCloud !== undefined ? (incomingCloud || undefined) : existingCloud);
      // FIX 2026-09-08: preserva il campo `subscription` (OAuth tokens per Anthropic,
      // OpenAI, GitHub Copilot, xAI). Senza questo, writeProvidersConfig DROPPAVA il
      // campo a ogni save → il login riusciva ma il token spariva subito dopo.
      // subscriptionDelete=true (logout): NON preservare il token esistente.
      const subscriptionDeleted = (pc as any)?.subscriptionDelete === true;
      const incomingSubscription = (pc as any)?.subscription;
      const existingSubscription = (existing.providers[name] as any)?.subscription;
      const subscriptionToStore = subscriptionDeleted ? undefined : (incomingSubscription || existingSubscription);
      toWrite.providers[name] = {
        enabled: pc.enabled,
        baseUrl: pc.baseUrl || existing.providers[name]?.baseUrl || "",
        apiKey: apiKeyToStore,
        enabledModels: Array.isArray(pc.enabledModels) ? pc.enabledModels : [],
        modelData: Array.isArray(pc.modelData) ? pc.modelData : [],
        ...(cloudToStore ? { cloudApiKey: cloudToStore } : {}),
        ...(subscriptionToStore ? { subscription: subscriptionToStore } : {}),
      };
    }
    writeFileSync(providersPath, JSON.stringify(toWrite, null, 2), "utf8");
    // === BACKUP: copia del file (le chiavi restano cifrate) ===
    // === BACKUP MERGE (29 ago — fix 'api key perse a ogni reinstall'): il backup
    // veniva riscritto DAL NUOVO config → se il nuovo era già ripulito, anche il
    // backup moriva con lui. Ora il backup è il MERGE: una chiave PIENA non viene
    // MAI sovrascritta da una vuota — né dal nuovo config, né da un backup peggiore.
    try {
      let oldBackup: any = { providers: {} };
      try { oldBackup = JSON.parse(readFileSync(providersBackupPath, "utf8")); } catch {}
      const mergedBackup: any = { providers: {} };
      const names = new Set([...Object.keys((oldBackup.providers || {})), ...Object.keys(toWrite.providers || {})]);
      for (const nm of names) {
        if (explicitlyDeleted.has(nm)) continue; // FIX (01 set): eliminato = FUORI anche dal backup (niente resurrezioni)
        const nb = (oldBackup.providers || {})[nm]?.apiKey || "";
        const nw = toWrite.providers[nm]?.apiKey || "";
        mergedBackup.providers[nm] = { ...((oldBackup.providers || {})[nm] || {}), ...(toWrite.providers[nm] || {}), apiKey: nw || nb };
      }
      writeFileSync(providersBackupPath, JSON.stringify(mergedBackup, null, 2), "utf8");
    } catch {}
    // === SICUREZZA: forza permessi restrittivi sul file providers ===
    try { require("fs").chmodSync(providersPath, 0o600); } catch {}
    // === AUDIT LOG: cosa è stato salvato (mai loggare la vera chiave) ===
    const summary = Object.entries(config.providers).map(([name, pcfg]) => ({
      name,
      enabled: pcfg.enabled,
      hasKey: !!pcfg.apiKey,
      modelsCount: Array.isArray(pcfg.enabledModels) ? pcfg.enabledModels.length : 0,
    }));
    process.stderr.write(`[security-audit] writeProvidersConfig: ${JSON.stringify(summary)}`);
  } catch (e) {
    process.stderr.write(`[providers] writeProvidersConfig error: ${e}`);
  }
}

export function restoreProvidersFromBackup(): number {
  // Ripristina apiKey vuote dal backup (chiamato all'init del sidecar).
  // FIX (01 set): NON risuscitare provider ELIMINATI. Prima scriveva
  // main.providers[name] = {...(main.providers[name] || {}), apiKey: backupKey}
  // → creava il provider DAL NULLA anche se l'utente lo aveva cancellato
  // (bug "se elimini un provider ricompare da solo"). Ora ripristina SOLO
  // le chiavi di provider che ESISTONO ancora in main.
  try {
    if (!existsSync(providersPath) || !existsSync(providersBackupPath)) return 0;
    const main = JSON.parse(readFileSync(providersPath, "utf8"));
    const backup = JSON.parse(readFileSync(providersBackupPath, "utf8"));
    let restored = 0;
    for (const [name, bcfg] of Object.entries(backup.providers || {})) {
      if (!main.providers?.[name]) continue; // FIX: provider eliminato = NON risuscitare
      const mainKey = main.providers[name].apiKey || "";
      const backupKey = (bcfg as any)?.apiKey || "";
      if (!mainKey && backupKey) {
        main.providers[name].apiKey = backupKey;
        restored++;
      }
    }
    if (restored > 0) {
      writeFileSync(providersPath, JSON.stringify(main, null, 2), "utf8");
      try { require("fs").chmodSync(providersPath, 0o600); } catch {}
    }
    return restored;
  } catch { return 0; }
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
    // Detect Ollama (or any Ollama-compatible local server) by capability, not by name.
    // Try /api/tags first — if it responds, we get context_window for free.
    // Works regardless of provider name (user can rename "Ollama" to anything).
    const ollamaUrl = baseUrl.replace(/\/v1\/?$/, "");
    try {
      const ollamaRes = await fetch(`${ollamaUrl}/api/tags`);
      if (ollamaRes.ok) {
        const data = (await ollamaRes.json()) as { models: Array<{ name: string; size?: number; details?: { parameter_size?: string; context_length?: number }; capabilities?: string[] }> };

        const models = await Promise.all(
          (data.models || []).map(async (m) => {
            let contextWindow: number | undefined = m.details?.context_length;
            let reasoning = (m.capabilities || []).includes("thinking");
            // vision: Ollama espone le capability complete — i modelli con vision ricevono
            // input ["text","image"] così il Pi SDK NON scarta le immagini
            // FIX 2026-09-08: SEMPRE includi "image" — MAI filtrare basandosi sul cache.
            // Il provider decide: se il modello supporta vision, processa l'immagine.
            // Se non la supporta, il provider risponde con errore (gestito).
            // Questo è come il thinking: sempre max, il provider si adatta.
            const input = ["text", "image"];

            if (!contextWindow) {
              try {
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
                  if (showData.capabilities) {
                    reasoning = showData.capabilities.includes("thinking");
                  }
                  if (showData.model_info) {
                    for (const [key, val] of Object.entries(showData.model_info)) {
                      if (key.endsWith(".context_length") && typeof val === "number") {
                        contextWindow = val;
                        break;
                      }
                    }
                  }
                }
              } catch {}
            }

            return {
              id: m.name,
              name: m.name,
              contextWindow,
              reasoning,
              input,
            };
          })
        );

        return models;
      }
    } catch {}
    // Not Ollama (or /api/tags failed) — use standard OpenAI-compatible endpoint

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
      process.stderr.write(`[providers] fetchProviderModels: ${providerName} JSON parse error: ${e?.message} raw: ${rawText.substring(0, 500)}`);
      throw e;
    }
    const rawData = data.data;
    if (!Array.isArray(rawData)) {
      process.stderr.write(`[providers] fetchProviderModels: ${providerName} data.data is not array. Keys: ${Object.keys(data).join(",")} dataType: ${typeof rawData}`);
    }
    // GENERALIZED capability detection (qualsiasi provider):
    // 1) OpenRouter espone architecture.input_modalities per ogni modello
    // 2) Altri OpenAI-compatible: euristica dai nomi dei modelli con vision nota
    // 3) Override manuale: modelData input nel provider config (sempre rispettato al load)
    const VISION_NAME_HINTS: RegExp[] = [
      /vision/i, /-vl\b/, /-vl-/, /4v/, /minicpm-v/i, /llava/i, /pixtral/i,
      /gpt-4o/i, /gpt-4\.1/i, /gpt-5/i, /omni/i, /claude/i, /gemini/i,
      /glm-4v/i, /glm-5/i, /grok-4/i, /llava/i, /llama-3\.2-vision/i, /llama-4/i,
      /mistral.*ocr/i, /pixtral/i, /presto/i, /internvl/i, /molmo/i,
    ];
    const nameSuggestsVision = (id: string): boolean =>
      VISION_NAME_HINTS.some((re) => re.test(id));

    const models = (Array.isArray(rawData) ? rawData : []).map((m: any) => {
      const id = m.id || "";
      // OpenRouter: architecture.input_modalities contiene "image" per i modelli vision
      const openRouterModalities: string[] = m?.architecture?.input_modalities || [];
      const openRouterVision = openRouterModalities.includes("image");
      const isVision = openRouterVision || (!openRouterModalities.length && nameSuggestsVision(id));
      return {
        id,
        name: m.name || m.id,
        // FIX (04 set): contesto REALE = top_provider.context_length (endpoint che serve),
        // non il claim del venditore (context_length) — es. glm-5.3-flash: 1.31M vs 1.048M
        contextWindow: m?.top_provider?.context_length || m.context_length || m.contextWindow,
        reasoning: true,
        // FIX 2026-09-08: SEMPRE includi "image" — come sopra, mai filtrare.
        input: ["text", "image"],
      };
    });
    process.stderr.write(`[providers] fetchProviderModels: ${providerName} returned ${models.length} models (${models.filter((m: any) => (m.input || []).includes("image")).length} with vision)`);
    return models;
  } catch (e) {
    process.stderr.write(`[providers] fetchProviderModels error for ${providerName}: ${e}`);
    return [];
  }
}

// === FEATURE 04 set: USAGE provider + provider fissi ===

export async function getOpenRouterUsage(apiKey: string): Promise<{ ok: boolean; usage?: any; credits?: any; error?: string }> {
  try {
    const [kr, cr] = await Promise.all([
      fetch("https://openrouter.ai/api/v1/auth/key", { headers: { Authorization: `Bearer ${apiKey}` } }),
      fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${apiKey}` } }),
    ]);
    if (!kr.ok && !cr.ok) return { ok: false, error: `OpenRouter usage HTTP ${kr.status}/${cr.status}` };
    const keyData = kr.ok ? await kr.json() : null;
    const credData = cr.ok ? await cr.json() : null;
    return {
      ok: true,
      usage: keyData?.data ?? null,
      credits: credData?.data ?? null,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function getOllamaUsage(baseUrl: string): Promise<{ ok: boolean; loaded?: any[]; models?: any[]; error?: string }> {
  try {
    const url = baseUrl || "http://127.0.0.1:11434";
    const [ps, tg] = await Promise.all([
      fetch(`${url}/api/ps`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${url}/api/tags`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    return { ok: !!(ps || tg), loaded: ps?.models || [], models: tg?.models || [] };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// Garantisce che i due provider FISSI esistano nel config (default enabled, baseUrl corretta).
export function ensureBuiltinProviders(config: ProvidersConfig): ProvidersConfig {
  const cfg = config || { providers: {} as any, defaultModel: "", defaultThinking: "" };
  const prov = cfg.providers as any;
  if (!prov.OpenRouter) {
    prov.OpenRouter = { enabled: true, baseUrl: "https://openrouter.ai/api/v1", apiKey: "", enabledModels: [] };
  }
  if (!prov.Ollama) {
    prov.Ollama = { enabled: true, baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", enabledModels: [] };
  }
  return cfg;
}

export async function testProviderConnection(
  providerName: string,
  baseUrl: string,
  apiKey: string
): Promise<{ success: boolean; count: number; error?: string }> {
  const models = await fetchProviderModels(providerName, baseUrl, apiKey);
  if (models.length === 0) {
    return { success: false, count: 0, error: "No models found" };
  }
  return { success: true, count: models.length };
}

export async function syncModelsJson(config: ProvidersConfig): Promise<void> {
  try {
    let existing: any = { providers: {} };
    if (existsSync(modelsPath)) {
      existing = JSON.parse(readFileSync(modelsPath, "utf8"));
    }

    const newProviders: Record<string, any> = {};
    const removedProviders: string[] = [];

    // FIX 084 (03 set): il fallback inventato `|| 32768` ha AVVELENATO models.json per
    // mesi (deepseek reale 1310720, scritto 32768!). La 0.78 leggeva il catalogo e
    // mascherava il danno; la 0.84.x onora models.json → clamp/compaction 40× troppo
    // presto. Ora: quando il modelData del config manca, FETCH LIVE dal provider.
    const apiLookups: Record<string, Record<string, any>> = {};
    for (const [name, pcfg] of Object.entries(config.providers)) {
      if (!pcfg.enabled || !(pcfg.enabledModels || []).length) continue;
      const hasData = ((pcfg as any).modelData || []).some((m: any) => m?.contextWindow);
      const isLocal = (pcfg.baseUrl || "").includes("localhost") || (pcfg.baseUrl || "").includes("127.0.0.1") || (pcfg.baseUrl || "").includes("11434");
      if (!hasData) {
        try {
          const fetched = await fetchProviderModels(name, pcfg.baseUrl || "", pcfg.apiKey || "");
          apiLookups[name] = Object.fromEntries(fetched.map((m: any) => [String(m.id), m]));
          process.stderr.write(`[providers] syncModelsJson: live fetch ${name} → ${fetched.length} modelli`);
        } catch (e: any) {
          process.stderr.write(`[providers] syncModelsJson: live fetch ${name} fallita (${e?.message || e}) — fallback ai valori esistenti`);
        }
      }
      void isLocal;
    }

    for (const [name, pcfg] of Object.entries(config.providers)) {
      if (!pcfg.enabled) continue;

      // === FIX: provider non-Ollama senza apiKey → OMESSO da models.json ===
      // Il Pi SDK rifiuta apiKey vuota (schema) e provider non-built-in senza chiave,
      // invalidando TUTTO models.json (anche gli altri provider sani).
      const isOllama = name.toLowerCase() === "ollama" || (pcfg.baseUrl || "").includes("11434");
      const isLocal = (pcfg.baseUrl || "").includes("localhost") || (pcfg.baseUrl || "").includes("127.0.0.1") || isOllama;
      if (!pcfg.apiKey && !isLocal) {
        process.stderr.write(`[providers] syncModelsJson: skipping ${name} (no apiKey)`);
        continue;
      }

      const oldProvider = existing.providers?.[name] || {};
      const oldModels: any[] = oldProvider.models || [];

      // GUARDIA anti-svuotamento (04 set): un payload con enabledModels VUOTO NON deve
      // svuotare il registry di un provider che ha gia modelli (il sync veniva chiamato
      // con config parziali da test/RPC e azzerava modelli+registry dei provider).
      const _payloadEmpty = !(pcfg.enabledModels || []).length;
      if (_payloadEmpty && oldModels.length > 0) {
        newProviders[name] = { ...oldProvider, models: oldModels };
        continue;
      }
      const newModels = pcfg.enabledModels.map((modelId) => {
        const old = oldModels.find((m: any) => m.id === modelId || m === modelId);
        // Also check modelData from config (has fresh contextWindow from API)
        const modelDataEntry = (pcfg as any).modelData?.find((m: any) => m.id === modelId);
        // FIX 084: catena di risoluzione — MAI inventare un valore: modelData → fetch live
        // → valore esistente → (ultimo rimorso) 32768. Il vecchio `|| 32768` ha corrotto
        // models.json (deepseek 1310720 scritto come 32768) per mesi.
        const freshApi = apiLookups[name]?.[String(modelId)];
        const modelInfo: any = {
          id: modelId,
          name: modelId,
          reasoning: true,
          contextWindow: modelDataEntry?.contextWindow || freshApi?.contextWindow || 32768,
          maxTokens: 32768,
        };
        if (old && typeof old === "object") {
          modelInfo.id = modelId;
          modelInfo.name = old.name || modelId;
          modelInfo.reasoning = old.reasoning ?? true;
          // FIX 084: il vecchio valore su disco vince SOLO se non abbiamo dati freschi
          // (era: old vinceva SEMPRE → il 32768 avvelenato non si aggiustava mai).
          if (old.contextWindow && modelInfo.contextWindow === 32768) modelInfo.contextWindow = old.contextWindow;
          if (old.maxTokens) modelInfo.maxTokens = old.maxTokens;
          // old.input: valore preservato (PUÒ essere stantio — la probe vision lo corregge)
          if (old.input) modelInfo.input = old.input;
          if (old.thinkingLevelMap) modelInfo.thinkingLevelMap = old.thinkingLevelMap;
        }
        // OVERRIDE MANUALE (modelData.input nel config): vince SEMPRE su old/input
        // stantii. Se l'utente scrive input a mano in quinki-providers.json, quella
        // è la verità. La probe vision (alla config del provider) scopre i valori
        // reali per i modelli senza override manuale.
        if (Array.isArray(modelDataEntry?.input)) modelInfo.input = modelDataEntry.input;
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
          // Universal thinking rule (29 ago): xhigh = SEMPRE il massimo del provider.
          // OLLAMA supporta think levels nativi fino a "max" (verificato con probe
          // dell'API: think accetta high/medium/low/max/true/false) → MAI il downgrade
          // openai-fallback; le mappe stantie (xhigh salvato come "high") vengono
          // sanate qui a ogni sync. Gli OpenAI-style veri NON supportano max → high.
          const isOllamaProvider = isOllama
            || (pcfg.baseUrl || "").includes("ollama.com");
          if (isOllamaProvider) {
            fullMap.xhigh = "max";
          } else {
            const format = oldProvider?.compat?.thinkingFormat || "openai-fallback";
            if (format === "openai-fallback" && !map.xhigh) {
              fullMap.xhigh = map.high || "high";
            }
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
        // pcfg.apiKey qui è già DECIFRATA (readProvidersConfig decifra) — il SDK la legge in chiaro da models.json
        apiKey: pcfg.apiKey || (isLocal ? "local" : ""),
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
    process.stderr.write(`[providers] syncModelsJson error: ${e}`);
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
    process.stderr.write(`[providers] syncSettingsJson error: ${e}`);
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

// ===================== UNIVERSAL CAPABILITY PROBES (29 ago) =====================
// Provider-agnostic: scoprono le capacità REALI dei modelli di QUALSIASI provider
// e le cachano in ~/.quinki/thinking-caps.json (schema esteso per modello:
// { maxLevel, allowed, source, learnedAt, visionInput, visionSource }).
// - Probe THINKING: costo ZERO (valore invalido → l'errore elenca i valori ammessi,
//   nessuna generazione). Agnostica: vale per Ollama (think), OpenAI-style
//   (reasoning_effort), e qualunque API che VALIDA il parametro.
// - Probe VISION: micro-immagine 1×1 + "hi" (pochi token, una volta per modello).
// - Auto-evoluzione: se un provider domani aggiunge un livello nuovo (es. "ultra"),
//   la probe lo scopre e il max cambia da solo (refresh a ogni avvio del sidecar
//   e a ogni configurazione provider).
// L'override manuale (modelData nel config) vince SEMPRE su tutto.

const THINK_PROBE_ORDER = ["none", "false", "true", "minimal", "low", "medium", "high", "max", "xhigh"];

function capsFilePath(): string {
  return join(homedir(), ".quinki", "thinking-caps.json");
}

function loadCapsAll(): Record<string, any> {
  try { return JSON.parse(readFileSync(capsFilePath(), "utf8")) || {}; } catch { return {}; }
}

function saveCapsAll(caps: Record<string, any>): void {
  try { writeFileSync(capsFilePath(), JSON.stringify(caps, null, 2)); } catch {}
}

function hostOfUrl(baseUrl: string): string {
  try { return new URL(baseUrl).host; } catch { return String(baseUrl || "unknown"); }
}

function capsKeyFor(baseUrl: string, modelId: string): string {
  return hostOfUrl(baseUrl) + "/" + modelId;
}

function rankLevelVal(v: any): number {
  if (typeof v === "boolean") return v ? 2 : 0;
  const i = THINK_PROBE_ORDER.indexOf(String(v));
  // Valore SCONOSCIUTO (es. "ultra"/"mega" nuovo di un provider): è un livello NUOVO,
  // rank sopra OGNI noto (99). Il tie-break tra più sconosciuti è nella probe-compare
  // (reasoning tokens reali), non nell'ordine della lista.
  return i === -1 ? 99 : i;
}

// Parser AGNOSTICO dell'errore: cerca valori tra doppi o singoli apici + booleani.
// OpenAI: "Supported values: 'low', 'medium', 'high'" (apici singoli)
// Ollama: 'must be "high", "medium", "low", "max", true, or false' (doppi)
function parseAllowedFromErrorMsg(msg: string): string[] {
  const found = new Set<string>();
  for (const m of String(msg || "").matchAll(/["']([a-zA-Z]+)["']/g)) found.add(m[1]);
  const out = [...found].filter((v) => THINK_PROBE_ORDER.includes(v) || !["invalid", "value", "error", "unsupported", "must", "supported", "values", "parameter", "field", "the", "and", "or"].includes(v));
  if (/\btrue\b/.test(String(msg))) out.push("true");
  if (/\bfalse\b/.test(String(msg))) out.push("false");
  return out;
}

function this_write_models(mm: any, note: string): void {
  try {
    writeFileSync(modelsPath, JSON.stringify(mm, null, 2), "utf8");
    process.stderr.write(`[providers] models.json corrected: ${note}\n`);
  } catch {}
}

function highestLevelOf(list: string[]): string | null {
  let best: string | null = null;
  let bestRank = -Infinity;
  let bestIdx = -1;
  for (let i = 0; i < list.length; i++) {
    const r = rankLevelVal(list[i]);
    // >= : tra livelli sconosciuti (rank 99 pari) vince l'ULTIMO annunciato
    // (i provider elencano tipicamente gli efforts in ordine crescente).
    // Il valore definitivo lo conferma la probe-compare sui reasoning tokens.
    if (r >= bestRank) { best = list[i]; bestRank = r; bestIdx = i; }
  }
  return best;
}

function sleepMs(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) } as any) as Promise<Response>;
}

// Probe THINKING per UN modello: invia un livello invalido e parsa l'errore.
// Restituisce l'entry caps aggiornata (o null se il provider non valida il param).
async function probeModelThinking(baseUrl: string, apiKey: string, modelId: string, isOllama: boolean): Promise<any | null> {
  try {
    // === OPENROUTER: fonte di verità PRIMARIA = API modelli (29 ago) ===
    // L'errore generico di OpenRouter elenca TUTTI i valori della sua enum
    // (xhigh, minimal inclusi) — NON quelli che il SINGOLO modello accetta:
    // da lì il bug 'max=xhigh/minimal'. L'API /models espone
    // reasoning.supported_efforts REALI per-modello (glm-5.3: [max, high, low]).
    if (/openrouter\.ai/i.test(baseUrl)) {
      try {
        const mid = String(modelId).replace(/^openrouter\.ai\//, "").split(":")[0];
        const mr = await fetchWithTimeout("https://openrouter.ai/api/v1/models", { headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } } as any, 30000);
        if (mr.ok) {
          const md: any = await mr.json();
          const m = (md?.data || []).find((x: any) => {
            const xid = String(x?.id || "").split(":")[0];
            return xid === mid || xid.endsWith("/" + mid) || mid.endsWith("/" + xid);
          });
          // FIX (04 set): il contesto REALE e' quello DELL'ENDPOINT che serve le
          // richieste (top_provider.context_length), NON il claim del venditore
          // (context_length). Es. glm-5.3-flash: claim 1.31M, endpoint 1.048M
          // (la scheda ufficiale dice 1M) — percentuali sottostimate del 25%.
          const realCtx = Number(m?.top_provider?.context_length || 0);
          const claimCtx = Number(m?.context_length || 0);
          if (realCtx && realCtx !== claimCtx) {
            try {
              const mm = JSON.parse(readFileSync(modelsPath, "utf8") || "{}");
              for (const pv of Object.values(mm.providers || {})) {
                for (const mo of (pv.models || [])) {
                  if (mo.id === modelId || String(mo.id).endsWith("/" + modelId)) {
                    if (mo.contextWindow !== realCtx) {
                      mo.contextWindow = realCtx;
                      this_write_models(mm, `contextWindow ${mo.id}: ${claimCtx} -> ${realCtx} (top_provider)`);
                    }
                  }
                }
              }
            } catch {}
          }
          const eff = m?.reasoning?.supported_efforts;
          if (Array.isArray(eff) && eff.length > 0) {
            const effs = eff.map(String);
            let max = highestLevelOf(effs);
            // Probe-compare (04 set): con PIU' livelli sconosciuti il rank non basta
            // (tutti 99) — chiede al provider un mini-turno per ciascuno e vince
            // quello con PIU' reasoning tokens reali. Una volta sola, al learning.
            const unknowns = effs.filter((e) => !THINK_PROBE_ORDER.includes(e));
            if (unknowns.length > 1 && apiKey) {
              let bestTok = -1;
              let bestU: string | null = null;
              for (const u of unknowns) {
                try {
                  const rr = await fetchWithTimeout(baseUrl.replace(/\/?$/, "") + "/chat/completions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
                    body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 64, reasoning: { effort: u } }),
                  }, 30000);
                  if (!rr.ok) continue;
                  const jj: any = await rr.json();
                  const tok = Number(jj?.usage?.completion_tokens_details?.reasoning_tokens ?? -1);
                  if (tok > bestTok) { bestTok = tok; bestU = u; }
                } catch {}
              }
              if (bestU) max = bestU;
            }
            if (max) return { maxLevel: max, allowed: effs, source: "openrouter-models-api", learnedAt: new Date().toISOString() };
          }
        }
      } catch {}
    }
    let res: Response;
    if (isOllama) {
      res = await fetchWithTimeout(baseUrl.replace(/\/v1\/?$/, "") + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(apiKey && apiKey !== "ollama" ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], think: "bogus-quinki-probe", stream: false }),
      }, 30000);
    } else {
      res = await fetchWithTimeout(baseUrl.replace(/\/v1\/?$/, "") + "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: modelId, messages: [{ role: "user", content: "hi" }], max_tokens: 8, reasoning_effort: "bogus-quinki-probe" }),
      }, 30000);
    }
    const text = await res.text();
    if (res.ok) return null; // il provider NON valida il parametro → niente da imparare qui
    // FIX (29 ago): il body è JSON con QUOTED-ESCAPE (\"high\") — la regex sui quote
    // NON matcha i livelli escaped. Estraggo PRIMA il messaggio REALE dal JSON
    // (data.error/message/detail), poi lo parso.
    let errMsg = text;
    try {
      const data = JSON.parse(text);
      errMsg = (typeof data?.error === "string" && data.error) || data?.error?.message || data?.message || data?.detail || text;
    } catch {}
    const allowed = parseAllowedFromErrorMsg(String(errMsg));
    if (!allowed.length) process.stderr.write(`[caps-probe] ${modelId}: errore non interpretabile: ${String(errMsg).slice(0, 150)}\n`);
    if (!allowed.length) return null;
    const max = highestLevelOf(allowed);
    if (!max) return null;
    return { maxLevel: max, allowed, source: "probe", learnedAt: new Date().toISOString() };
  } catch { return null; }
}

// Probe VISION per UN modello: micro-immagine 1×1 + "hi".
// → "vision" | "text" | null (inconcludente).
async function probeModelVision(baseUrl: string, apiKey: string, modelId: string): Promise<string[] | null> {
  const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  try {
    const res = await fetchWithTimeout(baseUrl.replace(/\/v1\/?$/, "") + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: [
          { type: "text", text: "hi" },
          { type: "image_url", image_url: { url: PNG_1PX } },
        ] }],
        max_tokens: 8,
      }),
    }, 30000);
    if (res.ok) return ["text", "image"];
    const text = await res.text();
    if (/image|vision|multimodal|modalit/i.test(text)) return ["text"];
    return null;
  } catch { return null; }
}

// Probe COMPLETA di un provider (thinking + vision per ogni modello), BACKGROUND.
// Chiamata alla CONFIGURAZIONE del provider (add/update) — riempie la cache PRIMA
// che l'utente scriva il primo messaggio. Provider che non validano i parametri
// vengono scoperti dal self-heal a runtime.
export async function probeProviderCapabilities(providerName: string): Promise<void> {
  try {
    const config = readProvidersConfig();
    const pcfg = (config.providers as any)?.[providerName];
    if (!pcfg?.enabled || !pcfg?.baseUrl) return;
    const baseUrl = String(pcfg.baseUrl);
    const apiKey = String(pcfg.apiKey || "");
    const isOllama = providerName.toLowerCase() === "ollama" || baseUrl.includes(":11434") || baseUrl.includes("ollama.com");

    const modelsPath = join(homedir(), ".quinki", "models.json");
    let modelsJson: any = {};
    try { modelsJson = JSON.parse(readFileSync(modelsPath, "utf8")); } catch {}
    const models: any[] = modelsJson?.providers?.[providerName]?.models || [];

    const caps = loadCapsAll();
    let visionFixed = 0;
    const count = Math.min(models.length, 30);
    for (let i = 0; i < count; i++) {
      const m = models[i];
      const key = capsKeyFor(baseUrl, m.id);
      // thinking: solo modelli reasoning, solo se non c'è già una probe recente
      if (m.reasoning) {
        const entry = caps[key];
        const stale = !entry?.maxLevel || entry?.source === "error" || !entry?.learnedAt ||
          (Date.now() - new Date(entry.learnedAt).getTime() > 7 * 24 * 3600 * 1000);
        if (stale) {
          const probed = await probeModelThinking(baseUrl, apiKey, m.id, isOllama);
          if (probed) { caps[key] = { ...(caps[key] || {}), ...probed }; process.stderr.write(`[caps-probe] ${m.id}: thinking max=${probed.maxLevel} (${probed.allowed.join(",")})\n`); }
        }
      }
      // vision: per TUTTI i modelli senza override manuale (scopre falsi positivi e falsi negativi)
      const hasManualInput = Array.isArray((pcfg as any).modelData) && (pcfg as any).modelData.some((md: any) => md.id === m.id && Array.isArray(md?.input));
      if (!hasManualInput) {
        const probedVision = await probeModelVision(baseUrl, apiKey, m.id);
        if (probedVision) {
          const entry = caps[key] || {};
          const oldVision = entry.visionInput ? entry.visionInput.join(",") : "?";
          entry.visionInput = probedVision;
          entry.visionSource = "probe";
          entry.visionLearnedAt = new Date().toISOString();
          caps[key] = entry;
          // correggi ANCHE models.json (il Pi SDK strip le immagini lato SDK: la verità
          // deve essere visibile a TUTTI i livelli)
          const cur = Array.isArray(m.input) ? m.input.join(",") : "text";
          if (cur !== probedVision.join(",")) {
            m.input = probedVision;
            visionFixed++;
          }
        }
      }
      await sleepMs(200); // throttle
    }
    saveCapsAll(caps);
    if (visionFixed > 0) {
      try { writeFileSync(modelsPath, JSON.stringify(modelsJson, null, 2)); } catch {}
    }
    process.stderr.write(`[caps-probe] provider ${providerName}: probe completata (${count} modelli, ${visionFixed} input vision corretti in models.json)\n`);
  } catch (e: any) {
    process.stderr.write(`[caps-probe] error ${providerName}: ${e?.message || e}\n`);
  }
}

// EVOLUZIONE (29 ago): re-probe dei thinking levels per i modelli GIÀ in cache.
// Se un provider aggiunge domani un livello nuovo (es. "ultra"), questa funzione
// lo scopre (probe a costo zero) e il max si aggiorna DA SOLO. Chiamata:
// all'avvio del sidecar + dopo ogni sync provider.
export async function refreshThinkingCapsEvolution(): Promise<void> {
  try {
    const config = readProvidersConfig();
    const caps = loadCapsAll();
    let updated = 0;
    for (const providerName of Object.keys((config.providers as any) || {})) {
      const pcfg = (config.providers as any)[providerName];
      if (!pcfg?.enabled || !pcfg?.baseUrl) continue;
      const baseUrl = String(pcfg.baseUrl);
      const apiKey = String(pcfg.apiKey || "");
      const isOllama = providerName.toLowerCase() === "ollama" || baseUrl.includes(":11434") || baseUrl.includes("ollama.com");
      const host = hostOfUrl(baseUrl);
      for (const key of Object.keys(caps)) {
        if (!key.startsWith(host + "/")) continue;
        const modelId = key.substring(host.length + 1);
        const probed = await probeModelThinking(baseUrl, apiKey, modelId, isOllama);
        if (probed) {
          const prevMax = caps[key]?.maxLevel;
          if (probed.maxLevel !== prevMax) {
            caps[key] = { ...(caps[key] || {}), ...probed };
            updated++;
            process.stderr.write(`[caps-evolve] ${modelId}: max ${prevMax} → ${probed.maxLevel} (evoluzione auto)\n`);
          } else {
            caps[key] = { ...(caps[key] || {}), allowed: probed.allowed, learnedAt: probed.learnedAt, source: "probe" };
          }
        }
        await sleepMs(150);
      }
    }
    if (updated > 0) saveCapsAll(caps);
  } catch (e: any) {
    process.stderr.write(`[caps-evolve] error: ${e?.message || e}\n`);
  }
}

// Probe per UN SOLO modello (usata al cambio modello in chat: la cache si riempie
// in BACKGROUND mentre l'utente scrive il primo messaggio — mai costo al primo uso).
export async function probeSingleModelCaps(modelId: string): Promise<void> {
  try {
    const modelsPath = join(homedir(), ".quinki", "models.json");
    const modelsJson = JSON.parse(readFileSync(modelsPath, "utf8"));
    for (const providerName of Object.keys(modelsJson?.providers || {})) {
      const p = modelsJson.providers[providerName];
      const m = (p?.models || []).find((mm: any) => mm?.id === modelId);
      if (!m) continue;
      const config = readProvidersConfig();
      const pcfg = (config.providers as any)?.[providerName];
      const baseUrl = String(pcfg?.baseUrl || p?.baseUrl || "");
      const apiKey = String(pcfg?.apiKey || p?.apiKey || "");
      if (!baseUrl) return;
      const isOllama = providerName.toLowerCase() === "ollama" || baseUrl.includes(":11434") || baseUrl.includes("ollama.com");
      const caps = loadCapsAll();
      const key = capsKeyFor(baseUrl, modelId);
      const entry = caps[key] || {};
      const stale = !entry?.maxLevel || !entry?.learnedAt ||
        (Date.now() - new Date(entry.learnedAt).getTime() > 7 * 24 * 3600 * 1000);
      if (m.reasoning && stale) {
        const probed = await probeModelThinking(baseUrl, apiKey, modelId, isOllama);
        if (probed) {
          caps[key] = { ...(caps[key] || {}), ...probed };
          process.stderr.write(`[caps-probe] ${modelId}: thinking max=${probed.maxLevel} (al cambio modello)\n`);
        }
      }
      const hasManualInput = Array.isArray((pcfg as any)?.modelData) &&
        (pcfg as any).modelData.some((md: any) => md?.id === modelId && Array.isArray(md?.input));
      if (!hasManualInput) {
        const v = await probeModelVision(baseUrl, apiKey, modelId);
        if (v) {
          caps[key] = { ...(caps[key] || {}), visionInput: v, visionSource: "probe", visionLearnedAt: new Date().toISOString() };
          if ((m.input || []).join(",") !== v.join(",")) {
            m.input = v;
            try { writeFileSync(modelsPath, JSON.stringify(modelsJson, null, 2)); } catch {}
          }
        }
      }
      saveCapsAll(caps);
      return;
    }
  } catch (e: any) {
    process.stderr.write(`[caps-probe] single-model error: ${e?.message || e}\n`);
  }
}

// ============================================================
// Ollama Cloud (ollama.com) — API key, usage con reset-sync
// ============================================================

export interface OllamaCloudUsage {
  ok: boolean;
  error?: string;
  activity?: { cost?: string; models?: { name: string; cost?: string }[] };
  session?: { usage: number; models: { name: string; request_count: number }[]; resetInSec: number; estimated: boolean };
  weekly?: { usage: number; models: { name: string; request_count: number }[]; resetInSec: number; estimated: boolean };
}

const SESSION_WINDOW_MS = 5 * 60 * 60 * 1000;   // 5h
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const ollamaStatsPath = join(agentDir, "quinki-ollama-stats.json");

interface OllamaStats { lastSession?: number; lastWeekly?: number; sessionAnchor?: number; weeklyAnchor?: number }
function readOllamaStats(): OllamaStats {
  try { return JSON.parse(readFileSync(ollamaStatsPath, "utf8")); } catch { return {}; }
}
function writeOllamaStats(s: OllamaStats): void {
  try { writeFileSync(ollamaStatsPath, JSON.stringify(s, null, 2), "utf8"); } catch {}
}

export function ollamaCloudKeySet(): boolean {
  try {
    const cfg = readProvidersConfig();
    const k = (cfg.providers as any).Ollama?.cloudApiKey;
    return !!k;
  } catch { return false; }
}

export function setOllamaCloudKey(key: string): void {
  const cfg = readProvidersConfig();
  const oll = (cfg.providers as any).Ollama;
  if (!oll) throw new Error("Ollama provider missing");
  oll.cloudApiKey = isEncrypted(key) ? key : encryptString(key.trim());
  writeProvidersConfig(cfg);
}

export function clearOllamaCloudKey(): void {
  const cfg = readProvidersConfig();
  const oll = (cfg.providers as any).Ollama;
  if (oll) {
    // flag esplicito: senza, l'anti-loss di writeProvidersConfig ri-aggiunge
    // la chiave esistente e il logout non cancella mai nulla.
    (oll as any).cloudApiKeyDelete = true;
    delete (oll as any).cloudApiKey;
    writeProvidersConfig(cfg);
  }
  try { writeOllamaStats({}); } catch {}
}

// prossimo confine della griglia UTC 5h (00/05/10/15/20 UTC)
function nextSessionGridBoundary(now: number): number {
  const d = new Date(now);
  const h = d.getUTCHours();
  const nextSlot = (Math.floor(h / 5) + 1) * 5; // 5,10,15,20,25→(0 del giorno dopo)
  const out = new Date(d);
  out.setUTCHours(nextSlot % 24, 0, 0, 0);
  if (nextSlot >= 24) out.setUTCDate(out.getUTCDate() + 1);
  return out.getTime();
}

// prossimo lunedì 00:00 UTC
function nextMondayUtc(now: number): number {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0=dom,1=lun
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  const daysToMonday = ((8 - day) % 7) || 7; // se lunedì → 7
  out.setUTCDate(out.getUTCDate() + daysToMonday);
  return out.getTime();
}

export async function getOllamaCloudUsage(): Promise<OllamaCloudUsage> {
  try {
    const cfg = readProvidersConfig();
    const enc = (cfg.providers as any).Ollama?.cloudApiKey;
    if (!enc) return { ok: false, error: "no_key" };
    const key = isEncrypted(enc) ? decryptString(enc) : enc;
    const res = await fetch("https://ollama.com/api/usage", { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data: any = await res.json();

    // reset-sync: se usage scende tra due poll → reset osservato → ancora = ora
    const stats = readOllamaStats();
    const nowS = data?.limits?.session?.usage;
    const nowW = data?.limits?.weekly?.usage;
    if (typeof nowS === "number" && typeof stats.lastSession === "number" && nowS < stats.lastSession - 1e-9) {
      stats.sessionAnchor = Date.now();
    }
    if (typeof nowW === "number" && typeof stats.lastWeekly === "number" && nowW < stats.lastWeekly - 1e-9) {
      stats.weeklyAnchor = Date.now();
    }
    stats.lastSession = typeof nowS === "number" ? nowS : stats.lastSession;
    stats.lastWeekly = typeof nowW === "number" ? nowW : stats.lastWeekly;
    writeOllamaStats(stats);

    const now = Date.now();
    // session
    let sessionResetAt: number, sessionEstimated: boolean;
    if (stats.sessionAnchor) { sessionResetAt = stats.sessionAnchor + SESSION_WINDOW_MS; sessionEstimated = false; }
    else { sessionResetAt = nextSessionGridBoundary(now); sessionEstimated = true; }
    // weekly
    let weeklyResetAt: number, weeklyEstimated: boolean;
    if (stats.weeklyAnchor) { weeklyResetAt = stats.weeklyAnchor + WEEKLY_WINDOW_MS; weeklyEstimated = false; }
    else { weeklyResetAt = nextMondayUtc(now); weeklyEstimated = true; }
    // se il countdown calcolato è scaduto (poll salta un reset), stima col default
    if (sessionResetAt <= now) { sessionResetAt = nextSessionGridBoundary(now); sessionEstimated = true; }
    if (weeklyResetAt <= now) { weeklyResetAt = nextMondayUtc(now); weeklyEstimated = true; }

    return {
      ok: true,
      activity: data?.activity ? { cost: data.activity.cost, models: data.activity.models } : undefined,
      session: {
        usage: typeof nowS === "number" ? nowS : 0,
        models: data?.limits?.session?.models || [],
        resetInSec: Math.max(0, Math.round((sessionResetAt - now) / 1000)),
        estimated: sessionEstimated,
      },
      weekly: {
        usage: typeof nowW === "number" ? nowW : 0,
        models: data?.limits?.weekly?.models || [],
        resetInSec: Math.max(0, Math.round((weeklyResetAt - now) / 1000)),
        estimated: weeklyEstimated,
      },
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ============================================================
// Ollama install detection + auto-install (macOS)
// ============================================================

// === OpenRouter: contesto REALE (top_provider) per TUTTI i modelli (04 set) ===
// Una sola chiamata models API corregge contextWindow di OGNI modello OpenRouter
// in models.json E nel modelData del providers config (la fonte del sync).
export async function refreshOpenRouterContextWindows(apiKey: string): Promise<number> {
  try {
    const mr = await fetchWithTimeout("https://openrouter.ai/api/v1/models", { headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) } }, 30000);
    if (!mr.ok) return 0;
    const md: any = await mr.json();
    const real: Record<string, number> = {};
    for (const m of (md?.data || [])) {
      const rc = Number(m?.top_provider?.context_length || 0);
      if (rc) real[String(m.id)] = rc;
    }
    let fixed = 0;
    const mm = JSON.parse(readFileSync(modelsPath, "utf8") || "{}");
    for (const pv of Object.values(mm.providers || {})) {
      for (const mo of ((pv as any).models || [])) {
        const baseId = String(mo.id).split(":")[0];
        const rc = real[baseId] ?? real[String(mo.id)];
        if (rc && mo.contextWindow && mo.contextWindow !== rc) { mo.contextWindow = rc; fixed++; }
      }
    }
    if (fixed > 0) writeFileSync(modelsPath, JSON.stringify(mm, null, 2), "utf8");
    let fixed2 = 0;
    const pc = readProvidersConfig();
    for (const pv of Object.values(pc.providers || {})) {
      for (const mo of ((pv as any).modelData || [])) {
        const baseId = String(mo.id).split(":")[0];
        const rc = real[baseId] ?? real[String(mo.id)];
        if (rc && mo.contextWindow && mo.contextWindow !== rc) { mo.contextWindow = rc; fixed2++; }
      }
    }
    if (fixed2 > 0) writeProvidersConfig(pc);
    if (fixed + fixed2 > 0) process.stderr.write(`[providers] OpenRouter context windows corrected: ${fixed}+${fixed2}\n`);
    return fixed + fixed2;
  } catch (e: any) { process.stderr.write(`[providers] refreshOpenRouterContextWindows error: ${e?.message || e}\n`); return 0; }
}

export async function ollamaInstalled(): Promise<{ installed: boolean; version?: string }> {
  try {
    if (existsSync("/Applications/Ollama.app")) {
      try {
        const v = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(1200) });
        if (v.ok) { const j: any = await v.json(); return { installed: true, version: j?.version || "" }; }
      } catch {}
      return { installed: true };
    }
    const res = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(1500) });
    if (res.ok) { const j: any = await res.json(); return { installed: true, version: j?.version || "" }; }
    return { installed: false };
  } catch { return { installed: false }; }
}

export async function ollamaInstall(): Promise<{ ok: boolean; error?: string }> {
  // Download REALE con stream: percentuale vera calcolata su content-length,
  // scritta nel file di stato ~2 volte al secondo. Poi estrazione + installazione.
  const statusPath = join(agentDir, "quinki-ollama-install.json");
  const write = (obj: any) => { try { writeFileSync(statusPath, JSON.stringify(obj), "utf8"); } catch {} };
  (async () => {
    const tmpZip = "/tmp/quinki-ollama-darwin.zip";
    const tmpDir = "/tmp/quinki-ollama-extract";
    try {
      write({ status: "downloading", pct: 0 });
      const { createWriteStream } = await import("node:fs");
      const { exec } = await import("node:child_process");
      const res = await fetch("https://github.com/ollama/ollama/releases/latest/download/Ollama-darwin.zip", { redirect: "follow" });
      if (!res.ok || !res.body) throw new Error(`download HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length") || 0);
      const f = createWriteStream(tmpZip);
      let received = 0;
      let lastWrite = 0;
      const reader = (res.body as any).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        f.write(Buffer.from(value));
        const now = Date.now();
        if (now - lastWrite > 400) {
          lastWrite = now;
          write({ status: "downloading", pct: total ? Math.min(100, Math.round((received / total) * 100)) : 0, mb: Math.round(received / 1048576), totalMb: total ? Math.round(total / 1048576) : 0 });
        }
      }
      await new Promise((r) => f.end(r));
      write({ status: "extracting", pct: 100 });
      await new Promise<void>((res2, rej2) => exec(`rm -rf "${tmpDir}" && ditto -x -k "${tmpZip}" "${tmpDir}"`, (e) => e ? rej2(new Error("extract failed: " + e.message)) : res2()));
      write({ status: "installing", pct: 100 });
      await new Promise<void>((res2, rej2) => exec(`pkill -f "Ollama.app/Contents/MacOS" 2>/dev/null; sleep 1; rm -rf /Applications/Ollama.app && mv "${tmpDir}/Ollama.app" /Applications/Ollama.app && open /Applications/Ollama.app`, (e) => e ? rej2(new Error("install failed: " + e.message)) : res2()));
      write({ status: "done", pct: 100 });
    } catch (e: any) {
      write({ status: "error", error: String(e?.message || e) });
    }
  })();
  return { ok: true };
}

export function ollamaInstallStatus(): any {
  try {
    const p = join(agentDir, "quinki-ollama-install.json");
    if (!existsSync(p)) return { status: "idle" };
    return JSON.parse(readFileSync(p, "utf8"));
  } catch { return { status: "idle" }; }
}
