// MarketplaceView.tsx — A4.2: lo Store in-app, pensato come un SITO WEB.
// Vive come pannello DENTRO l'app (sotto la title bar → mai sotto i semafori).
// Home con trend / più scaricati / consigliati, categorie, pagine di dettaglio
// con specifiche e profilo dello sviluppatore. In A4.4 il catalogo diventa online
// e questa UI resta identica (il sito).
import React from 'react'
import { useState, useEffect, useRef } from 'react'
import { Store, Search, X, Check, Download, RefreshCw, Trash2, ChevronLeft, ShieldCheck, Home, User, Bot, ChevronDown, Filter, Tune } from '../icons'
import { StoreCard, fmt, renderItemIcon } from './StoreCard'
import { installCatalogTab, uninstallCatalogTab, updateCatalogTab, isInstalledTab, persistHomeConfig, isMarketItemInstalled, installMarketItem, uninstallMarketItem, getMarketItems, loadInstalledTabs, getUninstalledItems, addUninstalledItem, removeUninstalledItem, saveUninstalledItems } from '../../tabs'
import { findTabPackage } from '../../tabs/runtimePackages'
import { fetchRemoteCatalog, refreshRemoteCatalog, getMergedCatalog, fetchSkillResolved, getRemoteStatus, setRemoteToken } from '../../marketRemote'
import { getGithubToken } from '../../ghOAuth'
import { findPackageBundle } from '../../catalogPackages'
import { useSidecarContext } from '../shared/AppShell'
import { catalogSections, findCatalogItem, type CatalogItem } from '../../catalog'
import { AccountPanel } from './AccountPanel'
import { recordInstall, hashContent } from '../../registry'
import { installMarketPackage } from '../../marketActions'
import { ConfirmModal } from './ConfirmModal'


interface Props {
  onSelectPanel: (p: string) => void
  refreshAgents?: () => void
}

function avatarInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

function ActionButton({ children, onClick, kind = 'primary' }: { children: any, onClick: () => void, kind?: 'primary' | 'danger' | 'ghost' }) {
  const base: any = { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none', border: '1px solid ' + (kind === 'danger' ? 'var(--mp-border-strong)' : 'var(--mp-accent)'), backgroundColor: 'var(--mp-panel)', color: kind === 'danger' ? 'var(--mp-danger)' : 'var(--mp-accent)', fontSize: '13px', fontWeight: kind === 'ghost' ? 400 : 600 }
  return React.createElement('button', {
    onClick,
    onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = kind === 'ghost' ? 'rgba(255,255,255,0.06)' : 'var(--mp-accent)'; e.currentTarget.style.color = kind === 'ghost' ? 'var(--mp-text-secondary)' : 'var(--mp-bg)' },
    onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = kind === 'danger' ? 'var(--mp-danger)' : (kind === 'ghost' ? 'var(--mp-text-secondary)' : 'var(--mp-accent)') },
    style: base
  }, children)
}

function Row({ title, items, onOpen, onInstall, installedOf, onRemove, actionOf }: {
  title: string, items: CatalogItem[], onOpen: (i: CatalogItem) => void, onInstall: (i: CatalogItem) => void, installedOf: (i: CatalogItem) => boolean, onRemove: (i: CatalogItem) => void, actionOf: (i: CatalogItem) => { label: string, onClick: () => void, kind?: 'danger' } | undefined
}) {
  return React.createElement('div', { style: { marginBottom: '28px' } },
    React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '12px' } }, title),
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '12px' } },
      items.map((item) => React.createElement(StoreCard, { key: item.id, item, onOpen: () => onOpen(item), onInstall: () => onInstall(item), installed: installedOf(item), onRemove: () => onRemove(item), action: actionOf(item) }))
    )
  )
}

// Dettaglio di una skill ESTERNA (adattatore GitHub): scarica l'SKILL.md on-demand.
// Molti repo "skills" hanno SKILL.md che sono SOLO path (shim: puntano al file vero).
// Risolviamo la catena di shim (max 3 hop) fino al contenuto reale; se non c'è
// descrizione utile, NON mostriamo il path: diciamo che è solo un riferimento.
function RemoteSkillDetail({ item }: { item: any }) {
  const [state, setState] = useState<'loading' | 'ok' | 'err' | 'path'>('loading')
  const [desc, setDesc] = useState('')
  const [body, setBody] = useState('')
  useEffect(() => {
    let cancelled = false
    setState('loading'); setDesc(''); setBody('')
    const base = item.remoteRepoRawBase || ''
    const path = item.remoteSkillPath || ''
    if (!base || !path) { setState('err'); return }
    const resolve = (dir: string, content: string): string => {
      // risolve un path relativo (es. ../../../engineering-team/x/SKILL.md) contro la dir
      const parts = dir.split('/').filter(Boolean)
      for (const part of content.trim().split('/')) {
        if (part === '..') { if (parts.length) parts.pop() }
        else if (part !== '.' && part) parts.push(part)
      }
      return parts.join('/')
    }
    const isShim = (txt: string) => {
      const t = txt.trim()
      return /^[\s./\w\-]+\.md\s*$/i.test(t) && t.includes('/')
    }
    let hop = 0
    const tryLoad = (filePath: string) => {
      if (cancelled) return
      fetch(base + '/' + filePath)
        .then((r) => r.ok ? r.text() : Promise.reject(new Error('http')))
        .then((txt) => {
          if (cancelled) return
          const m = txt.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
          if (m) {
            const dm = m[1].match(/^description\s*:\s*["']?(.+?)["']?\s*$/m)
            setDesc(dm ? dm[1].trim() : '')
            setBody((m[2] || '').trim())
            setState('ok')
            return
          }
          if (isShim(txt) && hop < 3) {
            hop++
            const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
            tryLoad(resolve(dir, txt))
            return
          }
          if (isShim(txt)) { setState('path'); return }
          setDesc(''); setBody(txt.trim()); setState('ok')
        })
        .catch(() => { if (!cancelled) setState('err') })
    }
    tryLoad(path)
    return () => { cancelled = true }
  }, [item.id])
  if (state === 'loading') return React.createElement('div', { style: { height: '16px', width: '70%', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.05)', animation: 'breathe 1.4s ease-in-out infinite', marginBottom: '20px' } })
  if (state === 'err') return React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' } }, 'Could not load the skill description (offline?).')
  if (state === 'path') return React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.6, marginBottom: '20px' } }, 'Reference only: this SKILL.md in the repo points to another location and provides no description.')
  if (!desc && !body) return React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' } }, 'No description available from the author.')
  return React.createElement('div', { style: { marginBottom: '20px' } },
    desc && React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.7, whiteSpace: 'pre-wrap' } }, desc),
    body && React.createElement('div', { style: { marginTop: '12px' } },
      React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontWeight: 600, fontFamily: 'var(--font-interface)', letterSpacing: '0.6px', marginBottom: '6px' } }, 'SKILL CONTENT'),
      React.createElement('pre', { style: { backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '12px', fontSize: '12px', fontFamily: 'var(--font-code)', color: 'var(--mp-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '320px', overflowY: 'auto', lineHeight: 1.6 } }, body)
    )
  )
}

