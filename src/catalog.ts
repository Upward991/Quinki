// catalog.ts — A4.2: catalogo locale del Marketplace (per test).
// In A4.4 il catalogo arriverà online (stessa forma: JSON). Il Marketplace è
// pensato come un sito: home (trending / più scaricati / consigliati), pagine
// di dettaglio con specifiche e profili degli sviluppatori. Tutto è simulato
// graficamente ora, per vedere l'intero flusso prima del catalogo online.
import { FileText, Bookmark, Clock, Checklist, Activity, Pulse, Sparkles, Brain, Terminal, Calendar, Palette, Plug, Shield, Cpu, Network, Wrench, MessageSquare, Search } from './components/icons'

export interface CatalogItem {
  id: string          // id catalogo
  name: string
  icon: any
  color: string
  description: string
  longDescription: string
  author: string
  authorBio: string
  version: string
  size: string
  downloads: number
  trending?: boolean
  hasUpdate?: boolean
  category: string    // 'tab' | 'skill' | 'agent' | 'mcp' | 'theme'
  tags: string[]
  panel: string       // id del pannello che apre in App (per le tab)
  kind: 'real' | 'stub' // A4.2: real = pannello integrato; stub = arriva con A4.3
  remoteDownloadUrl?: string // A4.4: URL di download dal market online
  remoteSource?: string      // A4.4: sorgente (es. 'quinki-market')
  remoteRating?: number      // A4.4: rating dal market online
  remoteSkillPath?: string   // A4.4: path del SKILL.md nel repo (adattatore repo esterni)
  remoteRepoRawBase?: string // A4.4: base raw del repo (https://raw.githubusercontent.com/owner/repo/branch)
}

const Q = { bio: 'The team behind Quinki, the agent app that ships itself.' }
const QL = { bio: 'Experimental projects from the Quinki team. Some are demos for upcoming features.' }
const COM = { bio: 'Community developer. Builds tools for agents and creative workflows.' }

const tabsCatalog: CatalogItem[] = [
  {
    id: 'knowledge', name: 'Knowledge', icon: Sparkles, color: '#8b7fd4',
    description: 'Your knowledge base, searchable with AI', author: 'Quinki', authorBio: Q.bio, version: '1.0.0', size: '0.3 MB', downloads: 6100, trending: true, category: 'tab',
    tags: ['knowledge', 'notes', 'ai'], panel: 'knowledge', kind: 'real',
    longDescription: 'A real installed tab that runs through the A4.3 runtime. Keep your notes in a knowledge base and ask the AI to summarize them.',
  },
  {
    id: 'notes', name: 'Notes', icon: FileText, color: 'var(--q-accent-primary)',
    description: 'Quick notes saved locally', author: 'Quinki', authorBio: Q.bio, version: '1.0.0', size: '0.4 MB', downloads: 2140, trending: true, category: 'tab',
    tags: ['notes', 'local', 'utility'], panel: 'notes', kind: 'real',
    longDescription: 'A simple text area that saves your notes locally on your device. Nothing leaves the app. Perfect for quick thoughts, lists and drafts.',
  },
  {
    id: 'quicklinks', name: 'Quick Links', icon: Bookmark, color: '#7aa2f7',
    description: 'Your links in one place', author: 'Quinki', authorBio: Q.bio, version: '1.0.0', size: '0.5 MB', downloads: 1832, trending: true, category: 'tab',
    tags: ['links', 'bookmarks', 'utility'], panel: 'quicklinks', kind: 'real',
    longDescription: 'Keep your favorite links grouped in one tab. Add a title and a URL, then open them with a click. Stored locally on your device.',
  },
  {
    id: 'pomodoro', name: 'Pomodoro', icon: Clock, color: '#d29922',
    description: 'Focus timer (25 min)', author: 'Quinki', authorBio: Q.bio, version: '1.2.0', hasUpdate: true, size: '0.6 MB', downloads: 3375, category: 'tab',
    tags: ['focus', 'timer', 'productivity'], panel: 'pomodoro', kind: 'real',
    longDescription: 'A classic focus timer. Work for 25 minutes, take a break, repeat. Start, pause and reset right from the tab.',
  },
]

const skillsCatalog: CatalogItem[] = [
  {
    id: 'skill-research', name: 'Web Research', icon: Search, color: '#7aa2f7',
    description: 'Deep research with citations', author: 'Quinki Labs', authorBio: QL.bio, version: '1.0.0', size: '0.2 MB', downloads: 5310, trending: true, category: 'skill',
    tags: ['research', 'web'], panel: 'stub-skill-research', kind: 'stub',
    longDescription: 'A skill that teaches agents to research the web step by step and always come back with sources and citations.',
  },
  {
    id: 'skill-data', name: 'Data Analysis', icon: Activity, color: '#6bc46d',
    description: 'Analyze data with code', author: 'Quinki Labs', authorBio: QL.bio, version: '0.9.0', size: '0.3 MB', downloads: 4200, category: 'skill',
    tags: ['data', 'analysis'], panel: 'stub-skill-data', kind: 'stub',
    longDescription: 'A skill that guides agents through cleaning, exploring and visualizing datasets, with code in every step.',
  },
]

