// ─────────────────────────────────────────────────────────────────────────────
// MCP (Model Context Protocol) support for Quinki.
// - Registry: ~/.quinki/mcpServers.json
// - Installed packages: ~/.quinki/mcp/<id>/ (created via `bun install`, no Node)
// - Transports: stdio (package, spawned with Bun) and HTTP (remote URL, POST JSON-RPC)
// - Uninstall removes the folder AND the config entry (total removal).
// ─────────────────────────────────────────────────────────────────────────────
import * as path from "node:path";
import * as fs from "node:fs";
import { homedir } from "node:os";
import { spawn, spawnSync, ChildProcess } from "node:child_process";
import { Type } from "typebox";

export interface McpServerConfig {
  id: string;
  name: string;
  type: "package" | "url" | "command";
  command?: string[]; // per type=command: comando custom da lanciare (es. ["bunx","some-pkg"])
  source: string; // npm package name (package) or URL (url)
  args: string[]; // extra launch arguments (e.g. paths for filesystem server)
  env: Record<string, string>;
  bin?: string; // discovered bin name inside node_modules/.bin (package)
  createdAt?: number;
}

const MCP_DIR = path.join(homedir(), ".quinki", "mcp");
const MCP_REGISTRY = path.join(homedir(), ".quinki", "mcpServers.json");

export function mcpInstallDir(id: string): string {
  return path.join(MCP_DIR, id);
}

export function readMcpServers(): McpServerConfig[] {
  try {
    const raw = fs.readFileSync(MCP_REGISTRY, "utf-8");
    const j = JSON.parse(raw);
    return Array.isArray(j?.servers) ? j.servers : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  try {
    fs.mkdirSync(path.dirname(MCP_REGISTRY), { recursive: true });
    fs.writeFileSync(MCP_REGISTRY, JSON.stringify({ servers }, null, 2));
  } catch {}
}

// Risolve un comando custom: "bun x …", "bunx …", "npx …" vengono mappati sul Bun presente.
export function resolveCommandLaunch(cmd: string[]): string[] {
  if (!cmd || cmd.length === 0) return cmd || [];
  const bun = findBunPath();
  if (!bun) return cmd;
  if (cmd[0] === "bun") return [bun, ...cmd.slice(1)];
  if (cmd[0] === "bunx" || cmd[0] === "npx") return [bun, "x", ...cmd.slice(1)];
  return cmd;
}

export function findBunPath(): string | null {
  const candidates = [
    path.join(homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
    "/usr/bin/bun",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const paths = (process.env.PATH || "").split(":");
  for (const p of paths) {
    if (!p) continue;
    try {
      const c = path.join(p, "bun");
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return null;
}

// ── Installa un server MCP di tipo package (npm) usando Bun ──
export function installPackageServer(id: string, source: string): { bin?: string; error?: string } {
  const dir = mcpInstallDir(id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        { name: `quinki-mcp-${id}`, private: true, dependencies: { [source]: "*" } },
        null,
        2
      )
    );
    const bun = findBunPath();
    if (!bun) {
      return { error: "Bun runtime not found. Install Bun or use an URL MCP server." };
    }
    const res = spawnSync(bun, ["install", "--no-save"], {
      cwd: dir,
      env: { ...process.env, PATH: path.dirname(bun) + ":" + (process.env.PATH || "") },
      encoding: "utf-8",
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (res.status !== 0) {
      return { error: `bun install failed: ${(res.stderr || res.stdout || "").slice(0, 600)}` };
    }
    // Trova il bin: PREFERISCI il bin del pacchetto stesso (node_modules/<source>/package.json).
    // La scansione di node_modules/.bin prendeva il primo alfabetico (es. node-which) → sbagliato.
    let bin: string | undefined;
    try {
      const pkgRaw = fs.readFileSync(path.join(dir, "node_modules", source, "package.json"), "utf-8");
      const pkg = JSON.parse(pkgRaw);
      if (typeof pkg.bin === "string") {
        // bin può essere un percorso relativo: prendiamo il nome file (senza estensione non importa)
        bin = pkg.bin.split("/").pop() || undefined;
      } else if (pkg.bin && typeof pkg.bin === "object") {
        const keys = Object.keys(pkg.bin);
        if (keys.length > 0) bin = keys[0];
      }
    } catch {}
    if (!bin) {
      // Fallback: primo entry non-`.` in node_modules/.bin
      try {
        const binDir = path.join(dir, "node_modules", ".bin");
        const bins = fs.readdirSync(binDir).filter((b) => !b.startsWith("."));
        if (bins.length > 0) bin = bins[0];
      } catch {}
    }
    if (!bin) {
      return { error: "Installed package has no executable bin." };
    }
    return { bin };
  } catch (e: any) {
    return { error: String(e?.message || e) };
  }
}

// ── Processi attivi per server (per kill alla rimozione) ──
const activeProcs = new Map<string, ChildProcess[]>();

export function killServerProcs(id: string): void {
  const procs = activeProcs.get(id) || [];
  for (const p of procs) {
    try { p.kill(); } catch {}
  }
  activeProcs.delete(id);
}

// ── Client stdio (package): JSON-RPC su stdin/stdout, spawn con Bun ──
export class StdioMcpClient {
  private proc?: ChildProcess;
  private seq = 0;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void; t: any }>();
  private buf = "";

  constructor(
    private serverId: string,
    private launch: string[],
    private cwd?: string,
    private envVars?: Record<string, string>
  ) {}

  private ensureStarted(): void {
    if (this.proc && this.proc.exitCode === null) return;
    const env = { ...process.env, ...(this.envVars || {}) } as Record<string, string>;
    const bun = findBunPath();
    if (bun) env.PATH = path.dirname(bun) + ":" + (env.PATH || "");
    const child = spawn(this.launch[0], this.launch.slice(1), {
      cwd: this.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = child;
    const id = this.serverId;
    activeProcs.set(id, [...(activeProcs.get(id) || []), child]);
    child.stdout!.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString("utf-8");
      let idx: number;
      while ((idx = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, idx).trim();
        this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg && msg.id != null && this.pending.has(msg.id)) {
            const p = this.pending.get(msg.id)!;
            this.pending.delete(msg.id);
            clearTimeout(p.t);
            if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
            else p.res(msg.result);
          }
        } catch {}
      }
    });
    child.on("error", (e) => this.failAll(String(e)));
    child.on("exit", () => {
      this.failAll("MCP server exited");
      this.proc = undefined;
      const list = activeProcs.get(id) || [];
      activeProcs.set(id, list.filter((p) => p !== child));
    });
  }

  private failAll(msg: string): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.t);
      p.rej(new Error(msg));
    }
    this.pending.clear();
  }

  // Nessun timeout: le richieste attendono la risposta; l'utente può fermare con Stop.
  private request(method: string, params: any): Promise<any> {
    this.ensureStarted();
    const id = ++this.seq;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej, t: undefined });
      this.proc!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "quinki", version: "1.1.0" },
    });
    try {
      this.proc!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    } catch {}
  }

  async listTools(): Promise<any[]> {
    this.ensureStarted();
    await this.initialize();
    const r = await this.request("tools/list", {});
    return r?.tools || [];
  }

  async callTool(name: string, args: any): Promise<any> {
    const r = await this.request("tools/call", { name, arguments: args || {} });
    return r;
  }

  close(): void {
    try { this.proc?.kill(); } catch {}
    this.proc = undefined;
  }
}

