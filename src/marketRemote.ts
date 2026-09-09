// marketRemote.ts — A4.4: la app legge il catalogo dal MARKET ONLINE (multi-sorgente).
// Il market ufficiale vive nel repo GitHub Upward991/quinki-market; l'utente può
// AGGIUNGERE altri repo compatibili (My Repos) come sorgenti extra. Ogni sorgente
// espone un catalog.json con la stessa struttura. Se nessuna sorgente risponde →
// il market è vuoto (come da modello: niente fallback al catalogo locale).
import { findCatalogItem, type CatalogItem } from './catalog'
import { getMyRepos } from './tabs'

// fetch con TIMEOUT: un repo lento/bloccato NON deve bloccare il market (AbortController)
async function fetchJson(url: string, timeoutMs = 8000, token = ''): Promise<any> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const headers: any = {}
      if (token && url.includes('api.github.com')) headers.Authorization = 'Bearer ' + token
      const res = await fetch(url, { signal: ctrl.signal, headers })
      if (!res.ok) return null
      return await res.json()
    } finally { clearTimeout(t) }
  } catch { return null }
}

async function fetchText(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) return null
      return await res.text()
    } finally { clearTimeout(t) }
  } catch { return null }
}

const OFFICIAL_URL = 'https://raw.githubusercontent.com/Upward991/quinki-market/main/catalog.json'

// Token OAuth dell'utente (impostato dopo il login): serve per leggere il
// catalog.json del repo di DEFAULT quando è PRIVATO (raw → 404).
let remoteToken = ''
export function setRemoteToken(t: string) { remoteToken = t || '' }

// Token GitHub PER-REPO (facoltativo): ogni repo può avere la SUA chiave.
// Se l'utente aggiunge un repo personale e mette il suo token, quel repo non ha limiti.
function repoTokenKey(url: string) { return 'quinki-repo-token-' + url }
export function getRepoToken(url: string): string {
  try { return localStorage.getItem(repoTokenKey(url)) || '' } catch { return '' }
}
export function setRepoToken(url: string, t: string) {
  try { if (t) localStorage.setItem(repoTokenKey(url), t); else localStorage.removeItem(repoTokenKey(url)) } catch {}
}

let remoteCatalogCache: CatalogItem[] | null = null
let remoteLoaded = false
// Catalogo STABILE: accumula TUTTI gli item mai visti. La degradazione (rate limit)
// NON deve far sparire gli item dall'ACCOUNT — l'account usa questo catalogo, mai ridotto.
let stableCatalogCache: CatalogItem[] = []
let remoteDegraded = false
let remoteDegradedReason = ''

// Stato della connessione: degraded=true quando il catalogo è PARZIALE/fallback
// (es. rate limit GitHub) — la UI mostra un avviso, NON è colpa della app.
export function getRemoteStatus(): { degraded: boolean; reason: string } {
  return { degraded: remoteDegraded, reason: remoteDegradedReason }
}
export function resetRemoteDegraded() { remoteDegraded = false; remoteDegradedReason = '' }

// Converte una voce del catalog.json remoto in CatalogItem (fonde col locale se esiste).
function remoteToItem(cat: string, r: any, local: CatalogItem | undefined, source: string): CatalogItem {
  return {
    id: r.id,
    name: r.name || r.id,
    icon: local?.icon || '✨',
    color: r.color || '#888',
    description: r.description || '',
    longDescription: r.longDescription || local?.longDescription || r.description || '',
    author: r.author || 'Community',
    authorBio: local?.authorBio || '',
    version: r.version || '1.0.0',
    size: local?.size || '0.1 MB',
    downloads: typeof r.installs === 'number' ? r.installs : 0,
    trending: local?.trending,
    hasUpdate: local?.hasUpdate,
    category: r.category || cat,
    tags: local?.tags || [],
    panel: local?.panel || '',
    kind: local?.kind || 'stub',
    remoteDownloadUrl: r.downloadUrl,
    remoteSource: source,
    remoteRating: typeof r.rating === 'number' ? r.rating : 0,
  }
}

