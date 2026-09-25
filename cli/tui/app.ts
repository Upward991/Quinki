// =============================================================================
// Quinki CLI — OUR terminal UI (T1)
//
// Layout mirrors the app window:
//   ┌ header ───────────────────────────── (fixed, top)
//   │ chat transcript (scrolls, grows)
//   └ composer box + bar ───────────────── (fixed, bottom)
//
// Engine: the vendored Pi SDK (invisible). No pi UI, no pi commands — only
// what we decided. Colors: the app's exact palette (see theme.ts).
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
} from "../../sidecar-src/vendor/@earendil-works/pi-tui/dist/index.js";

import { C, fg, bg, collapsed, counterColor } from "./theme";

// Engine (bundled at build time — literal specifiers only: dynamic imports with
// variables cannot be resolved inside the compiled binary).
import * as sdk from "../../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/index.js";
import * as compaction from "../../sidecar-src/vendor/@earendil-works/pi-coding-agent/dist/core/compaction/compaction.js";

export interface TuiOptions {
  cwd: string;
  agentDir: string;
  sessionDir: string;
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
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

  // Header (fixed, top): session title … context counter
  const titleText = new Text("", 1, 0);
  const ctxText = new Text("", 1, 0);
  const header = new HStack([
    { component: titleText, grow: 1 },
    { component: ctxText, basis: "auto", grow: 0 },
  ]);
  titleText.setText(fg(C.text, "\u25cf") + " " + fg(C.primary, "quinki") + fg(C.textSecondary, "  \u00b7 New chat"));

  // Chat transcript (scrolls, grows)
  const content = new Container();
  const scroll = new ScrollView(content);

  // Composer (fixed, bottom): editor box + bar
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

  const barLeft = new Text("", 1, 0);
  const barRight = new Text("", 1, 0);
  const bar = new HStack([
    { component: barLeft, grow: 1 },
    { component: barRight, basis: "auto", grow: 0 },
  ]);
  const dock = new VStack([
    { component: editor, basis: "auto", grow: 0, shrink: 1, minSize: 3 },
    { component: bar, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
  ]);

  const root = new VStack([
    { component: header, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
    { component: scroll, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 5 },
  ]);

  for (const c of [header, scroll, dock]) {
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
  let mode: "plan" | "build" = "build";
  let ctxTokens = 0;
  let ctxWindow = 0;

  let assistant: any = null;
  let assistantText = "";
  let thinkingRow: any = null;
  let thinkingText = "";

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
    const ctxStr = fg(
      counterColor(pct),
      `${fmtTok(ctxTokens)}/${fmtTok(ctxWindow)} (${Math.floor(pct)}% \u00b1 ${Math.ceil(pct * 0.05 + 1)}%)`
    );
    const modeStr = mode === "plan" ? fg(C.modePlan, "Plan") : fg(C.modeBuild, "\ud83d\udd28 Build");
    barLeft.setText(`${fg(C.info, "/")}   ${modeStr}   ${ctxStr}`);
    try {
      ctxText.setText(ctxStr);
    } catch {}
    barRight.setText(
      `${fg(C.textTertiary, "\ud83d\udcce")}  ${streaming ? fg(C.danger, "\u23f9") : fg(C.textTertiary, "\u23f9")}  ${fg(
        C.textTertiary,
        "\u21e2"
      )}  ${fg(C.textTertiary, "\u2191")} `
    );
  };

  const updateCtx = () => {
    try {
      const model = session.model;
      const w =
        model?.contextWindow ||
        model?.contextWindowTokens ||
        model?.contextLength ||
        0;
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
      ui.requestRender();
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
        // next text after a tool starts a new assistant block
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
    const bubbleText = t;
    content.addChild(new Text(bubbleText, 2, 1, (s: string) => bg(C.bubbleUser, s)));
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
    // If the TUI cannot start, surface the error instead of hanging silently.
    process.stderr.write("quinki: could not start the terminal UI: " + String((err as any)?.message || err) + "\n");
    process.exit(1);
  }
}
