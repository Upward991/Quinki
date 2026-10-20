/**
 * manage-tools.ts — i tool con cui un agente GESTISCE la squadra, la chat, le skill e gli MCP.
 *
 * REGOLE (20 ott 2026):
 * - I tool NON riscrivono la logica: chiamano le funzioni del motore (ctx) — una sola verità.
 * - Agiscono SOLO sulla chat corrente: sessionKey è iniettato dal motore, mai scelto dal modello.
 * - Ogni mutazione viene loggata dal motore (ctx.log) e notifica le sessioni vive.
 * - Install da qualsiasi fonte: market:<id>, repo GitHub, cartella, file raw, gist.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import { defineTool } from "./vendor/@earendil-works/pi-coding-agent/dist/index.js";
import { readMcpServers, saveMcpServers } from "./mcp";

export type ManageCtx = {
  agentDir: string;
  sessionKey: string;
  callerAgentId: string;
  chatTree: () => { tree: Record<string, string[]>; root: string; members: string[] };
  overrides: () => Record<string, any>;
  graphVersion: () => string;
  chatAdd: (parentId: string, ids: string[]) => any;
  chatRemove: (ids: string[]) => any;
  chatSetOrchestrator: (id: string | null) => any;
  chatSetOverride: (agentId: string, model?: string | null, thinking?: string | null) => any;
  graphUndo: () => any;
  graphRedo: () => any;
  chatCreate: (label: string, agentIds: string[], tree?: Record<string, string[]>) => string;
  log: (tag: string, data: any) => void;
};

const ok = (data: any) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const err = (msg: string) => ({ content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true });

const slugify = (v: string) =>
  String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "item";

const q = (ctx: ManageCtx, ...p: string[]) => path.join(ctx.agentDir, ...p);

function readJson(p: string): any { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function writeJson(p: string, v: any) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(v, null, 2)); }

export function listAgentIds(ctx: ManageCtx): string[] {
  try {
    return fs.readdirSync(path.join(ctx.agentDir, "agents")).filter((d) => {
      try { return fs.statSync(path.join(ctx.agentDir, "agents", d)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }
}
export function readAgentCfg(ctx: ManageCtx, id: string): any { return readJson(path.join(ctx.agentDir, "agents", id, "config.json")); }
export function writeAgentCfg(ctx: ManageCtx, id: string, cfg: any) { writeJson(path.join(ctx.agentDir, "agents", id, "config.json"), cfg); }
export function readAgentPrompt(ctx: ManageCtx, id: string): string {
  try { return fs.readFileSync(path.join(ctx.agentDir, "agents", id, "PROMPT.md"), "utf8"); } catch { return ""; }
}
export function writeAgentPrompt(ctx: ManageCtx, id: string, body: string) {
  const p = path.join(ctx.agentDir, "agents", id, "PROMPT.md");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
}
export function listSkills(ctx: ManageCtx): { id: string; name: string; description: string }[] {
  const out: any[] = [];
  const dirs = [path.join(ctx.agentDir, "skills"), path.join(ctx.agentDir, "agents")];
  for (const base of dirs) {
    let entries: string[] = [];
    try { entries = fs.readdirSync(base); } catch { continue; }
    for (const e of entries) {
      const p = base.endsWith("agents") ? path.join(base, e, "skills") : path.join(base, e);
      try {
        const f = path.join(p, "SKILL.md");
        if (!fs.existsSync(f)) continue;
        const txt = fs.readFileSync(f, "utf8");
        const fm = parseFrontmatter(txt);
        out.push({ id: e, name: fm.name || e, description: fm.description || "" });
      } catch {}
    }
  }
  return out;
}
function parseFrontmatter(txt: string): Record<string, string> {
  const m = String(txt).match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
function skillDir(ctx: ManageCtx, id: string) { return path.join(ctx.agentDir, "skills", id); }

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": "quinki", ...headers } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return await r.text();
}
function parseGithub(url: string): { owner: string; repo: string; ref: string; sub: string } | null {
  try {
    const u = new URL(url);
    if (!/github\.com$/.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    let ref = "HEAD", sub = "";
    if (parts[2] === "tree" || parts[2] === "blob") { ref = parts[3] || "HEAD"; sub = parts.slice(4).join("/"); }
    return { owner, repo: repo.replace(/\.git$/, ""), ref, sub };
  } catch { return null; }
}
async function ghTree(owner: string, repo: string, ref: string): Promise<string[]> {
  const j: any = JSON.parse(await fetchText(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { Accept: "application/vnd.github+json" }));
  return Array.isArray(j?.tree) ? j.tree.map((t: any) => String(t.path)) : [];
}
async function ghRaw(owner: string, repo: string, ref: string, p: string): Promise<string> {
  return await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${p}`);
}
const MARKET_CATALOGS = [
  "https://raw.githubusercontent.com/Upward991/quinki-market/main/catalog.json",
];
async function marketCatalog(): Promise<any[]> {
  const mem: any[] = (globalThis as any).__quinki_market_catalog || [];
  if (Array.isArray(mem) && mem.length) return mem;
  for (const u of MARKET_CATALOGS) {
    try {
      const j: any = JSON.parse(await fetchText(u));
      const items = Array.isArray(j) ? j : (j.items || j.packages || []);
      if (Array.isArray(items) && items.length) return items;
    } catch {}
  }
  return [];
}

// ─────────────────────────────────────────────────────────────────────────────
export function buildManageTools(ctx: ManageCtx): any[] {
  const S = () => ctx.chatTree();
  const nameOf = (id: string) => { try { return readAgentCfg(ctx, id)?.name || id; } catch { return id; } };

  const tools: any[] = [];

  // ═══════════ AGENTI ═══════════
  tools.push(defineTool({
    name: "agent_list", label: "List agents",
    description: "List all agents with id, name, model, thinking, skills, tools and where they are used.",
    parameters: Type.Object({}),
    async execute() {
      const st = S();
      const list = listAgentIds(ctx).map((id) => {
        const c = readAgentCfg(ctx, id) || {};
        return { id, name: c.name || id, description: c.description || "", model: c.model || null, thinking: c.thinkingLevel || null,
          tools: c.tools || [], skills: c.skills || [], mcp: c.mcpServers || [], in_chat: st.members.includes(id),
          children: (st.tree[id] || []) };
      });
      return ok({ agents: list, chat: { agents: st.members, root: st.root, tree: st.tree } });
    },
  }));

  tools.push(defineTool({
    name: "agent_get", label: "Get agent",
    description: "Read one agent: config and full PROMPT.md.",
    parameters: Type.Object({ agent_id: Type.String() }),
    async execute(_id: string, p: any) {
      const id = String(p.agent_id || "");
      const c = readAgentCfg(ctx, id);
      if (!c) return err(`agent "${id}" not found`);
      return ok({ id, config: c, prompt: readAgentPrompt(ctx, id) });
    },
  }));

  tools.push(defineTool({
    name: "agent_create", label: "Create agent",
    description: "Create a new agent. Returns its id. Fields: name (required), description, prompt, model, thinking, tools[], skills[], mcp[].",
    parameters: Type.Object({
      name: Type.String({ description: "Display name" }),
      description: Type.Optional(Type.String()),
      prompt: Type.Optional(Type.String({ description: "Full PROMPT.md content" })),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.String({ description: "off | on" })),
      tools: Type.Optional(Type.Array(Type.String())),
      skills: Type.Optional(Type.Array(Type.String())),
      mcp: Type.Optional(Type.Array(Type.String())),
      id: Type.Optional(Type.String({ description: "Optional explicit id (slug)" })),
    }),
    async execute(_id: string, p: any) {
      const name = String(p.name || "").trim();
      if (!name) return err("name is required");
      let id = slugify(p.id || name);
      let n = 2; const base = id;
      while (fs.existsSync(path.join(ctx.agentDir, "agents", id))) { id = `${base}-${n++}`; }
      const cfg: any = { name, description: p.description || "", tools: p.tools || ["read", "grep", "find", "ls", "write", "edit", "bash"], skills: p.skills || [] };
      if (p.model) cfg.model = p.model;
      if (p.thinking) cfg.thinkingLevel = p.thinking;
      if (p.mcp?.length) cfg.mcpServers = p.mcp;
      writeAgentCfg(ctx, id, cfg);
      writeAgentPrompt(ctx, id, String(p.prompt || `# ${name}\n\nYou are ${name}.\n\n${
        p.description ? p.description + "\n" : ""}`));
      ctx.log("tool-agent-create", { id, name });
      return ok({ ok: true, id, name, config: cfg });
    },
  }));

  tools.push(defineTool({
    name: "agent_update", label: "Update agent",
    description: "Update an agent's config fields (name, description, model, thinking, tools, skills, mcp). Use agent_set_prompt for the prompt text.",
    parameters: Type.Object({
      agent_id: Type.String(),
      name: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      thinking: Type.Optional(Type.String()),
      tools: Type.Optional(Type.Array(Type.String())),
      skills: Type.Optional(Type.Array(Type.String())),
      mcp: Type.Optional(Type.Array(Type.String())),
    }),
    async execute(_id: string, p: any) {
      const id = String(p.agent_id || "");
      const cfg = readAgentCfg(ctx, id);
      if (!cfg) return err(`agent "${id}" not found`);
      if (p.name !== undefined) cfg.name = String(p.name);
      if (p.description !== undefined) cfg.description = String(p.description);
      if (p.model !== undefined) cfg.model = String(p.model) || undefined;
      if (p.thinking !== undefined) cfg.thinkingLevel = String(p.thinking) || undefined;
      if (Array.isArray(p.tools)) cfg.tools = p.tools.map(String);
      if (Array.isArray(p.skills)) cfg.skills = p.skills.map(String);
      if (Array.isArray(p.mcp)) cfg.mcpServers = p.mcp.map(String);
      writeAgentCfg(ctx, id, cfg);
      ctx.log("tool-agent-update", { id, fields: Object.keys(p).filter((k) => k !== "agent_id") });
      return ok({ ok: true, id, config: cfg });
    },
  }));

  tools.push(defineTool({
    name: "agent_set_prompt", label: "Set agent prompt",
    description: "Replace an agent's PROMPT.md with the given text.",
    parameters: Type.Object({ agent_id: Type.String(), prompt: Type.String() }),
    async execute(_id: string, p: any) {
      const id = String(p.agent_id || "");
      if (!readAgentCfg(ctx, id)) return err(`agent "${id}" not found`);
      writeAgentPrompt(ctx, id, String(p.prompt || ""));
      ctx.log("tool-agent-prompt", { id, len: String(p.prompt || "").length });
      return ok({ ok: true, id, length: String(p.prompt || "").length });
    },
  }));

  tools.push(defineTool({
    name: "agent_duplicate", label: "Duplicate agent",
    description: "Copy an agent (same config + prompt) under a new id/name — use this instead of adding the same agent twice to the tree.",
    parameters: Type.Object({ agent_id: Type.String(), name: Type.Optional(Type.String()) }),
    async execute(_id: string, p: any) {
      const src = String(p.agent_id || "");
      const cfg = readAgentCfg(ctx, src);
      if (!cfg) return err(`agent "${src}" not found`);
      const name = String(p.name || `${cfg.name || src} copy`);
      let id = slugify(name); let n = 2; const base = id;
      while (fs.existsSync(path.join(ctx.agentDir, "agents", id))) { id = `${base}-${n++}`; }
      writeAgentCfg(ctx, id, { ...cfg, name });
      writeAgentPrompt(ctx, id, readAgentPrompt(ctx, src));
      ctx.log("tool-agent-duplicate", { from: src, to: id });
      return ok({ ok: true, id, name });
    },
  }));

  tools.push(defineTool({
    name: "agent_delete", label: "Delete agent",
    description: "Delete an agent (config + prompt). It is removed from the current chat tree first. The root of a chat cannot be deleted here.",
    parameters: Type.Object({ agent_id: Type.String(), confirm: Type.Boolean() }),
    async execute(_id: string, p: any) {
      const id = String(p.agent_id || "");
      if (!p.confirm) return err("confirmation required: pass confirm: true");
      const st = S();
      if (st.root === id) return err("that agent is the root of this chat: assign the orchestrator role to another agent first");
      try { ctx.chatRemove([id]); } catch {}
      const dir = path.join(ctx.agentDir, "agents", id);
      if (!fs.existsSync(dir)) return err(`agent "${id}" not found`);
      fs.rmSync(dir, { recursive: true, force: true });
      ctx.log("tool-agent-delete", { id });
      return ok({ ok: true, deleted: id });
    },
  }));

  // ═══════════ CHAT / ALBERO ═══════════
  tools.push(defineTool({
    name: "chat_agents", label: "Chat agent tree",
    description: "Read the current chat: agents, root (orchestrator), tree, per-agent model/thinking overrides and graph_version.",
    parameters: Type.Object({}),
    async execute() {
      const st = S();
      return ok({ session: ctx.sessionKey, agents: st.members, root: st.root, tree: st.tree,
        overrides: ctx.overrides(), graph_version: ctx.graphVersion() });
    },
  }));

  tools.push(defineTool({
    name: "chat_add_agent", label: "Add agent to chat",
    description: "Add an agent to THIS chat. With parent_id it becomes that agent's sub-agent; without it, a child of the root. Use chat_set_orchestrator to change the root.",
    parameters: Type.Object({ agent_id: Type.String(), parent_id: Type.Optional(Type.String()) }),
    async execute(_id: string, p: any) {
      const id = String(p.agent_id || "");
      if (!readAgentCfg(ctx, id)) return err(`agent "${id}" not found`);
      const st = S();
      if (st.members.includes(id)) return err(`agent "${id}" is already in this chat`);
      const parent = String(p.parent_id || st.root || "");
      if (!parent) return err("this chat has no root yet");
      const r = ctx.chatAdd(parent, [id]);
      ctx.log("tool-chat-add", { id, parent });
      return ok({ ok: true, added: id, parent, chat: S() });
    },
  }));

  tools.push(defineTool({
    name: "chat_remove_agent", label: "Remove agent from chat",
    description: "Remove an agent from THIS chat: its children move up to its parent. The root cannot be removed.",
    parameters: Type.Object({ agent_id: Type.String() }),
    async execute(_id: string, p: any) {
      const id = String(p.agent_id || "");
      const st = S();
      if (st.root === id) return err("the root of the chat cannot be removed: assign the orchestrator role to another agent first");
      if (!st.members.includes(id)) return err(`agent "${id}" is not in this chat`);
      ctx.chatRemove([id]);
      ctx.log("tool-chat-remove", { id });
      return ok({ ok: true, removed: id, chat: S() });
    },
  }));

  tools.push(defineTool({
    name: "chat_set_orchestrator", label: "Set orchestrator",
    description: "Make an agent the root (orchestrator) of THIS chat: its children move up to its old parent and the previous root becomes its child.",
    parameters: Type.Object({ agent_id: Type.String() }),
    async execute(_id: string, p: any) {
      const id = String(p.agent_id || "");
      const st = S();
      if (!st.members.includes(id)) return err(`agent "${id}" is not in this chat: add it first with chat_add_agent`);
      ctx.chatSetOrchestrator(id);
      ctx.log("tool-chat-orchestrator", { id });
      return ok({ ok: true, root: id, chat: S() });
    },
  }));

  tools.push(defineTool({
    name: "chat_set_model", label: "Set agent model (this chat)",
    description: "Set the model for one agent in THIS chat only (per-chat override). Empty string clears it (chat default).",
    parameters: Type.Object({ agent_id: Type.String(), model: Type.String() }),
    async execute(_id: string, p: any) {
      ctx.chatSetOverride(String(p.agent_id), String(p.model ?? ""), undefined);
      return ok({ ok: true, overrides: ctx.overrides() });
    },
  }));

  tools.push(defineTool({
    name: "chat_set_thinking", label: "Set agent thinking (this chat)",
    description: "Set the thinking level for one agent in THIS chat only. Allowed: off | on (empty string clears it).",
    parameters: Type.Object({ agent_id: Type.String(), thinking: Type.String() }),
    async execute(_id: string, p: any) {
      const lv = String(p.thinking ?? "");
      if (lv && !["off", "on"].includes(lv)) return err("thinking must be 'off' or 'on' (empty to clear)");
      ctx.chatSetOverride(String(p.agent_id), undefined, lv);
      return ok({ ok: true, overrides: ctx.overrides() });
    },
  }));

  tools.push(defineTool({
    name: "chat_graph_undo", label: "Undo graph change",
    description: "Undo the last change to this chat's agent tree.",
    parameters: Type.Object({}),
    async execute() { const r = ctx.graphUndo(); return ok({ ok: true, result: r, chat: S() }); },
  }));

  tools.push(defineTool({
    name: "chat_graph_redo", label: "Redo graph change",
    description: "Redo the last undone change to this chat's agent tree.",
    parameters: Type.Object({}),
    async execute() { const r = ctx.graphRedo(); return ok({ ok: true, result: r, chat: S() }); },
  }));

  tools.push(defineTool({
    name: "chat_create", label: "Create chat",
    description: "Create a new chat with the given agents (the first one becomes the root). Returns the session key.",
    parameters: Type.Object({ label: Type.String(), agent_ids: Type.Array(Type.String()) }),
    async execute(_id: string, p: any) {
      const ids = (p.agent_ids || []).map(String).filter((x: string) => !!readAgentCfg(ctx, x));
      if (!ids.length) return err("agent_ids must contain at least one existing agent");
      const key = ctx.chatCreate(String(p.label || "Chat"), ids);
      ctx.log("tool-chat-create", { key, ids });
      return ok({ ok: true, session_key: key, agents: ids, root: ids[0] });
    },
  }));

  // ═══════════ SKILL ═══════════
  tools.push(defineTool({
    name: "skill_list", label: "List skills",
    description: "List installed skills (id, name, description) and which agents use them.",
    parameters: Type.Object({}),
    async execute() {
      const skills = listSkills(ctx);
      const users: Record<string, string[]> = {};
      for (const id of listAgentIds(ctx)) {
        const c = readAgentCfg(ctx, id) || {};
        for (const s of (c.skills || [])) { const k = typeof s === "string" ? s : s?.name; if (k) (users[k] ||= []).push(id); }
      }
      return ok({ skills, used_by: users });
    },
  }));

  tools.push(defineTool({
    name: "skill_create", label: "Create skill",
    description: "Create a skill as ~/.quinki/skills/<id>/SKILL.md (frontmatter: name + description).",
    parameters: Type.Object({ name: Type.String(), description: Type.String(), body: Type.String(), id: Type.Optional(Type.String()) }),
    async execute(_id: string, p: any) {
      const name = String(p.name || "").trim();
      if (!name) return err("name is required");
      const id = slugify(p.id || name);
      const dir = skillDir(ctx, id);
      fs.mkdirSync(dir, { recursive: true });
      const md = `---\nname: ${name}\ndescription: ${String(p.description || "").replace(/\n/g, " ")}\n---\n\n${String(p.body || "")}\n`;
      fs.writeFileSync(path.join(dir, "SKILL.md"), md);
      ctx.log("tool-skill-create", { id, name });
      return ok({ ok: true, id, path: path.join(dir, "SKILL.md") });
    },
  }));

  tools.push(defineTool({
    name: "skill_update", label: "Update skill",
    description: "Update a skill's description and/or body (keeps the name).",
    parameters: Type.Object({ id: Type.String(), description: Type.Optional(Type.String()), body: Type.Optional(Type.String()) }),
    async execute(_id: string, p: any) {
      const id = String(p.id || "");
      const f = path.join(skillDir(ctx, id), "SKILL.md");
      if (!fs.existsSync(f)) return err(`skill "${id}" not found`);
      const cur = fs.readFileSync(f, "utf8");
      const fm = parseFrontmatter(cur);
      const body = p.body !== undefined ? String(p.body) : cur.replace(/^---\n[\s\S]*?\n---\n?/, "");
      const desc = p.description !== undefined ? String(p.description) : (fm.description || "");
      fs.writeFileSync(f, `---\nname: ${fm.name || id}\ndescription: ${desc.replace(/\n/g, " ")}\n---\n\n${body}\n`);
      return ok({ ok: true, id });
    },
  }));

  tools.push(defineTool({
    name: "skill_delete", label: "Delete skill",
    description: "Delete a skill and detach it from every agent.",
    parameters: Type.Object({ id: Type.String(), confirm: Type.Boolean() }),
    async execute(_id: string, p: any) {
      const id = String(p.id || "");
      if (!p.confirm) return err("confirmation required: pass confirm: true");
      const dir = skillDir(ctx, id);
      if (!fs.existsSync(dir)) return err(`skill "${id}" not found`);
      fs.rmSync(dir, { recursive: true, force: true });
      for (const aid of listAgentIds(ctx)) {
        const c = readAgentCfg(ctx, aid); if (!c?.skills) continue;
        const next = (c.skills || []).filter((s: any) => (typeof s === "string" ? s : s?.name) !== id);
        if (next.length !== (c.skills || []).length) { c.skills = next; writeAgentCfg(ctx, aid, c); }
      }
      return ok({ ok: true, deleted: id });
    },
  }));

  tools.push(defineTool({
    name: "skill_attach", label: "Attach skill",
    description: "Attach a skill to an agent.",
    parameters: Type.Object({ agent_id: Type.String(), skill: Type.String() }),
    async execute(_id: string, p: any) {
      const aid = String(p.agent_id || ""); const sid = String(p.skill || "");
      const cfg = readAgentCfg(ctx, aid); if (!cfg) return err(`agent "${aid}" not found`);
      if (!fs.existsSync(path.join(skillDir(ctx, sid), "SKILL.md"))) return err(`skill "${sid}" not found`);
      cfg.skills = [...new Set([...(cfg.skills || []).map((s: any) => typeof s === "string" ? s : s?.name), sid])];
      writeAgentCfg(ctx, aid, cfg);
      return ok({ ok: true, agent: aid, skills: cfg.skills });
    },
  }));

  tools.push(defineTool({
    name: "skill_detach", label: "Detach skill",
    description: "Detach a skill from an agent.",
    parameters: Type.Object({ agent_id: Type.String(), skill: Type.String() }),
    async execute(_id: string, p: any) {
      const aid = String(p.agent_id || ""); const sid = String(p.skill || "");
      const cfg = readAgentCfg(ctx, aid); if (!cfg) return err(`agent "${aid}" not found`);
      cfg.skills = (cfg.skills || []).map((s: any) => typeof s === "string" ? s : s?.name).filter((s: string) => s !== sid);
      writeAgentCfg(ctx, aid, cfg);
      return ok({ ok: true, agent: aid, skills: cfg.skills });
    },
  }));

  tools.push(defineTool({
    name: "skill_install", label: "Install skill",
    description: "Install a skill from ANY source: market:<id>, a GitHub repo/tree/blob URL, a raw SKILL.md URL or a gist. Returns what was installed.",
    parameters: Type.Object({
      source: Type.String({ description: "market:<id> | github repo/tree/blob URL | raw file URL | gist" }),
      attach_to: Type.Optional(Type.String({ description: "Agent id to attach the skill to" })),
      on_conflict: Type.Optional(Type.Union([Type.Literal("rename"), Type.Literal("overwrite"), Type.Literal("skip")])),
    }),
    async execute(_id: string, p: any) {
      const res = await installSkill(ctx, String(p.source || ""), p.on_conflict || "rename");
      if (res.error) return err(res.error);
      if (p.attach_to) {
        for (const it of res.installed) {
          try {
            const cfg = readAgentCfg(ctx, String(p.attach_to));
            if (cfg) { cfg.skills = [...new Set([...(cfg.skills || []).map((s: any) => typeof s === "string" ? s : s?.name), it.id])]; writeAgentCfg(ctx, String(p.attach_to), cfg); }
          } catch {}
        }
      }
      ctx.log("tool-skill-install", { source: p.source, installed: res.installed.map((x: any) => x.id) });
      return ok(res);
    },
  }));

  // ═══════════ MCP ═══════════
  tools.push(defineTool({
    name: "mcp_list", label: "List MCP servers",
    description: "List configured MCP servers and which agents use them.",
    parameters: Type.Object({}),
    async execute() {
      const servers = readMcpServers();
      const users: Record<string, string[]> = {};
      for (const id of listAgentIds(ctx)) {
        const c = readAgentCfg(ctx, id) || {};
        for (const m of (c.mcpServers || [])) (users[m] ||= []).push(id);
      }
      return ok({ servers, used_by: users });
    },
  }));

  tools.push(defineTool({
    name: "mcp_add", label: "Add MCP server",
    description: "Add an MCP server: command+args (stdio) or url (http). It becomes available to agents you attach it to.",
    parameters: Type.Object({
      id: Type.String(), command: Type.Optional(Type.String()), args: Type.Optional(Type.Array(Type.String())),
      url: Type.Optional(Type.String()), env: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
    async execute(_id: string, p: any) {
      const id = slugify(p.id);
      if (!p.command && !p.url) return err("provide command (stdio) or url (http)");
      const servers = readMcpServers();
      const next = servers.filter((s: any) => s.id !== id);
      next.push({ id, ...(p.command ? { command: String(p.command), args: (p.args || []).map(String) } : {}), ...(p.url ? { url: String(p.url) } : {}), ...(p.env ? { env: p.env } : {}) } as any);
      saveMcpServers(next as any);
      ctx.log("tool-mcp-add", { id });
      return ok({ ok: true, id });
    },
  }));

  tools.push(defineTool({
    name: "mcp_remove", label: "Remove MCP server",
    description: "Remove an MCP server and detach it from every agent.",
    parameters: Type.Object({ id: Type.String(), confirm: Type.Boolean() }),
    async execute(_id: string, p: any) {
      const id = String(p.id || "");
      if (!p.confirm) return err("confirmation required: pass confirm: true");
      saveMcpServers(readMcpServers().filter((s: any) => s.id !== id) as any);
      for (const aid of listAgentIds(ctx)) {
        const c = readAgentCfg(ctx, aid); if (!c?.mcpServers) continue;
        const next = (c.mcpServers || []).filter((m: string) => m !== id);
        if (next.length !== (c.mcpServers || []).length) { c.mcpServers = next; writeAgentCfg(ctx, aid, c); }
      }
      return ok({ ok: true, removed: id });
    },
  }));

  tools.push(defineTool({
    name: "mcp_attach", label: "Attach MCP",
    description: "Attach an MCP server to an agent.",
    parameters: Type.Object({ agent_id: Type.String(), mcp: Type.String() }),
    async execute(_id: string, p: any) {
      const aid = String(p.agent_id || ""); const mid = String(p.mcp || "");
      const cfg = readAgentCfg(ctx, aid); if (!cfg) return err(`agent "${aid}" not found`);
      if (!readMcpServers().some((s: any) => s.id === mid)) return err(`mcp "${mid}" not found`);
      cfg.mcpServers = [...new Set([...(cfg.mcpServers || []), mid])];
      writeAgentCfg(ctx, aid, cfg);
      return ok({ ok: true, agent: aid, mcp: cfg.mcpServers });
    },
  }));

  tools.push(defineTool({
    name: "mcp_detach", label: "Detach MCP",
    description: "Detach an MCP server from an agent.",
    parameters: Type.Object({ agent_id: Type.String(), mcp: Type.String() }),
    async execute(_id: string, p: any) {
      const aid = String(p.agent_id || ""); const mid = String(p.mcp || "");
      const cfg = readAgentCfg(ctx, aid); if (!cfg) return err(`agent "${aid}" not found`);
      cfg.mcpServers = (cfg.mcpServers || []).filter((m: string) => m !== mid);
      writeAgentCfg(ctx, aid, cfg);
      return ok({ ok: true, agent: aid, mcp: cfg.mcpServers });
    },
  }));

  tools.push(defineTool({
    name: "mcp_install", label: "Install MCP from source",
    description: "Install an MCP server from a URL: a JSON config (mcp.json / claude_desktop_config.json) or a remote HTTP MCP endpoint URL.",
    parameters: Type.Object({
      source: Type.String({ description: "https URL of a JSON config, or an http(s) MCP endpoint" }),
      attach_to: Type.Optional(Type.String()),
    }),
    async execute(_id: string, p: any) {
      const src = String(p.source || "");
      try {
        if (/^https?:\/\//.test(src) && !/\.json($|\?)/.test(src)) {
          // endpoint HTTP: lo registriamo direttamente
          const id = slugify(new URL(src).hostname + new URL(src).pathname);
          const servers = readMcpServers().filter((s: any) => s.id !== id);
          servers.push({ id, url: src } as any);
          saveMcpServers(servers as any);
          if (p.attach_to) { const cfg = readAgentCfg(ctx, String(p.attach_to)); if (cfg) { cfg.mcpServers = [...new Set([...(cfg.mcpServers || []), id])]; writeAgentCfg(ctx, String(p.attach_to), cfg); } }
          return ok({ ok: true, installed: [{ id, url: src }] });
        }
        const txt = await fetchText(src);
        const j: any = JSON.parse(txt);
        const map = j.mcpServers || j.servers || (Array.isArray(j) ? null : { [j.id || "mcp"]: j });
        if (!map) return err("unsupported MCP config format");
        const servers = readMcpServers();
        const installed: any[] = [];
        for (const [rawId, cfg0] of Object.entries(map as Record<string, any>)) {
          const id = slugify(rawId);
          const cfg: any = cfg0 as any;
          const rec: any = { id };
          if (cfg.command) { rec.command = String(cfg.command); rec.args = (cfg.args || []).map(String); if (cfg.env) rec.env = cfg.env; }
          else if (cfg.url) rec.url = String(cfg.url);
          else continue;
          const idx = servers.findIndex((s: any) => s.id === id);
          if (idx >= 0) servers[idx] = rec; else servers.push(rec);
          installed.push(rec);
          if (p.attach_to) { const ac = readAgentCfg(ctx, String(p.attach_to)); if (ac) { ac.mcpServers = [...new Set([...(ac.mcpServers || []), id])]; writeAgentCfg(ctx, String(p.attach_to), ac); } }
        }
        saveMcpServers(servers as any);
        ctx.log("tool-mcp-install", { source: src, installed: installed.map((x) => x.id) });
        return ok({ ok: true, installed });
      } catch (e: any) { return err(String(e?.message || e)); }
    },
  }));

  tools.push(defineTool({
    name: "agent_install", label: "Install agent from source",
    description: "Install an agent from a GitHub folder/repo or raw config.json (+ PROMPT.md): market:<id>, repo/tree/blob URL or raw URL.",
    parameters: Type.Object({ source: Type.String(), add_to_chat: Type.Optional(Type.Boolean()) }),
    async execute(_id: string, p: any) {
      const res = await installAgent(ctx, String(p.source || ""));
      if (res.error) return err(res.error);
      if (p.add_to_chat) { try { ctx.chatAdd(S().root, [res.id]); } catch {} }
      return ok(res);
    },
  }));

  tools.push(defineTool({
    name: "models_list", label: "List models",
    description: "List the models available on this machine (id + provider) — use real ids when setting an agent model.",
    parameters: Type.Object({ filter: Type.Optional(Type.String()) }),
    async execute(_id: string, p: any) {
      const out: any[] = [];
      for (const f of ["models.json", "models-store.json", "quinki-providers.json"]) {
        const j = readJson(q(ctx, f));
        const arr = Array.isArray(j) ? j : (j?.models || []);
        if (Array.isArray(arr)) for (const m of arr) {
          const id = m?.id || m; if (id) out.push({ id: String(id), provider: m?.provider || null });
        }
        const provs = j?.providers;
        if (provs && typeof provs === "object") for (const [name, v] of Object.entries<any>(provs)) {
          for (const m of (v?.models || [])) out.push({ id: String(m?.id || m), provider: name });
        }
      }
      const uniq = [...new Map(out.map((m) => [m.id, m])).values()];
      const f = String(p.filter || "").toLowerCase();
      const list = f ? uniq.filter((m) => m.id.toLowerCase().includes(f) || String(m.provider || "").toLowerCase().includes(f)) : uniq;
      return ok({ models: list, count: list.length });
    },
  }));

  return tools;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTALLER
// ─────────────────────────────────────────────────────────────────────────────
type Installed = { id: string; name: string; path: string };

async function installSkill(ctx: ManageCtx, source: string, onConflict: "rename" | "overwrite" | "skip"): Promise<{ installed: Installed[]; error?: string }> {
  const src = String(source || "").trim();
  if (!src) return { installed: [], error: "source is required" };
  // 1) market:<id>
  if (src.startsWith("market:")) {
    const id = src.slice(7);
    const cat = await marketCatalog();
    const item = cat.find((x: any) => String(x.id) === id || String(x.name).toLowerCase() === id.toLowerCase());
    if (!item) return { installed: [], error: `market item "${id}" not found` };
    const url = item.url || item.repo || item.source || item.homepage;
    if (!url) return { installed: [], error: `market item "${id}" has no installable source` };
    return installSkill(ctx, String(url), onConflict);
  }
  // 2) github
  const gh = parseGithub(src);
  if (gh) {
    const files: { name: string; content: string }[] = [];
    if (gh.sub && /SKILL\.md$/i.test(gh.sub)) {
      files.push({ name: path.basename(path.dirname(gh.sub)) || gh.repo, content: await ghRaw(gh.owner, gh.repo, gh.ref, gh.sub) });
    } else {
      const paths = await ghTree(gh.owner, gh.repo, gh.ref);
      const skillFiles = paths.filter((p2) => /(^|\/)SKILL\.md$/i.test(p2) && (!gh.sub || p2.startsWith(gh.sub.replace(/\/$/, "") + "/")));
      if (!skillFiles.length) return { installed: [], error: "no SKILL.md found in that repository" };
      for (const sf of skillFiles.slice(0, 20)) {
        files.push({ name: path.basename(path.dirname(sf)) || gh.repo, content: await ghRaw(gh.owner, gh.repo, gh.ref, sf) });
      }
    }
    return writeSkills(ctx, files, onConflict);
  }
  // 3) raw URL (file)
  try {
    const txt = await fetchText(src);
    const fm = parseFrontmatter(txt);
    const name = fm.name || path.basename(new URL(src).pathname).replace(/\.md$/i, "") || "skill";
    return writeSkills(ctx, [{ name, content: txt }], onConflict);
  } catch (e: any) {
    return { installed: [], error: String(e?.message || e) };
  }
}

function writeSkills(ctx: ManageCtx, files: { name: string; content: string }[], onConflict: "rename" | "overwrite" | "skip"): { installed: Installed[]; error?: string } {
  const installed: Installed[] = [];
  for (const f of files) {
    const fm = parseFrontmatter(f.content);
    let id = slugify(fm.name || f.name);
    const dir = skillDir(ctx, id);
    if (fs.existsSync(dir)) {
      if (onConflict === "skip") continue;
      if (onConflict === "overwrite") { /* sovrascrive */ }
      else { let n = 2, base = id; while (fs.existsSync(skillDir(ctx, `${base}-${n}`))) n++; id = `${base}-${n}`; }
    }
    const target = skillDir(ctx, id);
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), f.content);
    installed.push({ id, name: fm.name || f.name, path: target });
  }
  if (!installed.length) return { installed: [], error: "nothing installed" };
  return { installed };
}