// Dettaglio di un AGENTE o MCP esterno (adattatore): scarica il file e lo mostra.
function RemoteFileDetail({ item }: { item: any }) {
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading')
  const [desc, setDesc] = useState('')
  const [body, setBody] = useState('')
  useEffect(() => {
    let cancelled = false
    setState('loading'); setDesc(''); setBody('')
    const base = item.remoteRepoRawBase || ''
    const path = item.remoteAgentPath || item.remoteMcpPath || ''
    if (!base || !path) { setState('err'); return }
    const isJson = !!item.remoteMcpPath
    const load = () => {
      if (cancelled) return
      fetch(base + '/' + path).then((r) => r.ok ? r.text() : Promise.reject(new Error('http'))).then((txt) => {
        if (cancelled) return
        if (isJson) {
          try {
            const j = JSON.parse(txt)
            const servers = (j.mcpServers && typeof j.mcpServers === 'object') ? Object.entries(j.mcpServers) : Object.entries(j)
            // descrizione leggibile di COSA È ogni server MCP
            const lines = servers.map(([n, s]: [string, any]) => {
              if (typeof s === 'string') return '• ' + n + ' — remote MCP server (URL)'
              if (s && s.url) return '• ' + n + ' — remote MCP server at ' + s.url
              if (s && s.command) return '• ' + n + ' — local MCP: ' + (Array.isArray(s.command) ? s.command.join(' ') : String(s.command))
              if (s && s.description) return '• ' + n + ' — ' + s.description
              return '• ' + n
            })
            setDesc((servers.length === 0 ? 'No MCP servers found in this config.' : lines.join('\n')))
            setBody(JSON.stringify(j, null, 2))
          } catch { setDesc(''); setBody(txt) }
          setState('ok')
        } else {
          let d = ''
          let b = txt
          const m = txt.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
          if (m) {
            const dm = m[1].match(/^description\s*:\s*["']?(.+?)["']?\s*$/m)
            if (dm) d = dm[1].trim()
            b = m[2] || ''
          }
          setDesc(d); setBody(b.trim()); setState('ok')
        }
      }).catch(() => { if (!cancelled) setState('err') })
    }
    if (item.remoteAgentPath) { fetchSkillResolved(base, path).then((r) => { if (r) { const m = r.content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); setDesc(m ? ((m[1].match(/^description\s*:\s*["']?(.+?)["']?\s*$/m))?.[1]?.trim() || '') : ''); setBody((m ? m[2] : r.content).trim()); setState('ok') } else setState('err') }).catch(() => { if (!cancelled) setState('err') }); return }
    load()
    return () => { cancelled = true }
  }, [item.id])
  if (state === 'loading') return React.createElement('div', { style: { height: '16px', width: '70%', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.05)', animation: 'breathe 1.4s ease-in-out infinite', marginBottom: '20px' } })
  if (state === 'err') return React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' } }, 'Could not load the content (offline?).')
  return React.createElement('div', { style: { marginBottom: '20px' } },
    desc && React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.7, whiteSpace: 'pre-wrap' } }, desc),
    body && React.createElement('div', { style: { marginTop: '12px' } },
      React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontWeight: 600, fontFamily: 'var(--font-interface)', letterSpacing: '0.6px', marginBottom: '6px' } }, item.remoteMcpPath ? 'MCP CONFIG' : 'AGENT PROMPT'),
      React.createElement('pre', { style: { backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '12px', fontSize: '12px', fontFamily: 'var(--font-code)', color: 'var(--mp-text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '320px', overflowY: 'auto', lineHeight: 1.6 } }, body)
    )
  )
}

function MarketSkeleton() {
  // Card placeholder nella GIGLIA reale (repeat(auto-fill)): si adattano alla larghezza,
  // non escono mai dalla finestra.
  const card = (i: number) => React.createElement('div', { key: i, style: { backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
      React.createElement('div', { style: { width: '52px', height: '52px', borderRadius: 'var(--radius-md)', backgroundColor: 'rgba(255,255,255,0.05)', animation: 'breathe 1.4s ease-in-out infinite ' + (i * 0.15) + 's', flexShrink: 0 } }),
      React.createElement('div', { style: { flex: 1, minWidth: 0 } },
        React.createElement('div', { style: { width: '70%', height: '14px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.05)', animation: 'breathe 1.4s ease-in-out infinite ' + (i * 0.15 + 0.1) + 's' } }),
        React.createElement('div', { style: { width: '45%', height: '11px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.04)', animation: 'breathe 1.4s ease-in-out infinite ' + (i * 0.15 + 0.2) + 's', marginTop: '6px' } })
      )
    ),
    React.createElement('div', { style: { width: '90%', height: '11px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.04)', animation: 'breathe 1.4s ease-in-out infinite ' + (i * 0.15 + 0.3) + 's' } }),
    React.createElement('div', { style: { width: '60%', height: '11px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.04)', animation: 'breathe 1.4s ease-in-out infinite ' + (i * 0.15 + 0.4) + 's' } })
  )
  const row = (titleDelay: number, start: number) => React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
    React.createElement('div', { style: { width: '180px', height: '16px', borderRadius: '6px', backgroundColor: 'rgba(255,255,255,0.05)', animation: 'breathe 1.4s ease-in-out infinite ' + titleDelay + 's' } }),
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '12px' } },
      [0, 1, 2, 3, 4, 5].map((j) => card(start + j))
    )
  )
  // Riempie TUTTO lo spazio disponibile reale (minHeight 100% dell'area scrollabile)
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '28px', minHeight: '100%' } },
    row(0, 0),
    row(0.2, 6),
    row(0.4, 12)
  )
}

export function MarketplaceView({ onSelectPanel, refreshAgents }: Props) {
  const { call, connected } = useSidecarContext()
  const [query, setQuery] = useState('')
  const [hideInstalled, setHideInstalled] = useState(false)
  const [version, setVersion] = useState(0)
  const [catalogItems, setCatalogItems] = useState<any[]>(() => getMergedCatalog())
  const [selectedSources, setSelectedSources] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('quinki-repo-selected') || '[]')) } catch { return new Set() }
  })
  const [repoSearch, setRepoSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [repoFilterOpen, setRepoFilterOpen] = useState(false)
  const [repoMenuPos, setRepoMenuPos] = useState({ x: 0, y: 0, w: 0 })
  const [marketLoading, setMarketLoading] = useState(true)
  const [degraded, setDegraded] = useState(false)
  useEffect(() => {
    try { localStorage.setItem('quinki-repo-selected', JSON.stringify([...selectedSources])) } catch {}
  }, [selectedSources])
  useEffect(() => { if (!repoFilterOpen) setRepoSearch('') }, [repoFilterOpen])

  // A4.3: SYNC col nativo — se un agente/skill/MCP/tema è stato rimosso dalle UI native
  // (pannello Agents, settings MCP), lo store lo toglie dall'account (e va nei disinstallati).
  useEffect(() => {
    if (!call || !connected) return
    let cancelled = false
    const sync = async () => {
      try {
        const [ag, sk, mc] = await Promise.all([
          call('listAgents').catch(() => ({ agents: [] })),
          call('listSkills').catch(() => ({ skills: [] })),
          call('listMcpServers').catch(() => ({ servers: [] })),
        ])
        if (cancelled) return
        const agentIds = new Set((ag?.agents || []).map((a: any) => a.id))
        const skillDirs = new Set((sk?.skills || []).map((s: any) => { try { return String(s.directory || '').split('/').filter(Boolean).pop() || '' } catch { return '' } }))
        const mcpIds = new Set((mc?.servers || []).map((s: any) => s.id))
        let changed = false
        for (const it of getMarketItems()) {
          let exists = true
          if (it.category === 'agent') exists = agentIds.has(it.id)
          else if (it.category === 'skill') exists = skillDirs.has(it.id)
          else if (it.category === 'mcp') exists = mcpIds.has(it.id)
          else if (it.category === 'theme') { try { exists = (JSON.parse(localStorage.getItem('quinki-installed-themes') || '[]') || []).some((t: any) => t.id === it.id) } catch { exists = false } }
          if (!exists) { uninstallMarketItem(it.id, it.category); addUninstalledItem(it.id, it.category); changed = true }
        }
        if (changed) { setVersion((v) => v + 1); persistHomeConfig() }
      } catch {}
    }
    sync()
    return () => { cancelled = true }
  }, [call, connected])

  // NIENTE installazioni finte: lo stato installato è SOLO quello reale.
  // (Pulizia: se in passato era stata seminata, si toglie tutto.)
  useEffect(() => {
    try {
      if (localStorage.getItem('quinki-sim-seeded')) {
        localStorage.removeItem('quinki-sim-seeded')
        getMarketItems().forEach((x) => uninstallMarketItem(x.id, x.category))
        loadInstalledTabs().forEach((t: any) => uninstallCatalogTab(t.id))
        setVersion(version + 1)
      }
    } catch {}
  }, [])

  // Stack di navigazione (come = un sito web): la vista precedente.
  // v = view (home/categoria/account), d = dettaglio item, a = sviluppatore.
  const [stack, setStack] = useState<{ v: string, d?: CatalogItem, a?: string }[]>([{ v: 'home' }])
  const [following, setFollowing] = useState<string[]>(() => { try { const raw = localStorage.getItem('quinki-market-following'); if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) return arr } } catch {} return [] })
  const [confirm, setConfirm] = useState<{ title: string, message: string, confirmLabel: string, danger?: boolean, busyLabel?: string, secondaryLabel?: string, onSecondary?: () => void, segOptions?: string[], segValue?: string, onSeg?: (v: string) => void, onConfirm: () => void } | null>(null)
  const agentModeRef = useRef('with')
  const ask = (title: string, message: string, confirmLabel: string, danger: boolean, busyLabel: string, onConfirm: () => void) => setConfirm({ title, message, confirmLabel, danger, busyLabel, onConfirm: () => { onConfirm(); setConfirm(null) } })
  const askAgent = (item: CatalogItem, onDone?: () => void) => {
    agentModeRef.current = 'with'
    setConfirm({
      title: 'Install ' + item.name + '?',
      message: 'This will add ' + item.name + ' to your account. Choose how to install it:',
      confirmLabel: 'Install',
      busyLabel: 'Installing…',
      segOptions: ['With configuration', 'Without configuration'],
      segValue: 'With configuration',
      onSeg: (v: string) => { agentModeRef.current = v === 'Without configuration' ? 'bare' : 'with'; setConfirm(prev => prev ? { ...prev, segValue: v } : prev) },
      onConfirm: () => { doInstall(item, agentModeRef.current === 'with'); onDone && onDone(); setConfirm(null) },
    })
  }
  // A4.4 Blocco 2: carica il catalogo SOLO dal market online (mai il catalogo locale simulato)
  useEffect(() => {
    let cancelled = false
    // il token OAuth serve a leggere il catalog del repo di default se privato
    getGithubToken(call).then((t) => { setRemoteToken(t) }).catch(() => {})
    fetchRemoteCatalog().then(() => {
      if (cancelled) return
      setCatalogItems(getMergedCatalog())
      setDegraded(getRemoteStatus().degraded)
      // catalogo al sidecar → tool 'market' degli agenti (skill quinki-market)
      try { if (call) call('setMarketCatalog', { items: getMergedCatalog() }).catch(() => {}) } catch {}
      // Riconcilia gli MCP installati nativamente (mcpServers.json) con il registry market:
      // se un server nativo ext-* è già installato ma il registry l'ha perso, lo ri-registra.
      try {
        if (call) call('listMcpServers').then((servers: any) => {
          const list = Array.isArray(servers) ? servers : []
          let changed = false
          for (const s of list) {
            const sid = String(s?.id || '')
            if (!sid.startsWith('ext-')) continue
            const cat = getMergedCatalog().find((x: any) => x.id && sid.startsWith(x.id))
            if (cat && !isMarketItemInstalled(cat.id, 'mcp')) { installMarketItem(cat.id, 'mcp'); changed = true }
          }
          if (changed) { setVersion((v) => v + 1); persistHomeConfig() }
        }).catch(() => {})
      } catch {}
    }).catch(() => {}).finally(() => { if (!cancelled) setMarketLoading(false) })
    return () => { cancelled = true }
  }, [])
  const askInstall = (item: CatalogItem, onDone?: () => void) => item.category === 'agent'
    ? askAgent(item, onDone)
    : ask('Install ' + item.name + '?', 'This will add ' + item.name + ' to your account.', 'Install', false, 'Installing…', () => { doInstall(item); onDone && onDone() })
  const askUninstall = (item: CatalogItem, onDone?: () => void) => ask('Uninstall ' + item.name + '?', 'This will remove ' + item.name + ' from your account.', 'Uninstall', true, 'Removing…', () => { doRemove(item); onDone && onDone() })
  const askUpdate = (item: CatalogItem, onDone?: () => void) => ask('Update ' + item.name + '?', 'A new version is available. Update to the latest version.', 'Update', false, 'Updating…', () => {
    updateCatalogTab(item.id)
    if (item.category === 'tab') {
      const pkg = findTabPackage(item.id)
      if (pkg && call) call('installTabPackage', { id: item.id, manifest: pkg.manifest, bundle: pkg.code, server: pkg.server }).catch(() => {})
      if (pkg) hashContent(JSON.stringify({ m: pkg.manifest, c: pkg.code, s: pkg.server })).then((h) => recordInstall({ id: item.id, category: 'tab', source: item.remoteSource || 'quinki-market', author: item.author, version: item.version || '1.0.0', hash: h })).catch(() => {})
    } else {
      const bundle = findPackageBundle(item.id)
      if (bundle && call) call('installPackage', { category: item.category, id: item.id, manifest: bundle.manifest, files: bundle.files }).catch(() => {})
    }
    setVersion(version + 1); persistHomeConfig(); onDone && onDone()
  })
  const askFollowToggle = (author: string) => following.includes(author)
    ? ask('Unfollow ' + author + '?', 'You will stop seeing their updates in your Following list.', 'Unfollow', true, 'Unfollowing…', () => { const next = following.filter((f) => f !== author); setFollowing(next); try { localStorage.setItem('quinki-market-following', JSON.stringify(next)) } catch {} })
    : ask('Follow ' + author + '?', 'You will see their updates in your Following list.', 'Follow', false, 'Following…', () => { const next = [...following, author]; setFollowing(next); try { localStorage.setItem('quinki-market-following', JSON.stringify(next)) } catch {} })
  const askUpload = () => ask('Upload your own?', 'This will open the upload flow for your tabs, skills and themes.', 'Continue', false, 'Opening…', () => {})
  const cur = stack[stack.length - 1]
  const push = (s: { v: string, d?: CatalogItem, a?: string }) => setStack([...stack, s])
  const pop = () => setStack(stack.length > 1 ? stack.slice(0, -1) : stack)
  const reset = () => setStack([{ v: 'home' }])
  const view = cur.v
  const detail = cur.d || null
  const devView = cur.a || null


  const installedOf = (item: CatalogItem) => {
    if (isMarketItemInstalled(item.id, item.category)) return true
    // FIX: ciò che HO PUBBLICATO è installato PER DEFINIZIONE (era sulla mia app per poterlo
    // pubblicare) — nel market deve risultare installato (Uninstall/filter/Installed section),
    // mai "Installabile due volte"
    try {
      const pub = JSON.parse(localStorage.getItem('quinki-published') || '[]') || []
      if (pub.some((p: any) => p.id === item.id && p.category === item.category)) return true
    } catch {}
    if (item.category === 'tab' && isInstalledTab(item.id)) return true
    // MCP: considera anche il mapping nativo (server realmente creati) — stato reale
    if (item.category === 'mcp') {
      try {
        const map = JSON.parse(localStorage.getItem('quinki-mcp-mapping') || '{}') || {}
        if (Array.isArray(map[item.id]) && map[item.id].length > 0) return true
      } catch {}
    }
    return false
  }
  const hasUpdateItem = (item: CatalogItem) => ['pomodoro', 'tasks-pro'].includes(item.id)
  const actionOf = (item: CatalogItem): { label: string, onClick: () => void, kind?: 'danger' } | undefined => {
    if (!installedOf(item)) return undefined
    if (hasUpdateItem(item)) return { label: 'Update', onClick: () => askUpdate(item) }
    return { label: 'Uninstall', kind: 'danger', onClick: () => askUninstall(item) }
  }
  const doInstall = (item: CatalogItem, withConfig?: boolean) => {
    installMarketPackage(item, call, refreshAgents || undefined, withConfig !== false)
      .then(() => { setVersion(version + 1); persistHomeConfig() })
      .catch(() => { setVersion(version + 1); persistHomeConfig() })
  }
  const doRemove = (item: CatalogItem) => {
    uninstallMarketItem(item.id, item.category)
    addUninstalledItem(item.id, item.category)
    if (item.category === 'tab') {
      uninstallCatalogTab(item.id)
      if (call) call('uninstallTabPackage', { id: item.id }).catch(() => {})
    } else if (item.category === 'mcp') {
      // rimuovi i server nativi con gli id REALI (item.id + nome server), non il solo item.id
      try {
        const map = JSON.parse(localStorage.getItem('quinki-mcp-mapping') || '{}') || {}
        const nativeIds: string[] = map[item.id] || []
        for (const nid of nativeIds) { if (call) call('removeMcpServer', { id: nid }).catch(() => {}) }
        delete map[item.id]
        localStorage.setItem('quinki-mcp-mapping', JSON.stringify(map))
      } catch {}
    } else {
      if (call) call('uninstallPackage', { category: item.category, id: item.id }).catch(() => {})
      if (item.category === 'theme') {
        try {
          const cur = JSON.parse(localStorage.getItem('quinki-installed-themes') || '[]')
          localStorage.setItem('quinki-installed-themes', JSON.stringify(cur.filter((x: any) => x.id !== item.id)))
        } catch {}
      }
      if ((item.category === 'agent' || item.category === 'skill') && refreshAgents) refreshAgents()
    }
    setVersion(version + 1); persistHomeConfig()
  }

  const items = catalogItems
  const sourceVisible = (i: any) => selectedSources.size === 0 || selectedSources.has(i.remoteSource || '')
  const visibleItems = items.filter(sourceVisible)
  const byDownloads = [...visibleItems].sort((a, b) => b.downloads - a.downloads)
  const flaggedTrending = visibleItems.filter((i) => i.trending)
  const trending = flaggedTrending.length > 0 ? flaggedTrending : byDownloads.slice(0, 10)
  const popular = byDownloads.slice(0, 10)
  const recommended = byDownloads.slice(10, 20)

  const visible = (arr: CatalogItem[]) => hideInstalled ? arr.filter((i) => !installedOf(i)) : arr
  const q = query.trim().toLowerCase()
  const section = catalogSections.find((s) => s.key === view) || catalogSections[0]
  // normalizza: le sezioni sono plurali (skills/agents/themes) ma gli item hanno category singolare (skill/agent/theme)
  const catKey = section.key === 'tabs' ? 'tab' : section.key === 'skills' ? 'skill' : section.key === 'agents' ? 'agent' : section.key === 'themes' ? 'theme' : section.key
  const sectionItems = catalogItems.filter((i) => i.category === catKey && sourceVisible(i))

  // Posizione intelligente del menu Repos: allineato al bordo sinistro o destro del tasto,
  // sempre DENTRO la finestra (mai tagliato, anche se la finestra si riduce).
  const repoMenuW = Math.min(300, window.innerWidth - 16)
  const repoMenuRightEdge = repoMenuPos.x + (repoMenuPos.w || 0) + repoMenuW
  const repoLeftAligned = repoMenuRightEdge <= window.innerWidth - 8
  const repoMenuLeft = repoLeftAligned ? Math.max(8, repoMenuPos.x) : Math.max(8, repoMenuPos.x + (repoMenuPos.w || 0) - repoMenuW)
  const repoMenuTop = Math.max(8, Math.min(repoMenuPos.y, window.innerHeight - 380))
  const filtered = q ? sectionItems.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q))) : sectionItems

  // Navigazione a stack: la pagina corrente è l'ultima dello stack.
  if (devView) {
    return React.createElement(React.Fragment, null,
      React.createElement(DeveloperView, {
        author: devView,
        items,
        onBack: pop,
        onGoMarket: reset,
        onGoHome: () => onSelectPanel('home'),
        onOpenItem: (item: CatalogItem) => push({ v: cur.v, d: item }),
        doInstall: (item: CatalogItem) => askInstall(item), installedOf, doRemove: (item: CatalogItem) => askUninstall(item),
        followed: following.includes(devView),
        onToggleFollow: () => askFollowToggle(devView),
        actionOf,
      }),
      confirm && React.createElement(ConfirmModal, { ...confirm, onCancel: () => setConfirm(null) })
    )
  }

  // ── Pagina di DETTAGLIO (spec + profilo sviluppatore) ──
  if (detail) {
    const installed = installedOf(detail)
    const hasUpd = hasUpdateItem(detail)
    const moreByAuthor = items.filter((i) => i.author === detail.author && i.id !== detail.id).slice(0, 3)
    return React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      React.createElement('div', { style: { padding: '16px 32px' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '1280px', margin: '0 auto', width: '100%' } },
        React.createElement('button', {
          onClick: pop,
          className: 'mp-btn-back'
        }, React.createElement(ChevronLeft, { size: 16 }), 'Back'),
        React.createElement('button', {
          onClick: reset,
          title: 'Back to the market home',
          className: 'mp-btn',
          style: { marginLeft: 'auto' }
        }, React.createElement(Store, { size: 15 }), 'Home'),
        React.createElement('button', {
          onClick: () => onSelectPanel('home'),
          title: 'Back to the app',
          className: 'mp-btn'
        }, React.createElement(Bot, { size: 15 }), 'Quinki')
        )
      ),
      React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '32px', boxSizing: 'border-box' } },
        React.createElement('div', { style: { maxWidth: '1280px', width: '100%', margin: '0 auto' } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' } },
          React.createElement('div', { style: { width: '64px', height: '64px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
            renderItemIcon(detail.icon, 32, detail.color)
          ),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
              React.createElement('span', { style: { color: 'var(--mp-text)', fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-interface)' } }, detail.name),
              React.createElement('span', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, 'v' + detail.version),
              React.createElement('button', {
                onClick: installed ? (hasUpd ? () => askUpdate(detail) : () => askUninstall(detail)) : () => askInstall(detail),
                className: installed && !hasUpd ? 'mp-btn-danger' : 'mp-btn'
              }, installed ? (hasUpd ? 'Update' : 'Uninstall') : 'Install')
            ),
            React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginTop: '4px' } }, detail.description),
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '6px' } }, fmt(detail.downloads) + ' downloads · ' + detail.size + ' · ' + (detail.kind === 'real' ? 'native tab' : 'demo tab'))
          )
        ),
        // ── Profilo sviluppatore (in alto, cliccabile) ──
        React.createElement('div', {
          onClick: () => push({ v: cur.v, a: detail.author }),
          onMouseEnter: (e: any) => { e.currentTarget.style.borderColor = 'var(--mp-accent)'; e.currentTarget.style.backgroundColor = 'var(--mp-panel)' },
          onMouseLeave: (e: any) => { e.currentTarget.style.borderColor = 'var(--mp-border)'; e.currentTarget.style.backgroundColor = 'var(--mp-elevated)' },
          style: { display: 'flex', alignItems: 'center', gap: '14px', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '14px 16px', marginBottom: '20px', cursor: 'pointer', transition: 'none' }
        },
          React.createElement('div', { style: { width: '48px', height: '48px', borderRadius: '50%', backgroundColor: 'var(--mp-accent)', color: 'var(--mp-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-interface)', flexShrink: 0 } }, avatarInitials(detail.author)),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 700, fontFamily: 'var(--font-interface)' } }, detail.author),
            React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginTop: '2px' } }, detail.authorBio)
          ),
          React.createElement('button', {
            onClick: (e: any) => { e.stopPropagation(); askFollowToggle(detail.author) },
            className: following.includes(detail.author) ? 'mp-btn-danger' : 'mp-btn'
          }, following.includes(detail.author) ? 'Unfollow' : 'Follow')
        ),
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'About this item'),
        detail.remoteSkillPath
          ? React.createElement(RemoteSkillDetail, { item: detail })
          : (detail.remoteAgentPath || detail.remoteMcpPath)
          ? React.createElement(RemoteFileDetail, { item: detail })
          : React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.7, marginBottom: '20px', whiteSpace: 'pre-wrap' } }, detail.longDescription || detail.description),
        React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '28px' } },
          detail.tags.map((t) => React.createElement('span', { key: t, style: { padding: '3px 10px', borderRadius: '999px', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', color: 'var(--mp-text-secondary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, '#' + t))
        ),
        moreByAuthor.length > 0 && React.createElement(Row, { title: 'More by ' + detail.author, items: moreByAuthor, onOpen: (item: CatalogItem) => push({ v: cur.v, d: item }), onInstall: (item: CatalogItem) => askInstall(item), installedOf, onRemove: (item: CatalogItem) => askUninstall(item), actionOf }),
        React.createElement('div', { style: { fontSize: '15px', fontWeight: 600, color: 'var(--mp-text)', fontFamily: 'var(--font-interface)', marginBottom: '10px', marginTop: '20px' } }, 'Specifications'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px', marginBottom: '28px' } },
          [['Version', 'v' + detail.version], ['Size', detail.size], ['Downloads', fmt(detail.downloads)], ['Category', detail.category], ['Installed', installed ? 'Yes' : 'No']].map(([k, v]) => React.createElement('div', { key: k, style: { backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px' } },
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, k),
            React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginTop: '2px' } }, v)
          ))
        )
        )
      ),
      confirm && React.createElement(ConfirmModal, { ...confirm, onCancel: () => setConfirm(null) })
    )
  }

  if (view === 'account') {
    const acctSection = cur.s || 'installed'
    return React.createElement(React.Fragment, null,
      React.createElement(AccountPanel, {
        section: acctSection,
        catalogItems,
        call,
        onSectionChange: (sec: string) => setStack([...stack.slice(0, -1), { ...cur, s: sec }]),
        onGoStore: reset,
        onGoHome: () => onSelectPanel('home'),
        onOpenDeveloper: (author: string) => push({ v: 'account', s: acctSection, a: author }),
        onOpenItem: (item: CatalogItem) => push({ v: 'account', s: acctSection, d: item }),
        onUninstall: (item: CatalogItem, onDone?: () => void) => askUninstall(item, onDone),
        onInstallItem: (item: CatalogItem, onDone?: () => void) => askInstall(item, onDone),
        onUpdateItem: (item: CatalogItem, onDone?: () => void) => askUpdate(item, onDone),
        following, onToggleFollow: (author: string) => askFollowToggle(author),
        onUpload: () => askUpload(),
        onReposChanged: () => { refreshRemoteCatalog().then(() => { setCatalogItems(getMergedCatalog()); setDegraded(getRemoteStatus().degraded) }).catch(() => {}) },
      }),
      confirm && React.createElement(ConfirmModal, { ...confirm, onCancel: () => setConfirm(null) })
    )
  }

  // ── Home del sito: trend / più scaricati / consigliati ──
  const showHome = view === 'home'

  return React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
    React.createElement('div', { style: { padding: '16px 32px 0 32px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '1280px', margin: '0 auto', width: '100%' } },
      React.createElement(Store, { size: 18, style: { color: 'var(--mp-accent)' } }),
      React.createElement('span', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Market'),
      React.createElement('div', { style: { flex: 1, maxWidth: '320px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '0 12px', height: '34px', marginLeft: '16px' } },
        React.createElement(Search, { size: 14, style: { color: 'var(--mp-text-tertiary)', flexShrink: 0 } }),
        React.createElement('input', {
          value: query,
          onChange: (e: any) => setQuery(e.target.value),
          placeholder: 'Search in the market',
          style: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }
        })
      ),
      React.createElement('button', {
        onClick: () => push({ v: 'account' }),
        title: 'Manage your installed things, uploads and sources',
        className: 'mp-btn',
        style: { marginLeft: 'auto' }
      }, React.createElement(Tune, { size: 15 }), 'Manage'),
      React.createElement('button', {
        onClick: () => onSelectPanel('home'),
        title: 'Back to the app',
        className: 'mp-btn'
      }, React.createElement(Bot, { size: 15 }), 'Quinki')
      )
    ),
    degraded && React.createElement('div', { style: { padding: '8px 32px 0 32px' } },
      React.createElement('div', { style: { maxWidth: '1280px', margin: '0 auto', width: '100%', display: 'flex', alignItems: 'flex-start', gap: '10px', backgroundColor: 'rgba(210,153,34,0.08)', border: '1px solid rgba(210,153,34,0.35)', borderRadius: 'var(--radius-md)', padding: '10px 14px' } },
        React.createElement(ShieldCheck, { size: 15, style: { color: 'var(--mp-warning)', flexShrink: 0, marginTop: '1px' } }),
        React.createElement('span', { style: { color: 'var(--mp-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.5 } },
          React.createElement('b', { style: { color: 'var(--mp-warning)', fontWeight: 600 } }, 'Partial catalog'),
          ': GitHub\'s free API limit (60 req/h) was reached, so some repos show fallback data. This is GitHub\'s limit, not Quinki\'s, and it resets hourly. The built-in quinki-market repo is not affected. You can raise a repo\'s limit by setting a GitHub token for it in Account > Repos: your own token, or one the repo provides.'
        )
      )
    ),
    React.createElement('div', { style: { padding: '12px 32px' } },
      React.createElement('div', { style: { display: 'flex', gap: '4px', maxWidth: '1280px', margin: '0 auto', width: '100%' } },
      (['home', 'tabs', 'agents', 'skills', 'mcp', 'themes'] as const).map((k) => {
        const catKey2 = k === 'tabs' ? 'tab' : k === 'skills' ? 'skill' : k === 'agents' ? 'agent' : k === 'themes' ? 'theme' : k
        // I conteggi seguono i FILTRI (repo selezionati + hide installed)
        const count = k === 'home'
          ? catalogItems.filter((i: any) => sourceVisible(i) && (!hideInstalled || !installedOf(i))).length
          : catalogItems.filter((i: any) => i.category === catKey2 && sourceVisible(i) && (!hideInstalled || !installedOf(i))).length
        const label = (k === 'home' ? 'Home' : (catalogSections.find((s) => s.key === k)?.label || k)) + (k === 'home' ? '' : ' \u00b7 ' + count)
        const active = view === k
        return React.createElement('button', {
          key: k,
          onClick: () => { if (k === 'home') reset(); else push({ v: k }); setQuery('') },
          onMouseEnter: (e: any) => { if (!active) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
          onMouseLeave: (e: any) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent' },
          style: { padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: active ? '1px solid var(--mp-accent)' : '1px solid var(--mp-border-strong)', backgroundColor: active ? 'var(--mp-accent)' : 'var(--mp-panel)', color: active ? 'var(--mp-bg)' : 'var(--mp-text)', fontSize: '12px', fontWeight: active ? 600 : 400, fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none' }
        }, label)
      }),
      React.createElement('button', {
        onClick: () => setFiltersOpen(!filtersOpen),
        title: 'Filters',
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: 'var(--radius-sm)', background: 'transparent', border: 'none', cursor: 'pointer', color: filtersOpen || hideInstalled || selectedSources.size > 0 ? 'var(--mp-accent)' : 'var(--mp-text-secondary)', marginLeft: '2px', flexShrink: 0 },
        onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
        onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }
      }, React.createElement(Filter, { size: 15 })),
      filtersOpen && React.createElement('button', {
        onClick: () => setHideInstalled(!hideInstalled),
        title: 'Show only items you have not installed',
        className: hideInstalled ? 'mp-filter-active' : 'mp-filter'
      }, 'Hide installed'),
      filtersOpen && React.createElement('button', {
        onClick: (e: any) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setRepoMenuPos({ x: r.left, y: r.bottom + 4, w: r.width }); setRepoFilterOpen(true) },
        title: 'Choose which repositories to show',
        className: repoFilterOpen || selectedSources.size > 0 ? 'mp-filter-active' : 'mp-filter',
        style: { display: 'flex', alignItems: 'center', gap: '6px' }
      }, 'Repos', React.createElement(ChevronDown, { size: 14 })),
      repoFilterOpen && React.createElement(React.Fragment, null, [
        React.createElement('div', { key: 'ov', style: { position: 'fixed', inset: 0, zIndex: 998, backgroundColor: 'transparent' }, onClick: () => setRepoFilterOpen(false) }),
        React.createElement('div', { key: 'menu', style: { position: 'fixed', left: repoMenuLeft, top: repoMenuTop, width: repoMenuW, maxWidth: window.innerWidth - 16, zIndex: 999, backgroundColor: 'var(--mp-panel)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--mp-border)', padding: '8px 0', maxHeight: Math.min(360, window.innerHeight - 24), overflowY: 'auto' }, children: [
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '0 10px 8px 10px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', paddingLeft: '10px', paddingRight: '8px', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', flex: 1, minWidth: 0 } },
              React.createElement(Search, { size: 14, style: { color: 'var(--mp-text-tertiary)', flexShrink: 0 } }),
              React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
              React.createElement('input', {
                value: repoSearch,
                onChange: (e: any) => setRepoSearch(e.target.value),
                placeholder: 'Search repos...',
                autoFocus: true,
                style: { flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '8px 0' }
              }),
              repoSearch && React.createElement('button', {
                onClick: () => setRepoSearch(''),
                title: 'Clear search text',
                style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mp-text-tertiary)', display: 'flex', alignItems: 'center', padding: '4px', flexShrink: 0 },
                onMouseEnter: (e: any) => { e.currentTarget.style.color = 'var(--mp-accent)' },
                onMouseLeave: (e: any) => { e.currentTarget.style.color = 'var(--mp-text-tertiary)' }
              }, React.createElement(X, { size: 14 }))
            ),
            React.createElement('button', {
              onClick: () => setSelectedSources(new Set()),
              title: 'Clear filter (show all repos)',
              style: { background: 'transparent', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--mp-danger)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', height: '36px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 12px', flexShrink: 0, whiteSpace: 'nowrap' },
              onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
              onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }
            }, 'Clear')
          ),
          Array.from(new Set(['quinki-market', ...catalogItems.map((i: any) => i.remoteSource)].filter(Boolean)))
            .filter((s) => !repoSearch || String(s).toLowerCase().includes(repoSearch.toLowerCase()))
            .sort((a, b) => (selectedSources.has(String(a)) ? 0 : 1) - (selectedSources.has(String(b)) ? 0 : 1))
            .map((s) => {
              const src = String(s)
              const sel = selectedSources.has(src)
              const count = catalogItems.filter((i: any) => i.remoteSource === src).length
              return React.createElement('div', {
                key: src,
                onClick: () => { setSelectedSources((prev) => { const n = new Set(prev); if (n.has(src)) n.delete(src); else n.add(src); return n }) },
                style: { padding: '4px 16px', display: 'flex', alignItems: 'center', cursor: 'pointer' },
                onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)' },
                onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }
              },
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, src),
                  React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, count + ' items')
                ),
                React.createElement('input', { type: 'checkbox', checked: sel, onChange: () => { setSelectedSources((prev) => { const n = new Set(prev); if (n.has(src)) n.delete(src); else n.add(src); return n }) }, onClick: (e: any) => e.stopPropagation(), style: { accentColor: 'var(--mp-accent)', flexShrink: 0, marginLeft: '8px' } })
              )
            })
        ]})
      ])
      )
    ),
    React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '32px', boxSizing: 'border-box' } },
      React.createElement('div', { style: { maxWidth: '1280px', width: '100%', margin: '0 auto' } },
      showHome
        ? (marketLoading && items.length === 0
            ? React.createElement(MarketSkeleton, {})
            : React.createElement(React.Fragment, null,
            q
              ? React.createElement(Row, { title: 'Search results', items: visible(items.filter((i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q)))), onOpen: (item: CatalogItem) => push({ v: cur.v, d: item }), onInstall: (item: CatalogItem) => askInstall(item), installedOf: installedOf, onRemove: (item: CatalogItem) => askUninstall(item), actionOf })
              : React.createElement(React.Fragment, null,
                  React.createElement(Row, { title: '🔥 Trending now', items: visible(trending), onOpen: (item: CatalogItem) => push({ v: cur.v, d: item }), onInstall: (item: CatalogItem) => askInstall(item), installedOf: installedOf, onRemove: (item: CatalogItem) => askUninstall(item), actionOf }),
                  React.createElement(Row, { title: '⬇ Most downloaded', items: visible(popular), onOpen: (item: CatalogItem) => push({ v: cur.v, d: item }), onInstall: (item: CatalogItem) => askInstall(item), installedOf: installedOf, onRemove: (item: CatalogItem) => askUninstall(item), actionOf }),
                  React.createElement(Row, { title: '✨ Recommended for you', items: visible(recommended), onOpen: (item: CatalogItem) => push({ v: cur.v, d: item }), onInstall: (item: CatalogItem) => askInstall(item), installedOf: installedOf, onRemove: (item: CatalogItem) => askUninstall(item), actionOf })
                )
        )
        )
        : (marketLoading && catalogItems.length === 0
            ? React.createElement(MarketSkeleton, {})
            : (section.items.length === 0
            ? React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '24px 0', textAlign: 'center' } },
                'Coming soon in A4.4. The catalog for this category is not online yet.')
            : (filtered.length === 0
                ? React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '24px 0', textAlign: 'center' } }, 'No results.')
                : React.createElement(Row, { title: section.label + (sectionItems.length > 0 ? ' · ' + sectionItems.length : ''), items: visible(filtered), onOpen: (item: CatalogItem) => push({ v: cur.v, d: item }), onInstall: (item: CatalogItem) => askInstall(item), installedOf: installedOf, onRemove: (item: CatalogItem) => askUninstall(item), actionOf })
        )
        )
      )
    ),
    confirm && React.createElement(ConfirmModal, { ...confirm, onCancel: () => setConfirm(null) })
  )
  )
}


