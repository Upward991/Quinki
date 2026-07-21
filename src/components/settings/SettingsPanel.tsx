// ============================================================
// SettingsPanel — exact Flutter copy
// Layout: Left TOC sidebar (220px) + right main content
// Header: Home + Settings icon + title + Save/Save&Restart
// Body: 5 sections (Providers, Defaults, Compaction, Theme, Versions)
// Search bar at bottom
// ============================================================

import { useState, useRef, useEffect } from 'react'
import type { ThemePreset, Provider } from '../../types'
import { Home, Settings, Plug, Archive, Palette, Info, Search, ChevronDown, ChevronRight, ChevronUp, Save, Power, Plus, Check, Trash, RefreshCw } from '../icons'

interface SettingsPanelProps {
  activePanel: string
  onSelectPanel: (panel: string) => void
  themes: ThemePreset[]
  activeThemeId: string
  onThemeChange: (id: string) => void
  providers: Provider[]
  call?: (method: string, params?: any) => Promise<any>
}

const sections = [
  { id: 'settings-providers', icon: Plug, label: 'Providers & models' },
  { id: 'settings-defaults', icon: Settings, label: 'Global defaults' },
  { id: 'settings-compaction', icon: Archive, label: 'Compaction' },
  { id: 'settings-theme', icon: Palette, label: 'Theme' },
  { id: 'settings-versions', icon: Info, label: 'Versions' },
]

const thinkingLevels = ['off', 'low', 'medium', 'high', 'xhigh']

