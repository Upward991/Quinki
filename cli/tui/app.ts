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
  visibleWidth,
} from "../../sidecar-src/vendor/@earendil-works/pi-tui/dist/index.js";

import { C, fg, bg, collapsed, counterColor, blend, bold } from "./theme";

// Engine (bundled at build time — literal specifiers only).
import * as sdk from "../../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/index.js";
import * as compaction from "../../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js";

export interface TuiOptions {
  cwd: string;
  agentDir: string;
  sessionDir: string;
}

/** Centered window column (like the app: content column centered in the window). */
class CenterBox {
  child: any;
  maxWidth: number;
  constructor(child: any, maxWidth = 100) {
    this.child = child;
    this.maxWidth = maxWidth;
  }
  render(width: number): string[] {
    const outer = Math.max(0, Math.min(2, Math.floor((width - 40) / 2)));
    const colW = Math.max(40, Math.min(width - outer * 2, this.maxWidth));
    const left = Math.floor((width - colW) / 2);
    const right = width - colW - left;
    const lines = this.child?.render(colW) || [];
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

/** Full-width divider line (app's header separator look). */
class RuleLine {
  render(width: number): string[] {
    return [fg(C.border, "\u2500".repeat(Math.max(0, width)))];
  }
  invalidate() {}
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

  // Header (fixed, top): title … ctx counter, with the app-style divider under it.
  const titleText = new Text("", 1, 0);
  const ctxText = new Text("", 1, 0);
  const headerRow = new HStack([
    { component: titleText, grow: 1 },
    { component: ctxText, basis: "auto", grow: 0 },
  ]);
  const header = new VStack([
    { component: headerRow, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
    { component: new Spacer(1), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
    { component: new RuleLine() as any, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
    { component: new Spacer(1), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
  ]);
  titleText.setText(fg(C.text, "\u25cf") + " " + fg(C.primary, "quinki") + fg(C.textSecondary, "  \u00b7 New chat"));

  // Chat transcript (scrolls, grows)
  const content = new Container();
  const scroll = new ScrollView(content);

  // Composer (fixed, bottom): rounded box with the bar INSIDE (app look)
  const editorTheme = {
    borderColor: (s: string) => fg(C.border, s),
    selectList: {
      selectedPrefix: (s: string) => fg(C.info, s),
      selectedText: (s: string) => fg(C.text, s),
      description: (s: string) => fg(C.textSecondary, s),
      scrollInfo: (s: string) => fg(C.textTertiary, s),
      noMatch: (s: string) => fg(C.textTertiary, s),
    },
  };
  const editor = new Editor(ui as any, editorTheme, { paddingX: 1 });

  const root = new VStack([
    { component: new CenterBox(header) as any, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
    { component: new CenterBox(scroll) as any, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: new CenterBox(editor) as any, basis: "auto", grow: 0, shrink: 1, minSize: 5 },
    { component: new Spacer(1), basis: "auto", grow: 0, shrink: 0, minSize: 1 },
  ]);

  for (const c of [header, scroll, editor]) {
    try {
      ui.addChild(c as any);
    } catch {}
  }
  try {
    ui.setLayoutRoot(root as any);
  } catch {}
  try {
    ui.setFocus(editor as any);
  } catch {}

  // --- state ------------------------------------------------------------------
  let streaming = false;
  const mode: "plan" | "build" = "build";
  let ctxTokens = 0;
  let ctxWindow = 0;

  let assistant: any = null;
  let assistantText = "";
  let thinkingRow: any = null;
  let thinkingText = "";
  const welcomeEls: any[] = [];

  const accent = C.info; // --q-tab-accent in the main app
  const accentDarker = blend(accent, "#000000", 0.82); // --q-tab-accent-darker

  const hasText = () => {
    try {
      return editor.getText().trim().length > 0;
    } catch {
      return false;
    }
  };

  /** The composer bar, rendered inside the box (app button order + colors). */
  const buildBarLine = (width: number): string => {
    const pct = ctxWindow > 0 ? (ctxTokens / ctxWindow) * 100 : 0;
    const ctxStr = fg(
      counterColor(pct),
      `${fmtTok(ctxTokens)}/${fmtTok(ctxWindow)} (${Math.floor(pct)}% \u00b1 ${Math.ceil(pct * 0.05 + 1)}%)`
    );
    const slash = ` ${bg(accent, fg(C.bg, " / "))} `;
    const modeStr = mode === "plan" ? fg(C.modePlan, "Plan") : bold(fg(C.modeBuild, "Build"));
    const left = `${slash}  ${modeStr}   ${ctxStr}`;

    const chip = (enabled: boolean, glyph: string) =>
      enabled
        ? bg(accentDarker, fg(C.bg, ` ${glyph} `))
        : bg(C.bgElevated, fg(C.textTertiary, ` ${glyph} `));
    const steerEnabled = streaming && hasText();
    const sendEnabled = hasText() && !streaming;
    const attach = fg(C.textSecondary, " + ");
    const stop = fg(C.danger, " \u25a0 ");
    const steer = chip(steerEnabled, "\u21e2");
    const send = chip(sendEnabled, "\u2191");
    // Perfectly symmetric: four identical 3-wide cells, single-space gaps.
    const right = `${attach} ${stop} ${steer} ${send}`;

    const lw = visibleWidth(left);
    const rw = visibleWidth(right);
    const gap = Math.max(1, width - lw - rw);
    return left + " ".repeat(gap) + right;
  };
  try {
    (editor as any).footerLine = (w: number) => buildBarLine(w);
  } catch {}

  // Welcome block (shown while the transcript is empty — removed on first send).
  try {
    let settings: any = {};
    try {
      settings = JSON.parse(fs.readFileSync(path.join(opts.agentDir, "settings.json"), "utf8"));
    } catch {}
    const modelId = session?.model?.id || settings.defaultModel || "";
    const thinking = session?.thinkingLevel || settings.defaultThinkingLevel || "";
    const label = (s: string) => fg(C.textTertiary, s);
    const val = (s: string) => fg(C.textSecondary, s);
    welcomeEls.push(new Text("", 0, 0));
    welcomeEls.push(
      new Text(fg(C.primary, "quinki") + label("  \u00b7  your agents, your chats \u2014 from the terminal"), 1, 0)
    );
    welcomeEls.push(new Text("", 0, 0));
    welcomeEls.push(new Text(label("cwd       ") + val(opts.cwd), 1, 0));
    welcomeEls.push(new Text(label("model     ") + val(modelId), 1, 0));
    welcomeEls.push(new Text(label("thinking  ") + val(thinking) + label("     mode  ") + val(mode === "plan" ? "Plan" : "Build"), 1, 0));
    welcomeEls.push(new Text("", 0, 0));
    welcomeEls.push(new Text(label("Enter send \u00b7 Esc stop \u00b7 Tab mode \u00b7 / commands"), 1, 0));
    for (const el of welcomeEls) content.addChild(el);
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
    const pct = ctxWindow > 0 ? (ctxTokens / ctxWindow) * 100 : 0;
    try {
      ctxText.setText(
        fg(counterColor(pct), `${fmtTok(ctxTokens)}/${fmtTok(ctxWindow)} (${Math.floor(pct)}% \u00b1 ${Math.ceil(pct * 0.05 + 1)}%)`)
      );
    } catch {}
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
    if (!t || streaming) return;
    editor.setText("");
    if (welcomeEls.length) {
      for (const el of welcomeEls) {
        try {
          content.removeChild(el);
        } catch {}
      }
      welcomeEls.length = 0;
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

  try {
    ui.start();
  } catch (err) {
    process.stderr.write("quinki: could not start the terminal UI: " + String((err as any)?.message || err) + "\n");
    process.exit(1);
  }
}
