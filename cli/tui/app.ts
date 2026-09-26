// =============================================================================
// Quinki CLI — OUR terminal UI (T1, iteration 2)
//
// Layout mirrors the app window:
//   app-style margins around everything; header (top, fixed); chat transcript
//   (scrolls); composer box (bottom, fixed) with the button bar INSIDE the
//   rounded box — exactly like the app's composer.
//
// Engine: the vendored Pi SDK (invisible). No pi UI, no pi commands, no emoji
// icons — only text glyphs and the app's exact palette (see theme.ts).
// =============================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import {
  TuiAltScreen,
  ProcessTerminal,
  VStack,
  HStack,
  Text,
  Markdown,
  Editor,
  ScrollView,
  Container,
  Spacer,
  CombinedAutocompleteProvider,
  matchesKey,
  isKeyRelease,
  getCellDimensions,
  visibleWidth,
} from "../../sidecar-src/vendor/@earendil-works/pi-tui/dist/index.js";

import { C, fg, bg, bgKeepPanel, collapsed, counterColor, blend, bold, italicStyle } from "./theme";

// Engine (bundled at build time — literal specifiers only).
import * as sdk from "../../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/index.js";
import * as compaction from "../../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js";

export interface TuiOptions {
  cwd: string;
  agentDir: string;
  sessionDir: string;
}

/** App-window column: symmetric margins only (app chat area = window minus padding). */
class CenterBox {
  child: any;
  constructor(child: any) {
    this.child = child;
  }
  render(width: number): string[] {
    // Pixel cap — SAME AS THE APP: the chat column is --spacing-chat-max
    // (1000px). Uses the REAL font cell width when the terminal reports it
    // (CSI 16 t), else the default 9px cell.
    let capCols = 111; // floor(1000 / 9)
    try {
      const d: any = getCellDimensions?.() || {};
      const wpx = d?.widthPx || 0;
      if (wpx > 0) capCols = Math.floor(1000 / wpx);
    } catch {}
    // ALWAYS an EVEN column: the centered elements (brand "Quinki", box,
    // menu) then land EXACTLY on the center — no half-column drift on odd
    // terminal widths.
    let colW = Math.min(width - 4, capCols);
    if (colW % 2 !== 0) colW -= 1;
    colW = Math.max(8, colW);
    const left = Math.max(0, Math.floor((width - colW) / 2));
    const right = Math.max(0, width - colW - left);
    const inner = colW;
    const lines = this.child?.render(inner) || [];
    const l = " ".repeat(left);
    const r = " ".repeat(right);
    return lines.map((line: string) => l + line + r);
  }
  invalidate() {
    try {
      this.child?.invalidate?.();
    } catch {}
  }
}

/** Floating-panel block: padded, painted full-width background (no border), app style. */
class BgBlock {
  child: any;
  pad: number;
  paint: (s: string) => string;
  padY: number;
  constructor(child: any, pad: number, paint: (s: string) => string, padY = 0) {
    this.child = child;
    this.pad = pad;
    this.paint = paint;
    this.padY = padY;
  }
  render(width: number): string[] {
    const inner = Math.max(1, width - this.pad * 2);
    const lines = this.child?.render(inner) || [];
    const l = " ".repeat(this.pad);
    const r = " ".repeat(this.pad);
    const out: string[] = [];
    const blank = this.paint(" ".repeat(width));
    for (let i = 0; i < this.padY; i++) out.push(blank);
    for (const line of lines) {
      const fill = " ".repeat(Math.max(0, inner - visibleWidth(line)));
      out.push(this.paint(l + line + fill + r));
    }
    for (let i = 0; i < this.padY; i++) out.push(blank);
    return out;
  }
  invalidate() {
    try {
      this.child?.invalidate?.();
    } catch {}
  }
}

/** One full-width row built by a function (hints row, etc.). */
class FnLine {
  fn: (w: number) => string;
  constructor(fn: (w: number) => string) {
    this.fn = fn;
  }
  render(width: number): string[] {
    return [this.fn(width)];
  }
  invalidate() {}
}

/** One line, horizontally centered in the column. */
class CenteredLine {
  line: string;
  constructor(line: string) {
    this.line = line;
  }
  render(width: number): string[] {
    const w = visibleWidth(this.line);
    const pad = Math.max(0, Math.floor((width - w) / 2));
    return [" ".repeat(pad) + this.line];
  }
  invalidate() {}
}

/** Full-width divider line (app's header separator look). */
class RuleLine {
  render(width: number): string[] {
    return [fg(C.border, "\u2500".repeat(Math.max(0, width)))];
  }
  invalidate() {}
}

/** Horizontal inset wrapper — replicates the app's transcript padding (16px per side). */
let lastInsetInner = 0;
class InsetBox {
  child: any;
  insetFn: () => number;
  constructor(child: any, insetFn: () => number) {
    this.child = child;
    this.insetFn = insetFn;
  }
  render(width: number): string[] {
    let inset = 2;
    try {
      inset = Math.max(0, this.insetFn() || 0);
    } catch {}
    const inner = Math.max(8, width - inset * 2);
    lastInsetInner = inner;
    const lines = this.child?.render(inner) || [];
    const l = " ".repeat(inset);
    const r = " ".repeat(inset);
    return lines.map((line: string) => l + line + r);
  }
  invalidate() {
    try {
      this.child?.invalidate?.();
    } catch {}
  }
}

/** Welcome root: the box + hints, centered EXACTLY (manual math, both axes). */
class WelcomeRoot {
  box: any;
  hint: any;
  termFn: () => number;
  constructor(box: any, hint: any, termFn: () => number) {
    this.box = box;
    this.hint = hint;
    this.termFn = termFn;
  }
  render(width: number): string[] {
    const rows = Math.max(12, this.termFn() || 24);
    const boxLines = this.box?.render(width) || [];
    const hintLines = this.hint?.render(width) || [];
    const group = boxLines.length + 1 + hintLines.length;
    const top = Math.max(0, Math.floor((rows - group) / 2));
    const out: string[] = [];
    for (let i = 0; i < top; i++) out.push("");
    out.push(...boxLines, "", ...hintLines);
    while (out.length < rows) out.push("");
    return out;
  }
  invalidate() {
    try {
      this.box?.invalidate?.();
      this.hint?.invalidate?.();
    } catch {}
  }
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "\u2026" : t;
}

function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "K";
  return String(Math.round(n));
}

