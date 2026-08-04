// ============================================================
// Composer — Deep Cosmos redesign
// @agent mention, /slash commands, mode toggle, context counter,
// status pill, send button with pulse animation
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { getContrastColor } from '../../utils/contrast'
import type { Provider, Agent, ChatMode, ThinkingLevel } from '../../types'
import { Paperclip, ChevronUp, ChevronDown, Bot, X } from '../icons'
import { SlashMenu, type SlashMenuRef } from './SlashMenu'

interface ComposerProps {
  providers: Provider[]
  selectedModel: string
  mode: ChatMode
  thinking: string
  contextTokens: number
  contextWindow: number
  isStreaming: boolean
  isCompacting?: boolean
  statusLabel?: string
  statusKind?: string
  onSend: (text: string, opts?: { skillNames?: { agentId: string; skillName: string; agentName?: string }[] }) => void
  onStop: () => void
  onModelChange: (model: string) => void
  onModeChange: (mode: ChatMode) => void
  onThinkingChange: (level: ThinkingLevel) => void
  welcomeMode?: boolean
  agents?: Agent[]
  onReset?: () => void
  onAgentToggle?: (id: string) => void
  chatAgentIds?: string[]
  sessionKey?: string
}

export function Composer(props: ComposerProps) {
  const [text, setText] = useState('')
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const [pendingSkill, setPendingSkill] = useState<string | null>(null)
  const [pendingSkills, setPendingSkills] = useState<{ agentId: string; skillName: string; agentName: string }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slashMenuRef = useRef<SlashMenuRef>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 280) + 'px'
    }
  }, [text])

  // @mention: solo agenti NELLA CHAT (non tutti gli agenti configurati)
  const availableAgents = (props.agents || []).filter(a => {
    if (a.id === 'orchestrator') return false
    if (!props.chatAgentIds || props.chatAgentIds.length === 0) return false
    return props.chatAgentIds.includes(a.id)
  })
  const filteredAgents = mentionFilter
    ? availableAgents.filter(a => a.name.toLowerCase().includes(mentionFilter.toLowerCase()))
    : availableAgents

  useEffect(() => { setMentionIdx(0) }, [mentionFilter])

  const canSend = text.trim().length > 0 && !props.isStreaming

  const handleSend = () => {
    if (canSend) { props.onSend(text.trim(), { skillNames: pendingSkills.length > 0 ? pendingSkills.map(s => ({ agentId: s.agentId, skillName: s.skillName, agentName: s.agentName })) : undefined }); setText(''); setSlashMenuOpen(false); setMentionOpen(false); setPendingSkill(null); setPendingSkills([]) }
  }

  const selectAgent = (agent: Agent) => {
    // Only add agent to chat if not already there (don't toggle = remove)
    if (!props.chatAgentIds?.includes(agent.id)) {
      props.onAgentToggle?.(agent.id)
    }
    const mention = `@${agent.name} `
    setText(mention)
    setMentionOpen(false)
    setMentionFilter('')
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(mention.length, mention.length)
      }
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // @mention navigation
    if (mentionOpen) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + filteredAgents.length) % filteredAgents.length); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % filteredAgents.length); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); filteredAgents[mentionIdx] && selectAgent(filteredAgents[mentionIdx]); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); filteredAgents[mentionIdx] && selectAgent(filteredAgents[mentionIdx]); return }
      if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); setMentionFilter(''); return }
    }
    // Slash menu navigation
    if (slashMenuOpen) {
      if (e.key === 'ArrowUp') { e.preventDefault(); slashMenuRef.current?.navUp(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); slashMenuRef.current?.navDown(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); slashMenuRef.current?.navLeft(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); slashMenuRef.current?.navRight(); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); slashMenuRef.current?.navEnter(); return }
      if (e.key === 'Escape') { e.preventDefault(); setSlashMenuOpen(false); setText(''); return }
    }
    e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())
    // Esc: se sta generando → STOP (come il tasto stop). Altrimenti chiude menu/pulisce.
    e.key === 'Escape' && (props.isStreaming ? (e.preventDefault(), props.onStop()) : (setSlashMenuOpen(false), setMentionOpen(false), setText('')))
    // Tab: toggle Plan/Build (non inserire tab nel testo)
    if (e.key === 'Tab') { e.preventDefault(); props.onModeChange(props.mode === 'plan' ? 'build' : 'plan') }
  }

  const fmt = (n: number) => {
    if (n >= 1e6) { const m = Math.round(n / 1e5) / 10; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (n >= 1e3) return `${Math.floor(n / 1e3)}K`
    return `${n}`
  }
  const typedTokens = Math.ceil(text.length / 4)
  const total = props.contextTokens + typedTokens
  const pct = props.contextWindow > 0 ? (total / props.contextWindow) * 100 : 0
  const counterColor = pct >= 80 ? 'var(--q-accent-danger)' : pct >= 50 ? 'var(--q-accent-warning)' : 'var(--q-text-tertiary)'
  const counterText = props.contextWindow > 0
    ? `${fmt(total)}/${fmt(props.contextWindow)} (${Math.floor(pct)}% ± ${Math.ceil(pct * 0.05 + 1)}%)`
    : `${fmt(total)} tokens`

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {/* Slash command menu */}
      {slashMenuOpen && (
        <SlashMenu
          ref={slashMenuRef}
          filter={slashFilter}
          providers={props.providers}
          selectedModel={props.selectedModel}
          thinking={props.thinking}
          sessionKey={props.sessionKey}
          chatAgentIds={props.chatAgentIds}
          onSelectModel={(m) => { props.onModelChange(m); setSlashMenuOpen(false); if (text.startsWith('/') && !text.includes(' ')) setText('') }}
          onSelectThinking={(t) => { props.onThinkingChange(t as ThinkingLevel); setSlashMenuOpen(false); if (text.startsWith('/') && !text.includes(' ')) setText('') }}
          onReset={() => { props.onReset?.(); setSlashMenuOpen(false); if (text.startsWith('/') && !text.includes(' ')) setText('') }}
          onClose={() => { setSlashMenuOpen(false); if (text.startsWith('/') && !text.includes(' ')) setText('') }}
          onSkillSelected={(skill) => {
            // Add skill chip
            setPendingSkills(prev => [...prev, skill])
            setSlashMenuOpen(false)
            setTimeout(() => textareaRef.current?.focus(), 0)
          }}
        />
      )}
      {/* @mention agent picker */}
      {mentionOpen && filteredAgents.length > 0 && (
        <MentionPicker agents={filteredAgents} selectedIdx={mentionIdx} onSelect={selectAgent} onClose={() => { setMentionOpen(false); setMentionFilter('') }} />
      )}

      <div style={{
        backgroundColor: 'var(--q-bg-panel)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-floating)',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Skill chips */}
        {pendingSkills.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
            {pendingSkills.map((s, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 8px 3px 10px', borderRadius: '100px',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--q-border)',
                fontSize: '12px', fontFamily: 'var(--font-interface)',
                color: 'var(--q-text-secondary)',
              }}>
                <span style={{ color: 'var(--q-text)', fontWeight: 500 }}>{s.skillName}</span>
                <span style={{ color: 'var(--q-text-tertiary)', fontSize: '11px' }}>→ {s.agentName}</span>
                <button onClick={() => setPendingSkills(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', color: 'var(--q-text-tertiary)', display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => {
            const val = e.target.value
            setText(val)
            // Slash menu detection — only open if text starts with / AND text is just the slash command (no other text before it)
            if (val.startsWith('/') && !val.includes(' ') && text === '') {
              setSlashMenuOpen(true); setSlashFilter(val.slice(1)); setMentionOpen(false)
            } else if (val.startsWith('/') && !val.includes(' ') && text.startsWith('/')) {
              setSlashMenuOpen(true); setSlashFilter(val.slice(1)); setMentionOpen(false)
            } else {
              setSlashMenuOpen(false); setSlashFilter('')
            }
            // @mention detection
            if (val.startsWith('@') && !val.includes(' ') && !val.includes('\n')) {
              setMentionOpen(true); setMentionFilter(val.slice(1)); setSlashMenuOpen(false)
            } else if (!val.startsWith('@')) {
              setMentionOpen(false); setMentionFilter('')
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          style={{
            width: '100%', minHeight: '40px', maxHeight: '280px',
            backgroundColor: 'transparent', color: 'var(--q-text)',
            fontSize: '16px', lineHeight: '24px', fontFamily: 'var(--font-interface)',
            resize: 'none', outline: 'none', border: 'none',
            padding: '8px', caretColor: 'var(--q-tab-accent)',
          }}
          rows={1}
        />

        {/* Bottom bar */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: '32px', marginTop: '8px' }}>
          <SlashBtn color="var(--q-tab-accent)" onClick={() => { setSlashMenuOpen(true); setSlashFilter(''); if (!text.startsWith('/')) { /* don't clear text, just open menu */ } textareaRef.current?.focus() }} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <ModeButton mode={props.mode} onChange={props.onModeChange} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <div style={{ height: '32px', display: 'flex', alignItems: 'center' }}>
            <span style={{ color: counterColor, fontSize: '12px', fontFamily: 'var(--font-code)', lineHeight: '1', whiteSpace: 'nowrap' }}>
              {counterText}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {(props.isStreaming || (props as any).isCompacting) && props.statusLabel && (
            <div style={{ height: '32px', display: 'flex', alignItems: 'center', marginRight: '8px' }}>
              <StatusPill label={props.statusLabel} kind={props.statusKind || 'thinking'} />
            </div>
          )}
          <AttachBtn onClick={() => {}} title="Attach file"><Paperclip size={20} /></AttachBtn>
          <div style={{ width: '8px', flexShrink: 0 }} />
          <StopBtn color="var(--q-accent-danger)" onClick={props.isStreaming ? props.onStop : () => {}} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          <SendButton enabled={canSend} onClick={handleSend} />
        </div>
      </div>
    </div>
  )
}

// ── Mention picker (@agent) ──
function MentionPicker({ agents, selectedIdx, onSelect, onClose }: {
  agents: Agent[]; selectedIdx: number; onSelect: (a: Agent) => void; onClose: () => void
}) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={onClose} />
      <div style={{
        position: 'absolute', bottom: 'calc(100% + 8px)', left: '0', right: '0', zIndex: 50,
        backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-floating)', maxHeight: '250px',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {agents.map((agent, i) => (
            <MentionItem key={agent.id} agent={agent} isSelected={i === selectedIdx} onSelect={() => onSelect(agent)} />
          ))}
        </div>
        <div style={{ padding: '8px 16px 10px 16px', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <SmallIconBtn><ChevronUp size={14} /></SmallIconBtn>
          <SmallIconBtn><ChevronDown size={14} /></SmallIconBtn>
        </div>
      </div>
    </>
  )
}

function MentionItem({ agent, isSelected, onSelect }: { agent: Agent; isSelected: boolean; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onSelect} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 16px', backgroundColor: hovered || isSelected ? 'var(--q-hover)' : 'transparent',
        borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
        transition: 'none',
      }}>
      <Bot size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
      <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{agent.name}</span>
    </div>
  )
}

