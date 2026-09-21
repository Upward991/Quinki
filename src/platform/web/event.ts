// === Web shim for @tauri-apps/api/event (vite alias, web build only) ===
// In the browser there is no Tauri event bus (tray, quit, multi-window). A tiny local
// bus keeps listen/emit functional inside the page (and future WS-to-event bridges).
type Any = any
type UnlistenFn = () => void
type Handler = (event: { event: string; id: number; payload: Any }) => void

const bus = new Map<string, Set<Handler>>()
let nextId = 1

export async function listen(event: string, handler: Handler): Promise<UnlistenFn> {
  const set = bus.get(event) || new Set<Handler>()
  set.add(handler)
  bus.set(event, set)
  return () => {
    try {
      set.delete(handler)
    } catch {}
  }
}

export async function once(event: string, handler: Handler): Promise<UnlistenFn> {
  let unlisten: UnlistenFn = () => {}
  unlisten = await listen(event, (e) => {
    try {
      unlisten()
    } catch {}
    try {
      handler(e)
    } catch {}
  })
  return unlisten
}

export async function emit(event: string, payload?: Any): Promise<void> {
  const set = bus.get(event)
  if (!set) return
  for (const h of Array.from(set)) {
    try {
      h({ event, id: nextId++, payload })
    } catch {}
  }
}

export async function emitTo(_target: Any, event: string, payload?: Any): Promise<void> {
  return emit(event, payload)
}
