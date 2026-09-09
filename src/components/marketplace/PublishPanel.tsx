// PublishPanel.tsx — A4.4 Blocco 5: PUBBLICA ciò che HAI CREATO.
// Login GitHub (persistente) → scegli un agente/skill creato da te (mai gli
// installati dal market, mai i default) → scan → fork+PR. In più: la lista
// delle cose che hai pubblicato (con Update/Remove).
import React from 'react'
import { useState, useEffect, useRef } from 'react'
import { Upload, ShieldCheck, X, Search, FolderOpen } from '../icons'
import { publishPackage, removePackage, scanPackageSafety, detectSecrets, checkPrStatus } from '../../publish'
import { startOAuthFlow, pollOAuth, getGithubToken, setGithubToken, clearGithubToken, getGithubIdentity } from '../../ghOAuth'
import { Gh } from '../settings/SettingsPanel'
import { getMarketItems } from '../../tabs'
import { findTabPackage } from '../../tabs/runtimePackages'
import { getStableCatalog } from '../../marketRemote'
import { ConfirmModal } from './ConfirmModal'

const OFFICIAL_REPO = 'Upward991/quinki-market'
const PUB_KEY = 'quinki-published'

interface PublishedItem { id: string; category: string; name: string; version: string; prUrl: string; publishedAt: number; headSha?: string; check?: string }

function loadPublished(): PublishedItem[] { try { const r = localStorage.getItem(PUB_KEY); if (r) return JSON.parse(r) } catch {} return [] }
function savePublished(list: PublishedItem[]) {
  try { localStorage.setItem(PUB_KEY, JSON.stringify(list)) } catch {}
  // Persiste su FILE (~/.quinki/published.json) — il localStorage del webview
  // viene pulito a ogni installazione, il file no.
  try { const c: any = (window as any).__sidecarCall; if (c) c('publishedSet', { list }) } catch {}
}