// ── Small icon button (for mention picker footer) ──
function SmallIconBtn({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'none',
      }}>
      {children}
    </button>
  )
}



// ── Slash button — 32x32, SVG with slash ──
function SlashBtn({ color, onClick }: { color: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-active)' : 'transparent',
        flexShrink: 0, padding: '0',
        transition: 'none',
      }}>
      <svg width="22" height="22" viewBox="0 0 24 24" shapeRendering="geometricPrecision">
        <rect x="2" y="2" width="20" height="20" rx="2" fill={color} />
        <line x1="7" y1="17" x2="17" y2="7" stroke="var(--q-bg)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </button>
  )
}

// ── Stop button — 32x32, small square ──
function StopBtn({ color, onClick }: { color: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: hovered ? 'scale(1.05)' : 'scale(1)', borderRadius: '8px',
        border: '1px solid var(--q-border)', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        flexShrink: 0, padding: '0',
        transition: 'none',
      }}>
      <svg width="12" height="12" viewBox="0 0 12 12" shapeRendering="geometricPrecision">
        <rect width="12" height="12" rx="2" fill={color} />
      </svg>
    </button>
  )
}

// ── Mode button — Plan/Build toggle ──
function ModeButton({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const [hovered, setHovered] = useState(false)
  const isPlan = mode === 'plan'
  return (
    <button onClick={() => onChange(isPlan ? 'build' : 'plan')}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '48px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: hovered ? 'scale(1.02)' : 'scale(1)', borderRadius: 'var(--radius-md)',
        border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: isPlan ? 'var(--q-mode-plan)' : 'var(--q-mode-build)',
        fontWeight: 700, fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: '1',
        flexShrink: 0, padding: '0',
        transition: 'none',
      }}>
      {isPlan ? 'Plan' : 'Build'}
    </button>
  )
}

