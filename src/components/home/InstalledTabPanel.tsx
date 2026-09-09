// InstalledTabPanel.tsx — A4.2: pannelli delle tab installate dal Marketplace.
// 'real' = pannello integrato funzionante (per i test); 'stub' = messaggio A4.3.
// In A4.3 queste tab caricheranno un bundle JS a potenza piena (modello VS Code).
import React from 'react'
import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { FileText, Bookmark, Clock, Play, Pause, RotateCcw, Plus, Trash2, Sparkles, ChevronLeft, Home } from '../icons'
import { findCatalogItem } from '../../catalog'
import { RuntimeTabPanel } from '../../tabs/runtime'
import { useSidecarContext } from '../shared/AppShell'

const NOTES_KEY = 'q-tab-notes'
const LINKS_KEY = 'q-tab-quicklinks'

export function InstalledTabPanel({ activeTab, onSelectPanel }: { activeTab: string, onSelectPanel: (p: string) => void }) {
  const { call } = useSidecarContext()
  const item = findCatalogItem(activeTab === 'quicklinks' ? 'quicklinks' : activeTab.startsWith('stub-') ? null : activeTab)
  // per le stub il panel id è 'stub-<id>': risali all'item
  const realItem = item || findCatalogItem(activeTab.replace('stub-', ''))
  const name = (realItem ? realItem.name : activeTab.replace('stub-', '').replace(/-/g, ' '))

  // notes/quicklinks hanno il loro pannello integrato; tutte le altre installate
  // (knowledge, pomodoro, e le stub) girano via runtime (bundle specifico o generico)
  if (activeTab === 'notes') return <NotesPanel onSelectPanel={onSelectPanel} />
  if (activeTab === 'quicklinks') return <QuickLinksPanel onSelectPanel={onSelectPanel} />
  return React.createElement(RuntimeTabPanel, { tabId: activeTab, call })
}

function PanelHeader({ icon, color, title, onSelectPanel }: { icon: any, color: string, title: string, onSelectPanel: (p: string) => void }) {
  return React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' } },
    React.createElement('button', {
      onClick: () => onSelectPanel('home'),
      title: 'Back to Home',
      style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-text-tertiary)', cursor: 'pointer', transition: 'none' },
      onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
      onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }
    }, React.createElement(Home, { size: 16 })),
    React.createElement(icon, { size: 20, style: { color } }),
    React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, title),
    React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginLeft: 'auto' } }, 'installed tab · local')
  )
}

function PanelShell({ children }: { children: any }) {
  return React.createElement('div', { style: { height: '100%', padding: '24px 32px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' } }, children)
}

