// tabs.ts — A4.1: registro delle tab della Home (base + installate + ordine)
// Le tab passano da hardcoded a registry-driven: qui stanno le tab BASE,
// l'ordine (persistito in localStorage) e le tab installate (in A4.2 verranno
// dal marketplace; per ora da localStorage come segnaposto).
import { Bot, Terminal, MessageSquare, Settings, Checklist, BookOpen } from './components/icons'
import { getRegistry, saveRegistry } from './registry'
import { findCatalogItem, resolveCatalogIcon } from './catalog'

export interface HomeTab {
  id: string
  icon: any
  label: string
  color: string
  panel: string
  doubleBot?: boolean
  base: boolean
}

// Le 6 tab base — NON eliminabili, solo riordinabili
export const baseTabs: HomeTab[] = [
  { id: 'expert',   icon: Bot,           label: 'App Expert',   color: 'var(--q-accent-orange)',    panel: 'expert',   doubleBot: false, base: true },
  { id: 'chat',     icon: MessageSquare, label: 'Chat',         color: 'var(--q-accent-info)',      panel: 'chat',     doubleBot: false, base: true },
  { id: 'calendar', icon: Checklist,     label: 'Agents Tasks', color: 'var(--q-accent-calendar)',  panel: 'calendar', doubleBot: false, base: true },
  { id: 'agents',   icon: Bot,           label: 'Agents',       color: 'var(--q-accent-secondary)', panel: 'agents',   doubleBot: true,  base: true },
  { id: 'settings', icon: Settings,      label: 'Settings',     color: 'var(--q-accent-primary)',   panel: 'settings', doubleBot: false, base: true },
  { id: 'log',      icon: Terminal,      label: 'Log',          color: 'var(--q-accent-success)',   panel: 'log',      doubleBot: false, base: true },
]

const ORDER_KEY = 'quinki-tab-order'
const INSTALLED_KEY = 'quinki-installed-tabs'

export function loadTabOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr
    }
  } catch {}
  return baseTabs.map(t => t.id)
}

export function saveTabOrder(order: string[]) {
  try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)) } catch {}
}

// Tab installate: in A4.2 verranno lette da ~/.quinki/tabs (via RPC del sidecar).
// Per A4.1 il campo esiste già nel formato (id/icon/label/color/panel) ma vuoto.
export function loadInstalledTabs(): HomeTab[] {
  try {
    const raw = localStorage.getItem(INSTALLED_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        return (arr as any[]).map((t: any) => ({
          ...t,
          // l'icona non è serializzabile: la riassegnamo per id
          icon: resolveInstalledIcon(t?.id || ''),
        })) as HomeTab[]
      }
    }
  } catch {}
  return []
}

function resolveInstalledIcon(id: string): any {
  // A4.2: le tab del marketplace riprendono l'icona dal catalogo (per id)
  const fromCatalog = resolveCatalogIcon(id)
  if (fromCatalog) return fromCatalog
  return Bot
}

export function saveInstalledTabs(tabs: HomeTab[]) {
  try { localStorage.setItem(INSTALLED_KEY, JSON.stringify(tabs)) } catch {}
}

// Numero di colonne della Home (impostazione in Settings, default 3).
// 0 = AUTO: il numero di colonne viene deciso dalla larghezza della finestra.
// Il valore impostato è comunque un MASSIMO: se la finestra non ci sta, si riduce.
const COLUMNS_KEY = 'quinki-home-columns'
export function loadHomeColumns(): number {
  try {
    const v = parseInt(localStorage.getItem(COLUMNS_KEY) || '', 10)
    if (Number.isFinite(v) && v >= 0 && v <= 30) return v
  } catch {}
  return 3
}
export function saveHomeColumns(n: number) {
  try { localStorage.setItem(COLUMNS_KEY, String(n)) } catch {}
}

