// AccountPanel.tsx — A4.2: sezione Account del Marketplace, SIMULATA al 100%.
// Vista dedicata: profilo + sezioni (Installed / Updates / Uploads / Settings),
// search interna, installati divisi per tipo (tabs, themes, skills), aggiornamenti.
import React from 'react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Search, Upload, Pencil, RefreshCw, Shield, ShieldCheck, FileText, Sparkles, Mail, Lock, LogOut, Store, Home, Bot, Trash, X } from '../icons'
import { findCatalogItem, allCatalogItems, type CatalogItem } from '../../catalog'
import { getStableCatalog, getRepoToken, setRepoToken } from '../../marketRemote'
import { getRegistry } from '../../registry'
import { StoreCard } from './StoreCard'
import { PublishPanel } from './PublishPanel'
import { getMarketItems, loadInstalledTabs, uninstallCatalogTab, uninstallMarketItem, getUninstalledItems, getMyRepos, addMyRepo, removeMyRepo, persistHomeConfig } from '../../tabs'

type Section = 'installed' | 'updates' | 'following' | 'uploads' | 'uninstalled' | 'repos'

export function AccountPanel({ section, catalogItems, call, onSectionChange, onGoStore, onGoHome, onOpenDeveloper, onOpenItem, onUninstall, onInstallItem, onUpdateItem, following, onToggleFollow, onUpload, onReposChanged }: { section: string, catalogItems: CatalogItem[], call?: (method: string, params?: any, timeout?: number) => Promise<any>, onSectionChange: (s: string) => void, onGoStore: () => void, onGoHome: () => void, onOpenDeveloper: (author: string) => void, onOpenItem: (item: CatalogItem) => void, onUninstall: (item: CatalogItem, onDone?: () => void) => void, onInstallItem: (item: CatalogItem, onDone?: () => void) => void, onUpdateItem: (item: CatalogItem, onDone?: () => void) => void, following: string[], onToggleFollow: (author: string) => void, onUpload: () => void, onReposChanged?: () => void }) {
  // ── Simulazione profilo account ──
  const [profile, setProfile] = useState({ name: '', nickname: '', email: '', bio: '', avatar: '' as string })
  const [repoInput, setRepoInput] = useState('')
  const [repoNote, setRepoNote] = useState('')
  const [tokenRepoUrl, setTokenRepoUrl] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [repoToRemove, setRepoToRemove] = useState<{ url: string; label: string } | null>(null)
  const [twoFA, setTwoFA] = useState(false)
  const [pwdNote, setPwdNote] = useState(false)
  const [signOutNote, setSignOutNote] = useState(false)

  // ── Installati: lettura dal registro REALE (seminato all'avvio del Market) ──
  const [refresh, setRefresh] = useState(0)
  const bump = () => setRefresh(refresh + 1)

  // ── Aggiornamenti disponibili: SOLO per le cose realmente installate con hasUpdate ──
  const [updates, setUpdates] = useState<any[]>([])

  // ── Simulazione upload ──
  const [uploads, setUploads] = useState<any[]>([])
  const [uploadNote, setUploadNote] = useState(false)
  // Stato intelligente: un upload può essere installato o no (simulato)
  const [uploadInstalled, setUploadInstalled] = useState<Record<string, boolean>>({ 'upload-1': true, 'upload-2': false })


  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filt = (name: string) => !q || name.toLowerCase().includes(q)

  const marketItems = getMarketItems()
  // Risolve gli installati contro TUTTO il catalogo (locale + remoto, incluse le skill esterne ext-*)
  const resolveItem = (id: string) => {
    const found = findCatalogItem(id) || catalogItems.find((i: any) => i.id === id) || getStableCatalog().find((i: any) => i.id === id)
    if (found) return found
    // Mai niente di installato sparisce dall'account: item minimale dal registro/nativo
    const mi = marketItems.find((x) => x.id === id)
    const rec = getRegistry().find((r) => r.id === id)
    const cat = mi?.category || rec?.category || 'skill'
    const icons: any = { tab: '📑', agent: '🤖', skill: '⚡', mcp: '🔌', theme: '🎨' }
    // FIX P1 #6: per gli item PUBBLICATI da me, l'autore sono IO — non 'Unknown'.
    // Controlla prima il record published (contiene name), poi il registry.
    let author = 'You'
    try {
      const pub = JSON.parse(localStorage.getItem('quinki-published') || '[]') || []
      const myPub = pub.find((p: any) => p?.id === id)
      if (myPub) author = 'You'
      else if (rec?.author) author = rec.author
      else if (rec?.source) author = rec.source
    } catch {}
    return {
      id, name: id, icon: icons[cat] || '📦', color: '#888',
      description: rec ? 'Installed from ' + rec.source : 'Installed',
      longDescription: rec ? 'Installed from ' + rec.source : 'Installed from the market',
      author, version: rec?.version || '1.0.0', size: '0.1 MB',
      downloads: 0, category: cat, tags: [], panel: '', kind: 'stub',
    } as any
  }
  const tabItems = loadInstalledTabs().map((t: any) => findCatalogItem(t.id)).filter(Boolean) as any[]
  const themeItems = marketItems.filter((x) => x.category === 'theme').map((x) => resolveItem(x.id)).filter(Boolean) as any[]
  const skillItems = marketItems.filter((x) => x.category === 'skill').map((x) => resolveItem(x.id)).filter(Boolean) as any[]
  // MCP: stato REALE = registry market ∪ mapping nativo (server davvero creati nel sidecar)
  let mappingMcpIds: string[] = []
  try { const map = JSON.parse(localStorage.getItem('quinki-mcp-mapping') || '{}') || {}; mappingMcpIds = Object.keys(map).filter((id) => Array.isArray(map[id]) && map[id].length > 0) } catch {}
  const mcpItems = [...new Set([
    ...marketItems.filter((x) => x.category === 'mcp').map((x) => x.id),
    ...mappingMcpIds,
  ])].map((id) => resolveItem(id)).filter(Boolean) as any[]
  const agentItems = marketItems.filter((x) => x.category === 'agent').map((x) => resolveItem(x.id)).filter(Boolean) as any[]
  // FIX: gli item PUBBLICATI da me sono installati PER DEFINIZIONE (erano sulla mia app)
  let pubItems: any[] = []
  // FIX deterministico: la CATEGORIA viene dal record published (mai dal lookup nel catalogo,
  // che durante il caricamento del remote fallisce e butta tutto nel fallback 'skill')
  try {
    pubItems = (JSON.parse(localStorage.getItem('quinki-published') || '[]') || [])
      .map((p: any) => {
        if (!p || !p.id) return null
        const r: any = resolveItem(p.id)
        if (r) { r.category = p.category || r.category; r.name = r.name || p.name; return r }
        return {
          id: p.id, name: p.name || p.id, icon: ({ tab: '📑', agent: '🤖', skill: '⚡', mcp: '🔌', theme: '🎨' as any })[p.category] || '📦',
          color: '#888', description: 'Published by you', longDescription: 'Published by you to the market',
          author: 'You', version: p.version || '1.0.0', size: '0.1 MB', downloads: 0,
          category: p.category, tags: [], panel: '', kind: 'stub',
        }
      })
      .filter(Boolean)
  } catch {}
  const unionBy = (a: any[], b: any[]) => { const seen = new Set(a.map((x: any) => x.id)); return [...a, ...b.filter((x: any) => !seen.has(x.id))] }
  const tabItemsF = unionBy(tabItems, pubItems.filter((x: any) => x.category === 'tab'))
  const themeItemsF = unionBy(themeItems, pubItems.filter((x: any) => x.category === 'theme'))
  const skillItemsF = unionBy(skillItems, pubItems.filter((x: any) => x.category === 'skill'))
  const mcpItemsF = unionBy(mcpItems, pubItems.filter((x: any) => x.category === 'mcp'))
  const agentItemsF = unionBy(agentItems, pubItems.filter((x: any) => x.category === 'agent'))
  const totalInstalled = tabItemsF.length + themeItemsF.length + skillItemsF.length + mcpItemsF.length + agentItemsF.length

  // Update reali: solo gli item installati che nel catalogo hanno hasUpdate
  const updateItems = [...tabItemsF, ...themeItemsF, ...skillItemsF, ...mcpItemsF, ...agentItemsF].filter((i) => (i as any).hasUpdate)
  const currentUpdates = updates.filter((u) => updateItem(u.id))
  function updateItem(id: string) { return updateItems.some((i) => i.id === id) }

  const [sub, setSub] = useState<'all' | 'tabs' | 'themes' | 'skills' | 'mcp' | 'agents'>('all')

  const uninstall = (kind: 'tab' | 'theme' | 'skill' | 'mcp' | 'agent', id: string) => {
    if (kind === 'tab') uninstallCatalogTab(id)
    else uninstallMarketItem(id, kind === 'theme' ? 'theme' : kind === 'skill' ? 'skill' : kind === 'mcp' ? 'mcp' : 'agent')
    bump()
  }

  return React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
    // ── Barra Marketplace (Store / Home) ──
    React.createElement('div', { style: { padding: '14px 32px 0 32px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '1280px', margin: '0 auto', width: '100%' } },
      React.createElement(Store, { size: 18, style: { color: 'var(--mp-accent)' } }),
      React.createElement('span', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Market'),
      React.createElement('button', {
        onClick: onGoStore,
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
    // ── Sezioni + search ──
    React.createElement('div', { style: { padding: '8px 32px 12px 32px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '1280px', margin: '0 auto', width: '100%' } },
      React.createElement('div', { style: { display: 'flex', gap: '4px' } },
        ([['installed', 'Installed'], ['updates', 'Updates'], ['following', 'Following'], ['uploads', 'Uploads'], ['uninstalled', 'Uninstalled'], ['repos', 'Repos']] as [Section, string][]).map(([k, label]) => {
          const active = section === k
          return React.createElement('button', {
            key: k,
            onClick: () => onSectionChange(k),
            className: active ? 'mp-filter-active' : 'mp-filter'
          }, label)
        })
      ),
      React.createElement('div', { style: { flex: 1, maxWidth: '280px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '0 12px', height: '32px', marginLeft: '8px' } },
        React.createElement(Search, { size: 14, style: { color: 'var(--mp-text-tertiary)', flexShrink: 0 } }),
        React.createElement('input', {
          value: query,
          onChange: (e: any) => setQuery(e.target.value),
          placeholder: section === 'installed' ? 'Search your installed things' : section === 'updates' ? 'Search updates' : section === 'following' ? 'Search developers' : section === 'uploads' ? 'Search your uploads' : section === 'uninstalled' ? 'Search uninstalled' : 'Search repos',
          style: { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }
        })
      )
      )
    ),
    React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '32px', boxSizing: 'border-box' } },
      React.createElement('div', { style: { maxWidth: '1280px', width: '100%', margin: '0 auto' } },
      // (la lista All è ora DENTRO la sezione installed, dopo i sub-tab)
      // ── INSTALLED ──
      section === 'installed' && React.createElement('div', {},
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px' } },
          React.createElement('div', { style: { flex: 1, backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px' } },
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, 'Installed'),
            React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-interface)', marginTop: '2px' } }, String(totalInstalled))
          ),
          React.createElement('div', { style: { flex: 1, backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px' } },
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, 'Updates'),
            React.createElement('div', { style: { color: 'var(--mp-warning)', fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-interface)', marginTop: '2px' } }, String(currentUpdates.length))
          )
        ),
        React.createElement('div', { style: { display: 'flex', gap: '4px', marginBottom: '16px' } },
          ([['all', 'All \u00b7 ' + totalInstalled], ['tabs', 'Tabs \u00b7 ' + tabItemsF.length], ['agents', 'Agents \u00b7 ' + agentItemsF.length], ['skills', 'Skills \u00b7 ' + skillItemsF.length], ['mcp', 'MCP \u00b7 ' + mcpItemsF.length], ['themes', 'Themes \u00b7 ' + themeItemsF.length]] as [string, string][]).map(([k, label]) => {
            const active = sub === k
            return React.createElement('button', {
              key: k,
              onClick: () => setSub(k as any),
              className: active ? 'mp-filter-active' : 'mp-filter'
            }, label)
          })
        ),
        // ── ALL: tutte le cose installate in un'unica lista (sotto i sub-tab) ──
        sub === 'all' && React.createElement('div', {},
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '12px' } },
            ([
              ...tabItemsF.map((i) => ({ item: i, kind: 'tab' as const })),
              ...agentItemsF.map((i) => ({ item: i, kind: 'agent' as const })),
              ...skillItemsF.map((i) => ({ item: i, kind: 'skill' as const })),
              ...mcpItemsF.map((i) => ({ item: i, kind: 'mcp' as const })),
              ...themeItemsF.map((i) => ({ item: i, kind: 'theme' as const })),
            ]).filter((x) => filt(x.item.name)).map(({ item, kind }) =>
              React.createElement(StoreCard, {
                key: kind + '-' + item.id,
                item: { ...item, name: (kind === 'skill' ? item.name + ' \u00b7 Skill' : kind === 'mcp' ? item.name + ' \u00b7 MCP' : kind === 'agent' ? item.name + ' \u00b7 Agent' : kind === 'theme' ? item.name + ' \u00b7 Theme' : item.name) },
                onOpen: () => onOpenItem(item),
                onInstall: () => {},
                installed: false,
                action: { label: 'Uninstall', kind: 'danger', onClick: () => onUninstall(item, () => uninstall(kind, item.id)) }
              })
            )
          )
        ),
        sub === 'tabs' && React.createElement('div', {},
          React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Installed tabs'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
            tabItemsF.filter((i) => filt(i.name)).map((item) => React.createElement(StoreCard, { key: item.id, item, onOpen: () => onOpenItem(item), onInstall: () => {}, installed: false, action: { label: 'Uninstall', kind: 'danger', onClick: () => onUninstall(item, () => uninstall('tab', item.id)) } })),
            tabItemsF.filter((i) => filt(i.name)).length === 0 && React.createElement(Empty, { text: 'No tabs match your search.' })
          )
        ),
        sub === 'themes' && React.createElement('div', {},
          React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Installed themes'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
            themeItemsF.filter((i) => filt(i.name)).map((item) => React.createElement(StoreCard, { key: item.id, item, onOpen: () => onOpenItem(item), onInstall: () => {}, installed: false, action: { label: 'Uninstall', kind: 'danger', onClick: () => onUninstall(item, () => uninstall('theme', item.id)) } })),
            themeItemsF.filter((i) => filt(i.name)).length === 0 && React.createElement(Empty, { text: 'No themes match your search.' })
          )
        ),
        sub === 'skills' && React.createElement('div', {},
          React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Installed skills'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
            skillItemsF.filter((i) => filt(i.name)).map((item) => React.createElement(StoreCard, { key: item.id, item, onOpen: () => onOpenItem(item), onInstall: () => {}, installed: false, action: { label: 'Uninstall', kind: 'danger', onClick: () => onUninstall(item, () => uninstall('skill', item.id)) } })),
            skillItemsF.filter((i) => filt(i.name)).length === 0 && React.createElement(Empty, { text: 'No skills match your search.' })
          )
        ),
        sub === 'mcp' && React.createElement('div', {},
          React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Installed MCP'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
            mcpItemsF.filter((i) => filt(i.name)).map((item) => React.createElement(StoreCard, { key: item.id, item, onOpen: () => onOpenItem(item), onInstall: () => {}, installed: false, action: { label: 'Uninstall', kind: 'danger', onClick: () => onUninstall(item, () => uninstall('mcp', item.id)) } })),
            mcpItemsF.filter((i) => filt(i.name)).length === 0 && React.createElement(Empty, { text: 'No MCP match your search.' })
          )
        ),
        sub === 'agents' && React.createElement('div', {},
          React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Installed agents'),
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
            agentItemsF.filter((i) => filt(i.name)).map((item) => React.createElement(StoreCard, { key: item.id, item, onOpen: () => onOpenItem(item), onInstall: () => {}, installed: false, action: { label: 'Uninstall', kind: 'danger', onClick: () => onUninstall(item, () => uninstall('agent', item.id)) } })),
            agentItemsF.filter((i) => filt(i.name)).length === 0 && React.createElement(Empty, { text: 'No agents match your search.' })
          )
        )
      ),
      // ── UPDATES ──
      section === 'updates' && React.createElement('div', {},
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, 'Updates'),
        React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '16px' } }, 'New versions are available for the things you installed.'),
        currentUpdates.length === 0
          ? React.createElement(Empty, { text: 'Everything is up to date.' })
          : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
              currentUpdates.filter((u) => filt(u.name)).map((u) => {
                const upItem = findCatalogItem(u.id)
                const item: CatalogItem = upItem || {
                  id: u.id, name: u.name, icon: Sparkles, color: '#d29922',
                  description: 'Update available: v' + u.from + ' to v' + u.to,
                  longDescription: '', author: '', authorBio: '', version: u.to, size: '0.1 MB', downloads: 0,
                  category: 'tab', tags: [], panel: '', kind: 'stub',
                }
                return React.createElement(StoreCard, {
                  key: u.id, item, onOpen: () => onOpenItem(item), onInstall: () => {}, installed: false,
                  action: { label: 'Update', onClick: () => onUpdateItem(item, () => setUpdates(currentUpdates.filter((x) => x.id !== u.id))) },
                })
              })
            )
      ),
      // ── UPLOADS ──
      section === 'uploads' && React.createElement('div', {},
        React.createElement(PublishPanel, { call })
      ),
      // ── FOLLOWING ──
      section === 'following' && React.createElement('div', {},
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, 'Following'),
        React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '16px' } }, 'Developers you follow. Open their profile to see everything they create.'),
        following.length === 0
          ? React.createElement(Empty, { text: 'You are not following anyone yet.' })
      : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
          following.map((author) => {
            const devItems = allItemsOf(author)
            const dev = devItems[0]
            return React.createElement('div', {
              key: author,
              style: { display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '18px', cursor: 'pointer', boxShadow: '0 1px 3px rgba(20,24,40,0.06)', transition: 'none' },
              onClick: () => onOpenDeveloper(author),
              onMouseEnter: (e: any) => { e.currentTarget.style.borderColor = 'var(--mp-accent)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(157,139,217,0.25)' },
              onMouseLeave: (e: any) => { e.currentTarget.style.borderColor = 'var(--mp-border)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(20,24,40,0.06)' }
            },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
                React.createElement('div', { style: { width: '52px', height: '52px', borderRadius: '50%', backgroundColor: 'var(--mp-accent)', color: 'var(--mp-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 700, fontFamily: 'var(--font-interface)', flexShrink: 0 } }, author.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-interface)', lineHeight: 1.3 } }, author),
                  React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '3px', lineHeight: 1.4 } }, devItems.length + ' items on the market')
                ),
                React.createElement('button', {
                  onClick: (e: any) => { e.stopPropagation(); onToggleFollow(author) },
                  onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(217,107,107,0.12)' },
                  onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--mp-panel)' },
                  style: { padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-border-strong)', backgroundColor: 'var(--mp-panel)', color: 'var(--mp-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }
                }, 'Unfollow')
              ),
              React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5 } }, dev ? dev.authorBio : '')
            )
          })
        )
      ),
      // ── SETTINGS ──
      section === 'uninstalled' && React.createElement('div', {},
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, 'Uninstalled'),
        React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '16px' } }, 'Things you removed. Reinstall them anytime.'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' } },
          getUninstalledItems().map((u) => {
            const item = findCatalogItem(u.id)
            if (!item) return null
            return React.createElement(StoreCard, { key: u.id, item, onOpen: () => onOpenItem(item), onInstall: () => {}, installed: false, action: { label: 'Reinstall', onClick: () => onInstallItem(item) } })
          }),
          getUninstalledItems().length === 0 && React.createElement(Empty, { text: 'Nothing uninstalled yet.' })
        )
      ),
      section === 'repos' && React.createElement('div', {},
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, 'My Repos'),
        React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '12px' } }, 'Add external repositories as extra market sources. Each repo must expose a catalog.json with the Quinki package format.'),
        // Nota minimale (nessuna box): il limite è di GitHub, non nostro; token per-repo
        React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px', backgroundColor: 'rgba(157,139,217,0.07)', border: '1px solid rgba(157,139,217,0.35)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: '12px' } },
          React.createElement(ShieldCheck, { size: 14, style: { color: 'var(--mp-accent)', flexShrink: 0, marginTop: '1px' } }),
          React.createElement('span', { style: { color: 'var(--mp-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.5 } }, 'Repos are read through GitHub\'s API (free limit 60 req/h: GitHub\'s limit, not Quinki\'s). The built-in quinki-market repo is not affected. You can set a GitHub token per repo (key icon): your own personal access token, or one the repo provides. A token raises that repo\'s limit to 5000/h. For private repos you don\'t have access to, the free limit applies.')
        ),
        React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '12px' } },
          React.createElement('input', {
            value: repoInput,
            onChange: (e: any) => setRepoInput(e.target.value),
            placeholder: 'https://raw.githubusercontent.com/user/repo/main/catalog.json',
            style: { flex: 1, backgroundColor: 'var(--mp-bg)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', height: '36px', color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', outline: 'none' }
          }),
          React.createElement('button', {
            onClick: () => {
              const u = repoInput.trim()
              if (!u) return
              if (addMyRepo(u, u.split('/').slice(-2).join('/'))) {
                setRepoInput(''); setRepoNote('Repo added. It will appear in the market.')
                persistHomeConfig()
                if (onReposChanged) onReposChanged()
              } else { setRepoNote('Already added or invalid URL.') }
              setTimeout(() => setRepoNote(''), 4000)
            },
            style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-accent)', backgroundColor: 'transparent', color: 'var(--mp-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }
          }, 'Add')
        ),
        repoNote && React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '12px' } }, repoNote),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          React.createElement('div', { key: 'official', style: { display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' } },
            React.createElement('span', { style: { color: 'var(--mp-accent)', fontWeight: 600, fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 } }, 'OFFICIAL'),
            React.createElement('span', { style: { flex: 1, color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, 'quinki-market'),
            React.createElement('span', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, 'always active')
          ),
          getMyRepos().map((r) => React.createElement('div', { key: r.url, style: { backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              React.createElement('span', { style: { flex: 1, color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.label),
              React.createElement('span', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-code)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.url),
              React.createElement('button', {
                onClick: () => { if (tokenRepoUrl === r.url) { setTokenRepoUrl(null); setTokenInput('') } else { setTokenRepoUrl(r.url); setTokenInput(getRepoToken(r.url)) } },
                title: 'Set GitHub token for this repo',
                style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mp-accent)', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 }
              }, React.createElement(Shield, { size: 14 }), 'Token'),
              React.createElement('button', {
                onClick: () => setRepoToRemove({ url: r.url, label: r.label }),
                title: 'Remove repo',
                style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mp-danger)', display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 6px', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 }
              }, React.createElement(Trash, { size: 14 }), 'Remove')
            ),
            tokenRepoUrl === r.url && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--mp-border)' } },
              React.createElement('input', {
                value: tokenInput,
                onChange: (e: any) => setTokenInput(e.target.value),
                placeholder: 'GitHub token for this repo (optional)',
                type: 'password',
                style: { flex: 1, backgroundColor: 'var(--mp-bg)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', height: '32px', color: 'var(--mp-text)', fontSize: '12px', fontFamily: 'var(--font-interface)', outline: 'none' }
              }),
              React.createElement('button', {
                onClick: () => { setRepoToken(r.url, tokenInput.trim()); persistHomeConfig(); setRepoNote(tokenInput.trim() ? 'Token saved for ' + r.label + ' (limit 5000/h).' : 'Token removed for ' + r.label + ' (free limit 60/h).'); setTimeout(() => setRepoNote(''), 5000) },
                style: { padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-accent)', backgroundColor: 'transparent', color: 'var(--mp-accent)', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer', flexShrink: 0 }
              }, 'Save'),
              React.createElement('button', {
                onClick: () => { setRepoToken(r.url, ''); setTokenInput(''); setRepoNote('Token removed for ' + r.label + ' (free limit 60/h).'); setTimeout(() => setRepoNote(''), 5000) },
                style: { padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-border)', backgroundColor: 'transparent', color: 'var(--mp-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', cursor: 'pointer', flexShrink: 0 }
              }, 'Clear')
            )
          )),
          getMyRepos().length === 0 && React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '16px 0', textAlign: 'center' } }, 'No external repos yet. Add one above.')
        )
      ),
      section === 'settings' && React.createElement('div', {},
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '12px' } }, 'Profile'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' } },
          React.createElement('div', { style: { display: 'flex', gap: '10px' } },
            React.createElement(Field, { label: 'Name', value: profile.name, onChange: (v: string) => setProfile({ ...profile, name: v }) }),
            React.createElement(Field, { label: 'Nickname', value: profile.nickname, onChange: (v: string) => setProfile({ ...profile, nickname: v }) })
          ),
          React.createElement(Field, { label: 'Email', value: profile.email, onChange: (v: string) => setProfile({ ...profile, email: v }) }),
          React.createElement('div', {},
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, 'Bio'),
            React.createElement('textarea', {
              value: profile.bio,
              onChange: (e: any) => setProfile({ ...profile, bio: e.target.value }),
              style: { width: '100%', boxSizing: 'border-box', backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', resize: 'vertical', outline: 'none', minHeight: '64px' }
            })
          ),
        ),
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '12px' } }, 'Login'),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginBottom: '10px' } },
          React.createElement(Mail, { size: 16, style: { color: 'var(--mp-accent)' } }),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Signed in as ' + profile.email),
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginTop: '2px' } }, 'Login and sync arrive with A4.5')
          ),
          React.createElement('button', { onClick: () => setSignOutNote(true), className: 'mp-btn' }, React.createElement(LogOut, { size: 13 }), 'Sign out')
        ),
        signOutNote && React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Sign out is simulated. Accounts arrive with A4.5.'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' } },
          React.createElement('button', {
            onClick: () => setPwdNote(true),
            className: 'mp-btn'
          }, React.createElement(Lock, { size: 13 }), 'Change password'),
          pwdNote && React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, 'Password change is simulated. Accounts arrive with A4.5.')
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '12px 16px' } },
          React.createElement(Shield, { size: 16, style: { color: 'var(--mp-accent)' } }),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Two factor authentication'),
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginTop: '2px' } }, 'Extra security for your account')
          ),
          React.createElement('button', {
            onClick: () => setTwoFA(!twoFA),
            style: { width: '40px', height: '22px', borderRadius: '999px', border: 'none', cursor: 'pointer', backgroundColor: twoFA ? 'var(--mp-success)' : 'var(--mp-border-strong)', position: 'relative', transition: 'none' }
          }, React.createElement('div', { style: { position: 'absolute', top: '2px', left: twoFA ? '20px' : '2px', width: '18px', height: '18px', borderRadius: '50%', backgroundColor: 'var(--mp-bg)', transition: 'none' } }))
        )
      )
      )
    ),
    repoToRemove && React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setRepoToRemove(null), children:
      React.createElement('div', { style: { backgroundColor: 'var(--mp-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--mp-border)', padding: '24px', maxWidth: '420px', width: '90%' }, onClick: (e: any) => e.stopPropagation(), children: [
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' } }, 'Remove repo?'),
        React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.6, marginBottom: '16px' }, children: ['This removes ', React.createElement('b', { key: 'b', style: { color: 'var(--mp-text)' } }, repoToRemove.label), ' from your sources. Its items will disappear from the market.'] }),
        React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' }, children: [
          React.createElement('button', {
            onClick: () => setRepoToRemove(null),
            style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-border)', backgroundColor: 'transparent', color: 'var(--mp-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' },
            onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
            onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }
          }, 'Cancel'),
          React.createElement('button', {
            onClick: () => { removeMyRepo(repoToRemove.url); persistHomeConfig(); if (onReposChanged) onReposChanged(); setRepoToRemove(null) },
            style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-danger)', backgroundColor: 'transparent', color: 'var(--mp-danger)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' },
            onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--mp-danger)'; e.currentTarget.style.color = 'var(--mp-bg)' },
            onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--mp-danger)' }
          }, 'Remove')
        ]})
      ]})
    })
  )
}

function allItemsOf(author: string): any[] {
  return allCatalogItems().filter((i) => i.author === author)
}

function Field({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) {
  return React.createElement('div', { style: { flex: 1 } },
    React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, label),
    React.createElement('input', {
      value,
      onChange: (e: any) => onChange(e.target.value),
      style: { width: '100%', boxSizing: 'border-box', backgroundColor: 'var(--mp-panel)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', height: '36px', color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', outline: 'none' }
    })
  )
}

function Empty({ text }: { text: string }) {
  return React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '16px 0', textAlign: 'center' } }, text)
}
