import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { ArrowDown, Bot, ChevronDown, ChevronRight, ChevronUp, Paperclip } from '../icons'
import { ModelPicker, type ModelPickerRef } from './ModelPicker'

export interface SlashMenuRef {
  navUp: () => void
  navDown: () => void
  navLeft: () => void
  navRight: () => void
  navEnter: () => void
}

interface SlashMenuProps {
  filter?: string
  providers?: any[]
  selectedModel?: string
  mode?: string
  thinking?: string
  contextTokens?: number
  contextWindow?: number
  isStreaming?: boolean
  statusLabel?: string
  statusKind?: string
  onSend: (text: string) => void
  onStop?: () => void
  onModelChange?: (model: string) => void
  onModeChange?: (mode: string) => void
  onThinkingChange?: (level: string) => void
  onReset?: () => void
  onClose?: () => void
  welcomeMode?: boolean
  agents?: any[]
  selectedAgentIds?: string[]
}

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(function SlashMenu(e, ref) {
  const [text, setText] = useState('')
  const [modelOpen, setModelOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const modelPickerRef = useRef<ModelPickerRef>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 280) + 'px'
    }
  }, [text])

  const availableAgents = (e.agents || []).filter((a: any) => (e.selectedAgentIds || []).includes(a.id))
  const filteredAgents = mentionFilter
    ? availableAgents.filter((a: any) => a.name.toLowerCase().includes(mentionFilter.toLowerCase()))
    : availableAgents

  useEffect(() => { setMentionIdx(0) }, [mentionFilter])

  const canSend = text.trim().length > 0 && !e.isStreaming

  const handleSend = () => {
    if (canSend) { e.onSend(text.trim()); setText(''); setModelOpen(false); setMentionOpen(false) }
  }

  const selectAgent = (agent: any) => {
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

  const handleKeyDown = (ev: React.KeyboardEvent) => {
    if (mentionOpen) {
      if (ev.key === 'ArrowUp') { ev.preventDefault(); setMentionIdx(i => (i - 1 + filteredAgents.length) % filteredAgents.length); return }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); setMentionIdx(i => (i + 1) % filteredAgents.length); return }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); filteredAgents[mentionIdx] && selectAgent(filteredAgents[mentionIdx]); return }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); filteredAgents[mentionIdx] && selectAgent(filteredAgents[mentionIdx]); return }
      if (ev.key === 'Escape') { ev.preventDefault(); setMentionOpen(false); setMentionFilter(''); return }
    }
    if (modelOpen) {
      if (ev.key === 'ArrowUp') { ev.preventDefault(); modelPickerRef.current?.navUp(); return }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); modelPickerRef.current?.navDown(); return }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); modelPickerRef.current?.navLeft(); return }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); modelPickerRef.current?.navRight(); return }
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); modelPickerRef.current?.navEnter(); return }
      if (ev.key === 'Escape') { ev.preventDefault(); setModelOpen(false); setText(''); return }
    }
    ev.key === 'Enter' && !ev.shiftKey && (ev.preventDefault(), handleSend())
    ev.key === 'Escape' && (setModelOpen(false), setMentionOpen(false), setText(''))
  }

  useImperativeHandle(ref, () => ({
    navUp: () => modelPickerRef.current?.navUp(),
    navDown: () => modelPickerRef.current?.navDown(),
    navLeft: () => modelPickerRef.current?.navLeft(),
    navRight: () => modelPickerRef.current?.navRight(),
    navEnter: () => modelPickerRef.current?.navEnter(),
  }))

  const fmt = (n: number) => {
    if (n >= 1e6) { const m = n / 1e6; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (n >= 1e3) return `${Math.floor(n / 1e3)}K`
    return `${n}`
  }
  const typedTokens = Math.ceil(text.length / 4)
  const total = (e.contextTokens || 0) + typedTokens
  const pct = (e.contextWindow || 0) > 0 ? (total / (e.contextWindow || 1)) * 100 : 0
  const counterColor = pct >= 80 ? 'var(--q-accent-danger)' : pct >= 50 ? 'var(--q-accent-warning)' : 'var(--q-text)'
  const counterText = (e.contextWindow || 0) > 0
    ? `${fmt(total)}/${fmt(e.contextWindow || 0)} (${Math.floor(pct)}% ± ${Math.ceil(pct * 0.05 + 1)}%)`
    : `${fmt(total)} tokens`

  return (
    <div className="w-full relative">
      {modelOpen && (
        <ModelPicker
          ref={modelPickerRef}
          filter={modelFilter}
          providers={e.providers}
          selectedModel={e.selectedModel}
          thinking={e.thinking}
          onSelectModel={(m: string) => { e.onModelChange?.(m); setModelOpen(false); setText('') }}
          onSelectThinking={(t: string) => { e.onThinkingChange?.(t); setModelOpen(false); setText('') }}
          onReset={() => { e.onReset?.(); setModelOpen(false); setText('') }}
          onClose={() => { setModelOpen(false); setText('') }}
        />
      )}
      {mentionOpen && filteredAgents.length > 0 && (
        <MentionPicker agents={filteredAgents} selectedIdx={mentionIdx} onSelect={selectAgent} onClose={() => { setMentionOpen(false); setMentionFilter('') }} />
      )}

      <div className="bg-bg-panel rounded-lg shadow-floating p-2 flex flex-col">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(ev) => {
            const val = ev.target.value
            setText(val)
            if (val.startsWith('/') && !val.includes(' ')) { setModelOpen(true); setModelFilter(val.slice(1)); setMentionOpen(false) }
            else { setModelOpen(false); setModelFilter('') }
            if (val.startsWith('@') && !val.includes(' ') && !val.includes('\n')) { setMentionOpen(true); setMentionFilter(val.slice(1)); setModelOpen(false) }
            else if (!val.startsWith('@')) { setMentionOpen(false); setMentionFilter('') }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          className="w-full min-h-[40px] max-h-[280px] bg-transparent text-text text-16 font-interface resize-none outline-none border-none p-2"
          style={{ caretColor: 'var(--q-accent-info)', lineHeight: '24px' }}
          rows={1}
        />

        <div className="flex flex-row items-center h-8 mt-2">
          <SlashBtn color="var(--q-accent-info)" onClick={() => { setModelOpen(true); setModelFilter(''); setText('/'); textareaRef.current?.focus() }} />
          <div className="w-1 shrink-0" />
          <ModeButton mode={e.mode} onChange={e.onModeChange} />
          <div className="w-2 shrink-0" />
          <div className="h-8 flex items-center">
            <span className="text-12 font-code leading-none whitespace-nowrap" style={{ color: counterColor }}>
              {counterText}
            </span>
          </div>
          <div className="flex-1" />
          {e.isStreaming && e.statusLabel && (
            <div className="h-8 flex items-center mr-2">
              <StatusPill label={e.statusLabel} kind={e.statusKind || 'thinking'} />
            </div>
          )}
          <AttachBtn onClick={() => {}} title="Attach file"><Paperclip size={20} /></AttachBtn>
          <div className="w-2 shrink-0" />
          <StopBtn color="var(--q-accent-danger)" onClick={e.isStreaming ? e.onStop : () => {}} />
          <div className="w-2 shrink-0" />
          <SendButton enabled={canSend} onClick={handleSend} />
        </div>
      </div>
    </div>
  )
})

