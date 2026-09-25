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

import { C, fg, bg, bgKeepPanel, collapsed, counterColor, blend, bold } from "./theme";

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
  const session: any = res?.session || res;

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
  const titleText = new Text("", 0, 0);
  const header = new BgBlock(titleText, 1, (s: string) => bg(C.bgPanel, s), 1);
  titleText.setText(fg(C.textSecondary, "\u25a4") + " " + fg(C.text, "New chat"));

  // Chat transcript (scrolls, grows)
  const content = new Container();
  const scroll = new ScrollView(content);

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

  // Slash commands — ONLY commands that actually work, ALL silently (no chat
  // output). Commands with options open an app-style submenu (argument list).
  const commands = [
    {
      name: "thinking",
      description: "Thinking: on / off",
      getArgumentCompletions: (prefix: string) =>
        [
          { value: "on", label: "on", description: "Thinking ON \u2014 always the maximum level" },
          { value: "off", label: "off", description: "Thinking OFF" },
        ].filter((i) => i.value.startsWith(prefix)),
    },
    {
      name: "compaction",
      description: "Compact now, or toggle auto-compaction",
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
    { name: "reload", description: "Reload this chat (recover history, fix glitches)" },
    { name: "export", description: "Export this chat as Markdown" },
    {
      name: "quit",
      description: "Exit quinki (asks for confirmation)",
      getArgumentCompletions: () => [
        { value: "yes", label: "yes", description: "Yes, exit quinki" },
        { value: "no", label: "no", description: "No, keep it open" },
      ],
    },
  ];
  // The slash menu is OURS (rendered via editor.menuLinesFn): it never writes
  // command text into the box — navigation and options live in the menu only.

  // Tab = toggle plan/build (app behaviour), intercepted at the TUI level.
  try {
    ui.addInputListener((data: string) => {
      // Kitty-capable terminals also report key RELEASE events (e.g. "\x1b[1;1:3C"):
      // they must NEVER be treated as a second press — ↓ would jump two rows and
      // → would confirm & close the menu at once. Drop them all.
      if (isKeyRelease(data)) {
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
      const root = welcome
        ? new WelcomeRoot(boxWrap, hintWrap, () => (ui as any)?.terminal?.rows || 24)
        : new VStack([
            { component: headerWrap, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
            { component: new CenterBox(new InsetBox(scroll, qInsetCols)) as any, basis: 0, grow: 1, shrink: 1, minSize: 1 },
            { component: boxWrap, basis: "auto", grow: 0, shrink: 1, minSize: 5 },
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
    const home = process.env.HOME || "";
    const dir = home && opts.cwd.startsWith(home) ? "~" + opts.cwd.slice(home.length) : opts.cwd;
    const sep = fg(C.textTertiary, "  \u00b7  ");
    const quiet = (s: string) => fg(C.textTertiary, s);
    const modeStr = mode === "plan" ? fg(C.modePlan, "Plan") : fg(C.modeBuild, "Build");
    return (
      modeStr +
      sep +
      ctxStr +
      sep +
      quiet(modelId) +
      sep +
      quiet("thinking " + (thinkingOn ? "on" : "off")) +
      sep +
      quiet(dir)
    );
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

    const left = menuActive ? lit("/command") : quiet("/command");
    const sep = fg(C.textTertiary, "  \u00b7  ");
    const enterKey = cmdReady
      ? bold(bg(C.primary, fg(C.bgPanel, " Enter ")))
      : canSend
        ? lit("Enter")
        : quiet("Enter");
    const right =
      (escLit ? lit("Esc") : quiet("Esc")) +
      sep +
      (canSteer ? lit("Ctrl+Enter") : quiet("Ctrl+Enter")) +
      sep +
      enterKey;

    // "Quinki" always lit violet, perfectly centered in the row.
    const brand = fg(C.primary, "Quinki");
    const lw = visibleWidth(left);
    const rw = visibleWidth(right);
    const bw = 6;
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

  const addRow = (styled: string, indent = 1) => {
    const row = new Text(styled, indent, 0);
    content.addChild(row);
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
  session.subscribe((e: any) => {
    try {
      if (e?.type === "agent_start") {
        streaming = true;
        updateBar();
      } else if (
        e?.type === "message_update" &&
        e?.assistantMessageEvent &&
        e?.message?.role === "assistant"
      ) {
        const ame = e.assistantMessageEvent;
        if (ame.type === "text_delta") {
          if (!assistant) {
            assistant = new Markdown("", 1, 0, mdTheme);
            content.addChild(assistant);
          }
          assistantText += ame.delta || "";
          assistant.setText(assistantText);
          scrollToEnd();
        } else if (ame.type === "thinking_delta") {
          thinkingText += ame.delta || "";
          if (!thinkingRow) {
            thinkingRow = new Text("", 1, 0);
            content.addChild(thinkingRow);
          }
          thinkingRow.setText(collapsed(C.thinking, "\u25b8 Thinking \u00b7 " + truncate(thinkingText, 80)));
          scrollToEnd();
        }
      } else if (e?.type === "tool_execution_start") {
        const name = e.toolName || e.name || e.tool?.name || "tool";
        addRow(collapsed(C.toolCall, `\u25b8 Tool call \u00b7 ${name}`));
        assistant = null;
        assistantText = "";
      } else if (e?.type === "tool_execution_end") {
        const name = e.toolName || e.name || e.tool?.name || "tool";
        const isErr = !!e.isError;
        const col = isErr ? C.danger : C.toolResult;
        addRow(collapsed(col, `\u25b8 Tool result \u00b7 ${name}${isErr ? " \u00b7 error" : ""}`));
      } else if (e?.type === "message_end" && e?.message?.role === "assistant") {
        if (assistantText) lastAssistantText = assistantText;
        assistant = null;
        assistantText = "";
        thinkingRow = null;
        thinkingText = "";
      } else if (e?.type === "agent_end") {
        streaming = false;
        updateCtx();
        updateBar();
      }
    } catch {}
    try {
      ui.requestRender();
    } catch {}
  });

  // --- slash commands -----------------------------------------------------------
  /** Rebuild the transcript from the saved history (the /reload command). */
  const renderHistory = () => {
    try {
      content.clear();
      const msgs: any[] = (session.messages || []) as any[];
      for (const m of msgs) {
        if (m.role === "user") {
          let t = "";
          const c = m.content;
          if (typeof c === "string") t = c;
          else if (Array.isArray(c)) t = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
          if (t.trim()) content.addChild(new Text(t, 2, 1, (s: string) => bg(C.bubbleUser, s)));
        } else if (m.role === "assistant") {
          const c = m.content;
          let think = "";
          let text = "";
          if (Array.isArray(c)) {
            for (const b of c) {
              if (b?.type === "text") text += b.text || "";
              else if (b?.type === "thinking" || b?.type === "reasoning") think += b.thinking || b.text || "";
            }
          } else if (typeof c === "string") {
            text = c;
          }
          if (think.trim()) content.addChild(new Text(collapsed(C.thinking, "\u25b8 Thinking \u00b7 " + truncate(think, 80)), 1, 0));
          if (text.trim()) content.addChild(new Markdown(text, 1, 0, mdTheme));
        }
      }
      scrollToEnd();
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
            void Promise.resolve(session.compact?.()).catch(() => {});
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
          const msgs: any[] = (session.messages || []) as any[];
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
          const file = path.join(opts.cwd, `quinki-chat-${Date.now().toString(36)}.md`);
          fs.writeFileSync(file, out.join("\n"), "utf8");
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
    return commands
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
        // Wrap-around like the app: from the FIRST item UP goes to the LAST.
        menuConfirmFocus = false;
        if (items.length > 0) menuSel = (menuSel - 1 + items.length) % items.length;
      } else if (a === "down") {
        // Wrap-around like the app: from the LAST item DOWN goes to the FIRST.
        menuConfirmFocus = false;
        if (items.length > 0) menuSel = (menuSel + 1) % items.length;
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
        if (!it) return;
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
      const rows: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        let label = String(it.label ?? it.value ?? "");
        let desc = String(it.description ?? "");
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
    content.addChild(new Text(t, 2, 1, (s: string) => bg(C.bubbleUser, s)));
    scrollToEnd();
    streaming = true;
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