const agentsCatalog: CatalogItem[] = [
  {
    id: 'agent-finance', name: 'Finance Agent', icon: Activity, color: '#6bc46d',
    description: 'Budget and portfolio assistant', author: 'Quinki Labs', authorBio: QL.bio, version: '1.0.0', size: '0.8 MB', downloads: 6400, trending: true, category: 'agent',
    tags: ['finance', 'assistant'], panel: 'stub-agent-finance', kind: 'stub',
    longDescription: 'A specialized agent that tracks budgets, analyzes expenses and keeps an eye on your portfolio.',
  },
  {
    id: 'agent-dev', name: 'Dev Agent', icon: Terminal, color: '#9d8bd9',
    description: 'Coding companion', author: 'Quinki Labs', authorBio: QL.bio, version: '1.1.0', size: '1.2 MB', downloads: 8900, category: 'agent',
    tags: ['developer', 'code'], panel: 'stub-agent-dev', kind: 'stub',
    longDescription: 'A specialized agent tuned for coding: refactors, debugging, tests and pull requests.',
  },
]

const mcpCatalog: CatalogItem[] = [
  {
    id: 'mcp-github', name: 'GitHub MCP', icon: Network, color: '#9d8bd9',
    description: 'Repos, issues and PRs', author: 'Quinki Labs', authorBio: QL.bio, version: '2.1.0', size: '0.4 MB', downloads: 7200, trending: true, category: 'mcp',
    tags: ['github', 'git'], panel: 'stub-mcp-github', kind: 'stub',
    longDescription: 'Connect agents to GitHub: list issues, open PRs, review diffs and manage repositories.',
  },
  {
    id: 'mcp-notion', name: 'Notion MCP', icon: FileText, color: '#585860',
    description: 'Pages, databases, search', author: 'Quinki Labs', authorBio: QL.bio, version: '1.8.0', size: '0.4 MB', downloads: 6100, category: 'mcp',
    tags: ['notion', 'docs'], panel: 'stub-mcp-notion', kind: 'stub',
    longDescription: 'Let agents read and write Notion pages, query databases and keep your workspace in sync.',
  },
]

const themesCatalog: CatalogItem[] = [
  {
    id: 'theme-midnight-blue', name: 'Midnight Blue', icon: Palette, color: '#7aa2f7',
    description: 'Deep blue dark theme', author: 'Community', authorBio: COM.bio, version: '1.0.0', size: '0.1 MB', downloads: 8900, trending: true, category: 'theme',
    tags: ['theme', 'dark'], panel: 'stub-theme-midnight', kind: 'stub',
    longDescription: 'A calm dark theme with deep blue surfaces and a soft focus accent.',
  },
  {
    id: 'theme-sunset', name: 'Sunset', icon: Palette, color: '#d9a066',
    description: 'Warm orange dark theme', author: 'Community', authorBio: COM.bio, version: '0.9.0', size: '0.1 MB', downloads: 6600, category: 'theme',
    tags: ['theme', 'warm'], panel: 'stub-theme-sunset', kind: 'stub',
    longDescription: 'Warm oranges and ambers with a cozy feel for long working sessions.',
  },
]

// Sezioni del Marketplace: le tab sono il CORE; tutto il resto è simulato per ora.
export interface CatalogSection {
  key: string
  label: string
  items: CatalogItem[]
}

export const catalogSections: CatalogSection[] = [
  { key: 'tabs', label: 'Tabs', items: tabsCatalog },
  { key: 'agents', label: 'Agents', items: agentsCatalog },
  { key: 'skills', label: 'Skills', items: skillsCatalog },
  { key: 'mcp', label: 'MCP', items: mcpCatalog },
  { key: 'themes', label: 'Themes', items: themesCatalog },
]

export function allCatalogItems(): CatalogItem[] {
  return catalogSections.flatMap((s) => s.items)
}

export function findCatalogItem(id: string): CatalogItem | undefined {
  return allCatalogItems().find((t) => t.id === id)
}

export function findCatalogItemByPanel(panel: string): CatalogItem | undefined {
  return allCatalogItems().find((t) => t.panel === panel)
}

// Icona da riassegnare quando la tab installata viene ricaricata da localStorage
export function resolveCatalogIcon(id: string): any {
  const found = findCatalogItem(id)
  if (found) return found.icon
  return Shield
}
