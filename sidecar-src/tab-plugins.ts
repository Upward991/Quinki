// tab-plugins.ts — A4.3: back-end delle tab (server.js)
// Scansiona ~/.quinki/tabs/*/server.js, carica i moduli e registra i loro RPC.
// Il ctx passato agli handler è LIMITATO: dataDir (solo la cartella della tab)
// + call (solo i metodi dichiarati nel manifest permissions) + log.
// Il server.js è un modulo CommonJS: module.exports = { rpc: { '<id>:<method>': async (params, ctx) => ... } }

import * as fs from "fs";
import * as path from "path";
import { homedir } from "node:os";

export interface TabPluginCtx {
  dataDir: string; // ~/.quinki/tabs/<id>/data/ — la tab legge/scrive SOLO qui
  call: (method: string, params?: any) => Promise<any>; // SOLO metodi permessi dal manifest
  log: (msg: string) => void;
}

export interface TabPlugin {
  id: string;
  manifest: any;
  rpc: Record<string, (params: any, ctx: TabPluginCtx) => Promise<any>>;
  dataDir: string;
}

const plugins = new Map<string, TabPlugin>();

export function tabsRootDir(): string {
  return path.join(homedir(), ".quinki", "tabs");
}

export function tabDir(id: string): string {
  return path.join(tabsRootDir(), id);
}

// Carica un server.js valutandolo con un contesto CommonJS (module/exports/require).
// NB: NON usiamo require() diretto del file (il binario compilato potrebbe non
// risolverlo a runtime) — valutiamo il codice con new Function e passiamo require.
function loadPlugin(id: string): TabPlugin | null {
  const dir = tabDir(id);
  const serverPath = path.join(dir, "server.js");
  const manifestPath = path.join(dir, "quinki.config.json");
  if (!fs.existsSync(serverPath)) return null;
  let manifest: any = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch {}
  try {
    const code = fs.readFileSync(serverPath, "utf8");
    const module = { exports: {} as any };
    const fn = new Function("module", "exports", "require", code);
    fn(module, module.exports, require);
    const mod = module.exports || {};
    const rpc = (mod && mod.rpc) || {};
    const dataDir = path.join(dir, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const plugin: TabPlugin = { id, manifest, rpc, dataDir };
    plugins.set(id, plugin);
    process.stderr.write(`[tab-plugin] loaded ${id} (${Object.keys(rpc).length} rpc)\n`);
    return plugin;
  } catch (e: any) {
    process.stderr.write(`[tab-plugin] load error ${id}: ${e?.message || String(e)}\n`);
    return null;
  }
}

// Scansiona tutte le tab installate e carica i server.js (al boot)
export function loadAllTabPlugins(): number {
  let n = 0;
  try {
    const root = tabsRootDir();
    if (!fs.existsSync(root)) return 0;
    for (const id of fs.readdirSync(root)) {
      const dir = path.join(root, id);
      try { if (!fs.statSync(dir).isDirectory()) continue; } catch { continue; }
      if (loadPlugin(id)) n++;
    }
  } catch {}
  return n;
}

// Registra/aggiorna il plugin di una tab (dopo install/update)
export function reloadTabPlugin(id: string): boolean {
  plugins.delete(id);
  return !!loadPlugin(id);
}

// Rimuove il plugin di una tab (dopo uninstall)
export function unloadTabPlugin(id: string) {
  plugins.delete(id);
}

// Dispatch: se il metodo è un RPC di un plugin, lo esegue con ctx limitato.
// Formato metodo: "<tabId>:<method>" (es. "knowledge:stats").
export async function tryHandleTabPluginRpc(method: string, params: any): Promise<{ handled: boolean; result?: any; error?: string }> {
  const sep = method.indexOf(":");
  if (sep <= 0) return { handled: false };
  const id = method.slice(0, sep);
  const plugin = plugins.get(id);
  if (!plugin) return { handled: false };
  // Le chiavi rpc del server.js sono il NOME COMPLETO (es. "knowledge:stats")
  const handler = plugin.rpc[method];
  if (!handler) return { handled: true, error: `Unknown plugin method: ${method}` };
  try {
    const ctx: TabPluginCtx = {
      dataDir: plugin.dataDir,
      call: async (m: string, p?: any) => {
        // ctx.call: SOLO i metodi dichiarati nel manifest (permissions)
        const perms = Array.isArray(plugin.manifest?.permissions) ? plugin.manifest.permissions : [];
        const allowed = perms.some((perm: string) => m === perm || m.startsWith(perm + ":"));
        if (!allowed) throw new Error(`Permission denied: ${m} (not declared in manifest permissions)`);
        const h = (globalThis as any).__quinki_handleRpc;
        if (typeof h !== "function") throw new Error("sidecar dispatch not ready");
        return h(m, p || {});
      },
      log: (msg: string) => process.stderr.write(`[tab:${id}] ${msg}\n`),
    };
    const result = await handler(params || {}, ctx);
    return { handled: true, result };
  } catch (e: any) {
    return { handled: true, error: String(e?.message || e) };
  }
}