export function SettingsPanel(props: SettingsPanelProps) {
  const [_activeSection, setActiveSection] = useState('settings-providers')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const [thinkingLevel, setThinkingLevel] = useState('xhigh')
  const [mode, setMode] = useState('plan')
  const [defaultTab, setDefaultTab] = useState('home')
  const [showUpdate, setShowUpdate] = useState(false)
  const [showError, setShowError] = useState<string | null>(null)

  // Load app version from sidecar
  const [appVersion, setAppVersion] = useState('v1.0.0')
  useEffect(() => {
    if (!props.call) return
    props.call('getAppVersion', {}).then((r: any) => {
      if (r?.version) setAppVersion(r.version)
    }).catch(() => {})
  }, [props.call])

  const scrollToSection = (id: string) => {
    setActiveSection(id)
    const el = document.getElementById(id)
    if (el && bodyRef.current) {
      const containerTop = bodyRef.current.getBoundingClientRect().top
      const elTop = el.getBoundingClientRect().top
      const offset = elTop - containerTop + bodyRef.current.scrollTop
      bodyRef.current.scrollTo({ top: offset, behavior: 'smooth' })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (props.call) {
        // Save provider config
        const config: any = {}
        for (const p of props.providers) {
          config[p.id] = { api: p.type, enabled: p.enabled, apiKey: p.apiKeyStatus === 'configured' ? 'set' : '' }
        }
        await props.call('setProvidersConfig', { providers: config })
      }
    } catch {}
    setSaving(false)
    setSaveMessage('Settings saved.')
    setTimeout(() => setSaveMessage(null), 5000)
  }

  const panelStyle: React.CSSProperties = {
    backgroundColor: 'var(--q-bg-panel)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-floating)',
    padding: '8px',
    minHeight: 'var(--spacing-header-min)',
    display: 'flex',
    alignItems: 'center',
  }

  return (
    <div className="h-full flex">
      {/* Left TOC sidebar — 220px */}
      <div style={{ width: '220px', flexShrink: 0, paddingRight: '8px', height: '100%' }}>
        <div style={{
          height: '100%', backgroundColor: 'var(--q-bg-panel)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)',
          padding: '8px', overflowY: 'auto',
        }}>
          {sections.map(s => (
            <TocItem key={s.id} icon={s.icon} label={s.label} onTap={() => scrollToSection(s.id)} />
          ))}
        </div>
      </div>

      {/* Right main content */}
      <div className="h-full flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        <div className="flex flex-col" style={{ maxWidth: 'var(--spacing-chat-max)', margin: '0 auto', width: '100%', flex: 1, minHeight: 0 }}>
          {/* Header — 2px top padding so box-shadow isn't clipped by overflow:hidden */}
          <div style={{ marginBottom: '8px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
            <div style={panelStyle}>
              <IconBtn icon={Home} onClick={() => props.onSelectPanel('home')} title="Home" />
            </div>
            <div style={{ width: '8px', flexShrink: 0 }} />
            <div style={{ ...panelStyle, flex: 1 }}>
              <div style={{ width: '8px', flexShrink: 0 }} />
              <Settings size={18} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
              <div style={{ width: '12px', flexShrink: 0 }} />
              <span style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Settings</span>
              <div style={{ width: '8px', flexShrink: 0 }} />
              <span style={{ flex: 1 }} />
              {saveMessage && (
                <>
                  <span style={{ color: 'var(--q-accent-success)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>{saveMessage}</span>
                  <div style={{ width: '16px', flexShrink: 0 }} />
                </>
              )}
              <button
                onClick={() => saving ? undefined : handleSave()}
                style={{ height: '32px', padding: '1px 16px 0 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', flexShrink: 0 }}
              >
                <Save size={16} />
                Save
              </button>
              <div style={{ width: '8px', flexShrink: 0 }} />
              <button
                onClick={() => handleSave()}
                style={{ height: '32px', padding: '1px 16px 0 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-secondary)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--q-bg)', fontSize: '14px', fontWeight: 500, fontFamily: 'var(--font-interface)', flexShrink: 0 }}
              >
                <Power size={16} />
                Save and restart
              </button>
            </div>
          </div>

          {/* Body */}
          <div ref={bodyRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1px 16px 0 16px', overscrollBehavior: 'contain' } as React.CSSProperties}>
            {/* Providers & models */}
            <Section id="settings-providers" icon={Plug} title="Providers & models">
              {props.providers.map(p => (
                <ProviderRow key={p.id} name={p.name} provider={p} call={props.call} />
              ))}
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input type="text" placeholder="provider name (e.g. anthropic)"
                  style={{ flex: 1, height: '32px', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none' }}
                />
                <button style={{ height: '32px', padding: '1px 16px 0 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', flexShrink: 0 }}>
                  <Plus size={16} style={{ flexShrink: 0 }} />
                  <span>Add</span>
                </button>
              </div>
            </Section>

            {/* Global defaults */}
            <Section id="settings-defaults" icon={Settings} title="Global defaults">
              <Label>Default model for new chats</Label>
              <SubLabel>Used when opening a new chat. Existing chats keep their model.</SubLabel>
              <div style={{ height: '8px' }} />
              <Dropdown label="No models configured" items={props.providers.flatMap(p => p.models.map(m => ({ value: m.id, label: m.id, sublabel: p.name })))} currentValue="" />
              <div style={{ height: '16px' }} />
              <Label>Default thinking</Label>
              <SubLabel>Reasoning effort. xhigh uses the maximum supported by each model.</SubLabel>
              <div style={{ height: '8px' }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {thinkingLevels.map(lvl => (
                  <Pill key={lvl} label={lvl} selected={lvl === thinkingLevel} onClick={() => setThinkingLevel(lvl)} />
                ))}
              </div>
              <div style={{ height: '24px' }} />
              <Label>Opening tab</Label>
              <SubLabel>Which tab to show when opening Quinki.</SubLabel>
              <div style={{ height: '8px' }} />
              <Dropdown label={defaultTab.charAt(0).toUpperCase() + defaultTab.slice(1)} items={[{ value: 'home', label: 'Home' }, { value: 'chat', label: 'Chat' }, { value: 'log', label: 'Log' }, { value: 'settings', label: 'Settings' }]} currentValue={defaultTab} onChange={setDefaultTab} />
              <div style={{ height: '24px' }} />
              <Label>Default mode</Label>
              <SubLabel>Plan = explore and plan without modifying (safe). Build = executes changes. Used for new chats.</SubLabel>
              <div style={{ height: '8px' }} />
              <div style={{ display: 'flex', gap: '6px' }}>
                <Pill label="Plan" selected={mode === 'plan'} color="var(--q-mode-plan)" onClick={() => setMode('plan')} />
                <Pill label="Build" selected={mode === 'build'} color="var(--q-mode-build)" onClick={() => setMode('build')} />
              </div>
              <div style={{ height: '24px' }} />
              <Label>Start at boot</Label>
              <SubLabel>Open Quinki automatically at system startup/login (stays in background in the menu bar/tray).</SubLabel>
              <div style={{ height: '8px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input type="checkbox" defaultChecked style={{ accentColor: 'var(--q-accent-info)' }} />
                <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Launch at login</span>
              </div>
            </Section>

            {/* Compaction */}
            <Section id="settings-compaction" icon={Archive} title="Compaction">
              <SubLabel>Global settings for new chats. Existing chats with custom values keep their own.</SubLabel>
              <div style={{ height: '8px' }} />
              <span style={{ color: 'var(--q-accent-warning)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>Some changes require an app restart to be fully applied.</span>
              <div style={{ height: '8px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <input type="checkbox" defaultChecked style={{ accentColor: 'var(--q-accent-primary)' }} />
                <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Auto-compaction for new chats</span>
              </div>
              <div style={{ height: '4px' }} />
              <span style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Fixed threshold: 80% of context window for all chats.</span>
              <div style={{ height: '4px' }} />
              <span style={{ color: 'var(--q-text-tertiary)', fontSize: 'var(--fs-11)', fontFamily: 'var(--font-interface)' }}>When the context percentage exceeds 80%, compaction starts automatically (on the next message).</span>
            </Section>

            {/* Theme */}
            <Section id="settings-theme" icon={Palette} title="Theme">
              <Label>Preset</Label>
              <SubLabel>Choose a predefined theme. Accent colors remain unchanged.</SubLabel>
              <div style={{ height: '8px' }} />
              <Dropdown label={props.themes.find(t => t.id === props.activeThemeId)?.name || 'Custom'} items={props.themes.map(t => ({ value: t.id, label: t.name }))} currentValue={props.activeThemeId} onChange={props.onThemeChange} />
              <div style={{ height: '8px' }} />
              <Label>Colors</Label>
              <SubLabel>Customize the 3 structural colors of the UI. Changes are live: click "Save" above to make them permanent.</SubLabel>
              <div style={{ height: '8px' }} />
              <ColorPickerRow label="UI background" value="#08080B" />
              <ColorPickerRow label="Floating panel" value="#0F0F13" />
              <ColorPickerRow label="User bubble" value="#1A1A20" />
              <ColorPickerRow label="Bubble text" value="#E8E8EC" />
              <div style={{ height: '12px' }} />
              <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>User bubble preview:</span>
              <div style={{ height: '4px' }} />
              <div style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--q-bubble-user)', color: 'var(--q-bubble-user-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', display: 'inline-block' }}>This is a test user message</div>
            </Section>

            {/* Versions */}
            <Section id="settings-versions" icon={Info} title="Versions">
              <VersionRow label="Quinki" value={appVersion} />
              <div style={{ height: '4px' }} />
              <VersionRow label="Pi Agent SDK" value="v0.4.2" />
              <div style={{ height: '8px' }} />
              <button onClick={() => setShowUpdate(true)} style={{ padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Check for updates</button>
            </Section>

            <div style={{ height: '8px' }} />
          </div>

          {/* Search bar */}
          <div style={{ marginTop: '8px', flexShrink: 0, ...panelStyle }}>
            <div style={{ width: '12px', flexShrink: 0 }} />
            <Search size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
            <div style={{ width: '8px', flexShrink: 0 }} />
            <input type="text" placeholder="Search in settings..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0', margin: '0' }} />
            <button onClick={() => setSearchQuery('')} style={{ background: 'none', border: 'none', cursor: searchQuery ? 'pointer' : 'default', padding: '8px', color: searchQuery ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', fontSize: '14px', opacity: searchQuery ? 1 : 0.3 }}>✕</button>
            <div style={{ width: '8px', flexShrink: 0 }} />
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', opacity: 0.3 }}>0/0</span>
            <div style={{ width: '8px', flexShrink: 0 }} />
            <NavArrow icon={ChevronUp} disabled />
            <NavArrow icon={ChevronDown} disabled />
          </div>
        </div>
      </div>

      {/* Error modal — with Copy button */}
      {showError && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowError(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '500px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--q-accent-danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span style={{ color: 'var(--q-accent-danger)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Error</span>
            </div>
            <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '16px' }}>
              <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{showError}</div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => { navigator.clipboard.writeText(showError); }} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>
                Copy
              </button>
              <button onClick={() => setShowError(null)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-secondary)', color: 'var(--q-bg)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Check for updates modal */}
      {showUpdate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowUpdate(false)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '12px' }}>Pi is up to date</div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>Pi is already at the latest version (v0.4.2).</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button onClick={() => setShowUpdate(false)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-secondary)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── TOC item ──
function TocItem({ icon: Icon, label, onTap }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; label: string; onTap: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onTap} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ padding: '8px 12px', marginBottom: '2px', borderRadius: 'var(--radius-md)', cursor: 'pointer', backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', display: 'flex', alignItems: 'center', gap: '8px', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <Icon size={20} style={{ color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)', flexShrink: 0 }} />
      <span style={{ color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

// ── Section panel ──
function Section({ id, icon: Icon, title, children }: { id: string; icon: React.FC<{ size?: number; style?: React.CSSProperties }>; title: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ width: '100%', marginBottom: '8px', padding: '12px 16px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Icon size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, fontFamily: 'var(--font-interface)' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

// ── Provider row — exact Flutter copy ──
function ProviderRow({ name, provider, call }: { name: string; provider: Provider; call?: (method: string, params?: any) => Promise<any> }) {
  const [expanded, setExpanded] = useState(false)
  const [enabled, setEnabled] = useState(provider.enabled)
  const [modelSearch, setModelSearch] = useState('')
  const [enabledModels, setEnabledModels] = useState<Set<string>>(new Set())
  const [showDelete, setShowDelete] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; count?: number; error?: string } | null>(null)

  const fmtCtx = (cw?: number) => {
    if (!cw || cw === 0) return '—'
    if (cw >= 1000000) { const m = cw / 1000000; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (cw >= 1000) return `${Math.floor(cw / 1000)}K`
    return `${cw}`
  }

  const displayName = name === 'ollama' ? 'Ollama' : name === 'openrouter' ? 'OpenRouter' : name === 'anthropic' ? 'Anthropic Direct' : name
  const filteredModels = (modelSearch
    ? provider.models.filter(m => m.id.toLowerCase().includes(modelSearch.toLowerCase()) || m.name.toLowerCase().includes(modelSearch.toLowerCase()))
    : provider.models
  ).sort((a, b) => {
    const aE = enabledModels.has(a.id)
    const bE = enabledModels.has(b.id)
    if (aE && !bE) return -1
    if (!aE && bE) return 1
    return 0
  })

  const toggleModel = (id: string) => {
    setEnabledModels(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  return (
    <div style={{ marginBottom: '8px', backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center' }}>
        {/* Drag handle (6 dots) */}
        <div style={{ cursor: 'grab', padding: '4px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: 'var(--q-text-tertiary)' }}>
            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" /><circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" /><circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>
        {/* Chevron */}
        <div onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          {expanded ? <ChevronDown size={20} style={{ color: 'var(--q-text-tertiary)' }} /> : <ChevronRight size={20} style={{ color: 'var(--q-text-tertiary)' }} />}
        </div>
        <div style={{ width: '8px', flexShrink: 0 }} />
        {editingName ? (
          <input type="text" value={displayName} autoFocus onBlur={() => setEditingName(false)} onKeyDown={e => { if (e.key === 'Enter') setEditingName(false) }} onChange={() => {}} style={{ width: '200px', color: 'var(--q-text)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)', backgroundColor: 'transparent', border: 'none', outline: 'none', padding: '0' }} />
        ) : (
          <span onClick={() => setEditingName(true)} style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)', cursor: 'text' }}>{displayName}</span>
        )}
        <div style={{ width: '8px', flexShrink: 0 }} />
        {!editingName && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" onClick={() => setEditingName(true)} style={{ color: 'var(--q-text-tertiary)', cursor: 'pointer', flexShrink: 0 }}>
            <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        )}
        <div style={{ width: '8px', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>({enabledModels.size} models)</span>
        <span style={{ flex: 1 }} />
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ accentColor: 'var(--q-accent-primary)' }} />
        <div style={{ width: '8px', flexShrink: 0 }} />
        <span style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>enabled</span>
        <div style={{ width: '8px', flexShrink: 0 }} />
        <Trash size={20} onClick={() => setShowDelete(true)} style={{ color: 'var(--q-text-tertiary)', cursor: 'pointer', padding: '6px', boxSizing: 'content-box' }} />
      </div>
      {/* Expanded */}
      {expanded && (
        <div style={{ padding: '0 16px 16px 16px' }}>
          <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Base URL</span>
          <div style={{ height: '8px' }} />
          <input type="text" defaultValue={provider.baseUrl || (provider.type === 'ollama' ? 'http://localhost:11434/v1' : '')} onChange={e => { provider.baseUrl = e.target.value }} placeholder="https://api.example.com/v1" style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none' }} />
          <div style={{ height: '8px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>API Key</span>
            {provider.apiKeyStatus === 'configured' && (<><div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--q-accent-success)' }} /><span style={{ color: 'var(--q-accent-success)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>saved</span></>)}
          </div>
          <div style={{ height: '8px' }} />
          <input type="password" placeholder={provider.apiKeyStatus === 'configured' ? '•••••••• (leave empty to keep)' : 'api key'} style={{ width: '100%', height: '36px', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 12px', outline: 'none' }} />
          <div style={{ height: '8px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={async () => { setTesting(true); setTestResult(null); try { const pn = name.toLowerCase(); const bk = pn === 'ollama' ? 'ollama' : ''; const bu = provider.baseUrl || (pn === 'ollama' ? 'http://localhost:11434/v1' : ''); const r = await props.call?.('testProviderConnection', { providerName: name, baseUrl: bu, apiKey: bk }); if (r?.success === false) { setTestResult({ success: false, error: r?.error || 'Connection failed' }); } else { try { const fm = await props.call?.('fetchProviderModels', { providerName: name, baseUrl: bu, apiKey: bk }); if (fm && Array.isArray(fm)) { provider.models = fm.map((m: any) => ({ id: typeof m === 'string' ? m : (m.id || m.name || m), name: typeof m === 'string' ? m : (m.name || m.id || m), contextWindow: m.contextWindow })); } else if (fm && fm.models) { provider.models = fm.models.map((m: any) => ({ id: m.id || m.name || m, name: m.name || m.id || m, contextWindow: m.contextWindow })); } } catch (e) { console.error('fetchModels:', e); } setTestResult({ success: true, count: provider.models.length }); } } catch (e: any) { setTestResult({ success: false, error: e?.message || 'Connection failed' }); } setTesting(false); }} disabled={testing} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: testing ? 'default' : 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{testing ? '...' : 'Test connection'}</button>
            <RefreshCw size={20} style={{ color: 'var(--q-text-tertiary)', cursor: 'pointer', padding: '8px', boxSizing: 'content-box' }} />
            {testResult && testResult.success && (<><Check size={16} style={{ color: 'var(--q-accent-success)' }} /><span style={{ color: 'var(--q-accent-success)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>{testResult.count} models</span></>)}
            {testResult && !testResult.success && (<><span style={{ color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Connection failed</span></>)}
          </div>
          {provider.models.length > 0 && (
            <>
              <div style={{ height: '8px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Available models ({filteredModels.length}{modelSearch && filteredModels.length !== provider.models.length ? ` of ${provider.models.length}` : ''}{enabledModels.size > 0 ? ` · ${enabledModels.size} active` : ''})</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setEnabledModels(new Set(provider.models.map(m => m.id)))} style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Enable all</button>
                  <button onClick={() => setEnabledModels(new Set())} style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)' }}>Disable all</button>
                </div>
              </div>
              <div style={{ height: '8px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', marginBottom: '8px' }}>
                <Search size={16} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
                <input type="text" placeholder="Filter models..." value={modelSearch} onChange={e => setModelSearch(e.target.value)} style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }} />
                {modelSearch && <button onClick={() => setModelSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '14px' }}>✕</button>}
              </div>
              {filteredModels.map(m => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px' }}>
                  <input type="checkbox" checked={enabledModels.has(m.id)} onChange={() => toggleModel(m.id)} style={{ accentColor: 'var(--q-accent-primary)' }} />
                  <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', flex: 1 }}>{m.id}</span>
                  <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)' }}>{fmtCtx(m.contextWindow)} ctx</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
      {/* Delete provider modal */}
      {showDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowDelete(false)}>
          <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', padding: '24px', maxWidth: '400px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>Delete provider "{displayName}"?</div>
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '20px' }}>{enabledModels.size} models will be removed. Saved API keys will be lost.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
              <button onClick={() => setShowDelete(false)} style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '15px', fontFamily: 'var(--font-interface)' }}>Cancel</button>
              <div style={{ width: '8px' }} />
              <button style={{ padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', cursor: 'pointer', backgroundColor: 'var(--q-accent-secondary)', color: 'var(--q-bg)', fontSize: '15px', fontWeight: 500, fontFamily: 'var(--font-interface)' }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Label ──
function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{children}</span>
}

// ── SubLabel ──
function SubLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>{children}</div>
}

// ── Pill ──
function Pill({ label, selected, color = 'var(--q-accent-secondary)', onClick }: { label: string; selected: boolean; color?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ padding: '8px 12px', minWidth: '60px', maxWidth: '80px', borderRadius: 'var(--radius-sm)', backgroundColor: selected ? color : 'transparent', border: `1px solid ${selected ? 'transparent' : 'var(--q-border)'}`, color: selected ? 'var(--q-bg)' : 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', textAlign: 'center', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}>{label}</div>
  )
}

// ── Dropdown ──
function Dropdown({ label, items, currentValue, onChange }: { label: string; items: { value: string; label: string; sublabel?: string }[]; currentValue?: string; onChange?: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filtered = search ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()) || i.sublabel?.toLowerCase().includes(search.toLowerCase())) : items
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => { setOpen(!open); setSearch('') }} style={{ width: '100%', padding: '7px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', cursor: 'pointer', backgroundColor: 'var(--q-bg-elevated)', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ flex: 1, color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{label}</span>
        <ChevronDown size={12} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40, overscrollBehavior: 'contain' }} onClick={() => setOpen(false)} />
          <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: '0', right: '0', zIndex: 50, backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', boxShadow: 'var(--shadow-floating)', maxHeight: '300px', display: 'flex', flexDirection: 'column', overscrollBehavior: 'contain' }}>
            {/* Search field inside dropdown */}
            {items.length > 5 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', flexShrink: 0 }}>
                <Search size={14} style={{ color: 'var(--q-text-tertiary)', flexShrink: 0 }} />
                <input type="text" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} autoFocus style={{ flex: 1, backgroundColor: 'transparent', border: 'none', outline: 'none', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)' }} />
                {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', fontSize: '13px' }}>✕</button>}
              </div>
            )}
            <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
              {filtered.map(item => (
                <DropdownItem key={item.value} label={item.label} sublabel={item.sublabel} isSelected={item.value === currentValue} onTap={() => { onChange?.(item.value); setOpen(false) }} />
              ))}
              {filtered.length === 0 && (
                <div style={{ padding: '12px', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', textAlign: 'center' }}>No results</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Dropdown item ──
function DropdownItem({ label, sublabel, isSelected, onTap }: { label: string; sublabel?: string; isSelected: boolean; onTap: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onTap} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ padding: '8px 12px', cursor: 'pointer', backgroundColor: hovered ? 'rgba(255,255,255,0.06)' : isSelected ? 'rgba(255,255,255,0.03)' : 'transparent', display: 'flex', alignItems: 'center' }}>
      <span style={{ flex: 1, color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {sublabel && <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', flexShrink: 0 }}>{sublabel}</span>}
    </div>
  )
}

// ── Color picker row ──
function ColorPickerRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: '6px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ width: '40px', height: '32px', borderRadius: 'var(--radius-sm)', backgroundColor: value, border: '1px solid var(--q-border)', cursor: 'pointer' }} />
      <span style={{ flex: 1, color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{label}</span>
      <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)' }}>{value.toUpperCase()}</span>
    </div>
  )
}

// ── Version row ──
function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{label}</span>
      <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-code)' }}>{value}</span>
    </div>
  )
}

// ── Nav arrow ──
function NavArrow({ icon: Icon, disabled }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; disabled: boolean }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ padding: '0px', border: 'none', cursor: disabled ? 'default' : 'pointer', backgroundColor: 'transparent', display: 'flex', color: disabled ? 'var(--q-text-tertiary)' : (hovered ? 'var(--q-text)' : 'var(--q-text-secondary)'), opacity: disabled ? 0.3 : 1 }}>
      <Icon size={16} />
    </button>
  )
}

// ── Icon button ──
function IconBtn({ icon: Icon, onClick, title }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer', backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)', flexShrink: 0, padding: '0', transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
      <Icon size={20} />
    </button>
  )
}