async function installAgent(ctx: ManageCtx, source: string): Promise<{ id: string; name: string; path: string; error?: string }> {
  const src = String(source || "").trim();
  if (!src) return { id: "", name: "", path: "", error: "source is required" };
  if (src.startsWith("market:")) {
    const id = src.slice(7);
    const cat = await marketCatalog();
    const item = cat.find((x: any) => String(x.id) === id || String(x.name).toLowerCase() === id.toLowerCase());
    const url = item?.url || item?.repo || item?.source;
    if (!url) return { id: "", name: "", path: "", error: `market item "${id}" has no installable source` };
    return installAgent(ctx, String(url));
  }
  const gh = parseGithub(src);
  if (!gh) return { id: "", name: "", path: "", error: "agent_install needs a GitHub folder/repo or a raw config.json URL" };
  const paths = await ghTree(gh.owner, gh.repo, gh.ref);
  const base = gh.sub.replace(/\/$/, "");
  const cfgPath = paths.find((p2) => p2 === `${base}/config.json` || (!base && p2.endsWith("/config.json")) || p2.endsWith("config.json"));
  if (!cfgPath) return { id: "", name: "", path: "", error: "no config.json found" };
  const dirPath = path.dirname(cfgPath);
  const cfgTxt = await ghRaw(gh.owner, gh.repo, gh.ref, cfgPath);
  let cfg: any; try { cfg = JSON.parse(cfgTxt); } catch { return { id: "", name: "", path: "", error: "config.json is not valid JSON" }; }
  const name = String(cfg.name || path.basename(dirPath) || "Agent");
  let id = slugify(name); let n = 2; const b = id;
  while (fs.existsSync(path.join(ctx.agentDir, "agents", id))) { id = `${b}-${n++}`; }
  writeAgentCfg(ctx, id, { ...cfg });
  const promptPath = paths.find((p2) => p2 === `${dirPath}/PROMPT.md`);
  writeAgentPrompt(ctx, id, promptPath ? await ghRaw(gh.owner, gh.repo, gh.ref, promptPath) : `# ${name}\n\nYou are ${name}.`);
  ctx.log("tool-agent-install", { source: src, id });
  return { id, name, path: path.join(ctx.agentDir, "agents", id) };
}