// Fetch di UNA sorgente (catalog.json). Fallback silenzioso → [].
async function fetchSource(url: string): Promise<CatalogItem[]> {
  try {
    let data = await fetchJson(url)
    // Repo privato: raw 404 → prova l'API contents col token OAuth dell'utente
    if (!data && remoteToken && /raw\.githubusercontent\.com/.test(url)) {
      try {
        const m = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)/)
        if (m) {
          const res = await fetch('https://api.github.com/repos/' + m[1] + '/' + m[2] + '/contents/catalog.json', { headers: { Authorization: 'Bearer ' + remoteToken } })
          if (res.ok) {
            const d = await res.json()
            if (d && d.content) data = JSON.parse(atob(d.content.replace(/\s/g, '')))
          }
        }
      } catch {}
    }
    if (!data) return []
    const cats = ['tabs', 'skills', 'agents', 'mcp', 'themes']
    const items: CatalogItem[] = []
    for (const cat of cats) {
      for (const r of (data[cat] || [])) {
        if (!r || !r.id) continue
        items.push(remoteToItem(cat, r, findCatalogItem(r.id), url))
      }
    }
    return items
  } catch {
    return []
  }
}

// ── ADATTATORE: repo GitHub esterni di skill (formato comune: <dir>/SKILL.md) ──
// La app NON richiede che il repo abbia il nostro catalog.json: usa l'API GitHub
// pubblica (tree) per elencare le skill e le converte in item del catalogo.
// L'install scarica il SKILL.md raw e lo installa nel meccanismo nativo.
function isGitHubUrl(url: string): boolean {
  return /github\.com|raw\.githubusercontent\.com/.test(url)
}

