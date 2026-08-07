import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export function SyncModal() {
  const [syncReq, setSyncReq] = useState<string | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    listen('sync-request', (event: any) => {
      setSyncReq(event.payload as string)
    }).then((fn) => { unlisten = fn }).catch(() => {})
    return () => { if (unlisten) unlisten() }
  }, [])

  if (!syncReq) return null

  const isImport = syncReq === 'import'
  const title = isImport ? 'Sync from Main App?' : 'Export to Main App?'
  const desc = isImport
    ? 'This will REPLACE ALL agents and skills in the Expert App with the Main App\'s copy. The Expert App will lose any agents or skills it has that the Main App doesn\'t have. This cannot be undone.'
    : 'This will REPLACE ALL agents and skills in the Main App with the Expert App\'s copy. The Main App will lose any agents or skills it has that the Expert App doesn\'t have. This cannot be undone.'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSyncReq(null)}>
      <div style={{ backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '20px 24px', minWidth: '320px', maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
        <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>{title}</div>
        <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', marginBottom: '16px', lineHeight: 1.5 }}>{desc}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={() => setSyncReq(null)}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={async () => {
            try {
              isImport ? await invoke('sync_from_main') : await invoke('sync_from_expert')
              setSyncReq(null)
            } catch (e) { setSyncReq(null) }
          }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#d9a066'; e.currentTarget.style.color = 'var(--q-bg)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#d9a066' }}
            style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid #d9a066', backgroundColor: 'transparent', color: '#d9a066', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 600, cursor: 'pointer' }}>
            {isImport ? 'Sync' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}
