// === Sidecar server URL resolution ===
//   1. window.__QUINKI__.server  (web app served by the sidecar: same host that served it)
//   2. Tauri desktop app         (loopback: main 9182 / expert 9183)
//   3. web page on another host  (vite dev server opened from the phone: same
//      hostname, sidecar port) — this is what makes the live-testing workflow work
export function resolveServerUrl(expert: boolean): string {
  const fallback = expert ? 'ws://127.0.0.1:9183' : 'ws://127.0.0.1:9182'
  try {
    const q = (globalThis as any).__QUINKI__
    if (q && q.server) return String(q.server)
    const port = expert ? 9183 : 9182
    if ((globalThis as any).__TAURI_INTERNALS__) return `ws://127.0.0.1:${port}`
    const h = window.location.hostname
    if (!h) return fallback
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${h}:${port}`
  } catch {
    return fallback
  }
}