function extractRepo(url: string): { owner: string, repo: string } | null {
  const u = String(url || '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '')
  const m = u.match(/github\.com\/([^\/]+)\/([^\/]+)/)
  if (m && m[1] && m[2]) return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
  return null
}

// Fallback quando la GitHub API non risponde (rate limit / offline): prova i raw più comuni.
async function fetchFallbackRaw(rawBase: string, url: string, label: string, stars: number): Promise<CatalogItem[]> {
  const items: CatalogItem[] = []
  const downloads = Math.max(1, Math.round(stars / 10))
  // 1) catalog.json alla radice
  const catRaw = await fetchText(rawBase + '/catalog.json')
  if (catRaw) {
    try {
      const d = JSON.parse(catRaw)
      const cats = ['tabs', 'agents', 'skills', 'mcp', 'themes']
      for (const c of cats) {
        for (const r of (d[c] || [])) {
          items.push(remoteToItem(c, r, undefined, label))
        }
      }
      if (items.length > 0) return items
    } catch {}
  }
  // 2) .mcp.json alla radice (repo MCP)
  const mcpRaw = await fetchText(rawBase + '/.mcp.json')
  if (mcpRaw) {
    try {
      const j = JSON.parse(mcpRaw)
      const servers = j.mcpServers && typeof j.mcpServers === 'object' ? Object.entries(j.mcpServers) : Object.entries(j)
      if (servers.length > 0) {
        const first = String(servers[0][0])
        const sname = servers.length === 1 ? first : first + ' +' + (servers.length - 1)
        const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        items.push({
          id: 'ext-mcp-' + slug + '-' + sname.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name: sname + ' (MCP)', icon: '🔌', color: '#56b6c2', description: sname + ' \u2014 MCP server from ' + label,
          longDescription: 'Imported from ' + url + ' (fallback: .mcp.json)',
          author: label, authorBio: '', version: '1.0.0', size: '0.1 MB',
          downloads, category: 'mcp', tags: [], panel: '', kind: 'stub',
          remoteMcpPath: '.mcp.json', remoteRepoRawBase: rawBase, remoteSource: url, remoteRating: stars > 0 ? 4.5 : 0,
        })
      }
    } catch {}
    return items
  }
  return items
}

// Fallback SENZA API: legge la pagina HTML di GitHub (non conta nel rate limit)
// ed estrae le cartelle skill (formato comune: <dir>/SKILL.md).
async function fetchGitHubSkillsHtml(url: string, label: string, branch = 'main'): Promise<CatalogItem[]> {
  const rep = extractRepo(url)
  if (!rep) return []
  const items: CatalogItem[] = []
  const seen = new Set<string>()
  const SKIP = new Set(['readme', 'template', 'license', 'contributing', 'changelog', 'spec', 'assets', 'docs', 'images', 'scripts'])
  const downloads = 1
  // 1) cartella skills/ (formato comune: anthropics/skills, skills.sh, ecc.)
  const html = await fetchText(`https://github.com/${rep.owner}/${rep.repo}/tree/${branch}/skills`, 10000)
  if (html) {
    const re = new RegExp(`href="/${rep.owner}/${rep.repo}/tree/${branch}/skills/([^"/]+)"`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) && seen.size < 60) {
      const name = m[1]
      if (!name || seen.has(name) || SKIP.has(name.toLowerCase())) continue
      seen.add(name)
      items.push({
        id: 'ext-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name, icon: skillIcon(name), color: '#7aa2f7', description: name + ' \u2014 skill from ' + label,
        longDescription: 'Imported from ' + url + ' (path: skills/' + name + '/SKILL.md)',
        author: label, authorBio: '', version: '1.0.0', size: '0.1 MB',
        downloads, category: 'skill', tags: [], panel: '', kind: 'stub',
        remoteSkillPath: 'skills/' + name + '/SKILL.md', remoteRepoRawBase: `https://raw.githubusercontent.com/${rep.owner}/${rep.repo}/${branch}`, remoteSource: url, remoteRating: 0,
      })
    }
  }
  if (items.length > 0) return items
  // 2) fallback generico: pagina root → tutte le cartelle di 2° livello (skills/<name>)
  const rootHtml = await fetchText(`https://github.com/${rep.owner}/${rep.repo}/tree/${branch}`, 10000)
  if (rootHtml) {
    const re = new RegExp(`href="/${rep.owner}/${rep.repo}/tree/${branch}/([^"/]+)/([^"/]+)"`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(rootHtml)) && seen.size < 60) {
      const dir = m[1]; const name = m[2]
      if (!dir || !name || seen.has(name) || SKIP.has(dir.toLowerCase()) || SKIP.has(name.toLowerCase())) continue
      seen.add(name)
      items.push({
        id: 'ext-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name, icon: skillIcon(name), color: '#7aa2f7', description: name + ' \u2014 skill from ' + label,
        longDescription: 'Imported from ' + url + ' (path: ' + dir + '/' + name + '/SKILL.md)',
        author: label, authorBio: '', version: '1.0.0', size: '0.1 MB',
        downloads, category: 'skill', tags: [], panel: '', kind: 'stub',
        remoteSkillPath: dir + '/' + name + '/SKILL.md', remoteRepoRawBase: `https://raw.githubusercontent.com/${rep.owner}/${rep.repo}/${branch}`, remoteSource: url, remoteRating: 0,
      })
    }
  }
  return items
}

