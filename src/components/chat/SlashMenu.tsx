// ============================================================
// SlashMenu — exact Flutter copy with keyboard navigation
// Forwarded ref exposes: navUp, navDown, navLeft, navRight, navEnter
// ============================================================

import { useState, useImperativeHandle, forwardRef, useRef, useEffect } from 'react'
import type { Provider } from '../../types'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Folder, FolderPlus,  X } from '../icons'

export interface SlashMenuRef {
  navUp: () => void
  navDown: () => void
  navLeft: () => void
  navRight: () => void
  navEnter: () => void
}

interface SlashMenuProps {
  filter: string
  providers: Provider[]
  selectedModel: string
  thinking: string
  onSelectModel: (model: string) => void
  onSelectThinking: (level: string) => void
  onReset: () => void
  onClose: () => void
}

interface Command {
  id: string
  label: string
  description: string
}

type Mode = 'main' | 'model' | 'thinking' | 'directory' | 'reset_confirm'

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(function SlashMenu(props, ref) {
  const [mode, setMode] = useState<Mode>('main')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [focusConfirm, setFocusConfirm] = useState(false)
  const [focusAdd, setFocusAdd] = useState(false)
  const [pendingModel, setPendingModel] = useState(props.selectedModel)
  const [pendingThinking, setPendingThinking] = useState(props.thinking)
  const [directories, setDirectories] = useState<string[]>([])

  const commands: Command[] = [
    { id: 'model', label: '/Model', description: 'Change model' },
    { id: 'thinking', label: '/Thinking', description: 'Change thinking' },
    { id: 'directory', label: '/Directory', description: 'Working directory' },
    { id: 'reset', label: '/Reset', description: 'Clear messages. Keeps model, directory and settings.' },
  ]

  const filteredCommands = commands.filter(cmd => cmd.id.includes(props.filter.toLowerCase()))

  // All models grouped by provider
  const allModels = props.providers.flatMap(p => p.models.map(m => ({ id: m.id, name: m.name, contextWindow: m.contextWindow, provider: p.name })))
  const filteredModels = props.filter === '' || mode !== 'model'
    ? allModels
    : allModels.filter(m => m.id.toLowerCase().includes(props.filter.toLowerCase()))

  const byProvider: Record<string, typeof allModels> = {}
  for (const m of filteredModels) {
    if (!byProvider[m.provider]) byProvider[m.provider] = []
    byProvider[m.provider].push(m)
  }
  const providerEntries = Object.entries(byProvider)
  const modelFlatIndex = providerEntries.flatMap(([, models]) => models.map(m => m.id))

  const fmtCtx = (cw?: number) => {
    if (!cw || cw === 0) return '—'
    if (cw >= 1000000) { const m = Math.round(cw / 100000) / 10; return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M` }
    if (cw >= 1000) return `${Math.floor(cw / 1000)}K`
    return `${cw}`
  }

  const enterMode = (m: Mode) => {
    setMode(m); setSelectedIdx(0); setFocusConfirm(false); setFocusAdd(false)
  }

  const confirm = () => {
    if (mode === 'model') props.onSelectModel(pendingModel)
    else if (mode === 'thinking') props.onSelectThinking(pendingThinking)
    props.onClose()
  }

  // Keyboard navigation exposed via ref
  useImperativeHandle(ref, () => ({
    navUp: () => {
      if (mode === 'main') setSelectedIdx(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
      else if (mode === 'model') setSelectedIdx(i => (i - 1 + modelFlatIndex.length) % modelFlatIndex.length)
      else if (mode === 'thinking') setSelectedIdx(i => (i - 1 + 2) % 2)
      else if (mode === 'reset_confirm') setFocusConfirm(false)
      setFocusConfirm(false)
    },
    navDown: () => {
      if (mode === 'main') setSelectedIdx(i => (i + 1) % filteredCommands.length)
      else if (mode === 'model') setSelectedIdx(i => (i + 1) % modelFlatIndex.length)
      else if (mode === 'thinking') setSelectedIdx(i => (i + 1) % 2)
      else if (mode === 'directory' && !focusAdd && !focusConfirm) setFocusAdd(true)
      else if (mode === 'directory' && focusAdd) { setFocusAdd(false); setFocusConfirm(true) }
      setFocusConfirm(false)
    },
    navLeft: () => {
      if (mode === 'reset_confirm') setMode('main')
      else if (focusConfirm) setFocusConfirm(false)
      else if (mode !== 'main') enterMode('main')
    },
    navRight: () => {
      if (mode === 'main') {
        const cmd = filteredCommands[selectedIdx]
        if (cmd?.id === 'reset') setMode('reset_confirm')
        else if (cmd) enterMode(cmd.id as Mode)
      } else if (mode === 'model') {
        const m = modelFlatIndex[selectedIdx]
        if (m) { setPendingModel(m); setFocusConfirm(true) }
      } else if (mode === 'thinking') {
        setPendingThinking(selectedIdx === 0 ? 'on' : 'off'); setFocusConfirm(true)
      } else if (mode === 'directory') {
        if (focusAdd) { setFocusAdd(false); setFocusConfirm(true) }
        else if (!focusConfirm) setFocusAdd(true)
      } else if (mode === 'reset_confirm') {
        if (!focusConfirm) setFocusConfirm(true)
      }
    },
    navEnter: () => {
      if (mode === 'main') {
        const cmd = filteredCommands[selectedIdx]
        if (cmd?.id === 'reset') setMode('reset_confirm')
        else if (cmd) enterMode(cmd.id as Mode)
      } else if (mode === 'model') {
        if (focusConfirm) confirm()
        else { const m = modelFlatIndex[selectedIdx]; if (m) { setPendingModel(m); setFocusConfirm(true) } }
      } else if (mode === 'thinking') {
        if (focusConfirm) confirm()
        else { setPendingThinking(selectedIdx === 0 ? 'on' : 'off'); setFocusConfirm(true) }
      } else if (mode === 'directory') {
        if (focusConfirm) confirm()
        else if (focusAdd) { /* would open file picker */ }
        else setFocusAdd(true)
      } else if (mode === 'reset_confirm') {
        if (focusConfirm) { props.onReset(); props.onClose() }
        else setFocusConfirm(true)
      }
    },
  }))

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 8px)',
        left: '0',
        right: '0',
        zIndex: 50,
        backgroundColor: 'var(--q-bg-panel)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-floating)',
        maxHeight: '400px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Main mode */}
      {mode === 'main' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {filteredCommands.map((cmd, idx) => (
              <MainMenuItem
                key={cmd.id}
                label={cmd.label}
                description={cmd.description}
                isSelected={idx === selectedIdx}
                onHover={() => setSelectedIdx(idx)}
                onTap={() => {
                  if (cmd.id === 'reset') setMode('reset_confirm')
                  else enterMode(cmd.id as Mode)
                }}
              />
            ))}
          </div>
          <NavBar
            focusConfirm={false}
            onUp={() => setSelectedIdx(i => (i - 1 + filteredCommands.length) % filteredCommands.length)}
            onDown={() => setSelectedIdx(i => (i + 1) % filteredCommands.length)}
            onLeft={() => {}}
            onRight={() => {
              const cmd = filteredCommands[selectedIdx]
              if (cmd?.id === 'reset') setMode('reset_confirm')
              else if (cmd) enterMode(cmd.id as Mode)
            }}
            onConfirm={confirm}
            onClose={props.onClose}
          />
        </>
      )}

      {/* Model mode */}
      {mode === 'model' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {providerEntries.map(([provider, models]) => (
              <div key={provider}>
                <div style={{ padding: '8px 16px 4px 16px', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
                  {provider}
                </div>
                {models.map(m => {
                  const idx = modelFlatIndex.indexOf(m.id)
                  return (
                    <MenuItem
                      key={m.id}
                      label={m.id}
                      isSelected={idx === selectedIdx}
                      isChecked={m.id === pendingModel}
                      trailing={`${fmtCtx(m.contextWindow)} ctx`}
                      onHover={() => setSelectedIdx(idx)}
                      onTap={() => { setPendingModel(m.id); setFocusConfirm(true) }}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <NavBar
            focusConfirm={focusConfirm}
            onUp={() => { setSelectedIdx(i => (i - 1 + modelFlatIndex.length) % modelFlatIndex.length); setFocusConfirm(false) }}
            onDown={() => { setSelectedIdx(i => (i + 1) % modelFlatIndex.length); setFocusConfirm(false) }}
            onLeft={() => enterMode('main')}
            onRight={() => { const m = modelFlatIndex[selectedIdx]; if (m) { setPendingModel(m); setFocusConfirm(true) } }}
            onConfirm={confirm}
            onClose={props.onClose}
          />
        </>
      )}

      {/* Thinking mode */}
      {mode === 'thinking' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            <MenuItem
              label={`On (xhigh)`}
              isSelected={selectedIdx === 0}
              isChecked={pendingThinking !== 'off'}
              onHover={() => setSelectedIdx(0)}
              onTap={() => { setPendingThinking('on'); setFocusConfirm(true) }}
            />
            <MenuItem
              label="Off"
              isSelected={selectedIdx === 1}
              isChecked={pendingThinking === 'off'}
              onHover={() => setSelectedIdx(1)}
              onTap={() => { setPendingThinking('off'); setFocusConfirm(true) }}
            />
          </div>
          <NavBar
            focusConfirm={focusConfirm}
            onUp={() => { setSelectedIdx(i => (i - 1 + 2) % 2); setFocusConfirm(false) }}
            onDown={() => { setSelectedIdx(i => (i + 1) % 2); setFocusConfirm(false) }}
            onLeft={() => enterMode('main')}
            onRight={() => { setPendingThinking(selectedIdx === 0 ? 'on' : 'off'); setFocusConfirm(true) }}
            onConfirm={confirm}
            onClose={props.onClose}
          />
        </>
      )}

      {/* Directory mode — exact Flutter layout */}
      {mode === 'directory' && (
        <>
          <div style={{ height: '4px' }} />
          <div style={{ overflowY: 'auto' }}>
            {directories.map((dir) => {
              const dirName = dir.split('/').pop() || dir
              return (
                <div key={dir} style={{ padding: '4px 16px' }}>
                  <div style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--q-bg)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    <Folder size={16} style={{ color: 'var(--q-text-secondary)', flexShrink: 0 }} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dirName}</span>
                      <span style={{ color: 'var(--q-text-tertiary)', fontSize: 'var(--fs-11)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir}</span>
                    </div>
                    <button onClick={() => setDirectories(d => d.filter(d2 => d2 !== dir))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--q-text-tertiary)', display: 'flex', flexShrink: 0 }}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ padding: '4px 16px' }}>
            <button
              onClick={() => {}}
              onMouseEnter={() => setFocusAdd(true)}
              onMouseLeave={() => setFocusAdd(false)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
                padding: '10px 20px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                backgroundColor: focusAdd ? 'var(--q-accent-primary)' : 'var(--q-accent-primary-soft)',
                color: focusAdd ? 'var(--q-bg)' : 'var(--q-text)',
                fontSize: '16px', fontFamily: 'var(--font-interface)',
                transition: 'none',
              }}
            >
              <FolderPlus size={14} />
              {directories.length === 0 ? 'Add directory' : 'Change directory'}
            </button>
          </div>
          <NavBar
            focusConfirm={focusConfirm}
            onUp={() => { setFocusConfirm(false); setFocusAdd(false) }}
            onDown={() => { if (!focusAdd && !focusConfirm) setFocusAdd(true); else if (focusAdd) { setFocusAdd(false); setFocusConfirm(true) } }}
            onLeft={() => enterMode('main')}
            onRight={() => { if (focusAdd) { setFocusAdd(false); setFocusConfirm(true) } else if (!focusConfirm) setFocusAdd(true) }}
            onConfirm={confirm}
            onClose={props.onClose}
          />
        </>
      )}

      {/* Reset confirm mode */}
      {mode === 'reset_confirm' && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '4px' }}>
            Reset session? All messages will be deleted.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '4px 0 10px 0' }}>
            <HoverTextBtn
              label="Cancel"
              onClick={() => setMode('main')}
              
              textColor="var(--q-accent-danger)"
              hoverTextColor="var(--q-accent-danger)"
              hoverBg="rgba(255,255,255,0.06)"
            />
            <HoverTextBtn
              label="Reset"
              highlighted={focusConfirm}
              onClick={() => { props.onReset(); props.onClose() }}
              borderColor="var(--q-tab-accent)"
              textColor="var(--q-tab-accent)"
              hoverTextColor="var(--q-bg)"
              hoverBg="var(--q-tab-accent)"
              fontWeight={600}
            />
          </div>
        </div>
      )}
    </div>
  )
})

// ── Main menu item: label left, description right ──
function MainMenuItem({ label, description, isSelected, onHover, onTap }: {
  label: string; description: string; isSelected: boolean; onHover: () => void; onTap: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const showHighlight = hovered || isSelected
  return (
    <div
      onClick={onTap}
      onMouseEnter={() => { setHovered(true); onHover() }}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 16px',
        backgroundColor: showHighlight ? 'rgba(255,255,255,0.06)' : 'transparent',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        transition: 'none',
      }}
    >
      <span style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)' }}>{label}</span>
      <span style={{ flex: 1 }} />
      <span style={{ color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{description}</span>
    </div>
  )
}

// ── Model/thinking item: label left, trailing right ──
function MenuItem({ label, isSelected, isChecked, trailing, onHover, onTap }: {
  label: string; isSelected: boolean; isChecked?: boolean; trailing?: string; onHover: () => void; onTap: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const showHighlight = hovered || isSelected
  const itemRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (isSelected && itemRef.current) itemRef.current.scrollIntoView({ block: 'nearest' }) }, [isSelected])
  return (
    <div
      ref={itemRef}
      onClick={onTap}
      onMouseEnter={() => { setHovered(true); onHover() }}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '8px 16px',
        backgroundColor: showHighlight ? 'rgba(255,255,255,0.06)' : 'transparent',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        transition: 'none',
      }}
    >
      <span style={{ color: isChecked ? 'var(--q-tab-accent)' : 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {label}
      </span>
      {trailing && (
        <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', marginLeft: '8px', flexShrink: 0 }}>
          {trailing}
        </span>
      )}
    </div>
  )
}

// ── NavBar: 4 arrows + Cancel + Confirm ──
function NavBar({ focusConfirm, onUp, onDown, onLeft, onRight, onConfirm, onClose }: {
  focusConfirm: boolean; onUp: () => void; onDown: () => void; onLeft: () => void; onRight: () => void; onConfirm: () => void; onClose: () => void
}) {
  return (
    <div style={{ padding: '8px 16px 10px 16px', display: 'flex', alignItems: 'center', gap: '4px' }}>
      <ArrowBtn icon={ChevronUp} onClick={onUp} />
      <ArrowBtn icon={ChevronDown} onClick={onDown} />
      <ArrowBtn icon={ChevronLeft} onClick={onLeft} />
      <ArrowBtn icon={ChevronRight} onClick={onRight} />
      <span style={{ flex: 1 }} />
      <HoverTextBtn
        label="Cancel"
        onClick={onClose}
        
        textColor="var(--q-accent-danger)"
        hoverTextColor="var(--q-accent-danger)"
        hoverBg="rgba(255,255,255,0.06)"
      />
      <div style={{ width: '8px' }} />
      <HoverTextBtn
        label="Confirm"
        highlighted={focusConfirm}
        onClick={onConfirm}
        borderColor="var(--q-tab-accent)"
        textColor="var(--q-tab-accent)"
        hoverTextColor="var(--q-bg)"
        hoverBg="var(--q-tab-accent)"
        fontWeight={600}
      />
    </div>
  )
}

// ── Arrow button: 6px padding, 14px icon ──
function ArrowBtn({ icon: Icon, onClick }: { icon: React.FC<{ size?: number; style?: React.CSSProperties }>; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '6px', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
        backgroundColor: hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        color: hovered ? 'var(--q-text)' : 'var(--q-text-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'none',
      }}
    >
      <Icon size={14} />
    </button>
  )
}

// ── Hover text button: border + text, bg fills on hover/highlight ──
function HoverTextBtn({ label, highlighted, onClick, borderColor, textColor, hoverTextColor, hoverBg, fontWeight }: {
  label: string; highlighted?: boolean; onClick: () => void
  borderColor?: string; textColor: string; hoverTextColor: string; hoverBg: string; fontWeight?: number
}) {
  const [hovered, setHovered] = useState(false)
  const active = hovered || highlighted
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '7px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        border: `1px solid ${borderColor || 'var(--q-border)'}`,
        backgroundColor: active ? hoverBg : 'transparent',
        color: active ? hoverTextColor : textColor,
        fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: fontWeight || 400,
        transition: 'none',
      }}
    >
      {label}
    </button>
  )
}