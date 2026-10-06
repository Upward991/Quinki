// build-mcp-catalog.mjs — Genera il catalog.json del repo Upward991/quinki-defaults
// dal REGISTRO MCP UFFICIALE (registry.modelcontextprotocol.io).
//
// Filtra: un entry per server (isLatest), preferendo i pacchetti INSTALLABILI:
//   - npm  → remoteNpmPackage (install one-click: npx)
//   - pypi → remotePypiPackage (install via uvx)
//   - remotes (streamable-http/sse) → remoteUrl SOLO per namespace noti/curati
// Priorità: namespace autorevoli prima; cap totale MAX_ITEMS.
//
// Uso: bun scripts/build-mcp-catalog.mjs  →  ~/.quinki/workdir/quinki-defaults-catalog.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_ITEMS = 1200;
const MAX_PAGES = 400;
const OUT = path.join(os.homedir(), ".quinki", "workdir", "quinki-defaults-catalog.json");

// namespace considerati autorevoli (prima nel sort + ammessi per i remote-only)
const PRIORITY = ["modelcontextprotocol", "microsoft", "github", "google", "cloudflare", "aws", "amazon", "stripe",
  "notion", "slack", "linear", "figma", "supabase", "mongodb", "redis", "postgres", "elastic", "sentry", "vercel",
  "gitlab", "atlassian", "hubspot", "shopify", "twilio", "paypal", "openai", "anthropic", "browserbase", "apify",
  "firecrawl", "exa", "tavily", "e2b", "neon", "railway", "netlify", "digitalocean", "heroku", "algolia", "airtable",
  "asana", "clickup", "todoist", "zapier", "grafana", "datadog", "pagerduty", "auth0", "docker", "hashicorp",
  "terraform", "deepwiki", "context7", "upstash", "sanity", "contentful", "spotify", "youtube", "discord", "telegram"];
const priorityRank = (ns) => { const i = PRIORITY.findIndex((p) => ns.toLowerCase().includes(p)); return i < 0 ? 999 : i; };

async function fetchPage(cursor) {
  const url = "https://registry.modelcontextprotocol.io/v0/servers?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((res) => setTimeout(res, 800));
    }
  }
}

const items = [];
const seen = new Set();
let cursor = null, pages = 0, total = 0;
while (pages < MAX_PAGES) {
  const d = await fetchPage(cursor);
  const servers = d.servers || [];
  total += servers.length; pages++;
  for (const s of servers) {
    const srv = s.server || {};
    const meta = (s._meta && s._meta["io.modelcontextprotocol.registry/official"]) || {};
    if (meta.isLatest === false) continue;
    const name = String(srv.name || "");
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const ns = name.split("/")[0];
    const pkgs = Array.isArray(srv.packages) ? srv.packages : [];
    const npm = pkgs.find((p) => p && p.registryType === "npm" && p.identifier);
    const pypi = pkgs.find((p) => p && p.registryType === "pypi" && p.identifier);
    const remotes = Array.isArray(srv.remotes) ? srv.remotes : [];
    const remote = remotes.find((r) => r && r.url && /http/.test(String(r.type || ""))) || remotes.find((r) => r && r.url);
    const isPriority = priorityRank(ns) < 999;
    // remote-only: includiamo solo namespace noti (5354 remote generici = rumore)
    if (!npm && !pypi && !remote) continue;
    if (!npm && !pypi && remote && !isPriority) continue;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const item = {
      id: "mcpreg-" + slug,
      name: String(srv.title || name.split("/").slice(1).join("/") || name),
      description: String(srv.description || ""),
      author: ns,
      version: String(srv.version || "1.0.0"),
      category: "mcp",
      tags: npm ? ["npm"] : (pypi ? ["pypi"] : ["remote"]),
      _rank: priorityRank(ns),
      _tier: npm ? 0 : (pypi ? 1 : 2),
    };
    if (npm) item.remoteNpmPackage = String(npm.identifier);
    if (pypi) item.remotePypiPackage = String(pypi.identifier);
    if (remote && remote.url) item.remoteUrl = String(remote.url);
    items.push(item);
  }
  cursor = (d.metadata && d.metadata.nextCursor) || d.nextCursor || null;
  if (!cursor) break;
  await new Promise((res) => setTimeout(res, 120));
}

// sort: package installabili prima, poi namespace autorevoli, poi nome
items.sort((a, b) => (a._tier - b._tier) || (a._rank - b._rank) || a.name.localeCompare(b.name));
// mix bilanciato: 700 npm + 300 pypi + 200 remote (curati) nel cap
const byTier = (t) => items.filter((x) => x._tier === t);
const mix = [...byTier(0).slice(0, 700), ...byTier(1).slice(0, 300), ...byTier(2).slice(0, 200)];
const capped = mix.slice(0, MAX_ITEMS).map(({ _rank, _tier, ...rest }) => rest);
capped.sort((a, b) => a.name.localeCompare(b.name));

const catalog = { tabs: [], agents: [], skills: [], mcp: capped, themes: [] };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(catalog));
console.log(`[mcp-catalog] server totali visti: ${total} (${pages} pagine) | unici utili: ${items.length} | nel catalogo: ${capped.length}`);
console.log(`[mcp-catalog] npm: ${capped.filter((x) => x.remoteNpmPackage).length} | pypi: ${capped.filter((x) => x.remotePypiPackage).length} | remote: ${capped.filter((x) => x.remoteUrl && !x.remoteNpmPackage && !x.remotePypiPackage).length}`);
console.log(`[mcp-catalog] scritto: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