// ── Attach button — 32x32 icon button ──
function AttachBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 'var(--radius-md)',
        border: 'none', cursor: 'pointer',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        flexShrink: 0, padding: '0',
        transition: 'none',
      }}>
      {children}
    </button>
  )
}

// ── Send button — 32x32, arrow icon, pulse on enable ──
function SendButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const prevEnabled = useRef(false)

  useEffect(() => {
    if (enabled && !prevEnabled.current && btnRef.current) {
      btnRef.current.classList.remove('q-send-pulse')
      btnRef.current.offsetWidth
      btnRef.current.classList.add('q-send-pulse')
    }
    prevEnabled.current = enabled
  }, [enabled])

  return (
    <button ref={btnRef} onClick={onClick} disabled={!enabled}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '8px',
        border: 'none', cursor: enabled ? 'pointer' : 'default',
        backgroundColor: enabled ? (hovered ? 'var(--q-tab-accent)' : 'var(--q-tab-accent-darker)') : 'var(--q-hover)',
        color: enabled ? getContrastColor('--q-tab-accent') : 'var(--q-text-tertiary)',
        flexShrink: 0, padding: '0',
        transition: 'none',
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke={enabled ? getContrastColor('--q-tab-accent') : 'var(--q-text-tertiary)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  )
}

// ── Status pill ──
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