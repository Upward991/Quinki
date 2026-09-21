// === Web shim for @tauri-apps/api/webview (vite alias, web build only) ===
// Nothing to do here yet: the browser cannot expose local file paths on drop, so the
// native drag&drop bridge is a no-op. Browser uploads are handled separately (F1).
type Any = any
const noop = () => {}

export function getCurrentWebview(): Any {
  return {
    label: 'main',
    window: null,
    onDragDropEvent: async (_cb?: Any) => noop,
    onDragEnter: async (_cb?: Any) => noop,
    onDragOver: async (_cb?: Any) => noop,
    onDragLeave: async (_cb?: Any) => noop,
    onDrop: async (_cb?: Any) => noop,
    setZoom: async (_n?: number) => {},
    clearAllBrowsingData: async () => {},
  }
}