async function fetchGitHubSkills(url: string, label: string, token = ''): Promise<CatalogItem[]> {
  const rep = extractRepo(url)
  if (!rep) return []
  try {
    // UNA sola chiamata API per repo: il tree con ref HEAD (niente chiamata info separata).
    // Così il rate limit (60/h gratis) basta per ~60 repo invece di ~30.
    const tree = await fetchJson(`https://api.github.com/repos/${rep.owner}/${rep.repo}/git/trees/HEAD?recursive=1`, 8000, token)
    if (!tree) {
      // Fallback SENZA API (rate-limit/offline): prima la pagina HTML di GitHub
      // (non conta nel rate limit), poi i path raw più comuni.
      remoteDegraded = true
      remoteDegradedReason = 'GitHub API rate limit (60 requests/hour, free) — showing fallback/partial data. This is GitHub\'s limit, not Quinki\'s. It resets every hour.'
      const fbHtml = await fetchGitHubSkillsHtml(url, label, 'main')
      if (fbHtml.length > 0) return fbHtml
      const fbHtml2 = await fetchGitHubSkillsHtml(url, label, 'master')
      if (fbHtml2.length > 0) return fbHtml2
      const fbMain = await fetchFallbackRaw(`https://raw.githubusercontent.com/${rep.owner}/${rep.repo}/main`, url, label, 0)
      if (fbMain.length > 0) return fbMain
      return await fetchFallbackRaw(`https://raw.githubusercontent.com/${rep.owner}/${rep.repo}/master`, url, label, 0)
    }
    const rawBase = `https://raw.githubusercontent.com/${rep.owner}/${rep.repo}/main`
    const stars = 0
    const items: CatalogItem[] = []
    const seenSkills = new Set<string>()
    const seenAgents = new Set<string>()
    const seenMcps = new Set<string>()
    const SKIP = new Set(['readme', 'template', 'license', 'contributing', 'changelog'])
    const downloads = Math.max(1, Math.round(stars / 10))
    const pathHash = (p: string) => { let h = 0; for (let i = 0; i < p.length; i++) { h = ((h << 5) - h + p.charCodeAt(i)) | 0 } return (h >>> 0).toString(36).slice(0, 4) }
    for (const t of (tree.tree || [])) {
      const path = t.path || ''
      if (t.type !== 'blob' || /node_modules|vendor|dist|build/.test(path)) continue
      // ── SKILLS ──
      if (path.endsWith('/SKILL.md')) {
        const parts = path.split('/')
        const name = (parts[parts.length - 2] || '').replace(/^skill[_-]?/i, '')
        if (!name || SKIP.has(name.toLowerCase())) continue
        // NIENTE dedup per nome: due SKILL.md in cartelle diverse con lo stesso
        // nome sono due skill DISTINTE (id unico per path)
        const uid = 'ext-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + pathHash(path)
        items.push({
          id: uid,
          name, icon: skillIcon(name), color: '#7aa2f7', description: name + ' \u2014 skill from ' + label,
          longDescription: 'Imported from ' + url + ' (path: ' + path + ')',
          author: label, authorBio: '', version: '1.0.0', size: '0.1 MB',
          downloads, category: 'skill', tags: [], panel: '', kind: 'stub',
          remoteSkillPath: path, remoteRepoRawBase: rawBase, remoteSource: url, remoteRating: stars > 0 ? 4.5 : 0,
        })
        continue
      }
      // ── AGENTS: file .md dentro una cartella agents/ ──
      if (/\/agents?\/[^/]+\.md$/i.test(path) && !path.toLowerCase().endsWith('skill.md')) {
        const segs = path.split('/')
        const name = (segs[segs.length - 1] || '').replace(/\.md$/i, '')
        if (!name || SKIP.has(name.toLowerCase())) continue
        items.push({
          id: 'ext-agent-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + pathHash(path),
          name, icon: '🤖', color: '#9d8bd9', description: name + ' \u2014 agent from ' + label,
          longDescription: 'Imported from ' + url + ' (path: ' + path + ')',
          author: label, authorBio: '', version: '1.0.0', size: '0.1 MB',
          downloads, category: 'agent', tags: [], panel: '', kind: 'stub',
          remoteAgentPath: path, remoteRepoRawBase: rawBase, remoteSource: url, remoteRating: stars > 0 ? 4.5 : 0,
        })
        continue
      }
      // ── MCP: file che finiscono in mcp.json (.mcp.json, n8n-mcp.json, browsermcp.json, ...) ──
      if (/(^|\/)[^/]*mcp\.json$/i.test(path)) {
        const seg = path.split('/')
        const raw = seg[seg.length - 1] || ''
        const name0 = raw.replace(/[_-]?mcp\.json$/i, '').replace(/mcp\.json$/i, '').replace(/^[.]+$/, '') || (seg[seg.length - 2] || '')
        // FIX: .mcp.json alla RADICE → nome = repo (il vecchio codice produceva ".")
        const name = name0 && name0 !== '' ? name0 : (label || 'mcp')
        if (!name) continue
        items.push({
          id: 'ext-mcp-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + pathHash(path),
          name, icon: '🔌', color: '#56b6c2', description: name + ' \u2014 MCP from ' + label,
          longDescription: 'Imported from ' + url + ' (path: ' + path + ')',
          author: label, authorBio: '', version: '1.0.0', size: '0.1 MB',
          downloads, category: 'mcp', tags: [], panel: '', kind: 'stub',
          remoteMcpPath: path, remoteRepoRawBase: rawBase, remoteSource: url, remoteRating: stars > 0 ? 4.5 : 0,
        })
      }
    }
    return items
  } catch { return [] }
}