export function PublishPanel({ call }: { call?: (method: string, params?: any, timeout?: number) => Promise<any> }) {
  const [identity, setIdentity] = useState<any | null>(null)
  const [loginState, setLoginState] = useState<'idle' | 'waiting' | 'error'>('idle')
  const [device, setDevice] = useState<{ user_code: string; verification_uri: string } | null>(null)
  const [loginError, setLoginError] = useState('')

  const [created, setCreated] = useState<any[]>([])           // agenti/skill creati dall'utente
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pubRepo, setPubRepo] = useState(OFFICIAL_REPO)
  // Coda "Ready to publish": ogni elemento ha la SUA versione e il SUO stato
  const [pending, setPending] = useState<any[]>([])
  const [published, setPublished] = useState<PublishedItem[]>(loadPublished)
  const [pubSub, setPubSub] = useState('all')
  const [pubQuery, setPubQuery] = useState('')


  const [removing, setRemoving] = useState<Set<string>>(new Set())
  const [confirmRemove, setConfirmRemove] = useState<PublishedItem | null>(null)
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [licenseChoice, setLicenseChoice] = useState('MIT')
  const [removedItems, setRemovedItems] = useState<PublishedItem[]>([])
  // Ids degli elementi rimossi GIÀ VISTI dall'utente (avviso chiuso con X):
  // l'avviso esce solo per rimozioni NUOVE, non per quelle già notificate.
  const [removedAck, setRemovedAck] = useState<Set<string>>(() => {
    try { const r = JSON.parse(localStorage.getItem('quinki-removed-ack') || '[]'); return new Set(Array.isArray(r) ? r : []) } catch { return new Set() }
  })
  const [token, setToken] = useState('')

  // Identità persistente all'avvio (token da FILE, non dal localStorage)
  useEffect(() => {
    let cancelled = false
    getGithubToken(call).then((t) => {
      if (cancelled) return
      setToken(t)
      if (t) { getGithubIdentity(t).then((id) => { if (!cancelled) setIdentity(id) }).catch(() => {}) }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [call])
  // Carica i pubblicati dal FILE (persiste tra le installazioni).
  // Se il file è vuoto (prima installazione con questa feature), ricostruisci
  // la lista dal market: gli item con author == il tuo login sono tuoi.
  useEffect(() => {
    if (!call) return
    let cancelled = false
    call('publishedGet').then(async (r: any) => {
      if (cancelled) return
      const fileList = r?.list || []
      if (fileList.length > 0) {
        setPublished(fileList); savePublished(fileList); return
      }
      if (!identity || !token) return
      try {
        // 1) catalogo già caricato in memoria
        let items = getStableCatalog().filter((i: any) => i.author === identity.login)
        // 2) se vuoto (repo privato → raw 404), leggi il catalog via API col token
        if (items.length === 0) {
          const repo = pubRepo.trim() || OFFICIAL_REPO
          const res = await fetch('https://api.github.com/repos/' + repo + '/contents/catalog.json', { headers: { Authorization: 'Bearer ' + token } })
          if (res.ok) {
            const d = await res.json().catch(() => null)
            if (d && d.content) {
              const cat = JSON.parse(atob(d.content.replace(/\s/g, '')))
              const all = [...(cat.tabs || []), ...(cat.agents || []), ...(cat.skills || []), ...(cat.mcp || []), ...(cat.themes || [])]
              items = all.filter((i: any) => i.author === identity.login)
            }
          }
        }
        if (items.length > 0) {
          const rec = items.map((i: any) => ({ id: String(i.id).replace(/@[a-z0-9-]+$/, ''), category: i.category, name: i.name || i.id, version: i.version || '1.0.0', prUrl: '', publishedAt: Date.now(), check: 'merged' }))
          setPublished(rec); savePublished(rec)
        }
      } catch {}
    }).catch(() => {})
    return () => { cancelled = true }
  }, [call, identity?.login, token])


  // FILTRO "cosa è davvero tuo" — vale per OGNI tipo (tabs, agents, skills, mcp, themes):
  // - AGENTI: tutti quelli che NON sono default (orchestrator/app-expert/quinki),
  //   NON installati dal market (ext-* o nel registry). Gli agenti si creano SOLO
  //   nella app (New Agent) o li crea App Expert per te → sono tutti tuoi.
  // - SKILL: NON scaricate dall'esterno (quinki-external-installed) e NON default/market.
  //   Così compaiono sia le skill create da te sia quelle create da App Expert per te.
  // - MCP / TAB / THEME: SOLO quelli tracciati come creati da te (quinki-user-created).
  useEffect(() => {
    if (!call) return
    let cancelled = false
    const marketIds = new Set(getMarketItems().map((m) => m.id))
    const DEFAULT_AGENTS = new Set(['orchestrator', 'app-expert', 'quinki'])
    const DEFAULT_SKILLS = new Set(['app-expert', 'quinki-market'])
    Promise.all([
      call('listAgents').then((r: any) => (r?.agents || r || [])).catch(() => []),
      call('listSkills').then((r: any) => (r?.skills || r || [])).catch(() => []),
      call('listMcpServers').then((r: any) => (r?.servers || r || [])).catch(() => []),
    ]).then(([agents, skills, mcps]) => {
      if (cancelled) return
      let createdKeys: string[] = []
      try { createdKeys = JSON.parse(localStorage.getItem('quinki-user-created') || '[]') || [] } catch {}
      let externalKeys: string[] = []
      try { externalKeys = JSON.parse(localStorage.getItem('quinki-external-installed') || '[]') || [] } catch {}
      // MIGRAZIONE una-tantum: le skill esistenti (scaricate prima del tracking)
      // vengono marcate come esterne, così non compaiono nel publish.
      // (Se una è tua — creata da te o da App Expert — dimmelo e la sblocco.)
      try {
        if (!localStorage.getItem('quinki-external-migrated')) {
          const all = (skills || []).map((s: any) => s && s.name ? 'skill:' + s.name : '').filter(Boolean)
          for (const k of all) { if (!externalKeys.includes(k)) externalKeys.push(k) }
          localStorage.setItem('quinki-external-installed', JSON.stringify(externalKeys))
          localStorage.setItem('quinki-external-migrated', '1')
        }
      } catch {}
      const isCreated = (kind: string, id: string) => createdKeys.includes(kind + ':' + id)
      const isExternal = (kind: string, id: string) => externalKeys.includes(kind + ':' + id)
      const userAgents = (agents || []).filter((a: any) => a && a.id && !DEFAULT_AGENTS.has(a.id) && !marketIds.has(a.id) && !String(a.id).startsWith('ext-'))
        .map((a: any) => ({ id: a.id, name: a.name || a.id, category: 'agent', description: (a.systemPrompt || '').slice(0, 200) }))
      const userSkills = (skills || []).filter((s: any) => s && s.name && !DEFAULT_SKILLS.has(s.name) && !marketIds.has(s.name) && !String(s.name).startsWith('ext-') && !isExternal('skill', s.name))
        .map((s: any) => ({ id: s.name, name: s.name, category: 'skill', description: (s.description || '').slice(0, 200) }))
      const userMcps = (mcps || []).filter((m: any) => m && m.name && isCreated('mcp', m.name))
        .map((m: any) => ({ id: m.name, name: m.name, category: 'mcp', description: (m.description || m.source || '').slice(0, 200), mcp: m }))
      // Tabs e themes: SOLO tracciati come creati (per ora nessun flusso di creazione → vuoti)
      let tabs: any[] = []
      try { tabs = JSON.parse(localStorage.getItem('quinki-installed-tabs') || '[]') || [] } catch {}
      const userTabs = tabs.filter((t: any) => t && t.id && isCreated('tab', t.id))
        .map((t: any) => ({ id: t.id, name: t.label || t.id, category: 'tab', description: '' }))
      let themes: any[] = []
      try { themes = JSON.parse(localStorage.getItem('quinki-installed-themes') || '[]') || [] } catch {}
      const userThemes = themes.filter((t: any) => t && t.id && isCreated('theme', t.id))
        .map((t: any) => ({ id: t.id, name: t.name || t.id, category: 'theme', description: '' }))
      // FIX: i già pubblicati NON ricompaiono nel selettore (Update/Remove dalla sezione Published)
      const alreadyPub = new Set((loadPublished() || []).map((p: any) => p.category + ':' + p.id))
      const all = [...userTabs, ...userAgents, ...userSkills, ...userMcps, ...userThemes].filter((c: any) => c && c.id)
      ;(globalThis as any).__quinki_created_all = all  // per l'Update dei Published
      setCreated(all.filter((c: any) => !alreadyPub.has(c.category + ':' + c.id)))
    })
    return () => { cancelled = true }
  }, [call])

  // FIX P1 #6 (2026-09-08): estrae la description REALE dal contenuto dell'item.
  // agent → prima riga utile del PROMPT.md; skill → frontmatter; tab → manifest; theme → theme.json.
  function extractDescription(category: string, files: Record<string, string>): string {
    try {
      if (category === 'agent' && files['PROMPT.md']) {
        const lines = files['PROMPT.md'].split('\n').map((l: string) => l.trim()).filter(Boolean)
        for (const l of lines) {
          if (!l.startsWith('#') && !l.startsWith('---') && l.length > 10) return l.slice(0, 200)
        }
        return ''
      }
      if (category === 'skill' && files['SKILL.md']) {
        const m = files['SKILL.md'].match(/^description:\s*(.+)$/m)
        if (m) return m[1].trim().slice(0, 200)
        const lines = files['SKILL.md'].split('\n').map((l: string) => l.trim()).filter(Boolean)
        for (const l of lines) {
          if (!l.startsWith('#') && !l.startsWith('---') && !l.startsWith('name:') && l.length > 10) return l.slice(0, 200)
        }
        return ''
      }
      if (category === 'tab' && files['manifest.json']) {
        const mf = JSON.parse(files['manifest.json'])
        return (mf.description || mf.name || '').slice(0, 200)
      }
      if (category === 'theme' && files['theme.json']) {
        const th = JSON.parse(files['theme.json'])
        return (th.description || th.name || '').slice(0, 200)
      }
      if (category === 'mcp') return 'MCP server configuration'
    } catch {}
    return ''
  }

  async function gatherFiles(item: any): Promise<Record<string, string>> {
    try {
      if (item.files && typeof item.files === 'object' && Object.keys(item.files).length > 0) return item.files
      if (item.category === 'agent' && call) {
        const cfg = await call('getAgentConfig', { id: item.id }).catch(() => null) as any
        const prompt = await call('readAgentPrompt', { id: item.id }).catch(() => null) as any
        const cfgStr = (cfg?.content || (typeof cfg === 'string' ? cfg : '')) || JSON.stringify({ id: item.id, name: item.name, model: '', thinkingLevel: 'medium', mode: 'plan', tools: ['read', 'grep', 'find', 'ls', 'skill'], skills: [] }, null, 2)
        return { 'config.json': cfgStr, 'PROMPT.md': String(prompt?.content || '') }
      }
      if (item.category === 'skill' && call) {
        const r = await call('loadSkill', { name: item.id }).catch(() => null) as any
        const content = typeof r === 'string' ? r : (r?.content || r?.SKILL || '')
        return { 'SKILL.md': String(content) }
      }
      if (item.category === 'mcp' && item.mcp) {
        return { 'mcp.json': JSON.stringify(item.mcp, null, 2) }
      }
      // FIX P1: TAB e THEME ora raccolgono i loro file (prima impossibili da pubblicare)
      if (item.category === 'tab' && call) {
        const r = await call('readTabPackageFiles', { id: item.id }).catch(() => null) as any
        if (r && !r.error) {
          const files: Record<string, string> = {}
          if (r.manifest) files['manifest.json'] = typeof r.manifest === 'string' ? r.manifest : JSON.stringify(r.manifest, null, 2)
          if (r.bundle) files['bundle.js'] = String(r.bundle)
          if (r.server) files['server.js'] = String(r.server)
          return files
        }
      }
      if (item.category === 'theme' && call) {
        const r = await call('readThemeFile', { id: item.id }).catch(() => null) as any
        const content = typeof r === 'string' ? r : (r?.content || r?.theme || '')
        if (content) return { 'theme.json': String(content) }
      }

    } catch {}
    return {}
  }

  function startLogin() {
    setLoginError('')
    setLoginState('waiting')
    setDevice(null)
    startOAuthFlow(call).then(() => {
      const iv = setInterval(async () => {
        try {
          const tok = await pollOAuth(call)
          if (tok) {
            clearInterval(iv)
            setGithubToken(tok, call)
            setToken(tok)
            const id = await getGithubIdentity(tok)
            setIdentity(id)
            setLoginState('idle')
            setDevice(null)
          }
        } catch (e: any) { clearInterval(iv); setLoginState('error'); setLoginError(String(e?.message || e)) }
      }, 3000)
    }).catch((e: any) => { setLoginState('error'); setLoginError(String(e?.message || e)) })
  }

  // Seleziona gli item → entrano nella coda "Ready to publish" (versione individuale)
  function startPublishMany(items: any[]) {
    if (!items || items.length === 0) return
    setPickerOpen(false)
    setSelected(new Set())
    setPending(prev => {
      const next = [...prev]
      for (const it of items) {
        if (next.some((x) => x.id === it.id && x.category === it.category)) continue
        const existing = loadPublished().find((p) => p.id === it.id && p.category === it.category)
        next.push({ ...it, license: existing?.license || 'MIT', version: existing ? bumpVersion(existing.version) : '1.0.0', state: 'idle', result: null, error: '', warnings: [] })
      }
      return next
    })
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const pkey = (it: any) => it.category + ':' + it.id
  const sectionLabel = (c: string) => c === 'tab' ? 'Tabs' : c === 'agent' ? 'Agents' : c === 'skill' ? 'Skills' : c === 'mcp' ? 'MCP' : 'Themes'
  const updatePending = (it: any, fn: (x: any) => any) => {
    const k = pkey(it)
    setPending(prev => prev.map((x) => pkey(x) === k ? fn(x) : x))
  }
  const removePending = (it: any) => {
    const k = pkey(it)
    setPending(prev => prev.filter((x) => pkey(x) !== k))
  }

  const publishedRef = useRef(published)
  publishedRef.current = published
  const removedAckRef = useRef(removedAck)
  removedAckRef.current = removedAck

  // Controlla se qualche elemento pubblicato è stato RIMOSSO dal repo:
  // confronta la lista con il catalog attuale del repo (via API col token).
  useEffect(() => {
    if (!identity || !token) return
    let cancelled = false
    const repo = pubRepo.trim() || OFFICIAL_REPO
    const checkRemoved = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/' + repo + '/contents/catalog.json', { headers: { Authorization: 'Bearer ' + token } })
        if (!res.ok) {
          // catalog assente (404) o repo vuoto → se ci sono pubblicati, sono stati rimossi
          if (res.status === 404) {
            const mine = publishedRef.current
            if (mine.length > 0 && !cancelled) {
              const fresh = mine.filter((p) => !removedAckRef.current.has(p.category + ':' + p.id))
              setRemovedItems(fresh)
            }
            if (mine.length > 0) {
              const ids = new Set(mine.map((p) => p.category + ':' + p.id))
              const keep = publishedRef.current.filter((p) => !ids.has(p.category + ':' + p.id))
              if (keep.length !== publishedRef.current.length) {
                setPublished(keep); savePublished(keep)
              }
            }
          }
          return
        }
        const d = await res.json().catch(() => null)
        if (!d || !d.content) return
        const cat = JSON.parse(atob(d.content.replace(/\s/g, '')))
        const present = new Set([...(cat.tabs || []), ...(cat.agents || []), ...(cat.skills || []), ...(cat.mcp || []), ...(cat.themes || [])].map((i: any) => i.category + ':' + i.id))
        // FIX P2 #9 (2026-09-08): gli item pubblicati da meno di 5 MINUTI sono in
        // validazione CI (la PR impiega 2-3 minuti per il merge). NON dichiararli
        // "removed" solo perché non sono ancora nel catalog: la PR non è merged.
        const GRACE_MS = 5 * 60 * 1000
        const mine = publishedRef.current.filter((p: any) => {
          if (present.has(p.category + ':' + p.id)) return false // presente → ok
          if (p.publishedAt && (Date.now() - p.publishedAt) < GRACE_MS) return false // appena pubblicato → in CI, skip
          return true // non presente + non appena pubblicato → potenzialmente removed
        })
        if (!cancelled) {
          const fresh = mine.filter((p) => !removedAckRef.current.has(p.category + ':' + p.id))
          setRemovedItems(fresh)
        }
        // Gli item rimossi spariscono dalla lista (ma restano tracciabili
        // nell'avviso generico). Se tornano nel repo, verranno ri-aggiunti.
        if (mine.length > 0) {
          const ids = new Set(mine.map((p) => p.category + ':' + p.id))
          const keep = publishedRef.current.filter((p) => !ids.has(p.category + ':' + p.id))
          if (keep.length !== publishedRef.current.length) {
            setPublished(keep); savePublished(keep)
          }
        }
      } catch {}
    }
    checkRemoved()
    const iv = setInterval(checkRemoved, 30000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [identity, token])
  // Aggiorna la lista E la SALVA: così lo stato risolto (merged/failed) persiste
  // e alla riapertura della tab non riparte da "validating".
  const updatePublished = (fn: (prev: PublishedItem[]) => PublishedItem[]) => {
    setPublished(prev => {
      const next = fn(prev)
      savePublished(next)
      return next
    })
  }

  // Pubblica UN elemento della coda, con la SUA versione. Se fallisce → errore nella riga.
  async function doPublishOne(item: any) {
    if (!identity || item.state === 'publishing') return
    const itemKey = pkey(item)
    updatePending(item, (x) => ({ ...x, state: 'publishing', error: '', warnings: [] }))
    try {
      const files = await gatherFiles(item)
      const scan = scanPackageSafety(files)
      const secrets = detectSecrets(files)
      const warnings = [...scan.warnings, ...secrets.map((s) => 'SECRET: ' + s)]
      if (Object.keys(files).length === 0) {
        updatePending(item, (x) => ({ ...x, state: 'blocked', warnings: ['No files to publish for this item — create its content first.'] }))
        return
      }
      if (!scan.safe || secrets.length > 0) {
        updatePending(item, (x) => ({ ...x, state: 'blocked', warnings }))
        return
      }
      // FIX P1 #6: description REALE estratta dal contenuto dell'item
      const realDesc = extractDescription(item.category, files).slice(0, 200)
      const r = await publishPackage({
        token, repo: pubRepo.trim() || OFFICIAL_REPO,
        category: item.category, id: item.id,
        name: item.name, version: item.version.trim() || '1.0.0',
        author: identity.login, description: realDesc || item.description || item.name,
        icon: ({ tab: '📑', agent: '🤖', skill: '⚡', mcp: '🔌', theme: '🎨' } as any)[item.category] || '📦',
        color: ({ tab: '#d4a45a', agent: '#4ec9b0', skill: '#c586c0', mcp: '#56b6c2', theme: '#ce9178' } as any)[item.category] || '#888',
        license: 'MIT', files,
      })
      // OK → va in "Your published" con lo stato del check in attesa
      const now = Date.now()
      const list = loadPublished().filter((p) => !(p.id === item.id && p.category === item.category))
      list.push({ id: item.id, category: item.category, name: item.name, version: item.version.trim() || '1.0.0', prUrl: r.prUrl, publishedAt: now, check: 'pending', headSha: r.headSha })
      savePublished(list)
      setPublished(list)
      removePending(item)
      // Polling: aggiorna lo stato (merged / failed) quando il workflow finisce
      pollPrStatus(r.prUrl, pubRepo.trim() || OFFICIAL_REPO, r.headSha)
    } catch (e: any) {
      updatePending(item, (x) => ({ ...x, state: 'error', error: String(e?.message || e) }))
    }
  }

  async function pollPrStatus(r: any, repo: string, headSha: string) {
    for (let i = 0; i < 24; i++) {
      await sleep(10000)
      try {
        const st = await checkPrStatus(token, repo, headSha)
        if (st.status === 'success') {
          updatePublished(prev => prev.map((p) => p.prUrl === r.prUrl ? { ...p, check: 'merged' } : p))
          // FIX CACHE GRAVE: il merge invalida le cache del market — le proprie pubblicazioni
          // devono apparire SUBITO nella home del market (prima: fino a 30 minuti di stallo)
          try { Object.keys(localStorage).forEach(function(k) { if (k.indexOf('quinki-src-cache-') === 0) localStorage.removeItem(k) }) } catch {}
          return
        }
        if (st.status === 'failure') {
          updatePublished(prev => prev.map((p) => p.prUrl === r.prUrl ? { ...p, check: 'failed' } : p))
          return
        }
        // 'none' o 'pending': continua a pollare (i check partono con calma)
      } catch {}
    }
  }

  // Re-check periodico con REF (legge SEMPRE la lista più fresca):
  useEffect(() => {
    if (!identity || !token) return
    const repo = pubRepo.trim() || OFFICIAL_REPO
    const checkOne = async (p: any) => {
      try {
        let sha = p.headSha
        if (!sha) {
          const m = String(p.prUrl || '').match(/pull\/(\d+)/)
          if (m) {
            const pr = await fetch('https://api.github.com/repos/' + repo + '/pulls/' + m[1], { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json()).catch(() => null)
            sha = pr?.head?.sha || ''
          }
        }
        if (!sha) return
        const st = await checkPrStatus(token, repo, sha)
        if (st.status === 'success') {
          updatePublished(prev => prev.map((x) => x.prUrl === p.prUrl ? { ...x, check: 'merged' } : x))
          try { Object.keys(localStorage).forEach(function(k) { if (k.indexOf('quinki-src-cache-') === 0) localStorage.removeItem(k) }) } catch {}
        } else if (st.status === 'failure') {
          updatePublished(prev => prev.map((x) => x.prUrl === p.prUrl ? { ...x, check: 'failed' } : x))
        }
      } catch {}
    }
    const run = async () => {
      const pendingList = publishedRef.current.filter((p) => p.check === 'pending' || !p.check)
      for (const p of pendingList) await checkOne(p)
    }
    run()
    const iv = setInterval(run, 12000)
    return () => clearInterval(iv)
  }, [identity, token])

  async function doRemove(item: PublishedItem) {
    if (!identity || removing.has(item.id)) return
    setRemoving(prev => new Set(prev).add(item.id))
    try {
      await removePackage({ token, repo: pubRepo.trim() || OFFICIAL_REPO, category: item.category, id: item.id, name: item.name })
      savePublished(loadPublished().filter((p) => !(p.id === item.id && p.category === item.category)))
      setPublished(loadPublished())
    } catch (e: any) { alert('Remove failed: ' + String(e?.message || e)) }
    setRemoving(prev => { const n = new Set(prev); n.delete(item.id); return n })
  }

  function bumpVersion(v: string): string {
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)$/)
    if (m) return m[1] + '.' + m[2] + '.' + (parseInt(m[3]) + 1)
    return '1.1.0'
  }

  return React.createElement('div', {},
    // ── LOGIN GITHUB ──
    !identity && loginState !== 'waiting' && React.createElement('div', { style: { backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      React.createElement('div', {},
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '14px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Publish to the market'),
        React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '2px' } }, 'Log in with GitHub to publish what you created.')
      ),
      React.createElement('button', {
        onClick: startLogin,
        style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-accent)', backgroundColor: 'transparent', color: 'var(--mp-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer', flexShrink: 0 }
      }, React.createElement(Upload, { size: 14 }), 'Login with GitHub')
    ),
    loginState === 'waiting' && React.createElement('div', { style: { backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '16px' } },
      React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '6px' } }, 'Waiting for GitHub authorization…'),
      React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.5 } },
        'A browser window opened. Log in (or create your GitHub account) and click Authorize. If nothing opened, re-click Login.')
    ),
    loginState === 'error' && React.createElement('div', { style: { color: 'var(--mp-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '12px' } }, loginError),
    identity && React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '10px 14px' } },
      identity.avatar_url ? React.createElement('img', { src: identity.avatar_url, style: { width: '34px', height: '34px', borderRadius: '50%' } }) : React.createElement('div', { style: { width: '34px', height: '34px', borderRadius: '50%', backgroundColor: 'var(--mp-accent)', color: 'var(--mp-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', fontWeight: 700 } }, String(identity.login || '?')[0].toUpperCase()),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, identity.name || identity.login),
        React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, '@' + identity.login + ' · connected with GitHub')
      ),
      React.createElement('button', { onClick: () => { clearGithubToken(call); setToken(''); setIdentity(null) }, style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mp-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, 'Disconnect')
    ),

    // ── PUBBLICA: scegli cosa (solo ciò che HAI CREATO) ──
    identity && React.createElement('div', { style: { marginBottom: '20px' } },
      React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, 'Publish something you created'),
      React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Only your own agents and skills (not market installs, not app defaults).'),
      React.createElement('button', {
        onClick: () => setPickerOpen(true),
        onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--mp-accent)'; e.currentTarget.style.color = 'var(--mp-bg)' },
        onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--mp-accent)' },
        style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-accent)', backgroundColor: 'transparent', color: 'var(--mp-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }
      }, React.createElement(Upload, { size: 14 }), 'Choose what to publish')
    ),
    pickerOpen && identity && React.createElement('div', { style: { position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: () => setPickerOpen(false), children:
      React.createElement('div', { style: { backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', maxWidth: '960px', width: '95%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }, onClick: (e: any) => e.stopPropagation(), children: [
        React.createElement('div', { style: { padding: '16px', display: 'flex', alignItems: 'center' } },
          React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'What do you want to publish?'),
          React.createElement('span', { style: { flex: 1 } })
        ),
        React.createElement('div', { style: { padding: '0 16px 8px 16px' } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', paddingLeft: '10px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)' } },
            React.createElement(Search, { size: 14, style: { color: 'var(--q-text-tertiary)', flexShrink: 0 } }),
            React.createElement('div', { style: { width: '8px', flexShrink: 0 } }),
            React.createElement('input', { type: 'text', placeholder: 'Search...', value: pickerQuery, onChange: (e: any) => setPickerQuery(e.target.value), autoFocus: true, style: { flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '8px 0' } }),
            pickerQuery && React.createElement('button', { onClick: () => setPickerQuery(''), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', display: 'flex', padding: '4px' } }, React.createElement(X, { size: 14 }))
          )
        ),
        React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '0 16px' } },
          created.length === 0
            ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '16px 0', textAlign: 'center' } }, 'Nothing created yet. Create an agent or skill in the Agents tab first.')
            : (() => {
                const q = pickerQuery.trim().toLowerCase()
                const match = (i: any) => !q || i.name.toLowerCase().includes(q) || (i.description || '').toLowerCase().includes(q)
                const tabs = created.filter((i: any) => i.category === 'tab' && match(i))
                const agents = created.filter((i: any) => i.category === 'agent' && match(i))
                const skills = created.filter((i: any) => i.category === 'skill' && match(i))
                const mcps = created.filter((i: any) => i.category === 'mcp' && match(i))
                const themes = created.filter((i: any) => i.category === 'theme' && match(i))
                const keyOf = (item: any) => item.category + ':' + item.id
                const toggle = (item: any) => {
                  const k = keyOf(item)
                  const next = new Set(selected)
                  if (next.has(k)) next.delete(k); else next.add(k)
                  setSelected(next)
                }
                const iconOf = (item: any) => item.category === 'tab' ? '📑' : item.category === 'agent' ? '🤖' : item.category === 'skill' ? '⚡' : item.category === 'mcp' ? '🔌' : '🎨'
                const row = (item: any) => {
                  const k = keyOf(item)
                  const isSel = selected.has(k)
                  return React.createElement('div', { key: k, onClick: () => toggle(item), style: { padding: '8px 4px', display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }, children: [
                    React.createElement('span', { style: { fontSize: '16px', marginTop: '1px', flexShrink: 0 } }, iconOf(item)),
                    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                      React.createElement('div', { style: { color: 'var(--q-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, item.name),
                      React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '3px', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, item.description || '')
                    ),
                    React.createElement('input', { type: 'checkbox', onClick: (e: any) => e.stopPropagation(), checked: isSel, onChange: () => toggle(item), style: { accentColor: 'var(--q-tab-accent)', flexShrink: 0, marginTop: '2px' } })
                  ]})
                }
                const section = (label: string, icon: string, items: any[]) => items.length === 0 ? null : React.createElement('div', { key: label, style: { marginTop: '14px', marginBottom: '4px' } },
                  React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-interface)', padding: '0 4px', marginBottom: '4px' } }, icon + '  ' + label + '  (' + items.length + ')'),
                  items.map(row)
                )
                const empty = tabs.length === 0 && agents.length === 0 && skills.length === 0 && mcps.length === 0 && themes.length === 0
                return empty
                  ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '16px 0', textAlign: 'center' } }, 'No results for "' + pickerQuery + '".')
                  : React.createElement(React.Fragment, null, section('Tabs', '📑', tabs), section('Agents', '🤖', agents), section('Skills', '⚡', skills), section('MCP', '🔌', mcps), section('Themes', '🎨', themes))
              })()
        ),
        React.createElement('div', { style: { padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '8px' } },
          React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', flex: 1 } }, selected.size + ' selected'),
          React.createElement('button', { onClick: () => setPickerOpen(false), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Cancel'),
          React.createElement('button', { onClick: () => startPublishMany(created.filter((i: any) => selected.has(i.category + ':' + i.id))), disabled: selected.size === 0, onMouseEnter: (e: any) => { if (selected.size > 0) { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' } }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-tab-accent)' }, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (selected.size === 0 ? 'var(--q-border)' : 'var(--q-tab-accent)'), backgroundColor: 'transparent', color: selected.size === 0 ? 'var(--q-text-tertiary)' : 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: selected.size === 0 ? 'default' : 'pointer' } }, React.createElement(Upload, { size: 14 }), 'Publish selected (' + selected.size + ')')
        )
      ]})
    }),
    // ── CODA "READY TO PUBLISH" ──
    pending.length > 0 && identity && React.createElement('div', { style: { backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '20px' } },
      React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '4px' } }, 'Ready to publish'),
      React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Each item is published separately with its own version.'),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', padding: '10px 12px', marginBottom: '8px', backgroundColor: 'var(--mp-bg)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-md)' } },
