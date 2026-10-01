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
import { execSync, spawn } from "node:child_process";

import { Sc } from "./sc";

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

// === HERO: mascot + big "QUINKI" (pure-block font: only \u2588 and spaces) ===
// === HERO: "quinki" in a half-block pixel font (each cell = 2 vertical pixels) ===
// === HERO: "welcome to quinki" in the half-block pixel font ===
// === HERO: "Welcome to Quinki!" half-block pixel font (5px glyphs) ===
const QPIX: Record<string, string[]> = {
  "W": ["10001", "10001", "10101", "10101", "10101", "11011", "10001", "00000"],
  "e": ["00000", "00000", "01110", "10001", "11111", "10000", "01110", "00000"],
  "l": ["01100", "00100", "00100", "00100", "00100", "00100", "01110", "00000"],
  "c": ["00000", "00000", "01110", "10001", "10000", "10001", "01110", "00000"],
  "o": ["00000", "00000", "01110", "10001", "10001", "10001", "01110", "00000"],
  "m": ["00000", "00000", "11011", "10101", "10101", "10101", "10101", "00000"],
  "t": ["00100", "00100", "01110", "00100", "00100", "00101", "00010", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "Q": ["01110", "10001", "10001", "10001", "10001", "01110", "00010", "00011"],
  "u": ["00000", "00000", "10001", "10001", "10001", "10011", "01101", "00000"],
  "i": ["00100", "00000", "01100", "00100", "00100", "00100", "01110", "00000"],
  "n": ["00000", "00000", "10110", "11001", "10001", "10001", "10001", "00000"],
  "k": ["10000", "10000", "10010", "10100", "11000", "10100", "10010", "00000"],
  "!": ["01100", "01100", "01100", "01100", "00000", "01100", "00000", "00000"],
};
const glyphBounds = (bm: string[]): [number, number] => {
  let a = 99, b = -1;
  for (let r = 0; r < 8; r++) for (let x = 0; x < 5; x++) if (bm[r]?.[x] === "1") { a = Math.min(a, x); b = Math.max(b, x); }
  if (b < 0) return [0, 0];
  return [a, b];
};
const pixWord = (word: string, V: (t: string) => string): string[] => {
  const rows: string[] = [];
  for (let r = 0; r < 4; r++) {
    let out = "";
    for (let j = 0; j < word.length; j++) {
      if (word[j] === " ") { out += "   "; continue; } // FIXED word gap (symmetric between all words)
      const bm = QPIX[word[j]] || QPIX[" "];
      const [x0, x1] = glyphBounds(bm); // trim empty side columns -> even spacing
      for (let x = x0; x <= x1; x++) {
        const top = bm[r * 2]?.[x] === "1";
        const bot = bm[r * 2 + 1]?.[x] === "1";
        out += top && bot ? V("\u2588") : top ? V("\u2580") : bot ? V("\u2584") : " ";
      }
      if (j < word.length - 1) out += " ";
    }
    rows.push(out);
  }
  return rows;
};
const bigBrand = (): string[] => {
  const PLAIN = (t: string) => fg(C.text, t);
  const VIOLET = (t: string) => bold(fg(C.primary, t));
  const a = pixWord("Welcome to ", PLAIN);
  const b = pixWord("Quinki", VIOLET);
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
};
const HERO_ART = (): string[] => {
  const brand = bigBrand();
  return [brand[0], brand[1], brand[2], brand[3], ""];
};



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
    // App-home greeting ABOVE the text box: time-based, same words, "Quinki" in
    // the violet brand (recomputed every render so it stays truthful).
    let greet: string[] = [];
    try {
      const h = new Date().getHours();
      const g = h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
      // EXACT app-home line: "Good morning, welcome to Quinki!"
      const plain = g + ", welcome to Quinki!";
      const boxW = boxLines.length > 0 ? Math.max(...boxLines.map((l: string) => visibleWidth(String(l)))) : width;
      const hero = HERO_ART(); // big pixel word, one line
      const heroW = Math.max(...hero.map((l) => visibleWidth(String(l))));
      if (heroW + 4 <= width) {
        // Centered on the TEXT BOX; if the hero is wider than the box, center on
        // the terminal (still symmetric, never flush-left).
        const ref = heroW <= boxW ? boxW : width;
        const off = Math.max(0, Math.floor((ref - heroW) / 2));
        greet = hero.map((l) => " ".repeat(off) + l);
      } else {
        // FALLBACK: the plain one-line greeting, centered on the text box.
        const line = fg(C.textSecondary, g + ", welcome to ") + bold(fg(C.primary, "Quinki")) + fg(C.textSecondary, "!");
        const pad = " ".repeat(Math.max(0, Math.floor((boxW - visibleWidth(plain)) / 2)));
        greet = ["", pad + line];
      }
    } catch {}
    const group = greet.length + boxLines.length + 2 + hintLines.length;
    const top = Math.max(0, Math.floor((rows - group) / 2));
    const out: string[] = [];
    for (let i = 0; i < top; i++) out.push("");
    out.push(...greet);
    out.push("", ...boxLines, "", ...hintLines);
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
  children: any[] = []; // nested content: {t:"text",v:string} | {t:"toggle",v:ToggleBlock}
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
    // 1-col left margin, same as the Markdown text block: the arrow lines up
    // with the first letter of the writing and the right edge matches the text.
    let head = " " + fg(col, arrow + " ") + fg(col, this.label);
    if (this.boldName) head += " " + bold(fg(col, this.boldName));
    if (!this.open) {
      let src = String(this.body || "");
      if (!src.trim()) {
        // Delegation toggles carry no body: the preview comes from the first
        // child (the task / the delegated agent's text).
        for (const ch of this.children || []) {
          if (ch && (ch.t === "text" || ch.t === "bubble")) {
            src = String(ch.v || "");
            break;
          }
        }
      }
      const first = String(src).split("\n")[0] || "";
      if (first.trim()) {
        // The preview MUST fit the row: it is cut on the room actually left by
        // the header, so a collapsed toggle never spills out of the chat area.
        const room = width - visibleWidth(head) - 2;
        if (room > 8) {
          const preview = first.length > room ? first.slice(0, Math.max(1, room - 1)) + "\u2026" : first;
          if (preview.trim()) head += "  " + fg(C.textTertiary, preview);
        }
      }
    }
    const out = [head];
    if (this.open) {
      const inner = Math.max(6, width - 4);
      // The vertical bar starts right under the header, on an EMPTY first row,
      // then the body follows (applies to every toggle).
      out.push(" " + fg(this.color, "\u2502".padEnd(Math.max(1, width - 1))));
      if (this.body) {
        for (const line of wrapPlain(this.body, inner)) {
          const styled = this.italic ? italicStyle(fg(this.color, line)) : fg(this.color, line);
          out.push(" " + fg(this.color, "\u2502 ") + styled);
        }
      }
      // Nested content (delegation): nested toggles + text, inside the border —
      // with a blank bordered row between children (the normal chat's cadence).
      let firstChild = true;
      for (const ch of this.children || []) {
        if (!firstChild) out.push(" " + fg(this.color, "\u2502".padEnd(Math.max(1, width - 1))));
        firstChild = false;
        if (ch && ch.t === "bubble") {
          // The delegating agent's task: IDENTICAL to the user's bubble — full
          // width inside the delegation border, panel background, padding, markdown.
          try {
            const th = (globalThis as any).__qMd;
            const innerW = Math.max(8, width - 4);
            let lines: string[] = [];
            if (th) {
              if (!ch._md) ch._md = new Markdown(String(ch.v || ""), 0, 0, th);
              else ch._md.setText?.(String(ch.v || ""));
              lines = ch._md.render(innerW - 2);
            } else {
              lines = wrapPlain(String(ch.v || ""), Math.max(6, innerW - 2));
            }
            const full = (t: string) => " " + fg(this.color, "\u2502 ") + bg(C.bubbleUser, "  " + t + " ".repeat(Math.max(0, innerW - 2 - visibleWidth(t))));
            out.push(" " + fg(this.color, "\u2502 ") + bg(C.bubbleUser, " ".repeat(innerW)));
            for (const ln of lines) out.push(full(ln));
            out.push(" " + fg(this.color, "\u2502 ") + bg(C.bubbleUser, " ".repeat(innerW)));
            if (this._taskFooterDate) {
              // Date only — NO Info here: this is an agent bubble (the sender of
              // the delegation), and user/agent bubbles never carry Info.
              const line = this._taskFooterDate;
              out.push(" " + fg(this.color, "\u2502 ") + bg(C.bubbleUser, "  " + fg(C.textSecondary, line) + " ".repeat(Math.max(0, innerW - 2 - visibleWidth(line)))));
              out.push(" " + fg(this.color, "\u2502 ") + bg(C.bubbleUser, " ".repeat(innerW)));
            }
          } catch {}
        } else if (ch && ch.t === "text") {
          // Markdown rendering INSIDE the toggle — identical to the normal chat.
          try {
            const th = (globalThis as any).__qMd;
            if (th) {
              if (!ch._md) ch._md = new Markdown(String(ch.v || ""), 0, 0, th);
              else ch._md.setText?.(String(ch.v || ""));
              for (const ln of ch._md.render(Math.max(6, width - 4))) out.push(" " + fg(this.color, "\u2502 ") + ln);
            } else {
              for (const line of wrapPlain(String(ch.v || ""), inner)) out.push(" " + fg(this.color, "\u2502 ") + fg(C.text, line));
            }
          } catch {
            for (const line of wrapPlain(String(ch.v || ""), inner)) out.push(" " + fg(this.color, "\u2502 ") + fg(C.text, line));
          }
        } else if (ch && ch.t === "footer") {
          const line = ch.date + (infoOpen ? " \u00b7 Info: " + ch.info : "");
          out.push(" " + fg(this.color, "\u2502 ") + fg(C.textTertiary, line));
        } else if (ch && ch.t === "toggle") {
          for (const ln of ch.v.render(Math.max(6, width - 3))) out.push(" " + fg(this.color, "\u2502 ") + ln);
        }
      }
    }
    return out;
  }
  invalidate() {}
}