// Icona per una skill: emoji derivata da parole chiave nel nome
function skillIcon(name: string): string {
  const n = name.toLowerCase()
  if (/dev|code|program|python|js|ts|rust|go|cod|git|test/.test(n)) return '💻'
  if (/design|ui|ux|figma|style|color|brand/.test(n)) return '🎨'
  if (/seo|marketing|content|copy|write|blog|social|ads?/.test(n)) return '📣'
  if (/data|anal|sql|excel|sheet|report/.test(n)) return '📊'
  if (/secur|pentest|audit|vuln|threat/.test(n)) return '🛡️'
  if (/research|deep|investigat|source|reference/.test(n)) return '🔍'
  if (/financ|budget|invest|tax|money/.test(n)) return '💰'
  if (/health|medical|fitness|nutrition/.test(n)) return '❤️'
  if (/product|project|pm|roadmap|agile|scrum/.test(n)) return '📋'
  if (/email|outreach|sales|lead|prospect/.test(n)) return '📧'
  if (/legal|law|contract|compliance/.test(n)) return '⚖️'
  if (/photo|image|video|media|creative/.test(n)) return '📸'
  return '⚡'
}

// Risolve un SKILL.md che può essere uno SHIM (contiene solo un path relativo al file vero).
// Segue la catena (max 4 hop) e restituisce il contenuto REALE + il path risolto.
export async function fetchSkillResolved(base: string, path: string): Promise<{ content: string; resolvedPath: string } | null> {
  let currentPath = path
  for (let hop = 0; hop < 4; hop++) {
    try {
      const txt = await fetchText(base + '/' + currentPath)
      if (txt === null) return null
      const t = txt.trim()
      const isShim = /^[\s./\w\-]+\.md\s*$/i.test(t) && t.includes('/')
      if (!isShim) return { content: txt, resolvedPath: currentPath }
      const dir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''
      const parts = dir.split('/').filter(Boolean)
      for (const part of t.split('/')) {
        if (part === '..') { if (parts.length) parts.pop() }
        else if (part !== '.' && part) parts.push(part)
      }
      currentPath = parts.join('/')
    } catch { return null }
  }
  return null
}

// Fetch di TUTTE le sorgenti (official + my repos), merge con dedupe (prima sorgente vince).
// Per ogni sorgente: prova il catalog.json nativo; se non c'è e il URL è un repo GitHub,
// usa l'ADATTATORE (elenca le skill dal repo).
// Cache persistente per-sorgente (30 min): evita di consumare il rate limit GitHub
// a ogni load del market (info+tree API per repo). L'aggiunta/rimozione di un repo
// forza il fetch per quel repo (nuova sorgente senza cache).
// CACHE INVALIDATION: quando la versione cambia, pulisci TUTTE le cache del market.
// Così un update dell'app porta sempre un catalog fresco (fix per: catalog vecchio
// con test-packages visibili anche dopo la pulizia del repo market).
const MARKET_CACHE_VERSION = 'v2-clean-2026-09-08'
try {
  const storedV = localStorage.getItem('quinki-market-cache-version')
  if (storedV !== MARKET_CACHE_VERSION) {
    let cleared = 0
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('quinki-src-cache-')) { localStorage.removeItem(k); cleared++ }
    }
    localStorage.setItem('quinki-market-cache-version', MARKET_CACHE_VERSION)
    if (cleared > 0) console.log(`[market] cache cleared (${cleared} entries) — version updated`)
  }
} catch {}

