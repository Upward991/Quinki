// registry.ts — A4.4 Blocco 4: REGISTRO DI ORIGINE + ANTI-FURTO.
// All'install di ogni pacchetto registriamo { sorgente, id, categoria, autore, versione, hash }.
// Il registro è un "libro mastro": le entry restano anche dopo l'uninstall (servono a
// riconoscere il contenuto se qualcuno prova a ri-uploadarlo come proprio).
// All'upload (Blocco 5): si calcola l'hash del candidato e si confronta con gli hash
// registrati → se l'hash appartiene a un ALTRO autore, l'upload viene bloccato.

const KEY = 'quinki-registry'

export interface InstallRecord {
  id: string
  category: string
  source: string   // repo/sorgente (es. quinki-market, claude-skills)
  author: string
  version: string
  hash: string
  installedAt: number
}

export function getRegistry(): InstallRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr as InstallRecord[] }
  } catch {}
  return []
}

export function saveRegistry(recs: InstallRecord[]) {
  try { localStorage.setItem(KEY, JSON.stringify(recs)) } catch {}
}

// Registra (o aggiorna) l'install di un pacchetto.
export function recordInstall(rec: Omit<InstallRecord, 'installedAt'>) {
  const recs = getRegistry()
  const idx = recs.findIndex((r) => r.id === rec.id && r.category === rec.category)
  if (idx >= 0) recs[idx] = { ...rec, installedAt: Date.now() }
  else recs.push({ ...rec, installedAt: Date.now() })
  saveRegistry(recs)
}

// ANTI-FURTO: l'hash del candidato è già registrato ma con un AUTORE DIVERSO?
export function hashClaimedByOther(hash: string, author: string): boolean {
  if (!hash) return false
  return getRegistry().some((r) => r.hash && r.hash === hash && r.author !== author)
}

// Chi ha registrato questo hash (utile per messaggi "questo contenuto è di X")?
export function hashOwner(hash: string): string | undefined {
  if (!hash) return undefined
  const rec = getRegistry().find((r) => r.hash === hash)
  return rec?.author
}

// Hash del contenuto: SHA-256 (Web Crypto) con fallback FNV-1a 32-bit.
export async function hashContent(content: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {}
  let h = 0x811c9dc5
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return 'fnv-' + h.toString(16)
}
