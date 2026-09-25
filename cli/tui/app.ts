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
    const colW = Math.max(8, Math.min(width - 4, 168));
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
      selectedPrefix: (s: string) => bold(fg(C.primary, s)),
      selectedText: (s: string) => bold(fg(C.primary, s)),
      description: (s: string) => fg(C.textTertiary, s),
      scrollInfo: (s: string) => fg(C.textTertiary, s),
      noMatch: (s: string) => fg(C.textTertiary, s),
    },
  };
  const editor = new Editor(ui as any, editorTheme, { paddingX: 1 });
  try {
    (editor as any).bgFn = (s: string) => bg(C.bgPanel, s);
  } catch {}

  // Slash commands — ONLY commands that actually work, and NONE of them writes
  // into the chat: they change state silently (visible in the status bar).
  const commands = [
    { name: "mode", description: "Toggle plan/build (or: /mode plan | /mode build)" },
    { name: "thinking", description: "Toggle thinking on/off (on = always max)" },
    { name: "copy", description: "Copy the last reply to the clipboard" },
    { name: "export", description: "Export this chat as Markdown" },
    { name: "quit", description: "Exit quinki" },
  ];
  try {
    const fdPath = fs.existsSync(path.join(opts.agentDir, "bin", "fd"))
      ? path.join(opts.agentDir, "bin", "fd")
      : undefined;
    (editor as any).setAutocompleteProvider(
      new (CombinedAutocompleteProvider as any)(commands, opts.cwd, fdPath)
    );
    (editor as any).setAutocompleteMaxVisible?.(8);
  } catch {}

  // Tab = toggle plan/build (app behaviour), intercepted at the TUI level.
  try {
    ui.addInputListener((data: string) => {
      if (data === "\t" || data === "\x1b[9u" || data === "\x1b[9;1u") {
        toggleModeRef?.();
        return { consume: true };
      }
      if (data === "\x1b") {
        // Esc: flash its hint violet for a moment (not consumed — the editor
        // still handles stop / menu-cancel).
        escFlashUntil = Date.now() + 450;
        try {
          ui.requestRender();
        } catch {}
        setTimeout(() => {
          try {
            ui.requestRender();
          } catch {}
        }, 500);
      }
      return undefined;
    });
  } catch {}

  const boxWrap = new CenterBox(editor) as any;
  let hintRow: any = null;
  const applyLayout = (welcome: boolean) => {
    try {
      const headerWrap = new CenterBox(header) as any;
      const hintWrap = new CenterBox(hintRow) as any;
      const root = welcome
        ? new WelcomeRoot(boxWrap, hintWrap, () => (ui as any)?.terminal?.rows || 24)
        : new VStack([
            { component: headerWrap, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
            { component: new CenterBox(scroll) as any, basis: 0, grow: 1, shrink: 1, minSize: 1 },
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
  let escFlashUntil = 0;

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
    // Thin mode-colored left edge on the box (opencode style): Plan pink / Build orange.
    (editor as any).edgeFn = () => fg(mode === "plan" ? C.modePlan : C.modeBuild, "\u258f");
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
    const menuActive = !!((editor as any)?.autocompleteState && (editor as any)?.autocompleteList);
    const canSend = hasText() && !streaming;
    const canSteer = streaming && hasText();
    const escLit = Date.now() < escFlashUntil;

    const left = menuActive ? lit("/command") : quiet("/command");
    const sep = fg(C.textTertiary, "  \u00b7  ");
    const right =
      (escLit ? lit("Esc") : quiet("Esc")) +
      sep +
      (canSteer ? lit("Ctrl+Enter") : quiet("Ctrl+Enter")) +
      sep +
      (canSend ? lit("Enter") : quiet("Enter"));
    const lw = visibleWidth(left);
    const rw = visibleWidth(right);
    const gap = Math.max(1, width - lw - rw);
    return left + " ".repeat(gap) + right;
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
  const handleSlash = (raw: string) => {
    const parts = raw.slice(1).split(/\s+/);
    const cmd = (parts.shift() || "").toLowerCase();
    const arg = parts.join(" ").trim();
    switch (cmd) {
      case "mode": {
        if (arg === "plan" || arg === "build") mode = arg;
        else toggleMode();
        break;
      }
      case "thinking": {
        thinkingOn = !thinkingOn;
        try {
          session.setThinkingLevel?.(thinkingOn ? "xhigh" : "off");
        } catch {}
        break;
      }
      case "copy": {
        if (lastAssistantText) {
          try {
            execSync("pbcopy", { input: lastAssistantText });
          } catch {}
        }
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
        shutdown();
        break;
      }
    }
    try {
      ui.requestRender();
    } catch {}
  };

  // --- input -------------------------------------------------------------------
  const shutdown = () => {
    try {
      ui.stop();
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
