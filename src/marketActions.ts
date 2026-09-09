// marketActions.ts — A4.4: logica di INSTALL condivisa.
// Usata sia dalla UI del Market (MarketplaceView) sia dal TOOL `market` degli agenti
// (skill quinki-market): installa un item del catalogo nel modo giusto per categoria.
import { installMarketItem, removeUninstalledItem, installCatalogTab } from './tabs'
import { findTabPackage } from './tabs/runtimePackages'
import { findPackageBundle } from './catalogPackages'
import { recordInstall, hashContent } from './registry'
import { fetchSkillResolved } from './marketRemote'
import type { CatalogItem } from './catalog'

export type MarketCall = (method: string, params?: any, timeout?: number) => Promise<any>

// Installa un item del market. `call` = RPC verso il sidecar (installPackage/installTabPackage/addMcpServer).
export async function installMarketPackage(item: CatalogItem, call: MarketCall, refreshAgents?: () => void, withConfig = true): Promise<void> {
  installMarketItem(item.id, item.category)
  removeUninstalledItem(item.id, item.category)
  const src = item.remoteSource || 'quinki-market'
  if (item.category === 'tab') {
    installCatalogTab(item.id)
    const pkg = findTabPackage(item.id)
    if (pkg && call) call('installTabPackage', { id: item.id, manifest: pkg.manifest, bundle: pkg.code, server: pkg.server }).catch(() => {})
    if (pkg) hashContent(JSON.stringify({ m: pkg.manifest, c: pkg.code, s: pkg.server })).then((h) => recordInstall({ id: item.id, category: 'tab', source: src, author: item.author, version: item.version || '1.0.0', hash: h })).catch(() => {})
  } else if ((item as any).remoteSkillPath && (item as any).remoteRepoRawBase) {
    // Skill da un repo GitHub esterno: scarica il SKILL.md (risolvendo gli shim) e installa
    try {
      const r = await fetchSkillResolved((item as any).remoteRepoRawBase, (item as any).remoteSkillPath)
      const md = r?.content || ''
      if (call && md) {
        await call('installPackage', { category: 'skill', id: item.id, manifest: { id: item.id, name: item.name, version: item.version || '1.0.0', author: item.author, category: 'skill' }, files: { 'SKILL.md': md } })
        hashContent(md).then((h) => recordInstall({ id: item.id, category: 'skill', source: src, author: item.author, version: item.version || '1.0.0', hash: h })).catch(() => {})
      }
    } catch {}
    if (refreshAgents) refreshAgents()
  } else if ((item as any).remoteAgentPath && (item as any).remoteRepoRawBase) {
    // Agente da un repo esterno: scarica il .md e crea l'agente
    try {
      const r = await fetchSkillResolved((item as any).remoteRepoRawBase, (item as any).remoteAgentPath)
      const md = r?.content || ''
      if (call && md) {
        let nm = item.name
        const fm = md.match(/^---\n([\s\S]*?)\n---/)
        if (fm) {
          const dm = fm[1].match(/^name\s*:\s*["']?(.+?)["']?\s*$/m)
          if (dm) nm = dm[1].trim()
        }
        const config = JSON.stringify({ id: item.id, name: nm, model: '', thinkingLevel: 'medium', mode: 'plan', tools: ['read', 'grep', 'find', 'ls', 'skill'], skills: [] }, null, 2)
        await call('installPackage', { category: 'agent', id: item.id, manifest: { id: item.id, name: nm, version: item.version || '1.0.0', author: item.author, category: 'agent' }, files: { 'config.json': config, 'PROMPT.md': md } })
        hashContent(md).then((h) => recordInstall({ id: item.id, category: 'agent', source: src, author: item.author, version: item.version || '1.0.0', hash: h })).catch(() => {})
      }
    } catch {}
    if (refreshAgents) refreshAgents()
  } else if ((item as any).remoteMcpPath && (item as any).remoteRepoRawBase) {
    // MCP da un repo esterno: scarica il mcp.json e registra i server
    try {
      const res = await fetch((item as any).remoteRepoRawBase + '/' + (item as any).remoteMcpPath)
      const txt = await res.text()
      let cfg: any = null
      try { cfg = JSON.parse(txt) } catch {}
      if (call && cfg) {
        const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : { [item.name]: cfg }
        const serverEntries = Object.entries(servers)
        const nativeIds: string[] = []
        for (const [sname, scfg] of Object.entries(servers)) {
          const s = scfg as any
          const sid = (item.id + '-' + sname).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 64)
          nativeIds.push(sid)
          const sname2 = serverEntries.length > 1 ? item.name + ' (' + sname + ')' : item.name
          if (typeof s === 'string') call('addMcpServer', { id: sid, name: sname2, type: 'url', source: s }).catch(() => {})
          else if (s && s.url) call('addMcpServer', { id: sid, name: sname2, type: 'url', source: s.url }).catch(() => {})
          else if (s && s.command) call('addMcpServer', { id: sid, name: sname2, type: 'command', command: Array.isArray(s.command) ? s.command : String(s.command), args: s.args || [], env: s.env || {} }).catch(() => {})
        }
        try {
          const map = JSON.parse(localStorage.getItem('quinki-mcp-mapping') || '{}') || {}
          map[item.id] = nativeIds
          localStorage.setItem('quinki-mcp-mapping', JSON.stringify(map))
        } catch {}
        hashContent(txt).then((h) => recordInstall({ id: item.id, category: 'mcp', source: src, author: item.author, version: item.version || '1.0.0', hash: h })).catch(() => {})
      }
    } catch {}
  } else {
    // Pacchetti nativi (skill/agent/mcp/theme dal bundle locale)
    const bundle = findPackageBundle(item.id)
    if (bundle && call) {
      let files = bundle.files
      if (item.category === 'agent' && withConfig === false && files['config.json']) {
        try {
          const cfg = JSON.parse(files['config.json'])
          cfg.tools = []; cfg.skills = []; cfg.mcpServers = []
          files = { ...files, 'config.json': JSON.stringify(cfg) }
        } catch {}
      }
      await call('installPackage', { category: item.category, id: item.id, manifest: bundle.manifest, files })
      hashContent(JSON.stringify({ m: bundle.manifest, f: bundle.files })).then((h) => recordInstall({ id: item.id, category: item.category, source: src, author: item.author, version: item.version || '1.0.0', hash: h })).catch(() => {})
      if (item.category === 'theme') {
        try {
          const t = JSON.parse(bundle.files['theme.json'] || '{}')
          const cur = JSON.parse(localStorage.getItem('quinki-installed-themes') || '[]')
          if (!cur.some((x: any) => x.id === t.id)) { cur.push(t); localStorage.setItem('quinki-installed-themes', JSON.stringify(cur)) }
        } catch {}
      }
    }
    if ((item.category === 'agent' || item.category === 'skill') && refreshAgents) refreshAgents()
  }
}