// Tab visibili nella Home: ordine persistito + base + installate
// ── SIMULAZIONE (dev/test): genera N tab fittizie installate ──
export function simulateTabs(n: number): HomeTab[] {
  const colors = ['var(--q-accent-info)', 'var(--q-accent-success)', 'var(--q-accent-warning)', 'var(--q-accent-danger)', 'var(--q-accent-secondary)', 'var(--q-accent-calendar)']
  const labels = ['Knowledge', 'Notes AI', 'Finance', 'Health', 'Travel', 'Music', 'Movies', 'Reading', 'Fitness', 'Cooking', 'Projects', 'Ideas', 'Goals', 'Journal', 'Budget', 'Weather', 'News', 'Email', 'Calendar AI', 'Tasks Pro', 'Study', 'Work', 'Gaming', 'Photos', 'Music 2', 'Podcasts', 'Stocks', 'Crypto', 'Sports', 'Meditation', 'Sleep', 'Diet', 'Shopping', 'Friends', 'Family', 'Events', 'Reminders', 'Habits', 'Quotes', 'Math', 'Code', 'Design', 'Writing', 'Research', 'Maps', 'Travel', 'Languages', 'Culture', 'Science', 'Space']
  const out: HomeTab[] = []
  for (let i = 0; i < n; i++) {
    // NB: NON salvare 'icon' (è una funzione React, non serializzabile) —
    // viene riassegnata al caricamento in loadInstalledTabs
    out.push({
      id: 'sim-' + i,
      icon: (i % 2 === 0) ? Bot : BookOpen,
      label: labels[i % labels.length] + ' ' + (i + 1),
      color: colors[i % colors.length],
      panel: '',
      base: false,
    })
  }
  saveInstalledTabs(out.map(({ icon, ...rest }) => rest as any))
  return out
}
// Versione serializzabile delle tab installate (senza funzioni icona)
export function serializeInstalledTabs(): any[] {
  return loadInstalledTabs().map(({ icon, ...rest }) => rest)
}

// ── A4.2: install / update / uninstall dal Marketplace ──
// Installo una tab del catalogo: entra nelle installate (localStorage) e
// viene accodata all'ordine della Home. Il campo 'panel' indica il pannello.
export function installCatalogTab(itemId: string): boolean {
  const item = findCatalogItem(itemId)
  if (!item) return false
  const installed = loadInstalledTabs()
  if (installed.some((t) => t.id === item.id)) return true // già installata
  const newTab: HomeTab = {
    id: item.id,
    icon: item.icon,
    label: item.name,
    color: item.color,
    panel: item.panel,
    base: false,
  }
  // NB: non salvare 'icon' (funzione React, non serializzabile) — riassegnata al load
  saveInstalledTabs([...installed, { ...newTab, icon: undefined } as any])
  const order = loadTabOrder()
  if (!order.includes(item.id)) {
    saveTabOrder([...order, item.id])
  }
  return true
}

// Rimuove una tab installata (installate e ordine)
export function uninstallCatalogTab(itemId: string): boolean {
  const installed = loadInstalledTabs()
  if (!installed.some((t) => t.id === itemId)) return false
  saveInstalledTabs(installed.filter((t) => t.id !== itemId))
  saveTabOrder(loadTabOrder().filter((id) => id !== itemId))
  return true
}

// Aggiorna una tab installata (nuova versione/dati dal catalogo)
export function updateCatalogTab(itemId: string): boolean {
  const item = findCatalogItem(itemId)
  if (!item) return false
  const installed = loadInstalledTabs()
  const idx = installed.findIndex((t) => t.id === itemId)
  if (idx === -1) return installCatalogTab(itemId)
  const updated: HomeTab = {
    ...installed[idx],
    id: item.id,
    label: item.name,
    color: item.color,
    panel: item.panel,
    icon: undefined as any,
  }
  const next = installed.slice()
  next[idx] = updated
  saveInstalledTabs(next)
  return true
}

// ── A4.2: registro installazioni marketplace per categorie non-tab ──
// (skills, agents, mcp, themes). Le tab usano il registro INSTALLED_KEY.
const MARKET_KEY = 'quinki-installed-market'
export interface MarketItem { id: string, category: string }

