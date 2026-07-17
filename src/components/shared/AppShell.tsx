// ============================================================
// AppShell — Layout principale
// PRESENTAZIONALE: riceve tutto via props, zero logica
// Structure: TitleBar (28px) → Body (padding 8px) → Stack(Sidebar + Main)
// ============================================================

import type { ViewTab } from '../../types'
import { MessageSquare, Home, Settings, Bot } from '../icons'

interface AppShellProps {
  activeTab: ViewTab
  onTabChange: (tab: ViewTab) => void
  sidebar: React.ReactNode
  children: React.ReactNode
  sidebarVisible: boolean
}

const tabs: { id: ViewTab; label: string; icon: React.FC<any> }[] = [
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function AppShell({ activeTab, onTabChange, sidebar, children, sidebarVisible }: AppShellProps) {
  return (
    <div className="flex flex-col h-screen w-screen bg-bg overflow-hidden">
      {/* Title bar — 28px, always visible */}
      <TitleBar />

      {/* Body — padding 8px, contains sidebar + main */}
      <div className="flex flex-1 p-2 gap-2 overflow-hidden">
        {/* Sidebar — visible only when sidebarVisible */}
        {sidebarVisible && (
          <div className="flex-shrink-0" style={{ width: 'var(--spacing-sidebar)' }}>
            {sidebar}
          </div>
        )}

        {/* Main area */}
        <div className="flex flex-col flex-1 gap-2 overflow-hidden">
          {/* Tab switcher — floating panel */}
          <TabSwitcher activeTab={activeTab} onTabChange={onTabChange} />

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Title bar (28px, drag region for window) ──
function TitleBar() {
  return (
    <div
      className="flex items-center justify-center h-7 bg-bg border-b border-border-soft flex-shrink-0"
      style={{ height: 'var(--spacing-titlebar)' }}
    >
      <span className="text-xs text-text-tertiary font-interface select-none">
        Quinki
      </span>
    </div>
  )
}

// ── Tab switcher (floating panel with 4 tabs) ──
function TabSwitcher({ activeTab, onTabChange }: { activeTab: ViewTab; onTabChange: (t: ViewTab) => void }) {
  return (
    <div className="flex items-center gap-1 bg-bg-panel rounded-lg shadow-floating p-1">
      {tabs.map(tab => {
        const Icon = tab.icon
        const active = activeTab === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active
                ? 'bg-active text-text'
                : 'text-text-secondary hover:bg-hover hover:text-text'
            }`}
          >
            <Icon size={16} />
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}