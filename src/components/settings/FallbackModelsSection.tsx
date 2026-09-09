import React, { useState, useEffect, useCallback } from 'react'
import { Trash } from '../icons'
import { Gh } from './SettingsPanel'

/**
 * FEATURE fallback 401: selettore modelli di fallback per nuove chat.
 * Usa lo STESSO dropdown Gh del default model. Lista ripetibile, cestino per
 * rimuovere con modale di conferma coerente, tasto "+ Add fallback" con hover
 * come gli altri tasti dell'app.
 */
export function FallbackModelsSection(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  providers: any[]
}) {
  const { call, providers } = props
  const allModels = (providers || []).flatMap((p: any) =>
    (p.enabledModels || []).map((id: string) => ({ value: id, label: id, sublabel: p.name }))
  )

  const [fallbacks, setFallbacks] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null)
  // hover per il tasto add
  const [addHover, setAddHover] = useState(false)
  // hover per i tasti modale
  const [hCancel, setHCancel] = useState(false)
  const [hConfirm, setHConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        let list: string[] = []
        try {
          const s: any = await call('getSettings', {})
          if (s && Array.isArray((s as any).defaultFallbackModels)) list = (s as any).defaultFallbackModels
        } catch {}
        if (!cancelled) { setFallbacks(list); setLoaded(true) }
      } catch { if (!cancelled) { setLoaded(true) } }
    })()
    return () => { cancelled = true }
  }, [call])

  const persist = useCallback((next: string[]) => {
    setFallbacks(next)
    try { call('setDefaultFallbacks', { models: next }).catch(() => {}) } catch {}
  }, [call])

  const labelStyle = { color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', marginBottom: '4px' } as any
  const rowStyle = { marginBottom: '8px' } as any
  if (!loaded) return null

  const removeAt = (idx: number) => {
    const next = fallbacks.filter((_, i) => i !== idx)
    persist(next)
    setConfirmIdx(null)
  }

  return (
    <div style={{ marginTop: '12px', marginBottom: '12px' }}>
      <div style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '4px' }}>
        Fallback models for new chats
      </div>
      <div style={labelStyle}>
        If the main model fails (authentication / credits), Quinki automatically switches to the next fallback in order.
      </div>

      {fallbacks.map((fb, idx) => (
        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', ...rowStyle }}>
          <div style={{ ...labelStyle, minWidth: '92px', marginBottom: 0 }}>Fallback {idx + 1}</div>
          <div style={{ flex: 1 }}>
            <Gh
              label={fb || 'Select fallback model'}
              items={allModels}
              currentValue={fb}
              onChange={(v: string) => { const next = [...fallbacks]; next[idx] = v; persist(next) }}
            />
          </div>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <Trash
            size={20}
            onClick={() => setConfirmIdx(idx)}
            style={{ color: 'var(--q-text-tertiary)', cursor: 'pointer', padding: '6px', boxSizing: 'content-box' }}
          />
        </div>
      ))}

      <button
        onClick={() => {
          if (fallbacks.length >= 8) return
          const first = allModels[0]?.value
          if (!first) return
          persist([...fallbacks, first])
        }}
        onMouseEnter={() => setAddHover(true)}
        onMouseLeave={() => setAddHover(false)}
        style={{
          padding: '7px 16px', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 600,
          color: addHover ? 'var(--q-bg)' : 'var(--q-tab-accent)',
          backgroundColor: addHover ? 'var(--q-tab-accent)' : 'transparent',
          border: '1px solid var(--q-tab-accent)',
          borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'none',
        }}
      >
        + Add fallback
      </button>

      {confirmIdx !== null && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setConfirmIdx(null)}
        >
          <div
            style={{
              backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)',
              padding: '20px 24px', minWidth: '320px', maxWidth: '400px',
            }}
            onClick={(e: any) => e.stopPropagation()}
          >
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>
              Remove fallback
            </div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '16px' }}>
              Remove fallback {confirmIdx + 1} ({fallbacks[confirmIdx]})? The model will no longer be used automatically when the main model fails.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => setConfirmIdx(null)}
                onMouseEnter={() => setHCancel(true)}
                onMouseLeave={() => setHCancel(false)}
                style={{
                  padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)',
                  backgroundColor: hCancel ? 'rgba(255,255,255,0.06)' : 'transparent',
                  color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer',
                }}
              >Cancel</button>
              <button
                onClick={() => removeAt(confirmIdx)}
                onMouseEnter={() => setHConfirm(true)}
                onMouseLeave={() => setHConfirm(false)}
                style={{
                  padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)',
                  backgroundColor: hConfirm ? 'var(--q-tab-accent)' : 'transparent',
                  color: hConfirm ? 'var(--q-bg)' : 'var(--q-tab-accent)', fontSize: '13px',
                  fontFamily: 'var(--font-interface)', fontWeight: 600, cursor: 'pointer',
                }}
              >Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}