// Message footer — exact app format: "26 September 2026, 21:51:39  i  Agent · model · Max".
// By default only date/time + the (i); Ctrl+I reveals the info part on ALL footers.
let infoOpen = false;
export const toggleInfo = (): boolean => {
  infoOpen = !infoOpen;
  return infoOpen;
};
const bgHard = (color: string, s: string): string => {
  // Absolute-black code background that survives the syntax highlight resets.
  try {
    const hx = (color || "").replace("#", "");
    const r = parseInt(hx.slice(0, 2), 16) || 0;
    const g = parseInt(hx.slice(2, 4), 16) || 0;
    const b = parseInt(hx.slice(4, 6), 16) || 0;
    const pre = `\x1b[48;2;${r};${g};${b}m`;
    return pre + String(s).replace(/\x1b\[0m/g, "\x1b[0m" + pre) + "\x1b[0m";
  } catch {
    return String(s);
  }
};

class FooterRow {
  dateStr: string;
  infoStr: string;
  showInfo: boolean;
  constructor(dateStr: string, infoStr: string, showInfo = true) {
    this.dateStr = dateStr;
    this.infoStr = infoStr;
    this.showInfo = showInfo;
  }
  render(width: number): string[] {
    // No glyph at all: with Ctrl+F the info simply appears as "Info: ..."
    // written next to the time.
    const left = " " + this.dateStr;
    const full = this.showInfo && infoOpen ? left + " \u00b7 Info: " + this.infoStr : left;
    const out = full.length > width ? full.slice(0, Math.max(1, width - 1)) + "\u2026" : full;
    return [fg(C.textTertiary, out)];
  }
  invalidate() {}
}

// User bubble: text + ONE blank bubble line + a LIGHTER footer, all inside the bubble.
class UserBubble {
  text: string;
  dateStr: string;
  constructor(text: string, dateStr: string) {
    this.text = text;
    this.dateStr = dateStr;
  }
  render(width: number): string[] {
    const inner = Math.max(6, width - 4);
    const lines = wrapPlain(this.text, inner);
    const full = (t: string) => {
      const fill = Math.max(0, inner - visibleWidth(t));
      return bg(C.bubbleUser, "  " + t + " ".repeat(fill + 2));
    };
    const blank = () => bg(C.bubbleUser, " ".repeat(width));
    const out: string[] = [];
    out.push(blank()); // top padding row
    for (const l of lines) out.push(full(l));
    out.push(blank()); // spacer before the footer
    out.push(bg(C.bubbleUser, "  " + fg(C.textSecondary, this.dateStr) + " ".repeat(Math.max(2, inner - visibleWidth(this.dateStr) + 2))));
    out.push(blank()); // bottom padding row
    return out;
  }
  invalidate() {}
}

// Thinking level label exactly like the app (the SDK's own names).
const levelLabel = (lvl: string): string => {
  const k = String(lvl || "").toLowerCase();
  if (k === "xhigh") return "Max";
  if (k === "high") return "High";
  if (k === "medium") return "Medium";
  if (k === "low") return "Low";
  if (k === "minimal") return "Minimal";
  if (k === "off" || !k) return "Off";
  return String(lvl).charAt(0).toUpperCase() + String(lvl).slice(1);
};

const fmtFooterDate = (ms: number): string => {
  try {
    const d = new Date(ms);
    const ds = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    const ts = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return ds + ", " + ts;
  } catch {
    return "";
  }
};

export async function runTui(opts: TuiOptions): Promise<void> {
  // Startup: always a FRESH cli session with the welcome (no resume): every
  // existing chat — including the last used one — stays visible in /sessions.
  const key = "cli-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // The REAL session dir (the sidecar's own files — the same the app uses).
  const realSessionDir = path.join(opts.sessionDir, key);
  // The local SDK session is a leftover from the pre-sidecar era: it must NEVER
  // write into the real dir (that polluted the app's files). Throwaway location.
  const sessionDirForKey = path.join(os.tmpdir(), "quinki-cli-local", key);
  fs.mkdirSync(sessionDirForKey, { recursive: true });
  fs.mkdirSync(realSessionDir, { recursive: true });

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
  let currentSessionDir = realSessionDir; // reads: the sidecar's files
  let currentKey = key;

  // --- sidecar link: run the chat in the REAL Quinki runtime (the same session
  // the app uses — agents, skills, delegation, live sync). Falls back to the
  // bare SDK session when the app/sidecar is not running. ---------------------
  const sc = new Sc("ws://127.0.0.1:" + (process.env.QUINKI_SIDECAR_PORT || "9182"));
  // The settings menu uses this channel; define it from the CLI's real RPC client.
  try { (globalThis as any).__sidecarCall = (m: string, p?: any, t?: number) => sc.call(m, p || {}, t || 120000); } catch {}
  // The app's watchdog KILLS the shared sidecar when the app quits (port 9182).
  // The TUI must survive that: it spawns the installed sidecar itself and the
  // client keeps reconnecting — engine back within seconds.
  const spawnSidecar = () => {
    try {
      const sh = "/Applications/Quinki.app/Contents/Resources/resources/sidecar/start.sh";
      if (fs.existsSync(sh)) {
        const p = spawn(sh, [], { detached: true, stdio: "ignore", cwd: path.dirname(sh), env: process.env as any });
        p.unref?.();
        return true;
      }
    } catch {}
    return false;
  };
  let scOn = await sc.connect(Number(process.env.QUINKI_SIDECAR_CONNECT_MS || 900));
  if (!scOn) {
    if (spawnSidecar()) {
      for (let i = 0; i < 20 && !scOn; i++) {
        await new Promise((r) => setTimeout(r, 400));
        scOn = await sc.connect(700);
      }
    }
  }
  const pendingSkills: string[] = [];
  const stopTurn = () => {
    if (scOn) {
      void sc.call("abort", { sessionKey: currentKey }, 15000).catch(() => {});
      return;
    }
    try {
      void Promise.resolve((session as any).abort?.()).catch(() => {});
    } catch {}
  };

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
  const headerBg = (s: string) => bgKeepPanel(C.bgPanel, s);
  // The composer box spans at most ~1000px (the chat max) and is centered — the
  // header must match it column for column.
  const chatMaxCols = (): number => {
    try {
      const d: any = getCellDimensions?.() || {};
      const wpx = d?.widthPx || 0;
      if (wpx > 0) return Math.max(20, Math.round(1000 / wpx));
    } catch {}
    return 110;
  };
  const centerRow = (w: number, row: string, wc: number): string => {
    const pad = Math.max(0, Math.floor((w - wc) / 2));
    return " ".repeat(pad) + row + " ".repeat(Math.max(0, w - pad - wc));
  };
  const titleText = new FnLine((w: number) => {
    const t = fg(C.text, headerTitle);
    const dir = fmtDirShort();
    const wc = Math.min(w, chatMaxCols());
    // EXACT box layout: violet bar, TWO black columns, panel content, TWO black
    // columns, violet bar — same width as the composer, same margins.
    const L = fg(C.primary, "\u258f");
    const R = fg(C.primary, "\u2595");
    const tw = visibleWidth(t);
    const dw = visibleWidth(dir);
    let mid: string;
    if (dir) {
      // Title one column closer to the left bar, directory one column closer to
      // the right bar (panel and violet bars untouched): 1 inner col each side.
      const gap = Math.max(1, wc - tw - dw - 4);
      mid = headerBg(" ") + headerBg(t) + headerBg(" ".repeat(gap)) + headerBg(fg(C.textTertiary, dir)) + headerBg(" ");
    } else {
      mid = headerBg(" ") + headerBg(t) + headerBg(" ".repeat(Math.max(1, wc - tw - 4))) + headerBg(" ");
    }
    return centerRow(w, L + mid + R, wc);
  });
  // The header is THREE rows tall (empty / text / empty): the violet bars run the
  // whole height, exactly like the composer box.
  const headerPad = new FnLine((w: number) => {
    const wc = Math.min(w, chatMaxCols());
    return centerRow(w, fg(C.primary, "\u258f") + headerBg(" ".repeat(Math.max(0, wc - 2))) + fg(C.primary, "\u2595"), wc);
  });
  const header = new VStack([headerPad, titleText, headerPad] as any) as any;
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
    return ["quinki"];
  };
  // --- session entry: agents in this chat + per-agent overrides --------------
  // Same data the app uses: agentId (comma list) and agentOverrides[agentId] = {model, thinkingLevel}.
  const DEFAULT_CHAT_AGENT = "quinki";
  const sessionsFile = () => path.join(opts.agentDir, "quinki-sessions.json");
  const readSessionsList = (): any[] => {
    try {
      return JSON.parse(fs.readFileSync(sessionsFile(), "utf8")) || [];
    } catch {
      return [];
    }
  };
  const writeSessionsList = (list: any[]) => {
    try {
      // SAFETY: never let a write SHRINK the shared sessions file except for an
      // explicit single delete — a race with another writer (sidecar #save) or a
      // failed read must NEVER wipe entries (a lost entry = lost chat).
      let prevN = -1;
      try {
        const prev = JSON.parse(fs.readFileSync(sessionsFile(), "utf8"));
        prevN = Array.isArray(prev) ? prev.length : -1;
      } catch {}
      if (Array.isArray(list) && prevN >= 0 && list.length < prevN - 1) return;
      fs.writeFileSync(sessionsFile(), JSON.stringify(list, null, 2), "utf8");
    } catch {}
  };
  const ensureSessionEntry = (): void => {
    try {
      const list = readSessionsList();
      if (list.some((s: any) => s?.key === currentKey)) return;
      list.push({
        key: currentKey,
        label: "Chat",
        createdAt: Date.now(),
        lastActivity: Date.now(),
        order: Date.now(),
        folderId: null,
        compactionAuto: true,
        compactionThreshold: 80,
        model: (session as any)?.model?.id || "",
        thinkingLevel: thinkingOn ? "xhigh" : "off",
        mode,
        agentId: null,
        messageAgents: {},
      });
      writeSessionsList(list);
    } catch {}
  };
  const mutateSessionEntry = (fn: (e: any) => void) => {
    try {
      ensureSessionEntry();
      const list = readSessionsList();
      const idx = list.findIndex((s: any) => s?.key === currentKey);
      if (idx < 0) return;
      fn(list[idx]);
      list[idx].lastActivity = Date.now();
      writeSessionsList(list);
    } catch {}
  };
  const sessionAgentIds = (): string[] => {
    try {
      const e = readSessionsList().find((s: any) => s?.key === currentKey);
      const ids = String(e?.agentId || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (ids.length) return ids;
    } catch {}
    return [DEFAULT_CHAT_AGENT];
  };
  const sessionAgentOverrides = (): Record<string, any> => {
    try {
      const e = readSessionsList().find((s: any) => s?.key === currentKey);
      return (e?.agentOverrides || {}) as Record<string, any>;
    } catch {
      return {};
    }
  };
  const agentConfigOf = (id: string): any => {
    try {
      return JSON.parse(fs.readFileSync(path.join(opts.agentDir, "agents", id, "config.json"), "utf8")) || {};
    } catch {
      return {};
    }
  };
  const agentDisplayName = (id: string): string =>
    String(agentConfigOf(id)?.name || (id === "orchestrator" ? "Orchestrator" : id));
  const agentIdsKnown = (): string[] => {
    try {
      return fs
        .readdirSync(path.join(opts.agentDir, "agents"))
        .filter((d: string) => fs.existsSync(path.join(opts.agentDir, "agents", d, "config.json")));
    } catch {
      return [];
    }
  };
  // Model list: the SDK snapshot when ready, otherwise the provider config
  // (a fresh chat has no runtime snapshot yet — welcome chat included).
  // Recency = the TIMESTAMP OF THE LAST MESSAGE inside the session file — never
  // when the chat was merely viewed or touched. Reads the tail of the .jsonl.
  const lastMsgTs = (dir: string): number => {
    let best = 0;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".jsonl")) continue;
        const fp = path.join(dir, f);
        const size = fs.statSync(fp).size;
        const len = Math.min(16000, size);
        if (len <= 0) continue;
        const fd = fs.openSync(fp, "r");
        let txt = "";
        try {
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, size - len);
          txt = buf.toString("utf8");
        } finally {
          fs.closeSync(fd);
        }
        const lines = txt.split("\n");
        for (let i = lines.length - 1; i >= 0 && i > lines.length - 40; i--) {
          const ln = lines[i].trim();
          if (!ln) continue;
          try {
            const ob = JSON.parse(ln);
            const t = Date.parse(ob?.timestamp || ob?.ts || ob?.message?.timestamp || "");
            if (t > best) best = t;
            if (best) break; // last complete message found
          } catch {}
        }
        if (best) break;
      }
    } catch {}
    return best;
  };
  // The entry's per-message key for the LAST message (ts-<ms>): the same key
  // the app uses in messageAgents / messageThinking.
  const lastMsgKey = (k: string): string => {
    try {
      const ts = lastMsgTs(path.join(opts.agentDir, "sessions", "quinki", k));
      return ts ? "ts-" + ts : "";
    } catch {
      return "";
    }
  };
  const availableModels = (): any[] => {
    try {
      const s = session.modelRuntime?.getAvailableSnapshot?.() || [];
      if (s.length) return s;
    } catch {}
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "quinki-providers.json"), "utf8"));
      const out: any[] = [];
      for (const [name, pc] of Object.entries(cfg?.providers || {}) as any[]) {
        if (!pc?.enabled) continue;
        const md: any[] = Array.isArray(pc?.modelData) ? pc.modelData : [];
        const em: string[] = Array.isArray(pc?.enabledModels) ? pc.enabledModels : [];
        if (md.length) {
          for (const m of md) out.push({ id: String(m?.id || ""), name: String(m?.name || m?.id || ""), provider: name });
        } else {
          for (const id of em) out.push({ id: String(id), name: String(id), provider: name });
        }
      }
      return out;
    } catch {
      return [];
    }
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
  let wsSkillGroups: any[] = [];
  let wsModelId = "";
  let wsSessions: any[] = [];
  let lastSessKick = 0;
  let lastSkillKick = 0;
  let titleLocked = false; // user renamed: auto-title must not overwrite it
  const refreshSessions = () => {
    if (!scOn) return;
    void sc
      .call("listSessions", {}, 20000)
      .then((r: any) => {
        const list = Array.isArray(r?.sessions) ? r.sessions : [];
        wsSessions = list;
        // Keep the open chat's title in sync: renames made in the app arrive here.
        const me = list.find((s: any) => String(s?.key || s?.id) === currentKey);
        if (me?.label) setChatTitle(String(me.label));
        try {
          ui.requestRender();
        } catch {}
      })
      .catch(() => {});
  };
  const refreshSkillGroups = () => {
    if (!scOn) return;
    void sc
      .call("listChatSkills", { agentIds: sessionAgentIds() }, 20000)
      .then((r: any) => {
        wsSkillGroups = Array.isArray(r?.groups) ? r.groups : [];
        try {
          ui.requestRender();
        } catch {}
      })
      .catch(() => {});
  };
  const skillGroupsCached = () => {
    if (wsSkillGroups.length) {
      // Live path: groups come from the sidecar (exactly what the app lists).
      return wsSkillGroups.map((g: any) => ({
        agentId: g.agentId,
        agentName: String(g.agentName || g.name || agentDisplayName(String(g.agentId || ""))),
        skills: Array.isArray(g.skills) ? g.skills : [],
      }));
    }
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
  // === /settings (app Settings tab, CLI edition) ===
  const readSettingsFile = (): any => {
    try { return JSON.parse(require("fs").readFileSync(require("path").join(require("os").homedir(), ".quinki", "quinki-settings.json"), "utf8")) || {}; } catch { return {}; }
  };

  const qProvidersPath = (): string => {
    try { return require("path").join(require("os").homedir(), ".quinki", "quinki-providers.json"); } catch { return ""; }
  };
  const readProvidersCfg = (): any => {
    try { return JSON.parse(require("fs").readFileSync(qProvidersPath(), "utf8")) || {}; } catch { return {}; }
  };
  const patchProvider = (name: string, fn: (p: any) => void) => {
    try {
      const cfg = readProvidersCfg();
      const provs = cfg.providers || (cfg.providers = {});
      const p = provs[name] || (provs[name] = {});
      fn(p);
      const call = (globalThis as any).__sidecarCall;
      if (call) call('setProvidersConfig', cfg).catch(() => {});
    } catch {}
  };

  let wsSettings: any = { defaultModel: "", defaultThinkingLevel: "" };
  const fetchSettings = () => {
    try {
      // 1) the file that BOTH the app and the CLI write = the source of truth
      try {
        const f = readSettingsFile();
        wsSettings = { ...(wsSettings || {}), ...(f || {}) };
        if (Array.isArray(f?.defaultFallbackModels)) wsSettings.defaultFallbackModels = f.defaultFallbackModels;
      } catch {}
      // 2) the sidecar's view (may add more keys)
      const call = (globalThis as any).__sidecarCall;
      if (call) call('getSettings', {}).then((r: any) => {
        if (r) {
          wsSettings = { ...(wsSettings || {}), ...r };
          // never let a missing key in the RPC response erase the file's fallbacks
          try {
            const f2 = readSettingsFile();
            if (Array.isArray(f2?.defaultFallbackModels)) wsSettings.defaultFallbackModels = f2.defaultFallbackModels;
          } catch {}
          try { ui.requestRender(); } catch {}
        }
      }).catch(() => {});
      try { ui.requestRender(); } catch {}
    } catch {}
  };
  const settingsMenuItems = (): any[] => {
    return [
      { value: "defaults", label: "Global defaults", description: String(wsSettings?.defaultModel || "") },
      { value: "shortcuts", label: "Shortcuts", description: "Keys" },
      { value: "attachments", label: "Attachments storage", description: "Where files live" },
        { value: "providers", label: "Providers", description: "API keys, models" },
      { value: "version", label: "Version", description: "Build info" },
    ];
  };
  const settingsLevelItems = (stack: string[]): any[] => {
  const lv = stack[1];
  if (lv === "defaults") {
    const lastLv = stack[stack.length - 1];
    if (stack[2] === "model") return modelPickerItems(String(readProvidersCfg().defaultModel || defaultModelId || ""));
    if (lastLv === "addfallback") return modelPickerItems("", (Array.isArray(wsSettings?.defaultFallbackModels) ? wsSettings.defaultFallbackModels : []));
    const fbFromFile = (): any[] => {
      try { const ff = readSettingsFile().defaultFallbackModels; if (Array.isArray(ff)) return ff; } catch {}
      return Array.isArray(wsSettings?.defaultFallbackModels) ? wsSettings.defaultFallbackModels : [];
    };
    if (stack[2] === "fallbacks") {
      // FULL model list: Space selects the fallbacks; the selection order IS the
      // fallback order (1., 2., 3. ...). Deselect -> the rest re-rank.
      const list = modelPickerItemsList();
      const order = Array.from(menuMarked);
      return list.map((it: any) => {
        if (it.separator) return it;
        const id = String(it.value || "");
        const idx = order.indexOf(id);
        return { ...it, label: (idx >= 0 ? "\u25cf " + (idx + 1) + ". " : "\u25cb ") + String(it.label || id) };
      });
    }
    const fbN = fbFromFile().length;
    const th = String(wsSettings?.defaultThinkingLevel || readProvidersCfg().defaultThinking || "xhigh");
    return [
      { value: "model", label: "Default model", description: String((readProvidersCfg().defaultModel) || defaultModelId || "") },
      { value: "fallbacks", label: "Fallback models", description: fbN + " configured" },
      { value: "thinking", label: "Thinking", description: th === "off" ? "Off" : "On" },
    ];
  }
  if (lv === "shortcuts") {
    return [
      { value: "__s1", label: "Tab", description: "Plan / Build" },
      { value: "__s2", label: "Ctrl+T", description: "Toggle navigation" },
      { value: "__s3", label: "Ctrl+F", description: "Info on footers" },
      { value: "__ins", label: "Ctrl+S", description: "Select in lists (multi)" },
      { value: "__s4", label: "Enter", description: "Send" },
      { value: "__s5", label: "Ctrl+Enter", description: "Steer while streaming" },
      { value: "__s6", label: "Esc", description: "Stop / close menu" },
      { value: "__s7", label: "Ctrl+C", description: "Quit quinki" },
    ];
  }
  if (lv === "version") {
    let appV = "?";
    try { appV = String(require("fs").readFileSync(require("path").join(require("os").homedir(), ".quinki", "app-version.txt"), "utf8")).trim() || "?"; } catch {}
    return [
      { value: "__v1", label: "App", description: appV },
      { value: "__v2", label: "CLI", description: "quinki cli" },
      { value: "__v3", label: "Update", description: "quinki update" },
    ];
  }
  if (lv === "attachments") {
    let files = 0, bytes = 0;
    try {
      const fs2 = require("fs"), path2 = require("path");
      const base = path2.join(require("os").homedir(), ".quinki", "attachments");
      const walk = (d: string) => { for (const e of fs2.readdirSync(d, { withFileTypes: true })) { const f = path2.join(d, e.name); if (e.isDirectory()) walk(f); else { files++; try { bytes += fs2.statSync(f).size; } catch {} } } };
      if (fs2.existsSync(base)) walk(base);
    } catch {}
    return [
      { value: "__at0", label: "Folder", description: "~/.quinki/attachments" },
      { value: "__at1", label: "Files", description: String(files) },
      { value: "__at2", label: "Size", description: (bytes / 1048576).toFixed(1) + " MB" },
    ];
  }
  if (lv === "providers") {
    const cfg = readProvidersCfg();
    if (!stack[2]) {
      const out: any[] = [];
      for (const name of Object.keys(cfg.providers || {})) {
        const p = (cfg.providers || {})[name] || {};
        out.push({
          value: "prov:" + name,
          label: (p.enabled ? "\u25cf " : "\u25cb ") + name,
          description: (p.enabled ? "enabled" : "disabled") + " \u00b7 " + String((p.enabledModels || []).length) + " on",
        });
      }
      out.push({ value: "__addprov", label: "\uff0b Add provider", description: "name, URL" });
      return out;
    }
    if (stack[2] === "__addprov") {
      const typed = String(menuSubFilter || "");
      const stepLabel = addProvStep === 0 ? "Provider name" : "Base URL";
      return [{ value: typed || "__wiz", label: typed || (stepLabel + "\u2026"), description: typed ? "Enter to continue" : "type here" }];
    }
    const name = String(stack[2]).replace(/^prov:/, "");
    const p = ((cfg.providers || {})[name]) || {};
    if (stack[3] === "models") {
      fetchAllModels();
      // The FULL provider catalog (same RPC the app uses: OpenRouter /api/v1/models etc.)
      fetchProviderCatalog(name, String(p.baseUrl || ""), String(p.apiKey || ""));
      const seen: Record<string, any> = {};
      const all: any[] = [];
      for (const mm of (p.modelData || [])) { const id = String(mm?.id || ""); if (id && !seen[id]) { seen[id] = 1; all.push(mm); } }
      for (const mm of wsAllModels) {
        if (String(mm?.provider || "") !== name) continue;
        const id = String(mm?.id || "");
        if (id && !seen[id]) { seen[id] = 1; all.push(mm); }
      }
      for (const mm of (wsProviderModels[name] || [])) {
        const id = String(mm?.id || "");
        if (id && !seen[id]) { seen[id] = 1; all.push(mm); }
      }
      const en = p.enabledModels || [];
      const out: any[] = all.map((mm: any) => {
        const id = String(mm?.id || "");
        const on = en.includes(id);
        return { value: "mdl:" + id, label: (on ? "\u25cf " : "\u25cb ") + id, description: (on ? "on" : "off") + (mm.name ? " \u00b7 " + String(mm.name) : "") };
      });
      return out;
    }
    if (stack[3] === "key") {
      const k = String(p.apiKey || "");
      const masked = k ? k.slice(0, 4) + "\u2026" + k.slice(-4) : "not set";
      const typed = String(menuSubFilter || "");
      return [{ value: typed || "__keyfield", label: typed || ("API key: " + masked), description: typed ? "Enter to save" : "type the new key" }];
    }
    if (stack[3] === "baseurl") {
      const typed = String(menuSubFilter || "");
      return [{ value: typed || "__urlfield", label: typed || ("Base URL: " + String(p.baseUrl || "not set")), description: typed ? "Enter to save" : "type the new URL" }];
    }
    return [
      { value: "toggle", label: "Enabled", description: p.enabled ? "On" : "Off" },
      { value: "key", label: "API key", description: p.apiKey ? "set" : "not set" },
      { value: "baseurl", label: "Base URL", description: String(p.baseUrl || "not set") },
      { value: "models", label: "Models", description: String((p.enabledModels || []).length) + " on" },
    ];
  }
  return settingsMenuItems();
};

  const commands = [
    {
      name: "model",
      description: "Change model",
      seq: 5,
      getArgumentCompletions: () => {
        // Grouped by provider with separators — same layout as the per-agent
        // model menu. The order of providers and models mirrors the app config
        // (quinki-providers.json) so every change there is reflected here.
        const items: any[] = [];
        try {
          let lastProv = "";
          for (const m of availableModels()) {
            const id = String(m?.id ?? "");
            if (!id) continue;
            const prov = String(m?.provider ?? "");
            if (prov && prov !== lastProv) {
              items.push({ value: "__sep_prov_" + prov, label: prov, separator: true });
              lastProv = prov;
            }
            const cur = session?.model?.id === id && String(session?.model?.provider ?? "") === prov;
            items.push({ value: id, label: id, description: (cur ? "current \u00b7 " : "") + prov });
          }
        } catch {}
        return items;
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
        if (scOn && Date.now() - lastSkillKick > 1500) {
          lastSkillKick = Date.now();
          refreshSkillGroups();
        }
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
        { value: "confirm", label: "", notice: "Reset this chat? All messages will be deleted. Model, directory and settings stay." },
      ],
    },
    {
      name: "sessions",
      description: "Switch to another chat",
      seq: 1,
      getArgumentCompletions: (prefix: string) => {
        const items: any[] = [];
        const labels: Record<string, string> = {};
        if (scOn) {
          // Opening the menu refreshes the list RIGHT AWAY (throttled): fresh data
          // appears in place — no need to open/close the menu twice.
          if (Date.now() - lastSessKick > 1500) {
            lastSessKick = Date.now();
            refreshSessions();
          }
          // Live authority: the sidecar's own list — chats deleted or renamed in
          // the app are reflected here at once (no ghost entries).
          for (const s of wsSessions) {
            const k = String(s?.key || s?.id || "");
            if (!k || k === currentKey || k === "__app_expert__" || k.startsWith("__exec_")) continue;
            let ts = 0;
            try {
              ts = lastMsgTs(path.join(opts.agentDir, "sessions", "quinki", k));
            } catch {}
            if (!ts) ts = Number(s?.lastActivity) || Number(s?.createdAt) || 0;
            items.push({ value: k, label: String(s?.label || k), description: "chat \u00b7 " + fmtWhen(ts), ts });
          }
          items.sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
          for (const it of items) delete it.ts;
          if (!welcomeShown) {
            items.unshift({ value: "__new__", label: "New chat", description: "Start a fresh conversation" });
          }
          const p0 = prefix.toLowerCase();
          return items.filter((i) => i.label.toLowerCase().includes(p0) || i.value.toLowerCase().includes(p0));
        }
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "quinki-sessions.json"), "utf8"));
          if (Array.isArray(raw)) {
            for (const s of raw) {
              const k = String(s?.key ?? "");
              if (!k) continue;
              labels[k] = String(s?.label || "");
              if (k === currentKey || k === "__app_expert__" || k.startsWith("__exec_")) continue;
              const ts0 = Number(s?.lastActivity) || Number(s?.createdAt) || 0;
              let ts = 0;
              try {
                ts = lastMsgTs(path.join(opts.agentDir, "sessions", "quinki", k));
              } catch {}
              if (!ts) ts = ts0;
              items.push({ value: k, label: labels[k] || k, description: "chat \u00b7 " + fmtWhen(ts), ts });
            }
          }
        } catch {}
        // Most recent first — CLI-only ordering (handier from the slash menu).
        items.sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
        for (const it of items) delete it.ts;
        // New chat on top — but only when already inside a chat (on the welcome
        // composer there is nothing to "start": it IS the new chat).
        if (!welcomeShown) {
          items.unshift({ value: "__new__", label: "New chat", description: "Start a fresh conversation" });
        }
        const p = prefix.toLowerCase();
        return items.filter((i) => i.label.toLowerCase().includes(p) || i.value.toLowerCase().includes(p));
      },
    },
    {
      name: "agentinsession",
      description: "Agents in this session",
      seq: 2,
      hidden: () => welcomeShown,
      getArgumentCompletions: () => agentMenuItems(),
    },
    {
      name: "rename",
      description: "Rename this chat",
      seq: 3,
      hidden: () => welcomeShown,
      getArgumentCompletions: (prefix: string) => {
        // The typed text IS the new name — raw (spaces, deletions included), never
        // trimmed: the item must keep matching the live menu filter, otherwise the
        // menu flickers closed and the name gets lost.
        return prefix
          ? [{ value: prefix, label: prefix, description: "set this title" }]
          : [{ value: "", label: "type the new name\u2026", description: "then Enter to set it" }];
      },
    },
    { name: "reload", description: "Reload this chat (recover history, fix glitches)", seq: 4 },
    { name: "export", description: "Export this chat as Markdown", seq: 10 },
    {
      name: "delete",
      description: "Delete this chat",
      seq: 12,
      hidden: () => welcomeShown,
      getArgumentCompletions: () => [
        { value: "confirm", label: "", notice: "Delete this chat? The chat and all its messages will be deleted forever." },
      ],
    },
    {
      name: "settings",
      description: "Settings",
      seq: 13,
      getArgumentCompletions: () => settingsMenuItems(),
    },
    {
      name: "quit",
      description: "Exit quinki (asks for confirmation)",
      seq: 14,
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
  // Flattened toggle tree: a toggle then, when OPEN, its nested children — the
  // Ctrl+T navigation walks exactly this (nested delegation included).
  const flatToggles = (): any[] => {
    const out: any[] = [];
    const walk = (t: any) => {
      out.push(t);
      if (t.open) for (const c of t.children || []) if (c && c.t === "toggle") walk(c.v);
    };
    for (const t of toggles) walk(t);
    return out;
  };
  const enterToggleNav = () => {
    navMode = true;
    const fl = flatToggles();
    if (fl.length > 0) {
      selToggle = fl.length - 1;
      fl.forEach((t, i) => (t.selected = i === selToggle));
      scrollToggleIntoView(selToggle);
    }
    ui.requestRender();
  };
  const exitToggleNav = () => {
    navMode = false;
    selToggle = -1;
    flatToggles().forEach((t) => {
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
    const fl = flatToggles();
    if (fl.length === 0) return;
    if (selToggle < 0) selToggle = fl.length - 1;
    else selToggle = Math.max(0, Math.min(fl.length - 1, selToggle + dir));
    fl.forEach((t, i) => (t.selected = i === selToggle));
    scrollToggleIntoView(selToggle);
    ui.requestRender();
  };
  const setToggleOpen = (open: boolean) => {
    const fl = flatToggles();
    if (selToggle < 0 || !fl[selToggle]) return;
    fl[selToggle].open = open;
    scrollToggleIntoView(selToggle);
    ui.requestRender();
  };

  // Tab = toggle plan/build (app behaviour), intercepted at the TUI level.
  try {
    ui.addInputListener((data: string) => {
      // Escape sequences can be SPLIT across reads ("\x1b[1;1" then "C…"): hold
      // an unfinished tail (ESC + "[…") and prepend it to the next read, so the
      // arrow is recognized on its FIRST press (a lone ESC key stays untouched).
      {
        const raw = pendingKeys + String(data);
        pendingKeys = "";
        const m = raw.match(/\x1b(\[[0-9;:]*)?$/);
        if (m && m[0].includes("[") && m[0].length < 12) {
          pendingKeys = m[0];
          data = raw.slice(0, raw.length - m[0].length);
        } else {
          data = raw;
        }
        if (!data) return { consume: true };
      }
      // Kitty-capable terminals report press AND release in the SAME read:
      // "\x1b[1;1C\x1b[1;1:3C". Strip every release (":3" event form) and use
      // what remains: otherwise the chunk matches no key at all and the first
      // press is silently LOST — every action then seems to need two presses.
      {
        const stripped = String(data).replace(/\x1b\[[0-9;]*:3[0-9;:]*[A-Za-z~]/g, "");
        if (stripped !== data) {
          if (!stripped) return { consume: true };
          data = stripped;
        }
      }
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
        // Ctrl+F keeps working in toggle-nav: reveal/hide the info on footers
        // (the delegation footers must behave exactly like the chat ones).
        if (data === "\x06" || matchesKey(data, "ctrl+f")) {
          try {
            toggleInfo();
            ui.requestRender();
          } catch {}
          return { consume: true };
        }
        return { consume: true };
      }
      const isTab =
        data === "\t" || data === "\x1b[9u" || data === "\x1b[9;1u" || matchesKey(data, "tab");
      if (isTab) {
        // Tab = Plan/Build normally; when the slash menu is OPEN it becomes the
        // SELECT key (nothing else to do there — you cannot type a message anyway).
        // The menu is "open" when a menu path is active (menuStack) OR the slash
        // text is being typed — NOT only when the text starts with "/" (it gets
        // cleared on Enter while the menu stays open).
        let menuIsOpen = false;
        try { menuIsOpen = (menuStack && menuStack.length > 0) || !!(menuOpenRef?.() ?? false); } catch { menuIsOpen = !!(menuOpenRef?.() ?? false); }
        if (menuIsOpen) { try { menuNavRef?.("select"); } catch {} try { ui.requestRender(); } catch {} return { consume: true }; }
        toggleModeRef?.();
        return { consume: true };
      }
      // Ctrl+F = reveal/hide the info part on ALL footers at once.
      if ((data === "\x06" || matchesKey(data, "ctrl+f")) && !(menuOpenRef?.() ?? false)) {
        try {
          toggleInfo();
          ui.requestRender();
        } catch {}
        return { consume: true };
      }
      // PgUp while at the TOP of the transcript: load 50 older messages (like the
      // app's scroll-up loading), then keep the view near the newly loaded part.
      if (data === "\x1b[5~" || matchesKey(data, "pageup")) {
        try {
          const sv: any = (globalThis as any).__quinkiScroll;
          const top = Number(sv?.scrollTop || 0); // scrollTop is a GETTER
          const allN = readSessionEntries().length;
          if (top <= 12 && allN > histLimit) {
            // Load 50 older messages and KEEP the reading position (disable the
            // end-follow so the view does not jump to the bottom).
            histLimit += 50;
            renderHistory();
            try {
              sv?.scrollTo?.(90, { disableFollow: true });
            } catch {}
            ui.requestRender();
            return { consume: true };
          }
        } catch {}
      }
      const isEnter = data === "\r" || matchesKey(data, "enter");
      // SELECT KEY = Ctrl+S: control keys send ONE identical byte on EVERY terminal
      // and OS (like the letter X did) -> truly universal. Consumed before the
      // filter -> nothing is ever typed into the command bar.
      // (X and F2/Insert kept as silent extras for muscle memory.)
      const isSelect = false; // Tab is handled by the dedicated branch
      const isCtrlEnter = data === "\n" || data === "\x1b[13;5u" || matchesKey(data, "ctrl+enter");
      const isEsc = data === "\x1b" || matchesKey(data, "escape");
      const isUp = data === "\x1b[A" || matchesKey(data, "up");
      const isDown = data === "\x1b[B" || matchesKey(data, "down");
      const isLeft = data === "\x1b[D" || matchesKey(data, "left");
      const isRight = data === "\x1b[C" || matchesKey(data, "right");
      const menuNow = menuOpenRef?.() ?? false;
      if (isCtrlEnter && !menuNow && streaming) {
        // Steer: send a new instruction into the RUNNING turn.
        const txt = editorText().trim();
        if (txt) {
          try {
            editor.setText("");
          } catch {}
          pushBlock(new Text(txt, 2, 1, (s: string) => bg(C.bubbleUser, s)));
          scrollToEnd();
          if (scOn) {
            void sc.call("steer", { sessionKey: currentKey, text: txt }, 20000).catch(() => {});
          } else {
            try {
              void Promise.resolve((session as any).steer?.(txt)).catch(() => {});
            } catch {}
          }
          ui.requestRender();
        }
        return { consume: true };
      }
      if (isEsc) {
        if (menuNow) {
          menuNavRef?.("escape");
          return { consume: true };
        }
        if (streaming) {
          // Esc STOPS the running turn (the hint row lights Stop (Esc) red for
          // the whole duration of the stream).
          try {
            stopTurn();
          } catch {}
        }
        return { consume: true };
      }
      if (menuNow) {
        if (isUp || isDown || isLeft || isRight || isEnter) {
          menuNavRef?.(isSelect ? "select" : isUp ? "up" : isDown ? "down" : isLeft ? "left" : isRight ? "right" : "enter");
          return { consume: true };
        }
        if (menuStack.length > 0) {
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
  // The app's own source of truth: quinki-providers.json (settings as fallback).
  try {
    const cf: any = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "quinki-providers.json"), "utf8"));
    defaultModelId = cf?.defaultModel || "";
  } catch {}
  if (!defaultModelId) {
    try {
      const st: any = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "settings.json"), "utf8"));
      defaultModelId = st?.defaultModel || "";
    } catch {}
  }
  let toggleModeRef: (() => void) | null = null;
  let handleSlashRef: ((raw: string) => void) | null = null;
  // Slash menu (OURS — app-style; it NEVER writes command text into the box).
  let menuError = ""; // error shown INSIDE the slash menu (never in the chat)
  let menuStack: string[] = [];
  let menuMarked = new Set<string>();
  let menuItemsCache: any[] = []; // open menu path: [], [cmd] or ["agent", ...deeper levels]
  let lastNavA = ""; // last navigation direction (duplicate-event collapse)
  let lastNavT = 0;
  let pendingKeys = ""; // unfinished escape tail held across reads
  let menuSubFilter = ""; // filter typed inside a submenu
  let menuSel = 0; // selected row
  let menuConfirmFocus = false; // → focused the Confirm action (app NavBar focusConfirm)
  let menuLastFilter = ""; // to reset the selection when the filter changes
  let menuOpenRef: (() => boolean) | null = null;
  let menuNavRef: ((a: "up" | "down" | "left" | "right" | "enter" | "escape" | "select") => void) | null = null;
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
    const modelId = wsModelId || defaultModelId || "";
    const sep = fg(C.textTertiary, " \u00b7 ");
    const quiet = (s: string) => fg(C.textTertiary, s);
    const modeStr = mode === "plan" ? fg(C.modePlan, "Plan (Tab)") : fg(C.modeBuild, "Build (Tab)");
    const bar =
      modeStr +
      sep +
      ctxStr +
      sep +
      quiet(modelId) +
      sep +
      quiet("Thinking: " + (thinkingOn ? "On" : "Off"));
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
      const leftN =
        lit("Toggle Nav (Ctrl+T)") +
        fg(C.textTertiary, " \u00b7 ") +
        fg(C.danger, "Esc") +
        fg(C.textTertiary, " \u00b7 ") +
        quiet("Info (Ctrl+F)");
      const rightN =
        sec("Move (\u2191\u2193)") +
        fg(C.textTertiary, " \u00b7 ") +
        sec("Close (\u2190)") +
        fg(C.textTertiary, " \u00b7 ") +
        sec("Open (\u2192)");
      const brandN = welcomeShown ? "" : fg(C.primary, "\u2502") + " " + fg(C.primary, "Quinki") + " " + fg(C.primary, "\u2502");
      const lwN = visibleWidth(leftN);
      const rwN = visibleWidth(rightN);
      const startN = Math.max(lwN + 1, Math.floor((width - 10) / 2));
      const g1N = Math.max(1, startN - lwN);
      const g2N = Math.max(1, width - startN - 10 - rwN);
      return leftN + " ".repeat(g1N) + brandN + " ".repeat(g2N) + rightN;
    }
    const menuActive = menuOpenRef?.() ?? false;
    const canSend = hasText() && !streaming && !menuActive;
    const canSteer = streaming && hasText();
    const textNow = (() => {
      try {
        return editor.getText().trim();
      } catch {
        return "";
      }
    })();
    // A complete slash command waiting to be run -> Enter is FILLED (violet bg).
    const cmdReady = !menuActive && textNow.startsWith("/") && textNow.length > 1;
    const left = welcomeShown
      ? (menuActive ? lit("Menu (/)") : quiet("Menu (/)"))
      : (menuActive ? lit("Menu (/)") : quiet("Menu (/)")) +
        fg(C.textTertiary, " \u00b7 ") +
        quiet("Toggle Nav (Ctrl+T)") +
        fg(C.textTertiary, " \u00b7 ") +
        quiet("Info (Ctrl+F)");
    const sep = fg(C.textTertiary, " \u00b7 ");
    const stopKey = welcomeShown ? "" : (streaming ? bold(fg(C.danger, "Stop (Esc)")) : quiet("Stop (Esc)"));
    const steerKey = welcomeShown ? "" : (canSteer ? lit("Steer (Ctrl+Enter)") : quiet("Steer (Ctrl+Enter)"));
    const sendKey = cmdReady
      ? bold(bg(C.primary, fg(C.bgPanel, " Send (Enter) ")))
      : canSend
        ? lit("Send (Enter)")
        : quiet("Send (Enter)");
    const right = [stopKey, steerKey, sendKey].filter((x) => x.length > 0).join(sep);

    // "│ Quinki │" — brand centered between two violet vertical bars.
    const brand = welcomeShown ? "" : fg(C.primary, "\u2502") + " " + fg(C.primary, "Quinki") + " " + fg(C.primary, "\u2502");
    const lw = visibleWidth(left);
    const rw = visibleWidth(right);
    const bw = welcomeShown ? 0 : 10;
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
    codeBlock: (s: string) => bgHard("#000000", fg(C.text, s)),
    codeBlockBorder: (s: string) => "", // fences removed: clean black block
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
            (globalThis as any).__qMd = mdTheme; // nested toggles render markdown too
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
        // The tool call toggle is ALWAYS a plain tool call (delegations included):
        // the delegation toggle is a SEPARATE block, created right below it.
        pushBlock(registerToggle(new ToggleBlock({ label: "Tool call", boldName: name, color: C.toolCall, body })));
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
        // Message footer (exact app format): ONLY after a real text — never after
        // a tool/toggle, never for an aborted stream (app behaviour).
        const hadText = lastAssistantText.trim();
        lastAssistantText = "";
        if (hadText && e?.message?.stopReason !== "aborted") {
        try {
          let agentName = sessionAgentIds()[0] || "quinki";
          let lvl = thinkingOn ? "xhigh" : "off";
          try {
            const e0 = readSessionsList().find((s: any) => s?.key === currentKey);
            const mk = lastMsgKey(currentKey);
            if (mk && e0?.messageAgents?.[mk]) agentName = String(e0.messageAgents[mk]);
            if (mk && e0?.messageThinking?.[mk]) lvl = String(e0.messageThinking[mk]);
          } catch {}
          pushBlock(new FooterRow(fmtFooterDate(Date.now()), agentDisplayName(agentName) + " \u00b7 " + (wsModelId || defaultModelId || "") + " \u00b7 " + levelLabel(lvl), true));
        } catch {}
        }
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

  // --- sidecar events -> the same renderer -------------------------------------
  // The sidecar broadcasts the app's flat event shapes; they are mapped onto the
  // SDK events onSessionEvent already handles, so the CLI renders identically.
  let wsToolName = "";
  let wsToolArgs = "";
  let wsToolToggle: any = null;
  let lastUserPush = { text: "", ts: 0 };
  let histLimit = 50;
  let histMsgs: any[] | null = null; // server-normalized history (the app's way)

  /** Ask the SIDECAR for the history — the exact source the app uses: correct
   *  order, blocks normalized, footers with the real agent/model/level. */
  const loadServerHistory = async (beforeTs?: number): Promise<boolean> => {
    if (!scOn) return false;
    try {
      if (typeof beforeTs === "number" && beforeTs > 0) {
        const r = await sc.call("getHistoryBefore", { sessionKey: currentKey, ts: beforeTs, limit: 50 }, 30000);
        const more = Array.isArray(r?.messages) ? r.messages : [];
        if (histMsgs && more.length) histMsgs = more.concat(histMsgs);
        return more.length > 0;
      }
      const r = await sc.call("getHistory", { sessionKey: currentKey, limit: 50 }, 30000);
      histMsgs = Array.isArray(r?.messages) ? r.messages : [];
      return histMsgs.length > 0;
    } catch {
      return false;
    }
  };
  // The vendored ScrollView calls this when the user scrolls to the very top.
  (globalThis as any).__qLoadOlder = () => {
    try {
      if (histMsgs) {
        const first = histMsgs[0];
        const ts = Number(first?.timestamp) || 0;
        void loadServerHistory(ts).then((ok) => {
          if (!ok) return;
          renderHistory();
          try {
            (globalThis as any).__quinkiScroll?.scrollTo?.(60, { disableFollow: true });
          } catch {}
          ui.requestRender();
        });
        return;
      }
      const allN = readSessionEntries().length;
      if (allN <= histLimit) return;
      histLimit += 50;
      renderHistory();
      try {
        (globalThis as any).__quinkiScroll?.scrollTo?.(60, { disableFollow: true });
      } catch {}
      ui.requestRender();
    } catch {}
  };
  let modelExplicit = false; // user picked a model with /model
  let thinkingExplicit = false; // user toggled thinking with /thinking
  // Live delegations: messageId -> open delegation toggle. Nested stream events
  // (thinking, text, tool calls of the DELEGATED agent) go INSIDE the toggle —
  // exactly like the app's delegation block.
  const delegToggles = new Map<string, any>();
  const routeNested = (tg: any, t: string, p: any) => {
    if (!tg) return;
    const kids: any[] = (tg.children = tg.children || []);
    const last: any = kids[kids.length - 1];
    if (t === "thinking_delta" || t === "thinking" || t === "thinking_start") {
      if (!last || last.t !== "toggle" || last.v.label !== "Thinking") {
        kids.push({ t: "toggle", v: new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, open: true }) });
      }
      const th = kids[kids.length - 1].v;
      th.setBody(String(th.body || "") + String(p.delta || p.content || ""));
    } else if (t === "text_delta" || t === "text" || t === "text_start") {
      if (!last || last.t !== "text") kids.push({ t: "text", v: "" });
      kids[kids.length - 1].v += String(p.delta || p.content || "");
    } else if (t === "toolcall_start") {
      kids.push({ t: "toggle", v: new ToggleBlock({ label: "Tool call", boldName: String(p.toolName || p.delta || "tool"), color: C.toolCall, body: "" }) });
    } else if (t === "toolcall_delta") {
      const c = kids[kids.length - 1];
      if (c && c.t === "toggle") c.v.setBody(String(c.v.body || "") + String(p.delta || p.content || ""));
    } else if (t === "toolcall_end") {
      // Arguments complete (they already accumulated through the deltas).
    } else if (t === "tool_result") {
      kids.push({
        t: "toggle",
        v: new ToggleBlock({
          label: p.isError ? "Tool error" : "Tool result",
          boldName: String(p.toolName || "tool"),
          color: p.isError ? C.danger : C.toolResult,
          body: String(p.content || ""),
        }),
      });
    }
    try {
      ui.requestRender();
    } catch {}
  };
  const onWsEvent = (method: string, p: any) => {
    try {
      if (p?.sessionKey && p.sessionKey !== currentKey) return;
      if (method === "stream_event") {
        const t = p.eventType || p.type;
        // Nested delegation stream: stays INSIDE the delegation toggle.
        if (p.messageId && delegToggles.has(String(p.messageId)) && t !== "delegation_end") {
          routeNested(delegToggles.get(String(p.messageId)), t, p);
          return;
        }
        if (t === "delegation_end") {
          const tg = delegToggles.get(String(p.messageId || ""));
          if (tg) tg.open = false;
          try {
            ui.requestRender();
          } catch {}
          return;
        }
        if (t === "text_delta" || t === "text" || t === "text_start") {
          if (p.delta || p.content) {
            onSessionEvent({
              type: "message_update",
              message: { role: "assistant" },
              assistantMessageEvent: { type: "text_delta", delta: String(p.delta || p.content || "") },
            });
          }
        } else if (t === "thinking_delta" || t === "thinking" || t === "thinking_start") {
          if (p.delta || p.content) {
            onSessionEvent({
              type: "message_update",
              message: { role: "assistant" },
              assistantMessageEvent: { type: "thinking_delta", delta: String(p.delta || p.content || "") },
            });
          }
        } else if (t === "toolcall_start") {
          wsToolName = String(p.toolName || p.delta || "tool");
          wsToolArgs = "";
          // Chronological (app): the tool call toggle appears the moment the call
          // starts; its arguments fill in on the deltas; toolcall_end is not the
          // result (that arrives as the separate tool_result notification).
          assistant = null;
          assistantText = "";
          wsToolToggle = new ToggleBlock({ label: "Tool call", boldName: wsToolName, color: C.toolCall, body: "" });
          pushBlock(registerToggle(wsToolToggle));
          try {
            scrollToEnd();
            ui.requestRender();
          } catch {}
        } else if (t === "toolcall_delta") {
          wsToolArgs += String(p.delta || p.content || "");
          try {
            wsToolToggle?.setBody(wsToolArgs);
            ui.requestRender();
          } catch {}
        } else if (t === "toolcall_end") {
          // Args complete — nothing to do here (app behaviour).
        } else if (t === "delegation_start") {
          // App order: "Delegation to <agentName>" (bold) right after its tool
          // call, CLOSED by default, with the task bubble inside.
          const tgt = String(p.agentName || "").trim();
          const tg = new ToggleBlock({ label: "Delegation to", boldName: tgt, color: C.delegation, open: false });
          const task = String(p.task || "").trim();
          if (task) tg.children.push({ t: "bubble", v: task });
          delegToggles.set(String(p.messageId || ""), tg);
          pushBlock(registerToggle(tg));
          try {
            scrollToEnd();
            ui.requestRender();
          } catch {}
        } else if (t === "auto_retry_start") {
          onSessionEvent({ type: "auto_retry_start", attempt: p.attempt || 1, maxAttempts: p.maxAttempts || 3 });
        } else if (t === "auto_retry_end") {
          onSessionEvent({ type: "auto_retry_end", success: !!p.success });
        } else if (t === "compaction_start") {
          onSessionEvent({ type: "compaction_start" });
        } else if (t === "compaction_end") {
          onSessionEvent({ type: "compaction_end", summary: p.summary, errorMessage: p.errorMessage });
        }
      } else if (method === "tool_result") {
        // The delegate's tool result means that delegation is over: close its
        // toggle automatically, exactly like a thinking toggle at message end.
        if (/delegate/i.test(String(p.toolName || ""))) {
          for (const tg of delegToggles.values()) tg.open = false;
        }
        onSessionEvent({
          type: "tool_execution_end",
          toolName: p.toolName || "tool",
          isError: !!p.isError,
          result: { content: [{ type: "text", text: String(p.content || "") }] },
        });
      } else if (method === "streaming_started") {
        onSessionEvent({ type: "agent_start" });
      } else if (method === "done") {
        onSessionEvent({ type: "message_end", message: { role: "assistant", stopReason: p?.stopReason } });
      } else if (method === "streaming_stopped") {
        onSessionEvent({ type: "agent_end" });
        refreshSkillGroups();
        refreshSessions();
        // Real context numbers from the same source the app uses.
        void sc
          .call("getContextUsage", { sessionKey: currentKey }, 15000)
          .then((r: any) => {
            const u = r?.usage || {};
            const tk = Number(u.tokens ?? (Number(u.input || 0) + Number(u.output || 0)));
            if (tk > 0) ctxTokens = tk;
            if (Number(u.contextWindow || 0) > 0) ctxWindow = Number(u.contextWindow);
            else {
              const mm = availableModels().find((x: any) => String(x?.id) === wsModelId);
              if (mm?.contextWindow) ctxWindow = Number(mm.contextWindow);
            }
            try {
              ui.requestRender();
            } catch {}
          })
          .catch(() => {});
      } else if (method === "agent_status") {
        const k = String(p.status || "");
        if (k === "retrying") setStatus("Retrying " + (p.attempt || 1) + "/" + (p.maxAttempts || 3), "retrying");
        else if (k === "running") setStatus("Running", "running");
        else if (k === "thinking") setStatus("Thinking", "thinking");
        else if (k === "writing") setStatus("Writing", "writing");
        else if (k === "tool") setStatus("Tool call", "tool_call");
        else if (k === "compacting") setStatus("Compacting", "compacting");
        else if (k === "failed") setStatus("Failed", "failed");
      } else if (method === "session_meta") {
        if (p.model) wsModelId = String(p.model);
        if (typeof p.thinkingLevel === "string") thinkingOn = p.thinkingLevel !== "off";
        updateBar();
      } else if (method === "session_updated") {
        // Auto-generated title (and state) from the runtime: the CLI header
        // renames itself exactly like the app — unless the user renamed it.
        if (p.sessionKey === currentKey) {
          if (p.label && !titleLocked) setChatTitle(String(p.label));
          if (p.model) wsModelId = String(p.model);
          if (typeof p.thinkingLevel === "string") thinkingOn = p.thinkingLevel !== "off";
          updateBar();
        }
      } else if (method === "context_usage") {
        if (p.usage) {
          const u: any = p.usage;
          // Payload shape: {tokens, contextWindow, percent} (same source as the app).
          const tk = Number(u.tokens ?? (Number(u.input || 0) + Number(u.output || 0)));
          if (tk > 0) ctxTokens = tk;
          if (Number(u.contextWindow || 0) > 0) ctxWindow = Number(u.contextWindow);
          else {
            const mm = availableModels().find((x: any) => String(x?.id) === wsModelId);
            if (mm?.contextWindow) ctxWindow = Number(mm.contextWindow);
          }
          updateBar();
        }
      }
    } catch {}
  };
  sc.onEvent(onWsEvent);
  if (scOn) {
    setTimeout(() => {
      try {
        refreshSkillGroups();
        refreshSessions();
      } catch {}
    }, 1200);
    // Periodic refresh: chats deleted or renamed in the app disappear/appear here.
    setInterval(() => {
      try {
        refreshSessions();
      } catch {}
    }, 10000);
    // Engine watchdog: if the sidecar died (e.g. the app's quit watchdog kills
    // port 9182), bring it back up so the TUI never goes dead.
    setInterval(() => {
      try {
        if (!sc.connected) {
          spawnSidecar();
          void sc.connect(800).catch(() => {});
          if (streaming) {
            // Engine lost mid-turn: never leave the pill stuck on Running.
            streaming = false;
            setStatus("", "");
            try {
              ui.requestRender();
            } catch {}
          }
        }
      } catch {}
    }, 6000);
  }

  // --- slash commands -----------------------------------------------------------
  /** All chat messages saved on disk (the session jsonl files), oldest first. */
  const readSessionEntries = (): any[] => {
    const out: any[] = [];
    try {
      const files = fs.readdirSync(currentSessionDir).filter((f: string) => f.endsWith(".jsonl")).sort();
      for (const f of files) {
        let txt = "";
        try {
          // Huge sessions (tens of MB): read the TAIL only — instant open, last
          // messages (exactly what the app's getHistory shows), no UI freeze.
          const fp = path.join(currentSessionDir, f);
          const size = fs.statSync(fp).size;
          const MAX = 4 * 1024 * 1024;
          if (size > MAX) {
            const fd = fs.openSync(fp, "r");
            try {
              const buf = Buffer.alloc(MAX);
              fs.readSync(fd, buf, 0, MAX, size - MAX);
              txt = buf.toString("utf8");
              txt = txt.slice(txt.indexOf("\n") + 1); // drop the partial first line
            } finally {
              fs.closeSync(fd);
            }
          } else {
            txt = fs.readFileSync(fp, "utf8");
          }
        } catch {
          continue;
        }
        for (const line of txt.split("\n")) {
          if (!line.trim()) continue;
          try {
            const o = JSON.parse(line);
            if (o?.type === "message" && o?.message?.role) out.push({ kind: "message", message: o.message, id: o.id, pid: o.parentId, file: f });
            else if (o?.type === "compaction") out.push({ kind: "compaction", id: o.id, pid: o.parentId, file: f });
            else if (o?.type === "delegation" && o?.delegationData) out.push({ kind: "delegation", data: o.delegationData, id: o.id, pid: o.parentId, file: f });
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
      // The file is a TREE: the conversation order is the active branch (last
      // entry -> parents), exactly what the app shows. Flat order misorders.
      if (histMsgs) {
        // SERVER history (getHistory) — same rendering order as the app.
        for (const m of histMsgs) {
          if (m?.role === "user") {
            const t = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
            if (t.trim()) pushBlock(new UserBubble(t, fmtFooterDate(Number(m.timestamp) || Date.now())));
          } else if (m?.role === "tool_call" || m?.role === "toolCall") {
            let tcb = "";
            try {
              const ta = m.toolArgs ?? m.arguments ?? m.input ?? "";
              tcb = typeof ta === "string" ? ta : JSON.stringify(ta, null, 0) || "";
            } catch {}
            pushBlock(registerToggle(new ToggleBlock({ label: "Tool call", boldName: String(m.toolName || m.name || "tool"), color: C.toolCall, body: tcb })));
          } else if (m?.role === "tool_result") {
            pushBlock(registerToggle(new ToggleBlock({ label: m.isError ? "Tool error" : "Tool result", boldName: String(m.toolName || "tool"), color: m.isError ? C.danger : C.toolResult, body: String(m.content || "") })));
          } else if (m?.role === "delegation") {
            const tg = new ToggleBlock({ label: "Delegation to", boldName: String(m.agentName || ""), color: C.delegation, open: false });
            const task = String(m.delegatedMessage || "").trim();
            if (task) tg.children.push({ t: "bubble", v: task });
            try {
              for (const b of Array.isArray(m.content) ? m.content : []) {
                const blk: any = b || {};
                const bType = String(blk.type || "");
                const bToolName = blk.toolName || blk.name || blk.tool;
                // Raw blocks carry NO "type": detect by their fields (thinking/text/
                // tool args/tool result) — nothing may disappear or duplicate.
                if (bType === "thinking" || bType === "reasoning" || (typeof blk.thinking === "string" && !bToolName)) {
                  tg.children.push({ t: "toggle", v: new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, body: String(blk.thinking || blk.text || "") }) });
                } else if (bType === "toolResult" || blk.toolCallId || blk.isError !== undefined && blk.content !== undefined) {
                  const rb = typeof blk.content === "string" ? blk.content : Array.isArray(blk.content) ? blk.content.filter((x: any) => x?.type === "text" || typeof x?.text === "string").map((x: any) => x.text).join("\n") : "";
                  tg.children.push({ t: "toggle", v: new ToggleBlock({ label: blk.isError ? "Tool error" : "Tool result", boldName: String(bToolName || "tool"), color: blk.isError ? C.danger : C.toolResult, body: rb }) });
                } else if (bType === "toolCall" || bType === "tool_call" || (bToolName && (blk.toolArgs !== undefined || blk.arguments !== undefined || blk.args !== undefined))) {
                  let tb = "";
                  try {
                    const ta = blk.toolArgs ?? blk.arguments ?? blk.args ?? {};
                    tb = typeof ta === "string" ? ta : JSON.stringify(ta, null, 0) || "";
                  } catch {}
                  tg.children.push({ t: "toggle", v: new ToggleBlock({ label: "Tool call", boldName: String(bToolName || "tool"), color: C.toolCall, body: tb }) });
                } else if (bType === "text" || typeof blk.text === "string") {
                  tg.children.push({ t: "text", v: String(blk.text || "") });
                  // Footer right after the delegate's response — the SAME real
                  // per-message data as the chat (block timestamp, agent/model/level).
                  try {
                    const bts = Number(blk.timestamp) || Number(m.timestamp) || Date.now();
                    tg.children.push({
                      t: "footer",
                      date: fmtFooterDate(bts),
                      info: agentDisplayName(String(m.agentName || "")) + " \u00b7 " + String(m.agentModel || m.model || "") + " \u00b7 " + levelLabel(String(m.thinkingLevel || "off")),
                    });
                  } catch {}
                }
              }
            } catch {}
            try {
              const dts = Number(m.timestamp) || Date.now();
              tg._taskFooterDate = fmtFooterDate(dts);
              tg._taskFooterInfo = agentDisplayName(String(m.agentName || "")) + " \u00b7 " + String(m.agentModel || m.model || defaultModelId || "") + " \u00b7 " + levelLabel(String(m.thinkingLevel || "off"));
            } catch {}
            pushBlock(registerToggle(tg));
          } else if (m?.role === "assistant") {
            if (m?.reasoning) pushBlock(registerToggle(new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, body: String(m.reasoning) })));
            if (m?.isCompactionSummary) pushBlock(registerToggle(new ToggleBlock({ label: "Compaction", boldName: "effective", color: C.info })));
            // Content: a plain string OR blocks (text / toolCall / thinking) — the
            // app's own message format. Nothing may disappear.
            let txt = "";
            const pushToolCall = (name: string, args: any) => {
              let tb = "";
              try {
                tb = JSON.stringify(args || {}, null, 0) || "";
              } catch {}
              pushBlock(registerToggle(new ToggleBlock({ label: "Tool call", boldName: String(name || "tool"), color: C.toolCall, body: tb })));
            };
            if (typeof m.content === "string") {
              txt = m.content;
            } else if (Array.isArray(m.content)) {
              for (const b of m.content) {
                if (b?.type === "text") txt += String(b.text || "");
                else if (b?.type === "thinking" || b?.type === "reasoning") pushBlock(registerToggle(new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, body: String(b.thinking || b.text || "") })));
                else if (b?.type === "toolCall" || b?.type === "tool_call" || b?.type === "toolCallStart") pushToolCall(b.name || b.toolName, b.arguments || b.args);
                else if (b?.type === "toolResult" || b?.type === "tool_result") {
                  const rb = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
                  pushBlock(registerToggle(new ToggleBlock({ label: b.isError ? "Tool error" : "Tool result", boldName: String(b.toolName || b.name || "tool"), color: b.isError ? C.danger : C.toolResult, body: rb })));
                }
              }
            }
            if (Array.isArray(m.toolCalls)) {
              for (const tc of m.toolCalls) pushToolCall(tc?.name || tc?.toolName, tc?.arguments || tc?.args || tc?.input);
            }
            if (txt.trim()) {
              pushBlock(new Markdown(txt, 1, 0, mdTheme));
              // Agent: the message's own, else the session's PRIMARY agent
              // (orchestrator wins when present — same rule as the engine).
              let an = String(m.agentName || "");
              try {
                if (!an) {
                  const e0 = readSessionsList().find((x: any) => x?.key === currentKey);
                  const mid = String(m.id || "");
                  const mts = Number(m.timestamp) || 0;
                  const mk = mid && e0?.messageAgents?.[mid] ? mid : mts ? "ts-" + mts : "";
                  if (mk && e0?.messageAgents?.[mk]) an = String(e0.messageAgents[mk]);
                }
              } catch {}
              if (!an) {
                const ids = sessionAgentIds();
                an = ids.find((x) => x === "orchestrator") || ids[0] || "quinki";
              }
              pushBlock(new FooterRow(fmtFooterDate(Number(m.timestamp) || Date.now()), agentDisplayName(an) + " \u00b7 " + String(m.model || defaultModelId || "") + " \u00b7 " + levelLabel(String(m.thinkingLevel || "off")), true));
            }
          }
        }
        scrollToEnd();
        return;
      }
      const allEntries = readSessionEntries() as any[];
      if (allEntries.length === 0) {
        // Nothing readable: keep the current transcript (never wipe the chat).
        scrollToEnd();
        return;
      }
      // FLAT like the app, with the app's window: the last histLimit messages
      // (50 at open; scrolling up loads more — see the PgUp handler).
      let cutIdx = 0;
      {
        let seen = 0;
        for (let i = allEntries.length - 1; i >= 0; i--) {
          if (allEntries[i]?.kind === "message" || allEntries[i]?.message) {
            seen++;
            if (seen >= histLimit) {
              cutIdx = i;
              break;
            }
          }
        }
      }
      const all = cutIdx > 0 ? allEntries.slice(cutIdx) : allEntries;
      for (const en of all) {
        if (en.kind === "compaction") {
          // File compactions are always REAL (noop ones never reach the file).
          pushBlock(registerToggle(new ToggleBlock({ label: "Compaction", boldName: "effective", color: C.info })));
          continue;
        }
        if (en.kind === "delegation") {
          // Delegation entry: "Delegation to <agent>" CLOSED, with the whole
          // mini-chat inside (task bubble + thinking/text/tools of the delegate).
          const dd: any = en.data || {};
          const tg = new ToggleBlock({ label: "Delegation to", boldName: String(dd.agentName || ""), color: C.delegation, open: false });
          const task = String(dd.delegatedMessage || "").trim();
          if (task) tg.children.push({ t: "bubble", v: task });
          try {
            for (const b of Array.isArray(dd.content) ? dd.content : []) {
              if (b?.type === "thinking" || b?.type === "reasoning") {
                tg.children.push({ t: "toggle", v: new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, body: String(b.thinking || b.text || "") }) });
              } else if (b?.type === "text") {
                tg.children.push({ t: "text", v: String(b.text || "") });
              } else if (b?.type === "toolCall") {
                let tb = "";
                try {
                  tb = JSON.stringify(b.arguments || {}, null, 0) || "";
                } catch {}
                tg.children.push({ t: "toggle", v: new ToggleBlock({ label: "Tool call", boldName: String(b.name || b.toolName || "tool"), color: C.toolCall, body: tb }) });
              } else if (b?.type === "toolResult") {
                let rb = "";
                try {
                  rb = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
                } catch {}
                tg.children.push({ t: "toggle", v: new ToggleBlock({ label: b.isError ? "Tool error" : "Tool result", boldName: String(b.toolName || b.name || "tool"), color: b.isError ? C.danger : C.toolResult, body: rb }) });
              }
            }
          } catch {}
          pushBlock(registerToggle(tg));
          continue;
        }
        const m = en.message;
        if (m.role === "user") {
          let t = "";
          const c = m.content;
          if (typeof c === "string") t = c;
          else if (Array.isArray(c)) t = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
          if (t.trim()) pushBlock(new UserBubble(t, fmtFooterDate(Date.parse(m.timestamp || "") || Date.now())));
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
                registerToggle(new ToggleBlock({ label: "Tool call", boldName: nm, color: C.toolCall, body }))
              );
            }
          }
          if (text.trim()) {
            pushBlock(new Markdown(text, 1, 0, mdTheme));
            // Footer persisted from the file: date from the message timestamp,
            // agent/model/level from the entry (same source as the app).
            try {
              const e0 = readSessionsList().find((s: any) => s?.key === currentKey);
              let an = sessionAgentIds()[0] || "quinki";
              let lv = "off";
              const mid = String(m.id || "");
              const mts = Date.parse(m.timestamp || "") || 0;
              const mk = mid && e0?.messageAgents?.[mid] ? mid : mts ? "ts-" + mts : "";
              if (mk && e0?.messageAgents?.[mk]) an = String(e0.messageAgents[mk]);
              if (mk && e0?.messageThinking?.[mk]) lv = String(e0.messageThinking[mk]);
              pushBlock(
                new FooterRow(
                  fmtFooterDate(mts || Date.now()),
                  agentDisplayName(an) + " \u00b7 " + String(e0?.model || wsModelId || defaultModelId || "") + " \u00b7 " + levelLabel(lv),
                  true
                )
              );
            } catch {}
          }
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
      const realDir = o.newSessionDir || currentSessionDir;
      const dir = path.join(os.tmpdir(), "quinki-cli-local", path.basename(realDir) + "-" + Date.now().toString(36));
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
      currentSessionDir = realDir;
      try {
        fs.mkdirSync(realDir, { recursive: true });
      } catch {}
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
      // Real context of the opened chat (persistent %, like the app).
      try {
        void sc
          .call("getContextUsage", { sessionKey: currentKey }, 15000)
          .then((r: any) => {
            const u = r?.usage || {};
            ctxTokens = Number(u.tokens ?? 0);
            if (Number(u.contextWindow || 0) > 0) ctxWindow = Number(u.contextWindow);
            try {
              ui.requestRender();
            } catch {}
          })
          .catch(() => {});
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
          if (e2?.mode === "plan" || e2?.mode === "build") {
            mode = e2.mode; // per-chat mode, exactly like the app
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
        histMsgs = null;
        ctxTokens = 0;
        ctxWindow = 0;
        welcomeShown = true;
        applyLayout(true);
      } else {
        histMsgs = null;
        void loadServerHistory().then(() => {
          try {
            if (histMsgs && histMsgs.length && welcomeShown) {
              welcomeShown = false;
              applyLayout(false);
            }
            renderHistory();
            // ALWAYS end at the last message: once now, once after the layout
            // settles (the async load can land after the first pin).
            scrollToEnd();
            setTimeout(() => {
              try {
                scrollToEnd();
                ui.requestRender();
              } catch {}
            }, 250);
          } catch {}
        });
        // Empty target chat (New chat, /delete, empty switch): land on the HOME
        // screen — the welcome composer — exactly like opening the TUI.
        const hasMsgs = readSessionEntries().some((en: any) => en?.kind === "message" || en?.message);
        if (!hasMsgs) {
          renderHistory(); // clears the old transcript
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
        if (scOn) {
          thinkingExplicit = true;
          void sc.call("setThinking", { sessionKey: currentKey, thinkingLevel: thinkingOn ? "xhigh" : "off" }, 20000).catch(() => {});
          break;
        }
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
          // FULL export like the app: user messages, assistant text, thinking,
          // tool calls, tool results, delegations (agent + task + inner chat),
          // compactions — everything that is inside the conversation.
          const out: string[] = ["# Quinki chat", ""];
          for (const en of readSessionEntries()) {
            if (en.kind === "compaction") {
              out.push("---", "*Compaction*", "");
              continue;
            }
            if (en.kind === "delegation") {
              const dd: any = en.data || {};
              out.push("### Delegation to " + String(dd.agentName || ""), "");
              out.push("**Task:** " + String(dd.delegatedMessage || ""), "");
              try {
                for (const b of Array.isArray(dd.content) ? dd.content : []) {
                  if (b?.type === "thinking" || b?.type === "reasoning") out.push(String(b.thinking || b.text || ""), "");
                  else if (b?.type === "text") out.push(String(b.text || ""), "");
                  else if (b?.type === "toolCall") {
                    let j = "";
                    try {
                      j = JSON.stringify(b.arguments || {}, null, 2);
                    } catch {}
                    out.push("**Tool call \u00b7 " + String(b.name || b.toolName || "tool") + "**", "```json", j, "```", "");
                  } else if (b?.type === "toolResult") {
                    const rb = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
                    out.push("**" + (b.isError ? "Tool error" : "Tool result") + " \u00b7 " + String(b.toolName || b.name || "tool") + "**", rb, "");
                  }
                }
              } catch {}
              continue;
            }
            const m = en.message;
            if (m.role === "user") {
              const c = m.content;
              const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "";
              if (t.trim()) out.push("## You", "", t, "");
            } else if (m.role === "toolResult") {
              const rb = typeof m.content === "string" ? m.content : Array.isArray(m.content) ? m.content.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
              out.push("**" + (m.isError ? "Tool error" : "Tool result") + " \u00b7 " + String(m.toolName || "tool") + "**", rb, "");
            } else if (m.role === "assistant") {
              const c = m.content;
              if (typeof c === "string") {
                if (c.trim()) out.push("## Quinki", "", c, "");
              } else if (Array.isArray(c)) {
                for (const b of c) {
                  if (b?.type === "thinking" || b?.type === "reasoning") out.push(String(b.thinking || b.text || ""), "");
                  else if (b?.type === "text") out.push(String(b.text || ""), "");
                  else if (b?.type === "toolCall") {
                    let j = "";
                    try {
                      j = JSON.stringify(b.arguments || {}, null, 2);
                    } catch {}
                    out.push("**Tool call \u00b7 " + String(b.name || b.toolName || "tool") + "**", "```json", j, "```", "");
                  }
                }
              }
            }
          }
          // Native "save as" dialog, then NOTHING in the chat: the dialog itself
          // is the feedback. Default location: Downloads.
          const defName = `quinki-chat-${Date.now().toString(36)}.md`;
          let target = "";
          try {
            if (process.platform === "darwin") {
              const r = execSync(
                `osascript -e 'POSIX path of (choose file name with prompt "Export chat" default name "${defName}" default location (path to downloads folder))'`,
                { stdio: ["ignore", "pipe", "ignore"] }
              )
                .toString()
                .trim();
              if (r) target = r;
            } else if (process.platform === "linux") {
              const r = execSync(`zenity --file-selection --save --filename="$HOME/Downloads/${defName}"`, {
                stdio: ["ignore", "pipe", "ignore"],
              })
                .toString()
                .trim();
              if (r) target = r;
            }
          } catch (e: any) {
            // Distinguish CANCEL (write NOTHING) from dialog unavailable (fallback).
            const msg = String(e?.stderr || e?.message || "");
            if (/user canceled|User canceled|-128/i.test(msg)) target = "__cancel__";
          }
          if (target === "__cancel__") break;
          if (!target) target = path.join(os.homedir(), "Downloads", defName);
          fs.writeFileSync(target, out.join("\n"), "utf8");
        } catch {}
        break;
      }
      case "model": {
        if (!arg) break;
        if (scOn) {
          wsModelId = arg;
          modelExplicit = true;
          void sc.call("setModel", { sessionKey: currentKey, model: arg }, 60000).catch(() => {});
          break;
        }
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
        if (scOn) {
          void sc.call("resetSession", { sessionKey: currentKey }, 60000).catch(() => {});
          void recreateSession({});
          break;
        }
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
        if (scOn) {
          // Live path: the skill rides the NEXT message (the app's chip flow).
          // The engine injects it into the system prompt, one-shot.
          pendingSkills.push(arg);
          addRow(fg(C.primary, "\u25b8 skill armed \u00b7 " + arg + " \u00b7 sent with your next message"));
          refreshSkillGroups();
          break;
        }
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
        if (arg === "__new__") {
          // Fresh conversation: brand-new cli session, welcome composer back —
          // with the DEFAULT parameters (mode/thinking/model are NOT inherited).
          const nk = "cli-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          try {
            const st = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "settings.json"), "utf8")) || {};
            mode = st.defaultMode === "build" ? "build" : "plan";
            thinkingOn = String(st.defaultThinking || "xhigh") !== "off";
          } catch {}
          modelExplicit = false;
          thinkingExplicit = false;
          wsModelId = "";
          void recreateSession({ newSessionDir: path.join(opts.sessionDir, nk), newKey: nk });
          break;
        }
        const sdir = path.join(opts.agentDir, "sessions", "quinki");
        const target = path.join(sdir, arg);
        if (!fs.existsSync(target)) break;
        void recreateSession({ newSessionDir: target, newKey: arg });
        break;
      }
      case "rename": {
        if (!arg) break;
        titleLocked = true; // no auto-title may overwrite the user's rename
        if (scOn) void sc.call("renameSession", { sessionKey: currentKey, label: arg }, 20000).catch(() => {});
        // Anti-loss store the runtime itself honours (chat-meta.json): survives
        // worker auto-title, reinstalls and shared-file overwrites.
        try {
          const mp = path.join(opts.agentDir, "chat-meta.json");
          let meta: any = {};
          try {
            meta = JSON.parse(fs.readFileSync(mp, "utf8")) || {};
          } catch {}
          meta[currentKey] = { ...(meta[currentKey] || {}), label: arg };
          fs.writeFileSync(mp, JSON.stringify(meta, null, 2), "utf8");
        } catch {}
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
      case "delete": {
        if (arg !== "confirm" || welcomeShown) break;
        const dk = currentKey;
        if (scOn) void sc.call("deleteSession", { sessionKey: dk }, 30000).catch(() => {});
        try {
          writeSessionsList(readSessionsList().filter((s: any) => s?.key !== dk));
        } catch {}
        try {
          fs.rmSync(path.join(opts.sessionDir, dk), { recursive: true, force: true });
        } catch {}
        // Land on a fresh welcome chat.
        const nk = "cli-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        void recreateSession({ newSessionDir: path.join(opts.sessionDir, nk), newKey: nk });
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
  // --- /agent menu (levels) ----------------------------------------------------
  const agentMenuItems = (): any[] => {
    const ids = sessionAgentIds();
    const ovs = sessionAgentOverrides();
    const out: any[] = [{ value: "#add", label: "Add agent", description: "Add an agent to this chat" }];
    if (!ids.includes("orchestrator")) {
      out.push({
        value: "#orch",
        label: "Add orchestrator",
        description: "A single agent that orchestrates the others",
      });
    }
    out.push({ value: "__sep_in_session", label: "Agents in this session", separator: true });
    for (const id of ids) {
      const ov = ovs[id] || {};
      const bits: string[] = [];
      if (id !== "orchestrator") {
        bits.push(ov.model ? String(ov.model) : "Chat default");
        bits.push(
          ov.thinkingLevel
            ? ov.thinkingLevel === "off"
              ? "Off"
              : ov.thinkingLevel === "on"
                ? "On"
                : String(ov.thinkingLevel)
            : "Chat default"
        );
      }
      out.push({ value: id, label: agentDisplayName(id), description: bits.join(" \u00b7 ") });
    }
    return out;
  };
  const agentLevelItems = (stack: string[]): any[] => {
    if (stack.length <= 1) return agentMenuItems();
    const ids = sessionAgentIds();
    if (stack[1] === "#add") {
      const out: any[] = [];
      for (const id of agentIdsKnown()) {
        if (id === "orchestrator" || ids.includes(id)) continue;
        const cfg = agentConfigOf(id);
        const bits: string[] = [];
        if (cfg?.model) bits.push(String(cfg.model));
        if (cfg?.thinkingLevel) bits.push("thinking " + String(cfg.thinkingLevel));
        const nSk = Array.isArray(cfg?.skills) ? cfg.skills.length : 0;
        if (nSk) bits.push(nSk + " skill" + (nSk === 1 ? "" : "s"));
        out.push({ value: id, label: agentDisplayName(id), description: bits.join(" \u00b7 ") });
      }
      return out;
    }
    const agentId = stack[1];
    const ov = sessionAgentOverrides()[agentId] || {};
    if (stack.length === 2) {
      const out: any[] = [];
      if (agentId !== "orchestrator") {
        out.push({ value: "model", label: "Model", description: ov.model ? String(ov.model) : "Chat default" });
        out.push({
          value: "thinking",
          label: "Thinking",
          description: ov.thinkingLevel
            ? ov.thinkingLevel === "off"
              ? "Off"
              : ov.thinkingLevel === "on"
                ? "On"
                : String(ov.thinkingLevel)
            : "Chat default",
        });
      }
      out.push({ value: "config", label: "Agent configuration", description: "Prompt, skills, files" });
      out.push({ value: "remove", label: "Remove agent", description: "" });
      return out;
    }
    const lv3 = stack[2];
    if (lv3 === "model") {
      const out: any[] = [
        { value: "__chat_default__", label: "Chat default", description: ov.model ? "Use the chat model" : "current" },
      ];
      let models: any[] = [];
      try {
        models = availableModels();
      } catch {}
      let lastProv = "";
      for (const m of models) {
        const prov = String(m?.provider || "");
        if (prov && prov !== lastProv) {
          out.push({ value: "__sep_prov_" + prov, label: prov, separator: true });
          lastProv = prov;
        }
        const cur = !!ov.model && String(ov.model) === String(m?.id);
        out.push({
          value: String(m?.id || ""),
          label: String(m?.name || m?.id || ""),
          description: (cur ? "current \u00b7 " : "") + prov,
        });
      }
      return out;
    }
    if (lv3 === "thinking") {
      const cur = String(ov.thinkingLevel || "");
      return [
        { value: "__chat_default__", label: "Chat default", description: cur === "" ? "current" : "Use the chat setting" },
        { value: "on", label: "On", description: cur === "on" ? "current" : "Default thinking level" },
        { value: "off", label: "Off", description: cur === "off" ? "current" : "Thinking disabled" },
      ];
    }
    return [];
  };
  const addAgentToSession = (id: string) => {
    if (scOn) {
      // Live path: the sidecar updates its memory AND the session entry.
      const ids = sessionAgentIds();
      if (!ids.includes(id)) ids.push(id);
      void sc.call("setChatAgents", { sessionKey: currentKey, agentIds: ids.join(",") }, 20000).catch(() => {});
      return;
    }
    mutateSessionEntry((e: any) => {
      const ids = String(e.agentId || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const base = ids.length ? ids : [DEFAULT_CHAT_AGENT];
      if (!base.includes(id)) base.push(id);
      e.agentId = base.join(",");
    });
  };
  const removeAgentFromSession = (id: string) => {
    if (scOn) {
      const ids = sessionAgentIds().filter((x: string) => x !== id);
      void sc.call("setChatAgents", { sessionKey: currentKey, agentIds: ids.join(",") }, 20000).catch(() => {});
      return;
    }
    mutateSessionEntry((e: any) => {
      const ids = String(e.agentId || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const base = ids.length ? ids : [DEFAULT_CHAT_AGENT];
      if (base.length <= 1) return; // guard: a chat always has at least one agent
      e.agentId = base.filter((x: string) => x !== id).join(",");
      if (e.agentOverrides && e.agentOverrides[id]) delete e.agentOverrides[id];
    });
  };
  const agentLevelFor = (it: any): string | null => {
    const stack = menuStack;
    if (stack.length === 1) {
      if (it.value === "#add") return "#add";
      if (it.value === "#orch") return null; // direct action
      return String(it.value);
    }
    if (stack.length === 2 && stack[1] === "#add") return null; // direct action
    if (stack.length === 2) {
      if (it.value === "model" || it.value === "thinking") return String(it.value);
      return null;
    }
    return null;
  };
  const agentActivate = (value: string) => {
    const stack = [...menuStack];
    if (stack.length === 1) {
      if (value === "#add") {
        menuStack = ["agentinsession", "#add"];
      } else if (value === "#orch") {
        addAgentToSession("orchestrator");
      } else {
        menuStack = ["agentinsession", value];
      }
      menuSubFilter = "";
      menuSel = 0;
      return;
    }
    if (stack.length === 2 && stack[1] === "#add") {
      // Added: back to the previous menu, where the agent now appears.
      addAgentToSession(value);
      menuStack = ["agentinsession"];
      menuSubFilter = "";
      menuSel = 0;
      return;
    }
    if (stack.length === 2) {
      const agentId = stack[1];
      if (value === "remove") {
        // Executed only with Confirm lit (mandatory pass — no double confirm).
        if (sessionAgentIds().length <= 1) {
          // Error INSIDE the slash menu: never in the chat (context pollution).
          menuError = "A chat must have at least one agent. You can add more, but you cannot remove the last one.";
          menuConfirmFocus = true;
        } else {
          removeAgentFromSession(agentId);
          menuStack = ["agentinsession"]; // back to the agents-in-this-chat list
        }
        menuSel = 0;
        menuSubFilter = "";
        return;
      }
      if (value === "model" || value === "thinking") {
        menuStack = ["agentinsession", agentId, value];
        menuSubFilter = "";
        menuSel = 0;
      }
      // "config": agent configuration menu — staged, silently ignored for now.
      return;
    }
    if (stack.length === 3) {
      const agentId = stack[1];
      const lv3 = stack[2];
      if (lv3 === "remove") {
        removeAgentFromSession(agentId);
        menuStack = ["agentinsession"];
      } else if (lv3 === "model") {
        if (scOn) {
          void sc
            .call("setAgentOverride", { sessionKey: currentKey, agentId, model: value === "__chat_default__" ? null : value }, 20000)
            .catch(() => {});
        }
        mutateSessionEntry((e: any) => {
          if (!e.agentOverrides) e.agentOverrides = {};
          const o = e.agentOverrides[agentId] || {};
          if (value === "__chat_default__") delete o.model;
          else o.model = value;
          if (!o.model && !o.thinkingLevel) delete e.agentOverrides[agentId];
          else e.agentOverrides[agentId] = o;
        });
        menuStack = ["agentinsession", agentId];
      } else if (lv3 === "thinking") {
        if (scOn) {
          void sc
            .call("setAgentOverride", { sessionKey: currentKey, agentId, thinkingLevel: value === "__chat_default__" ? null : value }, 20000)
            .catch(() => {});
        }
        mutateSessionEntry((e: any) => {
          if (!e.agentOverrides) e.agentOverrides = {};
          const o = e.agentOverrides[agentId] || {};
          if (value === "__chat_default__") delete o.thinkingLevel;
          else o.thinkingLevel = value;
          if (!o.model && !o.thinkingLevel) delete e.agentOverrides[agentId];
          else e.agentOverrides[agentId] = o;
        });
        menuStack = ["agentinsession", agentId];
      } else {
        menuStack = ["agentinsession", agentId];
      }
      menuSubFilter = "";
      menuSel = 0;
      menuConfirmFocus = false;
      return;
    }
  };
  const levelItems = (stack: string[]): any[] => {
    if (stack.length === 0) return mainItems();
    if (stack[0] === "agentinsession") return agentLevelItems(stack);
    if (stack[0] === "settings") return settingsLevelItems(stack);
    const cmd: any = commands.find((c) => c.name === stack[0]);
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
  const applyFilter = (items: any[]): any[] => {
    const f = menuSubFilter.toLowerCase();
    if (!f) return items;
    return items.filter(
      (i: any) =>
        !i.separator &&
        (String(i.value ?? "").toLowerCase().startsWith(f) || String(i.label ?? "").toLowerCase().startsWith(f))
    );
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
    if (menuStack.length > 0) return true;
    return editorText().startsWith("/");
  };
  const menuNav = (a: "up" | "down" | "left" | "right" | "enter" | "escape" | "select") => {

    if (a === "select") {

      try {
        const its: any = menuItemsCache || [];
        const it: any = its[menuSel];
        const inModels = menuStack[0] === "settings" && menuStack[3] === "models";
        const inFallbacks = menuStack[0] === "settings" && menuStack[1] === "defaults" && menuStack[2] === "fallbacks";
        const inProviders = menuStack[0] === "settings" && menuStack[1] === "providers" && !menuStack[2];
        if (inProviders) {
          // INSTANT toggle of the provider under the cursor (no Confirm).
          const v = String(it?.value || "");
          if (v.startsWith("prov:")) { const nm = v.slice(5); patchProvider(nm, (pp) => { pp.enabled = !pp.enabled; }); }
        } else if (inModels) {
          settingsActivate(String(it?.value || ""));
        } else if (inFallbacks && it && !it.separator) {
          const v = String(it.value || "");
          if (menuMarked.has(v)) menuMarked.delete(v); else menuMarked.add(v);
        }
      } catch {}
      try { ui.requestRender(); } catch {}
      return;
    }
    try {
      if (!menuOpen()) return;
      // A menu error is showing: any key dismisses it and brings back the menu.
      if (menuError) {
        menuError = "";
        try {
          ui.requestRender();
        } catch {}
        return;
      }
      // Some terminals deliver ONE key press as MULTIPLE events (press + release
      // echo, both recognized). Collapse identical navigations arriving within
      // 40ms: one press always means exactly one step (human repeats are slower).
      if (a !== "enter" && a !== "escape") {
        const now = Date.now();
        if (a === lastNavA && now - lastNavT < 40) return;
        lastNavA = a;
        lastNavT = now;
      }
      const items = applyFilter(levelItems(menuStack));
      const stepSel = (from: number, dir: number): number => {
        let i = from;
        for (let n = 0; n < items.length; n++) {
          i = (i + dir + items.length) % items.length;
          if (!(items[i] as any)?.separator) return i;
        }
        return from;
      };
      if (a === "escape") {
        if (menuError) {
          // Dismiss the error: back to the menu you came from.
          menuError = "";
          try {
            ui.requestRender();
          } catch {}
          return;
        }
        // Esc closes the WHOLE slash menu instantly (one press, from any level).
        menuStack = [];
        menuSubFilter = "";
        menuSel = 0;
        menuConfirmFocus = false;
        try {
          editor.setText("");
        } catch {}
      } else if (a === "up") {
        // Wrap-around like the app; separator rows are skipped.
        menuConfirmFocus = false;
        if (items.length > 0) menuSel = stepSel(menuSel, -1);
      } else if (a === "down") {
        menuConfirmFocus = false;
        if (items.length > 0) menuSel = stepSel(menuSel, 1);
      } else if (a === "left") {
          // /settings: left goes back one level (Esc closes the whole menu).
          if (menuStack[0] === "settings" && menuStack.length > 1) {
            menuStack.pop();
            menuSubFilter = "";
            menuSel = 0;
            menuConfirmFocus = false;
            try { ui.requestRender(); } catch {}
            return;
          }
        if (menuConfirmFocus) {
          // Confirm is treated as the LAST level: ← goes back to the options
          // of the menu you are in (they light up again).
          menuConfirmFocus = false;
        } else if (menuStack.length > 0) {
          menuStack.pop();
          menuSubFilter = "";
          menuSel = 0;
        }
      } else if (a === "right") {
        // Forward ONLY — it NEVER executes. At the end of the levels it FOCUSES
        // Confirm (violet filled, like the app's NavBar focusConfirm); Enter runs.
        if (menuConfirmFocus) {
          // Already focused: stays lit (Enter confirms).
        } else if (menuStack.length > 0) {
          const it: any = items[menuSel];
          if (it && !it.separator) {
            // ONLY the agent menu has deeper levels. Every other submenu is a
            // terminal list: → must light the Confirm directly, never push a
            // ghost level out of the item value.
            const deeper = menuStack[0] === "agentinsession" ? agentLevelFor(it) : (menuStack[0] === "settings" ? settingsDeeper(it) : null);
            if (deeper) {
              menuStack.push(deeper);
              menuSubFilter = "";
              menuSel = 0;
              // entering the fallbacks editor: seed the selection with the saved ones
              try {
                if (deeper === "fallbacks") {
                  const cur = (() => { try { const ff = readSettingsFile().defaultFallbackModels; if (Array.isArray(ff)) return ff; } catch {} return []; })();
                  menuMarked = new Set<string>(cur.map((x: any) => String(x)));
                } else {
                  menuMarked = new Set<string>();
                }
              } catch {}
            } else {
              menuConfirmFocus = true; // option = terminal level
            }
          }
        } else {
          const it: any = items[menuSel];
          const cmd: any = it ? commands.find((c) => c.name === it.value) : null;
          if (cmd && typeof cmd.getArgumentCompletions === "function") {
            menuStack = [cmd.name];
            menuSubFilter = "";
            menuSel = 0;
          } else if (cmd) {
            menuConfirmFocus = true; // command without options: end of the road
          }
        }
      } else {
        // enter — app rules: Enter NEVER confirms directly. On a terminal option
        // the first Enter (or →) only LIGHTS the Confirm button; a second Enter,
        // with Confirm lit, executes. Opening a submenu is navigation, not a
        // confirmation, so that still happens on the first Enter.
        const it: any = items[menuSel];
        if (!menuConfirmFocus) {
          if (!it || it.separator) return;
          if (menuStack[0] === "settings") {
            const deeper = settingsDeeper(it);
            if (deeper) {
              menuStack.push(deeper);
              menuSubFilter = "";
              menuSel = 0;
              // entering the fallbacks editor: seed the selection with the saved ones
              try {
                if (deeper === "fallbacks") {
                  const cur = (() => { try { const ff = readSettingsFile().defaultFallbackModels; if (Array.isArray(ff)) return ff; } catch {} return []; })();
                  menuMarked = new Set<string>(cur.map((x: any) => String(x)));
                } else {
                  menuMarked = new Set<string>();
                }
              } catch {}
            } else {
              menuConfirmFocus = true; // terminal option: light the Confirm
            }
            try { ui.requestRender(); } catch {}
            return;
          } else if (menuStack[0] === "agentinsession") {
            const deeper = agentLevelFor(it);
            if (deeper) {
              menuStack.push(deeper);
              menuSubFilter = "";
              menuSel = 0;
              // entering the fallbacks editor: seed the selection with the saved ones
              try {
                if (deeper === "fallbacks") {
                  const cur = (() => { try { const ff = readSettingsFile().defaultFallbackModels; if (Array.isArray(ff)) return ff; } catch {} return []; })();
                  menuMarked = new Set<string>(cur.map((x: any) => String(x)));
                } else {
                  menuMarked = new Set<string>();
                }
              } catch {}
            } else {
              menuConfirmFocus = true; // Confirm lights: Enter again executes
            }
          } else if (menuStack.length > 0) {
            menuConfirmFocus = true; // terminal option of a submenu
          } else {
            const cmd: any = commands.find((c) => c.name === it.value);
            if (cmd && typeof cmd.getArgumentCompletions === "function") {
              menuStack = [cmd.name];
              menuSubFilter = "";
              menuSel = 0;
              if (cmd.name === "settings") { try { fetchSettings(); fetchAllModels(); } catch {} }
            } else if (cmd) {
              menuConfirmFocus = true; // no options: Confirm first, then run
            }
          }
        } else {
          // Confirm is LIT: this Enter executes the selection.
          menuConfirmFocus = false;
          if (!it || it.separator) return;
          if (menuStack[0] === "settings") {
            // Providers list: Confirm = toggle every marked provider at once.
            if (menuStack[1] === "providers" && !menuStack[2] && menuMarked.size > 0) {
              const names = Array.from(menuMarked).filter((v: string) => v.startsWith("prov:")).map((v: string) => v.slice(5));
              for (const nm of names) { patchProvider(nm, (p) => { p.enabled = !p.enabled; }); }
              menuMarked.clear();
              try { ui.requestRender(); } catch {}
              return;
            }
            // Fallbacks editor: Confirm = save the selection ORDER as the fallbacks.
            if (menuStack[1] === "defaults" && menuStack[2] === "fallbacks") {
              const order = Array.from(menuMarked);
              try { void sc.call('setDefaultFallbacks', { defaultFallbackModels: order }, 20000).catch(() => {}); } catch {}
              try { wsSettings = { ...(wsSettings || {}), defaultFallbackModels: order }; } catch {}
              try { ui.requestRender(); } catch {}
              return;
            }
            settingsActivate(String(it.value));
            try { ui.requestRender(); } catch {}
            return;
          } else if (menuStack[0] === "agentinsession") {
            // The agent menus NEVER close: every action returns to its parent level.
            agentActivate(String(it.value));
          } else if (menuStack.length > 0) {
            const cmdName = menuStack[0];
            menuStack = [];
            menuSubFilter = "";
            menuSel = 0;
            try {
              editor.setText("");
            } catch {}
            handleSlashRef?.("/" + cmdName + " " + String(it.value ?? it.label ?? ""));
          } else {
            const cmd: any = commands.find((c) => c.name === it.value);
            if (cmd) {
              try {
                editor.setText("");
              } catch {}
              menuSel = 0;
              handleSlashRef?.("/" + cmd.name);
            }
          }
        }
      }
      try {
        ui.requestRender();
      } catch {}
    } catch {}
  };
  const modelPickerItemsList = (): any[] => {
    const out: any[] = [];
    let models: any[] = [];
    try { models = availableModels(); } catch {}
    let lastProv = "";
    for (const mm of models) {
      const prov = String(mm?.provider || "");
      if (prov && prov !== lastProv) { out.push({ value: "__sep_m_" + prov, label: prov, description: "", separator: true }); lastProv = prov; }
      out.push({ value: String(mm?.id || ""), label: String(mm?.id || ""), description: String(mm?.name || "") });
    }
    return out;
  };

  const modelPickerItems = (currentDefault: string = "", currentFallbacks: string[] = []): any[] => {
    const out: any[] = [];
    let models: any[] = [];
    try { models = availableModels(); } catch {}
    let lastProv = "";
    for (const mm of models) {
      const prov = String(mm?.provider || "");
      if (prov && prov !== lastProv) { out.push({ value: "__sep_m_" + prov, label: prov, description: "", separator: true }); lastProv = prov; }
      const id = String(mm?.id || "");
      const marks: string[] = [];
      if (currentDefault && id === currentDefault) marks.push("default");
      if (currentFallbacks.some((f: any) => String(f) === id)) marks.push("fallback");
      out.push({ value: id, label: id, description: (marks.length ? marks.join(" \u00b7 ") + " \u00b7 " : "") + String(mm?.name || "") });
    }
    return out;
  };
  let wsProviderModels: Record<string, any[]> = {};
  let wsProviderAt: Record<string, number> = {};
  const fetchProviderCatalog = (name: string, baseUrl: string, apiKey: string) => {
    try {
      if (!name) return;
      if (Date.now() - (wsProviderAt[name] || 0) < 30000 && (wsProviderModels[name] || []).length > 0) return;
      wsProviderAt[name] = Date.now();
      void sc.call('fetchProviderModels', { providerName: name, baseUrl: baseUrl || '', apiKey: apiKey || '' }, 45000).then((r: any) => {
        const list = Array.isArray(r) ? r : (Array.isArray(r?.models) ? r.models : ((r && r.data && Array.isArray(r.data)) ? r.data : []));
        if (list.length > 0) { wsProviderModels[name] = list.map((x: any) => (typeof x === 'string' ? { id: x } : x)); try { ui.requestRender(); } catch {} }
      }).catch(() => {});
    } catch {}
  };

  let wsAllModels: any[] = [];
  let wsAllModelsAt = 0;
  const fetchAllModels = (force: boolean = false) => {
    if (!force && Date.now() - wsAllModelsAt < 30000 && wsAllModels.length > 0) return;
    wsAllModelsAt = Date.now();
    void sc.call('getModels', {}, 30000).then((r: any) => {
      if (Array.isArray(r?.models)) { wsAllModels = r.models; try { ui.requestRender(); } catch {} }
    }).catch(() => {});
  };

  let addProvStep = 0;
  let addProvTmp: any = { name: "", baseUrl: "" };

  const settingsDeeper = (it: any): string | null => {
  const lv = menuStack[1] || "", sub = menuStack[2] || "", sub3 = menuStack[3] || "";
  const v = String(it?.value || "");
  if (!lv) return ["defaults", "shortcuts", "attachments", "providers", "version"].includes(v) ? v : null;
  if (lv === "defaults" && !sub) return (v === "model" || v === "fallbacks") ? v : null;
  if (lv === "defaults" && sub === "fallbacks" && v === "__addfallback") return "addfallback";
  if (lv === "providers" && !sub) return (v.startsWith("prov:") || v === "__addprov") ? v : null;
  if (lv === "providers" && sub && !sub3) return (v === "key" || v === "baseurl" || v === "models") ? v : null;
  return null;
};

  const settingsActivate = (value: string) => {
  const lv = menuStack[1] || "";
  const sub = menuStack[2] || "";
  const sub3 = menuStack[3] || "";
  if (lv === "defaults") {
    if (sub === "thinking") {
      const th = String(wsSettings?.defaultThinkingLevel || "xhigh");
      applySettingsPatch({ defaultThinkingLevel: th === "off" ? "xhigh" : "off" });
      return;
    }
    if (sub === "model") {
      if (value && !value.startsWith("__")) {
        applySettingsPatch({ defaultModel: value });
        try {
          const cfg = readProvidersCfg();
          cfg.defaultModel = value;
          const call = (globalThis as any).__sidecarCall;
          if (call) call('setProvidersConfig', cfg).catch(() => {});
          defaultModelId = value;
        } catch {}
      }
      return;
    }
    if (sub === "fallbacks") {
      if (menuMarked.size > 0 || true) { /* confirm saves the current selection order */ }
      return;
    }
    if (sub === "fallbacks" && value.startsWith("fb:")) {
      const id = value.slice(3);
      const cur = (Array.isArray(wsSettings?.defaultFallbackModels) ? wsSettings.defaultFallbackModels : []).filter((x: any) => String(x) !== id);
      try { const call = (globalThis as any).__sidecarCall; if (call) call('setDefaultFallbacks', { fallbacks: cur }).catch(() => {}); } catch {}
      wsSettings = { ...(wsSettings || {}), defaultFallbackModels: cur };
      return;
    }
    return;
  }
  if (lv === "providers") {
    if (sub === "__addprov") {
      const typed = String(value || "");
      if (!typed || typed.startsWith("__")) return;
      if (addProvStep === 0) { addProvTmp.name = typed; addProvStep = 1; menuSubFilter = ""; menuSel = 0; return; }
      addProvTmp.baseUrl = typed;
      const nm = String(addProvTmp.name || "");
      if (nm) patchProvider(nm, (p) => { if (!p.baseUrl) p.baseUrl = addProvTmp.baseUrl; if (p.enabled === undefined) p.enabled = true; if (!p.enabledModels) p.enabledModels = []; if (!p.modelData) p.modelData = []; });
      addProvStep = 0; addProvTmp = { name: "", baseUrl: "" };
      menuStack = ["settings", "providers"]; menuSubFilter = ""; menuSel = 0;
      return;
    }
    const pname = String(sub || "").replace(/^prov:/, "");
    if (sub && !sub3) { if (value === "toggle") { patchProvider(pname, (p) => { p.enabled = !p.enabled; }); } return; }
    if (sub3 === "models") {
      if (menuMarked.size > 0) {
        const ids = Array.from(menuMarked).filter((v: string) => v.startsWith("mdl:")).map((v: string) => v.slice(4));
        if (ids.length > 0) {
          patchProvider(pname, (p) => { const e = new Set(p.enabledModels || []); for (const id of ids) { if (e.has(id)) e.delete(id); else e.add(id); } p.enabledModels = Array.from(e); });
        }
        menuMarked.clear();
        return;
      }
      if (value.startsWith("mdl:")) {
        const id = value.slice(4);
        patchProvider(pname, (p) => { const e = new Set(p.enabledModels || []); if (e.has(id)) e.delete(id); else e.add(id); p.enabledModels = Array.from(e); });
        return;
      }
    }
    if (sub3 === "key" && value && !value.startsWith("__")) { patchProvider(pname, (p) => { p.apiKey = value; }); return; }
    if (sub3 === "baseurl" && value && !value.startsWith("__")) { patchProvider(pname, (p) => { p.baseUrl = value; }); return; }
    return;
  }
};
const applySettingsPatch = (patch: any) => {
    try {
      const call = (globalThis as any).__sidecarCall;
      if (!call) return;
      wsSettings = { ...(wsSettings || {}), ...patch };
      call('getGlobalConfig', {}).then((r: any) => {
        const cur = (r && (r.config || r)) || {};
        call('updateGlobalConfig', { config: { ...cur, ...patch } }).catch(() => {});
      }).catch(() => {});
      call('setSettings', patch).catch(() => {});
    } catch {}
  };

  const buildMenuRows = (w: number): string[] => {
    try {
      const t = editorText();
      if (menuError && menuStack.length > 0) {
        // Error INSIDE the menu: red rule above, red text, Confirm to go back.
        const rowsE: string[] = [fg(C.danger, "\u2500".repeat(Math.max(1, Math.min(w, 56))))];
        for (const ln of wrapPlain(menuError, Math.max(10, w))) rowsE.push(fg(C.danger, ln));
        rowsE.push("");
        const leftE = fg(C.textSecondary, "\u2191 \u2193 \u2190 \u2192");
        const rightE = menuConfirmFocus ? bold(bg(C.primary, fg(C.bgPanel, " Confirm "))) : fg(C.primary, "Confirm");
        const gwE = Math.max(1, w - visibleWidth(leftE) - visibleWidth(rightE));
        rowsE.push(leftE + " ".repeat(gwE) + rightE);
        return rowsE;
      }
      if (menuStack.length > 0 && !t.startsWith("/")) {
        menuStack = [];
        menuSubFilter = "";
        menuSel = 0;
        menuConfirmFocus = false;
      }
      const mainOpen = menuStack.length === 0 && t.startsWith("/");
      if (!mainOpen && menuStack.length === 0) {
        menuConfirmFocus = false;
        return [];
      }
      let items: any[];
      if (menuStack.length > 0) {
        items = applyFilter(levelItems(menuStack));
      } else {
        const f = t.slice(1).toLowerCase();
        if (f !== menuLastFilter) {
          menuLastFilter = f;
          menuSel = 0;
          menuConfirmFocus = false;
        }
        items = mainItems();
      }
      menuItemsCache = items; // menuNav actions use the SAME list the user sees
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
      const MAXWIN = 12;
      const winStart = Math.max(0, Math.min(Math.max(0, items.length - MAXWIN), menuSel - Math.floor(MAXWIN / 2)));
      const winEnd = Math.min(items.length, winStart + MAXWIN);
      for (let i = winStart; i < winEnd; i++) {
        const it = items[i];
        let label = String(it.label ?? it.value ?? "");
        let desc = String(it.description ?? "");
        if ((it as any).separator) {
          // Group separator (agent name): not selectable, no highlight — with one
          // blank row of padding below and one ABOVE, skipped when it is the very
          // first row (the menu already opens with its own space).
          if (rows.length > 0) rows.push("");
          rows.push(fg(C.textSecondary, label));
          rows.push("");
          continue;
        }
        if ((it as any).notice) {
          // Confirmation notice (reset/delete): a message instead of an option —
          // confirm with → then Enter (mandatory Confirm).
          if (rows.length > 0) rows.push("");
          for (const ln of wrapPlain(String((it as any).notice), Math.max(10, w))) rows.push(fg(C.textSecondary, ln));
          rows.push("");
          continue;
        }
        if (menuMarked.has(String((it as any).value ?? "")) && !(menuStack[0] === "settings" && menuStack[1] === "defaults" && menuStack[2] === "fallbacks")) label = "\u2713 " + label;
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
      const hasMulti = menuStack[0] === "settings" && (menuStack[3] === "models" || (menuStack[1] === "defaults" && menuStack[2] === "fallbacks") || (menuStack[1] === "providers" && !menuStack[2]));
      // Confirm appears ONLY when the highlighted option actually RUNS something
      // (navigation items and read-only pages do not show it).
      let needsConfirm = menuConfirmFocus;
      try {
        const cur: any = items[menuSel];
        if (cur && !cur.separator) {
          if (menuStack[0] === "agentinsession") needsConfirm = !agentLevelFor(cur);
          else if (menuStack[0] === "settings") {
            const inModelsLv = menuStack[3] === "models";
            const inProvLv = menuStack[1] === "providers" && !menuStack[2];
            const inFbLv = menuStack[1] === "defaults" && menuStack[2] === "fallbacks";
            needsConfirm = inFbLv ? true : ((inModelsLv || inProvLv) ? false : !settingsDeeper(cur));
          }
          else if (menuStack.length > 0) needsConfirm = true;
          else {
            const c2: any = commands.find((c: any) => c.name === cur.value);
            needsConfirm = !(c2 && typeof c2.getArgumentCompletions === "function");
          }
        }
      } catch {}
      const right =
        fg(C.danger, "Close (Esc)") +
        "  " +
        (hasMulti ? fg(C.modeBuild, "Select (Tab)") + "  " : "") +
        (needsConfirm ? (menuConfirmFocus ? bold(bg(C.primary, fg(C.bgPanel, " Confirm (Enter) "))) : fg(C.primary, "Confirm (Enter)")) : "");
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
  try {
    (globalThis as any).__qMenuSelect = () => {
      try {
        if (menuStack && menuStack.length > 0) {
          menuNav("select");
          try { ui.requestRender(); } catch {}
          return true;
        }
      } catch {}
      return false;
    };
  } catch {}

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
    // User bubble with the footer INSIDE it (no info glyph on user messages).
    // ONE push only — the old plain Text bubble was removed (it doubled).
    {
      const now = Date.now();
      if (!(lastUserPush.text === t && now - lastUserPush.ts < 2000)) {
        lastUserPush = { text: t, ts: now };
        pushBlock(new UserBubble(t, fmtFooterDate(now)));
      }
    }
    if (scOn) {
      // Live path: the sidecar runs the turn (agents, custom tools, delegation)
      // and the app sees this exact chat streaming in real time.
      streaming = true;
      setStatus("Sending", "sending");
      updateBar();
      const sk = currentKey;
      const skills = pendingSkills.splice(0);
      const fail = (err: any) => {
        addRow(fg(C.danger, "\u25b8 error \u00b7 " + truncate(String(err?.message || err), 120)));
        streaming = false;
        updateBar();
      };
      void (async () => {
        try {
          await sc.call("ensureSession", { sessionKey: sk, label: "Chat" }, 20000);
          // Sync the engine with the session's REAL configuration: agents in the
          // chat (default quinki), mode, model and thinking — otherwise the
          // runtime runs a bare session without the user's tools/skills/MCP.
          await sc.call("setChatAgents", { sessionKey: sk, agentIds: sessionAgentIds().join(",") }, 20000);
          await sc.call(
            "sendMessage",
            {
              sessionKey: sk,
              text: t,
              ...(skills.length ? { skillNames: skills } : {}),
              // Only what the USER changed here: otherwise the session/app
              // defaults decide (no forced model, no forced thinking).
              ...(modelExplicit && wsModelId ? { model: wsModelId } : {}),
              ...(thinkingExplicit ? { thinkingLevel: thinkingOn ? "xhigh" : "off" } : {}),
              mode,
            },
            600000
          );
        } catch (err) {
          fail(err);
        }
      })();
      return;
    }
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
  // Startup = WELCOME (like opening the app). Histories load when a chat is
  // opened from /sessions, and its real context fills in right away.
  applyLayout(true);
  try {
    void sc
      .call("getContextUsage", { sessionKey: currentKey }, 15000)
      .then((r: any) => {
        const u = r?.usage || {};
        const tk = Number(u.tokens ?? 0);
        if (tk > 0) ctxTokens = tk;
        if (Number(u.contextWindow || 0) > 0) ctxWindow = Number(u.contextWindow);
        try {
          ui.requestRender();
        } catch {}
      })
      .catch(() => {});
  } catch {}

  try {
    ui.start();
  } catch (err) {
    process.stderr.write("quinki: could not start the terminal UI: " + String((err as any)?.message || err) + "\n");
    process.exit(1);
  }
}