// A4.4 Blocco 3 — MY REPOS: repo esterni che l'utente aggiunge come sorgenti del market
const MY_REPOS_KEY = 'quinki-my-repos'
export interface MyRepo { url: string, label: string, addedAt: number }
// Sanitizza: solo caratteri stampabili ASCII, niente surrogate isolati (evita
// InvalidCharacterError di localStorage con URL incollate contenenti caratteri invisibili)
function cleanStr(s: string): string {
  return String(s || '').replace(/[\uD800-\uDFFF]/g, '').replace(/[^\x20-\x7E]/g, '').trim()
}
export function getMyRepos(): MyRepo[] {
  try {
    const raw = localStorage.getItem(MY_REPOS_KEY)
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr.map((r: any) => ({ url: cleanStr(r?.url), label: cleanStr(r?.label) || cleanStr(r?.url), addedAt: r?.addedAt || 0 })).filter((r: MyRepo) => !!r.url) as MyRepo[] }
  } catch {}
  return []
}
export function saveMyRepos(repos: MyRepo[]) {
  try { localStorage.setItem(MY_REPOS_KEY, JSON.stringify(repos.map((r) => ({ url: cleanStr(r.url), label: cleanStr(r.label) || cleanStr(r.url), addedAt: r.addedAt || Date.now() })).filter((r) => !!r.url))) } catch {}
}
export function addMyRepo(url: string, label: string): boolean {
  const u = cleanStr(url)
  if (!u) return false
  const repos = getMyRepos()
  if (repos.some(r => r.url === u)) return false
  saveMyRepos([...repos, { url: u, label: cleanStr(label) || u, addedAt: Date.now() }])
  // Pulisci la cache della sorgente: il prossimo refresh fa un fetch FRESCO
  try { localStorage.removeItem('quinki-src-cache-' + u) } catch {}
  return true
}
export function removeMyRepo(url: string) {
  saveMyRepos(getMyRepos().filter(r => r.url !== url))
}
const UNINSTALLED_KEY = 'quinki-uninstalled-market'
export function getUninstalledItems(): MarketItem[] {
  try {
    const raw = localStorage.getItem(UNINSTALLED_KEY)
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr as MarketItem[] }
  } catch {}
  return []
}
export function saveUninstalledItems(items: MarketItem[]) {
  try { localStorage.setItem(UNINSTALLED_KEY, JSON.stringify(items)) } catch {}
}
export function addUninstalledItem(id: string, category: string) {
  const items = getUninstalledItems()
  if (!items.some((x) => x.id === id && x.category === category)) saveUninstalledItems([...items, { id, category }])
}
export function removeUninstalledItem(id: string, category: string) {
  saveUninstalledItems(getUninstalledItems().filter((x) => !(x.id === id && x.category === category)))
}
export function getMarketItems(): MarketItem[] {
  try {
    const raw = localStorage.getItem(MARKET_KEY)
    if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr as MarketItem[] }
  } catch {}
  return []
}
export function saveMarketItems(items: MarketItem[]) {
  try { localStorage.setItem(MARKET_KEY, JSON.stringify(items)) } catch {}
}
export function isMarketItemInstalled(id: string, category: string): boolean {
  return getMarketItems().some((x) => x.id === id && x.category === category)
}
export function installMarketItem(id: string, category: string) {
  const items = getMarketItems()
  if (!items.some((x) => x.id === id)) saveMarketItems([...items, { id, category }])
}
export function uninstallMarketItem(id: string, category: string) {
  saveMarketItems(getMarketItems().filter((x) => !(x.id === id && x.category === category)))
}

// Versione attualmente installata di un item (per lo store: mostra Install/Update/Remove)
export function getInstalledVersion(itemId: string): string | null {
  const installed = loadInstalledTabs()
  const t = installed.find((x) => x.id === itemId)
  if (!t) return null
  // il numero di versione è nel catalogo; lo stato installato è comunque "presente"
  return (t as any).version || '0'
}

export function clearInstalledTabs() {
  try { localStorage.removeItem(INSTALLED_KEY) } catch {}
}

export function isInstalledTab(id: string): boolean {
  return loadInstalledTabs().some((t) => t.id === id)
}

// Persiste lo stato della Home (colonne+ordine+tab installate+market items) nel file settings.
// Usa window.__sidecarCall (impostato da App.tsx) così funziona da ovunque.
export function persistHomeConfig() {
  try {
    let themes: any[] = []
    try { themes = JSON.parse(localStorage.getItem('quinki-installed-themes') || '[]') || [] } catch {}
    let ghToken = ''
    try { ghToken = localStorage.getItem('quinki-github-token') || '' } catch {}
    const hc = { columns: loadHomeColumns(), order: loadTabOrder(), tabs: serializeInstalledTabs(), market: getMarketItems(), themes, uninstalled: getUninstalledItems(), repos: getMyRepos(), registry: getRegistry(), githubToken: ghToken }
    const call: any = (window as any).__sidecarCall
    if (call && typeof call === 'function') call('saveSettings', { homeConfig: hc }).catch(() => {})
  } catch {}
}