// ── Client HTTP (URL remoto): POST JSON-RPC, risposta JSON ──
async function httpRequest(url: string, method: string, params: any, envVars?: Record<string, string>): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const hdr = envVars?.headers;
  if (hdr && typeof hdr === "object") Object.assign(headers, hdr);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!res.ok) throw new Error(`MCP HTTP error ${res.status}`);
  const j: any = await res.json();
  if (j?.error) throw new Error(JSON.stringify(j.error));
  return j?.result;
}

export async function httpListTools(url: string, envVars?: Record<string, string>): Promise<any[]> {
  const r = await httpRequest(url, "tools/list", {}, envVars);
  return r?.tools || [];
}

export async function httpCallTool(url: string, name: string, args: any, envVars?: Record<string, string>): Promise<any> {
  return httpRequest(url, "tools/call", { name, arguments: args || {} }, envVars);
}

// ── Conversione JSON Schema (inputSchema MCP) → TypeBox (defineTool parameters) ──
export function mcpSchemaToTypeBox(schema: any): any {
  const props: Record<string, any> = {};
  const required = new Set(Array.isArray(schema?.required) ? schema.required : []);
  for (const [k, v] of Object.entries((schema as any)?.properties || {})) {
    const ts = jsonSchemaToType(v);
    props[k] = required.has(k) ? ts : Type.Optional(ts);
  }
  return Type.Object(props);
}

function jsonSchemaToType(s: any): any {
  if (!s || typeof s !== "object") return Type.Any();
  const desc = typeof s?.description === "string" ? s.description : undefined;
  switch (s.type) {
    case "string": return Type.String(desc ? { description: desc } : {});
    case "number": case "integer": return Type.Number(desc ? { description: desc } : {});
    case "boolean": return Type.Boolean(desc ? { description: desc } : {});
    case "array": return Type.Array(jsonSchemaToType(s.items), desc ? { description: desc } : {});
    case "object": return mcpSchemaToTypeBox(s);
    default:
      if (s.enum && Array.isArray(s.enum)) {
        return Type.Union(s.enum.map((v: any) => { switch (typeof v) { case "string": return Type.Literal(v); case "number": return Type.Number(); case "boolean": return Type.Boolean(); default: return Type.Any(); } }), desc ? { description: desc } : {});
      }
      return Type.Any(desc ? { description: desc } : {});
  }
}

// ── Risultato tools/call → testo leggibile dall'agente ──
export function mcpResultToText(res: any): string {
  if (!res) return "(no result)";
  if (typeof res === "string") return res;
  const parts: string[] = [];
  if (Array.isArray(res.content)) {
    for (const c of res.content) {
      if (!c) continue;
      if (c.type === "text") parts.push(String(c.text ?? ""));
      else if (c.type === "image") parts.push(`[image data ${String(c.data || "").slice(0, 40)}...]`);
      else if (c.type === "resource") parts.push(String(c.text ?? c.uri ?? ""));
    }
  }
  if (res.structuredContent !== undefined) {
    try {
      parts.push(JSON.stringify(res.structuredContent, null, 2));
    } catch {}
  }
  if (res.isError && parts.length === 0) parts.push("(server returned an error)");
  return parts.filter(Boolean).join("\n") || "(empty result)";
}