// === Web shim for @tauri-apps/api/window (vite alias, web build only) ===
// Window controls do not exist in the browser: every method is a safe no-op so the
// shared UI keeps working when served by the sidecar.
type Any = any
const noop = () => {}
const asyncNoop = async () => {}

function notAvailable(): never {
  throw new Error('[web] window API not available in the browser')
}

export function getCurrentWindow(): Any {
  return {
    label: 'main',
    setAlwaysOnTop: asyncNoop,
    setTitle: asyncNoop,
    show: asyncNoop,
    hide: asyncNoop,
    close: asyncNoop,
    destroy: asyncNoop,
    minimize: asyncNoop,
    unminimize: asyncNoop,
    maximize: asyncNoop,
    unmaximize: asyncNoop,
    toggleMaximize: asyncNoop,
    isMaximized: async () => false,
    isMinimized: async () => false,
    isFullscreen: async () => false,
    setFullscreen: asyncNoop,
    isVisible: async () => true,
    setFocus: asyncNoop,
    setDecorations: asyncNoop,
    setResizable: asyncNoop,
    setSize: asyncNoop,
    setPosition: asyncNoop,
    startDragging: asyncNoop,
    onCloseRequested: async (_cb?: Any) => noop,
    onFocusChanged: async (_cb?: Any) => noop,
    onResized: async (_cb?: Any) => noop,
    onMoved: async (_cb?: Any) => noop,
    onScaleChanged: async (_cb?: Any) => noop,
    onThemeChanged: async (_cb?: Any) => noop,
    asTauriWindow: notAvailable,
  }
}

export function getAllWindows(): Any[] {
  return []
}
