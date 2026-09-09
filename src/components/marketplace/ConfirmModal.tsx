// ConfirmModal.tsx — modale di conferma del Market (install/update/uninstall/unfollow/upload).
// Stile coerente con i modali dell'app: Cancel rosso, Confirm accent (o danger).
// Dopo il Confirm mostra "In corso…" (spinner) per dare feedback visivo, poi esegue.
import React from 'react'
import { useState } from 'react'

export function ConfirmModal({ title, message, confirmLabel, danger, busyLabel, secondaryLabel, onSecondary, segOptions, segValue, onSeg, onCancel, onConfirm }: {
  title: string, message: string, confirmLabel: string, danger?: boolean, busyLabel?: string, secondaryLabel?: string, onSecondary?: () => void, segOptions?: string[], segValue?: string, onSeg?: (v: string) => void, onCancel: () => void, onConfirm: () => void
}) {
  const [busy, setBusy] = useState(false)
  const doConfirm = () => {
    setBusy(true)
    setTimeout(() => { try { onConfirm() } catch (e) { console.error(e); setBusy(false) } }, 700)
  }
  const doSecondary = () => {
    setBusy(true)
    setTimeout(() => { try { if (onSecondary) onSecondary() } catch (e) { console.error(e); setBusy(false) } }, 700)
  }
  return React.createElement('div',
    { style: { position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onClick: busy ? () => {} : onCancel },
    React.createElement('div',
      { style: { backgroundColor: 'var(--mp-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--mp-border)', padding: '20px 24px', minWidth: '320px', maxWidth: '400px' }, onClick: (e: any) => e.stopPropagation() },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' } },
        busy && React.createElement('span', { style: { width: '16px', height: '16px', borderRadius: '50%', border: '2px solid var(--mp-border)', borderTopColor: 'var(--mp-accent)', animation: 'spin 0.8s linear infinite' } }),
        React.createElement('div', { style: { color: 'var(--mp-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)' } }, busy && busyLabel ? busyLabel : title)
      ),
      React.createElement('div', { style: { color: 'var(--mp-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' } }, message),
      segOptions && segOptions.length > 0 && React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' } },
        segOptions.map((opt) => React.createElement('button', {
          key: opt,
          onClick: () => { if (onSeg) onSeg(opt) },
          style: {
            padding: '4px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-interface)',
            border: '1px solid ' + (segValue === opt ? 'var(--mp-accent)' : 'var(--mp-border)'),
            backgroundColor: segValue === opt ? 'var(--mp-accent)' : 'transparent',
            color: segValue === opt ? 'var(--mp-bg)' : 'var(--mp-text-secondary)',
          }
        }, opt))
      ),
      !busy && React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '8px' } },
        React.createElement('button', {
          onClick: onCancel,
          onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' },
          onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' },
          style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-border)', backgroundColor: 'transparent', color: 'var(--mp-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }
        }, 'Cancel'),
        secondaryLabel && onSecondary && React.createElement('button', {
          onClick: doSecondary,
          onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'var(--mp-elevated)' },
          onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' },
          style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--mp-border-strong)', backgroundColor: 'transparent', color: 'var(--mp-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }
        }, secondaryLabel),
        React.createElement('button', {
          onClick: doConfirm,
          onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = danger ? 'var(--mp-danger)' : 'var(--mp-accent)'; e.currentTarget.style.color = 'var(--mp-bg)' },
          onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = danger ? 'var(--mp-danger)' : 'var(--mp-accent)' },
          style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid ' + (danger ? 'var(--mp-danger)' : 'var(--mp-accent)'), backgroundColor: 'transparent', color: danger ? 'var(--mp-danger)' : 'var(--mp-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }
        }, confirmLabel)
      )
    )
  )
}