// ── DeveloperView: la pagina pubblica di uno sviluppatore ──
function DeveloperView({ author, items, onBack, onGoMarket, onGoHome, onOpenItem, doInstall, installedOf, doRemove, followed, onToggleFollow, actionOf }: {
  author: string, items: CatalogItem[], onBack: () => void, onGoMarket: () => void, onGoHome: () => void, onOpenItem: (i: CatalogItem) => void,
  doInstall: (i: CatalogItem) => void, installedOf: (i: CatalogItem) => boolean, doRemove: (i: CatalogItem) => void,
  followed: boolean, onToggleFollow: () => void, actionOf: (i: CatalogItem) => { label: string, onClick: () => void, kind?: 'danger' } | undefined
}) {
  const devItems = items.filter((i) => i.author === author)
  const dev = devItems[0]
  return React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
    React.createElement('div', { style: { padding: '16px 32px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', maxWidth: '1280px', margin: '0 auto', width: '100%' } },
      React.createElement('button', {
        onClick: onBack,
        className: 'mp-btn-back'
      }, React.createElement(ChevronLeft, { size: 16 }), 'Back'),
      React.createElement('button', {
        onClick: onGoMarket,
        title: 'Back to the market home',
        className: 'mp-btn',
        style: { marginLeft: 'auto' }
      }, React.createElement(Store, { size: 15 }), 'Home'),
      React.createElement('button', {
        onClick: onGoHome,
        title: 'Back to the app',
        className: 'mp-btn'
      }, React.createElement(Bot, { size: 15 }), 'Quinki')
      )
    ),
    React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '32px', boxSizing: 'border-box' } },
      React.createElement('div', { style: { maxWidth: '1280px', width: '100%', margin: '0 auto' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '18px', marginBottom: '28px' } },
        React.createElement('div', { style: { width: '72px', height: '72px', borderRadius: '50%', backgroundColor: 'var(--mp-accent)', color: 'var(--mp-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', fontWeight: 700, fontFamily: 'var(--font-interface)', flexShrink: 0 } }, avatarInitials(author)),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
            React.createElement('span', { style: { color: 'var(--mp-text)', fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-interface)' } }, author),
            React.createElement('button', {
              onClick: onToggleFollow,
              className: followed ? 'mp-btn-danger' : 'mp-btn'
            }, followed ? 'Unfollow' : 'Follow')
          ),
          React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginTop: '4px' } }, dev ? dev.authorBio : ''),
          React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '6px' } }, devItems.length + ' items · ' + fmt(devItems.reduce((a, b) => a + b.downloads, 0)) + ' total downloads')
        )
      ),
      React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '14px' } }, 'Everything by ' + author),
      ([['tab', 'Tabs'], ['agent', 'Agents'], ['skill', 'Skills'], ['mcp', 'MCP'], ['theme', 'Themes']] as [string, string][]).map(([cat, label]) => {
        const catItems = devItems.filter((i) => i.category === cat)
        return catItems.length > 0 && React.createElement('div', { key: cat, style: { marginBottom: '28px' } },
          React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '12px' } }, label),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '12px' } },
            catItems.map((item) => React.createElement(StoreCard, { key: item.id, item, onOpen: () => onOpenItem(item), onInstall: () => doInstall(item), installed: installedOf(item), onRemove: () => doRemove(item), action: actionOf(item) }))
          )
        )
      })
      )
    )
  )
}