// ── Notes: textarea salvata in localStorage ──
function NotesPanel({ onSelectPanel }: { onSelectPanel: (p: string) => void }) {
  const [text, setText] = useState<string>(() => { try { return localStorage.getItem(NOTES_KEY) || '' } catch { return '' } })
  useEffect(() => { try { localStorage.setItem(NOTES_KEY, text) } catch {} }, [text])
  return React.createElement(PanelShell, { children: [
    React.createElement(PanelHeader, { icon: FileText, color: 'var(--q-accent-primary)', title: 'Notes', onSelectPanel }),
    React.createElement('textarea', {
      value: text,
      onChange: (e: any) => setText(e.target.value),
      placeholder: 'Write something… saved automatically.',
      style: { flex: 1, resize: 'none', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', padding: '14px', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.6, outline: 'none' }
    })
  ] })
}

// ── Quick Links: lista di link salvata in localStorage ──
function QuickLinksPanel({ onSelectPanel }: { onSelectPanel: (p: string) => void }) {
  const [links, setLinks] = useState<{ title: string, url: string }[]>(() => { try { return JSON.parse(localStorage.getItem(LINKS_KEY) || '[]') } catch { return [] } })
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  useEffect(() => { try { localStorage.setItem(LINKS_KEY, JSON.stringify(links)) } catch {} }, [links])
  const add = () => {
    const u = url.trim()
    if (!u) return
    setLinks([...links, { title: title.trim() || u, url: u }])
    setTitle(''); setUrl('')
  }
  return React.createElement(PanelShell, { children: [
    React.createElement(PanelHeader, { icon: Bookmark, color: 'var(--q-accent-info)', title: 'Quick Links', onSelectPanel }),
    React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px' } },
      React.createElement('input', {
        value: title, onChange: (e: any) => setTitle(e.target.value), placeholder: 'Title',
        style: { flex: 1, backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', height: '36px', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', outline: 'none' }
      }),
      React.createElement('input', {
        value: url, onChange: (e: any) => setUrl(e.target.value), placeholder: 'https://…',
        onKeyDown: (e: any) => { if (e.key === 'Enter') add() },
        style: { flex: 2, backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', padding: '0 12px', height: '36px', color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', outline: 'none' }
      }),
      React.createElement('button', {
        onClick: add,
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', cursor: 'pointer', transition: 'none' },
        onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' },
        onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }
      }, React.createElement(Plus, { size: 16 }))
    ),
    React.createElement('div', { style: { flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' } },
      links.length === 0
        ? React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', padding: '24px 0', textAlign: 'center' } }, 'No links yet. Add your first one above.')
        : links.map((l, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' } },
            React.createElement(Bookmark, { size: 14, style: { color: 'var(--q-accent-info)', flexShrink: 0 } }),
            React.createElement('a', { href: l.url, target: '_blank', rel: 'noreferrer', style: { flex: 1, color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, l.title),
            React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-code)', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, l.url),
            React.createElement('button', {
              onClick: () => setLinks(links.filter((_, j) => j !== i)),
              style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-tertiary)', display: 'flex', padding: '2px' }
            }, React.createElement(Trash2, { size: 13 }))
          ))
    )
  ] })
}

// ── Pomodoro: timer 25 min ──
function PomodoroPanel({ onSelectPanel }: { onSelectPanel: (p: string) => void }) {
  const [seconds, setSeconds] = useState(25 * 60)
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setSeconds((s) => (s <= 0 ? 0 : s - 1)), 1000)
    return () => clearInterval(t)
  }, [running])
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return React.createElement(PanelShell, { children: [
    React.createElement(PanelHeader, { icon: Clock, color: 'var(--q-accent-warning)', title: 'Pomodoro', onSelectPanel }),
    React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px' } },
      React.createElement('div', { style: { fontSize: '72px', fontWeight: 700, fontFamily: 'var(--font-code)', color: seconds === 0 ? 'var(--q-accent-danger)' : 'var(--q-text)', letterSpacing: '2px' } }, `${mm}:${ss}`),
      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
        React.createElement('button', {
          onClick: () => setRunning(!running),
          style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer', transition: 'none' },
          onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' },
          onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }
        }, running ? React.createElement(Pause, { size: 14 }) : React.createElement(Play, { size: 14 }), running ? 'Pause' : 'Start'),
        React.createElement('button', {
          onClick: () => { setRunning(false); setSeconds(25 * 60) },
          style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' },
          onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
          onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }
        }, React.createElement(RotateCcw, { size: 14 }), 'Reset')
      ),
      React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, '25 minutes · work / 5 minutes · break')
    )
  ] })
}

// ── Stub: tab non ancora implementata (A4.3) ──
function StubPanel({ name, onSelectPanel }: { name: string, onSelectPanel: (p: string) => void }) {
  return React.createElement(PanelShell, { children: [
    React.createElement(PanelHeader, { icon: Sparkles, color: 'var(--q-accent-secondary)', title: name, onSelectPanel }),
    React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', textAlign: 'center' } },
      React.createElement(Sparkles, { size: 28, style: { color: 'var(--q-accent-secondary)' } }),
      React.createElement('div', {}, `"${name}" is installed. Its bundle arrives with A4.3, the JS tab runtime.`),
      React.createElement('div', { style: { color: 'var(--q-text-tertiary)', fontSize: '12px' } }, 'For now you can reorder it on the Home and uninstall it from the Market.')
    )
  ] })
}