function fmtWhen(ms: number): string {
  try {
    const d = new Date(ms || 0);
    return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

/** Word-wrap a plain (ANSI-free) string to a visible width. */
function wrapPlain(s: string, width: number): string[] {
  const out: string[] = [];
  const w = Math.max(4, width);
  for (const raw of String(s || "").split("\n")) {
    if (raw.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of raw.split(" ")) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += " " + word;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** A real blank separator row (pi-tui Text skips whitespace-only strings). */
class BlankRow {
  render(width: number): string[] {
    return [" ".repeat(Math.max(1, width))];
  }
  invalidate() {}
}

/**
 * App-style toggle block (MessageBubble GenericToggle, terminal replica):
 *  - collapsed: ▸ + dimmed label/color + grey preview (first line, 80 chars)
 *  - open: ▾ + full-color label + body rows with a left vertical bar (2px in the app)
 *  - ToolToggle style: label + BOLD tool name (no separator dot)
 *  - Thinking: italic body
 *  - selected (Ctrl+up/down): full color even when collapsed
 */
class ToggleBlock {
  label: string;
  boldName: string;
  color: string;
  body: string;
  italic: boolean;
  open = false;
  selected = false;
  constructor(o: { label: string; boldName?: string; color: string; body?: string; italic?: boolean; open?: boolean }) {
    this.label = o.label;
    this.boldName = o.boldName || "";
    this.color = o.color;
    this.body = o.body || "";
    this.italic = !!o.italic;
    this.open = !!o.open;
  }
  setBody(s: string) {
    this.body = s;
  }
  render(width: number): string[] {
    const col = this.open || this.selected ? this.color : blend(this.color, C.bg, 0.5);
    const arrow = this.open ? "\u25be" : "\u25b8";
    let head = fg(col, arrow + " ") + fg(col, this.label);
    if (this.boldName) head += " " + bold(fg(col, this.boldName));
    if (!this.open) {
      const first = String(this.body || "").split("\n")[0] || "";
      const preview = first.length > 80 ? first.slice(0, 79) + "\u2026" : first;
      if (preview.trim()) head += "  " + fg(C.textTertiary, preview);
    }
    const out = [head];
    if (this.open && this.body) {
      const inner = Math.max(6, width - 3);
      // The vertical bar starts right under the header, on an EMPTY first row,
      // then the body follows (applies to every toggle).
      out.push(fg(this.color, "\u2502".padEnd(Math.max(1, width))));
      for (const line of wrapPlain(this.body, inner)) {
        const styled = this.italic ? italicStyle(fg(this.color, line)) : fg(this.color, line);
        out.push(fg(this.color, "\u2502 ") + styled);
      }
    }
    return out;
  }
  invalidate() {}
}

export async function runTui(opts: TuiOptions): Promise<void> {
  const key = "cli-" + Date.now().toString(36);
  const sessionDirForKey = path.join(opts.sessionDir, key);
  fs.mkdirSync(sessionDirForKey, { recursive: true });

  // --- engine (invisible): the same SDK the sidecar/app use -----------------
  const sm = sdk.SessionManager.create(opts.cwd, sessionDirForKey);
  const res: any = await sdk.createAgentSession({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    sessionManager: sm,
  });
  let session: any = res?.session || res;
  // Mutable run state — reset / directory switch / chat switch rebuild these.
  let currentCwd = opts.cwd;
  let currentSessionDir = sessionDirForKey;
  let currentKey = key;

  // Auth fallback: provider keys live in models.json (same as the sidecar).
  try {
    const modelsJson = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "models.json"), "utf8"));
    for (const [prov, pcfg] of Object.entries(modelsJson.providers || {})) {
      const k = (pcfg as any)?.apiKey;
      if (k && typeof k === "string" && k.length > 0) {
        try {
          session.modelRegistry?.authStorage?.setRuntimeApiKey?.(prov, k);
        } catch {}
      }
    }
  } catch {}

  // --- UI ---------------------------------------------------------------------
  const terminal = new ProcessTerminal();
  const ui = new TuiAltScreen(terminal, true, undefined, {
    mouse: true,
    wheelScrollLines: 4,
    copyOnSelect: true,
  });

  // Header (fixed, top): chat icon + title ONLY, drawn as a floating-panel block
  // (plain background color, no border) — same width as the composer and chat.
  // Header (fixed, top): chat title on the LEFT, working directory on the RIGHT
  // (no icon), drawn as a floating-panel block.
  let headerTitle = "New chat";
  const fmtDirShort = (): string => {
    try {
      const home = process.env.HOME || "";
      return home && currentCwd.startsWith(home) ? "~" + currentCwd.slice(home.length) : currentCwd;
    } catch {
      return "";
    }
  };
  const titleText = new FnLine((w: number) => {
    const t = fg(C.text, headerTitle);
    const dir = fmtDirShort();
    const tw = visibleWidth(t);
    const dw = visibleWidth(dir);
    if (!dir) return t;
    const gap = Math.max(1, w - tw - dw);
    return t + " ".repeat(gap) + fg(C.textTertiary, dir);
  });
  const header = new BgBlock(titleText, 1, (s: string) => bg(C.bgPanel, s), 1);
  const setChatTitle = (title: string) => {
    headerTitle = title && title.trim() ? title.trim() : "New chat";
    try {
      ui.requestRender();
    } catch {}
  };

  // Chat transcript (scrolls, grows)
  const content = new Container();
  // The ScrollView must be a DIRECT layout child (the layout only recognizes it
  // through [LAYOUT_NODE]): it gets updateLayout/follow/wheel from the engine.
  // The centering + inset live INSIDE it, around the transcript content.
  const scroll = new ScrollView(new CenterBox(new InsetBox(content, () => qInsetCols())) as any, { follow: "end" } as any);
  try {
    (globalThis as any).__quinkiScroll = scroll;
  } catch {}

  // Composer (fixed, bottom): rounded box with the bar INSIDE (app look)
  const editorTheme = {
    borderColor: (s: string) => fg(C.border, s),
    selectList: {
      selectedPrefix: (s: string) => bg(C.primary, fg(C.bgPanel, s)),
      selectedText: (s: string) => bg(C.primary, fg(C.bgPanel, s)),
      description: (s: string) => fg(C.textTertiary, s),
      scrollInfo: (s: string) => fg(C.textTertiary, s),
      noMatch: (s: string) => fg(C.textTertiary, s),
    },
  };
  const editor = new Editor(ui as any, editorTheme, { paddingX: 1 });
  try {
    (editor as any).bgFn = (s: string) => bg(C.bgPanel, s);
  } catch {}

  // /skill — app semantics (like listChatSkills): only the skills the model CANNOT
  // invoke by itself (disable-model-invocation || user-invocable), grouped by the
  // agents of THIS chat with a separator row carrying the agent name.
  const chatAgentIds = (): string[] => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "quinki-sessions.json"), "utf8"));
      const e = Array.isArray(raw) ? raw.find((s: any) => s?.key === currentKey) : null;
      const ids = String(e?.agentId || "").split(",").map((s: string) => s.trim()).filter(Boolean);
      if (ids.length) return ids;
    } catch {}
    return ["orchestrator"];
  };
  const injectableSkillsFor = (agentId: string): any[] => {
    const out: any[] = [];
    try {
      const cf = path.join(opts.agentDir, "agents", agentId, "config.json");
      if (!fs.existsSync(cf)) return out;
      const cfg = JSON.parse(fs.readFileSync(cf, "utf8"));
      const listed: string[] = Array.isArray(cfg?.skills) ? cfg.skills.map((s: any) => String(s)) : [];
      const sdir = path.join(opts.agentDir, "skills");
      for (const name of listed) {
        const p2 = path.join(sdir, name, "SKILL.md");
        if (!fs.existsSync(p2)) continue;
        let desc = "";
        let injectOnly = false;
        try {
          const txt = fs.readFileSync(p2, "utf8");
          const fm = txt.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fm) {
            const dm = fm[1].match(/^description:\s*(.+)$/m);
            if (dm) desc = dm[1].trim();
            injectOnly = /^disable-model-invocation:\s*true/mi.test(fm[1]) || /^user-invocable:\s*true/mi.test(fm[1]);
          }
        } catch {}
        if (injectOnly) out.push({ name, description: desc });
      }
    } catch {}
    return out;
  };
  const skillGroupsCached = () => {
    const groups: any[] = [];
    for (const id of chatAgentIds()) {
      const sk = injectableSkillsFor(id);
      if (!sk.length) continue;
      let an = id;
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "agents", id, "config.json"), "utf8"));
        an = String(cfg?.name || id);
      } catch {}
      groups.push({ agentId: id, agentName: an, skills: sk });
    }
    return groups;
  };

  // Slash commands — ONLY commands that actually work, ALL silently (no chat
  // output). Commands with options open an app-style submenu (argument list).
  const commands = [
    {
      name: "model",
      description: "Change model",
      seq: 5,
      getArgumentCompletions: (prefix: string) => {
        const items: any[] = [];
        try {
          const models: any[] = session.modelRuntime?.getAvailableSnapshot?.() || [];
          for (const m of models) {
            const id = String(m?.id ?? "");
            if (!id) continue;
            const prov = String(m?.provider ?? "");
            const cur = session?.model?.id === id && String(session?.model?.provider ?? "") === prov;
            items.push({ value: id, label: id, description: (cur ? "current \u00b7 " : "") + prov });
          }
        } catch {}
        return items.filter((i) => i.value.toLowerCase().startsWith(prefix.toLowerCase()));
      },
    },
    {
      name: "thinking",
      description: "Thinking: on / off",
      seq: 6,
      getArgumentCompletions: (prefix: string) =>
        [
          { value: "on", label: "on", description: "Thinking ON \u2014 always the maximum level" },
          { value: "off", label: "off", description: "Thinking OFF" },
        ].filter((i) => i.value.startsWith(prefix)),
    },
    {
      name: "compaction",
      description: "Compact now, or toggle auto-compaction",
      seq: 7,
      getArgumentCompletions: (prefix: string) => {
        const auto = (() => {
          try {
            return !!((session as any).autoCompactionEnabled ?? (session as any).settingsManager?.getCompactionEnabled?.());
          } catch {
            return false;
          }
        })();
        // Contextual toggle: only the opposite of the current auto state.
        const items = [
          { value: "now", label: "compact now", description: "Compact the conversation now" },
          auto
            ? { value: "disable", label: "disable autocompaction", description: "Auto-compaction is currently ON" }
            : { value: "enable", label: "enable autocompaction", description: "Auto-compaction is currently OFF" },
        ];
        return items.filter((i) => i.value.startsWith(prefix) || i.label.startsWith(prefix));
      },
    },
    {
      name: "directory",
      description: "Working directory",
      seq: 8,
      getArgumentCompletions: (prefix: string) => {
        const items: any[] = [];
        const home = os.homedir();
        const p = prefix.trim();
        const push = (v: string, l: string, d: string) => {
          if (!items.some((x) => x.value === v)) items.push({ value: v, label: l, description: d });
        };
        // the typed path comes first (it mirrors what you are writing)
        if (p) push(p, p, "use this path");
        push(currentCwd, currentCwd === home ? "~" : currentCwd, "current directory");
        const parent = path.dirname(currentCwd);
        if (parent && parent !== currentCwd) push(parent, parent, "parent directory");
        push(home, "~", "home directory");
        return items.filter(
          (i) => p === "" || i.label.toLowerCase().startsWith(p.toLowerCase()) || i.value.toLowerCase().startsWith(p.toLowerCase())
        );
      },
    },
    {
      name: "skill",
      description: "Activate a skill",
      seq: 9,
      hidden: () => skillGroupsCached().length === 0,
      getArgumentCompletions: (prefix: string) => {
        const items: any[] = [];
        const p = prefix.toLowerCase();
        for (const g of skillGroupsCached()) {
          const skills = g.skills.filter((s: any) => s.name.toLowerCase().startsWith(p));
          if (skills.length === 0) continue;
          items.push({ value: "__sep_" + g.agentId, label: g.agentName, description: "", separator: true });
          for (const s of skills) items.push({ value: s.name, label: s.name, description: s.description || "skill" });
        }
        return items;
      },
    },
    {
      name: "reset",
      description: "Clear messages. Keeps model, directory and settings.",
      seq: 11,
      getArgumentCompletions: () => [
        { value: "confirm", label: "yes, clear all messages", description: "Reset session? All messages will be deleted." },
        { value: "cancel", label: "no, keep everything", description: "Keep the conversation as it is" },
      ],
    },
    {
      name: "sessions",
      description: "Switch to another chat",
      seq: 1,
      getArgumentCompletions: (prefix: string) => {
        const items: any[] = [];
        const labels: Record<string, string> = {};
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "quinki-sessions.json"), "utf8"));
          if (Array.isArray(raw)) {
            for (const s of raw) {
              const k = String(s?.key ?? "");
              if (!k) continue;
              labels[k] = String(s?.label || "");
              if (k === currentKey || k === "__app_expert__" || k.startsWith("__exec_")) continue;
              items.push({ value: k, label: labels[k] || k, description: "chat \u00b7 " + fmtWhen(Number(s?.lastActivity) || 0) });
            }
          }
        } catch {}
        try {
          const sdir = path.join(opts.agentDir, "sessions", "quinki");
          const cliItems: any[] = [];
          for (const d of fs.readdirSync(sdir)) {
            if (!d.startsWith("cli-") || d === currentKey) continue;
            const dp = path.join(sdir, d);
            let has = false;
            let mtime = 0;
            try {
              const st = fs.statSync(dp);
              mtime = st.mtimeMs;
              for (const f of fs.readdirSync(dp)) if (f.endsWith(".jsonl")) { has = true; break; }
            } catch {}
            if (!has) continue; // empty throwaway runs are never listed (no dead items)
            cliItems.push({ value: d, label: labels[d] || d, description: "cli \u00b7 " + fmtWhen(mtime), mtime });
          }
          cliItems.sort((a: any, b: any) => b.mtime - a.mtime);
          for (const c of cliItems) {
            delete c.mtime;
            items.push(c);
          }
        } catch {}
        const p = prefix.toLowerCase();
        return items.filter((i) => i.label.toLowerCase().includes(p) || i.value.toLowerCase().includes(p));
      },
    },
    {
      name: "agent",
      description: "Agents in this chat",
      seq: 2,
      getArgumentCompletions: (prefix: string) => {
        const items: any[] = [];
        try {
          const adir = path.join(opts.agentDir, "agents");
          for (const id of fs.readdirSync(adir)) {
            const cf = path.join(adir, id, "config.json");
            if (!fs.existsSync(cf)) continue;
            let cfg: any = {};
            try {
              cfg = JSON.parse(fs.readFileSync(cf, "utf8"));
            } catch {}
            const nm = String(cfg?.name || id);
            const bits: string[] = [];
            if (cfg?.model) bits.push(String(cfg.model));
            if (cfg?.thinkingLevel) bits.push("thinking " + String(cfg.thinkingLevel));
            const nSk = Array.isArray(cfg?.skills) ? cfg.skills.length : 0;
            if (nSk) bits.push(nSk + " skill" + (nSk === 1 ? "" : "s"));
            items.push({ value: id, label: nm, description: bits.join(" \u00b7 ") });
          }
        } catch {}
        const p = prefix.toLowerCase();
        return items.filter((i) => i.value.toLowerCase().startsWith(p) || i.label.toLowerCase().startsWith(p));
      },
    },
    {
      name: "rename",
      description: "Rename this chat",
      seq: 3,
      hidden: () => welcomeShown,
      getArgumentCompletions: (prefix: string) => {
        const p = prefix.trim();
        // Always show the field so it is clear where to type the new name.
        return p
          ? [{ value: p, label: p, description: "set this title" }]
          : [{ value: "", label: "type the new name\u2026", description: "then Enter to set it" }];
      },
    },
    { name: "reload", description: "Reload this chat (recover history, fix glitches)", seq: 4 },
    { name: "export", description: "Export this chat as Markdown", seq: 10 },
    {
      name: "quit",
      description: "Exit quinki (asks for confirmation)",
      seq: 12,
      getArgumentCompletions: () => [
        { value: "yes", label: "yes", description: "Yes, exit quinki" },
        { value: "no", label: "no", description: "No, keep it open" },
      ],
    },
  ];
  // The slash menu is OURS (rendered via editor.menuLinesFn): it never writes
  // command text into the box — navigation and options live in the menu only.

  // --- toggle blocks (app-style) -----------------------------------------------
  // Ctrl+Up/Down selects a toggle, Enter opens/closes it, Esc deselects.
  const toggles: ToggleBlock[] = [];
  let selToggle = -1;
  let navMode = false;
  const registerToggle = (t: ToggleBlock) => {
    toggles.push(t);
    return t;
  };
  /** Scroll the viewport so the given toggle is visible (heights estimated). */
  const scrollToggleIntoView = (idx: number) => {
    try {
      if (idx < 0 || !toggles[idx]) return;
      if (idx === toggles.length - 1) {
        scroll.scrollToEnd();
        return;
      }
      const w = lastInsetInner || 80;
      let row = 0;
      let found = -1;
      for (const ch of (content as any).children || []) {
        if (ch === toggles[idx]) {
          found = row;
          break;
        }
        try {
          row += ((ch as any).render(w) || []).length;
        } catch {}
      }
      if (found >= 0) scroll.scrollTo(Math.max(0, found - 2));
    } catch {}
  };
  const enterToggleNav = () => {
    navMode = true;
    if (toggles.length > 0) {
      selToggle = toggles.length - 1;
      toggles.forEach((t, i) => (t.selected = i === selToggle));
      scrollToggleIntoView(selToggle);
    }
    ui.requestRender();
  };
  const exitToggleNav = () => {
    navMode = false;
    selToggle = -1;
    toggles.forEach((t) => {
      t.open = false;
      t.selected = false;
    });
    ui.requestRender();
  };
  const toggleNavMode = () => {
    if (navMode) exitToggleNav();
    else enterToggleNav();
  };
  const moveToggleSel = (dir: number) => {
    if (toggles.length === 0) return;
    if (selToggle < 0) selToggle = toggles.length - 1;
    else selToggle = Math.max(0, Math.min(toggles.length - 1, selToggle + dir));
    toggles.forEach((t, i) => (t.selected = i === selToggle));
    scrollToggleIntoView(selToggle);
    ui.requestRender();
  };
  const setToggleOpen = (open: boolean) => {
    if (selToggle < 0 || !toggles[selToggle]) return;
    toggles[selToggle].open = open;
    scrollToggleIntoView(selToggle);
    ui.requestRender();
  };

  // Tab = toggle plan/build (app behaviour), intercepted at the TUI level.
  try {
    ui.addInputListener((data: string) => {
      // Kitty-capable terminals also report key RELEASE events (e.g. "\x1b[1;1:3C"):
      // they must NEVER be treated as a second press — ↓ would jump two rows and
      // → would confirm & close the menu at once. Drop them all.
      if (isKeyRelease(data)) {
        return { consume: true };
      }
      // Ctrl+T = toggle navigation mode: ↑↓ move between toggles, → opens,
      // ← closes, Esc exits and closes them all (modal: other keys swallowed).
      const isCtrlT = data === "\x14" || matchesKey(data, "ctrl+t");
      if (isCtrlT && !(menuOpenRef?.() ?? false)) {
        toggleNavMode();
        return { consume: true };
      }
      if (navMode && !(menuOpenRef?.() ?? false)) {
        const isUpN = data === "\x1b[A" || matchesKey(data, "up");
        const isDownN = data === "\x1b[B" || matchesKey(data, "down");
        const isLeftN = data === "\x1b[D" || matchesKey(data, "left");
        const isRightN = data === "\x1b[C" || matchesKey(data, "right");
        const isEscN = data === "\x1b" || matchesKey(data, "escape");
        if (isEscN) {
          exitToggleNav();
          return { consume: true };
        }
        if (isUpN || isDownN) {
          moveToggleSel(isUpN ? -1 : 1);
          return { consume: true };
        }
        if (isRightN) {
          setToggleOpen(true);
          return { consume: true };
        }
        if (isLeftN) {
          setToggleOpen(false);
          return { consume: true };
        }
        return { consume: true };
      }
      const isTab =
        data === "\t" || data === "\x1b[9u" || data === "\x1b[9;1u" || matchesKey(data, "tab");
      if (isTab) {
        toggleModeRef?.();
        return { consume: true };
      }
      const isEnter = data === "\r" || data === "\n" || matchesKey(data, "enter");
      const isEsc = data === "\x1b" || matchesKey(data, "escape");
      const isUp = data === "\x1b[A" || matchesKey(data, "up");
      const isDown = data === "\x1b[B" || matchesKey(data, "down");
      const isLeft = data === "\x1b[D" || matchesKey(data, "left");
      const isRight = data === "\x1b[C" || matchesKey(data, "right");
      const menuNow = menuOpenRef?.() ?? false;
      if (isEsc) {
        escFlashUntil = Date.now() + 450;
        try {
          ui.requestRender();
        } catch {}
        setTimeout(() => {
          try {
            ui.requestRender();
          } catch {}
        }, 500);
        if (menuNow) {
          menuNavRef?.("escape");
          return { consume: true };
        }
        return undefined;
      }
      if (menuNow) {
        if (isUp || isDown || isLeft || isRight || isEnter) {
          menuNavRef?.(isUp ? "up" : isDown ? "down" : isLeft ? "left" : isRight ? "right" : "enter");
          return { consume: true };
        }
        if (menuSub) {
          // Typing inside a submenu filters the options — never writes in the box.
          if (data.length === 1 && data >= " " && data !== "\x7f") {
            menuSubFilter += data;
            menuSel = 0;
            menuConfirmFocus = false;
            try {
              ui.requestRender();
            } catch {}
            return { consume: true };
          }
          if (data === "\x7f" || data === "\x08" || matchesKey(data, "backspace")) {
            menuSubFilter = menuSubFilter.slice(0, -1);
            menuSel = 0;
            menuConfirmFocus = false;
            try {
              ui.requestRender();
            } catch {}
            return { consume: true };
          }
        }
      }
      return undefined;
    });
  } catch {}

  const boxWrap = new CenterBox(editor) as any;
  let hintRow: any = null;
  // App measures: the transcript scrolls inside a 16px horizontal padding
  // (ChatArea: padding '16px 16px') — convert to terminal columns with the real
  // cell width so the inset matches the app at every font size.
  const qInsetCols = (): number => {
    try {
      const d: any = getCellDimensions?.() || {};
      const wpx = d?.widthPx || 0;
      if (wpx > 0) return Math.max(1, Math.round(16 / wpx));
    } catch {}
    return 2;
  };
  const applyLayout = (welcome: boolean) => {
    try {
      const headerWrap = new CenterBox(header) as any;
      const hintWrap = new CenterBox(hintRow) as any;
      // App-matching spacing (PADDING only — no visible rules): a blank row
      // under the heading, one above the text box, one between the box and the
      // hint row.
      const blank = () => new FnLine(() => " ");
      const root = welcome
        ? new WelcomeRoot(boxWrap, hintWrap, () => (ui as any)?.terminal?.rows || 24)
        : new VStack([
            { component: headerWrap, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
            { component: blank(), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
            { component: scroll as any, basis: 0, grow: 1, shrink: 1, minSize: 1 },
            { component: blank(), basis: "auto", grow: 0, shrink: 1, minSize: 0 },
            { component: boxWrap, basis: "auto", grow: 0, shrink: 1, minSize: 5 },
            { component: blank(), basis: "auto", grow: 0, shrink: 1, minSize: 0 },
            { component: hintWrap, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
          ]);
      ui.setLayoutRoot(root as any);
      ui.requestRender();
    } catch {}
  };

  for (const c of [header, scroll, editor]) {
    try {
      ui.addChild(c as any);
    } catch {}
  }
  try {
    ui.setFocus(editor as any);
  } catch {}

  // --- state ------------------------------------------------------------------
  let streaming = false;
  let mode: "plan" | "build" = "plan"; // app-like default: Plan
  let thinkingOn = true; // On = always max level (engine semantics)
  let ctxTokens = 0;
  let ctxWindow = 0;
  let lastAssistantText = "";
  let defaultModelId = "";
  try {
    const s: any = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "settings.json"), "utf8"));
    defaultModelId = s.defaultModel || "";
  } catch {}
  let toggleModeRef: (() => void) | null = null;
  let handleSlashRef: ((raw: string) => void) | null = null;
  let escFlashUntil = 0;
  // Slash menu (OURS — app-style; it NEVER writes command text into the box).
  let menuSub: string | null = null; // command name while inside its submenu
  let menuSubFilter = ""; // filter typed inside a submenu
  let menuSel = 0; // selected row
  let menuConfirmFocus = false; // → focused the Confirm action (app NavBar focusConfirm)
  let menuLastFilter = ""; // to reset the selection when the filter changes
  let menuOpenRef: (() => boolean) | null = null;
  let menuNavRef: ((a: "up" | "down" | "left" | "right" | "enter" | "escape") => void) | null = null;
  // Status pill (app-style): Running (teal) / Compacting (blue) / Failed (red).
  let statusLabel = "";
  let statusKind = "";
  const setStatus = (label: string, kind: string) => {
    statusLabel = label;
    statusKind = kind;
    // NOTE: NEVER requestImmediateRender() here — events arrive inside the
    // engine dispatch and an immediate render is RE-ENTRANT (stale/corrupted
    // frames). The scheduled requestRender is the safe path (verified).
    try {
      ui.requestRender();
    } catch {}
  };

  const toggleMode = () => {
    mode = mode === "plan" ? "build" : "plan";
    try {
      ui.requestRender();
    } catch {}
  };
  toggleModeRef = toggleMode;

  let assistant: any = null;
  let assistantText = "";
  let thinkingRow: any = null;
  let thinkingText = "";
  let welcomeShown = true;

  // TUI accent = VIOLET (the app's home/primary accent — deliberately different
  // from the chat's blue, so the CLI is its own thing).
  const accent = C.primary;

  const hasText = () => {
    try {
      return editor.getText().trim().length > 0;
    } catch {
      return false;
    }
  };

  /** The composer bar (inside the box): LEFT-aligned, all at the same brightness
   *  (the ctx-counter brightness): mode · ctx · model · thinking · directory. */
  const buildBarLine = (width: number): string => {
    const pct = ctxWindow > 0 ? (ctxTokens / ctxWindow) * 100 : 0;
    const ctxStr = fg(
      counterColor(pct),
      `${fmtTok(ctxTokens)}/${fmtTok(ctxWindow)} (${Math.floor(pct)}% \u00b1 ${Math.ceil(pct * 0.05 + 1)}%)`
    );
    const modelId = session?.model?.id || defaultModelId || "";
    const sep = fg(C.textTertiary, "  \u00b7  ");
    const quiet = (s: string) => fg(C.textTertiary, s);
    const modeStr = mode === "plan" ? fg(C.modePlan, "Plan") : fg(C.modeBuild, "Build");
    const bar =
      modeStr +
      sep +
      ctxStr +
      sep +
      quiet(modelId) +
      sep +
      quiet("thinking " + (thinkingOn ? "on" : "off"));
    // Status pill (app-style): same row as the info, right-aligned — visible
    // only while the engine streams / compacts (Failed stays until next turn).
    const pillOn =
      !!statusLabel && (streaming || statusKind === "compacting" || statusKind === "failed" || statusKind === "sending");
    if (!pillOn) return bar;
    const statusColor: Record<string, string> = {
      running: C.statusRunning,
      compacting: C.statusCompacting,
      sending: C.modePlanDim,
      failed: C.danger,
      retrying: C.modeBuild,
      thinking: C.thinking,
      writing: C.statusWriting,
      tool_call: C.toolCall,
      tool_result: C.toolResult,
      tool_error: C.danger,
    };
    const pill = fg(statusColor[statusKind] || C.text, statusLabel);
    const gap = Math.max(1, width - visibleWidth(bar) - visibleWidth(pill));
    return bar + " ".repeat(gap) + pill;
  };
  try {
    (editor as any).footerLine = (w: number) => buildBarLine(w);
  } catch {}
  try {
    // Thin edges on the box: LEFT = mode color (Plan pink / Build orange),
    // RIGHT = violet accent (always lit).
    (editor as any).edgeFn = () => fg(mode === "plan" ? C.modePlan : C.modeBuild, "\u258f");
    (editor as any).edgeRightFn = () => fg(C.primary, "\u2595");
  } catch {}
  try {
    // Menu footer (two rows): left ← (back) / → (forward); right Esc (red,
    // closes) · Enter (violet, selects).
    (editor as any).menuFooterFn = (w: number) => {
      const right = fg(C.danger, "Esc") + fg(C.textTertiary, "  ") + fg(C.primary, "Enter");
      const rw = visibleWidth(right);
      const row1 = fg(C.primary, "\u2190") + " ".repeat(Math.max(1, w - 1 - rw)) + right;
      const row2 = fg(C.primary, "\u2192");
      return [row1, row2];
    };
  } catch {}

  // Keyboard hint row — ALWAYS under the text box, with dynamic violet
  // illumination (the TUI accent = home violet):
  //   /command  -> lit while the slash menu is open
  //   Enter     -> lit when a message can be sent
  //   Ctrl+Enter-> lit while steering is possible (generating + text)
  //   Esc       -> flashes lit right when pressed
  const buildHintLine = (width: number): string => {
    const lit = (s: string) => bold(fg(C.primary, s));
    const quiet = (s: string) => fg(C.textTertiary, s);
    const sec = (s: string) => fg(C.textSecondary, s);
    if (navMode) {
      // Toggle navigation ON: its keys replace the chat ones (close left, open right).
      const leftN = lit("Toggle Nav (Ctrl+T)") + fg(C.textTertiary, "  \u00b7  ") + sec("Move (\u2191\u2193)") + fg(C.textTertiary, "  \u00b7  ") + sec("Close (\u2190)");
      const rightN = sec("Open (\u2192)") + fg(C.textTertiary, "  \u00b7  ") + fg(C.danger, "Esc");
      const brandN = fg(C.primary, "\u2500\u2500\u2500") + " " + fg(C.primary, "Quinki") + " " + fg(C.primary, "\u2500\u2500\u2500");
      const lwN = visibleWidth(leftN);
      const rwN = visibleWidth(rightN);
      const startN = Math.max(lwN + 1, Math.floor((width - 14) / 2));
      const g1N = Math.max(1, startN - lwN);
      const g2N = Math.max(1, width - startN - 14 - rwN);
      return leftN + " ".repeat(g1N) + brandN + " ".repeat(g2N) + rightN;
    }
    const menuActive = menuOpenRef?.() ?? false;
    const canSend = hasText() && !streaming && !menuActive;
    const canSteer = streaming && hasText();
    const escLit = Date.now() < escFlashUntil;
    const textNow = (() => {
      try {
        return editor.getText().trim();
      } catch {
        return "";
      }
    })();
    // A complete slash command waiting to be run -> Enter is FILLED (violet bg).
    const cmdReady = !menuActive && textNow.startsWith("/") && textNow.length > 1;

    const left =
      (menuActive ? lit("Menu (/)") : quiet("Menu (/)")) +
      fg(C.textTertiary, "  \u00b7  ") +
      quiet("Toggle Nav (Ctrl+T)");
    const sep = fg(C.textTertiary, "  \u00b7  ");
    const stopKey = escLit ? bold(fg(C.danger, "Stop (Esc)")) : quiet("Stop (Esc)");
    const steerKey = canSteer ? lit("Steer (Ctrl+Enter)") : quiet("Steer (Ctrl+Enter)");
    const sendKey = cmdReady
      ? bold(bg(C.primary, fg(C.bgPanel, " Send (Enter) ")))
      : canSend
        ? lit("Send (Enter)")
        : quiet("Send (Enter)");
    const right = stopKey + sep + steerKey + sep + sendKey;

    // "─── Quinki ───" — brand centered with violet divider lines around it.
    const brand = fg(C.primary, "\u2500\u2500\u2500") + " " + fg(C.primary, "Quinki") + " " + fg(C.primary, "\u2500\u2500\u2500");
    const lw = visibleWidth(left);
    const rw = visibleWidth(right);
    const bw = 14;
    const start = Math.max(lw + 1, Math.floor((width - bw) / 2));
    const gap1 = Math.max(1, start - lw);
    const gap2 = Math.max(1, width - start - bw - rw);
    return left + " ".repeat(gap1) + brand + " ".repeat(gap2) + right;
  };
  try {
    hintRow = new FnLine((w: number) => buildHintLine(w));
  } catch {}

  const mdTheme = {
    heading: (s: string) => fg(C.text, s),
    link: (s: string) => fg(C.info, s),
    linkUrl: (s: string) => fg(C.textTertiary, s),
    code: (s: string) => fg(C.text, s),
    codeBlock: (s: string) => fg(C.text, s),
    codeBlockBorder: (s: string) => fg(C.border, s),
    quote: (s: string) => fg(C.textSecondary, s),
    quoteBorder: (s: string) => fg(C.border, s),
    hr: (s: string) => fg(C.border, s),
    listBullet: (s: string) => fg(C.primary, s),
    bold: (s: string) => fg(C.text, s),
    italic: (s: string) => fg(C.text, s),
    strikethrough: (s: string) => fg(C.textSecondary, s),
    underline: (s: string) => fg(C.text, s),
  };

  const scrollToEnd = () => {
    try {
      scroll.scrollToEnd();
    } catch {}
    try {
      ui.requestRender();
    } catch {}
  };

  // Transcript blocks get one blank separator row between them — the app's
  // inter-message spacing (MessageBubble margin 8px).
  let blockCount = 0;
  const pushBlock = (comp: any) => {
    try {
      if (blockCount > 0) content.addChild(new BlankRow());
      content.addChild(comp);
      blockCount++;
    } catch {}
    return comp;
  };

  const addRow = (styled: string, indent = 1) => {
    const row = pushBlock(new Text(styled, indent, 0));
    scrollToEnd();
    return row;
  };

  const updateBar = () => {
    try {
      ui.requestRender();
    } catch {}
  };

  const updateCtx = () => {
    try {
      const model = session.model;
      const w = model?.contextWindow || model?.contextWindowTokens || model?.contextLength || 0;
      if (typeof w === "number" && w > 0) ctxWindow = w;
      let tokens = 0;
      try {
        const msgs = session.messages || [];
        if (typeof compaction.estimateContextTokens === "function") {
          const est = compaction.estimateContextTokens(msgs, model);
          if (typeof est === "number") tokens = est;
          else if (est && typeof est.tokens === "number") tokens = est.tokens;
        }
      } catch {}
      if (tokens > 0) ctxTokens = tokens;
      updateBar();
    } catch {}
  };

  // --- streaming events --------------------------------------------------------
  const onSessionEvent = (e: any) => {
    try {
      if (e?.type === "agent_start") {
        streaming = true;
        setStatus("Running", "running");
        updateBar();
      } else if (
        e?.type === "message_update" &&
        e?.assistantMessageEvent &&
        e?.message?.role === "assistant"
      ) {
        const ame = e.assistantMessageEvent;
        if (ame.type === "text_delta") {
          setStatus("Writing", "writing");
          if (!assistant) {
            assistant = pushBlock(new Markdown("", 1, 0, mdTheme));
          }
          assistantText += ame.delta || "";
          assistant.setText(assistantText);
          scrollToEnd();
        } else if (ame.type === "thinking_delta") {
          setStatus("Thinking", "thinking");
          thinkingText += ame.delta || "";
          if (!thinkingRow) {
            // Open while streaming; collapses at message end (app behaviour).
            thinkingRow = registerToggle(new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, open: true }));
            pushBlock(thinkingRow);
          }
          thinkingRow.setBody(thinkingText);
          scrollToEnd();
        }
      } else if (e?.type === "tool_execution_start") {
        setStatus("Tool call", "tool_call");
        const name = e.toolName || e.name || e.tool?.name || "tool";
        const args: any = e.args || e.arguments || e.input || {};
        let body = "";
        try {
          body = JSON.stringify(args, null, 0) || "";
        } catch {}
        if (/delegate/i.test(name)) {
          const target = String(args?.agentId || args?.agent || args?.to || "").trim();
          pushBlock(registerToggle(new ToggleBlock({ label: "Delegation", boldName: target, color: C.delegation, body })));
        } else {
          pushBlock(registerToggle(new ToggleBlock({ label: "Tool call", boldName: name, color: C.toolCall, body })));
        }
        assistant = null;
        assistantText = "";
      } else if (e?.type === "tool_execution_end") {
        const name = e.toolName || e.name || e.tool?.name || "tool";
        const isErr = !!e.isError;
        const r: any = e.result;
        let body = "";
        try {
          if (typeof r === "string") body = r;
          else if (Array.isArray(r?.content)) body = r.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n");
          else if (typeof r?.content === "string") body = r.content;
          else if (r != null) body = JSON.stringify(r, null, 0);
        } catch {}
        pushBlock(
          registerToggle(
            new ToggleBlock({ label: isErr ? "Tool error" : "Tool result", boldName: name, color: isErr ? C.danger : C.toolResult, body })
          )
        );
      } else if (e?.type === "message_end" && e?.message?.role === "assistant") {
        if (assistantText) lastAssistantText = assistantText;
        assistant = null;
        assistantText = "";
        if (thinkingRow) {
          // Thinking finished: collapse the toggle.
          thinkingRow.open = false;
        }
        thinkingRow = null;
        thinkingText = "";
        if (e?.message?.stopReason === "error") setStatus("Failed", "failed");
      } else if (e?.type === "auto_retry_start") {
        setStatus(`Retrying ${e.attempt || 1}/${e.maxAttempts || 3}`, "retrying");
      } else if (e?.type === "auto_retry_end") {
        if (e.success) setStatus("Running", "running");
        else setStatus("Failed", "failed");
      } else if (e?.type === "compaction_start") {
        setStatus("Compacting", "compacting");
      } else if (e?.type === "compaction_end") {
        if (statusKind === "compacting") setStatus("", "");
        // App-style compaction toggle: ineffective (orange) / effective (blue).
        const noop = !!e.errorMessage;
        pushBlock(
          registerToggle(
            new ToggleBlock({
              label: "Compaction",
              boldName: noop ? "ineffective" : "effective",
              color: noop ? C.expert : C.info,
              body: String(e.summary || e.errorMessage || ""),
            })
          )
        );
        scrollToEnd();
      } else if (e?.type === "agent_end") {
        streaming = false;
        if (statusKind !== "failed") setStatus("", "");
        updateCtx();
        updateBar();
      }
    } catch {}
    try {
      ui.requestRender();
    } catch {}
  };
  session.subscribe(onSessionEvent);

  // --- slash commands -----------------------------------------------------------
  /** All chat messages saved on disk (the session jsonl files), oldest first. */
  const readSessionEntries = (): any[] => {
    const out: any[] = [];
    try {
      const files = fs.readdirSync(currentSessionDir).filter((f: string) => f.endsWith(".jsonl")).sort();
      for (const f of files) {
        let txt = "";
        try {
          txt = fs.readFileSync(path.join(currentSessionDir, f), "utf8");
        } catch {
          continue;
        }
        for (const line of txt.split("\n")) {
          if (!line.trim()) continue;
          try {
            const o = JSON.parse(line);
            if (o?.type === "message" && o?.message?.role) out.push({ kind: "message", message: o.message });
            else if (o?.type === "compaction") out.push({ kind: "compaction" });
          } catch {}
        }
      }
    } catch {}
    return out;
  };
  const readSessionMessages = (): any[] => readSessionEntries().filter((x: any) => x.kind === "message").map((x: any) => x.message);

  /** Rebuild the transcript from the saved history (the /reload command). */
  const renderHistory = () => {
    try {
      content.clear();
      blockCount = 0;
      toggles.length = 0;
      selToggle = -1;
      for (const en of readSessionEntries()) {
        if (en.kind === "compaction") {
          // File compactions are always REAL (noop ones never reach the file).
          pushBlock(registerToggle(new ToggleBlock({ label: "Compaction", boldName: "effective", color: C.info })));
          continue;
        }
        const m = en.message;
        if (m.role === "user") {
          let t = "";
          const c = m.content;
          if (typeof c === "string") t = c;
          else if (Array.isArray(c)) t = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
          if (t.trim()) pushBlock(new Text(t, 2, 1, (s: string) => bg(C.bubbleUser, s)));
        } else if (m.role === "toolResult") {
          const nm = String(m.toolName || "tool");
          const err = !!m.isError;
          let body = "";
          try {
            if (typeof m.content === "string") body = m.content;
            else if (Array.isArray(m.content)) body = m.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n");
          } catch {}
          pushBlock(registerToggle(new ToggleBlock({ label: err ? "Tool error" : "Tool result", boldName: nm, color: err ? C.danger : C.toolResult, body })));
        } else if (m.role === "assistant") {
          const c = m.content;
          let think = "";
          let text = "";
          const calls: string[] = [];
          if (Array.isArray(c)) {
            for (const b of c) {
              if (b?.type === "text") text += b.text || "";
              else if (b?.type === "thinking" || b?.type === "reasoning") think += b.thinking || b.text || "";
              else if (b?.type === "toolCall") calls.push(String(b.name || b.toolName || "tool"));
            }
          } else if (typeof c === "string") {
            text = c;
          }
          if (think.trim()) pushBlock(registerToggle(new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, body: think })));
          if (Array.isArray(c)) {
            for (const b of c) {
              if (b?.type !== "toolCall") continue;
              const nm = String(b.name || b.toolName || "tool");
              let body = "";
              try {
                body = JSON.stringify(b.arguments || {}, null, 0) || "";
              } catch {}
              pushBlock(
                registerToggle(
                  new ToggleBlock(
                    /delegate/i.test(nm)
                      ? { label: "Delegation", color: C.delegation, body }
                      : { label: "Tool call", boldName: nm, color: C.toolCall, body }
                  )
                )
              );
            }
          }
          if (text.trim()) pushBlock(new Markdown(text, 1, 0, mdTheme));
        }
      }
      scrollToEnd();
    } catch {}
  };

  /** Rebuild the engine session in place — /reset (fresh chat), /directory
   *  (new cwd, same chat), /sessions (another chat). The transcript follows. */
  const recreateSession = async (o: { clearMessages?: boolean; newCwd?: string; newSessionDir?: string; newKey?: string }) => {
    try {
      streaming = false;
      setStatus("", "");
      try {
        session.dispose?.();
      } catch {}
      if (o.clearMessages) {
        try {
          for (const f of fs.readdirSync(currentSessionDir)) {
            if (f.endsWith(".jsonl")) {
              try {
                fs.unlinkSync(path.join(currentSessionDir, f));
              } catch {}
            }
          }
        } catch {}
      }
      const dir = o.newSessionDir || currentSessionDir;
      // App chats keep their own working directory in the session entry: honor it.
      let cwd = o.newCwd || currentCwd;
      if (!o.newCwd && o.newKey) {
        try {
          const raw0 = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "quinki-sessions.json"), "utf8"));
          const e0 = Array.isArray(raw0) ? raw0.find((s: any) => s?.key === o.newKey) : null;
          const wd = String(e0?.workingDir || "");
          if (wd && fs.existsSync(wd) && fs.statSync(wd).isDirectory()) cwd = wd;
        } catch {}
      }
      fs.mkdirSync(dir, { recursive: true });
      const sm2 = sdk.SessionManager.create(cwd, dir);
      const res2: any = await sdk.createAgentSession({ cwd, agentDir: opts.agentDir, sessionManager: sm2 });
      session = res2?.session || res2;
      currentCwd = cwd;
      currentSessionDir = dir;
      if (o.newKey) currentKey = o.newKey;
      // Runtime auth keys (the new engine instance starts clean).
      try {
        const modelsJson = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "models.json"), "utf8"));
        for (const [prov, pcfg] of Object.entries(modelsJson.providers || {})) {
          const k = (pcfg as any)?.apiKey;
          if (k && typeof k === "string" && k.length > 0) {
            try {
              session.modelRegistry?.authStorage?.setRuntimeApiKey?.(prov, k);
            } catch {}
          }
        }
      } catch {}
      // When switching to an existing chat, apply its saved model/thinking/title.
      if (o.newKey) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "quinki-sessions.json"), "utf8"));
          const e2 = Array.isArray(raw) ? raw.find((s: any) => s?.key === currentKey) : null;
          if (e2?.model) {
            const models: any[] = session.modelRuntime?.getAvailableSnapshot?.() || [];
            const m = models.find((x: any) => String(x?.id) === String(e2.model));
            if (m) {
              try {
                await session.setModel(m);
              } catch {}
            }
          }
          if (typeof e2?.thinkingLevel === "string") {
            thinkingOn = e2.thinkingLevel !== "off";
            try {
              session.setThinkingLevel?.(thinkingOn ? "xhigh" : "off");
            } catch {}
          }
          setChatTitle(String(e2?.label || currentKey));
        } catch {}
      }
      try {
        session.setThinkingLevel?.(thinkingOn ? "xhigh" : "off");
      } catch {}
      try {
        session.subscribe(onSessionEvent);
      } catch {}
      if (o.clearMessages) {
        ctxTokens = 0;
        ctxWindow = 0;
        welcomeShown = true;
        applyLayout(true);
      } else {
        if (welcomeShown) {
          welcomeShown = false;
          applyLayout(false);
        }
        renderHistory();
      }
      updateBar();
      try {
        ui.requestRender();
      } catch {}
    } catch {}
  };

  const handleSlash = (raw: string) => {
    const parts = raw.slice(1).split(/\s+/);
    const cmd = (parts.shift() || "").toLowerCase();
    const arg = parts.join(" ").trim();
    switch (cmd) {
      case "thinking": {
        thinkingOn = arg === "off" ? false : arg === "on" ? true : !thinkingOn;
        try {
          session.setThinkingLevel?.(thinkingOn ? "xhigh" : "off");
        } catch {}
        break;
      }
      case "compaction": {
        try {
          if (arg === "now") {
            // The pill comes from the compaction_start/end events (also covers
            // auto-compaction); the finally() is the safety net (a failed/too-small
            // compaction must never leave the pill stuck).
            void Promise.resolve(session.compact?.())
              .catch(() => {})
              .finally(() => {
                if (statusKind === "compacting") setStatus("", "");
              });
          } else if (arg === "enable" || arg === "disable") {
            const en = arg === "enable";
            if (typeof (session as any).setAutoCompactionEnabled === "function") (session as any).setAutoCompactionEnabled(en);
            else {
              const sm: any = (session as any).settingsManager;
              if (sm && typeof sm.setCompactionEnabled === "function") sm.setCompactionEnabled(en);
            }
          }
        } catch {}
        break;
      }
      case "reload": {
        if (welcomeShown) {
          welcomeShown = false;
          applyLayout(false);
        }
        renderHistory();
        break;
      }
      case "export": {
        try {
          const msgs: any[] = readSessionMessages();
          const out: string[] = ["# Quinki chat", ""];
          for (const m of msgs) {
            const role = m.role === "user" ? "You" : m.role === "assistant" ? "Quinki" : String(m.role);
            let text = "";
            const c = m.content;
            if (typeof c === "string") text = c;
            else if (Array.isArray(c)) {
              text = c
                .filter((b: any) => b?.type === "text")
                .map((b: any) => b.text)
                .join("\n");
            }
            if (text.trim()) out.push(`## ${role}`, "", text, "");
          }
          const file = path.join(currentCwd, `quinki-chat-${Date.now().toString(36)}.md`);
          fs.writeFileSync(file, out.join("\n"), "utf8");
        } catch {}
        break;
      }
      case "model": {
        if (!arg) break;
        try {
          const models: any[] = session.modelRuntime?.getAvailableSnapshot?.() || [];
          const m = models.find((x: any) => String(x?.id) === arg);
          if (m) {
            void (async () => {
              try {
                await session.setModel(m);
              } catch {}
              try {
                updateBar();
                ui.requestRender();
              } catch {}
            })();
          }
        } catch {}
        break;
      }
      case "reset": {
        if (arg !== "confirm") break;
        void recreateSession({ clearMessages: true });
        break;
      }
      case "directory": {
        if (!arg) break;
        const target = arg === "~" ? os.homedir() : arg;
        let ok = false;
        try {
          ok = fs.statSync(target).isDirectory();
        } catch {
          ok = false;
        }
        if (!ok) break;
        void recreateSession({ newCwd: path.resolve(target) });
        break;
      }
      case "skill": {
        if (!arg) break;
        try {
          if (welcomeShown) {
            welcomeShown = false;
            applyLayout(false);
          }
          // The engine expands "/<skill>" as a skill command: the skill content
          // is injected one-shot — the same mechanism the app uses.
          void session.prompt("/" + arg);
        } catch {}
        break;
      }
      case "sessions": {
        if (!arg) break;
        const sdir = path.join(opts.agentDir, "sessions", "quinki");
        const target = path.join(sdir, arg);
        if (!fs.existsSync(target)) break;
        void recreateSession({ newSessionDir: target, newKey: arg });
        break;
      }
      case "rename": {
        if (!arg) break;
        try {
          // register/rename in quinki-sessions.json — shared with the app
          const sp = path.join(opts.agentDir, "quinki-sessions.json");
          let list: any[] = [];
          try {
            list = JSON.parse(fs.readFileSync(sp, "utf8")) || [];
          } catch {}
          const idx = list.findIndex((s: any) => s?.key === currentKey);
          if (idx >= 0) {
            list[idx].label = arg;
            list[idx].lastActivity = Date.now();
          } else {
            list.push({
              key: currentKey,
              label: arg,
              createdAt: Date.now(),
              lastActivity: Date.now(),
              order: Date.now(),
              folderId: null,
              compactionAuto: true,
              compactionThreshold: 80,
              model: session?.model?.id || defaultModelId || "",
              thinkingLevel: thinkingOn ? "xhigh" : "off",
              mode,
              agentId: null,
              messageAgents: {},
            });
          }
          fs.writeFileSync(sp, JSON.stringify(list, null, 2), "utf8");
          setChatTitle(arg);
        } catch {}
        break;
      }
      case "quit": {
        if (arg === "yes") shutdown();
        break;
      }
    }
    try {
      ui.requestRender();
    } catch {}
  };
  handleSlashRef = handleSlash;

  // --- slash menu (OURS) --------------------------------------------------------
  // Navigation lives in the MENU only: selecting/confirming writes NOTHING in the
  // box (the typed text is the only thing that ever appears there). Mirrors the
  // app's SlashMenu + NavBar: ↑ ↓ move, ← back, → forward, Enter confirm,
  // Esc cancel (back one level, then close).
  const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const editorText = () => {
    try {
      return editor.getText();
    } catch {
      return "";
    }
  };
  const subItems = (name: string): any[] => {
    const cmd: any = commands.find((c) => c.name === name);
    if (!cmd || typeof cmd.getArgumentCompletions !== "function") return [];
    try {
      const raw = cmd.getArgumentCompletions(menuSubFilter) || [];
      const f = menuSubFilter.toLowerCase();
      if (!f) return raw;
      return raw.filter(
        (i: any) =>
          String(i.value ?? "").toLowerCase().startsWith(f) ||
          String(i.label ?? "").toLowerCase().startsWith(f)
      );
    } catch {
      return [];
    }
  };
  const mainItems = (): any[] => {
    const t0 = editorText();
    const f = t0.startsWith("/") ? t0.slice(1).toLowerCase() : "";
    return [...commands]
      .sort((a, b) => (((a as any).seq ?? 99) as number) - (((b as any).seq ?? 99) as number))
      .filter((c) => !(c as any).hidden?.())
      .filter((c) => c.name.toLowerCase().startsWith(f))
      .map((c) => ({ value: c.name, label: "/" + capitalize(c.name), description: (c as any).description || "" }));
  };
  const menuOpen = (): boolean => {
    if (menuSub) return true;
    return editorText().startsWith("/");
  };
  const menuNav = (a: "up" | "down" | "left" | "right" | "enter" | "escape") => {
    try {
      if (!menuOpen()) return;
      const items = menuSub ? subItems(menuSub) : mainItems();
      const stepSel = (from: number, dir: number): number => {
        let i = from;
        for (let n = 0; n < items.length; n++) {
          i = (i + dir + items.length) % items.length;
          if (!(items[i] as any)?.separator) return i;
        }
        return from;
      };
      if (a === "escape") {
        if (menuConfirmFocus) {
          // First Esc: leave the Confirm focus (stay in the menu).
          menuConfirmFocus = false;
        } else if (menuSub) {
          menuSub = null;
          menuSubFilter = "";
          menuSel = 0;
        } else {
          try {
            editor.setText("");
          } catch {}
          menuSel = 0;
        }
      } else if (a === "up") {
        // Wrap-around like the app; separator rows are skipped.
        menuConfirmFocus = false;
        if (items.length > 0) menuSel = stepSel(menuSel, -1);
      } else if (a === "down") {
        menuConfirmFocus = false;
        if (items.length > 0) menuSel = stepSel(menuSel, 1);
      } else if (a === "left") {
        menuConfirmFocus = false;
        if (menuSub) {
          menuSub = null;
          menuSubFilter = "";
          menuSel = 0;
        }
      } else if (a === "right") {
        // Forward ONLY — it NEVER executes. At the end of the levels it FOCUSES
        // Confirm (violet filled, like the app's NavBar focusConfirm); Enter runs.
        if (menuConfirmFocus) {
          // Already focused: stays lit (Enter confirms).
        } else if (menuSub) {
          menuConfirmFocus = true; // option = terminal level
        } else {
          const it: any = items[menuSel];
          const cmd: any = it ? commands.find((c) => c.name === it.value) : null;
          if (cmd && typeof cmd.getArgumentCompletions === "function") {
            menuSub = cmd.name;
            menuSubFilter = "";
            menuSel = 0;
          } else if (cmd) {
            menuConfirmFocus = true; // command without options: end of the road
          }
        }
      } else {
        // enter = Confirm: run the option, open the submenu, or run the command.
        menuConfirmFocus = false;
        const it: any = items[menuSel];
        if (!it || it.separator) return;
        if (menuSub) {
          const cmdName = menuSub;
          menuSub = null;
          menuSubFilter = "";
          menuSel = 0;
          try {
            editor.setText("");
          } catch {}
          handleSlashRef?.("/" + cmdName + " " + String(it.value ?? it.label ?? ""));
        } else {
          const cmd: any = commands.find((c) => c.name === it.value);
          if (cmd && typeof cmd.getArgumentCompletions === "function") {
            menuSub = cmd.name;
            menuSubFilter = "";
            menuSel = 0;
          } else if (cmd) {
            try {
              editor.setText("");
            } catch {}
            menuSel = 0;
            handleSlashRef?.("/" + cmd.name);
          }
        }
      }
      try {
        ui.requestRender();
      } catch {}
    } catch {}
  };
  const buildMenuRows = (w: number): string[] => {
    try {
      const t = editorText();
      if (menuSub && !t.startsWith("/")) {
        menuSub = null;
        menuSubFilter = "";
        menuSel = 0;
        menuConfirmFocus = false;
      }
      const mainOpen = !menuSub && t.startsWith("/");
      if (!mainOpen && !menuSub) {
        menuConfirmFocus = false;
        return [];
      }
      let items: any[];
      if (menuSub) {
        items = subItems(menuSub);
      } else {
        const f = t.slice(1).toLowerCase();
        if (f !== menuLastFilter) {
          menuLastFilter = f;
          menuSel = 0;
          menuConfirmFocus = false;
        }
        items = mainItems();
      }
      if (items.length === 0) return [];
      if (menuSel >= items.length) menuSel = items.length - 1;
      if (menuSel < 0) menuSel = 0;
      if ((items[menuSel] as any)?.separator) {
        for (let i = 0; i < items.length; i++) {
          if (!(items[i] as any).separator) {
            menuSel = i;
            break;
          }
        }
      }
      const rows: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        let label = String(it.label ?? it.value ?? "");
        let desc = String(it.description ?? "");
        if ((it as any).separator) {
          // Group separator (agent name): not selectable, no highlight.
          rows.push(fg(C.textSecondary, label));
          continue;
        }
        if (visibleWidth(label) > w - 2) label = label.slice(0, Math.max(0, w - 2));
        if (visibleWidth(label) + 2 + visibleWidth(desc) > w) {
          const room = w - visibleWidth(label) - 2;
          desc = room > 0 ? desc.slice(0, room) : "";
        }
        const gap = Math.max(1, w - visibleWidth(label) - visibleWidth(desc));
        const rowPlain = label + " ".repeat(gap) + desc;
        if (i === menuSel) rows.push(bg(C.primary, fg(C.bgPanel, rowPlain)));
        else rows.push(fg(C.textSecondary, label) + " ".repeat(gap) + fg(C.textTertiary, desc));
      }
      // Blank separator, then the footer on ONE row (app NavBar style):
      // left ↑ ↓ ← → (navigation) — right Esc (red) · Confirm (filled violet,
      // like the selected slash rows, while FOCUSED via → — Enter runs it).
      rows.push("");
      const left = fg(C.textSecondary, "\u2191 \u2193 \u2190 \u2192");
      const right =
        fg(C.danger, "Esc") +
        "  " +
        (menuConfirmFocus ? bold(bg(C.primary, fg(C.bgPanel, " Confirm "))) : fg(C.primary, "Confirm"));
      const gw = Math.max(1, w - visibleWidth(left) - visibleWidth(right));
      rows.push(left + " ".repeat(gw) + right);
      return rows;
    } catch {
      return [];
    }
  };
  try {
    (editor as any).menuLinesFn = (w: number) => buildMenuRows(w);
  } catch {}
  menuOpenRef = () => menuOpen();
  menuNavRef = menuNav;

  // --- input -------------------------------------------------------------------
  const shutdown = () => {
    try {
      // preserveScreen: true -> clean exit (do NOT re-print the last frame
      // into the main buffer — the terminal must come back clean).
      ui.stop({ preserveScreen: true } as any);
    } catch {}
    try {
      process.exit(0);
    } catch {}
  };

  editor.onSubmit = (text: string) => {
    const t = (text || "").trim();
    if (t.startsWith("/")) {
      try {
        editor.setText("");
      } catch {}
      handleSlash(t);
      return;
    }
    if (!t || streaming) return;
    editor.setText("");
    if (welcomeShown) {
      welcomeShown = false;
      applyLayout(false);
    }
    pushBlock(new Text(t, 2, 1, (s: string) => bg(C.bubbleUser, s)));
    scrollToEnd();
    streaming = true;
    setStatus("Sending", "sending");
    updateBar();
    try {
      void Promise.resolve(session.prompt(t)).catch((err: any) => {
        addRow(fg(C.danger, "\u25b8 error \u00b7 " + truncate(String(err?.message || err), 120)));
        streaming = false;
        updateBar();
      });
    } catch (err: any) {
      addRow(fg(C.danger, "\u25b8 error \u00b7 " + truncate(String(err?.message || err), 120)));
      streaming = false;
      updateBar();
    }
  };
  try {
    (editor as any).onChange = () => {
      try {
        ui.requestRender();
      } catch {}
    };
  } catch {}

  try {
    editor.onAction?.("app.interrupt", () => {
      try {
        session.abort?.();
      } catch {}
    });
  } catch {}
  try {
    editor.onAction?.("app.exit", shutdown);
  } catch {}
  try {
    (editor as any).onCtrlD = shutdown;
  } catch {}
  try {
    editor.onAction?.("app.clear", () => {
      if (!editor.getText().trim()) shutdown();
      else editor.setText("");
    });
  } catch {}

  updateBar();
  updateCtx();
  applyLayout(true);

  try {
    ui.start();
  } catch (err) {
    process.stderr.write("quinki: could not start the terminal UI: " + String((err as any)?.message || err) + "\n");
    process.exit(1);
  }
}
