// ============================================================
// Composer — all elements 32px, aligned, exact spacing
// ============================================================

import { useState, useRef, useEffect } from 'react'
import type { Provider, ChatMode } from '../../types'
import { Paperclip } from '../icons'
import { SlashMenu, type SlashMenuRef } from './SlashMenu'

interface ComposerProps {
  providers: Provider[]
  selectedModel: string
  mode: ChatMode
  thinking: string
  contextTokens: number
  contextWindow: number
  isStreaming: boolean
  statusLabel?: string
  statusKind?: string
  onSend: (text: string) => void
  onStop: () => void
  onModelChange: (model: string) => void
  onModeChange: (mode: ChatMode) => void
  onThinkingChange: (level: string) => void
  welcomeMode?: boolean
}

export function Composer(props: ComposerProps) {
  const [text, setText] = useState('')
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slashMenuRef = useRef<SlashMenuRef>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 280) + 'px'
    }
  }, [text])

  const canSend = text.trim().length > 0 && !props.isStreaming

  const handleSend = () => {
    if (canSend) { props.onSend(text.trim()); setText(''); setSlashMenuOpen(false) }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // When slash menu is open, route arrow keys and Enter to it
    if (slashMenuOpen) {
      if (e.key === 'ArrowUp') { e.preventDefault(); slashMenuRef.current?.navUp(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); slashMenuRef.current?.navDown(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); slashMenuRef.current?.navLeft(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); slashMenuRef.current?.navRight(); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); slashMenuRef.current?.navEnter(); return }
      if (e.key === 'Escape') { e.preventDefault(); setSlashMenuOpen(false); setText(''); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') { setSlashMenuOpen(false); setText('') }
  }

  const fmt = (n: number) => {
    if (n >= 1000000) {
      const m = n / 1000000
      return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`
    }
    if (n >= 1000) return `${Math.floor(n / 1000)}K`
    return `${n}`
  }
  // Dynamic context: session context + tokens from text being typed (~4 chars per token)
  const typedTokens = Math.ceil(text.length / 4)
  const total = props.contextTokens + typedTokens
  const pct = props.contextWindow > 0 ? (total / props.contextWindow) * 100 : 0
  const counterColor = pct >= 80 ? 'var(--q-accent-danger)' : pct >= 50 ? 'var(--q-accent-warning)' : 'var(--q-text)'
  const counterText = props.contextWindow > 0
    ? `${fmt(total)}/${fmt(props.contextWindow)} (${Math.floor(pct)}%)`
    : `${fmt(total)} tokens`

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {slashMenuOpen && (
        <SlashMenu
          ref={slashMenuRef}
          filter={slashFilter}
          providers={props.providers}
          selectedModel={props.selectedModel}
          thinking={props.thinking}
          onSelectModel={(m) => { props.onModelChange(m); setSlashMenuOpen(false); setText('') }}
          onSelectThinking={(t) => { props.onThinkingChange(t); setSlashMenuOpen(false); setText('') }}
          onReset={() => { setSlashMenuOpen(false); setText('') }}
          onClose={() => { setSlashMenuOpen(false); setText('') }}
        />
      )}
      <div style={{
        backgroundColor: 'var(--q-bg-panel)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-floating)',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => {
            const val = e.target.value
            setText(val)
            // Slash menu detection
            if (val.startsWith('/') && !val.includes(' ')) {
              setSlashMenuOpen(true)
              setSlashFilter(val.slice(1))
            } else {
              setSlashMenuOpen(false)
              setSlashFilter('')
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          style={{
            width: '100%',
            minHeight: '40px',
            maxHeight: '280px',
            backgroundColor: 'transparent',
            color: 'var(--q-text)',
            fontSize: '16px',
            lineHeight: '24px',
            fontFamily: 'var(--font-interface)',
            resize: 'none',
            outline: 'none',
            border: 'none',
            padding: '8px',
            caretColor: 'white',
          }}
          rows={1}
        />

        {/* Bottom bar — ALL elements 32px height, gap between them */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          height: '32px',
          marginTop: '8px',
        }}>
          <SquareBtn shape="slash" color="var(--q-accent-info)" onClick={() => { setSlashMenuOpen(true); setSlashFilter(""); setText("/"); textareaRef.current?.focus() }} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <ModeButton mode={props.mode} onChange={props.onModeChange} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <div style={{ height: '32px', display: 'flex', alignItems: 'center' }}>
            <span style={{ color: counterColor, fontSize: '12px', fontFamily: 'var(--font-code)', lineHeight: '1', whiteSpace: 'nowrap' }}>
              {counterText}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {props.isStreaming && props.statusLabel && (
            <div style={{ height: '32px', display: 'flex', alignItems: 'center', marginRight: '8px' }}>
              <StatusPill label={props.statusLabel} kind={props.statusKind || 'thinking'} />
            </div>
          )}
          <HoverBtn onClick={() => {}} title="Attach file"><Paperclip size={20} /></HoverBtn>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <SquareBtn shape="square" color="var(--q-accent-danger)" onClick={props.isStreaming ? props.onStop : () => {}} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <SendButton enabled={canSend} onClick={handleSend} />
        </div>
      </div>
      
    </div>
  )
}



// ── Hover button — 32x32, icon 20px centered ──
function HoverBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '6px', border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        flexShrink: 0, padding: '0',
        transition: 'background-color 0.15s ease, color 0.15s ease',
      }}>
      {children}
    </button>
  )
}

// ── Mode button — 48x32, text only, bold, no padding ──
function ModeButton({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const [hovered, setHovered] = useState(false)
  const isPlan = mode === 'plan'
  const color = isPlan ? '#F4A6BD' : '#F2A65E'
  return (
    <button onClick={() => onChange(isPlan ? 'build' : 'plan')}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '48px', height: '32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '6px', border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color, fontWeight: 700, fontSize: '14px',
        fontFamily: 'var(--font-interface)', lineHeight: '1',
        flexShrink: 0, padding: '0',
        transition: 'background-color 0.15s ease',
      }}>
      {isPlan ? 'Plan' : 'Build'}
    </button>
  )
}

// ── Square button (slash or plain) — 32x32, 20px icon centered ──
function SquareBtn({ shape, color, onClick }: { shape: 'slash' | 'square'; color: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '6px', border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'rgba(255,255,255,0.1)' : 'transparent',
        flexShrink: 0, padding: '0',
        transition: 'background-color 0.15s ease',
      }}>
      <svg width="22" height="22" viewBox="0 0 24 24" shapeRendering="geometricPrecision">
        <rect x="2" y="2" width="20" height="20" rx="2" fill={color} />
        {shape === 'slash' && <line x1="7" y1="17" x2="17" y2="7" stroke="var(--q-bg)" strokeWidth="2.4" strokeLinecap="round" />}
      </svg>
    </button>
  )
}

// ── Send button — 32x32, triangle exact Flutter copy ──
function SendButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} disabled={!enabled}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '6px', border: 'none',
        cursor: enabled ? 'pointer' : 'default',
        backgroundColor: hovered && enabled ? 'rgba(255,255,255,0.1)' : 'transparent',
        opacity: enabled ? 1 : 0.3,
        flexShrink: 0, padding: '0',
        transition: 'background-color 0.15s ease, opacity 0.15s ease',
      }}>
      <svg width="22" height="22" viewBox="0 0 24 24">
        <path d="M12 2 L22 21 L2 21 Z" fill="var(--q-accent-success)" />
      </svg>
    </button>
  )
}

// ── Status pill — shows agent status with color ──
function StatusPill({ label, kind }: { label: string; kind: string }) {
  const colorMap: Record<string, string> = {
    thinking: 'var(--q-status-thinking)',
    writing: 'var(--q-status-writing)',
    tool: 'var(--q-status-tool-call)',
    tool_call: 'var(--q-status-tool-call)',
    tool_result: 'var(--q-status-tool-result)',
    tool_error: 'var(--q-status-tool-error)',
    compacting: 'var(--q-status-compacting)',
    retrying: 'var(--q-status-retrying)',
    failed: 'var(--q-status-failed)',
    running: 'var(--q-status-running)',
  }
  const color = colorMap[kind] || 'var(--q-text)'
  return (
    <span style={{ color, fontSize: '12px', fontFamily: 'var(--font-code)', lineHeight: '1', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}