// ── Mention picker (@agent) ──
function MentionPicker({ agents, selectedIdx, onSelect, onClose }: any) {
  return (
    <>
      <div className="fixed inset-0 z-overlay" onClick={onClose} />
      <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-dropdown bg-bg-panel rounded-lg shadow-floating max-h-[250px] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto py-1">
          {agents.map((agent: any, i: number) => (
            <MentionItem key={agent.id} agent={agent} isSelected={i === selectedIdx} onSelect={() => onSelect(agent)} />
          ))}
        </div>
        <div className="px-4 pb-2.5 pt-2 flex items-center gap-1">
          <SmallIconBtn><ChevronUp size={14} /></SmallIconBtn>
          <SmallIconBtn><ChevronDown size={14} /></SmallIconBtn>
          <SmallIconBtn><ChevronRight size={14} /></SmallIconBtn>
        </div>
      </div>
    </>
  )
}

function MentionItem({ agent, isSelected, onSelect }: any) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onSelect} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="px-4 py-2 rounded-sm cursor-pointer flex items-center gap-2"
      style={{
        backgroundColor: hovered || isSelected ? 'var(--q-hover)' : 'transparent',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      <Bot size={16} className="text-text-secondary shrink-0" />
      <span className="text-text text-14 font-interface">{agent.name}</span>
    </div>
  )
}