const CACHE_TTL = 30 * 60 * 1000
function srcCacheGet(url: string): CatalogItem[] | null {
  try {
    const raw = localStorage.getItem('quinki-src-cache-' + url)
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d || typeof d.ts !== 'number' || Date.now() - d.ts > CACHE_TTL) return null
    return Array.isArray(d.items) ? d.items : null
  } catch { return null }
}
function srcCacheSet(url: string, items: CatalogItem[]) {
  // FIX P2 #8 (2026-09-08): NON cached i risultati VUOTI. Un 404 temporaneo o un repo
  // offline produceva [] → cached per 30 min → market apparentemente rotto/vuoto per
  // mezz'ora anche dopo il recovery. Solo i risultati NON-VUOTI vengono cached.
  if (!items || items.length === 0) return
  try { localStorage.setItem('quinki-src-cache-' + url, JSON.stringify({ ts: Date.now(), items })) } catch {}
}

export async function fetchRemoteCatalog(): Promise<CatalogItem[]> {
  // SESSIONE: se il catalogo è già stato caricato in memoria, NON rifare chiamate API.
  // Il market si rimonta a ogni cambio tab: la prima apertura scarica, le successive
  // usano la cache (il rate limit non si brucia).
  if (remoteCatalogCache && remoteCatalogCache.length > 0) return remoteCatalogCache
  return doFetchRemoteCatalog()
}

// Forza un refresh (es. quando l'utente aggiunge/rimuove un repo).
export async function refreshRemoteCatalog(): Promise<CatalogItem[]> {
  return doFetchRemoteCatalog()
}

async function doFetchRemoteCatalog(): Promise<CatalogItem[]> {
  const sources = [{ url: OFFICIAL_URL, label: 'quinki-market' }, ...getMyRepos().map(r => ({ url: r.url, label: r.label }))]
  // PARALLELO con timeout per sorgente: un repo lento/bloccato non blocca gli altri.
  const results = await Promise.all(sources.map(async (src) => {
    let items: CatalogItem[] = []
    const cached = srcCacheGet(src.url)
    if (cached) {
      items = cached
    } else if (isGitHubUrl(src.url)) {
      if (/catalog\.json/.test(src.url) && /raw\.githubusercontent/.test(src.url)) {
        items = await fetchSource(src.url)
      }
      if (items.length === 0) items = await fetchGitHubSkills(src.url, src.label, getRepoToken(src.url))
    } else {
      items = await fetchSource(src.url)
    }
    if (!cached) srcCacheSet(src.url, items)
    return { label: src.label, items }
  }))
  const all: CatalogItem[] = []
  for (const r of results) {
    for (const it of r.items) {
      // NIENTE dedup: ogni repo mantiene TUTTI i suoi item, anche se un altro
      // repo (o lo stesso) ha un item con lo stesso nome. L'id è reso unico
      // da (sorgente + path) per evitare collisioni nelle chiavi React.
      const uid = it.id + '@' + String(r.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 12)
      all.push({ ...it, id: uid, remoteSource: r.label })
    }
  }
  if (all.length > 0) { remoteCatalogCache = all; remoteLoaded = true }
  // accumula sempre (union per id) — il catalogo stabile non si riduce mai
  for (const it of all) { if (!stableCatalogCache.some(x => x.id === it.id)) stableCatalogCache.push(it) }
  return all
}

// Catalogo stabile per l'ACCOUNT: anche se l'ultimo fetch è degradato/parziale,
// le cose installate restano risolvibili (non spariscono dall'account).
export function getStableCatalog(): CatalogItem[] {
  return stableCatalogCache
}

// Catalogo per la UI: SOLO il market online. Se nessuna sorgente risponde → VUOTO.
export function getMergedCatalog(): CatalogItem[] {
  if (remoteCatalogCache && remoteCatalogCache.length > 0) return remoteCatalogCache
  return []
}

export function isRemoteLoaded(): boolean { return remoteLoaded }
