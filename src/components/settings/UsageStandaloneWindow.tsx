import React from 'react'
import { RemainingCreditsContent } from './RemainingCreditsCard'

/**
 * Standalone "usage" window (win-usage) — OpenRouter only. Renders the WINDOW
 * variant (no card contour): the content fills the whole window.
 */
export function UsageStandaloneWindow(props: { call: (method: string, params?: any, timeoutMs?: number) => Promise<any> }) {
  const { call } = props
  const style = {
    height: '100vh', width: '100vw', overflow: 'hidden',
    backgroundColor: 'var(--q-bg-panel)', color: 'var(--q-text)',
    fontFamily: 'var(--font-interface)', display: 'flex', flexDirection: 'column',
  } as any

  return (
    <div style={style}>
      <div data-tauri-drag-region style={{ height: '25px', flexShrink: 0, width: '100%', backgroundColor: 'var(--q-bg-panel)', WebkitAppRegion: 'drag' }} />
      <RemainingCreditsContent call={call} showOpenWindow={false} variant="window" />
    </div>
  )
}
