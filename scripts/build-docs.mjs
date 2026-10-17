#!/usr/bin/env node
// =============================================================================
// build-docs.mjs — genera le pagine della documentazione per il sito.
//
// Sorgente di verita': i markdown nella cartella `docs/` (restano leggibili anche
// su GitHub). Questo script li rende in `site/docs/*.html` con lo stile del sito
// (scuro, accento viola) e la sidebar a sezioni — come i doc di Ollama/OpenClaw/Hermes.
//
// Uso:      node scripts/build-docs.mjs
// Output:   site/docs/index.html (landing) + site/docs/<slug>.html (pagine)
//
// Regole: niente JS nel sito (sidebar con <details>, zero dipendenze client);
// i link interni ai .md vengono riscritti verso le pagine .html generate.
// =============================================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site", "docs");
const require = createRequire(import.meta.url);

// marked: lo stesso renderer usato dal resto del progetto (sidecar-src/node_modules)
let marked;
try {
  ({ marked } = require(join(ROOT, "sidecar-src", "node_modules", "marked")));
} catch {
  try { ({ marked } = require("marked")); } catch { marked = null; }
}
if (!marked) { console.error("[build-docs] marked non trovato (sidecar-src/node_modules)"); process.exit(1); }

// ── la struttura della documentazione (l'ORDINE conta: è la sidebar) ──
// Per aggiungere una pagina: metti il .md in docs/ e aggiungi una voce qui.
const SECTIONS = [
  { title: "Start here", pages: [
    { src: "../README.md", slug: "overview", title: "What is Quinki" },
    { src: "USER-GUIDE.md", slug: "user-guide", title: "User Guide" },
  ]},
  { title: "Market", pages: [
    { src: "MARKET.md", slug: "market", title: "The Quinki Market" },
  ]},
  { title: "Developer Guide", pages: [
    { src: "DEVELOPER.md", slug: "developer", title: "Build from source" },
    { src: "ARCHITECTURE.md", slug: "architecture", title: "Architecture" },
    { src: "DECISIONS.md", slug: "decisions", title: "Design decisions" },
    { src: "CLA.md", slug: "cla", title: "Contributor License Agreement" },
  ]},
  { title: "Design & roadmap", pages: [
    { src: "ACP-QUINKI.md", slug: "acp", title: "ACP mode (editor integration)" },
    { src: "AGENT-API.md", slug: "agent-api", title: "Agent API (OpenAI-compatible)" },
    { src: "INTELLIGENT-UI.md", slug: "intelligent-ui", title: "Intelligent UI (analysis)" },
  ]},
  { title: "Reports", pages: [
    { src: "reports/report-notion-obsidian-import.md", slug: "report-notion-import", title: "Notion/Obsidian import" },
    { src: "reports/ollama-deepseek-v41-flash-cloud-500.md", slug: "report-ollama-500", title: "Ollama Cloud 500" },
  ]},
];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slugOf = (p) => p.slug;

// ── rendering markdown → html ──
function renderMd(srcPath, slug) {
  const md = readFileSync(join(ROOT, "docs", srcPath), "utf8");
  // titolo = primo "# ..." del markdown (fallback: il nome file)
  const m = md.match(/^#\s+(.+)$/m);
  const title = m ? m[1].replace(/`/g, "").trim() : srcPath;
  let html = marked.parse(md, { mangle: false, headerIds: false });
  // link ai .md → pagine .html generate (stessa cartella o cartelle note)
  const map = new Map();
  for (const s of SECTIONS) for (const p of s.pages) map.set(p.src.replace(/^\.\.\//, ""), p.slug + ".html");
  html = html.replace(/href="([^"]*\.md)"/g, (all, href) => {
    const clean = href.replace(/^\.\//, "").replace(/^docs\//, "").replace(/^\.\.\//, "");
    const hit = map.get(clean);
    return hit ? `href="${hit}"` : all;
  });
  return { md, title, html };
}

// ── template pagina ──
function sidebarHtml(activeSlug) {
  let out = "";
  for (const s of SECTIONS) {
    const open = s.pages.some((p) => p.slug === activeSlug) ? " open" : "";
    out += `<details${open}><summary>${esc(s.title)}</summary><ul>`;
    for (const p of s.pages) {
      out += `<li><a href="${slugOf(p)}.html"${p.slug === activeSlug ? ' class="active"' : ""}>${esc(p.title)}</a></li>`;
    }
    out += "</ul></details>";
  }
  return out;
}
function page(title, activeSlug, contentHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Quinki Docs</title>
<link rel="icon" href="../favicon.svg"><link rel="stylesheet" href="docs.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="../index.html">Quinki</a><span class="docs-tag">Docs</span>
  <nav class="topnav">
    <a href="../index.html">Home</a>
    <a href="https://github.com/Upward991/Quinki" target="_blank" rel="noopener">GitHub</a>
  </nav>
</header>
<div class="layout">
  <aside class="sidebar">${sidebarHtml(activeSlug)}</aside>
  <main class="content">${contentHtml}</main>
</div>
<footer class="foot">Quinki documentation — built from the repository (docs/*.md)</footer>
</body>
</html>`;
}

// ── landing (site/docs/index.html) ──
function landing() {
  const cards = SECTIONS.map((s) => {
    const first = s.pages[0];
    return `<a class="card" href="${slugOf(first)}.html"><b>${esc(s.title)}</b><span>${esc(first.title)}${s.pages.length > 1 ? ` + ${s.pages.length - 1} more` : ""}</span></a>`;
  }).join("\n      ");
  const content = `
    <div class="crumb">docs</div>
    <h1>Quinki Documentation</h1>
    <p class="lead">Quinki is the Mac app that creates AI agents and orchestrates them: chats with multiple agents, skills, MCP servers, scheduled work (H24), Long Horizon sessions, a CLI, and a community Market. This documentation is generated from the source repository.</p>
    <div class="cards">
      ${cards}
    </div>`;
  return page("Documentation", "", content);
}

// ── build ──
mkdirSync(OUT, { recursive: true });
let n = 0;
for (const s of SECTIONS) {
  for (const p of s.pages) {
    const abs = join(ROOT, "docs", p.src);
    if (!existsSync(abs)) { console.log(`  ⚠ manca ${p.src} (salto ${p.slug})`); continue; }
    const { title, html } = renderMd(p.src, p.slug);
    const crumb = `<div class="crumb">${esc(s.title)}</div>`;
    const edit = `<p class="edit">Found a mistake? Edit <code>docs/${esc(p.src.replace(/^\.\.\//, ""))}</code> in the repository and open a pull request.</p>`;
    writeFileSync(join(OUT, p.slug + ".html"), page(title, p.slug, crumb + html + edit), "utf8");
    n++;
  }
}
writeFileSync(join(OUT, "index.html"), landing(), "utf8");
console.log(`[build-docs] ${n + 1} pagine → site/docs/ (landing + ${n} doc)`);
