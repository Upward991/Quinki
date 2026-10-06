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

import { C, fg, bg, bgKeepPanel, collapsed, counterColor, blend, bold, italicStyle , panelBgWrap } from "./theme";

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

// === APP EXPERT MODE ========================================================
// `quinki expert` runs the SAME interface, pinned to the App Expert session
// (the one the app uses), with the expert ORANGE accent instead of the violet.
const QEXPERT = process.env.QUINKI_EXPERT === "1";
try { if (QEXPERT) (C as any).primary = C.expert; } catch {}

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
  const a = pixWord(QEXPERT ? "Welcome to " : "Welcome to ", PLAIN);
  const b = pixWord(QEXPERT ? "App Expert" : "Quinki", VIOLET);
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
    if (!ms) return "";
    const d = new Date(Number(ms));
    const M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const p2 = (n: number) => String(n).padStart(2, "0");
    return d.getDate() + " " + M[d.getMonth()] + " " + d.getFullYear() + " \u00b7 " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
  } catch { return ""; }
}

/** Word-wrap a plain (ANSI-free) string to a visible width. */
function wrapPlain(s: string, width: number): string[] {
  const out: string[] = [];
  const w = Math.max(4, width);
  // A word longer than the width (a PATH, a URL…) must be SPLIT, or it overflows
  // every box (bubbles, menus, notices). Visible-width aware (CJK-safe).
  const pushHard = (word: string) => {
    let cur = "";
    for (const g of [...word]) {
      cur += g;
      if (visibleWidth(cur) >= w) {
        out.push(cur);
        cur = "";
      }
    }
    if (cur) out.push(cur);
  };
  for (const raw of String(s || "").split("\n")) {
    if (raw.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of raw.split(" ")) {
      if (!line) {
        if (visibleWidth(word) > w) pushHard(word);
        else line = word;
      } else if (visibleWidth(line) + 1 + visibleWidth(word) <= w) line += " " + word;
      else {
        out.push(line);
        if (visibleWidth(word) > w) pushHard(word);
        else line = word;
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
      // Strip ANSI (and the literal "[33m"-style escapes seen in pasted build logs)
      const first = String(src).split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "").replace(/\[\d{1,2}(;\d{1,2})*m/g, "").trim() || "";
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
// T455: the UserBubble class lives OUTSIDE the main closure: it can't call the
// closure-scoped qTokRe() (that caused "ReferenceError: qTokRe is not defined"
// on EVERY render => the CLI crashed at startup). The app installs a bridge here.
let __qTokReGlobal: (() => RegExp) | null = null;

class UserBubble {
  text: string;
  dateStr: string;
  chips: Array<{ kind: string; name: string }>;
  constructor(text: string, dateStr: string, chips?: Array<{ kind: string; name: string }>) {
    this.text = text;
    this.dateStr = dateStr;
    this.chips = Array.isArray(chips) ? chips : [];
  }
  render(width: number): string[] {
    const inner = Math.max(6, width - 4);
    const hardWrap = (t: string, w: number): string[] => {
      const out: string[] = [];
      let cur = "";
      for (const chG of [...t]) {
        cur += chG;
        if (visibleWidth(cur) >= w) { out.push(cur); cur = ""; }
      }
      if (cur) out.push(cur);
      return out;
    };
    const lines: string[] = [];
    for (const l of wrapPlain(this.text, inner)) lines.push(...hardWrap(l, inner));
    // The clips stay visible in the bubble (colored like the app's tabs).
    for (const ch of this.chips) {
      const col = ch.kind === "skill" ? "#c97084" : "#7aa2f7";
      lines.push(fg(col, "\u25b8 " + ch.name));
    }
    const full = (t: string) => {
      // Clips styled exactly like the textbox (coral/blue bg, dark text), inline
      // in their original order; then back to the bubble colors.
      const painted = String(t).replace((typeof __qTokReGlobal === "function" ? __qTokReGlobal() : /Skill:\s*[\w.-]+|\u25b8[^\s\u25b8]+/g), (m2: string) => {
        const isSkill = m2.startsWith("Skill:");
        const bgRgb = isSkill ? "201;112;132" : "122;162;247";
        // T480: NEVER the triangle, even for old messages saved with it: a
        // "▸name" token shows as the bare name (the app's look).
        const shown = isSkill ? m2 : m2.replace(/^\u25b8/, "");
        return "\x1b[48;2;" + bgRgb + "m\x1b[38;2;8;8;11m" + shown + "\x1b[48;2;26;26;32m\x1b[38;2;232;232;236m";
      });
      const fill = Math.max(0, inner - visibleWidth(painted)); // width of the PAINTED text
      return bg(C.bubbleUser, "  " + painted + " ".repeat(fill + 2));
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
  // Survival guard: the sidecar dying (app closed) must NEVER kill this process.
  // Errors from the websocket/link are handled by the reconnect loop instead.
  try {
    process.on("uncaughtException", (e: any) => {
      try { require("fs").appendFileSync("/tmp/q-cli-survive.log", String(e?.stack || e) + "\n"); } catch {}
    });
    process.on("unhandledRejection", (e: any) => {
      try { require("fs").appendFileSync("/tmp/q-cli-survive.log", "rejection: " + String(e?.stack || e) + "\n"); } catch {}
    });
  } catch {}
  // VERSION STAMP: proves which build is running (diagnosis of "nothing changes").
  try {
    const st = require("fs").statSync(process.execPath || "");
    require("fs").appendFileSync("/tmp/q-cli-boot.log", new Date().toISOString() + " boot " + require("path").basename(String(process.execPath || "")) + " mtime=" + new Date(st.mtimeMs).toISOString() + " args=" + process.argv.slice(2).join(",") + "\n");
  } catch {}
  // Startup: always a FRESH cli session with the welcome (no resume): every
  // existing chat — including the last used one — stays visible in /sessions.
  const key = QEXPERT
    ? (process.env.QUINKI_SESSION_KEY || "__app_expert__")
    : "cli-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
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
  // /directory: live data from listWorkingDirs + pending change (files warning).
  let qDirs: any = null;
  let qDirsAt = 0;
  let qDirsKey = ""; // which session the qDirs data belongs to (stale-proof)
  const qDirsKick = () => {
    try {
      if (!scOn) return;
      if (Date.now() - qDirsAt < 1500 && qDirs && qDirsKey === currentKey) return;
      qDirsAt = Date.now();
      const k0 = currentKey;
      void sc.call("listWorkingDirs", { sessionKey: k0 }, 15000)
        .then((r: any) => { if (r && typeof r === "object" && k0 === currentKey) { qDirs = r; qDirsKey = k0; try { ui.requestRender(); } catch {} } })
        .catch(() => {});
    } catch {}
  };
  let dirPendingChange = "";
  let dirPendingFiles = 0;
  const openFolder = (folder: string) => {
    try {
      const cp = require("child_process");
      const opener = process.platform === "darwin" ? "/usr/bin/open" : (process.platform === "win32" ? "explorer" : "/usr/bin/xdg-open");
      cp.spawn(opener, [folder], { detached: true, stdio: "ignore" }).unref();
    } catch {}
  };
  // The chat's default directory (same as the app): ~/.quinki/workdir — created
  // on the spot if it is missing. A chat can NEVER be without a directory.
  const ensureDir = (d: string): string => { try { require("fs").mkdirSync(d, { recursive: true }); } catch {} return d; };
  // EACH chat has ITS OWN folder under ~/.quinki/workdir — same formula as the
  // sidecar (pi-XXX -> quinki-XXX; cli-XXX -> cli-XXX). The workdir root is just
  // the container of all chats' folders, never a chat's directory.
  const autoDirForKey = (k: string): string => {
    const safe = String(k || "session").replace(/[^a-zA-Z0-9_-]/g, "_");
    const friendly = safe.startsWith("pi-") ? "quinki-" + safe.slice(3) : safe;
    return ensureDir(path.join(os.homedir(), ".quinki", "workdir", friendly));
  };
  const defaultDirPath = (): string => currentKey ? autoDirForKey(currentKey) : ensureDir(path.join(os.homedir(), ".quinki", "workdir"));
  const applyDirChange = (target: string) => {
    let t = "";
    try {
      t = String(target || "").trim();
      if (t === "~") t = os.homedir();
      if (t.startsWith("~/")) t = path.join(os.homedir(), t.slice(2));
      t = path.resolve(t);
      let ok = false;
      try { ok = require("fs").statSync(t).isDirectory(); } catch {}
      if (!t || !ok) t = ensureDir(defaultDirPath()); // missing/deleted -> the default, recreated
    } catch { t = ensureDir(defaultDirPath()); }
    dirPendingChange = "";
    dirPendingFiles = 0;
    let isWelcome2 = false;
    try { isWelcome2 = welcomeShown || !currentKey; } catch {}
    if (isWelcome2) {
      // No chat yet: the choice applies to the NEW chat (persisted at creation).
      try { pendingWorkingDir = t; } catch {}
    } else {
      try {
        const call = (globalThis as any).__sidecarCall;
        if (call) void call("setWorkingDir", { sessionKey: currentKey, workingDir: t }, 30000).catch(() => {});
      } catch {}
      try { void recreateSession({ newCwd: t }); } catch {}
    }
    try { qDirs = null; qDirsAt = 0; } catch {}
    // ALWAYS back to the list: the new folder shows up marked (●).
    try { menuStack = ["directory"]; menuSubFilter = ""; menuSel = 0; } catch {}
    try { ui.requestRender(); } catch {}
  };
  const pickFolder = () => {
    try {
      const cp = require("child_process");
      cp.execFile("/usr/bin/osascript", ["-e", 'POSIX path of (choose folder with prompt "Choose the folder for this chat")'], { timeout: 180000 }, (err: any, stdout: string) => {
        if (err) { try { ui.requestRender(); } catch {} return; }
        const picked = String(stdout || "").trim().replace(/\/+$/, "");
        if (!picked) return;
        // WELCOME: no chat yet, nothing to warn about — apply straight into the preview.
        let isW = false;
        try { isW = welcomeShown || !currentKey; } catch {}
        if (isW) {
          applyDirChange(picked);
          try { ui.requestRender(); } catch {}
          return;
        }
        const old = String(qDirs?.current || currentCwd || "");
        let n = 0;
        try { n = require("fs").readdirSync(old).filter((x: string) => !x.startsWith(".")).length; } catch {}
        if (n > 0) { dirPendingChange = picked; dirPendingFiles = n; try { menuStack = ["directory"]; menuSubFilter = ""; menuSel = 0; } catch {} }
        else applyDirChange(picked);
        try { ui.requestRender(); } catch {}
      });
    } catch {}
  };
  let currentSessionDir = realSessionDir; // reads: the sidecar's files
  let currentKey = key;

  // --- sidecar link: run the chat in the REAL Quinki runtime (the same session
  // the app uses — agents, skills, delegation, live sync). Falls back to the
  // bare SDK session when the app/sidecar is not running. ---------------------
  // T475: the expert CLI must default to ITS OWN port (9183). Without this, any
  // expert CLI missing the env var connected to the MAIN sidecar (usually dead
  // when the main app is closed) => scOn false forever => the session never
  // loaded (the restarted CLI came up empty).
  const sc = new Sc("ws://127.0.0.1:" + (process.env.QUINKI_SIDECAR_PORT || (QEXPERT ? "9183" : "9182")));
  // The settings menu uses this channel; define it from the CLI's real RPC client.
  try { (globalThis as any).__sidecarCall = (m: string, p?: any, t?: number) => sc.call(m, p || {}, t || 120000); } catch {}
  // The app's watchdog KILLS the shared sidecar when the app quits (port 9182).
  // The TUI must survive that: it spawns the installed sidecar itself and the
  // client keeps reconnecting — engine back within seconds.
  const spawnSidecar = () => {
    try {
      // App Expert mode must revive ITS OWN sidecar (the expert app's start.sh),
      // exactly like the normal CLI does with Quinki.app. The port comes from
      // QUINKI_SIDECAR_PORT (9183 for the expert), passed through the env.
      const candidates = QEXPERT
        ? ["/Applications/App Expert.app/Contents/Resources/resources/sidecar/start-expert.sh",
           "/Applications/App Expert.app/Contents/Resources/resources/sidecar/start.sh",
           "/Applications/Quinki.app/Contents/Resources/resources/sidecar/start.sh"]
        : ["/Applications/Quinki.app/Contents/Resources/resources/sidecar/start.sh",
           "/Applications/App Expert.app/Contents/Resources/resources/sidecar/start.sh"];
      for (const sh of candidates) {
        if (fs.existsSync(sh)) {
          const p = spawn(sh, [], { detached: true, stdio: "ignore", cwd: path.dirname(sh), env: { ...process.env, QUINKI_POOL_EAGER: "0" } as any });
          p.unref?.();
          return true;
        }
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
  const pendingAttachments: Array<{ path: string }> = [];
  const attPathByName: Record<string, string> = {}; // inline token name -> real file
  // Like the app's copy_to_attachments: the file is COPIED into the session's
  // attachments folder; the original stays where it is.
  const stageAttachment = (src: string): { path: string; originalName: string } | null => {
    try {
      const fsc = require("fs"), pathc = require("path");
      if (!src || !fsc.existsSync(src)) return null;
      const name = pathc.basename(src);
      const dir = pathc.join(require("os").homedir(), ".quinki", "attachments", String(currentKey || ""));
      fsc.mkdirSync(dir, { recursive: true });
      const dest = pathc.join(dir, name);
      try { if (pathc.resolve(src) !== pathc.resolve(dest)) fsc.copyFileSync(src, dest); } catch {}
      return { path: dest, originalName: name };
    } catch { return null; }
  };
  // Clip colors = the app's tab accents: skill -> Agents tab, attachment -> Chat tab.
  const Q_CLIP_SKILL = "#c97084";  // --q-accent-secondary (Agents)
  const Q_CLIP_ATT = "#7aa2f7";    // --q-accent-info (Chat)
  // NATIVE tokens: each chip is ONE invisible private char (U+E000+i) in the text
  // (atomic for the cursor/backspace) rendered as a colored chip by the editor.
  const qTokens: Array<{ ch: string; name: string; kind: string; path?: string }> = [];
  const Q_TOKEN_CHARS = "\uE000\uE001\uE002\uE003\uE004\uE005\uE006\uE007\uE008\uE009\uE00A\uE00B\uE00C\uE00D\uE00E\uE00F\uE010\uE011\uE012\uE013\uE014\uE015\uE016\uE017\uE018\uE019\uE01A\uE01B\uE01C\uE01D";
  const qTokenChar = (index: number) => Q_TOKEN_CHARS[index] || "\uE01D";
  const qTokenAdd = (name: string, kind: string, path?: string) => {
    const i = qTokens.length;
    qTokens.push({ ch: qTokenChar(i), name, kind, path });
    return qTokenChar(i);
  };
  const qTokenByCh = (ch: string) => qTokens.find((t) => t.ch === ch) || null;
  // T449: the attachment tokens must match the KNOWN names (which can contain
  // SPACES: "my report final.pdf") — longest first, then the generic fallback.
  const qAttNames = (): string[] => {
    try {
      const nm = new Set<string>();
      for (const k of Object.keys(attPathByName)) if (k) nm.add(k);
      return Array.from(nm).sort((a, b) => b.length - a.length);
    } catch { return []; }
  };
  const qTokReSrc = (): string => {
    let names: string[] = [];
    try {
      names = qAttNames()
        // T462: un nome con caratteri di CONTROLLO (newline/tab...) o troppo lungo
        // rendeva la regex INVALIDA => hop/cancellazione atomica/cursore MORTI in
        // silenzio (le pill si cancellavano lettera per lettera!). Filtro brutale.
        .filter((n) => !!n && !/[\x00-\x1f\x7f]/.test(n) && n.length <= 200)
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    } catch {}
    // T462: le clip NUOVE sono il NOME NUDO (niente triangolo nel testo); le vecchie
    // con ▸ restano riconosciute (compat). Ordine: nomi noti (più lunghi prima) -> ▸ -> skill.
    const bare = names.length ? "(?:" + names.join("|") + ")" : "";
    return "(?:" + (bare ? bare + "|" : "") + "\u25b8(?:[^\\s\u25b8]+))|(?:Skill:\\s*[\\w.-]+)";
  };
  const qTokRe = (): RegExp => {
    // T462: mai far esplodere i consumatori: se la regex dinamica è invalida per
    // qualsiasi motivo, si torna al pattern statico (le pill continuano a vivere).
    try { return new RegExp(qTokReSrc(), "g"); }
    catch { return /(?:\u25b8[^\s\u25b8]+)|(?:Skill:\s*[\w.-]+)/g; }
  };
  try { __qTokReGlobal = qTokRe; } catch {}
  // T448: a REAL file path (Finder drop / pasted path) is NEVER a slash command:
  // its leading "/" must not light the menu nor block the send.
  const qIsFilePath = (t: string): boolean => {
    try {
      if (!t || !t.startsWith("/") || t.indexOf("\n") >= 0 || t.length > 4096) return false;
      const f = require("fs");
      return f.existsSync(t) && f.statSync(t).isFile();
    } catch { return false; }
  };
  const qTokenStyle = (tok: string): string => {
    try {
      const isAtt = tok.startsWith("\u25b8") || (() => { try { return qAttNames().includes(tok); } catch { return false; } })();
      // Skill = coral (the original Agents tab accent); attachment = blue (#7aa2f7),
      // EXACTLY like the bubble's inline clips. Dark text = the textbox background.
      // The END re-applies the editor panel background + text color (otherwise the
      // reset would kill the row paint after the chip).
      // T462: la larghezza DEVE restare identica alla stringa reale, altrimenti il
      // bordo della textbox si spezza (lo screenshot). Il triangolo non si nasconde
      // più a render-time: dalle prossime clip non esiste proprio nel testo.
      const shown = tok;
      return (
        (isAtt ? "\x1b[48;2;122;162;247m" : "\x1b[48;2;201;112;132m") +
        "\x1b[38;2;8;8;11m" +
        shown +
        "\x1b[48;2;15;15;19m" +
        "\x1b[38;2;232;232;236m"
      );
    } catch { return tok; }
  };
  const qTokenRender = (ch: string) => {
    const t = qTokenByCh(ch);
    if (!t) return ch;
    const col = t.kind === "skill" ? Q_CLIP_SKILL : Q_CLIP_ATT;
    // Violet/colored bar: accent background, bg-colored text.
    const lbl = " " + t.name + " ";
    const hex = col.replace("#", "");
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const bgc = C.bg.replace("#", "");
    const br = parseInt(bgc.slice(0, 2), 16), bg2 = parseInt(bgc.slice(2, 4), 16), bb = parseInt(bgc.slice(4, 6), 16);
    return `\x1b[48;2;${r};${g};${b}m\x1b[38;2;${br};${bg2};${bb}m${lbl}\x1b[49m\x1b[39m`;
  };
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
  // The chat's directory — NEVER empty, NEVER "undefined": sidecar current → the
  // session's own workingDir → local cwd → HOME → "/". A chat always HAS a directory.
  const currentDirAny = (): string => {
    // The WELCOME has NO directory: it is generated when the chat actually starts.
    // Only an explicitly chosen folder (the preview box) shows up there.
    try { if (welcomeShown) return pendingWorkingDir || ""; } catch {}
    try {
      let sessDir = "";
      try {
        const e0: any = readSessionsList().find((x: any) => x?.key === currentKey);
        sessDir = String(e0?.workingDir || "");
      } catch {}
      const qCur = qDirsKey === currentKey ? String(qDirs?.current || "") : ""; // never a stale chat's dir
      const cand = [String((typeof welcomeShown !== "undefined" && welcomeShown && pendingWorkingDir) || ""), sessDir, qCur, String(currentCwd || ""), String(process.env.HOME || "")];
      const chosen = cand.find((x) => x && x !== "undefined" && x !== "null") || "/";
      // The folder may have been deleted on the computer: the chat falls back to the
      // default directory (recreated) — exactly like the app.
      try {
        if (!require("fs").statSync(chosen).isDirectory()) return ensureDir(defaultDirPath());
      } catch { return ensureDir(defaultDirPath()); }
      return chosen;
    } catch {
      return "/";
    }
  };
  const fmtDirShort = (): string => {
    try {
      const d = currentDirAny();
      const home = process.env.HOME || "";
      return home && d.startsWith(home) ? "~" + d.slice(home.length) : d;
    } catch {
      return "/";
    }
  };
  // Plain bg with a proper reset at the end: the grey bar must stop at the
  // header box and NOT bleed to the right edge of the terminal.
  const headerBg = (s: string) => bg(C.bgPanel, s);
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
    const dirFull = fmtDirShort();
    const dir = dirFull ? "Directory: " + String(dirFull).replace(/\/+$/, "").split("/").pop() : "";
    const wc = Math.min(w, chatMaxCols());
    // EXACT box layout: violet bar, TWO black columns, panel content, TWO black
    // columns, violet bar — same width as the composer, same margins.
    const L = panelBgWrap(fg(C.primary, "\u258f"));
    const R = panelBgWrap(fg(C.primary, "\u2595")) + "\x1b[49m";
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
    return centerRow(w, panelBgWrap(fg(C.primary, "\u258f")) + headerBg(" ".repeat(Math.max(0, wc - 2))) + panelBgWrap(fg(C.primary, "\u2595")) + "\x1b[49m", wc);
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
    // The chip styling is applied HERE (paint time): the editor's cursor/layout math
    // already ran, so ANSI can never break a slice (the T412 leak).
    (editor as any).bgFn = (s: string) => {
      // T521: while the editor draws the slash MENU rows, no token painting at
      // all (a title like "Skill: name" was being styled as the skill pill).
      // The text box path (the pill) is untouched: same regex, same colors.
      if ((editor as any).qMenuRendering) return bg(C.bgPanel, String(s));
      return bg(
        C.bgPanel,
        String(s).replace(/Skill:\s*[\w.-]+|\u25b8[^\s\u25b8]+/g, (m2: string) =>
          String((editor as any).qTokenStyle ? (editor as any).qTokenStyle(m2) : m2)
        )
      );
    };
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
  let sessionEntryAllowed = false; // becomes true on the first user action (send)
  const ensureSessionEntry = (): void => {
    try {
      if (!sessionEntryAllowed) return; // the WELCOME chat never creates entries
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
        workingDir: pendingWorkingDir || undefined,
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
  // T508: the AGENTS tab data — the sidecar is the truth (same as the app).
  let qAgentsInputMode: "" | "newagent" | "skillpkg" | "mcpmcp" = "";
  let qSkillsData: string[] = [];
  let qAgentsData: any[] = [];
  let qMcpData: any[] = [];
  let qToolsData: any[] = [];
  const refreshAgentsTab = () => {
    try { require("fs").appendFileSync("/tmp/q-agents-data.log", new Date().toISOString() + " refreshAgentsTab ENTER call=" + (typeof (globalThis as any).__sidecarCall) + " scOn=" + (typeof scOn !== "undefined" ? scOn : "?") + "\n"); } catch {}
    try {
      const call = (globalThis as any).__sidecarCall;
      if (!call) return;
      call('listAgents', {}).then((r: any) => { try { qAgentsData = Array.isArray(r?.agents) ? r.agents : []; } catch {} try { require("fs").appendFileSync("/tmp/q-agents-data.log", new Date().toISOString() + " listAgents=" + qAgentsData.length + "\n"); } catch {} try { ui.requestRender(); } catch {} }).catch((eA: any) => { try { require("fs").appendFileSync("/tmp/q-agents-data.log", " listAgents ERR " + String(eA?.message || eA) + "\n"); } catch {} });
      call('listSkills', {}).then((r: any) => { try { const sk = Array.isArray(r?.skills) ? r.skills : []; qSkillsData = sk.map((x: any) => String(x?.name || x)).filter(Boolean); } catch {} try { require("fs").appendFileSync("/tmp/q-agents-data.log", new Date().toISOString() + " listSkills=" + qSkillsData.length + "\n"); } catch {} try { ui.requestRender(); } catch {} }).catch((eS: any) => { try { require("fs").appendFileSync("/tmp/q-agents-data.log", " listSkills ERR " + String(eS?.message || eS) + "\n"); } catch {} });
      call('listMcpServers', {}).then((r: any) => { try { qMcpData = Array.isArray(r?.servers) ? r.servers : []; } catch {} try { require("fs").appendFileSync("/tmp/q-agents-data.log", new Date().toISOString() + " listMcpServers=" + qMcpData.length + " " + JSON.stringify(qMcpData.slice(0,3).map((m: any) => m?.id || m?.name)) + "\n"); } catch {} try { ui.requestRender(); } catch {} }).catch((eM: any) => { try { require("fs").appendFileSync("/tmp/q-agents-data.log", " listMcpServers ERR " + String(eM?.message || eM) + "\n"); } catch {} });
      call('listTools', {}).then((r: any) => { try { qToolsData = Array.isArray(r?.tools) ? r.tools : []; } catch {} try { require("fs").appendFileSync("/tmp/q-agents-data.log", new Date().toISOString() + " listTools=" + qToolsData.length + "\n"); } catch {} try { ui.requestRender(); } catch {} }).catch((eT: any) => { try { require("fs").appendFileSync("/tmp/q-agents-data.log", " listTools ERR " + String(eT?.message || eT) + "\n"); } catch {} });
      call('getGlobalConfig', {}).then((r: any) => {
        try {
          const cfg = (r && (r.config || r)) || {};
          wsSettings = { ...(wsSettings || {}), defaultAgentId: cfg.defaultAgentId || (wsSettings || {}).defaultAgentId, planModeTools: cfg.planModeTools || {}, planModeMcp: cfg.planModeMcp || {} };
        } catch {}
        try { ui.requestRender(); } catch {}
      }).catch(() => {});
    } catch {}
  };
  const agentFieldOf = (id: string, field: string): string[] => {
    try {
      const a = qAgentsData.find((x: any) => x?.id === id || x?.name === id);
      return ((a?.[field]) || []).map((s: any) => (typeof s === "string" ? s : s?.name)).filter(Boolean);
    } catch { return []; }
  };
  const agentSkillsOf = (id: string) => agentFieldOf(id, "skills");
  const agentToolsOf = (id: string) => agentFieldOf(id, "tools");
  const agentMcpOf = (id: string) => agentFieldOf(id, "mcpServers");
  const allSkillsList = (): string[] => {
    // T510: ALL the installed skills (listSkills), never just the agents' union.
    try { return [...qSkillsData].sort(); } catch { return []; }
  };
  const agentAdminAction = (vAgT: string) => {
    // T508: ONE action for every agents-tab row (Tab = select, Enter = same).
    if (vAgT.startsWith("def:")) { applySettingsPatch({ defaultAgentId: vAgT.slice(4) }); try { refreshSessions(); } catch {} return; }
    const tog = (id: string, nm: string, cur: string[], field: string) => {
      const nx = cur.includes(nm) ? cur.filter((x) => x !== nm) : [...cur, nm];
      patchAgent(id, field === "mcpServers" ? { mcpServers: nx } : (field === "tools" ? { tools: nx } : { skills: nx }));
    };
    if (vAgT.startsWith("ast:")) { const r = vAgT.slice(4); const i1 = r.indexOf(":"); const id = r.slice(0, i1); const nm = r.slice(i1 + 1); tog(id, nm, agentSkillsOf(id), "skills"); return; }
    if (vAgT.startsWith("att:")) { const r = vAgT.slice(4); const i1 = r.indexOf(":"); const id = r.slice(0, i1); const nm = r.slice(i1 + 1); tog(id, nm, agentToolsOf(id), "tools"); return; }
    if (vAgT.startsWith("amt:")) { const r = vAgT.slice(4); const i1 = r.indexOf(":"); const id = r.slice(0, i1); const nm = r.slice(i1 + 1); tog(id, nm, agentMcpOf(id), "mcpServers"); return; }
    if (vAgT.startsWith("ska:")) { const r = vAgT.slice(4); const i1 = r.indexOf(":"); const nm = r.slice(0, i1); const id = r.slice(i1 + 1); tog(id, nm, agentSkillsOf(id), "skills"); return; }
    if (vAgT.startsWith("mcpa:")) { const r = vAgT.slice(5); const i1 = r.indexOf(":"); const mid = r.slice(0, i1); const id = r.slice(i1 + 1); tog(id, mid, agentMcpOf(id), "mcpServers"); return; }
    if (vAgT.startsWith("tola:")) { const r = vAgT.slice(5); const i1 = r.indexOf(":"); const nm = r.slice(0, i1); const id = r.slice(i1 + 1); tog(id, nm, agentToolsOf(id), "tools"); return; }
    if (vAgT.startsWith("pmt:")) { const nm = vAgT.slice(4); const pm = { ...(((wsSettings as any)?.planModeTools) || {}) }; pm[nm] = !pm[nm]; applySettingsPatch({ planModeTools: pm }); return; }
    if (vAgT.startsWith("pmm:")) { const id2 = vAgT.slice(4); const pm = { ...(((wsSettings as any)?.planModeMcp) || {}) }; pm[id2] = !pm[id2]; applySettingsPatch({ planModeMcp: pm }); return; }
  };
  const patchAgent = (id: string, config: any) => {
    try {
      const call = (globalThis as any).__sidecarCall;
      if (!call) return;
      call('updateAgent', { id, config }).then(() => { refreshAgentsTab(); }).catch(() => {});
    } catch {}
  };
  const countAgentsWith = (list: string[], field: string) => {
    try { return qAgentsData.filter((a: any) => agentFieldOf(a?.id || a?.name, field).some((x) => list.includes(x))).length; } catch { return 0; }
  };
  // T505: the AGENTS tab (CLI twin of the app's AgentsPanel): top menu.
  const agentAdminItems = (): any[] => {
    // T511: ALL the counts come from the ENGINE data (the same the app shows),
    // never from the old local caches: agents, skills, MCP, tools.
    let nAg = qAgentsData.length;
    if (!nAg) { try { nAg = agentIdsKnown().length; } catch {} }
    const nSk = qSkillsData.length;
    const nM = qMcpData.length;
    const nT = qToolsData.length;
    const curDef = String((wsSettings && (wsSettings as any).defaultAgentId) || "quinki");
    let defName = curDef; try { defName = agentDisplayName(curDef); } catch {}
    return [
      { value: "#def", label: "Default agent for new chats", description: defName },
      { value: "#you", label: "Your agents", description: String(nAg) + " configured" },
      { value: "#sk", label: "Skills", description: String(nSk) + " installed" },
      { value: "#mcp", label: "MCP", description: String(nM) + " servers" },
      { value: "#tools", label: "Tools", description: String(nT) + " available" },
      { value: "#plan", label: "Plan mode", description: "Tools and MCP enabled in plan mode" },
    ];
  };
  // T520b: the context header the user asked for: on every configuration list a
  // title row + a blank spacer, so it is always clear WHICH agent's skills you
  // are editing and in WHICH skill you are changing the agents.
  const qHead = (text: string): any[] => [
    { value: "__sep_head", label: text, separator: true },
    { value: "__sep_gap", label: "", separator: true },
  ];
  const agentAdminLevelItems = (stack: string[]): any[] => {
    if (stack.length <= 1) return agentAdminItems();
    // T518: THE bug — this was stack[1] (the FIRST sub-level): with 3 levels
    // (["agents","#sk","sk:x"]) the view re-rendered the SAME #sk list, so the
    // forward arrow "did nothing" and <- only popped one of the two copies,
    // landing back on the same list with the top row (Install skill) selected.
    const sub = stack[stack.length - 1];
    if (sub === "#def") {
      const cur = String((wsSettings && (wsSettings as any).defaultAgentId) || "quinki");
      try {
        return agentIdsKnown().map((id: string) => ({
          value: "def:" + id,
          label: (id === cur ? "\u25cf " : "\u25cb ") + agentDisplayName(id),
          description: id === cur ? "current default" : "set as default",
        }));
      } catch { return []; }
    }
    if (sub === "#you") {
      const out: any[] = [{ value: "__newagent", label: "\uff0b New agent", description: "Create a new agent" }];
      out.push({ value: "__sep_you", label: "Your agents", separator: true });
      try { for (const id of agentIdsKnown()) out.push({ value: "ag:" + id, label: agentDisplayName(id), description: id }); } catch {}
      return out;
    }
    if (sub === "#plan") {
      const pmT = (wsSettings && (wsSettings as any).planModeTools) || {};
      const pmM = (wsSettings && (wsSettings as any).planModeMcp) || {};
      const nT = Object.keys(pmT).filter((k) => pmT[k]).length;
      const nM = Object.keys(pmM).filter((k) => pmM[k]).length;
      return [
        { value: "#plantools", label: "Tools in plan mode", description: String(nT) + " enabled" },
        { value: "#planmcp", label: "MCP in plan mode", description: String(nM) + " enabled" },
      ];
    }
    if (sub === "#plantools") {
      const pm = (wsSettings && (wsSettings as any).planModeTools) || {};
      const out: any[] = [];
      for (const t of qToolsData) {
        const nm = String(t?.name || ""); if (!nm) continue;
        out.push({ value: "pmt:" + nm, label: (pm[nm] ? "\u25cf " : "\u25cb ") + nm, description: t?.readOnly ? "read-only" : "" });
      }
      return out;
    }
    if (sub === "#planmcp") {
      const pm = (wsSettings && (wsSettings as any).planModeMcp) || {};
      const out: any[] = [];
      for (const m of qMcpData) {
        const id = String(m?.id || m?.name || ""); if (!id) continue;
        out.push({ value: "pmm:" + id, label: (pm[id] ? "\u25cf " : "\u25cb ") + id, description: "" });
      }
      return out;
    }
    if (sub === "#sk") {
      const out: any[] = [{ value: "__newskill", label: "\uff0b Install skill from internet", description: "coming next" }];
      out.push({ value: "__sep_sk", label: "Installed skills", separator: true });
      for (const nm of allSkillsList()) {
        const n = countAgentsWith([nm], "skills");
        out.push({ value: "sk:" + nm, label: nm, description: String(n) + " agent" + (n === 1 ? "" : "s") });
      }
      return out;
    }
    if (sub === "#mcp") {
      const out: any[] = [{ value: "__newmcp", label: "\uff0b Install MCP server", description: "coming next" }];
      out.push({ value: "__sep_mcp", label: "MCP servers", separator: true });
      for (const m of qMcpData) {
        const id = String(m?.id || m?.name || ""); if (!id) continue;
        const n = countAgentsWith([id], "mcpServers");
        out.push({ value: "mcp:" + id, label: id, description: (m?.enabled === false ? "disabled \u00b7 " : "") + String(n) + " agent" + (n === 1 ? "" : "s") });
      }
      return out;
    }
    if (sub === "#tools") {
      const out: any[] = [{ value: "__sep_tools", label: "Tools", separator: true }];
      // T519: read-only tools grouped together first (the engine list has "read"
      // alone on top, then write/edit/bash, then the other read-only ones).
      const toolsSorted = qToolsData.slice().sort((a: any, b: any) => (b?.readOnly ? 1 : 0) - (a?.readOnly ? 1 : 0));
      for (const t of toolsSorted) {
        const nm = String(t?.name || ""); if (!nm) continue;
        const n = countAgentsWith([nm], "tools");
        out.push({ value: "tool:" + nm, label: nm, description: (t?.readOnly ? "read-only \u00b7 " : "") + String(n) + " agent" + (n === 1 ? "" : "s") });
      }
      return out;
    }
    if (sub.startsWith("ag:")) {
      const agId = sub.slice(3);
      return [...qHead("Agent: " + agentDisplayName(agId)),
        { value: "ask:" + agId, label: "Skills", description: String(agentSkillsOf(agId).length) + " enabled" },
        { value: "atk:" + agId, label: "Tools", description: String(agentToolsOf(agId).length) + " enabled" },
        { value: "amc:" + agId, label: "MCP", description: String(agentMcpOf(agId).length) + " enabled" },
        { value: "__agdel", label: "Delete agent", description: "" },
      ];
    }
    if (sub.startsWith("ask:")) {
      const id = sub.slice(4);
      const has = agentSkillsOf(id);
      const out: any[] = [...qHead("Agent: " + agentDisplayName(id) + " \u00b7 Skills")];
      // T519: enabled items on top (the app sorts selected-first everywhere).
      const skillsSorted = allSkillsList().slice().sort((a: string, b: string) => (has.includes(b) ? 1 : 0) - (has.includes(a) ? 1 : 0));
      for (const nm of skillsSorted) out.push({ value: "ast:" + id + ":" + nm, label: (has.includes(nm) ? "\u25cf " : "\u25cb ") + nm, description: has.includes(nm) ? "enabled" : "" });
      return out;
    }
    if (sub.startsWith("atk:")) {
      const id = sub.slice(4);
      const has = agentToolsOf(id);
      const out: any[] = [...qHead("Agent: " + agentDisplayName(id) + " \u00b7 Tools")];
      const toolsSorted4 = qToolsData.slice()
        .sort((a: any, b: any) => (b?.readOnly ? 1 : 0) - (a?.readOnly ? 1 : 0))
        .sort((a: any, b: any) => (has.includes(String(b?.name)) ? 1 : 0) - (has.includes(String(a?.name)) ? 1 : 0));
      for (const t of toolsSorted4) { const nm = String(t?.name || ""); if (!nm) continue; out.push({ value: "att:" + id + ":" + nm, label: (has.includes(nm) ? "\u25cf " : "\u25cb ") + nm, description: t?.readOnly ? "read-only" : "" }); }
      return out;
    }
    if (sub.startsWith("amc:")) {
      const id = sub.slice(4); // T522: "amc:" is 4 chars (was 6 -> id "sign-researcher", an agent that does not exist: the Select did nothing)
      const has = agentMcpOf(id);
      const out: any[] = [...qHead("Agent: " + agentDisplayName(id) + " \u00b7 MCP")];
      const mcpSorted5 = qMcpData.slice().sort((a: any, b: any) => (has.includes(String(b?.id || b?.name)) ? 1 : 0) - (has.includes(String(a?.id || a?.name)) ? 1 : 0));
      for (const m of mcpSorted5) { const mid = String(m?.id || m?.name || ""); if (!mid) continue; out.push({ value: "amt:" + id + ":" + mid, label: (has.includes(mid) ? "\u25cf " : "\u25cb ") + mid, description: "" }); }
      return out;
    }
    if (sub.startsWith("sk:")) {
      const nm = sub.slice(3);
      const out: any[] = [...qHead("Skill: " + nm)];
      const agsSorted = qAgentsData.slice()
        .map((a: any) => ({ a, id: String(a?.id || a?.name || "") }))
        .filter((x: any) => x.id)
        .sort((x: any, y: any) => (agentSkillsOf(y.id).includes(nm) ? 1 : 0) - (agentSkillsOf(x.id).includes(nm) ? 1 : 0));
      for (const x of agsSorted) out.push({ value: "ska:" + nm + ":" + x.id, label: (agentSkillsOf(x.id).includes(nm) ? "\u25cf " : "\u25cb ") + String(x.a?.name || x.id), description: x.id });
      return out;
    }
    if (sub.startsWith("mcp:")) {
      const mid = sub.slice(4);
      const out: any[] = [...qHead("MCP: " + mid)];
      const agsSorted2 = qAgentsData.slice()
        .map((a: any) => ({ a, id: String(a?.id || a?.name || "") }))
        .filter((x: any) => x.id)
        .sort((x: any, y: any) => (agentMcpOf(y.id).includes(mid) ? 1 : 0) - (agentMcpOf(x.id).includes(mid) ? 1 : 0));
      for (const x of agsSorted2) out.push({ value: "mcpa:" + mid + ":" + x.id, label: (agentMcpOf(x.id).includes(mid) ? "\u25cf " : "\u25cb ") + String(x.a?.name || x.id), description: x.id });
      return out;
    }
    if (sub.startsWith("tool:")) {
      const nm = sub.slice(5);
      const out: any[] = [...qHead("Tool: " + nm)];
      const agsSorted3 = qAgentsData.slice()
        .map((a: any) => ({ a, id: String(a?.id || a?.name || "") }))
        .filter((x: any) => x.id)
        .sort((x: any, y: any) => (agentToolsOf(y.id).includes(nm) ? 1 : 0) - (agentToolsOf(x.id).includes(nm) ? 1 : 0));
      for (const x of agsSorted3) out.push({ value: "tola:" + nm + ":" + x.id, label: (agentToolsOf(x.id).includes(nm) ? "\u25cf " : "\u25cb ") + String(x.a?.name || x.id), description: x.id });
      return out;
    }
    if (sub === "__input") {
      const label = qAgentsInputMode === "newagent" ? "Agent name: " + (menuSubFilter || "\u2026")
        : qAgentsInputMode === "skillpkg" ? "Skill package: " + (menuSubFilter || "\u2026")
        : "MCP source: " + (menuSubFilter || "\u2026");
      return [{ value: "__go", label, description: "type, then Enter \u00b7 Esc cancels" }];
    }
    if (sub.startsWith("agdel:")) {
      const id = sub.slice(6);
      return [{ value: "agdel-go:" + id, label: "", notice: "Delete agent \u201c" + id + "\u201d? Its config and prompt will be removed." }];
    }
    return [];
  };
  // T487: the WELCOME's agent selection (the app's welcome pre-config): one-shot,
  // applied to the new session on the first send, then reset to the defaults.
  let qWelcomeAgents: string[] | null = null;
  const sessionAgentIds = (): string[] => {
    try {
      if (welcomeShown) {
        if (qWelcomeAgents && qWelcomeAgents.length) return [...qWelcomeAgents];
        // T516: nothing picked in the welcome => show the CURRENT default agent,
        // read SYNCHRONOUSLY from the SAME FILE the app writes (quinki-settings.json):
        // no async, no caches, immediate — exactly the app's welcome behavior.
        const dfltW = String((wsSettings && (wsSettings as any).defaultAgentId) || readSettingsFile()?.defaultAgentId || "");
        if (dfltW) return [dfltW];
      }
    } catch {}
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
  // The ONE agent that replied (the app's rule): orchestrator wins when present,
  // else the first of the chat. NEVER the whole joined list.
  const oneAgentId = (v: any): string => {
    const ids = String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
    return ids.find((x) => x === "orchestrator") || ids[0] || "quinki";
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

  let pendingModelId = ""; // model chosen on the welcome (applies to the new chat)
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
  let qProvidersMem: any = null;
let qProvidersMtime = 0;
const readProvidersCfg = (): any => {
  try {
    const pp = qProvidersPath();
    let mt = 0;
    try { mt = require("fs").statSync(pp).mtimeMs; } catch {}
    // LIVE: se il file e' cambiato (app, sidecar, un'altra CLI) rileggi subito.
    if (qProvidersMem && mt && mt === qProvidersMtime) return qProvidersMem;
    qProvidersMtime = mt;
    qProvidersMem = JSON.parse(require("fs").readFileSync(pp, "utf8")) || {};
    return qProvidersMem;
  } catch { return qProvidersMem || {}; }
};
  const patchProvider = (name: string, fn: (p: any) => void) => {
    try {
      const cfg = readProvidersCfg();
      const provs = cfg.providers || (cfg.providers = {});
      const p = provs[name] || (provs[name] = {});
      fn(p);
      qProvidersMem = cfg; // instant UI (no RPC wait)
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
      // T515: the GLOBAL config too (defaultAgentId, plan-mode flags): the welcome
      // must show the new default even if the agents tab was never opened.
      try {
        const callB = (globalThis as any).__sidecarCall;
        if (callB) callB('getGlobalConfig', {}).then((r: any) => {
          try {
            const cfgB = (r && (r.config || r)) || {};
            wsSettings = { ...(wsSettings || {}), defaultAgentId: cfgB.defaultAgentId || (wsSettings || {}).defaultAgentId, planModeTools: cfgB.planModeTools || {}, planModeMcp: cfgB.planModeMcp || {} };
          } catch {}
          try { ui.requestRender(); } catch {}
        }).catch(() => {});
      } catch {}
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
  // Fallbacks source of truth (like the app): the SESSION's fallbackModels in a chat,
  // the global defaultFallbackModels in the welcome. Never "nothing".
  const fbSeedList = (): any[] => {
    try {
      if (currentKey && !welcomeShown) {
        const e0: any = readSessionsList().find((x: any) => x?.key === currentKey);
        if (e0 && Array.isArray(e0.fallbackModels)) return e0.fallbackModels;
      }
    } catch {}
    try { const ff = readSettingsFile().defaultFallbackModels; if (Array.isArray(ff)) return ff; } catch {}
    return Array.isArray(wsSettings?.defaultFallbackModels) ? wsSettings.defaultFallbackModels : [];
  };
  const settingsMenuItems = (): any[] => {
    const thM = String(wsSettings?.defaultThinkingLevel || readProvidersCfg().defaultThinking || "xhigh");
    let fbM = 0;
    try {
      // The REAL fallbacks live PER SESSION (s.fallbackModels) — the app reads them
      // there too. Globals only as last resort.
      const ent = readSessionsList().find((x: any) => x?.key === currentKey);
      if (ent && Array.isArray(ent.fallbackModels)) fbM = ent.fallbackModels.length;
    } catch {}
    if (!fbM) { try { const ff = readSettingsFile().defaultFallbackModels; if (Array.isArray(ff)) fbM = ff.length; } catch {} }
    if (!fbM && Array.isArray(wsSettings?.defaultFallbackModels)) fbM = wsSettings.defaultFallbackModels.length;
    return [
      { value: "model", label: "Default model", description: String((readProvidersCfg().defaultModel) || defaultModelId || "") },
      { value: "fallbacks", label: "Fallback models", description: fbM + " configured" },
      { value: "thinking", label: "Default thinking", description: thM === "off" ? "Off" : "On" },
      { value: "attachments", label: "Attachments folder", description: "~/.quinki/attachments" },
      { value: "providers", label: "Providers", description: "API keys, models" },
    ];
  };
  const settingsLevelItems = (stack: string[]): any[] => {
  const lv = stack[1];
  if (lv === "model") return modelPickerItems(String(readProvidersCfg().defaultModel || defaultModelId || ""));
  if (lv === "fallbacks" || lv === "thinking" || lv === "defaults") {
    const lastLv = stack[stack.length - 1];
    if (lv === "thinking" || stack[2] === "thinking") {
      const thX = String(wsSettings?.defaultThinkingLevel || readProvidersCfg().defaultThinking || "xhigh");
      const isOffX = thX === "off";
      return [
        { value: "on", label: (isOffX ? "\u25cb " : "\u25cf ") + "On", description: "Always the maximum level" },
        { value: "off", label: (isOffX ? "\u25cf " : "\u25cb ") + "Off", description: "Thinking disabled" },
      ];
    }
    if (stack[2] === "model") return modelPickerItems(String(readProvidersCfg().defaultModel || defaultModelId || ""));
    if (lastLv === "addfallback") return modelPickerItems("", fbSeedList());
    const _fbFromFileUnused = null;
    if (lv === "fallbacks" || stack[2] === "fallbacks") {
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
    if (stack[2] === "thinking") {
      const th = String(wsSettings?.defaultThinkingLevel || readProvidersCfg().defaultThinking || "xhigh");
      const isOff = th === "off";
      return [
        { value: "on", label: (isOff ? "\u25cb " : "\u25cf ") + "On", description: "Always the maximum level" },
        { value: "off", label: (isOff ? "\u25cf " : "\u25cb ") + "Off", description: "Thinking disabled" },
      ];
    }
    return [
      { value: "model", label: "Default model", description: String((readProvidersCfg().defaultModel) || defaultModelId || "") },
      { value: "fallbacks", label: "Fallback models", description: fbN + " configured" },
      { value: "thinking", label: "Thinking", description: th === "off" ? "Off" : "On" },
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
  if (lv === "providers" && stack[3] === "delprov") {
    const nm = String(stack[2] || "").replace(/^prov:/, "");
    return [{ value: "confirm", label: "", notice: "Delete provider \u201c" + nm + "\u201d? Its models and saved keys will be removed." }];
  }
  if (lv === "providers" && stack[3] === "logout") {
    const nm2 = String(stack[2] || "").replace(/^prov:/, "");
    return [{ value: "confirm", label: "", notice: "Sign out of " + nm2 + "?" }];
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
        // Totals per provider, ALWAYS visible (before opening the provider menu).
        let provTotal = 0;
        try {
          const seenT: Record<string, number> = {};
          for (const mm of (p.modelData || [])) { const id = String(mm?.id || ""); if (id) seenT[id] = 1; }
          for (const mm of wsAllModels) { if (String(mm?.provider || "") !== name) continue; const id = String(mm?.id || ""); if (id) seenT[id] = 1; }
          for (const mm of (wsProviderModels[name] || [])) { const id = String(mm?.id || ""); if (id) seenT[id] = 1; }
          provTotal = Object.keys(seenT).length;
          // Always refresh: the local modelData may be a tiny stale subset (2 vs 400).
          try { fetchProviderCatalog(name, String(p.baseUrl || ""), ""); } catch {}
        } catch {}
        out.push({
          value: "prov:" + name,
          label: (p.enabled ? "\u25cf " : "\u25cb ") + name,
          description: String((p.enabledModels || []).length) + " active" + (provTotal > 0 ? " \u00b7 " + provTotal + " total" : " \u00b7 loading\u2026"),
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
      // (the fetchProviderCatalog call follows below)
      // The FULL provider catalog (same RPC the app uses: OpenRouter /api/v1/models etc.)
      // apiKey EMPTY on purpose: the sidecar recovers the key and returns the FULL
      // public catalog (proven: 462 models on OpenRouter; passing the raw key gave 13).
      fetchProviderCatalog(name, String(p.baseUrl || ""), "");
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
      const rows = all.map((mm: any) => {
        const id = String(mm?.id || "");
        const on = en.includes(id);
        return { value: "mdl:" + id, label: (on ? "\u25cf " : "\u25cb ") + id, description: mm.name ? String(mm.name) : "", _rank: on ? en.indexOf(id) : 9999, _id: id };
      });
      // Selected first, in SELECTION order (the enabledModels array); the rest after.
      // The CURSOR stays at the same index (it does not jump up with the item).
      rows.sort((a: any, b: any) => (a._rank - b._rank) || a._id.localeCompare(b._id));
      rows.forEach((r: any) => { delete r._rank; delete r._id; });
      return rows;
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
    const totalM = (() => {
      const seen: Record<string, number> = {};
      for (const mm of (p.modelData || [])) { const id = String(mm?.id || ""); if (id) seen[id] = 1; }
      for (const mm of wsAllModels) { if (String(mm?.provider || "") !== name) continue; const id = String(mm?.id || ""); if (id) seen[id] = 1; }
      for (const mm of (wsProviderModels[name] || [])) { const id = String(mm?.id || ""); if (id) seen[id] = 1; }
      return Object.keys(seen).length;
    })();
    try { fetchKeyStatus(name, String(p.apiKey || "")); } catch {}
    try { fetchAllModels(); fetchProviderCatalog(name, String(p.baseUrl || ""), ""); } catch {}
    const out2: any[] = [
      { value: "__hdr_" + name, label: name, description: "", separator: true },
      { value: "models", label: "Models", description: String((p.enabledModels || []).length) + " on" + (totalM > 0 ? " \u00b7 " + totalM + " available" : " \u00b7 loading\u2026") },
      { value: "baseurl", label: "Base URL", description: String(p.baseUrl || "not set") },
    ];
    // API key row only for providers without an account login (custom/legacy).
    try {
      if (!["OpenRouter", "Anthropic", "xAI", "OpenAI", "GitHub Copilot", "Ollama"].includes(name)) {
        out2.push({ value: "key", label: "API key", description: wsKeyStatus[name] === true ? "set" : (wsKeyStatus[name] === false ? "not set" : "checking\u2026") });
      }
    } catch {}
    if (["OpenRouter", "Anthropic", "xAI", "OpenAI", "GitHub Copilot"].includes(name)) {
      const conn = wsKeyStatus[name] === true;
      out2.push({
        value: "login",
        label: conn ? "\u25cf Connected" : "Connect " + name,
        description: conn ? "signed in \u00b7 Enter to reconnect" : "sign in via browser (shared with the app)",
      });
      if (conn) out2.push({ value: "logout", label: "Sign out", description: "revoke the login for this provider" });
    }
    // Delete only for custom (non built-in) providers, like the app.
    if (!["OpenRouter", "Anthropic", "xAI", "OpenAI", "GitHub Copilot", "Ollama"].includes(name)) {
      out2.push({ value: "delprov", label: "Delete provider", description: "removes models and saved keys" });
    }
    return out2;
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
            const cur = welcomeShown
              ? (id === String(pendingModelId || defaultModelId || ""))
              : (String(wsModelId || "") === id || (!wsModelId && id === String(defaultModelId || "")));
            items.push({ value: id, label: (cur ? "\u25cf " : "\u25cb ") + id, description: prov, _lit: cur });
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
          { value: "on", label: (thinkingOn ? "\u25cf " : "\u25cb ") + "On", description: "Always the maximum level" },
          { value: "off", label: (thinkingOn ? "\u25cb " : "\u25cf ") + "Off", description: "Thinking OFF" },
        ].filter((i) => i.value.startsWith(prefix)),
    },
    {
      name: "compaction",
      description: "Compact now, or toggle auto-compaction",
      seq: 7,
      hidden: () => welcomeShown,
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
        const p = prefix.trim();
        // LIVE list from the sidecar (same data as the app: current + default + history).
        try {
          if (scOn && Date.now() - qDirsAt > 1500) {
            qDirsAt = Date.now();
            void sc.call("listWorkingDirs", { sessionKey: currentKey }, 15000)
              .then((r: any) => { if (r && typeof r === "object") { qDirs = r; try { ui.requestRender(); } catch {} } })
              .catch(() => {});
          }
        } catch {}
        const cur = currentDirAny();
        // Pending change: show the warning notice first (/quit style).
        if (dirPendingChange) {
          items.push({ value: "confirm", label: "", notice: dirPendingFiles + " file(s) remain in the previous folder. They stay there \u2014 move them yourself if you need them." });
          return items;
        }
        items.push({ value: "__dir_change", label: "Change directory\u2026", description: "" });
        items.push({ value: "__dir_hdr", label: "List of directories", separator: true });
        let dirsAll: any[] = Array.isArray(qDirs?.dirs) ? qDirs.dirs.slice() : [];
        try {
          if (welcomeShown) {
            // WELCOME: the chat hasn't started — there is NOTHING to list. Only a
            // folder YOU pick right now shows up (with the dot), nothing else.
            dirsAll = pendingWorkingDir ? [{ path: pendingWorkingDir, current: true }] : [];
          }
        } catch {}
        dirsAll.sort((a: any, b: any) => (a?.current === b?.current ? 0 : (a?.current ? -1 : 1)));
        if (!dirsAll.length && cur && !welcomeShown) dirsAll.push({ path: cur, current: true });
        for (const dd of dirsAll) {
          const dp = String(dd?.path || "");
          if (!dp) continue;
          const isCur = !!dd?.current || dp === currentDirAny();
          // EXACTLY the look of a selected model row: plain filled dot, no colors,
          // no white text — just ● path.
          items.push({ value: "__dir_use:" + dp, label: (isCur ? "\u25cf " : "\u25cb ") + dp, description: "" });
        }
        // Manual typing still works: the typed path is offered as-is.
        if (p && !p.startsWith("__")) items.unshift({ value: p, label: p, description: "use this path" });
        return items.filter((i: any) => !i.value.startsWith("__dir") || p === "" || !p.startsWith("__"));
      },
    },
    {
      name: "attachments",
      description: "Attachments: new file, folder, last sent",
      seq: 9,
      getArgumentCompletions: () => {
        const items: any[] = [];
        const sdir = path.join(os.homedir(), ".quinki", "attachments", String(currentKey || ""));
        items.push({ value: "__at_new", label: "Attach new file\u2026", description: "" });
        items.push({ value: "__at_open", label: "Open attachments folder", description: sdir.replace(os.homedir(), "~") });
        items.push({ value: "__at_hdr", label: "Last attachments", separator: true });
        try {
          const fsc = require("fs");
          const files: Array<{ n: string; m: number }> = [];
          for (const n of fsc.readdirSync(sdir)) {
            if (n.startsWith(".")) continue; // hidden files (.DS_Store…) never show
            try {
              const st = fsc.statSync(path.join(sdir, n));
              if (st.isFile()) files.push({ n, m: st.mtimeMs });
            } catch {}
          }
          files.sort((a, b) => b.m - a.m);
          if (!files.length) items.push({ value: "__at_none", label: "No attachments yet", description: "attach one with Enter" });
          for (const f of files) {
            const full = path.join(sdir, f.n);
            items.push({ value: "__at_file:" + full, label: ((menuMarked.has("__at_file:" + full) ? "\u25cf " : "\u25cb ") + f.n), description: "" });
          }
        } catch { items.push({ value: "__at_none", label: "No attachments yet", description: "" }); }
        return items;
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
          for (const s of skills) {
            const vv = "skill:" + g.agentId + ":" + s.name;
            const on = menuMarked.has(vv);
            items.push({ value: vv, label: (on ? "\u25cf " : "\u25cb ") + s.name, description: s.description || "skill" });
          }
        }
        return items;
      },
    },
    {
      name: "reset",
      description: "Clear messages. Keeps model, directory and settings.",
      seq: 11,
      hidden: () => welcomeShown,
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
            items.push({ value: k, label: String(s?.label || k), description: fmtWhen(ts), ts });
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
              items.push({ value: k, label: labels[k] || k, description: fmtWhen(ts), ts });
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
      // T487: also on the WELCOME (like the app): pick agents before starting —
      // the new session is born with them, then the welcome resets to defaults.
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
    { name: "reload", description: "Reload this chat (recover history, fix glitches)", seq: 4, hidden: () => welcomeShown },
    {
      name: "syncexpert",
      description: "Sync the App Expert with the latest Quinki build",
      // APP EXPERT CLI ONLY (the CLI twin of the app's manual sync): copies the
      // MAIN app's binary + sidecar into App Expert.app. Hidden everywhere else.
      // Next to /reset (the user's spot). SAME logic as /quit and /reset: it
      // asks for a confirm, then it does it. NEVER automatic: this command is
      // the ONLY sync there is — /quit and everything else never sync.
      hidden: () => !QEXPERT,
      seq: 11.5,
      getArgumentCompletions: () => [
        { value: "confirm", label: "", notice: "Sync the App Expert and restart this CLI?" },
      ],
    },
    { name: "export", description: "Export this chat as Markdown", seq: 10, hidden: () => welcomeShown },
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
      // T505: welcome-only AND main-CLI-only (the expert gets no settings at all).
      hidden: () => !welcomeShown || QEXPERT,
      seq: 13,
      getArgumentCompletions: () => settingsMenuItems(),
    },
    {
      name: "agents",
      description: "Agents, skills, MCP, tools, plan mode",
      // T505: the Agents tab in the CLI — welcome-only, main-CLI-only, right
      // above /settings (the user's spot).
      hidden: () => !welcomeShown || QEXPERT,
      seq: 12.5,
      getArgumentCompletions: () => agentAdminItems(),
    },
    {
      name: "quit",
      description: "Exit quinki (asks for confirmation)",
      seq: 14,
      getArgumentCompletions: () => [
        { value: "confirm", label: "", notice: "Quit quinki?" },
      ],
    },
  ];

  // App Expert mode: only the commands that make sense on the fixed expert
  // session (no settings, no chat management, no directory picking).
  try {
    if (QEXPERT) {
      // ONLY the chat-management commands are dropped in the Expert CLI: everything
      // else (settings, directory, agents) works exactly like the normal CLI.
      const drop = ["sessions", "rename", "delete"];
      for (const dn of drop) {
        const di = commands.findIndex((c: any) => c.name === dn);
        if (di >= 0) commands.splice(di, 1);
      }
    }
  } catch {}
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
      // Backspace on empty box: chips are INLINE tokens now — the cursor already
      // deletes them like text. Nothing special to do.
      // Trace EVERY input chunk (a ring of the last 25) so the exact bytes that
      // kill the CLI show up in the survive log.
      try {
        const gv: any = globalThis as any;
        gv.__qInputRing = gv.__qInputRing || [];
        gv.__qInputRing.push({ t: Date.now(), d: JSON.stringify(String(data)).slice(0, 120) });
        if (gv.__qInputRing.length > 25) gv.__qInputRing.shift();
        try { require("fs").writeFileSync("/tmp/q-cli-input-ring.json", JSON.stringify(gv.__qInputRing, null, 1)); } catch {}
      } catch {}
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
      try { require("fs").appendFileSync("/tmp/q-filter-trace.log", new Date().toISOString() + " IN hex=" + Buffer.from(String(data), "utf8").toString("hex").slice(0,50) + " menu=" + (menuOpenRef?.() ?? false) + "\n"); } catch {}
      // Filter control sequences AFTER the split-recomposition (they arrive in
      // two reads when the app window closes: \x1b[6;17;8 + t): the parser was
      // treating them as keystrokes and confirming the /quit notice.
      try {
        if (typeof data === "string" && /\x1b\[I|\x1b\[O|\x1b\[[0-9;]*t/.test(data)) {
          try { require("fs").appendFileSync("/tmp/q-cli-survive.log", "filtered control seq (post-merge): " + JSON.stringify(data) + "\n"); } catch {}
          const cleaned = data.replace(/\x1b\[I|\x1b\[O|\x1b\[[0-9;]*t/g, "");
          if (cleaned.length === 0) return { consume: true } as any;
          return { data: cleaned };
        }
      } catch {}
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
      // Kitty-capable terminals report key RELEASE events (e.g. "\x1b[1;1:3C"):
      // they must NEVER be treated as a second press — ↓ would jump two rows and
      // → would confirm & close the menu at once. Drop them all.
      if (isKeyRelease(data)) {
        return { consume: true };
      }
      // Kitty-capable terminals ALSO send the PRESS with an explicit ":1" event
      // marker — e.g. TAB = "\x1b[9;1:1u". Normalize it to the plain form the
      // handlers know (otherwise the Tab is silently LOST: no select, no toggle).
      try {
        const norm = String(data)
          .replace(/\x1b\[13;1:1u$/, "\r")     // Enter (kitty press)
          .replace(/\x1b\[127;1:1u$/, "\x7f")  // Backspace (kitty press)
          .replace(/\x1b\[9;1:1u$/, "\t")      // Tab (kitty press)
          .replace(/\x1b\[9:1u$/, "\t")
          .replace(/\x1b\[1;1:1([ABCD])$/, (_: string, c2: string) => "\x1b[" + c2) // arrows (press)
          .replace(/\x1b\[1;1([ABCD])$/, (_: string, c2: string) => "\x1b[" + c2);   // arrows (plain kitty)
        if (norm !== data) data = norm;
      } catch {}
      // BRACKETED PASTE (\x1b[200~ … \x1b[201~): the terminal wraps Cmd+V like
      // this. With a menu open the content MUST go into the menu FIELD (path,
      // filters) — never into the editor textbox.
      try {
        if (typeof data === "string" && data.includes("\x1b[200~")) {
          const inner = String(data)
            .replace(/^\x1b\[200~/, "")
            .replace(/\x1b\[201~/g, "")
            .replace(/\r/g, "");
          const clean0 = inner.split("").filter((ch) => ch >= " " && ch !== "\x7f").join("");
          if (clean0 && menuOpenRef?.() && menuStack.length > 0) {
            if (menuStack[0] === "directory" && menuStack[1] === "dirchange" && !dirTypeMode) {
              dirTypeMode = true;
              menuSubFilter = "";
            }
            menuSubFilter += clean0;
            if (menuStack[0] === "directory" && menuStack[1] === "dirchange") menuSel = 1;
            else menuSel = 0;
            menuConfirmFocus = false;
            try { ui.requestRender(); } catch {}
            return { consume: true };
          }
          // T448: dropping files (Finder drag) or pasting path(s): each REAL file
          // path becomes an ATTACHMENT with a chip in the box — ONLY the file name
          // (never the path: its leading "/" would even light the slash menu and
          // block the send entirely).
          if (clean0) {
            try {
              const fsp = require("fs");
              const cands = inner.split(/[\r\n]+/).map((x) => x.trim()).filter(Boolean);
              const conv: string[] = [];
              for (const cand of cands) {
                const p0 = String(cand).replace(/\\ /g, " ");
                if (!p0.startsWith("/")) continue;
                let isF = false;
                try { isF = fsp.existsSync(p0) && fsp.statSync(p0).isFile(); } catch {}
                if (!isF) continue;
                const stC = stageAttachment(p0) || { path: p0, originalName: require("path").basename(p0) };
                try { pendingAttachments.push(stC as any); } catch {}
                const nmC = String((stC as any).originalName);
                attPathByName[nmC] = String((stC as any).path);
                conv.push(nmC);
              }
              if (conv.length) {
                let curE = String(editor.getText() || "");
                for (const nmC of conv) curE = String(curE).replace(/[ \t]+$/, "") + " " + nmC;
                editor.setText(curE);
                try { editor.setCursorCol(editor.getText().length); } catch {}
                qCursorEnd();
                try { ui.requestRender(); } catch {}
                return { consume: true };
              }
            } catch {}
          }
          // No menu open: leave it to the editor (normal paste in the textbox).
        }
      } catch {}
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
        if (menuIsOpen) {
          try { require("fs").appendFileSync("/tmp/q-tab2.log", new Date().toISOString() + " isTab->select stack=" + JSON.stringify(menuStack) + " refNull=" + String(!menuNavRef) + "\n"); } catch {}
          try { menuNavRef?.("select"); } catch {}
          try { ui.requestRender(); } catch {}
          return { consume: true };
        }
        try { require("fs").appendFileSync("/tmp/q-tab2.log", new Date().toISOString() + " isTab->TOGGLE-MODE (menu closed!) stack=" + JSON.stringify(menuStack) + "\n"); } catch {}
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
      try {
        const hex = Buffer.from(String(data), "utf8").toString("hex").slice(0, 60);
        require("fs").appendFileSync("/tmp/q-keys-trace.log", new Date().toISOString() + " KEY hex=" + hex + " len=" + String(data).length + " isRight=" + isRight + " isDown=" + (data === "\x1b[B" || matchesKey(data, "down")) + " menuNow=" + (menuOpenRef?.() ?? false) + "\n");
      } catch {}
      const menuNow = menuOpenRef?.() ?? false;
      if (isEnter) { try { require("fs").appendFileSync("/tmp/q-enter-trace.log", new Date().toISOString() + " listener enter menuNow=" + menuNow + " text=" + JSON.stringify(String(editorText() || "").slice(0, 30)) + "\n"); } catch {} }
      if (isCtrlEnter && !menuNow && streaming) {
        // Steer: send a new instruction into the RUNNING turn.
        const txt = editorText().trim();
        if (txt) {
          try {
            editor.setText("");
          } catch {}
          pushBlock(new UserBubble(txt, fmtFooterDate(Date.now())));
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
      // T504 — THE BUG (the user's /reload): this early-return swallowed the Enter
      // on a bare "/" BEFORE the menu ever saw it, so moving the selector onto a
      // command and pressing Confirm did ABSOLUTELY NOTHING. The menu must handle
      // that Enter (it executes the highlighted row).
      // Atomic chips: ← / → hop over a whole "Skill: name" clip (write before/after).
      try {
        if (!menuNow && (isLeft || isRight)) {
          const st: any = (editor as any).state;
          if (st && Array.isArray(st.lines)) {
            const ln = String(st.lines[st.cursorLine] ?? "");
            const col = Number(st.cursorCol) || 0;
            const re = qTokRe();
            let m2m: RegExpExecArray | null;
            let hopped = false;
            while ((m2m = re.exec(ln))) {
              const a = m2m.index, b = m2m.index + m2m[0].length;
              if (isRight && col > a && col < b) { (editor as any).setCursorCol(b + (ln.charAt(b) === " " ? 1 : 0)); hopped = true; break; }
              if (isRight && col === a) { (editor as any).setCursorCol(b + (ln.charAt(b) === " " ? 1 : 0)); hopped = true; break; }
              if (isRight && a > 0 && col === a - 1) {
                // From the cell right before the chip: remove the AUTO space if it is
                // ours (the chip shifts back left) and jump PAST the chip.
                if (qAutoSpace && qAutoSpace.line === st.cursorLine && qAutoSpace.col === col && qAutoSpace.text === ln) {
                  const nl4 = ln.slice(1);
                  st.lines[st.cursorLine] = nl4;
                  qAutoSpace = null;
                  try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
                  try { (editor as any).setCursorCol(Math.max(0, b - 1)); } catch {}
                } else {
                  (editor as any).setCursorCol(b + (ln.charAt(b) === " " ? 1 : 0));
                }
                hopped = true; break;
              }
              if (isLeft && col > a && col <= b + 1) {
                if (a === 0) {
                  // T441 — the user's recipe: the chip starts the line => INSERT a
                  // space, shift the chip right by one and take that cell. The
                  // cursor sits BEFORE the chip, never on its first letter.
                  const nl3 = " " + ln;
                  st.lines[st.cursorLine] = nl3;
                  qAutoSpace = { line: st.cursorLine, col: 0, text: nl3 };
                  try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
                  try { (editor as any).setCursorCol(0); } catch {}
                } else {
                  (editor as any).setCursorCol(a - 1);
                }
                hopped = true; break;
              }
            }
            if (hopped) { try { ui.requestRender(); } catch {} return { consume: true }; }
          }
        }
      } catch {}
      if (menuNow) {
        try {
          if (menuStack[0] === "skill" || menuStack[0] === "attachments") {
            killAutocomplete(); // the INTERNAL editor panel never overlaps our menu
          }
        } catch {}
        if (isUp || isDown || isLeft || isRight || isEnter) {
          menuNavRef?.(isSelect ? "select" : isUp ? "up" : isDown ? "down" : isLeft ? "left" : isRight ? "right" : "enter");
          return { consume: true };
        }
        if (menuStack.length > 0) {
          // Typing inside a submenu filters the options — never writes in the box.
          // PASTES (Cmd+V) arrive as MULTI-CHAR chunks: they go into the FIELD too,
          // never into the editor textbox (otherwise you could never paste a path).
          if (data.length >= 1 && !data.includes("\x1b")) {
            const printable = String(data)
              .split("")
              .filter((ch) => ch >= " " && ch !== "\x7f")
              .join("");
            if (printable) {
              // Directory submenu: typing/pasting the path STARTS RIGHT HERE:
              // the row becomes "Path: …" and Enter confirms.
              if (menuStack[0] === "directory" && menuStack[1] === "dirchange" && !dirTypeMode) {
                dirTypeMode = true;
                menuSubFilter = "";
              }
              menuSubFilter += printable;
              // Directory path: the cursor STAYS on the path row (Confirm appears).
              if (menuStack[0] === "directory" && menuStack[1] === "dirchange") menuSel = 1;
              else menuSel = 0;
              menuConfirmFocus = false;
              try {
                ui.requestRender();
              } catch {}
              return { consume: true };
            }
          }
          if (data === "\x7f" || data === "\x08" || matchesKey(data, "backspace")) {
            // backspace NEVER moves the selector: on the path field it deletes the
            // last character; anywhere else in this menu it does nothing visible.
            if (menuStack[0] === "directory" && menuStack[1] === "dirchange") {
              menuSubFilter = menuSubFilter.slice(0, -1);
              menuSel = 1; // stay on the path row
            } else {
              menuSubFilter = menuSubFilter.slice(0, -1);
              menuSel = 0;
            }
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
      const root = (welcome && !QEXPERT)
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
  // T442: remembers the space auto-inserted by the left arrow before a line-start
  // chip, so the right arrow can REMOVE it (the round trip: <- shifts the chip
  // right, -> shifts it back and jumps past it). Any text change invalidates it.
  let qAutoSpace: { line: number; col: number; text: string } | null = null;
  let dirTypeMode = false; // "Type path": the menu becomes a path input
  let pendingWorkingDir = ""; // /directory chosen in the welcome -> the new chat
  const skillRefsByName: Record<string, Array<{ agentId: string; skillName: string; agentName: string }>> = {}; // skill chips: WHICH agent owns it
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
  let lastDoneAgent = ""; // THE agent that actually replied (from the done event)
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
    const modelId = (welcomeShown ? (pendingModelId || defaultModelId || wsModelId) : (wsModelId || defaultModelId)) || "";
    const sep = fg(C.textTertiary, " \u00b7 ");
    const quiet = (s: string) => fg(C.textTertiary, s);
    const modeStr = mode === "plan" ? fg(C.modePlan, "Plan (Tab)") : fg(C.modeBuild, "Build (Tab)");
    // Bar = mode + counter ONLY: model and thinking are read in the footer (like the app).
    const bar = modeStr + sep + ctxStr;
    // Status pill (app-style): same row as the info, right-aligned — visible
    // only while the engine streams / compacts (Failed stays until next turn).
    const pillOn =
      !!statusLabel && (streaming || statusKind === "compacting" || statusKind === "failed" || statusKind === "sending" || statusKind === "syncing");
    if (!pillOn) return bar;
    const statusColor: Record<string, string> = {
      running: C.statusRunning,
      compacting: C.statusCompacting,
      sending: C.modePlanDim,
      syncing: C.statusRunning,
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
    (editor as any).edgeFn = () => panelBgWrap(fg(mode === "plan" ? C.modePlan : C.modeBuild, "\u258f"));
    (editor as any).edgeRightFn = () => panelBgWrap(fg(C.primary, "\u2595")) + "\x1b[49m";
    // Chips live INSIDE the text as inline tokens ("\u25b8name"): no bar above the
    // box, no X — move the cursor around them and delete them like text.
    (editor as any).qChipsFn = () => "";
    (editor as any).qTokenRender = (ch: string) => qTokenRender(ch);
    (editor as any).qTokenStyle = (m2: string): string => {
      try {
        return (
          "\x1b[48;2;201;112;132m" + "\x1b[38;2;8;8;11m" + m2 +
          "\x1b[48;2;15;15;19m" + "\x1b[38;2;232;232;236m"
        );
      } catch { return m2; }
    };
    (editor as any).qTokenStyle = (tok: string) => qTokenStyle(tok);
    // ATOMIC chips: backspace ON a "\u25b8token" deletes the WHOLE token at once.
    (editor as any).qUpDownHop = (dir: "up" | "down") => {
      try {
        const st: any = (editor as any).state;
        if (!st || !Array.isArray(st.lines)) return false;
        const ln = String(st.lines[st.cursorLine] ?? "");
        const col = Number(st.cursorCol) || 0;
        const re = qTokRe();
        let m: RegExpExecArray | null;
        while ((m = re.exec(ln))) {
          const a = m.index, b = m.index + m[0].length;
          const past = b + (ln.charAt(b) === " " ? 1 : 0);
          if (dir === "up") {
            // THE TWIN OF THE LEFT ARROW: from on/right of the chip -> land BEFORE it.
            if (col > a && col <= b + 1) {
              if (a === 0) {
                const nl = " " + ln;
                st.lines[st.cursorLine] = nl;
                qAutoSpace = { line: st.cursorLine, col: 0, text: nl };
                try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
                try { (editor as any).setCursorCol(0); } catch {}
              } else {
                try { (editor as any).setCursorCol(a - 1); } catch {}
              }
              try { ui.requestRender(); } catch {}
              return true;
            }
          } else {
            // THE TWIN OF THE RIGHT ARROW: inside/at the chip -> past; from the cell
            // right before -> the round trip (remove the auto space, cross over).
            if (col > a && col < b) { try { (editor as any).setCursorCol(past); } catch {} try { ui.requestRender(); } catch {} return true; }
            if (col === a) { try { (editor as any).setCursorCol(past); } catch {} try { ui.requestRender(); } catch {} return true; }
            if (a > 0 && col === a - 1) {
              if (qAutoSpace && qAutoSpace.line === st.cursorLine && qAutoSpace.col === col && qAutoSpace.text === ln) {
                st.lines[st.cursorLine] = ln.slice(1);
                qAutoSpace = null;
                try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
                try { (editor as any).setCursorCol(Math.max(0, b - 1)); } catch {}
              } else {
                try { (editor as any).setCursorCol(past); } catch {}
              }
              try { ui.requestRender(); } catch {}
              return true;
            }
          }
          if (col < a) break;
        }
      } catch {}
      return false;
    };
    (editor as any).qChipRe = () => qTokRe();
    (editor as any).qSnapOutOfChip = () => {
      try {
        const st: any = (editor as any).state;
        if (!st || !Array.isArray(st.lines)) return;
        const line = String(st.lines[st.cursorLine] ?? "");
        const col = Number(st.cursorCol) || 0;
        const re = qTokRe();
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          const a = m.index;
          const b = m.index + m[0].length;
          // Never rest inside a chip after an up/down move: land BEFORE it, with the
          // SAME recipe as the arrows (insert the space when the chip starts the line).
          if (col >= a && col < b) {
            if (a === 0) {
              const nl = " " + line;
              st.lines[st.cursorLine] = nl;
              try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
              try { (editor as any).setCursorCol(0); } catch {}
            } else {
              try { (editor as any).setCursorCol(a - 1); } catch {}
            }
            try { ui.requestRender(); } catch {}
            return;
          }
          if (col < a) break;
        }
      } catch {}
    };
    (editor as any).qAtomicDelete = (forward?: boolean) => {
      try {
        const st: any = (editor as any).state;
        if (!st || !Array.isArray(st.lines)) return false;
        const line = String(st.lines[st.cursorLine] ?? "");
        const col = Number(st.cursorCol) || 0;
        // Find a token that ENDS at the cursor (or the cursor sits inside it).
        const re = qTokRe();
        let m: RegExpExecArray | null;
        while ((m = re.exec(line))) {
          const a = m.index;
          const b = m.index + m[0].length;
          // The chips are followed by ONE space: the cursor right after it (b+1)
          // must still count as "on the chip" (otherwise the space is deleted and
          // the next word merges INTO the token).
          if (forward) {
            // DELETE (forward): the cursor at the chip's START (or inside it) kills it whole.
            if (col >= a && col < b) {
              const nl2 = line.slice(0, a) + (line.charAt(b) === " " ? line.slice(b + 1) : line.slice(b));
              st.lines[st.cursorLine] = nl2;
              try { (editor as any).setCursorCol(a); } catch {}
              try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
              try { ui.requestRender(); } catch {}
              return true;
            }
            // T444: ONE press from the cell right before the chip kills the whole chip
            // (the auto space goes with it) — no more two-press dance.
            if (col === a - 1) {
              // T467: mangia lo spazio precedente SOLO se è il NOSTRO auto-spazio
              // (quello della ricetta <-). Quello dell'utente = si cancella da solo
              // (nativo): la pill parte alla pressione successiva.
              const isAuto = !!(qAutoSpace && qAutoSpace.line === st.cursorLine && qAutoSpace.col === (a - 1) && qAutoSpace.text === line);
              if (!isAuto) return false;
              const eatSpace = (a > 0 && line.charAt(a - 1) === " " && isAuto) ? 1 : 0;
              const start = a - eatSpace;
              const nl3 = line.slice(0, start) + (line.charAt(b) === " " ? line.slice(b + 1) : line.slice(b));
              st.lines[st.cursorLine] = nl3;
              try { (editor as any).setCursorCol(start); } catch {}
              try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
              try { ui.requestRender(); } catch {}
              return true;
            }
            continue;
          }
          if (col > a && col <= b) {
            // T467 (regola utente): la pill = SOLO la pill. Con un carattere/spazio
            // tra il cursore e la pill, il backspace cancella PRIMA quello (nativo);
            // la pill parte alla pressione successiva, quando il cursore è attaccato.
            const nline = line.slice(0, a) + line.slice(b);
            st.lines[st.cursorLine] = nline;
            try { editor.setCursorCol(a); } catch {}
            try { if (typeof (editor as any).onChange === "function") (editor as any).onChange(editor.getText()); } catch {}
            try { ui.requestRender(); } catch {}
            return true;
          }
        }
      } catch {}
      return false;
    };
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
        fg(C.danger, "Close (Esc)") +
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
    const cmdReady = !menuActive && textNow.startsWith("/") && textNow.length > 1 && !qIsFilePath(textNow);
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
    const brand = welcomeShown ? "" : fg(C.primary, "\u2502") + " " + fg(C.primary, QEXPERT ? "App Expert" : "Quinki") + " " + fg(C.primary, "\u2502");
    const lw = visibleWidth(left);
    const rw = visibleWidth(right);
    const bw = welcomeShown ? 0 : visibleWidth(brand); // REAL brand width (App Expert is longer than Quinki)
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

  // SEAL (like the app's T116): a writing ENDS when a new block starts — its
  // footer shows THAT writing's end time, live during the turn.
  const sealWritingFooter = () => {
    try {
      if (!assistantText.trim()) return;
      let agentName = lastDoneAgent || sessionAgentIds()[0] || "quinki";
      let lvl = thinkingOn ? "xhigh" : "off";
      try {
        const e0 = readSessionsList().find((s: any) => s?.key === currentKey);
        const mk = lastMsgKey(currentKey);
        if (mk && e0?.messageAgents?.[mk]) agentName = String(e0.messageAgents[mk]);
        if (mk && e0?.messageThinking?.[mk]) lvl = String(e0.messageThinking[mk]);
      } catch {}
      agentName = oneAgentId(agentName); // ONE agent
      pushBlock(new FooterRow(fmtFooterDate(Date.now()), agentDisplayName(agentName) + " \u00b7 " + (wsModelId || defaultModelId || "") + " \u00b7 " + levelLabel(lvl), true));
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
          // The thinking is OVER: close its toggle NOW (app behaviour), during the
          // generation — not only when a tool starts.
          if (thinkingRow) { thinkingRow.open = false; try { ui.requestRender(); } catch {} }
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
        if (thinkingRow) { thinkingRow.open = false; }
        // The writing just ENDED: seal its footer NOW, then a NEW writing starts.
        sealWritingFooter();
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
        try { require("fs").appendFileSync("/tmp/q-footer-trace.log", new Date().toISOString() + " msg_end role=" + String(e?.message?.role) + " hadText=" + JSON.stringify(hadText.slice(0, 40)) + " last=" + JSON.stringify(String(lastAssistantText).slice(0, 40)) + " stop=" + String(e?.message?.stopReason) + "\n"); } catch {}
        lastAssistantText = "";
        if (hadText && e?.message?.stopReason !== "aborted") {
        try {
          let agentName = lastDoneAgent || sessionAgentIds()[0] || "quinki";
          let lvl = thinkingOn ? "xhigh" : "off";
          try {
            const e0 = readSessionsList().find((s: any) => s?.key === currentKey);
            const mk = lastMsgKey(currentKey);
            if (mk && e0?.messageAgents?.[mk]) agentName = String(e0.messageAgents[mk]);
            if (mk && e0?.messageThinking?.[mk]) lvl = String(e0.messageThinking[mk]);
          } catch {}
          agentName = oneAgentId(agentName); // ONE agent only
          pushBlock(new FooterRow(fmtFooterDate(Date.now()), agentDisplayName(agentName) + " \u00b7 " + (wsModelId || defaultModelId || "") + " \u00b7 " + levelLabel(lvl), true));
        } catch {}
        }
        if (e?.message?.stopReason === "error") {
          // Provider/sidecar error — EXACTLY the app's format (MessageBubble):
          // plain red text, pre-wrap, no box and no toggle, then the normal
          // footer (agent · model · thinking). Never a pill in the text box.
          const ec = String((e?.message as any)?.errorMessage || "").trim();
          if (ec) {
            try {
              pushBlock({ render: (w: number) => wrapPlain(ec, Math.max(10, w)).map((ln: string) => fg(C.danger, ln)), invalidate: () => {} } as any);
              let an2 = lastDoneAgent || sessionAgentIds()[0] || "quinki";
              an2 = oneAgentId(an2);
              pushBlock(new FooterRow(fmtFooterDate(Date.now()), agentDisplayName(an2) + " \u00b7 " + (wsModelId || defaultModelId || "") + " \u00b7 " + levelLabel(thinkingOn ? "xhigh" : "off"), true));
              scrollToEnd();
              try { (ui as any).requestImmediateRender?.(); } catch {}
            } catch {}
          }
        }
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
  let histStores: { skills: any; atts: any; displays: any } = { skills: {}, atts: {}, displays: {} };

  /** Ask the SIDECAR for the history — the exact source the app uses: correct
   *  order, blocks normalized, footers with the real agent/model/level. */
  const loadServerHistory = async (beforeTs?: number): Promise<boolean> => {
    try { qDirs = null; qDirsKick(); } catch {}
    // T477: scOn is set ONLY by the boot's first connect attempt: if the sidecar
    // was still starting back then (e.g. right after /syncexpert restarted it),
    // scOn stayed false forever and the session never loaded even though the ws
    // reconnected. The live connection flag is the truth.
    if (!scOn && !(sc as any).connected) return false;
    try {
      if (typeof beforeTs === "number" && beforeTs > 0) {
        const r = await sc.call("getHistoryBefore", { sessionKey: currentKey, ts: beforeTs, limit: 50 }, 30000);
        const more = Array.isArray(r?.messages) ? r.messages : [];
        if (histMsgs && more.length) histMsgs = more.concat(histMsgs);
        return more.length > 0;
      }
      const r = await sc.call("getHistory", { sessionKey: currentKey, limit: 50 }, 30000);
      histMsgs = Array.isArray(r?.messages) ? r.messages : [];
      // THE CHIPS STORES (the app's mechanism): reloaded bubbles keep their clips.
      histStores = {
        skills: (r && (r as any).messageSkills) || {},
        atts: (r && (r as any).messageAttachments) || {},
        displays: (r && (r as any).messageDisplayTexts) || {},
      };
      return histMsgs.length > 0;
    } catch (ee) {
      try { require("fs").appendFileSync("/tmp/q-load.log", "  loadServerHistory ERROR: " + String(ee) + "\n"); } catch {}
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
            // Thinking done: close the toggle immediately (app behaviour).
            if (thinkingRow) { thinkingRow.open = false; try { ui.requestRender(); } catch {} }
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
          // The writing just ENDED: seal its footer NOW (app behaviour), then the
          // next text starts a NEW writing with its own footer.
          sealWritingFooter();
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
        // The REAL agent that replied travels here (same as the app): remember it
        // so the footer shows THAT agent, never the chat's whole list.
        try { if (p?.agentName) lastDoneAgent = oneAgentId(p.agentName); } catch {}
        onSessionEvent({ type: "message_end", message: { role: "assistant", stopReason: p?.stopReason, errorMessage: p?.errorMessage } });
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
      } else if (method === "compaction_status") {
        // THE MISSING PIECE (1 ott notte): the sidecar broadcasts compaction_status
        // (start/end with summary/noop) as its own method — the CLI only listened
        // inside stream_event, so neither the pill nor the toggle ever appeared.
        const st = String(p?.status || "");
        if (st === "start") {
          setStatus("Compacting", "compacting");
        } else if (st === "end" || st === "noop" || st === "error") {
          if (statusKind === "compacting") setStatus("", "");
          const noop = st === "noop";
          pushBlock(
            registerToggle(
              new ToggleBlock({
                label: "Compaction",
                boldName: noop ? "ineffective" : "effective",
                color: noop ? C.expert : C.info,
                body: String(p.summary || p.message || p.errorMessage || ""),
              })
            )
          );
          scrollToEnd();
        }
      } else if (method === "error") {
        // Errors from the runtime (500s etc.) must be VISIBLE in the CLI too.
        setStatus("Failed", "failed");
        const em = String(p?.message || "Unknown error");
        // PLAIN red writing (like the app): errors are NEVER toggles.
        pushBlock({ render: (w: number) => wrapPlain(em, Math.max(10, w)).map((ln: string) => fg(C.danger, ln)), invalidate: () => {} } as any);
        scrollToEnd();
      } else if (method === "session_created" || method === "session_deleted") {
        // INSTANT sync: a chat created/deleted anywhere (app, other CLI) shows here.
        try { refreshSessions(); } catch {}
        try { ui.requestRender(); } catch {}
      } else if (method === "user_message") {
        // A message sent from the app (or another CLI) into THIS chat: show it live.
        try {
          if (!p?.sessionKey || p.sessionKey === currentKey) {
            const txt = String(p?.text || p?.content || "");
            if (txt.trim()) { pushBlock(new UserBubble(txt, fmtFooterDate(Date.now()))); scrollToEnd(); try { ui.requestRender(); } catch {} }
          }
        } catch {}
      } else if (method === "model_updated" || method === "models_list") {
        // Provider/model changes anywhere: refresh the model bar live.
        try { wsAllModels = Array.isArray(p?.models) ? p.models : wsAllModels; } catch {}
        try { if (p?.model && p?.sessionKey === currentKey) wsModelId = String(p.model); } catch {}
        try { ui.requestRender(); } catch {}
      } else if (method === "thinking_updated") {
        try { if (p?.sessionKey === currentKey && typeof p?.level === "string") { thinkingOn = String(p.level) !== "off"; updateBar(); } } catch {}
        try { ui.requestRender(); } catch {}
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
          if (Array.isArray(p.fallbackModels)) { try { wsSettings = { ...(wsSettings || {}), defaultFallbackModels: p.fallbackModels }; } catch {} }
          updateBar();
          try { ui.requestRender(); } catch {}
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
            if (o?.type === "message" && o?.message?.role) {
              const mm = o.message;
              if (mm.isCompactionSummary || mm.isCompactionWarning) out.push({ kind: "compaction", id: o.id, pid: o.parentId, file: f, body: String(mm.content || ""), noop: !!mm.isCompactionWarning });
              else out.push({ kind: "message", message: mm, id: o.id, pid: o.parentId, file: f });
            }
            else if (o?.type === "compaction") out.push({ kind: "compaction", id: o.id, pid: o.parentId, file: f, body: String(o.summary || "") });
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
            const chipsH: Array<{ kind: string; name: string }> = [];
            try {
              // The app's matching chain: textKey -> message id -> ts-<ts> -> "" (chip-only).
              const textKey = String(t || "").substring(0, 200);
              const tsMs = Number(m.timestamp) || 0;
              const mid2 = m.id ? String(m.id) : "";
              const pick = (store: any): any => (
                (store && textKey && store[textKey]) ||
                (mid2 && store && store[mid2]) ||
                (tsMs && store && store["ts-" + tsMs]) ||
                undefined
              ); // T464: NIENTE fallback "" (una skill finiva su OGNI messaggio)
              const sks = Array.isArray((m as any).skillNames) && (m as any).skillNames.length ? (m as any).skillNames : pick(histStores.skills);
              const attsH = Array.isArray(m.attachments) && m.attachments.length ? m.attachments : pick(histStores.atts);
              for (const a of (Array.isArray(attsH) ? attsH : [])) chipsH.push({ kind: "attachment", name: String((a as any)?.originalName || require("path").basename(String((a as any)?.path || ""))) });
              for (const sk of (Array.isArray(sks) ? sks : [])) chipsH.push({ kind: "skill", name: String((sk as any)?.skillName || sk) });
              // THE SAVED DISPLAY TEXT: the bubble with the REAL inline clips, identical
              // to the live one. Old messages (no displayText store) get an inline
              // RECONSTRUCTION from the chips — same graphics AND order as the app's
              // bubble (tokens first, then the text), never a separate chip row.
              const dtRaw = pick(histStores.displays);
              let tDisp = (typeof dtRaw === "string" && dtRaw) ? dtRaw : "";
              let usedInline = !!tDisp;
              if (!tDisp && chipsH.length) { // T464: solo se il messaggio HA davvero le sue clip
                try {
                  const toks = chipsH.map((c) => (c.kind === "skill" ? "Skill: " + c.name : "\u25b8" + c.name)).join(" ");
                  tDisp = toks + (t.trim() ? " " + t : "");
                  usedInline = true;
                } catch { tDisp = t; usedInline = false; }
              }
              if (!tDisp) tDisp = t;
              if (tDisp.trim() || chipsH.length) pushBlock(new UserBubble(tDisp, fmtFooterDate(Number(m.timestamp) || Date.now()), usedInline ? [] : chipsH));
            } catch { if (t.trim() || chipsH.length) pushBlock(new UserBubble(t, fmtFooterDate(Number(m.timestamp) || Date.now()), chipsH)); }
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
                      info: agentDisplayName(oneAgentId(m.agentName)) + " \u00b7 " + String(m.agentModel || m.model || "") + " \u00b7 " + levelLabel(String(m.thinkingLevel || "off")),
                    });
                  } catch {}
                }
              }
            } catch {}
            try {
              const dts = Number(m.timestamp) || Date.now();
              tg._taskFooterDate = fmtFooterDate(dts);
              tg._taskFooterInfo = agentDisplayName(oneAgentId(m.agentName)) + " \u00b7 " + String(m.agentModel || m.model || defaultModelId || "") + " \u00b7 " + levelLabel(String(m.thinkingLevel || "off"));
            } catch {}
            pushBlock(registerToggle(tg));
          } else if (m?.role === "assistant") {
            if (m?.isCompactionSummary || m?.isCompactionWarning) {
              // THE RPC PATH (the one actually used): the summary MUST live inside
              // the toggle — body + skip the text, exactly like the app.
              const nw = !!m?.isCompactionWarning;
              pushBlock(registerToggle(new ToggleBlock({ label: "Compaction", boldName: nw ? "ineffective" : "effective", color: nw ? C.expert : C.info, body: String(m.content || "") })));
              continue;
            }
            if (m?.isError) {
              // T495: errors arrive in TWO shapes — the #errors store carries
              // errorContent; the injected jsonl entry carries the text in content
              // blocks. BOTH must render RED (the app's rule). Before, only the
              // first shape was caught and the injected error showed plain white.
              let ec = String((m as any).errorContent || "").trim();
              if (!ec) {
                ec = (typeof m.content === "string"
                  ? m.content
                  : Array.isArray(m.content)
                    ? m.content.filter((x: any) => x?.type === "text").map((x: any) => x.text || "").join("\n")
                    : "").trim();
              }
              if (ec) {
                // PLAIN red writing: never a toggle.
                pushBlock({ render: (w: number) => wrapPlain(ec, Math.max(10, w)).map((ln: string) => fg(C.danger, ln)), invalidate: () => {} } as any);
                // T496: the footer under the error too (every message in the app
                // carries one): same agent/model/thinking rules as normal replies.
                try {
                  let anE = String(m.agentName || "");
                  try {
                    if (!anE) {
                      const e0E = readSessionsList().find((x: any) => x?.key === currentKey);
                      const midE = String(m.id || "");
                      const mtsE = Number(m.timestamp) || 0;
                      const mkE = midE && e0E?.messageAgents?.[midE] ? midE : mtsE ? "ts-" + mtsE : "";
                      if (mkE && e0E?.messageAgents?.[mkE]) anE = String(e0E.messageAgents[mkE]);
                    }
                  } catch {}
                  if (!anE) {
                    const idsE = sessionAgentIds();
                    anE = idsE.find((x) => x === "orchestrator") || idsE[0] || "quinki";
                  }
                  anE = oneAgentId(anE);
                  pushBlock(new FooterRow(fmtFooterDate(Number(m.timestamp) || Date.now()), agentDisplayName(anE) + " \u00b7 " + String(m.model || defaultModelId || "") + " \u00b7 " + levelLabel(String(m.thinkingLevel || "off")), true));
                } catch {}
                continue;
              }
            }
            if (m?.reasoning) pushBlock(registerToggle(new ToggleBlock({ label: "Thinking", color: C.thinking, italic: true, body: String(m.reasoning) })));

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
              an = oneAgentId(an); // NEVER the joined list: ONE agent only
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
          const noopS = !!(en as any).noop;
          pushBlock(registerToggle(new ToggleBlock({ label: "Compaction", boldName: noopS ? "ineffective" : "effective", color: noopS ? C.expert : C.info, body: String((en as any).body || "") })));
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
              let an = String(sessionAgentIds()[0] || "quinki").split(",")[0].trim();
              let lv = "off";
              const mid = String(m.id || "");
              const mts = Date.parse(m.timestamp || "") || 0;
              const mk = mid && e0?.messageAgents?.[mid] ? mid : mts ? "ts-" + mts : "";
              if (mk && e0?.messageAgents?.[mk]) an = oneAgentId(e0.messageAgents[mk]);
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
            // Sidecar RPC like the app (compactSession): the LOCAL engine was a
            // fake empty session -> "session too small" on a 500k-token chat.
            if (scOn || (sc as any).connected) {
              setStatus("Compacting", "compacting");
              try { ui.requestRender(); } catch {}
              void sc.call("compactSession", { sessionKey: currentKey }, 600000)
                .catch(() => {})
                .finally(() => {
                  if (statusKind === "compacting") setStatus("", "");
                  try { loadServerHistory().then(() => { try { renderHistory(); scrollToEnd(); } catch {} }); } catch {}
                  try { ui.requestRender(); } catch {}
                });
            } else {
              void Promise.resolve(session.compact?.())
                .catch(() => {})
                .finally(() => { if (statusKind === "compacting") setStatus("", ""); });
            }
          } else if (arg === "enable" || arg === "disable") {
            const en = arg === "enable";
            if (scOn || (sc as any).connected) {
              void sc.call("setSessionCompaction", { sessionKey: currentKey, auto: en, threshold: 80 }, 20000).catch(() => {});
            } else {
              if (typeof (session as any).setAutoCompactionEnabled === "function") (session as any).setAutoCompactionEnabled(en);
            }
          }
        } catch {}
        break;
      }
      case "reload": {
        try { require("fs").appendFileSync("/tmp/q-reload-trace.log", new Date().toISOString() + " case reload key=" + currentKey + " welcome=" + welcomeShown + " scOn=" + scOn + "\n"); } catch {}
        if (welcomeShown) {
          welcomeShown = false;
          applyLayout(false);
        }
        // T501 — the user's exact rule: pressing Reload must IMMEDIATELY close
        // the slash menu + the box, then visibly reload the chat. Everything is
        // forced shut first (no menu may survive the press), then: clear the view,
        // then a FULL re-open like selecting the chat (engine + history + stores).
        try { qCloseMenus(); } catch {}
        try { killAutocomplete(); } catch {}
        try { editor.setText(""); } catch {}
        try { menuStack = []; menuSubFilter = ""; menuSel = 0; } catch {}
        try {
          content.clear();
          blockCount = 0;
        } catch {}
        try { (ui as any).requestImmediateRender?.(); } catch {}
        try {
          const sdirR = path.join(opts.agentDir, "sessions", "quinki");
          const targetR = path.join(sdirR, currentKey);
          void recreateSession({ newSessionDir: fs.existsSync(targetR) ? targetR : undefined, newKey: currentKey });
        } catch {}
        break;
      }
      case "syncexpert": {
        // App Expert CLI ONLY (never automatic, never anywhere else): sync the
        // MAIN app's binary + sidecar into App Expert.app, then close this CLI
        // exactly like /quit. The user reopens by hand — his choice, always.
        if (!QEXPERT) break;
        if (arg && arg !== "confirm") break; // direct Enter OR the confirm item
        try { require("fs").appendFileSync("/tmp/q-submit.log", new Date().toISOString() + " case syncexpert streaming=" + streaming + "\n"); } catch {}
        try {
          const MAIN_APP = "/Applications/Quinki.app";
          const EXP_APP = "/Applications/App Expert.app";
          const mainBin = path.join(MAIN_APP, "Contents", "MacOS", "quinki");
          const expBin = path.join(EXP_APP, "Contents", "MacOS", "quinki");
          const mainSide = path.join(MAIN_APP, "Contents", "Resources", "resources", "sidecar");
          const expSide = path.join(EXP_APP, "Contents", "Resources", "resources", "sidecar");
          qCloseMenus();
          let syncErr = "";
          if (streaming) {
            syncErr = "A turn is running: sync postponed. Run /syncexpert again when idle.";
          } else if (!fs.existsSync(mainBin) || !fs.existsSync(expBin)) {
            syncErr = "Quinki.app or App Expert.app not found in /Applications";
          } else {
            try {
              fs.copyFileSync(mainBin, expBin);
              fs.rmSync(expSide, { recursive: true, force: true });
              const rr = require("child_process").spawnSync("/usr/bin/ditto", [mainSide, expSide]);
              if (rr.status !== 0) throw new Error("ditto exit " + String(rr.status));
            } catch (eS) { syncErr = String(eS); }
          }
          try { require("fs").appendFileSync("/tmp/q-submit.log", "  sync done err=" + JSON.stringify(syncErr) + "\n"); } catch {}
          if (syncErr) {
            // Visible failure (a chat block; nothing ever lives in the text box).
            try {
              pushBlock(
                registerToggle(
                  new ToggleBlock({ label: "Sync", boldName: "failed", color: C.danger, body: syncErr, open: true })
                )
              );
              scrollToEnd();
            } catch {}
            try { (ui as any).requestImmediateRender?.(); } catch {}
            break;
          }
          // CLOSE like /quit — the user reopens with `quinki expert` when he wants.
          try { process.stdout.write("App Expert synced \u2014 closing. Reopen the App Expert CLI when you want.\n"); } catch {}
          shutdown();
        } catch (e) {
          try {
            pushBlock(
              registerToggle(
                new ToggleBlock({ label: "Sync", boldName: "failed", color: C.danger, body: String(e), open: true })
              )
            );
            scrollToEnd();
          } catch {}
          try { (ui as any).requestImmediateRender?.(); } catch {}
        }
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
          if (!currentKey || welcomeShown) {
            pendingModelId = String(arg || "");
            try { ui.requestRender(); } catch {}
          } else {
            void sc.call("setModel", { sessionKey: currentKey, model: arg }, 60000).catch(() => {});
          }
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
        const dArg = String(arg || "");
        try { require("fs").appendFileSync("/tmp/q-dir-trace.log", new Date().toISOString() + " dir arg=" + JSON.stringify(dArg) + "\n"); } catch {}
        if (dArg === "__dir_change") { try { require("fs").appendFileSync("/tmp/q-dir-trace.log", "  -> pickFolder\n"); } catch {} pickFolder(); break; }
        if (dArg === "confirm") { applyDirChange(dirPendingChange); break; }
        if (dArg.startsWith("__dir_use:")) {
          try { require("fs").appendFileSync("/tmp/q-dir-trace.log", "  -> openFolder " + dArg.slice(10) + "\n"); } catch {}
          openFolder(dArg.slice(10));
          break;
        }
        if (!dArg) break;
        const target = dArg === "~" ? os.homedir() : dArg;
        let ok = false;
        try {
          ok = fs.statSync(target).isDirectory();
        } catch {
          ok = false;
        }
        if (!ok) break;
        applyDirChange(target);
        break;
      }
      case "agents": {
        // T506 — THE missing case: without it the bulletproof Enter found the
        // command but handleSlash fell through and the tab never opened.
        try { refreshAgentsTab(); } catch {}
        try { qAgentsInputMode = ""; } catch {}
        if (!arg) {
          menuStack = ["agents"];
          menuSubFilter = "";
          menuSel = 0;
          try { ui.requestRender(); } catch {}
          break;
        }
        break;
      }
      case "agentinsession": {
        if (!arg) {
          // T483: /agentinsession + Enter opens the agents menu (Add agent on top),
          // exactly like /attachments does. Before, the Enter did nothing at all.
          menuStack = ["agentinsession"];
          menuSubFilter = "";
          menuSel = 0;
          try { ui.requestRender(); } catch {}
          break;
        }
        break;
      }
      case "attachments": {
        if (!arg) {
          menuStack = ["attachments"];
          menuSubFilter = "";
          menuSel = 0;
          try { ui.requestRender(); } catch {}
          break;
        }
        const aArg = String(arg || "");
        if (aArg === "__at_new") {
          qAttachNewFiles();
          break;
        }
        if (aArg === "__at_open") {
          const sdir2 = path.join(os.homedir(), ".quinki", "attachments", String(currentKey || ""));
          try { require("fs").mkdirSync(sdir2, { recursive: true }); } catch {}
          openFolder(sdir2);
          break;
        }
        if (aArg.startsWith("__at_file:")) {
          const fp = aArg.slice(10);
          try {
            if (fs.existsSync(fp)) {
              const stA2 = stageAttachment(fp) || { path: fp, originalName: path.basename(fp) };
              try { pendingAttachments.push(stA2 as any); } catch {}
              const chA = qTokenAdd((stA2 as any).originalName, "attachment", (stA2 as any).path);
              const curA2 = String(editor.getText() || "");
              editor.setText(curA2 + (curA2 && !curA2.endsWith(" ") ? " " : "") + chA + " ");
              ui.requestRender();
            }
          } catch {}
          break;
        }
        if (!aArg) break;
        const apath = path.resolve(aArg);
        try {
          if (path.isAbsolute(aArg) || fs.existsSync(apath)) {
            const stB2 = stageAttachment(apath) || { path: apath, originalName: path.basename(apath) };
            try { pendingAttachments.push(stB2 as any); } catch {}
            const chB = qTokenAdd((stB2 as any).originalName, "attachment", (stB2 as any).path);
            const curB = String(editor.getText() || "");
            editor.setText(curB + (curB && !curB.endsWith(" ") ? " " : "") + chB + " ");
            ui.requestRender();
          }
        } catch {}
        break;
      }
      case "skill": {
        if (!arg) {
          // /skill with NO argument: OPEN the skill menu (Enter works, like ->).
          // The textbox is LEFT ALONE: "/skill" stays visible until the user
          // CONFIRMS (Enter = chips) — it is cleared ONLY there.
          try { refreshSkillGroups(); } catch {}
          menuStack = ["skill"];
          menuSubFilter = "";
          menuSel = 0;
          try { ui.requestRender(); } catch {}
          break;
        }
        if (scOn) {
          // Live path: the skill rides the NEXT message (the app's chip flow).
          // The engine injects it into the system prompt, one-shot.
          // Inline token: the BARE name (T462 rule: no triangle anywhere; the
          // known-name pattern keeps it atomic for qAtomicDelete).
          try {
            const tok = String(arg).trim() + " ";
            const curTxt = String(editor.getText() || "");
            editor.setText(curTxt + (curTxt && !curTxt.endsWith(" ") ? " " : "") + tok);
          } catch {}
          refreshSkillGroups();
          try { ui.requestRender(); } catch {}
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
        if (arg === "yes" || arg === "confirm") shutdown();
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
    // T491: "Add agent" exists only while at least one agent can actually be
    // added — an empty Add-agent submenu makes no sense. It comes back by itself
    // when there is something to add again (the list is evaluated on every open).
    let canAddAny = false;
    try {
      canAddAny = agentIdsKnown().some((id: string) => id !== "orchestrator" && !ids.includes(id));
    } catch {}
    const out: any[] = [];
    if (canAddAny) out.push({ value: "#add", label: "Add agent", description: "Add an agent to this chat" });
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
      const order = Array.from(menuMarked);
      const out: any[] = [];
      for (const id of agentIdsKnown()) {
        if (id === "orchestrator" || ids.includes(id)) continue;
        const cfg = agentConfigOf(id);
        const bits: string[] = [];
        if (cfg?.model) bits.push(String(cfg.model));
        if (cfg?.thinkingLevel) bits.push("thinking " + String(cfg.thinkingLevel));
        const nSk = Array.isArray(cfg?.skills) ? cfg.skills.length : 0;
        if (nSk) bits.push(nSk + " skill" + (nSk === 1 ? "" : "s"));
        const idxA = order.indexOf(id);
        out.push({ value: id, label: (idxA >= 0 ? "\u25cf " : "\u25cb ") + agentDisplayName(id), description: bits.join(" \u00b7 ") || "Tab: add (multiple OK)" });
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
        { value: "__chat_default__", label: (ov.model ? "\u25cb " : "\u25cf ") + "Chat default", description: "Use the chat model" },
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
        // GRAPHICALLY IDENTICAL to the main model menu: ●/○ dots (never violet).
        out.push({
          value: String(m?.id || ""),
          label: (cur ? "\u25cf " : "\u25cb ") + String(m?.name || m?.id || ""),
          description: prov,
        });
      }
      return out;
    }
    if (lv3 === "thinking") {
      const cur = String(ov.thinkingLevel || "");
      return [
        { value: "__chat_default__", label: (cur === "" ? "\u25cf " : "\u25cb ") + "Chat default", description: "Use the chat setting" },
        { value: "on", label: (cur === "on" ? "\u25cf " : "\u25cb ") + "On", description: "Always max" },
        { value: "off", label: (cur === "off" ? "\u25cf " : "\u25cb ") + "Off", description: "Disabled" },
      ];
    }
    return [];
  };
  const toggleAgentInSession = (id: string) => {
    // MULTI-SELECT (like the models): add or remove one agent, save immediately.
    const ids = sessionAgentIds();
    const has = ids.includes(id);
    const next = has ? ids.filter((x: string) => x !== id) : [...ids, id];
    const fin = next.length ? next : [DEFAULT_CHAT_AGENT]; // never leave it empty
    if (scOn) {
      void sc.call("setChatAgents", { sessionKey: currentKey, agentIds: fin.join(",") }, 20000).catch(() => {});
    } else {
      try { mutateSessionEntry((e: any) => { e.agentId = fin.join(","); }); } catch {}
    }
    try { refreshSessions(); } catch {}
    try { ui.requestRender(); } catch {}
  };
  const addAgentToSession = (id: string) => {
    if (welcomeShown) {
      const ids = sessionAgentIds();
      if (!ids.includes(id)) ids.push(id);
      qWelcomeAgents = ids;
      try { refreshSessions(); } catch {}
      try { ui.requestRender(); } catch {}
      return;
    }
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
    if (welcomeShown) {
      const ids = sessionAgentIds().filter((x: string) => x !== id);
      qWelcomeAgents = ids.length ? ids : [DEFAULT_CHAT_AGENT];
      try { refreshSessions(); } catch {}
      try { ui.requestRender(); } catch {}
      return;
    }
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
      // CONFIRM: save the selected agents (dot order) — the clicked row included.
      const sel = Array.from(menuMarked);
      if (value && !value.startsWith("#") && !sel.includes(value)) sel.push(value);
      try { require("fs").appendFileSync("/tmp/q-agent-trace.log", new Date().toISOString() + " confirm sel=" + JSON.stringify(sel) + " value=" + String(value) + " scOn=" + scOn + "\n"); } catch {}
      if (sel.length) {
        const fin = sel.filter((x) => agentIdsKnown().includes(x));
        try { require("fs").appendFileSync("/tmp/q-agent-trace.log", "  fin=" + JSON.stringify(fin) + " known=" + JSON.stringify(agentIdsKnown().slice(0, 12)) + "\n"); } catch {}
        if (fin.length) {
          if (welcomeShown) {
            // T487: on the WELCOME the selection is one-shot state — no phantom
            // session written; the first send's setChatAgents carries it over.
            const cur = sessionAgentIds();
            const merged = [...cur];
            for (const a of fin) if (!merged.includes(a)) merged.push(a);
            qWelcomeAgents = merged;
            try { require("fs").appendFileSync("/tmp/q-agent-trace.log", "  welcome-selection merged=" + merged.join(",") + "\n"); } catch {}
          } else if (scOn) {
            const cur = sessionAgentIds();
            const merged = [...cur];
            for (const a of fin) if (!merged.includes(a)) merged.push(a);
            try { require("fs").appendFileSync("/tmp/q-agent-trace.log", "  calling setChatAgents merged=" + merged.join(",") + "\n"); } catch {}
            void sc.call("setChatAgents", { sessionKey: currentKey, agentIds: merged.join(",") }, 20000).then(() => {
              try { require("fs").appendFileSync("/tmp/q-agent-trace.log", "  setChatAgents OK\n"); } catch {}
            }).catch((eE: any) => {
              try { require("fs").appendFileSync("/tmp/q-agent-trace.log", "  setChatAgents ERROR: " + String(eE?.message || eE) + "\n"); } catch {}
            });
          } else {
            try { mutateSessionEntry((e: any) => { const cur = sessionAgentIds(); const merged = [...cur]; for (const a of fin) if (!merged.includes(a)) merged.push(a); e.agentId = merged.join(","); }); } catch {}
          }
          try { refreshSessions(); } catch {}
        }
      }
      menuMarked = new Set<string>();
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
        // STAY in this menu (the user goes back with ←): no auto-pop.
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
        // STAY here too (no auto-pop).
      } else {
        // STAY here too (no auto-pop).
      }
      menuSubFilter = "";
      menuSel = 0;
      menuConfirmFocus = false;
      return;
    }
  };
  const dirChangeItems = (): any[] => {
    // FIXED menu: both rows stay visible. Typing a path updates the second row live.
    return [
      { value: "__dir_pick", label: "Select folder\u2026", description: "Open the folder picker" },
      {
        value: "__dir_type",
        label: dirTypeMode && menuSubFilter ? "Path: " + menuSubFilter : "Type path\u2026",
        description: "Type or paste a folder path, then press Enter",
      },
    ];
  };
  const levelItems = (stack: string[]): any[] => {
    if (stack[0] === "directory" && stack[1] === "dirchange") return dirChangeItems();
    if (stack.length === 0) return mainItems();
    if (stack[0] === "agentinsession") return agentLevelItems(stack);
    if (stack[0] === "agents") return agentAdminLevelItems(stack);
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
    if (dirTypeMode || (menuStack[0] === "directory" && menuStack[1] === "dirchange") || (menuStack[0] === "agents" && (menuStack[1] === "__input" || String(menuStack[1] || "").startsWith("agdel:")))) return items; // typed input never filters the rows away
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
  const qCursorEnd = (): void => {
    try {
      const st: any = (editor as any).state;
      if (st && Array.isArray(st.lines)) {
        st.cursorLine = st.lines.length - 1;
        const ln = String(st.lines[st.cursorLine] || "");
        // No visual gap: the cursor sits right after the chip, BEFORE the separator space.
        (editor as any).setCursorCol(ln.endsWith(" ") ? ln.length - 1 : ln.length);
      }
    } catch {}
  };
  const killAutocomplete = (): void => {
    try {
      (editor as any).autocompleteState = undefined;
      (editor as any).autocompleteList = undefined;
    } catch {}
  };
  const qAttachNewFiles = (): void => {
    try {
      const cp = require("child_process");
      const scriptA = 'set theFiles to choose file with prompt "Choose files to attach" with multiple selections allowed\nset out to ""\nrepeat with f in theFiles\nset out to out & (POSIX path of f) & linefeed\nend repeat\nreturn out';
      cp.execFile("/usr/bin/osascript", ["-e", scriptA], { timeout: 300000 }, (errA: any, outA: string) => {
        try {
          if (errA) return;
          const fps = String(outA || "").split("\n").map((x) => x.trim()).filter(Boolean);
          let curAdd = String(editor.getText() || "");
          const before = curAdd;
          for (const fp of fps) {
            let isF = false;
            try { isF = require("fs").existsSync(fp) && require("fs").statSync(fp).isFile(); } catch {}
            if (!isF) continue;
            const stA = stageAttachment(fp) || { path: fp, originalName: require("path").basename(fp) };
            try { pendingAttachments.push(stA as any); } catch {}
            const nmA = String((stA as any).originalName);
            attPathByName[nmA] = String((stA as any).path);
            curAdd = String(curAdd).replace(/[ \t]+$/, "") + " " + nmA;
          }
          if (curAdd !== before) {
            editor.setText(curAdd);
            try { editor.setCursorCol(editor.getText().length); } catch {}
            qCursorEnd();
          }
          // T449: the menu closes immediately after attaching (the user's rule).
          try { qCloseMenus(); } catch {}
          try { ui.requestRender(); } catch {}
        } catch {}
      });
    } catch {}
  };
  const clearSlashText = (): void => {
    try {
      const t0 = String(editor.getText() || "");
      // Also a LONE "/" (or "///"): the slash menu counts ANY "/" as "open", so a
      // leftover bare slash kept the menu lit forever (the user's bug).
      const t1 = t0.replace(/^\/+[A-Za-z]*\s*/, "");
      if (t1 !== t0) editor.setText(t1);
    } catch {}
  };
  // SKILLS ONLY: close the menu levels, the filter, the confirm focus AND the
  // "/skill" text (the user's rule: the slash menu closes on the skills' confirm).
  const qCloseMenus = (): void => {
    try {
      menuStack = [];
      menuSubFilter = "";
      menuSel = 0;
      // T437: backing out / closing without confirming = the Tab marks are FORGOTTEN.
      try { menuMarked.clear(); menuConfirmFocus = false; } catch {}
      menuConfirmFocus = false;
      clearSlashText();
    } catch {}
  };
  const menuOpen = (): boolean => {
    if (menuStack.length > 0) return true;
    return editorText().startsWith("/");
  };

  const runItem = (it: any) => {
    try {
      if (!it || it.separator) return;
      if (menuStack[0] === "settings") {
        if (menuStack[1] === "providers" && !menuStack[2] && menuMarked.size > 0) {
          const names = Array.from(menuMarked).filter((v: string) => v.startsWith("prov:")).map((v: string) => v.slice(5));
          for (const nm of names) { patchProvider(nm, (pp) => { pp.enabled = !pp.enabled; }); }
          menuMarked.clear();
          try { ui.requestRender(); } catch {}
          return;
        }
        if (menuStack[1] === "fallbacks" || (menuStack[1] === "defaults" && menuStack[2] === "fallbacks")) {
          // SAVE (Confirm/Enter or terminal row): the session (in a chat — the app reads
          // it there) AND the global default (the app's Settings -> Fallback models).
          const order = Array.from(menuMarked);
          if (currentKey && !welcomeShown) {
            try { void sc.call('setSessionFallbacks', { sessionKey: currentKey, models: order }, 20000).catch(() => {}); } catch {}
          }
          try { void sc.call('setDefaultFallbacks', { models: order }, 20000).catch(() => {}); } catch {}
          try { wsSettings = { ...(wsSettings || {}), defaultFallbackModels: order }; } catch {}
          try { refreshSessions(); } catch {}
          try { ui.requestRender(); } catch {}
          return;
        }
        settingsActivate(String(it.value));
        try { ui.requestRender(); } catch {}
        return;
      }
      if (menuStack[0] === "agents") {
        // T508/509: the Enter mirrors the Tab action on every toggle row; the
        // create/install/delete flows live here (typed input in the menu).
        const vAg = String(it?.value ?? "");
        const callA = (globalThis as any).__sidecarCall;
        if (vAg === "__newagent") { qAgentsInputMode = "newagent"; menuStack.push("__input"); menuSubFilter = ""; menuSel = 0; try { ui.requestRender(); } catch {} return; }
        if (vAg === "__newskill") { qAgentsInputMode = "skillpkg"; menuStack.push("__input"); menuSubFilter = ""; menuSel = 0; try { ui.requestRender(); } catch {} return; }
        if (vAg === "__newmcp") { qAgentsInputMode = "mcpmcp"; menuStack.push("__input"); menuSubFilter = ""; menuSel = 0; try { ui.requestRender(); } catch {} return; }
        if (vAg === "__agdel") {
          const st1 = String(menuStack[1] || "");
          const agId = st1.startsWith("ag:") ? st1.slice(3) : "";
          if (agId) { menuStack.push("agdel:" + agId); menuSubFilter = ""; menuSel = 0; try { ui.requestRender(); } catch {} }
          return;
        }
        if (vAg.startsWith("agdel-go:")) {
          const id = vAg.slice(9);
          if (callA) callA('deleteAgent', { id }).then(() => { refreshAgentsTab(); }).catch(() => {});
          qCloseMenus();
          return;
        }
        if (vAg === "__go") {
          const val = menuSubFilter.trim();
          try {
            if (qAgentsInputMode === "newagent" && val && callA) {
              callA('createAgent', { name: val }).then(() => { refreshAgentsTab(); }).catch(() => {});
            } else if (qAgentsInputMode === "skillpkg" && val && callA) {
              callA('installSkill', { package: val }).then(() => { refreshAgentsTab(); }).catch(() => {});
            } else if (qAgentsInputMode === "mcpmcp" && val && callA) {
              const parts = val.split(/\s+/);
              const first = parts[0] || "";
              const isCmd = /^(npx|uvx|node|python3?|bun|deno|docker)$/.test(first);
              const id = val.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || ('mcp-' + Date.now());
              const params: any = isCmd
                ? { id, name: id, type: 'command', command: first, args: parts.slice(1) }
                : { id, name: id, type: 'package', source: val };
              callA('addMcpServer', params).then(() => { refreshAgentsTab(); }).catch(() => {});
            }
          } catch {}
          qAgentsInputMode = "";
          qCloseMenus();
          return;
        }
        if (vAg.startsWith("def:") || vAg.startsWith("ast:") || vAg.startsWith("att:") || vAg.startsWith("amt:") || vAg.startsWith("ska:") || vAg.startsWith("mcpa:") || vAg.startsWith("tola:") || vAg.startsWith("pmt:") || vAg.startsWith("pmm:")) {
          try { agentAdminAction(vAg); } catch {}
          try { ui.requestRender(); } catch {}
          return;
        }
        return;
      }
      if (menuStack[0] === "agentinsession") {
        try { require("fs").appendFileSync("/tmp/q-tab-trace.log", new Date().toISOString() + " select stack=" + menuStack.join("/") + " sel=" + menuSel + " it=" + String(it?.value) + " n=" + String(menuMarked.size) + "\n"); } catch {}
        if (menuStack[1] === "#add") {
          // SELECT first (Tab marks the dots), the CONFIRM (Enter) saves — the dot
          // order is the selection order.
          const vSel = String(it.value ?? "");
          if (vSel && !vSel.startsWith("#")) {
            if (menuMarked.has(vSel)) menuMarked.delete(vSel); else menuMarked.add(vSel);
          }
          try { ui.requestRender(); } catch {}
          return;
        }
        agentActivate(String(it.value));
        try { ui.requestRender(); } catch {}
        return;
      }
      if (menuStack.length > 0) {
        const cmdName = menuStack[0];
        if (cmdName === "skill") {
          // ENTER = put the SELECTED skills in the box (chips), then close+clean.
          // Each chip remembers WHICH AGENT owns that skill (the app's shape).
          try {
            const vals = Array.from(menuMarked).filter((v) => String(v).startsWith("skill:"));
            for (const vv of vals) {
              const rest = String(vv).slice(6);
              const i1 = rest.indexOf(":");
              const ag = i1 > 0 ? rest.slice(0, i1) : "";
              const nm = i1 > 0 ? rest.slice(i1 + 1) : rest;
              if (!nm) continue;
              if (ag) {
                (skillRefsByName[nm] = skillRefsByName[nm] || []).push({ agentId: ag, skillName: nm, agentName: agentDisplayName(ag) });
              }
              const curS = String(editor.getText() || "");
              editor.setText(String(curS).replace(/[ \t]+$/, "") + " " + "Skill: " + nm);
              try { editor.setCursorCol(editor.getText().length); } catch {}
              qCursorEnd();
            }
          } catch {}
          qCloseMenus();
          menuMarked.clear();
          try { ui.requestRender(); } catch {}
          return;
        }
        if (cmdName === "attachments") {
          const vA = String(it.value ?? "");
          if (vA.startsWith("__at_file:") || vA.startsWith("__at_") === false && menuMarked.size > 0 && false) {
            // (never reached — kept for clarity)
          }
          if (vA.startsWith("__at_file:")) {
            // ENTER: ALL marked files go in the box (chips), then close+clean.
            try {
              const marked = Array.from(menuMarked).filter((v) => String(v).startsWith("__at_file:"));
              for (const mv of marked) {
                const fpA = String(mv).slice(10);
                if (fs.existsSync(fpA)) {
                  const stD = stageAttachment(fpA) || { path: fpA, originalName: require("path").basename(fpA) };
                  pendingAttachments.push(stD as any);
                  const nmD = String((stD as any).originalName);
                  attPathByName[nmD] = String((stD as any).path);
                  const curD = String(editor.getText() || "");
                  editor.setText(String(curD).replace(/[ \t]+$/, "") + " " + nmD);
                  try { editor.setCursorCol(editor.getText().length); } catch {}
                  qCursorEnd();
                }
              }
            } catch {}
            // T448: the SAME close as the skills — menu levels + filter + confirm
            // focus + the "/attachments" text cleared (the user's rule).
            qCloseMenus();
            menuMarked.clear();
          } else if (vA === "__at_new") {
            qAttachNewFiles();
          } else if (vA === "__at_open") {
            const sdir3 = path.join(os.homedir(), ".quinki", "attachments", String(currentKey || ""));
            try { require("fs").mkdirSync(sdir3, { recursive: true }); } catch {}
            openFolder(sdir3);
          }
          try { ui.requestRender(); } catch {}
          return;
        }

        if (cmdName === "directory") {
          // ENTER semantics (user rule): on a directory row -> OPEN THE FOLDER in
          // Finder; on "Change directory…" -> the submenu (Select folder / Type path);
          // on the warning notice -> confirm the move. Tab (separate handler) moves.
          const vD = String(it.value ?? "");
          if (menuStack[1] === "dirchange" || dirTypeMode) {
            if (vD === "__dir_pick") {
              pickFolder(); // the folder picker
            } else if ((vD === "__dir_type" || vD === "__dir_typed" || dirTypeMode) && menuSubFilter.trim()) {
              const tp = menuSubFilter.trim();
              applyDirChange(tp === "~" ? os.homedir() : tp);
              dirTypeMode = false;
              menuSubFilter = "";
              menuStack = ["directory"];
            }
            // Type row with nothing typed: Enter does nothing.
          } else if (vD.startsWith("__dir_use:")) {
            openFolder(vD.slice(10));
          } else if (vD === "__dir_change") {
            // Enter does NOTHING on this row (only → opens the submenu — user rule).
          } else if (vD === "confirm") {
            applyDirChange(dirPendingChange);
          } else if (vD && !vD.startsWith("__")) {
            applyDirChange(vD === "~" ? os.homedir() : vD);
            menuStack = ["directory"];
          }
          try { ui.requestRender(); } catch {}
          return;
        }
        if (cmdName === "model") {
          // /model is a select-list: apply and STAY (like Tab).
          const v = String(it.value ?? "");
          try {
            if (v && !v.startsWith("__")) {
              if (!currentKey || welcomeShown) { pendingModelId = v; }
              else { wsModelId = v; void sc.call("setModel", { sessionKey: currentKey, model: v }, 60000).catch(() => {}); }
            }
          } catch {}
          try { ui.requestRender(); } catch {}
          return;
        }
        menuStack = [];
        menuSubFilter = "";
        menuSel = 0;
        // T437: backing out / closing without confirming = the Tab marks are FORGOTTEN.
        try { menuMarked.clear(); menuConfirmFocus = false; } catch {}
        try { editor.setText(""); } catch {}
        handleSlashRef?.("/" + cmdName + " " + String(it.value ?? it.label ?? ""));
        try { ui.requestRender(); } catch {}
        return;
      }
      const cmd: any = commands.find((c) => c.name === it.value);
      if (cmd) {
        try { editor.setText(""); } catch {}
        menuSel = 0;
        handleSlashRef?.("/" + cmd.name);
        try { ui.requestRender(); } catch {}
      }
    } catch {}
  };

  const needsConfirmFor = (cur: any): boolean => {

    if (!cur || cur.separator) return false;

    try {

      if (menuStack[0] === "agentinsession") {
        // FINAL rules: Select ONLY in the Add-agent list; Confirm appears there once
        // something is marked. In the agent's own config menu: Confirm ONLY on
        // Remove agent (nav + remove — nothing else).
        if (menuStack[1] === "#add") return menuMarked.size > 0;
        // T489: Add orchestrator shows Confirm (Enter adds it; the menu stays open).
        if (String((cur as any)?.value || "") === "#orch") return true;
        // T490: Remove agent shows Confirm too (the user's rule: you press CONFIRM
        // to remove, not the forward arrow).
        if (String((cur as any)?.value || "") === "remove") return true;
        return false;
      }
      if (menuStack[0] === "agents") {
        // T507: the agents tab is all SELECTION (Tab = select, instant effect):
        // never a Confirm in the bar.
        return false;
      }
      if (menuStack.length === 0) {
        // T502: plain commands at the root (reload/export/compact...) NEVER show
        // a Confirm — Enter simply runs them (the user: "the confirm doesn't work").
        return false;
      }

      if (menuStack[0] === "attachments") {
        const vAt = String((cur as any)?.value || "");
        // P1 (T448): the ACTION rows always show "Confirm (Enter)" — Enter opens the
        // native picker / the session's attachments folder. The FILE rows follow the
        // skill rule: Confirm only once something is marked (Tab).
        if (vAt === "__at_new" || vAt === "__at_open") return true;
        return menuMarked.size > 0;
      }
      if (menuStack[0] === "skill") return menuMarked.size > 0;
      if (menuStack[0] === "directory") {
        const vDir = String((cur as any)?.value || "");
        if (menuStack[1] === "dirchange") {
          // Select folder…: Enter opens the picker (Confirm VISIBLE).
          // Type path…: Enter confirms — visible once a path is typed.
          return vDir === "__dir_pick" || (vDir === "__dir_type" && !!menuSubFilter.trim());
        }
        return vDir.startsWith("__dir_use:") || vDir === "confirm"; // Enter = open the folder
      }
      if (menuStack[0] === "settings") {

        const inModelsLv = menuStack[3] === "models";

        const inProvLv = menuStack[1] === "providers" && !menuStack[2];

        // UPDATED with the flattened menu (T315): the levels are now top-level
        // "model" / "fallbacks" / "thinking" — the old nested paths kept as alias.
        const inFbLv = menuStack[1] === "fallbacks" || (menuStack[1] === "defaults" && menuStack[2] === "fallbacks");
        if (inFbLv) return menuMarked.size > 0; // Confirm (Enter) appears once a fallback is marked
        const inDefModelLv = menuStack[1] === "model" || menuStack[1] === "thinking" || (menuStack[1] === "defaults" && (menuStack[2] === "model" || menuStack[2] === "thinking"));
        return (inFbLv || inDefModelLv || inModelsLv || inProvLv) ? false : !settingsDeeper(cur);

      }

      if (menuStack.length > 0) return menuStack[0] !== "model" && menuStack[0] !== "thinking";

      const c2: any = commands.find((c) => c.name === cur.value);

      return !(c2 && typeof c2.getArgumentCompletions === "function");

    } catch { return false; }

  };

  let lastSelectAt = 0;
  const menuNav = (a: "up" | "down" | "left" | "right" | "enter" | "escape" | "select") => {
    if (a === "enter") { try { require("fs").appendFileSync("/tmp/q-enter-trace.log", "  menuNav enter stack=" + JSON.stringify(menuStack) + " sel=" + menuSel + " items=" + (() => { try { return applyFilter(levelItems(menuStack)).length; } catch (e2) { return "THROW:" + String(e2); } })() + "\n"); } catch {} }
    // The path input only exists inside the directory submenu: anywhere else = off.
    try { if (dirTypeMode && !(menuStack[0] === "directory" && menuStack[1] === "dirchange")) { dirTypeMode = false; menuSubFilter = ""; } } catch {}
    if (a === "select") { try { require("fs").appendFileSync("/tmp/q-tab-trace.log", new Date().toISOString() + " select stack=" + JSON.stringify(menuStack) + " sel=" + menuSel + "\n"); } catch {} }

    if (a === "select") {
      // The editor hook AND the app input listener both fire on one Tab press:
      // without this dedupe a dot was toggled on and off in the same instant.
      try {
        const nowS = Date.now();
        if (nowS - lastSelectAt < 120) return;
        lastSelectAt = nowS;
      } catch {}

      try {
        const its: any = menuItemsCache || [];
        const it: any = its[menuSel];
        const inModels = menuStack[0] === "settings" && menuStack[3] === "models";
        const inFallbacks = menuStack[0] === "settings" && (menuStack[1] === "fallbacks" || (menuStack[1] === "defaults" && menuStack[2] === "fallbacks"));
        const inProviders = menuStack[0] === "settings" && menuStack[1] === "providers" && !menuStack[2];
        if (menuStack[0] === "settings" && ((menuStack[1] === "thinking" && !menuStack[2]) || (menuStack[1] === "defaults" && menuStack[2] === "thinking")) && it && !it.separator) {
          const on = String(it.value) === "on";
          applySettingsPatch({ defaultThinkingLevel: on ? "xhigh" : "off" });
          try { ui.requestRender(); } catch {}
          return;
        }
        if (menuStack[0] === "thinking" && it && !it.separator) {
          const on = String(it.value) === "on";
          try { thinkingOn = on; } catch {}
          if (currentKey) { void sc.call("setThinking", { sessionKey: currentKey, thinkingLevel: on ? "xhigh" : "off" }, 20000).catch(() => {}); }
          try { ui.requestRender(); } catch {}
          return;
        }
        // MENU 2.0: Tab acts on value-pickers too (model / thinking choices).
        const inSettingsModel = menuStack[0] === "settings" && ((menuStack[1] === "model" && !menuStack[2]) || (menuStack[1] === "defaults" && menuStack[2] === "model"));
        const inAgentPick = menuStack[0] === "agentinsession" && String(menuStack[2] || "").match(/^(model|thinking)$/);
        const inCliModel = menuStack[0] === "model";
        if (inSettingsModel && it && !it.separator && String(it.value || "") && !String(it.value).startsWith("__")) {
          settingsActivate(String(it.value));
          try { ui.requestRender(); } catch {}
          return;
        }
        if (inAgentPick && it && !it.separator && String(it.value || "")) {
          agentActivate(String(it.value));
          try { ui.requestRender(); } catch {}
          return;
        }
        if ((menuStack[0] === "skill" || menuStack[0] === "attachments") && it && !it.separator) {
          // TAB = SELECT ONLY: mark the dot (multi OK). NOTHING goes in the box —
          // the chips are placed by ENTER (the user's rule).
          const vV = String(it.value ?? "");
          if (menuStack[0] === "skill" && vV.startsWith("skill:")) {
            if (menuMarked.has(vV)) menuMarked.delete(vV); else menuMarked.add(vV);
            if (menuMarked.size === 0) menuConfirmFocus = false; // no marks -> no Confirm
          } else if (menuStack[0] === "attachments" && vV.startsWith("__at_file:")) {
            if (menuMarked.has(vV)) menuMarked.delete(vV); else menuMarked.add(vV);
            if (menuMarked.size === 0) menuConfirmFocus = false;
          }
          try { ui.requestRender(); } catch {}
          return;
        }
        if (menuStack[0] === "agents" && it && !it.separator) {
          // T507/508: Tab = SELECT with INSTANT effect (the app's value-pickers):
          // default agent, agent skills/tools/mcp toggles, per-skill/mcp/tool agent
          // toggles, plan-mode flags — one shared action.
          try { agentAdminAction(String(it.value ?? "")); } catch {}
          try { ui.requestRender(); } catch {}
          return;
        }
        if (menuStack[0] === "agentinsession" && menuStack[1] === "#add" && it && !it.separator) {
          // T482: TAB works here too (the bar promised "Select (Tab)"): mark the dot,
          // multi OK, dot order = priority order. Enter then saves (Confirm lights
          // with at least one mark). Same mark as the click/runItem path.
          const vV = String(it.value ?? "");
          if (vV && !vV.startsWith("#")) {
            if (menuMarked.has(vV)) menuMarked.delete(vV); else menuMarked.add(vV);
            if (menuMarked.size === 0) menuConfirmFocus = false;
          }
          try { ui.requestRender(); } catch {}
          return;
        }
        if (inCliModel && it && !it.separator && String(it.value || "")) {
          // Apply the model and STAY in the menu (the ● moves, the bar updates).
          const v = String(it.value);
          try {
            if (!currentKey || welcomeShown) {
              pendingModelId = v;
            } else {
              wsModelId = v;
              void sc.call("setModel", { sessionKey: currentKey, model: v }, 60000).catch(() => {});
            }
          } catch {}
          try { ui.requestRender(); } catch {}
          return;
        }
        if (inProviders) {
          // INSTANT toggle of the provider under the cursor (no Confirm).
          const v = String(it?.value || "");
          if (v.startsWith("prov:")) { const nm = v.slice(5); patchProvider(nm, (pp) => { pp.enabled = !pp.enabled; }); }
        } else if (inModels) {
          settingsActivate(String(it?.value || ""));
        } else if (menuStack[0] === "directory" && !menuStack[1] && it && !it.separator) {
          // Tab on a directory row = MOVE the chat to that folder (dot moves).
          const vD2 = String(it.value ?? "");
          if (vD2.startsWith("__dir_use:")) {
            const tD2 = vD2.slice(10);
            const oldD2 = currentDirAny();
            let nD2 = 0;
            try { nD2 = require("fs").readdirSync(oldD2).filter((x: string) => !x.startsWith(".")).length; } catch {}
            if (tD2 === oldD2) {
              // already the current folder: NOTHING (a chat always keeps its directory)
            } else if (nD2 > 0) { dirPendingChange = tD2; dirPendingFiles = nD2; }
            else applyDirChange(tD2);
          }
          try { ui.requestRender(); } catch {}
          return;
        } else if (inFallbacks && it && !it.separator) {
          const v = String(it.value || "");
          if (menuMarked.has(v)) menuMarked.delete(v); else menuMarked.add(v);
          try {
            const order = Array.from(menuMarked);
            if (currentKey && !welcomeShown) {
              void sc.call('setSessionFallbacks', { sessionKey: currentKey, models: order }, 20000).catch(() => {});
            }
            void sc.call('setDefaultFallbacks', { models: order }, 20000).catch(() => {});
            wsSettings = { ...(wsSettings || {}), defaultFallbackModels: order };
            refreshSessions();
          } catch {}
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
        // (the textbox is left ALONE: the user deletes "/skill" himself if he wants)
        if (dirTypeMode) {
          dirTypeMode = false;
          menuSubFilter = "";
          // stay in the submenu: Select folder / Type path remain available
          try { ui.requestRender(); } catch {}
          return;
        }
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
        try { qAgentsInputMode = ""; } catch {}
        // T437: backing out / closing without confirming = the Tab marks are FORGOTTEN.
        try { menuMarked.clear(); menuConfirmFocus = false; } catch {}
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
            // T439: backing out forgets the Tab marks.
            try { menuMarked.clear(); } catch {}
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
          // T439: ← goes back one level (or closes the menu) WITHOUT confirming =
          // the Tab marks are forgotten (reopening shows nothing selected).
          try { menuMarked.clear(); } catch {}
        }
      } else if (a === "right") {
        try { require("fs").appendFileSync("/tmp/q-deep-trace.log", new Date().toISOString() + " RIGHT root=" + String(menuStack[0]||"-") + " stack=" + JSON.stringify(menuStack) + " sel=" + String(menuSel) + " itemsN=" + String(items.length) + " rowVal=" + JSON.stringify(String((items[menuSel]||{}).value||"")) + "\n"); } catch {}
        // Forward ONLY — it NEVER executes. At the end of the levels it FOCUSES
        // Confirm (violet filled, like the app's NavBar focusConfirm); Enter runs.
        if (menuConfirmFocus) {
          // Already focused: stays lit (Enter confirms).
        } else if (menuStack.length > 0) {
          const it: any = items[menuSel];
          // Directory submenu: -> runs the action (Select folder… / Type path…).
          if (menuStack[0] === "directory" && menuStack[1] === "dirchange" && it && !it.separator) {
            // -> does NOTHING in the submenu: the actions run on ENTER (user rule).
            try { ui.requestRender(); } catch {}
            return;
          }
          if (it && !it.separator) {
            // ONLY the agent menu has deeper levels. Every other submenu is a
            // terminal list: → must light the Confirm directly, never push a
            // ghost level out of the item value.
            let deeper = menuStack[0] === "agentinsession" ? agentLevelFor(it) : (menuStack[0] === "settings" ? settingsDeeper(it) : (menuStack[0] === "directory" && !menuStack[1] && String(it.value) === "__dir_change" ? "dirchange" : null));
            if (menuStack[0] === "agents" && it && !it.separator) {
              const vA = String(it.value || "");
              if (/^(#def|#you|#sk|#mcp|#tools|#plan|#plantools|#planmcp|ag:|ask:|atk:|amc:|sk:|mcp:|tool:)/.test(vA)) deeper = vA;
            }
            if (deeper) {
              try { require("fs").appendFileSync("/tmp/q-deep-trace.log", new Date().toISOString() + " PUSH " + JSON.stringify({ root: menuStack[0], val: String(it.value||""), deeper }) + "\n"); } catch {}
              // T517: NEVER push the same level twice in a row (kitty press+release
              // could fire the arrow twice => ["agents","#sk","#sk"]: entering a
              // skill looked dead and <- only removed one copy, staying on the
              // same screen with the top row (Install) selected — the user's bug.
              const _topSt = menuStack[menuStack.length - 1];
              if (_topSt === deeper) {
                try { require("fs").appendFileSync("/tmp/q-deep-trace.log", new Date().toISOString() + " PUSH-SKIP-dup " + deeper + "\n"); } catch {}
                try { ui.requestRender(); } catch {}
                return;
              }
              menuStack.push(deeper);
              menuSubFilter = "";
              menuSel = 0;
              // entering the fallbacks editor: seed the selection with the saved ones
              try {
                if (deeper === "fallbacks") {
                  const cur = fbSeedList();
                  menuMarked = new Set<string>(cur.map((x: any) => String(x)));
                } else {
                  menuMarked = new Set<string>();
                }
              } catch {}
            } else {
              // T492: no focus-the-Confirm logic here (it no longer exists in the
              // menus): on terminal rows the forward arrow does nothing.
            }
          }
        } else {
          const it: any = items[menuSel];
          const cmd: any = it ? commands.find((c) => c.name === it.value) : null;
          if (cmd && typeof cmd.getArgumentCompletions === "function") {
            menuStack = [cmd.name];
            menuSubFilter = "";
            menuSel = 0;
            try { if (cmd.name === "skill" || cmd.name === "attachments") killAutocomplete(); } catch {}
            // T513 — THE user's flow (slash + selector + FORWARD): the arrow opens
            // the menu WITHOUT the case, so the tab data must load right here.
            try { if (cmd.name === "agents") refreshAgentsTab(); } catch {}
          } else if (cmd) {
            // MENU 2.0: nothing (Enter runs commands).
          }
        }
      } else {
        if (dirTypeMode) {
          // Type path: Enter applies the typed/pasted folder.
          const tp2 = menuSubFilter.trim();
          if (tp2) applyDirChange(tp2 === "~" ? os.homedir() : tp2);
          dirTypeMode = false;
          menuSubFilter = "";
          menuStack = ["directory"];
          try { ui.requestRender(); } catch {}
          return;
        }
        if (menuStack[0] === "directory" && menuStack[1] === "dirchange" && !dirTypeMode) {
          // Submenu actions run on Enter too (Select folder… / Type path…).
          const itS: any = (menuItemsCache || [])[menuSel];
          if (itS && !itS.separator) runItem(itS);
          try { ui.requestRender(); } catch {}
          return;
        }
        try { require("fs").appendFileSync("/tmp/q-dir-trace.log", new Date().toISOString() + " enter stack=" + JSON.stringify(menuStack) + " sel=" + menuSel + "\n"); } catch {}
        // MENU 2.0: Enter is active ONLY when the bar shows Confirm (Enter) —
        // EXCEPT on the command list (stack empty): there Enter RUNS the command.
        if (menuStack.length > 0) {
          try {
            const curIt: any = (menuItemsCache || [])[menuSel];
            if (!needsConfirmFor(curIt)) {
              try { ui.requestRender(); } catch {}
              return;
            }
          } catch {}
        }
        // enter — app rules: Enter NEVER confirms directly. On a terminal option
        // the first Enter (or →) only LIGHTS the Confirm button; a second Enter,
        // with Confirm lit, executes. Opening a submenu is navigation, not a
        // confirmation, so that still happens on the first Enter.
        // T502 — THE bulletproof path: if the box holds a plain command text
        // ("/reload", no args) run it on the spot, no menu-item lookup at all.
        // This covers every menu/selection/focus quirk in any terminal: the
        // user's exact /reload bug ("confirm does nothing").
        try {
          const typedT = String(editorText() || "").trim();
          try { require("fs").appendFileSync("/tmp/q-bullet-trace.log", new Date().toISOString() + " bullet typed=" + JSON.stringify(typedT) + " mStack=" + menuStack.length + "\n"); } catch {}
          if (menuStack.length === 0 && /^\/[A-Za-z][A-Za-z0-9]*$/.test(typedT)) {
            const cName = typedT.slice(1).toLowerCase();
            const cCmd: any = commands.find((x: any) => x.name === cName);
            try { require("fs").appendFileSync("/tmp/q-bullet-trace.log", "  match=" + (!!cCmd) + " name=" + cName + "\n"); } catch {}
            if (cCmd) {
              try { editor.setText(""); } catch {}
              menuSel = 0;
              handleSlashRef?.("/" + cName);
              try { ui.requestRender(); } catch {}
              return;
            }
          }
        } catch {}
        const it: any = items[menuSel];
        // T484: Add-agent list — with at least one dot marked, ENTER SAVES right
        // away (Tab selects, one Enter adds: the user's rule). Before, this Enter
        // fell into the runItem toggle and UNMARKED the row instead of saving.
        if (menuStack[0] === "agentinsession" && menuStack[1] === "#add" && menuMarked.size > 0) {
          try { require("fs").appendFileSync("/tmp/q-agent-trace.log", new Date().toISOString() + " enter-save marked=" + JSON.stringify(Array.from(menuMarked)) + " sel=" + menuSel + "\n"); } catch {}
          if (it && !it.separator) agentActivate(String(it.value ?? ""));
          try { ui.requestRender(); } catch {}
          return;
        }
        if (!menuConfirmFocus) {
          if (!it || it.separator) return;
          if (menuStack[0] === "settings") {
            const deeper = settingsDeeper(it);
            if (deeper) {
              menuStack.push(deeper);
              menuSubFilter = "";
              menuSel = 0;
              try {
                if (deeper === "fallbacks") {
                  const cur = fbSeedList();
                  menuMarked = new Set<string>(cur.map((x: any) => String(x)));
                } else {
                  menuMarked = new Set<string>();
                }
              } catch {}
            } else {
              runItem(it); // MENU 2.0: Enter executes (never navigates)
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
                  const cur = fbSeedList();
                  menuMarked = new Set<string>(cur.map((x: any) => String(x)));
                } else {
                  menuMarked = new Set<string>();
                }
              } catch {}
            } else {
              runItem(it); // MENU 2.0: Enter executes (never navigates)
            }
          } else if (menuStack[0] === "agents") {
            const vA2 = String(it?.value || "");
            if (/^(#def|#you|#sk|#mcp|#tools|#plan|#plantools|#planmcp|ag:|ask:|atk:|amc:|sk:|mcp:|tool:)/.test(vA2)) {
              menuStack.push(vA2);
              menuSubFilter = "";
              menuSel = 0;
              try { menuMarked = new Set<string>(); } catch {}
            } else {
              runItem(it);
            }
          } else if (menuStack.length > 0) {
            runItem(it); // MENU 2.0: Enter executes (never navigates)
          } else {
            // T514 (the user's rule): at the ROOT the bar shows NO Confirm, so the
            // Enter must do ABSOLUTELY NOTHING. Commands open with the FORWARD
            // arrow; a fully typed plain command ("/reload") is run by the
            // bulletproof path above (the box must contain the real text).
            try { ui.requestRender(); } catch {}
          }
        } else {
          // Confirm is LIT: this Enter executes the selection.
          menuConfirmFocus = false;
          if (!it || it.separator) return;
          if ((menuStack[0] === "skill" || menuStack[0] === "attachments") && menuMarked.size === 0) {
            // NOTHING marked = no Confirm was shown = Enter does ABSOLUTELY NOTHING.
            try { ui.requestRender(); } catch {}
            return;
          }
          if (menuStack[0] === "skill" || menuStack[0] === "attachments") {
            // The ONE chips path (it closes the menu AND clears the "/skill" text).
            runItem(it);
          } else if (menuStack[0] === "settings") {
          runItem(it);
        } else if (menuStack[0] === "agentinsession") {
            // The agent menus NEVER close: every action returns to its parent level.
            agentActivate(String(it.value));
          } else if (menuStack.length > 0) {
            const cmdName = menuStack[0];
            menuStack = [];
            menuSubFilter = "";
            menuSel = 0;
            // T437: backing out / closing without confirming = the Tab marks are FORGOTTEN.
            try { menuMarked.clear(); menuConfirmFocus = false; } catch {}
            // NOTE: do NOT clear the textbox here — it wiped the chips the user had
            // just added from the menu (attachments/skills).
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
      const isCur = currentDefault && id === currentDefault;
      const isFb = currentFallbacks.some((f: any) => String(f) === id);
      const dot = isCur || isFb ? "\u25cf " : "\u25cb ";
      out.push({ value: id, label: dot + id, description: String(mm?.name || "") });
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
      try { require("fs").appendFileSync("/tmp/q-cli-fetch.log", JSON.stringify({ name, len: list.length, sample: list.slice(0, 3) }) + "\n"); } catch {}
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

  const wsKeyStatus: Record<string, boolean> = {};
  let wsKeyStatusAt: Record<string, number> = {};


  const fetchKeyStatus = (provName: string, cfgKey: string) => {


    try {


      const nowT = Date.now();
      const last = wsKeyStatusAt[provName] || 0;
      if (nowT - last < 4000 && wsKeyStatus[provName] !== undefined) return; // TTL: near-live, no RPC loop
      wsKeyStatusAt[provName] = nowT;
      if (cfgKey && String(cfgKey).length > 0 && String(cfgKey).length <= 300) { wsKeyStatus[provName] = true; return; }


      const call2 = (globalThis as any).__sidecarCall;


      if (call2) void call2('hasApiKey', { provider: provName }).then((r: any) => { wsKeyStatus[provName] = !!(r && (r.has ?? r.hasKey ?? r.ok)); try { ui.requestRender(); } catch {} }).catch(() => {});


    } catch {}


  };

  let addProvTmp: any = { name: "", baseUrl: "" };

  const settingsDeeper = (it: any): string | null => {
  const lv = menuStack[1] || "", sub = menuStack[2] || "", sub3 = menuStack[3] || "";
  const v = String(it?.value || "");
  if (!lv) return ["model", "fallbacks", "thinking", "providers", "defaults"].includes(v) ? v : null;
  if (lv === "fallbacks" && v === "__addfallback") return "addfallback";
  if (lv === "defaults" && !sub) return (v === "model" || v === "fallbacks" || v === "thinking") ? v : null;
  if (lv === "defaults" && sub === "fallbacks" && v === "__addfallback") return "addfallback";
  if (lv === "providers" && !sub) return (v.startsWith("prov:") || v === "__addprov") ? v : null;
  if (lv === "providers" && sub && !sub3) return (v === "key" || v === "baseurl" || v === "models" || v === "delprov" || v === "logout") ? v : null;
  return null;
};

  const settingsActivate = (value: string) => {
  const lv = menuStack[1] || "";
  const sub = menuStack[2] || "";
  const sub3 = menuStack[3] || "";
  if (value === "attachments" || lv === "attachments") {
    // Enter on the Attachments row = open the folder directly (like the app's
    // Open button). Cross-platform spawn, detached.
    try {
      const fsA = require("fs"), pathA = require("path"), osA = require("os");
      const baseA = pathA.join(osA.homedir(), ".quinki", "attachments");
      try { fsA.mkdirSync(baseA, { recursive: true }); } catch {}
      const cpA = require("child_process");
      const opener = process.platform === "darwin" ? "open" : (process.platform === "win32" ? "explorer" : "xdg-open");
      try { cpA.spawn(opener, [baseA], { detached: true, stdio: "ignore" }).unref(); } catch {}
    } catch {}
    return;
  }
  if (lv === "model") {
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
  if (lv === "thinking") {
    // Click "On"/"Off" = set exactly that (not a blind toggle).
    applySettingsPatch({ defaultThinkingLevel: value === "off" ? "off" : "xhigh" });
    return;
  }
  if (lv === "fallbacks") {
    if (value.startsWith("fb:")) {
      const idA = value.slice(3);
      const curA = (Array.isArray(wsSettings?.defaultFallbackModels) ? wsSettings.defaultFallbackModels : []).filter((x: any) => String(x) !== idA);
      try { const call = (globalThis as any).__sidecarCall; if (call) call('setSessionFallbacks', { sessionKey: currentKey, models: curA }).catch(() => {}); } catch {}
      wsSettings = { ...(wsSettings || {}), defaultFallbackModels: curA };
    }
    return;
  }
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
      try { const call = (globalThis as any).__sidecarCall; if (call) call('setSessionFallbacks', { sessionKey: currentKey, models: cur }).catch(() => {}); } catch {}
      wsSettings = { ...(wsSettings || {}), defaultFallbackModels: cur };
      return;
    }
    return;
  }
  if (lv === "providers") {
    if (sub3 === "logout" && value === "confirm") {
      const pname2 = String(sub || "").replace(/^prov:/, "");
      const SUBMAP2: Record<string, string> = {"Anthropic":"anthropic","xAI":"xai","OpenAI":"openai-codex","GitHub Copilot":"github-copilot","OpenRouter":"__openrouter__"};
      const subId2 = SUBMAP2[pname2];
      try {
        const pr2 = subId2 === "__openrouter__" ? sc.call("openRouterLogout", {}, 30000)
          : (subId2 ? sc.call("subscriptionLogout", { providerId: subId2 }, 30000) : Promise.resolve(null));
        void Promise.resolve(pr2).then(() => { try { wsKeyStatus[pname2] = false; } catch {} try { ui.requestRender(); } catch {} }).catch(() => {});
      } catch {}
      try { menuStack.pop(); menuStack.pop(); } catch {}
      return;
    }
    if (sub3 === "delprov" && value === "confirm") {
      const pname3 = String(sub || "").replace(/^prov:/, "");
      const pr3 = Promise.all([
        sc.call("deleteProvider", { name: pname3 }, 20000).catch(() => {}),
        sc.call("deleteApiKey", { service: pname3 }, 20000).catch(() => {}),
      ]);
      try { menuStack.pop(); menuStack.pop(); } catch {}
      try { ui.requestRender(); } catch {}
      // THE REAL FIX: readProvidersCfg keeps qProvidersMem forever — invalidate it
      // AFTER the sidecar really wrote the config, then re-render the list.
      void Promise.resolve(pr3).then(() => {
        try { qProvidersMem = null; } catch {}
        try { menuItemsCache = null; } catch {}
        try { ui.requestRender(); } catch {}
      }).catch(() => {});
      return;
    }
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
    if (sub && !sub3) {
      if (value === "toggle") { patchProvider(pname, (p) => { p.enabled = !p.enabled; }); }
      if (value === "logout") { return; }
      if (value === "delprov") { return; }
      if (value === "login") {
        const SUBMAP: Record<string, string> = {"Anthropic":"anthropic","xAI":"xai","OpenAI":"openai-codex","GitHub Copilot":"github-copilot","OpenRouter":"__openrouter__"};
        const subId = SUBMAP[pname];
        try {
          const pr = subId === "__openrouter__" ? sc.call("openRouterLogin", {}, 310000)
            : (subId ? sc.call("subscriptionLogin", { providerId: subId }, 310000) : Promise.resolve(null));
          void pr.then(() => { try { wsKeyStatus[pname] = true; } catch {} try { ui.requestRender(); } catch {} }).catch(() => {});
        } catch {}
        return;
      }
      return;
    }
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
    if (sub3 === "key" && value && !value.startsWith("__")) { if (String(value).length <= 300) { patchProvider(pname, (p) => { p.apiKey = String(value); }); } return; }
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
        // T485: SAME style as a confirmation notice (the /quit "Quit quinki?"
        // look): soft grey text, no red rule. Coherence, per the user.
        const rowsE: string[] = [];
        for (const ln of wrapPlain(menuError, Math.max(10, w))) rowsE.push(fg(C.textSecondary, ln));
        rowsE.push("");
        // T486: the footer is EXACTLY the normal menu footer (the /quit confirm
        // look): lit arrows (← back, → lights the Confirm), red "Close (Esc)",
        // "Confirm (Enter)" with its filled background while focused.
        const ARE = (ok: boolean, ch: string) => ok ? bold(fg(C.primary, ch)) : fg(C.textTertiary, ch);
        // No forward here (there is nothing ahead) and NO focus background on the
        // Confirm: the user wants it plain, like everywhere else.
        const leftE = ARE(false, "\u2191") + " " + ARE(false, "\u2193") + "  " + ARE(true, "\u2190") + " " + ARE(false, "\u2192");
        const rightE = fg(C.danger, "Close (Esc)") + "  " + fg(C.primary, "Confirm (Enter)");
        const gwE = Math.max(1, w - visibleWidth(leftE) - visibleWidth(rightE));
        rowsE.push(leftE + " ".repeat(gwE) + rightE);
        return rowsE;
      }
      // NOTE: a menu opened by a command (skill/attachments/directory) lives with an
      // EMPTY textbox: the old rule "no slash text -> close" was killing it right
      // after the command cleared the box (the skill menu never survived). Gone.
      const mainOpen = menuStack.length === 0 && t.startsWith("/") && !qIsFilePath(t);
      // T513: every time the agents menu is on screen, make sure the engine data
      // is fresh (throttled; covers ALL the ways the menu can be opened).
      try {
        if (menuStack[0] === "agents" && Date.now() - (refreshAgentsTab as any)._last > 4000) {
          (refreshAgentsTab as any)._last = Date.now();
          refreshAgentsTab();
        }
      } catch {}
      // T503 — ONE list only: the editor's own autocomplete (vendored) used to run
      // in parallel with OUR menu; the arrows moved one highlight while Enter read
      // the other list, so Confirm on "reload" executed a different row (nothing).
      // While our slash menu is open, the editor's autocomplete is dead.
      try { if (mainOpen || menuStack.length > 0) killAutocomplete(); } catch {}
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
      let MAXWIN = 12;
      try { MAXWIN = Math.max(8, Math.min(30, Math.floor(((ui as any)?.terminal?.rows || 40) * 0.45))); } catch {}
      const winStart = Math.max(0, Math.min(Math.max(0, items.length - MAXWIN), menuSel - Math.floor(MAXWIN / 2)));
      const winEnd = Math.min(items.length, winStart + MAXWIN);
      for (let i = winStart; i < winEnd; i++) {
        const it = items[i];
        let label = String(it.label ?? it.value ?? "");
        let desc = String(it.description ?? "");
        if ((it as any).separator) {
          // The ORIGINAL, approved look: blank + label + blank. Unlabeled dividers
          // are a single blank line.
          if (!label) { rows.push(""); continue; }
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
        if (menuMarked.has(String((it as any).value ?? ""))) {
          // Selected rows: filled dot (●), consistent with the app's pallini.
          if (label.startsWith("\u25cb ")) label = "\u25cf " + label.slice(2);
          else if (!label.startsWith("\u25cf")) label = "\u25cf " + label;
        }
        // NEVER color labels: only the selector (bg) may be violet.
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
      const canBack = (menuStack || []).length > 0;
      let canFwd = false;
      try {
        const curA: any = items[menuSel];
        if (!menuStack.length && curA && !curA.separator) {
          // T513: at the root the arrow lights on commands that OPEN something.
          const cR: any = (typeof commands !== "undefined" ? commands.find((c: any) => c.name === curA.value) : null);
          if (cR && typeof cR.getArgumentCompletions === "function") canFwd = true;
        }
        if (curA && !curA.separator) {
          if (menuStack[0] === "agentinsession") canFwd = !!agentLevelFor(curA); // T492: remove = no forward (nothing ahead)
          else if (menuStack[0] === "agents") {
            // T512: the arrow lights when the row opens something (a section, an
            // agent's editor, a per-skill agent list...) — never on the toggles.
            const vF = String(curA.value || "");
            canFwd = /^(#def|#you|#sk|#mcp|#tools|#plan|#plantools|#planmcp|ag:|ask:|atk:|amc:|sk:|mcp:|tool:)/.test(vF);
          }
          else if (menuStack[0] === "settings") canFwd = !!settingsDeeper(curA);
          else if (menuStack[0] === "directory") canFwd = menuStack[1] === "dirchange" ? false : (String(curA.value || "") === "__dir_change"); // -> lights only on Change directory
          else if (menuStack.length > 0) canFwd = false;
          else {
            const cA: any = commands.find((c: any) => c.name === curA.value);
            canFwd = !!(cA && typeof cA.getArgumentCompletions === "function");
          }
        }
      } catch {}
      const nSelectable = (() => { try { return (items || []).filter((x: any) => x && !x.separator).length; } catch { return 0; } })();
      const canUD = nSelectable > 1;
      const AR = (ok: boolean, ch: string) => ok ? bold(fg(C.primary, ch)) : fg(C.textTertiary, ch);
      const left = AR(canUD, "\u2191") + " " + AR(canUD, "\u2193") + "  " + AR(canBack, "\u2190") + " " + AR(canFwd, "\u2192");
      const inAddAgents = menuStack[0] === "agentinsession" && menuStack[1] === "#add";
      const inAgentsTab = menuStack[0] === "agents" && menuStack.length >= 2 && /^(#def|#plantools|#planmcp|ask:|atk:|amc:|sk:|mcp:|tool:)/.test(String(menuStack[menuStack.length - 1] || "")); // T519: the LAST level (stack[1] broke 2-deep menus)
      const inAgentPick2 = menuStack[0] === "agentinsession" && String(menuStack[2] || "").match(/^(model|thinking)$/);
      const hasMulti = (menuStack[0] === "model" || menuStack[0] === "thinking" || inAddAgents || inAgentsTab || inAgentPick2 || (menuStack[0] === "directory" && !menuStack[1]) || menuStack[0] === "attachments" || menuStack[0] === "skill") || (menuStack[0] === "settings" && (menuStack[3] === "models" || menuStack[1] === "model" || menuStack[1] === "fallbacks" || menuStack[1] === "thinking" || (menuStack[1] === "defaults" && (menuStack[2] === "fallbacks" || menuStack[2] === "model" || menuStack[2] === "thinking")) || (menuStack[1] === "providers" && !menuStack[2])));
      // Confirm appears ONLY when the highlighted option actually RUNS something
      // (navigation items and read-only pages do not show it).
      let needsConfirm = menuConfirmFocus;
      try {
        const cur: any = items[menuSel];
        needsConfirm = needsConfirmFor(cur);
      } catch {}
      // Select (Tab) shows ONLY when the highlighted row can actually be selected
      // (e.g. NOT on "Change directory…", NOT in the submenu).
      const rowMultiOk = (() => { try {
        const cu: any = items[menuSel];
        if (!cu || cu.separator) return false;
        const v = String(cu.value || "");
        if (menuStack[0] === "directory") return v.startsWith("__dir_use:");
        if (menuStack[0] === "attachments") return v.startsWith("__at_file:");
        if (v.startsWith("__")) return false;
        return true;
      } catch { return false; } })();
      const right =
        fg(C.danger, "Close (Esc)") +
        "  " +
        ((hasMulti && rowMultiOk) ? fg(C.modeBuild, "Select (Tab)") + "  " : "") +
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
  try { require("fs").appendFileSync("/tmp/q-enter-trace.log", new Date().toISOString() + " BOOT: menuNavRef ASSIGNED\n"); } catch {}
  try {
    (globalThis as any).__qMenuSelect = () => {
      try { require("fs").appendFileSync("/tmp/q-tab-trace.log", new Date().toISOString() + " hop2 qMenuSelect stack=" + JSON.stringify(menuStack) + "\n"); } catch {}
      try {
        if (menuStack && menuStack.length > 0) {
          menuNav("select");
          try { ui.requestRender(); } catch {}
          return true;
        }
        // Completions phase (typing "/command"): consume the Tab as well — the
        // slash menu must NEVER close on Tab.
        try { const e0 = String(editorText() || ""); if (e0.startsWith("/") && !qIsFilePath(e0)) return true; } catch {}
      } catch {}
      return false;
    };
  } catch {}

  // --- input -------------------------------------------------------------------
  const shutdown = (why?: string) => {
    try { require("fs").appendFileSync("/tmp/q-cli-survive.log", "shutdown called: " + String(why || "") + "\n" + String(new Error().stack) + "\n"); } catch {}
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
   try {
    const t = (text || "").trim();
    if (/^\/+$/.test(t)) {
      // Bare slash: NOTHING happens (the panel stays, the text stays).
      try { editor.setText(String(text || "")); } catch {}
      return;
    }
    if (t.startsWith("/")) {
      // T448 belt: a REAL file path typed/pasted plain = ATTACHMENT (chip it), not a command.
      try {
        const fsp2 = require("fs");
        if (fsp2.existsSync(t) && fsp2.statSync(t).isFile()) {
          const stE = stageAttachment(t) || { path: t, originalName: require("path").basename(t) };
          try { pendingAttachments.push(stE as any); } catch {}
          const nmE = String((stE as any).originalName);
          attPathByName[nmE] = String((stE as any).path);
          editor.setText(nmE);
          try { editor.setCursorCol(editor.getText().length); } catch {}
          qCursorEnd();
          return;
        }
      } catch {}
      try {
        require("fs").appendFileSync("/tmp/q-submit.log", new Date().toISOString() + " submit " + JSON.stringify(t) + "\n");
      } catch {}
      try {
        editor.setText("");
      } catch {}
      handleSlash(t);
      return;
    }
    if (streaming) {
      // The editor clears its state BEFORE calling onSubmit: during a generation
      // Enter must do NOTHING — put the text back where it was (same look).
      try { editor.setText(String(text || "")); } catch {}
      return;
    }
    if (!t) return;
    editor.setText("");
    if (welcomeShown) {
      // T489: snapshot BEFORE the reset — the send below reads it for setChatAgents.
      // (var: the async IIFE closes over it; a let here would hit the TDZ.)
      var qSendAgents: string[] | null = null;
      try { if (welcomeShown) { const idsW = sessionAgentIds(); if (idsW.length) qSendAgents = [...idsW]; } } catch {}
      welcomeShown = false;
      applyLayout(false);
      qWelcomeAgents = null; // T487: the welcome pre-config is one-shot
      // The new chat has its OWN directory data: drop the welcome's (stale) one.
      // (The refetch happens AFTER ensureSession — before that the sidecar would
      // answer with the default folder, which then wrongly sticks in the header.)
      try { qDirs = null; qDirsKey = ""; } catch {}
    }
    // User bubble with the footer INSIDE it (no info glyph on user messages).
    // ONE push only — the old plain Text bubble was removed (it doubled).
    {
      const now = Date.now();
      if (!(lastUserPush.text === t && now - lastUserPush.ts < 2000)) {
        lastUserPush = { text: t, ts: now };
        // The bubble shows the ORIGINAL text: the clips stay INLINE, in the same
        // order and look as the textbox.
        pushBlock(new UserBubble(t, fmtFooterDate(now), []));
      }
    }
    if (scOn || (sc as any).connected) {
      // Live path: the sidecar runs the turn (agents, custom tools, delegation)
      // and the app sees this exact chat streaming in real time.
      streaming = true;
      setStatus("Sending", "sending");
      updateBar();
      const sk = currentKey;
      sessionEntryAllowed = true; // now the chat really exists (first message)
      // Write the entry IMMEDIATELY (with the chosen folder): the headline shows
      // the right directory from the very first render — no menu visit needed.
      try {
        if (pendingWorkingDir) {
          mutateSessionEntry((e2: any) => { e2.workingDir = pendingWorkingDir; });
        } else {
          ensureSessionEntry();
        }
      } catch {}
      // Inline chips: the "\u25b8name" tokens travel as params; the text goes clean
      // (exactly what the sidecar/app expect).
      // var (function-scoped): the async IIFE below closes over it — a `let` here
      // hits the TDZ in the bundle and threw "sendText is not defined".
      var sendText = t;
      const skills: string[] = [];
      const skillRefs: Array<{ agentId: string; skillName: string; agentName?: string }> = [];
      const atts: Array<{ path: string }> = [];
      try {
        sendText = String(t)
          .replace(/\bSkill:\s*([\w.-]+)/g, (_m: string, nm: string) => {
            // The chip + directly-typed text merge ("quinki-marketciao"): the LONGEST
            // known skill name wins; the remainder goes back into the message text.
            let name = nm; let rest = "";
            try {
              const known = Object.keys(skillRefsByName).filter((k) => nm.startsWith(k) && k).sort((a, b) => b.length - a.length);
              if (known.length && known[0] !== nm) { name = known[0]; rest = nm.slice(name.length); }
            } catch {}
            try {
              const q = skillRefsByName[name];
              const ref = q && q.length ? q.shift() : null;
              if (ref) skillRefs.push(ref);
              else skillRefs.push({ agentId: "", skillName: name });
              skills.push(name);
            } catch { skillRefs.push({ agentId: "", skillName: name }); skills.push(name); }
            return rest;
          })
          .replace(new RegExp("(?:^|\\s)(?:\\u25b8([^\\s\\u25b8]+)|(" + (qAttNames().filter((n) => !!n && !/[\\x00-\\x1f\\x7f]/.test(n)).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "\\u0000NONE") + "))", "g"), (_m: string, nmTri: string, nmBare: string) => {
            const nn = nmTri !== undefined ? nmTri : nmBare;
            if (nn === undefined) return _m;
            const nm = nn;
            let name = String(nm); let restA = "";
            try {
              const knownA = Object.keys(attPathByName).filter((k) => name.startsWith(k) && k).sort((a, b) => b.length - a.length);
              if (knownA.length && knownA[0] !== name) { restA = name.slice(knownA[0].length); name = knownA[0]; }
            } catch {}
            if (attPathByName[name] && fs.existsSync(attPathByName[name])) atts.push({ path: attPathByName[name], originalName: name } as any);
            else {
              skills.push(name);
              // The chip's REAL agent (the app's mechanism): queue -> ref; manual
              // typing falls back to the chat's primary agent.
              try {
                const q = skillRefsByName[name];
                const ref = q && q.length ? q.shift() : null;
                if (ref) skillRefs.push(ref);
                else skillRefs.push({ agentId: "", skillName: name });
              } catch { skillRefs.push({ agentId: "", skillName: name }); }
            }
            return restA;
          })
          .replace(/[\uE000-\uE0FF]/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
      } catch { sendText = t; }
      try { pendingSkills.splice(0); pendingAttachments.splice(0); } catch {}
      try { for (const k of Object.keys(skillRefsByName)) delete skillRefsByName[k]; } catch {}
      try { ui.requestRender(); } catch {}
      var _chipNames: Array<{ kind: string; name: string }> = [];
      try {
        for (const sk3 of skills) _chipNames.push({ kind: "skill", name: String(sk3) });
        for (const at3 of atts) _chipNames.push({ kind: "attachment", name: require("path").basename(String((at3 as any)?.path || "")) });
      } catch {}
      const fail = (err: any) => {
        addRow(fg(C.danger, "\u25b8 error \u00b7 " + truncate(String(err?.message || err), 120)));
        streaming = false;
        updateBar();
      };
      void (async () => {
        try {
          await sc.call("ensureSession", { sessionKey: sk, label: "Chat", workingDir: (pendingWorkingDir && pendingWorkingDir !== "undefined" ? pendingWorkingDir : undefined) }, 20000);
          // Now the sidecar knows the session: fetch the real list for the header.
          try { qDirs = null; qDirsKey = ""; qDirsKick(); } catch {}
          // The welcome preview CLEARS once the chat is born (the dir now lives in the chat).
          try { if (pendingWorkingDir) pendingWorkingDir = ""; } catch {}
          // T493: multi-agent chats REQUIRE the Orchestrator (the app's new rule;
          // @-tagging is gone). Same error the app shows, as a chat error message.
          try {
            const sendAgents = qSendAgents || sessionAgentIds();
            if (sendAgents.length > 1 && !sendAgents.includes("orchestrator")) {
              const errMsg = "This chat has multiple agents.\n\nTo send messages, add the Orchestrator to the chat.";
              // T494: the send path already set streaming + "Sending" — undo both,
              // or the status pill stayed stuck on sending forever.
              try { streaming = false; } catch {}
              try { setStatus("", ""); } catch {}
              try { updateBar(); } catch {}
              try { (ui as any).requestImmediateRender?.(); } catch {}
              // Red error in the chat: wait for the inject RPC, then refresh (the
              // history renderer paints isError+errorContent in red, like the app).
              void sc.call("injectErrorExchange", { sessionKey: sk, userMessage: t, errorContent: errMsg, timestamp: Date.now() }).then(() => {
                void loadServerHistory().then(() => {
                  try { renderHistory(); scrollToEnd(); } catch {}
                  try { (ui as any).requestImmediateRender?.(); } catch {}
                });
              }).catch(() => {});
              return;
            }
          } catch {}
          // Sync the engine with the session's REAL configuration: agents in the
          // chat (default quinki), mode, model and thinking — otherwise the
          // runtime runs a bare session without the user's tools/skills/MCP.
          await sc.call("setChatAgents", { sessionKey: sk, agentIds: (qSendAgents || sessionAgentIds()).join(",") }, 20000);
          await sc.call(
            "sendMessage",
            {
              sessionKey: sk,
              text: sendText || (atts.length || skills.length ? "" : t),
              ...(String(t).trim() !== String(sendText).trim() ? { displayText: (() => {
              // Canonical saved copy: recognized attachment names carry the internal
              // marker (context-free detection at reload — this is how the bubble
              // knows to paint the chip background); the bubble strips it when
              // drawing. The editor text itself stays bare (T462 rule).
              let d2 = String(t).trim().replace(/\u25b8(?=\S)/g, "");
              try {
                const names2 = qAttNames().filter((n) => !!n && !/[\x00-\x1f\x7f]/.test(n)).sort((a, b) => b.length - a.length);
                for (const n of names2) {
                  const esc2 = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  d2 = d2.replace(new RegExp("(^|\\s)(" + esc2 + ")(?=\\s|$)", "g"), (_m: string, sp: string) => sp + "\u25b8" + n);
                }
              } catch {}
              return d2;
            })() } : {}),
              ...(skillRefs.length
                ? {
                    // THE APP'S EXACT SHAPE: [{ agentId, skillName, agentName }] —
                    // each skill goes to the agent that OWNS it (delegation/tag).
                    skillNames: skillRefs.map((r) => {
                      const ag0 = r.agentId || String((sessionAgentIds().find((x: string) => x === "orchestrator") || sessionAgentIds()[0]) || "quinki");
                      return { agentId: ag0, skillName: String(r.skillName), agentName: r.agentName || agentDisplayName(ag0) };
                    }),
                  }
                : {}),
              ...(atts.length ? { attachments: atts } : {}),
              // Only what the USER changed here: otherwise the session/app
              // defaults decide (no forced model, no forced thinking).
              ...(modelExplicit && wsModelId ? { model: wsModelId } : {}),
              ...(thinkingExplicit ? { thinkingLevel: thinkingOn ? "xhigh" : "off" } : {}),
              mode,
              // BELT: the chat's directory travels WITH the turn — the engine can
              // never run in a stale folder (pool workers, mid-session changes).
              ...(() => { try { const d0 = currentDirAny(); return d0 ? { workingDirs: [d0] } : {}; } catch { return {}; } })(),
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
   } catch (outer: any) {
     // Safety net: never freeze the CLI — log the real cause for diagnosis.
     try { require("fs").appendFileSync("/tmp/q-cli-errors.log", new Date().toISOString() + " send: " + String(outer && outer.stack || outer) + "\n"); } catch {}
     try { addRow(fg(C.danger, "\u25b8 error \u00b7 " + truncate(String(outer?.message || outer), 120))); } catch {}
     streaming = false;
     try { updateBar(); } catch {}
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
    // App Expert mode: straight into the session (no welcome): load the expert
    // history (the SAME conversation as the app). Retry until the sidecar link
    // is up: at boot the websocket may not be connected yet.
    if (QEXPERT) {
      welcomeShown = false;
      // Respect the session's own mode/thinking (synchronised with the app).
      try {
        const list = readSessionsList();
        const entry = (list || []).find((x: any) => String(x?.key || "") === currentKey);
        if (entry) {
          if (entry.mode === "build" || entry.mode === "plan") mode = entry.mode;
          if (entry.thinkingLevel && entry.thinkingLevel !== "off") thinkingOn = true;
          else if (entry.thinkingLevel === "off") thinkingOn = false;
          if (entry.model) { wsModelId = String(entry.model); }
          updateBar();
        }
      } catch {}
      let __qxTries = 0;
      const __qxLoad = () => {
        __qxTries++;
        try { require("fs").appendFileSync("/tmp/q-load.log", new Date().toISOString() + " qxLoad try=" + __qxTries + " scOn=" + scOn + " connected=" + !!(sc as any).connected + " key=" + currentKey + "\n"); } catch {}
        void loadServerHistory().then((ok) => {
          try { if (ok) { renderHistory(); scrollToEnd(); } } catch {}
          try { ui.requestRender(); } catch {}
          // The ScrollView settles a moment later (layout): re-pin to the bottom.
          try { if (ok) { setTimeout(scrollToEnd, 250); setTimeout(scrollToEnd, 900); setTimeout(scrollToEnd, 2000); } } catch {}
          if (!ok && __qxTries < 12) setTimeout(__qxLoad, 1200);
        }).catch(() => { if (__qxTries < 12) setTimeout(__qxLoad, 1200); });
      };
      __qxLoad();
    }

    ui.start();

    // Re-assert the terminal background AFTER the UI is live and force a full
    // repaint: some terminals only apply the OSC 11 colour on a later run,
    // which made the background look wrong on the very first launch.
    try {
      const setBg = () => {
        try { process.stdout.write("\x1b]11;#08080b\x07"); } catch {}
        try { (ui as any).requestRender?.(); } catch {}
        try { if ((ui as any).fullRedrawRequested !== undefined) (ui as any).fullRedrawRequested = true; } catch {}
      };
      setBg();
      setTimeout(setBg, 400);
      setTimeout(setBg, 1500);
    } catch {}
  } catch (err) {
    process.stderr.write("quinki: could not start the terminal UI: " + String((err as any)?.message || err) + "\n");
    process.exit(1);
  }
}