function SmallIconBtn({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="p-1.5 border-none cursor-pointer rounded-sm flex items-center justify-center"
      style={{
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        transition: 'transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      {children}
    </button>
  )
}

function SlashBtn({ color, onClick }: { color: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="w-8 h-8 flex items-center justify-center rounded-md border-none cursor-pointer shrink-0 p-0"
      style={{
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        backgroundColor: hovered ? 'var(--q-active)' : 'transparent',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      <svg width="22" height="22" viewBox="0 0 24 24" shapeRendering="geometricPrecision">
        <rect x="2" y="2" width="20" height="20" rx="2" fill={color} />
        <line x1="7" y1="17" x2="17" y2="7" stroke="var(--q-bg)" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    </button>
  )
}

function StopBtn({ color, onClick }: { color: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="w-8 h-8 flex items-center justify-center rounded-lg border border-border cursor-pointer shrink-0 p-0"
      style={{
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        transition: 'background-color 180ms cubic-bezier(0.4, 0, 0.2, 1), transform 180ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
      <svg width="12" height="12" viewBox="0 0 12 12" shapeRendering="geometricPrecision">
        <rect width="12" height="12" rx="2" fill={color} />
      </svg>
    </button>
  )
}

function ModeButton({ mode, onChange }: { mode?: string; onChange?: (m: string) => void }) {
  const [hovered, setHovered] = useState(false)
  const isPlan = mode === 'plan'
  return (
    <button onClick={() => onChange?.(isPlan ? 'build' : 'plan')}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="w-12 h-8 flex items-center justify-center rounded-md border-none cursor-pointer font-bold text-14 font-interface leading-none shrink-0 p-0"
      style={{
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: isPlan ? 'var(--q-mode-plan)' : 'var(--q-mode-build)',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      {isPlan ? 'Plan' : 'Build'}
    </button>
  )
}

function AttachBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      className="w-8 h-8 flex items-center justify-center rounded-md border-none cursor-pointer shrink-0 p-0"
      style={{
        transform: hovered ? 'scale(1.02)' : 'scale(1)',
        backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1), transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      {children}
    </button>
  )
}

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
      className="w-8 h-8 flex items-center justify-center rounded-lg border-none shrink-0 p-0"
      style={{
        cursor: enabled ? 'pointer' : 'default',
        transform: hovered && enabled ? 'scale(1.05)' : 'scale(1)',
        backgroundColor: enabled ? (hovered ? 'var(--q-accent-info-bright)' : 'var(--q-accent-info)') : 'var(--q-hover)',
        color: enabled ? '#FFFFFF' : 'var(--q-text-tertiary)',
        transition: 'background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1), transform 120ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
        stroke={enabled ? '#FFFFFF' : 'var(--q-text-tertiary)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    </button>
  )
}

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
    <span className="text-12 font-code leading-none whitespace-nowrap" style={{ color }}>
      {label}
    </span>
  )
}