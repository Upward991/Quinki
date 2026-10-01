// =============================================================================
// Quinki CLI — theme
// The app's exact colors, adapted to the terminal.
// All colors come from src/index.css (the app's default theme). Toggle rows are
// drawn at 50% (collapsed) / full (expanded), like the app (rgba 0.50 / 1.0).
// Self-contained ANSI truecolor helpers — no external deps. When color is not
// available (piped output / NO_COLOR), everything degrades to plain text.
// =============================================================================

const colorEnabled = (() => {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return !!process.stdout.isTTY;
})();

// --- app palette (hex, exact) -------------------------------------------------
export const C = {
  text: "#e8e8ec",
  textSecondary: "#888892",
  textTertiary: "#585860",
  border: "#3a3a44", // ~ var(--q-border) #ffffff0f, brightened for terminal legibility
  bg: "#08080b",
  bgPanel: "#0f0f13",
  bgElevated: "#16161b",
  bubbleUser: "#1a1a20", // --q-bubble-user
  primary: "#9d8bd9", // --q-accent-primary (violet)
  expert: "#d9a066", // --q-accent-orange (Expert)
  info: "#7aa2f7", // --q-accent-info / --q-tab-accent
  modePlan: "#F4A6BD", // --q-mode-plan
  modePlanDim: "#E295AC", // --q-mode-plan-dim
  modeBuild: "#F2A65E", // --q-mode-build
  thinking: "#9d8bd9", // --q-thinking
  toolCall: "#d29922", // --q-tool-call
  toolResult: "#6bc46d", // --q-tool-result
  danger: "#d96b6b", // --q-accent-danger
  warning: "#d29922", // --q-accent-warning
  success: "#6bc46d", // --q-accent-success
  delegation: "#c97084", // --q-delegation
  statusWriting: "#e8e8ec",
  statusCompacting: "#7aa2f7",
  statusRunning: "#5a8c9e",
};

// --- hex helpers --------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function blend(hex: string, over: string = C.bg, alpha: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(over);
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(mix(r1, r2))}${to2(mix(g1, g2))}${to2(mix(b1, b2))}`;
}

// --- styled spans -------------------------------------------------------------
export const fg = (color: string, s: string) =>
  colorEnabled ? `\x1b[38;2;${hexToRgb(color).join(";")}m${s}\x1b[39m` : s;

export const bg = (color: string, s: string) =>
  colorEnabled ? `\x1b[48;2;${hexToRgb(color).join(";")}m${s}\x1b[49m` : s;

export const bold = (s: string) => (colorEnabled ? `\x1b[1m${s}\x1b[22m` : s);
export const dimStyle = (s: string) => (colorEnabled ? `\x1b[2m${s}\x1b[22m` : s);
export const italicStyle = (s: string) => (colorEnabled ? `\x1b[3m${s}\x1b[23m` : s);

/** Collapsed row color: 50% of the base color over the screen bg (like the app). */
/** Set the floating-panel background for the following cells (keeps the char as-is). */
const PANEL_RGB_Q = (() => {
  const h = C.bgPanel.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)};${parseInt(h.slice(2, 4), 16)};${parseInt(h.slice(4, 6), 16)}`;
})();
export const panelBgWrap = (s2: string) => (colorEnabled ? `\x1b[48;2;${PANEL_RGB_Q}m${s2}` : s2);

export const collapsed = (color: string, s: string) => fg(blend(color, C.bg, 0.5), s);

// --- panel-aware background (keeps the floating-panel bg after the cell) -------
const PANEL_RGB = (() => {
  const h = C.bgPanel.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)};${parseInt(h.slice(2, 4), 16)};${parseInt(h.slice(4, 6), 16)}`;
})();

/** Like bg(), but restores the panel background instead of the terminal default
 *  (inside the composer/header blocks the row background must stay uniform). */
export const bgKeepPanel = (color: string, s: string) =>
  colorEnabled ? `\x1b[48;2;${hexToRgb(color).join(";")}m${s}\x1b[48;2;${PANEL_RGB}m` : s;

/** Context counter color — same thresholds and colors as the app. */
export function counterColor(pct: number): string {
  if (pct >= 80) return C.danger;
  if (pct >= 50) return C.warning;
  return C.textTertiary;
}

export const isColorEnabled = () => colorEnabled;