// Ripristina lo stato della Home dal file settings (quinki-settings.json → homeConfig).
// Chiamato all'avvio: se localStorage è vuoto (reinstall / cache pulita) le installazioni
// NON si perdono — vengono ripristinate da qui. Il localStorage resta la cache veloce.
export function restoreHomeConfig(call?: (method: string, params?: any) => Promise<any>) {
  if (!call) return
  call('getSettings', {}).then((s: any) => {
    const hc = s?.homeConfig
    if (!hc) return
    try {
      if (Array.isArray(hc.tabs) && hc.tabs.length > 0) {
        if (loadInstalledTabs().length === 0) saveInstalledTabs(hc.tabs as any)
      }
      if (Array.isArray(hc.order) && hc.order.length > 0) {
        const cur = loadTabOrder()
        if (cur.length === 0 || cur.join(',') !== hc.order.join(',')) saveTabOrder(hc.order)
      }
      if (typeof hc.columns === 'number') {
        // FIX (29 ago): il restore FORZAVA le colonne stale del sidecar a OGNI mount
        // della Home → annullava ogni cambio fatto in Settings (bug: cambi → esci →
        // torna → tutto come prima). Ora ripristina SOLO se localStorage non ha un
        // valore (post-reinstall); persistHomeConfig() tiene il sidecar aggiornato.
        try { if (localStorage.getItem(COLUMNS_KEY) == null) saveHomeColumns(hc.columns) } catch {}
      }
      if (Array.isArray(hc.market) && hc.market.length > 0) {
        // MERGE per id: a un riavvio normale localStorage non è vuoto ma può essere
        // STALE (manca item installati in un'altra sessione) → aggiunge i mancanti.
        const cur = getMarketItems()
        const merged = [...cur]
        for (const x of hc.market) { if (!merged.some((y) => y.id === x.id)) merged.push(x) }
        saveMarketItems(merged)
      }
      if (Array.isArray(hc.themes) && hc.themes.length > 0) {
        try {
          const cur = JSON.parse(localStorage.getItem('quinki-installed-themes') || '[]') || []
          if (cur.length === 0) localStorage.setItem('quinki-installed-themes', JSON.stringify(hc.themes))
        } catch {}
      }
      if (Array.isArray(hc.uninstalled) && hc.uninstalled.length > 0) {
        if (getUninstalledItems().length === 0) saveUninstalledItems(hc.uninstalled)
      }
      if (Array.isArray(hc.repos) && hc.repos.length > 0) {
        // I repo sono gestiti DALL'UTENTE: il file è solo un backup per il caso reinstall
        // (localStorage pulito). Se la lista locale non è vuota, l'utente è l'autorità
        // (le sue eliminazioni restano). Se è vuota (reinstall), ripristina dal file.
        if (getMyRepos().length === 0) saveMyRepos(hc.repos)
      }
      if (Array.isArray(hc.registry) && hc.registry.length > 0) {
        const cur = getRegistry()
        const merged = [...cur]
        for (const x of hc.registry) { if (!merged.some((y) => y.id === x.id && y.category === x.category)) merged.push(x) }
        saveRegistry(merged)
      }
      if (typeof hc.githubToken === 'string' && hc.githubToken) {
        try { if (!localStorage.getItem('quinki-github-token')) localStorage.setItem('quinki-github-token', hc.githubToken) } catch {}
      }
    } catch {}
  }).catch(() => {})
}

export function getHomeTabs(): HomeTab[] {
  const order = loadTabOrder()
  const all = [...baseTabs, ...loadInstalledTabs()]
  const byId = new Map(all.map(t => [t.id, t]))
  const ordered: HomeTab[] = []
  for (const id of order) {
    const t = byId.get(id)
    if (t) { ordered.push(t); byId.delete(id) }
  }
  return [...ordered, ...Array.from(byId.values())]
}
