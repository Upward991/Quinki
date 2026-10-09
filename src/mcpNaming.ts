// mcpNaming.ts — nomi LEGGIBILI per i server MCP.
// Problema (segnalato dall'utente, 9-10 ott 2026): installando "@notionhq/notion-mcp-server"
// l'app mostrava il nome "notionhq-notion-mcp-server" — sembrava il nome ufficiale di Notion,
// invece era lo SLUG generato da noi (scope-pacchetto + suffissi tecnici).
// Regola: l'id resta tecnico (stabile per config agenti e tool), il NOME mostrato in UI è umano.
// Esempi: "@notionhq/notion-mcp-server" -> "Notion" · "playwright-mcp" -> "Playwright" ·
// "sequential-thinking" -> "Sequential Thinking" · "com.notion/mcp" -> "Notion".

// Parole che vanno MAIUSCOLE (acronimi/brand noti). Tutto il resto: prima lettera maiuscola.
const ACRONYMS: Record<string, string> = { ai: "AI", api: "API", sdk: "SDK", cli: "CLI", mcp: "MCP", ui: "UI", id: "ID", os: "OS", db: "DB", js: "JS", ts: "TS", sql: "SQL", css: "CSS", html: "HTML", pdf: "PDF", docx: "DOCX", pptx: "PPTX", xlsx: "XLSX", ddg: "DDG", gpt: "GPT", e2b: "E2B", github: "GitHub" };

export function prettifyMcpName(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return s;
  // Già umano (spazi o maiuscole)? Non toccare.
  if (/\s/.test(s) || /[A-Z]/.test(s)) return s;
  const parts = s.replace(/^@/, "").replace(/[/_.]+/g, "-").toLowerCase().split("-").filter(Boolean);
  // Prefissi tipo dominio (registry MCP: "com.notion/mcp", "io.github.xxx/yyy")
  while (parts.length > 1 && /^(com|io|net|org)$/.test(parts[0])) parts.shift();
  // Suffissi e prefissi tecnici ("-mcp-server", "mcp-", "server-", "modelcontextprotocol-")
  while (parts.length > 1 && /^(mcp|server|modelcontextprotocol)$/.test(parts[parts.length - 1])) parts.pop();
  while (parts.length > 1 && /^(mcp|server|modelcontextprotocol)$/.test(parts[0])) parts.shift();
  // Scope ripetuto: "notionhq-notion-..." -> "notion-..."
  if (parts.length > 1) {
    const a = parts[0].replace(/hq$/, "");
    if (a.length >= 3 && parts[1].startsWith(a)) parts.shift();
  }
  if (!parts.length) return s;
  return parts.map((w) => ACRONYMS[w] || (w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}
