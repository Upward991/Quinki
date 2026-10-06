// App Icon — selettore dell'icona dell'app (icone pixel: q per Quinki, E per
// App Expert). La scelta è condivisa (app-icons.json) e applicata dal Rust a
// caldo (Dock + tray) e in modo persistente (icns nel bundle).
// Generato/aggiornato dalle anteprime in appIconAssets.ts (build-logo.sh).
import React, { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSidecarContext } from '../shared/AppShell'
import { APP_ICON_PREVIEWS } from './appIconAssets'

const MAIN_OPTIONS = [
  { variant: 'main-violet', label: 'Violet' },
  { variant: 'main-dark', label: 'Dark' },
  { variant: 'main-current', label: 'Original' },
]
const EXPERT_OPTIONS = [
  { variant: 'expert-orange', label: 'Orange' },
  { variant: 'expert-dark', label: 'Dark' },
  { variant: 'expert-current', label: 'Robot' },
]

function isExpertApp() {
  try { return new URLSearchParams(window.location.search).get('expert') === '1' } catch { return false }
}
function isDesktop() { return !!(window as any).__TAURI_INTERNALS__ }

function IconTile(props: { variant: string; label: string; selected: boolean; onPick: () => void }) {
  const { variant, label, selected, onPick } = props
  return (
    <div
      onClick={onPick}
      title={label}
      style={{
        cursor: 'pointer', padding: '6px', borderRadius: 'var(--radius-md)',
        border: selected ? '1px solid var(--q-tab-accent)' : '1px solid var(--q-border)',
        backgroundColor: selected ? 'var(--q-accent-primary-soft)' : 'transparent',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        width: '88px', transition: 'none',
      }}
    >
      <img
        src={APP_ICON_PREVIEWS[variant]}
        alt={label}
        draggable={false}
        style={{ width: '56px', height: '56px', borderRadius: '13px', display: 'block' }}
      />
      <span style={{
        fontSize: '11px', fontFamily: 'var(--font-interface)',
        color: selected ? 'var(--q-tab-accent)' : 'var(--q-text-secondary)',
        fontWeight: selected ? 600 : 400,
      }}>{label}</span>
    </div>
  )
}

export function AppIconSection() {
  const { call } = useSidecarContext()
  const expert = isExpertApp()
  const [choices, setChoices] = useState<{ main: string; expert: string }>({ main: 'main-violet', expert: 'expert-orange' })

  useEffect(() => {
    call('getAppIcons').then((r: any) => {
      setChoices({ main: (r && r.main) || 'main-violet', expert: (r && r.expert) || 'expert-orange' })
    }).catch(() => {})
  }, [])

  const pick = async (which: 'main' | 'expert', variant: string) => {
    setChoices(prev => ({ ...prev, [which]: variant }))
    try { await call('setAppIcons', { [which]: variant }) } catch {}
    // Applica SUBITO nell'app corrente quando è la sua coppia di icone.
    const isLocal = (which === 'main' && !expert) || (which === 'expert' && expert)
    if (isLocal && isDesktop()) {
      try { await invoke('set_app_icon', { variant }) } catch (e) { console.log('set_app_icon failed:', e) }
    }
  }

  const group = (title: string, options: { variant: string; label: string }[], which: 'main' | 'expert', note?: string) => (
    <div style={{ marginBottom: '12px' }}>
      <div style={{ color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>{title}</div>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {options.map(o => (
          <IconTile key={o.variant} variant={o.variant} label={o.label} selected={choices[which] === o.variant} onPick={() => pick(which, o.variant)} />
        ))}
      </div>
      {note ? <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '8px' }}>{note}</div> : null}
    </div>
  )

  return (
    <div>
      {!expert && group('Quinki', MAIN_OPTIONS, 'main')}
      {group('App Expert', EXPERT_OPTIONS, 'expert', expert ? undefined : 'Applies to App Expert when it restarts.')}
      <div style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginTop: '4px' }}>
        The icon changes instantly (Dock and menu bar tray) and is kept after restart. "Original" brings back the classic mascot icon.
      </div>
    </div>
  )
}
