// === Agent management helpers for sidecar.ts ===
// Provides RPC handlers for agent CRUD, skill discovery, tool listing,
// file management, and global config.

import { execSync } from 'child_process';
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";

export function createAgentHandlers(agentDir: string, getCwd: () => string) {
  const agentsDir = path.join(agentDir, "agents");
  const globalConfigFile = fs.existsSync(path.join(agentDir, "quinki-global.json"))
  ? path.join(agentDir, "quinki-global.json")
  : path.join(agentDir, "dashboard-global.json");

  // === Global config ===

  function readGlobalConfig(): any {
    try {
      if (fs.existsSync(globalConfigFile)) {
        return JSON.parse(fs.readFileSync(globalConfigFile, "utf8"));
      }
    } catch {}
    return {
      tools: ["read", "grep", "find", "ls", "skill"],
      planModeTools: { read: true, grep: true, find: true, ls: true, skill: true, write: false, edit: false, bash: false },
      skills: [],
      defaultMode: "plan",
    };
  }

  function writeGlobalConfig(cfg: any) {
    fs.mkdirSync(path.dirname(globalConfigFile), { recursive: true });
    fs.writeFileSync(globalConfigFile, JSON.stringify(cfg, null, 2), "utf8");
  }

  // === Agent CRUD ===

  function listAgents(): any[] {
    try {
      if (!fs.existsSync(agentsDir)) return [];
      const dirs = fs.readdirSync(agentsDir).filter(f => {
        const p = path.join(agentsDir, f);
        return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, "config.json"));
      });
      return dirs.map(id => {
        const dir = path.join(agentsDir, id);
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(dir, "config.json"), "utf8"));
          // Read PROMPT.md for description
          let prompt = "";
          try { prompt = fs.readFileSync(path.join(dir, "PROMPT.md"), "utf8"); } catch {}
          return { ...cfg, prompt, directory: dir };
        } catch { return null; }
      }).filter(Boolean);
    } catch { return []; }
  }

  function readAgentConfig(id: string): any | null {
    const dir = path.join(agentsDir, id);
    const cfgPath = path.join(dir, "config.json");
    if (!fs.existsSync(cfgPath)) return null;
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      return { ...cfg, directory: dir };
    } catch { return null; }
  }

  function writeAgentConfig(id: string, cfg: any) {
    const dir = path.join(agentsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2), "utf8");
  }

  function createAgentDir(id: string, name: string, workspace?: string): any {
    const dir = path.join(agentsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const cfg: any = { id, name, tools: [], skills: [] };
    if (workspace) cfg.workspace = workspace;
    writeAgentConfig(id, cfg);
    const promptPath = path.join(dir, "PROMPT.md");
    if (!fs.existsSync(promptPath)) {
      fs.writeFileSync(promptPath, `# ${name}\n\nSei ${name}.\n`, "utf8");
    }
    return { ...cfg, directory: dir };
  }

  function deleteAgentDir(id: string) {
    const dir = path.join(agentsDir, id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  // === File management ===

  function listAgentFiles(id: string): any[] {
    const dir = path.join(agentsDir, id);
    if (!fs.existsSync(dir)) return [];
    const result: any[] = [];
    // Also scan the agent's workspace for skill files
    const agentCfg = readAgentConfig(id);
    const extraDirs: string[] = [];
    if (agentCfg?.workspace) {
      extraDirs.push(path.join(agentCfg.workspace, ".pi", "skills", id));
    }
    const walk = (d: string, rel: string) => {
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
          if (e.name === "config.json") continue;
          const relPath = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) { result.push({ name: e.name, path: relPath, isDirectory: true }); walk(path.join(d, e.name), relPath); }
          else { result.push({ name: e.name, path: relPath, isDirectory: false }); }
        }
      } catch {}
    };
    walk(dir, "");
    // Scan extra dirs (workspace skills) with a prefix
    for (const extra of extraDirs) {
      if (fs.existsSync(extra)) {
        walk(extra, "");
      }
    }
    return result;
  }

  function readAgentFile(id: string, filePath: string): string | null {
    const dir = path.join(agentsDir, id);
    const fullPath = path.join(dir, filePath);
    if (!fullPath.startsWith(dir)) return null;
    // Try agent directory first
    if (fs.existsSync(fullPath)) {
      try { return fs.readFileSync(fullPath, "utf8"); } catch { return null; }
    }
    // Try workspace .pi/skills/<id>/
    const agentCfg = readAgentConfig(id);
    if (agentCfg?.workspace) {
      const wsPath = path.join(agentCfg.workspace, ".pi", "skills", id, filePath);
      if (fs.existsSync(wsPath)) {
        try { return fs.readFileSync(wsPath, "utf8"); } catch { return null; }
      }
    }
    return null;
  }

  function writeAgentFile(id: string, filePath: string, content: string): boolean {
    const dir = path.join(agentsDir, id);
    const fullPath = path.join(dir, filePath);
    if (!fullPath.startsWith(dir)) return false;
    // If file exists in agent dir, write there
    if (fs.existsSync(fullPath)) {
      try { fs.mkdirSync(path.dirname(fullPath), { recursive: true }); fs.writeFileSync(fullPath, content, "utf8"); return true; } catch { return false; }
    }
    // If file exists in workspace, write there
    const agentCfg = readAgentConfig(id);
    if (agentCfg?.workspace) {
      const wsPath = path.join(agentCfg.workspace, ".pi", "skills", id, filePath);
      if (fs.existsSync(wsPath)) {
        try { fs.writeFileSync(wsPath, content, "utf8"); return true; } catch { return false; }
      }
    }
    // Otherwise write to agent dir
    try { fs.mkdirSync(path.dirname(fullPath), { recursive: true }); fs.writeFileSync(fullPath, content, "utf8"); return true; } catch { return false; }
  }

  // === Skill discovery ===

  function scanSkills(): any[] {
    const cwd = getCwd();
    const skills: any[] = [];
    // In isolated mode (custom agent dir), only scan that dir's skills
    const isIsolated = agentDir !== path.join(homedir(), ".pi", "agent");
    const searchDirs = isIsolated
      ? [path.join(agentDir, "skills")]
      : [
        path.join(cwd, ".pi", "skills"),
        path.join(cwd, ".agents", "skills"),
        path.join(agentDir, "skills"),
        path.join(homedir(), ".agents", "skills"),
      ];
    // Also scan each agent's workspace for skills
    for (const agent of listAgents()) {
      if (agent.workspace) {
        searchDirs.push(path.join(agent.workspace, ".pi", "skills"));
        searchDirs.push(path.join(agent.workspace, ".agents", "skills"));
      }
    }
    for (const searchDir of searchDirs) {
      if (!fs.existsSync(searchDir)) continue;
      try {
        const walk = (dir: string) => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory()) { walk(path.join(dir, e.name)); }
            else if (e.name === "SKILL.md") {
              try {
                const content = fs.readFileSync(path.join(dir, e.name), "utf8");
                const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
                let skillName = path.basename(dir);
                let skillDesc = "";
                if (fmMatch) {
                  const fm = fmMatch[1];
                  const nameMatch = fm.match(/^name:\s*(.+)$/m);
                  if (nameMatch) skillName = nameMatch[1].trim().replace(/^["']|["']$/g, "");
                  // Parse description — gestisce single-line, folded (>), literal (|), quoted
                  const descLineMatch = fm.match(/^description:\s*(.*)$/m);
                  if (descLineMatch) {
                    const descValue = descLineMatch[1].trim();
                    if (descValue === '>' || descValue === '>-' || descValue === '>+' || descValue === '|' || descValue === '|-' || descValue === '|+') {
                      // Block scalar — leggi righe indentate seguenti
                      const fmLines = fm.split('\n');
                      const descStartIdx = fmLines.findIndex(l => l.match(/^description:/));
                      const descLines: string[] = [];
                      for (let i = descStartIdx + 1; i < fmLines.length; i++) {
                        const line = fmLines[i];
                        if (line.startsWith('  ') || line.startsWith('\t')) {
                          descLines.push(line.trim());
                        } else break;
                      }
                      skillDesc = descValue.startsWith('>') ? descLines.join(' ') : descLines.join('\n');
                    } else {
                      // Single-line o quoted
                      skillDesc = descValue.replace(/^["']|["']$/g, '');
                    }
                  }
                }
                skills.push({ name: skillName, description: skillDesc, path: path.join(dir, e.name), directory: dir, disableModelInvocation: /^disable-model-invocation:\s*true/m.test(content), userInvocable: /^user-invocable:\s*true/m.test(content) });
              } catch {}
            }
          }
        };
        walk(searchDir);
      } catch {}
    }
    const seen = new Set<string>();
    return skills.filter(s => { if (seen.has(s.name)) return false; seen.add(s.name); return true; });
  }

  // === RPC handlers object ===

  return {
    listAgents: async () => ({ agents: listAgents() }),
    createAgent: async (p: any) => {
      const id = (p.id || `agent-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      const agent = createAgentDir(id, p.name || "Nuovo agente", p.workspace);
      return { agent };
    },
    updateAgent: async (p: any) => {
      const existing = readAgentConfig(p.id);
      if (!existing) return { success: false, error: "Agent not found" };
      const updated = { ...existing, ...p.config };
      delete updated.directory;
      writeAgentConfig(p.id, updated);
      return { success: true, agent: { ...updated, directory: path.join(agentsDir, p.id) } };
    },
    deleteAgent: async (p: any) => {
      deleteAgentDir(p.id);
      return { success: true };
    },
    listAgentFiles: async (p: any) => ({ files: listAgentFiles(p.id) }),
    readAgentFile: async (p: any) => ({ content: readAgentFile(p.id, p.filePath) }),
    writeAgentFile: async (p: any) => ({ success: writeAgentFile(p.id, p.filePath, p.content || "") }),
    createAgentFile: async (p: any) => {
      // Create a new empty file in the agent directory
      const dir = path.join(agentsDir, p.id);
      const filePath = path.join(dir, p.fileName);
      if (!filePath.startsWith(dir)) return { success: false, error: "Invalid path" };
      if (fs.existsSync(filePath)) return { success: false, error: "File already exists" };
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, p.content || "", "utf8");
        return { success: true };
      } catch (e: any) { return { success: false, error: e?.message || String(e) }; }
    },
    listSkills: async () => ({ skills: scanSkills() }),
    loadSkill: async (p: any) => {
      const skills = scanSkills();
      const skill = skills.find((s: any) => s.name === p.name);
      if (!skill) return { error: 'Skill not found' };
      try { return { content: fs.readFileSync(skill.path, 'utf-8') }; } catch { return { error: 'Skill file not found' }; }
    },
    createSkill: async (p: any) => {
      // Create a new skill in the agentDir/skills/ directory
      const skillName = (p.name || "new-skill").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
      const skillDir = path.join(agentDir, "skills", skillName);
      if (fs.existsSync(path.join(skillDir, "SKILL.md"))) return { success: false, error: "Skill already exists" };
      try {
        fs.mkdirSync(skillDir, { recursive: true });
        const description = p.description || "";
        const body = p.content || `# ${skillName}\n\n## When to Use\n\nDescribe when to use this skill.\n\n## Procedure\n\n1. Step one\n2. Step two\n`;
        const fullContent = `---\nname: ${skillName}\ndescription: ${description}\n---\n\n${body}`;
        fs.writeFileSync(path.join(skillDir, "SKILL.md"), fullContent, "utf8");
        return { success: true, skill: { name: skillName, description, path: path.join(skillDir, "SKILL.md"), directory: skillDir } };
      } catch (e: any) { return { success: false, error: e?.message || String(e) }; }
    },
    installSkill: async (p: any) => {
      const pkg = String(p.package || "").trim();
      if (!pkg) return { success: false, error: "Package name required" };
      try {
        // execSync imported at top
        let gitUrl = pkg.trim();
        // Estrai --skill flag (es. --skill web-search)
        let skillFlag = "";
        const skillMatch = pkg.match(/--skill\s+(\S+)/);
        if (skillMatch) skillFlag = skillMatch[1];
        // Estrai URL da comandi come "npx skills add https://..."
        if (gitUrl.includes("npx skills add")) gitUrl = gitUrl.split("npx skills add")[1].trim().split(/\s+/)[0];
        if (gitUrl.startsWith("npx ")) gitUrl = gitUrl.slice(4).trim().split(/\s+/)[0];
        let skillPath = skillFlag; // usa --skill come filtro
        // Parse URL diretto a SKILL.md
        if (gitUrl.endsWith(".md") && gitUrl.startsWith("http")) {
          // Download diretto
          const curlCandidates = ["/opt/homebrew/bin/curl", "/usr/local/bin/curl", "/usr/bin/curl"];
          let curlPath = "";
          for (const c of curlCandidates) { try { if (fs.existsSync(c)) { curlPath = c; break; } } catch {} }
          if (!curlPath) return { success: false, error: "curl not found" };
          const binDir = path.dirname(curlPath);
          const skillName = path.basename(gitUrl, ".md").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
          const destDir = path.join(agentDir, "skills", skillName);
          fs.mkdirSync(destDir, { recursive: true });
          execSync(`export PATH="${binDir}:$PATH"; "${curlPath}" -sL "${gitUrl}" -o "${path.join(destDir, "SKILL.md")}"`, { stdio: "pipe", timeout: 30000, shell: "/bin/bash" });
          return { success: true, count: 1 };
        }
        // Parse GitHub
        if (gitUrl.startsWith("https://github.com/")) {
          const urlParts = gitUrl.replace("https://github.com/", "").split("/");
          if (urlParts.length >= 2) {
            gitUrl = `https://github.com/${urlParts[0]}/${urlParts[1]}`;
            if (urlParts.length > 2) {
              if (urlParts[2] === "tree" && urlParts.length > 4) skillPath = urlParts.slice(4).join("/");
              else if (!skillPath) skillPath = urlParts.slice(2).join("/");
            }
          }
        } else if (!gitUrl.startsWith("http") && !gitUrl.startsWith("git@")) {
          const parts = gitUrl.split("/");
          if (parts.length >= 2) {
            gitUrl = `https://github.com/${parts[0]}/${parts[1]}`;
            if (parts.length > 2 && !skillPath) skillPath = parts.slice(2).join("/");
          } else { return { success: false, error: "Invalid format. Use: user/repo or user/repo/skill or --skill name" }; }
        }
        // Trova git
        const gitCandidates = ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"];
        let gitPath = "";
        for (const c of gitCandidates) { try { if (fs.existsSync(c)) { gitPath = c; break; } } catch {} }
        if (!gitPath) return { success: false, error: "git not found" };
        const binDir = path.dirname(gitPath);
        const tmpDir = path.join(agentDir, "tmp-skill-install");
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        execSync(`export PATH="${binDir}:$PATH"; "${gitPath}" clone --depth 1 "${gitUrl}" "${tmpDir}"`, { stdio: "pipe", timeout: 60000, shell: "/bin/bash" });
        // Trova SKILL.md
        const skillsDest = path.join(agentDir, "skills");
        fs.mkdirSync(skillsDest, { recursive: true });
        const findSkillFiles = (dir: string): string[] => {
          const results: string[] = [];
          try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              if (entry.isDirectory()) results.push(...findSkillFiles(path.join(dir, entry.name)));
              else if (entry.name === "SKILL.md") results.push(path.join(dir, entry.name));
            }
          } catch {}
          return results;
        };
        let skillFiles = findSkillFiles(tmpDir);
        // Filtra per skillPath se specificato
        if (skillPath) {
          const filtered = skillFiles.filter(f => f.includes(`/${skillPath}/`) || f.includes(`\\${skillPath}\\`));
          if (filtered.length > 0) skillFiles = filtered;
        }
        if (skillFiles.length === 0) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
          return { success: false, error: `No SKILL.md found${skillPath ? ` in ${skillPath}` : ""}` };
        }
        // Copia
        for (const skillFile of skillFiles) {
          const skillDir = path.dirname(skillFile);
          const skillName = path.basename(skillDir);
          const destDir = path.join(skillsDest, skillName);
          if (fs.existsSync(destDir)) fs.rmSync(destDir, { recursive: true, force: true });
          fs.mkdirSync(destDir, { recursive: true });
          for (const entry of fs.readdirSync(skillDir, { withFileTypes: true })) {
            if (entry.isFile()) fs.copyFileSync(path.join(skillDir, entry.name), path.join(destDir, entry.name));
          }
        }
        fs.rmSync(tmpDir, { recursive: true, force: true });
        return { success: true, count: skillFiles.length };
      } catch (e: any) {
        const msg = e?.stderr?.toString() || e?.message || String(e);
        return { success: false, error: msg };
      }
    },
    deleteSkill: async (p: any) => {
      const skillName = String(p.name || "").trim();
      if (!skillName) return { success: false, error: "Skill name required" };
      // Find skill directory
      const skills = scanSkills();
      const skill = skills.find((s: any) => s.name === skillName);
      if (!skill) return { success: false, error: "Skill not found" };
      try {
        // 1. Delete the skill directory from disk
        fs.rmSync(skill.directory, { recursive: true, force: true });
        // 2. Remove the skill from ALL agent configs
        const agents = listAgents();
        for (const agent of agents) {
          if (agent.skills && agent.skills.includes(skillName)) {
            agent.skills = agent.skills.filter((s: string) => s !== skillName);
            writeAgentConfig(agent.id, agent);
          }
        }
        // 3. Remove the skill from global config if present
        const gcfg = readGlobalConfig();
        if (gcfg.skills && gcfg.skills.includes(skillName)) {
          gcfg.skills = gcfg.skills.filter((s: string) => s !== skillName);
          writeGlobalConfig(gcfg);
        }
        return { success: true };
      } catch (e: any) { return { success: false, error: e?.message || String(e) }; }
    },
    readSkillFile: async (p: any) => {
      const skills = scanSkills();
      const skill = skills.find((s: any) => s.name === p.name);
      if (!skill) return { content: null };
      try { return { content: fs.readFileSync(skill.path, "utf8") }; } catch { return { content: null }; }
    },
    writeSkillFile: async (p: any) => {
      const skills = scanSkills();
      const skill = skills.find((s: any) => s.name === p.name);
      if (!skill) return { success: false };
      try { fs.writeFileSync(skill.path, p.content || "", "utf8"); return { success: true }; } catch { return { success: false }; }
    },
    listTools: async () => ({
      tools: [
        { name: "read", description: "Read files", readOnly: true },
        { name: "write", description: "Write/create files", readOnly: false },
        { name: "edit", description: "Edit existing files", readOnly: false },
        { name: "bash", description: "Execute shell commands", readOnly: false },
        { name: "grep", description: "Search file contents", readOnly: true },
        { name: "find", description: "Find files by name/pattern", readOnly: true },
        { name: "ls", description: "List directory contents", readOnly: true },
        { name: "skill", description: "Load skills on-demand", readOnly: true },
        { name: "delegate_to_agent", description: "Delegate a task to another agent in the chat (for orchestrators/coordinators only)", readOnly: true },
      ],
    }),
    getGlobalConfig: async () => ({ config: readGlobalConfig() }),
    updateGlobalConfig: async (p: any) => {
      writeGlobalConfig(p.config);
      return { success: true };
    },
    // === API Key management (macOS Keychain / fallback) ===
    getApiKeyRequirements: async (p: any) => {
      // Legge il frontmatter del SKILL.md per trovare primaryEnv
      const skills = scanSkills();
      const skill = skills.find((s: any) => s.name === p.name);
      if (!skill) return { envVars: [] };
      try {
        const content = fs.readFileSync(skill.path, "utf8");
        const envVars: string[] = [];
        // 1. Parse frontmatter (between --- markers)
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          // Cerca primaryEnv nel frontmatter
          const primaryEnvMatch = fm.match(/["']?primaryEnv["']?\s*:\s*["']?([^"'\n]+)["']?/);
          if (primaryEnvMatch) envVars.push(primaryEnvMatch[1].trim());
          // Cerca anche requires.envs o envVars
          const envLines = fm.matchAll(/env(?:Vars|ironment)?:\s*\[?([^\]\n]+)\]?/g);
          for (const m of envLines) {
            for (const v of m[1].split(",")) {
              const trimmed = v.trim().replace(/["']/g, "");
              if (trimmed && !envVars.includes(trimmed)) envVars.push(trimmed);
            }
          }
        }
        // 2. Cerca env vars nel corpo del SKILL.md (pattern $VAR_NAME o ${VAR_NAME})
        // Solo variabili UPPER_CASE con underscore, che sembrano env vars realali
        const bodyEnvMatches = content.matchAll(/\$\{?([A-Z][A-Z_]{5,})\}?/g);
        for (const m of bodyEnvMatches) {
          const v = m[1];
          if (!envVars.includes(v) && !['CONTENT', 'QUERY', 'HOME', 'PATH'].includes(v)) envVars.push(v);
        }
        return { envVars };
      } catch { return { envVars: [] }; }
    },
    storeApiKey: async (p: any) => {
      const service = String(p.service || "").trim();
      const key = String(p.key || "").trim();
      if (!service || !key) return { success: false, error: "Service e key required" };
      try {
        if (process.platform === "darwin") {
          // macOS Keychain
          // execSync imported at top
          execSync(`security add-generic-password -a "quinki" -s "${service}" -w "${key.replace(/"/g, '\\"')}" -U`, { stdio: "pipe" });
          return { success: true };
        } else {
          // Fallback: file con chmod 600
          const keyFile = path.join(agentDir, "api-keys.json");
          let keys: any = {};
          try { keys = JSON.parse(fs.readFileSync(keyFile, "utf8")); } catch {}
          keys[service] = key;
          fs.mkdirSync(path.dirname(keyFile), { recursive: true });
          fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2), "utf8");
          fs.chmodSync(keyFile, 0o600);
          return { success: true };
        }
      } catch (e: any) { return { success: false, error: e?.message || String(e) }; }
    },
    hasApiKey: async (p: any) => {
      const service = String(p.service || "").trim();
      if (!service) return { configured: false };
      try {
        if (process.platform === "darwin") {
          // execSync imported at top
          execSync(`security find-generic-password -a "quinki" -s "${service}"`, { stdio: "pipe" });
          return { configured: true };
        } else {
          const keyFile = path.join(agentDir, "api-keys.json");
          try { const keys = JSON.parse(fs.readFileSync(keyFile, "utf8")); return { configured: !!keys[service] }; } catch { return { configured: false }; }
        }
      } catch { return { configured: false }; }
    },
    deleteApiKey: async (p: any) => {
      const service = String(p.service || "").trim();
      if (!service) return { success: false, error: "Service required" };
      try {
        if (process.platform === "darwin") {
          // execSync imported at top
          execSync(`security delete-generic-password -a "quinki" -s "${service}"`, { stdio: "pipe" });
          return { success: true };
        } else {
          const keyFile = path.join(agentDir, "api-keys.json");
          let keys: any = {};
          try { keys = JSON.parse(fs.readFileSync(keyFile, "utf8")); } catch {}
          delete keys[service];
          fs.writeFileSync(keyFile, JSON.stringify(keys, null, 2), "utf8");
          return { success: true };
        }
      } catch (e: any) { return { success: false, error: e?.message || String(e) }; }
    },
    resolveApiKey: async (p: any) => {
      // Risolve una key per iniezione env var temporanea (usato internamente dal sidecar)
      const service = String(p.service || "").trim();
      if (!service) return { key: null };
      try {
        if (process.platform === "darwin") {
          // execSync imported at top
          const key = execSync(`security find-generic-password -a "quinki" -s "${service}" -w`, { stdio: "pipe", encoding: "utf8" }).trim();
          return { key };
        } else {
          const keyFile = path.join(agentDir, "api-keys.json");
          const keys = JSON.parse(fs.readFileSync(keyFile, "utf8"));
          return { key: keys[service] || null };
        }
      } catch { return { key: null }; }
    },
    // === Chat error persistence — errori persistenti salvati su file separato ===
    addChatError: async (p: any) => {
      const sessionKey = String(p.sessionKey || "");
      if (!sessionKey) return { success: false };
      const errorFile = fs.existsSync(path.join(agentDir, "quinki-chat-errors.json"))
  ? path.join(agentDir, "quinki-chat-errors.json")
  : path.join(agentDir, "quinki-chat-errors.json");
      let errors: Record<string, any[]> = {};
      try { errors = JSON.parse(fs.readFileSync(errorFile, "utf8")); } catch {}
      if (!errors[sessionKey]) errors[sessionKey] = [];
      errors[sessionKey].push({
        userMessage: p.userMessage || "",
        errorContent: p.errorContent || "",
        timestamp: p.timestamp || Date.now(),
      });
      fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2), "utf8");
      return { success: true };
    },
    getChatErrors: async (p: any) => {
      const sessionKey = String(p.sessionKey || "");
      if (!sessionKey) return { errors: [] };
      const errorFile = fs.existsSync(path.join(agentDir, "quinki-chat-errors.json"))
  ? path.join(agentDir, "quinki-chat-errors.json")
  : path.join(agentDir, "quinki-chat-errors.json");
      try {
        const errors = JSON.parse(fs.readFileSync(errorFile, "utf8"));
        return { errors: errors[sessionKey] || [] };
      } catch { return { errors: [] }; }
    },
    // === Inject error exchange into Pi SDK .jsonl history ===
    // Scrive user message + assistant error message direttamente nel file .jsonl
    // così il modello "ricorda" l'errore quando la chat viene riaperta.
    injectErrorExchange: async (p: any) => {
      const sessionKey = String(p.sessionKey || "");
      const userMessage = String(p.userMessage || "");
      const errorContent = String(p.errorContent || "");
      if (!sessionKey || (!userMessage && !errorContent)) return { success: false };
      try {
        const sessionDir = path.join(agentDir, "sessions", "quinki", sessionKey);
        // Create session dir if it doesn't exist
        if (!fs.existsSync(sessionDir)) {
          fs.mkdirSync(sessionDir, { recursive: true });
        }
        // Find or create the .jsonl file
        const files = fs.existsSync(sessionDir) ? fs.readdirSync(sessionDir).filter((f: string) => f.endsWith(".jsonl")) : [];
        let jsonlPath: string;
        let lastId: string | null = null;
        if (files.length === 0) {
          // Create new .jsonl with session header
          const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          jsonlPath = path.join(sessionDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
          const header = JSON.stringify({
            type: "session",
            version: 3,
            id: sessionId,
            timestamp: new Date().toISOString(),
            cwd: getCwd(),
          });
          fs.writeFileSync(jsonlPath, header + "\n", "utf8");
          lastId = sessionId;
        } else {
          jsonlPath = path.join(sessionDir, files[files.length - 1]);
          // Read all lines to find the last entry's id (for parentId)
          const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter((l: string) => l.trim());
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.id) lastId = obj.id;
            } catch {}
          }
        }
        // Generate unique IDs
        const ts = Date.now();
        const userEntryId = `err-u-${ts}-${Math.random().toString(36).slice(2, 8)}`;
        const errorEntryId = `err-e-${ts}-${Math.random().toString(36).slice(2, 8)}`;
        const isoTs = new Date(ts).toISOString();
        const entries: string[] = [];
        // User message entry
        if (userMessage) {
          entries.push(JSON.stringify({
            type: "message",
            id: userEntryId,
            parentId: lastId,
            timestamp: isoTs,
            message: {
              role: "user",
              content: [{ type: "text", text: userMessage }],
              timestamp: ts,
            },
          }));
          lastId = userEntryId;
        }
        // Error message entry (assistant) — isError: true per preservare colore rosso al reload
        if (errorContent) {
          entries.push(JSON.stringify({
            type: "message",
            id: errorEntryId,
            parentId: lastId,
            timestamp: new Date(ts + 1).toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: errorContent }],
              timestamp: ts + 1,
              isError: true,
            },
          }));
        }
        // Append to .jsonl
        if (entries.length > 0) {
          fs.appendFileSync(jsonlPath, entries.join("\n") + "\n", "utf8");
        }
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    },
  };
}