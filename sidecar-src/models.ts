import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const agentDir = process.env.QUINKI_AGENT_DIR || join(homedir(), ".pi", "agent");
const modelsPath = join(agentDir, "models.json");

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

export function readModelsFromDisk(): ModelInfo[] {
  const out: ModelInfo[] = [];
  try {
    if (!existsSync(modelsPath)) return out;
    const raw = readFileSync(modelsPath, "utf8");
    const json = JSON.parse(raw);
    const providers = json?.providers || {};
    for (const [provider, pcfg] of Object.entries(providers) as [string, any][]) {
      const models = Array.isArray(pcfg?.models) ? pcfg.models : [];
      for (const m of models) {
        const id = typeof m === "string" ? m : m?.id;
        if (!id) continue;
        out.push({
          provider,
          id,
          name: typeof m === "string" ? m : (m?.name || m?.id),
          reasoning: typeof m === "string" ? false : !!m?.reasoning,
          contextWindow: typeof m === "string" ? undefined : (typeof m?.contextWindow === "number" ? m.contextWindow : undefined),
          maxTokens: typeof m === "string" ? undefined : (typeof m?.maxTokens === "number" ? m.maxTokens : undefined),
          input: typeof m === "string" ? undefined : (Array.isArray(m?.input) ? m.input : undefined),
        });
      }
    }
  } catch {}
  return out;
}

export function getFirstAvailableModelId(): string {
  const models = readModelsFromDisk();
  const preferred = models.find(m => m.id === "minimax-m3:cloud");
  if (preferred) return preferred.id;
  if (models.length > 0) return models[0].id;
  return "";
}
