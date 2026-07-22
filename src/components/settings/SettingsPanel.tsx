import { useState, useRef } from 'react'
import { useSidecarContext } from '../shared/AppShell'
import { Archive, Calendar, Check, ChevronDown, ChevronRight, ChevronUp, Copy, Home, Info, Palette, Plug, Plus, Power, RefreshCw, Save, Search, Settings, Shield, Trash, X } from '../icons'
import { ProviderRow } from './ProviderRow'

interface SettingsPanelProps {
  activePanel?: string
  onSelectPanel: (panel: string) => void
  themes: { id: string; name: string }[]
  activeThemeId: string
  onThemeChange: (id: string) => void
  providers?: any[]
}

const panelClass = "bg-bg-panel rounded-lg shadow-floating p-2 min-h-header-min flex items-center"

export function SettingsPanel(props: SettingsPanelProps) {
  const { call } = useSidecarContext()
  const [providers, setProviders] = useState(props.providers || [])
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [defaultThinking, setDefaultThinking] = useState('xhigh')
  const [defaultMode, setDefaultMode] = useState('plan')
  const [openingTab, setOpeningTab] = useState('home')
  const [showUpdate, setShowUpdate] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newProviderName, setNewProviderName] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const save = () => {
    setSaving(true)
    if (call) {
      const cfg: any = {}
      for (const p of providers) {
        cfg[p.id] = { api: p.type, enabled: p.enabled, apiKey: p.apiKeyStatus === 'configured' ? 'set' : '' }
      }
      call('setProvidersConfig', { providers: cfg }).catch(() => {})
    }
    setTimeout(() => { setSaving(false); setSavedMsg('Settings saved.'); setTimeout(() => setSavedMsg(null), 5000) }, 500)
  }

  const scrollTo = (id: string) => {
    const el = document.getElementById(id)
    if (el && scrollRef.current) {
      const top = el.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top + scrollRef.current.scrollTop
      scrollRef.current.scrollTo({ top, behavior: 'smooth' })
    }
  }

  const addProvider = async () => {
    if (!newProviderName.trim() || !call) return
    try {
      let cfg = await call('getProvidersConfig', {})
      if (!cfg) cfg = { providers: {} }
      if (!cfg.providers) cfg.providers = {}
      const name = newProviderName.trim()
      const api = name.toLowerCase() === 'ollama' ? 'openai-completions' : 'openai'
      cfg.providers[name] = { api, enabled: true, apiKey: name.toLowerCase() === 'ollama' ? 'ollama' : '', baseUrl: name.toLowerCase() === 'ollama' ? 'http://localhost:11434/v1' : '' }
      await call('setProvidersConfig', cfg)
      setProviders(p => [...p, { id: name, name, type: 'openai', apiKeyStatus: 'missing', models: [], enabled: true }])
      setNewProviderName('')
    } catch (e) { console.error('Failed to add provider:', e) }
  }

  const navItems = [
    { id: 'settings-providers', icon: Plug, label: 'Providers & models' },
    { id: 'settings-defaults', icon: Settings, label: 'Global defaults' },
    { id: 'settings-compaction', icon: Archive, label: 'Compaction' },
    { id: 'settings-theme', icon: Palette, label: 'Theme' },
    { id: 'settings-versions', icon: Info, label: 'Versions' },
  ]

  const thinkingLevels = ['off', 'low', 'medium', 'high', 'xhigh']

  return (
    <div className="h-full flex">
      {/* Left nav */}
      <div className="w-[220px] shrink-0 pr-2 h-full">
        <div className="h-full bg-bg-panel rounded-lg shadow-floating p-2 overflow-y-auto">
          {navItems.map(item => (
            <NavBtn key={item.id} icon={item.icon} label={item.label} onClick={() => scrollTo(item.id)} />
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="h-full flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="mb-2 shrink-0 flex items-center">
          <div className={panelClass}>
            <IconButton icon={Home} onClick={() => props.onSelectPanel('home')} title="Home" />
          </div>
          <div className="w-2 shrink-0" />
          <div className={panelClass + " flex-1"}>
            <div className="w-2 shrink-0" />
            <Settings size={18} className="text-text-secondary shrink-0" />
            <div className="w-3 shrink-0" />
            <span className="text-text text-16 font-semibold font-interface">Settings</span>
            <div className="w-2 shrink-0" />
            <span className="flex-1" />
            {savedMsg && (
              <>
                <span className="text-accent-success text-13 font-interface">{savedMsg}</span>
                <div className="w-4 shrink-0" />
              </>
            )}
            <button onClick={() => saving ? undefined : save()} className="h-8 px-4 rounded-md border border-border cursor-pointer bg-transparent flex items-center gap-1.5 text-text-secondary text-14 font-interface shrink-0">
              <Save size={16} />Save
            </button>
            <div className="w-2 shrink-0" />
            <button onClick={save} className="h-8 px-4 rounded-md border-none cursor-pointer bg-accent-primary flex items-center gap-1.5 text-bg text-14 font-medium font-interface shrink-0" style={{ color: 'var(--q-bg)' }}>
              <Power size={16} />Save and restart
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto pt-px pr-4 pl-4" style={{ overscrollBehavior: 'contain', scrollbarGutter: 'stable' }}>
          {/* Providers */}
          <Section id="settings-providers" icon={Plug} title="Providers & models">
            {providers.map(p => (
              <ProviderRow key={p.id} name={p.id} provider={p} onDeleted={(name) => setProviders(provs => provs.filter(p => p.id !== name))} />
            ))}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                placeholder="provider name (e.g. anthropic)"
                value={newProviderName}
                onChange={(e) => setNewProviderName(e.target.value)}
                className="flex-1 h-8 bg-bg-elevated border border-border rounded-md text-text text-14 font-interface px-3 outline-none"
              />
              <button onClick={addProvider} className="h-8 px-4 rounded-md border border-border cursor-pointer bg-transparent flex items-center justify-center gap-1.5 text-text-secondary text-14 font-interface shrink-0">
                <Plus size={16} /><span>Add</span>
              </button>
            </div>
          </Section>

          {/* Global defaults */}
          <Section id="settings-defaults" icon={Settings} title="Global defaults">
            <Label>Default model for new chats</Label>
            <Description>Used when opening a new chat. Existing chats keep their model.</Description>
            <div className="h-2" />
            <Dropdown label={providers.flatMap(p => p.models.map((m: any) => ({ value: m.id, label: m.id, sublabel: p.name }))).length > 0 ? '' : 'No models configured'}
              items={providers.flatMap(p => p.models.map((m: any) => ({ value: m.id, label: m.id, sublabel: p.name })))} currentValue="" />
            <div className="h-4" />
            <Label>Default thinking</Label>
            <Description>Reasoning effort. xhigh uses the maximum supported by each model.</Description>
            <div className="h-2" />
            <div className="flex flex-wrap gap-1.5">
              {thinkingLevels.map(level => (
                <TogglePill key={level} label={level} selected={level === defaultThinking} onClick={() => setDefaultThinking(level)} />
              ))}
            </div>
            <div className="h-6" />
            <Label>Opening tab</Label>
            <Description>Which tab to show when opening Quinki.</Description>
            <div className="h-2" />
            <Dropdown label={openingTab.charAt(0).toUpperCase() + openingTab.slice(1)}
              items={[{ value: 'home', label: 'Home' }, { value: 'chat', label: 'Chat' }, { value: 'log', label: 'Log' }, { value: 'settings', label: 'Settings' }]}
              currentValue={openingTab} onChange={(v: string) => setOpeningTab(v)} />
            <div className="h-6" />
            <Label>Default mode</Label>
            <Description>Plan = explore and plan without modifying (safe). Build = executes changes. Used for new chats.</Description>
            <div className="h-2" />
            <div className="flex gap-1.5">
              <TogglePill label="Plan" selected={defaultMode === 'plan'} color="var(--q-mode-plan)" onClick={() => setDefaultMode('plan')} />
              <TogglePill label="Build" selected={defaultMode === 'build'} color="var(--q-mode-build)" onClick={() => setDefaultMode('build')} />
            </div>
            <div className="h-6" />
            <Label>Start at boot</Label>
            <Description>Open Quinki automatically at system startup/login (stays in background in the menu bar/tray).</Description>
            <div className="h-2" />
            <div className="flex items-center gap-1">
              <input type="checkbox" defaultChecked style={{ accentColor: 'var(--q-accent-primary)' }} />
              <span className="text-text text-14 font-interface">Launch at login</span>
            </div>
          </Section>

          {/* Compaction */}
          <Section id="settings-compaction" icon={Archive} title="Compaction">
            <Description>Global settings for new chats. Existing chats with custom values keep their own.</Description>
            <div className="h-2" />
            <span className="text-accent-warning text-12 font-interface">Some changes require app restart to be fully applied.</span>
            <div className="h-2" />
            <div className="flex items-center gap-1">
              <input type="checkbox" defaultChecked style={{ accentColor: 'var(--q-accent-primary)' }} />
              <span className="text-text text-14 font-interface">Auto-compaction for new chats</span>
            </div>
            <div className="h-1" />
            <span className="text-text-secondary text-13 font-interface">Fixed threshold: 80% of context window for all chats.</span>
            <div className="h-1" />
            <span className="text-text-tertiary text-11 font-interface">When the context percentage exceeds 80%, compaction starts automatically (on the next message).</span>
          </Section>

          {/* Theme */}
          <Section id="settings-theme" icon={Palette} title="Theme">
            <Label>Preset</Label>
            <Description>Choose a predefined theme. Accent colors remain unchanged.</Description>
            <div className="h-2" />
            <Dropdown label={props.themes.find(t => t.id === props.activeThemeId)?.name || 'Custom'}
              items={props.themes.map(t => ({ value: t.id, label: t.name }))}
              currentValue={props.activeThemeId} onChange={props.onThemeChange} />
            <div className="h-2" />
            <Label>Colors</Label>
            <Description>Customize the 3 structural colors of the UI. Changes are live: click "Save" above to make them permanent.</Description>
            <div className="h-2" />
            <ColorRow label="UI background" value="#08080B" />
            <ColorRow label="Floating panel" value="#0F0F13" />
            <ColorRow label="User bubble" value="#1A1A20" />
            <ColorRow label="Bubble text" value="#E8E8EC" />
            <div className="h-3" />
            <span className="text-text-tertiary text-12 font-interface">User bubble preview:</span>
            <div className="h-1" />
            <div className="inline-flex p-2.5 px-4 rounded-lg bg-bubble-user text-bubble-user-text text-14 font-interface border-none" style={{ color: 'var(--q-bubble-user-text)' }}>
              This is a test user message
            </div>
          </Section>

          {/* Versions */}
          <Section id="settings-versions" icon={Info} title="Versions">
            <VersionRow label="Quinki" value="v1.0.0" />
            <div className="h-1" />
            <VersionRow label="Pi Agent SDK" value="v0.4.2" />
            <div className="h-2" />
            <button onClick={() => setShowUpdate(true)} className="px-3 py-2 rounded-sm border border-border cursor-pointer bg-transparent text-text-secondary text-13 font-interface">
              Check for updates
            </button>
          </Section>
          <div className="h-2" />
        </div>

        {/* Search bar */}
        <div className={"mt-2 shrink-0 " + panelClass}>
          <div className="w-3 shrink-0" />
          <Search size={16} className="text-text-tertiary shrink-0" />
          <div className="w-2 shrink-0" />
          <input type="text" placeholder="Search in settings..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-text text-14 font-interface p-0 m-0" />
          <button onClick={() => setSearch('')} className="bg-none border-none p-2 text-14" style={{ cursor: search ? 'pointer' : 'default', color: search ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', opacity: search ? 1 : 0.3 }}>✕</button>
          <div className="w-2 shrink-0" />
          <span className="text-text-tertiary text-12 font-code" style={{ opacity: 0.3 }}>0/0</span>
          <div className="w-2 shrink-0" />
          <button className="bg-none border-none cursor-default p-0 flex" style={{ opacity: 0.3 }}><ChevronUp size={16} className="text-text-tertiary" /></button>
          <button className="bg-none border-none cursor-default p-0 flex" style={{ opacity: 0.3 }}><ChevronDown size={16} className="text-text-tertiary" /></button>
        </div>
      </div>

      {/* Update modal */}
      {showUpdate && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setShowUpdate(false)}>
          <div className="bg-bg-elevated rounded-xl shadow-modal q-modal-enter p-6 max-w-[400px] w-[90%]" onClick={(e) => e.stopPropagation()}>
            <div className="text-text text-15 font-semibold font-interface mb-3">Pi is up to date</div>
            <div className="text-text-secondary text-13 font-interface mb-5">Pi is already at the latest version (v0.4.2).</div>
            <div className="flex justify-end">
              <button onClick={() => setShowUpdate(false)} className="q-press px-4 py-2 rounded-lg border-none cursor-pointer bg-accent-primary text-bg text-15 font-medium font-interface" style={{ color: 'var(--q-bg)' }}>OK</button>
            </div>
          </div>
        </div>
      )}

      {/* Error modal */}
      {error && (
        <div className="fixed inset-0 z-modal bg-overlay flex items-center justify-center" onClick={() => setError(null)}>
          <div className="bg-bg-elevated rounded-lg shadow-modal q-modal-enter p-6 max-w-[500px] w-[90%]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-accent-danger text-16 font-semibold font-interface">Error</span>
            </div>
            <div className="max-h-[300px] overflow-y-auto mb-4">
              <div className="text-text-secondary text-13 font-interface whitespace-pre-wrap" style={{ lineHeight: 1.5 }}>{error}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { navigator.clipboard.writeText(error); }} className="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border cursor-pointer bg-transparent text-text-secondary text-14 font-interface"><Copy size={16} />Copy</button>
              <button onClick={() => setError(null)} className="q-press px-4 py-2 rounded-md border-none cursor-pointer bg-accent-primary text-bg text-15 font-interface" style={{ color: 'var(--q-bg)' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──

function Section({ id, icon: Icon, title, children }: { id: string; icon: React.FC<{ size?: number; className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="w-full mb-3 p-3.5 px-4.5 bg-bg-panel rounded-lg shadow-floating">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-text-secondary shrink-0" />
        <span className="text-text text-15 font-semibold font-interface">{title}</span>
      </div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-text text-14 font-interface">{children}</span>
}

function Description({ children }: { children: React.ReactNode }) {
  return <div className="text-text-tertiary text-12 font-interface mt-1">{children}</div>
}

function TogglePill({ label, selected, color, onClick }: { label: string; selected: boolean; color?: string; onClick: () => void }) {
  return (
    <div onClick={onClick} className="p-2 px-3 min-w-[60px] max-w-[80px] rounded-sm cursor-pointer flex items-center justify-center text-14 font-interface"
      style={{
        backgroundColor: selected ? (color || 'var(--q-accent-primary)') : 'transparent',
        border: `1px solid ${selected ? 'transparent' : 'var(--q-border)'}`,
        color: selected ? 'var(--q-bg)' : 'var(--q-text-secondary)',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      {label}
    </div>
  )
}

function Dropdown({ label, items, currentValue, onChange }: { label: string; items: { value: string; label: string; sublabel?: string }[]; currentValue?: string; onChange?: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const filtered = filter ? items.filter(i => i.label.toLowerCase().includes(filter.toLowerCase()) || i.sublabel?.toLowerCase().includes(filter.toLowerCase())) : items
  return (
    <div className="relative">
      <button onClick={() => { setOpen(!open); setFilter('') }} className="w-full px-2.5 py-1.5 rounded-sm border border-border cursor-pointer bg-bg-elevated flex items-center gap-1">
        <span className="flex-1 text-text text-13 font-interface overflow-hidden text-ellipsis whitespace-nowrap text-left">{label}</span>
        <ChevronDown size={12} className="text-text-tertiary shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-overlay" onClick={() => setOpen(false)} style={{ overscrollBehavior: 'contain' }} />
          <div className="absolute top-[calc(100%+4px)] left-0 right-0 z-dropdown bg-bg-elevated rounded-md border border-border shadow-floating max-h-[300px] flex flex-col" style={{ overscrollBehavior: 'contain' }}>
            {items.length > 5 && (
              <div className="flex items-center gap-2 p-2 px-3 shrink-0">
                <Search size={14} className="text-text-tertiary shrink-0" />
                <input type="text" placeholder="Search..." value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus className="flex-1 bg-transparent border-none outline-none text-text text-13 font-interface" />
                {filter && <button onClick={() => setFilter('')} className="bg-none border-none cursor-pointer text-text-tertiary text-13">✕</button>}
              </div>
            )}
            <div className="overflow-y-auto flex-1 py-1">
              {filtered.map(item => (
                <DropdownItem key={item.value} label={item.label} sublabel={item.sublabel} isSelected={item.value === currentValue} onTap={() => { onChange?.(item.value); setOpen(false) }} />
              ))}
              {filtered.length === 0 && <div className="p-3 text-text-tertiary text-13 font-interface text-center">No results</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function DropdownItem({ label, sublabel, isSelected, onTap }: { label: string; sublabel?: string; isSelected: boolean; onTap: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onTap} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="px-3 py-2 cursor-pointer flex items-center"
      style={{
        backgroundColor: hovered ? 'var(--q-hover)' : isSelected ? 'var(--q-border-soft)' : 'transparent',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      <span className="flex-1 text-text text-13 font-interface overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>
      {sublabel && <span className="text-text-tertiary text-12 shrink-0">{sublabel}</span>}
    </div>
  )
}

function ColorRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="py-1.5 flex items-center gap-2">
      <div className="w-10 h-8 rounded-sm border border-border cursor-pointer" style={{ backgroundColor: value }} />
      <span className="flex-1 text-text text-14 font-interface">{label}</span>
      <span className="text-text-tertiary text-12 font-code">{value.toUpperCase()}</span>
    </div>
  )
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-text-secondary text-14 font-interface">{label}</span>
      <span className="text-text text-14 font-code">{value}</span>
    </div>
  )
}

function NavBtn({ icon: Icon, label, onClick }: { icon: React.FC<{ size?: number; className?: string; style?: React.CSSProperties }>; label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="p-2 px-3 mb-0.5 rounded-lg cursor-pointer flex items-center gap-2"
      style={{ backgroundColor: hovered ? 'rgba(157, 139, 217, 0.10)' : 'transparent', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <Icon size={20} className="shrink-0" style={{ color: hovered ? 'var(--q-accent-primary)' : 'var(--q-text-secondary)' }} />
      <span className="text-14 font-interface overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)' }}>{label}</span>
    </div>
  )
}

function IconButton({ icon: Icon, onClick, title }: { icon: React.FC<{ size?: number; className?: string }>; onClick?: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="w-8 h-8 flex items-center justify-center rounded-md border-none cursor-pointer shrink-0 p-0"
      style={{
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'background-color 120ms, color 120ms, transform 120ms',
      }}>
      <Icon size={20} />
    </button>
  )
}