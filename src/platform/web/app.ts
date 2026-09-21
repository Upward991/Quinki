// === Web shim for @tauri-apps/api/app (vite alias, web build only) ===
// The window.__QUINKI__ payload (injected by the sidecar when serving the web app)
// carries the real app version, so the Settings row shows the actual build.
type Any = any

function info(): Any {
  try {
    return (globalThis as Any).__QUINKI__ || {}
  } catch {
    return {}
  }
}

export async function getVersion(): Promise<string> {
  return String(info().version || 'web')
}

export async function getName(): Promise<string> {
  return 'Quinki'
}

export async function getTauriVersion(): Promise<string> {
  return 'web'
}

export async function show(): Promise<void> {}

export async function hide(): Promise<void> {}
