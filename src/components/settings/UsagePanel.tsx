import React, { useState, useEffect, useCallback } from 'react'

/**
 * FEATURE usage provider (04 set): mostra per ogni provider il dato essenziale.
 * OpenRouter → credito residuo (solo total available), aggiornato ogni 15s + tasto
 * refresh forzato. Ollama → modelli disponibili/ caricati.
 */
export function UsagePanel(props: {
  call: (method: string, params?: any, timeoutMs?: number) => Promise<any>
  providerName?: string
  compact?: boolean
}) {
  const { call, providerName, compact } = props
  const [orCredits, setOrCredits] = useState<number | null>(null)
  const [ol, setOl] = useState<any>(null)
  const [err, setErr] = useState<string>('')
  const [refreshing, setRefreshing] = useState(false)

  const refreshOne = useCallback(async (name: string) => {
    try {
      const r: any = await call('getProviderUsage', { providerName: name }).catch(() => null)
      if (!r) return null
      if (r.ok) return r
      return null
    } catch { return null }
  }, [call])

  const refreshAll = useCallback(async () => {
    const target = providerName || ''
    // OpenRouter: solo credito residuo
    if (!target || target === 'OpenRouter') {
      const r = await refreshOne('OpenRouter')
      if (r?.credits && typeof r.credits.total_credits === 'number') setOrCredits(r.credits.total_credits)
    }
    // Ollama: modelli
    if (!target || target === 'Ollama') {
      const r2 = await refreshOne('Ollama')
      if (r2?.ok) setOl(r2)
    }
    setErr('')
  }, [refreshOne, providerName])

  useEffect(() => {
    refreshAll()
    const timer = setInterval(refreshAll, 15000)
    return () => clearInterval(timer)
  }, [refreshAll])

  const cardStyle = { backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--q-border)', padding: '8px 12px', marginBottom: '8px' } as any
  const label = { color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '2px' } as any
  const val = { color: 'var(--q-text)', fontSize: '15px', fontFamily: 'var(--font-interface)', fontWeight: 600 } as any
  const refreshBtnStyle = {
    background: 'none', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)',
    color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)',
    padding: '4px 10px', cursor: 'pointer', marginLeft: '8px',
  } as any

  // Se filtrato a un provider specifico, mostra solo quello
  if (providerName) {
    if (providerName === 'OpenRouter') {
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ ...cardStyle, flex: 1, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1 }}>
              <div style={label}>Credito residuo</div>
              <div style={val}>${orCredits !== null ? orCredits.toFixed(2) : '…'}</div>
            </div>
            <button
              onClick={async () => { setRefreshing(true); await refreshAll(); setRefreshing(false) }}
              style={refreshBtnStyle}
            >{refreshing ? '…' : '⟳ Refresh'}</button>
          </div>
        </div>
      )
    }
    if (providerName === 'Ollama') {
      return (
        <div style={cardStyle}>
          <div style={label}>Modelli Ollama</div>
          <div style={val}>
            {ol ? `${Array.isArray(ol.models) ? ol.models.length : 0} disponibili${Array.isArray(ol.loaded) && ol.loaded.length ? ` · ${ol.loaded.length} caricati` : ''}` : '…'}
          </div>
        </div>
      )
    }
    return null
  }

  // Vista aggregate (non usata fuori dai toggle, ma tenuta per future mini-finestre)
  return (
    <div>
      <div style={cardStyle}>
        <div style={label}>OpenRouter — credito residuo</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={val}>${orCredits !== null ? orCredits.toFixed(2) : '…'}</div>
          <button onClick={async () => { setRefreshing(true); await refreshAll(); setRefreshing(false) }} style={refreshBtnStyle}>{refreshing ? '…' : '⟳ Refresh'}</button>
        </div>
      </div>
      <div style={cardStyle}>
        <div style={label}>Ollama</div>
        <div style={val}>{ol ? `${ol.models?.length || 0} modelli` : '…'}</div>
      </div>
      {err && <div style={{ ...label, color: 'var(--q-accent-danger)' }}>{err}</div>}
    </div>
  )
}