React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', flex: 1, minWidth: '220px' } },
          React.createElement('input', { type: 'checkbox', onClick: (e: any) => e.stopPropagation(), checked: rightsConfirmed, onChange: (e: any) => setRightsConfirmed(e.target.checked), style: { accentColor: 'var(--q-tab-accent)', width: '15px', height: '15px', flexShrink: 0 } }),
          React.createElement('span', { style: { color: 'var(--mp-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.4 } }, 'I confirm I am the creator and owner of all content in this queue, take full responsibility for it, and agree to publish it under the MIT license.')
        )
      ),
      (() => {
        const order = ['tab', 'agent', 'skill', 'mcp', 'theme']
        const labels: Record<string, string> = { tab: 'Tabs', agent: 'Agents', skill: 'Skills', mcp: 'MCP', theme: 'Themes' }
        const icons: Record<string, string> = { tab: '📑', agent: '🤖', skill: '⚡', mcp: '🔌', theme: '🎨' }
        const rows = (items: any[]) => items.map((item: any) => React.createElement('div', { key: item.category + ':' + item.id, style: { display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '8px 0' }, children: [
          React.createElement('span', { style: { fontSize: '16px', marginTop: '1px', flexShrink: 0 } }, icons[item.category] || '📦'),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, item.name),
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginTop: '2px' } }, item.category + ' · ' + item.id),
            item.state === 'blocked' && React.createElement('div', { style: { color: 'var(--mp-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '6px' }, children: ['Safety scan blocked this package:', ...(item.warnings || []).map((w: string) => React.createElement('div', { key: w }, '• ' + w))] }),
            item.state === 'error' && item.error && React.createElement('div', { style: { color: 'var(--mp-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '6px' } }, 'Failed: ' + item.error)
          ),
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
            React.createElement('label', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', flexShrink: 0 } }, 'v'),
            React.createElement('input', { value: item.version, onChange: (e: any) => setPending(prev => prev.map((x) => pkey(x) === pkey(item) ? { ...x, version: e.target.value } : x)), disabled: item.state === 'publishing', style: { width: '80px', backgroundColor: 'var(--mp-bg)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '0 10px', height: '32px', color: 'var(--mp-text)', fontSize: '12px', fontFamily: 'var(--font-interface)', outline: 'none' } }),
            React.createElement('button', { onClick: () => doPublishOne(item), disabled: item.state === 'publishing' || !rightsConfirmed, onMouseEnter: (e: any) => { if (item.state !== 'publishing' && rightsConfirmed) { e.currentTarget.style.backgroundColor = 'var(--mp-accent)'; e.currentTarget.style.color = 'var(--mp-bg)' } }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--mp-accent)' }, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-accent)', backgroundColor: 'transparent', color: 'var(--mp-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, item.state === 'publishing' ? 'Publishing…' : React.createElement(React.Fragment, null, React.createElement(Upload, { size: 14 }), item.state === 'blocked' || item.state === 'error' ? 'Retry' : 'Publish')),
            React.createElement('button', { onClick: () => setPending(prev => prev.filter((x) => pkey(x) !== pkey(item))), disabled: item.state === 'publishing', style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mp-text-tertiary)', display: 'flex', padding: '4px' } }, React.createElement(X, { size: 16 }))
          )
        ]}))
        return order.map((cat) => {
          const items = pending.filter((x) => x.category === cat)
          if (items.length === 0) return null
          return React.createElement('div', { key: cat, style: { marginTop: '10px' } },
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-interface)', padding: '0 4px', marginBottom: '2px' } }, icons[cat] + '  ' + sectionLabel(cat) + '  (' + items.length + ')'),
            rows(items)
          )
        })
      })()
    ),

    // ── LISTA PUBBLICATI ──
    removedItems.length > 0 && identity && React.createElement('div', { style: { marginBottom: '12px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px', backgroundColor: 'rgba(210,153,34,0.08)', border: '1px solid rgba(210,153,34,0.35)', borderRadius: 'var(--radius-md)', padding: '10px 14px' } },
        React.createElement(ShieldCheck, { size: 15, style: { color: 'var(--mp-warning)', flexShrink: 0, marginTop: '1px' } }),
        React.createElement('span', { style: { color: 'var(--mp-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, flex: 1 } },
          React.createElement('b', { style: { color: 'var(--mp-warning)', fontWeight: 600 } }, 'Removed from repo'),
          ': one or more of your published items are no longer in the market repo. Check the repo to see why.'
        ),
        React.createElement('button', { onClick: () => { const ids = removedItems.map((p) => p.category + ':' + p.id); setRemovedAck(prev => { const n = new Set(prev); for (const i of ids) n.add(i); try { localStorage.setItem('quinki-removed-ack', JSON.stringify([...n])) } catch {} return n }); setRemovedItems([]) }, title: 'Dismiss', style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mp-text-tertiary)', display: 'flex', padding: '4px', flexShrink: 0 } }, React.createElement(X, { size: 15 }))
      )
    ),
    identity && React.createElement('div', { style: { marginTop: '24px' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, 'Your published packages'),
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement('button', { onClick: () => { if (call) call('openExternal', { url: 'https://github.com/' + (pubRepo.trim() || OFFICIAL_REPO) }) }, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-border)', backgroundColor: 'transparent', color: 'var(--mp-text-secondary)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, React.createElement(FolderOpen, { size: 14 }), 'Open market repo'),
      ),
      React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '10px' } }, 'Manage what you published on the market: update to a new version or remove it.'),
      // sub-tab come la Home/Installed: All · Tabs · Agents · Skills · MCP · Themes
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' } },
        (([['all', 'All'], ['tab', 'Tabs'], ['agent', 'Agents'], ['skill', 'Skills'], ['mcp', 'MCP'], ['theme', 'Themes']] as [string, string][]).map(([k, label]) => {
          const cnt = k === 'all' ? published.length : published.filter((p) => p.category === k).length
          const active = pubSub === k
          return React.createElement('button', { key: k, onClick: () => setPubSub(k), onMouseEnter: (e: any) => { if (!active) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { if (!active) e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: active ? '1px solid var(--mp-accent)' : '1px solid var(--mp-border-strong)', backgroundColor: active ? 'var(--mp-accent)' : 'transparent', color: active ? 'var(--mp-bg)' : 'var(--mp-text)', fontSize: '12px', fontWeight: active ? 600 : 400, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, label + ' · ' + cnt)
        })),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '10px', paddingRight: '6px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', marginLeft: 'auto', width: '220px', flexShrink: 0 } },
          React.createElement(Search, { size: 14, style: { color: 'var(--q-text-tertiary)', flexShrink: 0 } }),
          React.createElement('input', { type: 'text', placeholder: 'Search published...', value: pubQuery, onChange: (e: any) => setPubQuery(e.target.value), style: { flex: 1, minWidth: 0, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '7px 0' } }),
          pubQuery && React.createElement('button', { onClick: () => setPubQuery(''), style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', display: 'flex', padding: '2px' } }, React.createElement(X, { size: 13 }))
        )
      ),
      (() => {
        const q = pubQuery.trim().toLowerCase()
        const list = published.filter((p) => (pubSub === 'all' || p.category === pubSub) && (!q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)))
        if (list.length === 0) return React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '12px 0' } }, 'Nothing published yet.')
        const order = ['tab', 'agent', 'skill', 'mcp', 'theme']
        const labels: Record<string, string> = { tab: 'Tabs', agent: 'Agents', skill: 'Skills', mcp: 'MCP', theme: 'Themes' }
        const icons: Record<string, string> = { tab: '📑', agent: '🤖', skill: '⚡', mcp: '🔌', theme: '🎨' }
        const row = (p: any) => React.createElement('div', { key: p.category + '-' + p.id, style: { display: 'flex', alignItems: 'center', gap: '10px', backgroundColor: 'var(--mp-elevated)', border: '1px solid var(--mp-border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', marginBottom: '8px' } },
          React.createElement('span', { style: { fontSize: '16px' } }, icons[p.category] || '📦'),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              React.createElement('span', { style: { color: 'var(--mp-text)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, p.name + ' · v' + p.version),
              React.createElement('span', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, labels[p.category] || p.category)
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
              p.prUrl && React.createElement('a', { href: p.prUrl, target: '_blank', rel: 'noreferrer', style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', textDecoration: 'none' } }, 'PR: ' + p.prUrl),
              React.createElement('span', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)' } }, new Date(p.publishedAt || Date.now()).toLocaleDateString())
            )
          ),
          p.check === 'merged' && React.createElement('span', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--mp-success)', fontFamily: 'var(--font-interface)', flexShrink: 0 } }, '✓ merged'),
          p.check === 'failed' && React.createElement('span', { style: { fontSize: '12px', fontWeight: 600, color: 'var(--mp-danger)', fontFamily: 'var(--font-interface)', flexShrink: 0 } }, '✕ failed'),
          p.check === 'pending' && React.createElement('span', { style: { fontSize: '12px', fontWeight: 700, color: 'var(--mp-text)', fontFamily: 'var(--font-interface)', flexShrink: 0, letterSpacing: '0.3px' } }, '… validating'),
          React.createElement('button', { onClick: () => { const item = ((globalThis as any).__quinki_created_all || created).find((c) => c.id === p.id && c.category === p.category); if (item) startPublishMany([item]); }, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--mp-accent)'; e.currentTarget.style.color = 'var(--mp-bg)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--mp-accent)' }, style: { padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-accent)', backgroundColor: 'transparent', color: 'var(--mp-accent)', fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer', flexShrink: 0 } }, 'Update'),
          React.createElement('button', { onClick: () => setConfirmRemove(p), disabled: removing.has(p.id), onMouseEnter: (e: any) => { if (!removing.has(p.id)) { e.currentTarget.style.backgroundColor = 'var(--mp-danger)'; e.currentTarget.style.color = 'var(--mp-bg)' } }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--mp-danger)' }, style: { padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-danger)', backgroundColor: 'transparent', color: 'var(--mp-danger)', fontSize: '12px', fontFamily: 'var(--font-interface)', cursor: 'pointer', flexShrink: 0 } }, removing.has(p.id) ? 'Removing…' : 'Remove')
        )
        if (pubSub !== 'all') return list.map(row)
        return order.map((cat) => {
          const items = list.filter((p) => p.category === cat)
          if (items.length === 0) return null
          return React.createElement('div', { key: cat, style: { marginTop: '10px' } },
            React.createElement('div', { style: { color: 'var(--mp-text-tertiary)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', fontFamily: 'var(--font-interface)', padding: '0 4px', marginBottom: '4px' } }, icons[cat] + '  ' + labels[cat] + '  (' + items.length + ')'),
            items.map(row)
          )
        })
      })()
    ),
    confirmRemove && React.createElement(ConfirmModal, {
      title: 'Remove ' + confirmRemove.name + '?',
      message: 'This will open a Pull Request that removes the package from the market. It takes effect after the validation workflow merges it.',
      confirmLabel: 'Remove', danger: true, busyLabel: 'Removing…',
      onCancel: () => setConfirmRemove(null),
      onConfirm: () => { const it = confirmRemove; setConfirmRemove(null); doRemove(it) }
    })
  )
}
