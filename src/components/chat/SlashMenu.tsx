// ============================================================
// SlashMenu — exact Flutter copy with keyboard navigation
// Forwarded ref exposes: navUp, navDown, navLeft, navRight, navEnter
// ============================================================

import { useState, useImperativeHandle, forwardRef, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Provider } from '../../types'
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Folder, FolderPlus, X, Sparkles } from '../icons'

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
  sessionKey?: string
  chatAgentIds?: string[]
  onSelectModel: (model: string) => void
  onSelectThinking: (level: string) => void
  onReset: () => void
  onClose: () => void
  onSkillSelected?: (skill: { agentId: string; skillName: string; agentName: string }) => void
  onLongHorizon?: (activate: boolean) => void
  longHorizonActive?: boolean
  longHorizonStatus?: string
  longHorizonPlanProposed?: boolean
  onRequestPlan?: () => void
  onApprovePlan?: () => void
  onContinueDiscussing?: () => void
  onPauseLongHorizon?: () => void
  onResumeLongHorizon?: () => void
}

interface Command {
  id: string
  label: string
  description: string
}

type Mode = 'main' | 'model' | 'thinking' | 'directory' | 'skill' | 'reset_confirm' | 'longhorizon' | 'lh_confirm'

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(function SlashMenu(props, ref) {
  const [mode, setMode] = useState<Mode>('main')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [focusConfirm, setFocusConfirm] = useState(false)
  const [pendingLhCmd, setPendingLhCmd] = useState<string | null>(null)
  const [focusAdd, setFocusAdd] = useState(false)
  const [pendingModel, setPendingModel] = useState(props.selectedModel)
  const [pendingThinking, setPendingThinking] = useState(props.thinking)
  const [directories, setDirectories] = useState<string[]>([])
  const [skills, setSkills] = useState<any[]>([])
  const [skillGroups, setSkillGroups] = useState<any[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [pendingSkill, setPendingSkill] = useState<{ agentId: string; skillName: string; agentName: string } | null>(null)

  // Load current directory for this session from sidecar
  useEffect(() => {
    if (props.sessionKey) {
      const call = (window as any).__sidecarCall
      if (call) {
        call('getSessionMeta', { sessionKey: props.sessionKey }).then((meta: any) => {
          if (meta?.workingDir) {
            setDirectories([meta.workingDir])
          } else {
            setDirectories([])
          }
        }).catch(() => {})
      }
    } else {
      setDirectories([])
    }
  }, [props.sessionKey])

  const commands: Command[] = [
    { id: 'model', label: '/Model', description: 'Change model' },
    { id: 'thinking', label: '/Thinking', description: 'Change thinking' },
    { id: 'directory', label: '/Directory', description: 'Working directory' },
    { id: 'skill', label: '/Skill', description: 'Activate a skill' },
    { id: 'longhorizon', label: '/longhorizon', description: 'Activate or disable Long Horizon mode. When active, only Long Horizon slash commands are available.' },
    { id: 'reset', label: '/Reset', description: 'Clear messages. Keeps model, directory and settings.' },
  ]

  const lhCommands: Command[] = [
    { id: 'requestplan', label: '/request plan', description: 'Propose a plan for the goal' },
    { id: 'approveplan', label: '/approve plan', description: 'Approve the proposed plan and start' },
    { id: 'continuediscussing', label: '/continue discussing', description: 'Keep discussing without starting' },
    { id: 'pause', label: '/pause', description: 'Pause the automatic work' },
    { id: 'resume', label: '/resume', description: 'Resume the plan' },
  ]
  const visibleCommands: Command[] = props.longHorizonActive ? (() => {
    const base: Command[] = (() => {
      if (props.longHorizonStatus === 'running') return [{ id: 'pause', label: '/pause', description: 'Pause the automatic work' }]
      if (props.longHorizonStatus === 'paused') return [{ id: 'resume', label: '/resume', description: 'Resume the plan' }]
      if (props.longHorizonPlanProposed) return [{ id: 'approveplan', label: '/approve plan', description: 'Approve the proposed plan and start' }, { id: 'continuediscussing', label: '/continue discussing', description: 'Keep discussing without starting' }]
      return [{ id: 'requestplan', label: '/request plan', description: 'Propose a plan for the goal' }]
    })()
    return [...base, { id: 'disable', label: '/disable', description: 'Disable Long Horizon and restore normal commands' }]
  })() : commands
  const filteredCommands = visibleCommands.filter(cmd => cmd.id.includes(props.filter.toLowerCase()))
  const doLhAction = (id: string) => {
    console.log('[SLASH] doLhAction:', id)
    if (id === 'requestplan') props.onRequestPlan?.()
    else if (id === 'approveplan') props.onApprovePlan?.()
    else if (id === 'continuediscussing') props.onContinueDiscussing?.()
    else if (id === 'pause') props.onPauseLongHorizon?.()
    else if (id === 'resume') props.onResumeLongHorizon?.()
    else if (id === 'disable') props.onLongHorizon?.(false)
    else if (id === 'longhorizon') props.onLongHorizon?.(true)
    props.onClose()
  }
  const executeLhCommand = (id: string) => {
    if (id === 'disable' || id === 'longhorizon') { setMode('longhorizon'); setFocusConfirm(true); return }
    setPendingLhCmd(id); setMode('lh_confirm'); setFocusConfirm(true)
  }
  const lhCmdLabel = (id: string | null) => {
    if (id === 'requestplan') return 'Request a plan for the goal?'
    if (id === 'approveplan') return 'Approve the plan and start Long Horizon?'
    if (id === 'continuediscussing') return 'Continue discussing without starting?'
    if (id === 'pause') return 'Pause the automatic work?'
    if (id === 'resume') return 'Resume the plan?'
    return 'Confirm?'
  }

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
    if (m === 'skill') fetchSkills()
  }

  const confirm = () => {
    if (mode === 'model') props.onSelectModel(pendingModel)
    else if (mode === 'thinking') props.onSelectThinking(pendingThinking)
    else if (mode === 'longhorizon') props.onLongHorizon?.(!props.longHorizonActive)
    else if (mode === 'lh_confirm' && pendingLhCmd) { doLhAction(pendingLhCmd); return }
    props.onClose()
  }

  const fetchSkills = async () => {
    setSkillsLoading(true)
    try {
      const call = (window as any).__sidecarCall
      if (call) {
        const res = await call('listChatSkills', { agentIds: props.chatAgentIds || [] })
        setSkillGroups(res?.groups || [])
      }
    } catch (e) { console.error('Failed to fetch skills:', e) }
    setSkillsLoading(false)
  }

  const pickDirectory = async () => {
    try {
      const path = await invoke<string>('pick_directory')
      if (path && path !== 'cancelled') {
        setDirectories([path])
        const call = (window as any).__sidecarCall
        const sk = props.sessionKey || ''
        if (call && sk) {
          await call('setWorkingDir', { sessionKey: sk, path })
        } else {
          // Nessuna sessione ancora (welcome chat): salva come DEFAULT per le nuove chat
          try { const st = JSON.parse(localStorage.getItem('quinki-settings') || '{}'); st.defaultWorkingDir = path; localStorage.setItem('quinki-settings', JSON.stringify(st)) } catch {}
        }
        setFocusAdd(false)
        setFocusConfirm(true)
      }
    } catch (e) { console.error('Directory picker error:', e) }
  }

  const selectSkill = (skill: any, agentId: string, agentName: string) => {
    setPendingSkill({ agentId, skillName: skill.name, agentName })
    setFocusConfirm(true)
  }

  const confirmSkill = () => {
    if (pendingSkill) {
      props.onSkillSelected?.(pendingSkill)
    }
    props.onClose()
  }

  // Keyboard navigation exposed via ref
  useImperativeHandle(ref, () => ({
    navUp: () => {
      if (mode === 'main') setSelectedIdx(i => (i - 1 + filteredCommands.length) % filteredCommands.length)
      else if (mode === 'model') setSelectedIdx(i => (i - 1 + modelFlatIndex.length) % modelFlatIndex.length)
      else if (mode === 'thinking') setSelectedIdx(i => (i - 1 + 2) % 2)
      else if (mode === 'longhorizon') setSelectedIdx(i => (i - 1 + 2) % 2)
      else if (mode === 'skill') { const flat = skillGroups.flatMap((g: any) => g.skills.map((s: any) => ({ ...s, agentId: g.agentId, agentName: g.agentName }))); setSelectedIdx(i => (i - 1 + flat.length) % flat.length) }
      else if (mode === 'reset_confirm' || mode === 'lh_confirm') setFocusConfirm(false)
      setFocusConfirm(false)
    },
    navDown: () => {
      if (mode === 'main') setSelectedIdx(i => (i + 1) % filteredCommands.length)
      else if (mode === 'model') setSelectedIdx(i => (i + 1) % modelFlatIndex.length)
      else if (mode === 'thinking') setSelectedIdx(i => (i + 1) % 2)
      else if (mode === 'longhorizon') setSelectedIdx(i => (i + 1) % 2)
      else if (mode === 'skill') { const flat = skillGroups.flatMap((g: any) => g.skills.map((s: any) => ({ ...s, agentId: g.agentId, agentName: g.agentName }))); setSelectedIdx(i => (i + 1) % flat.length) }
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
      } else if (mode === 'longhorizon') {
        setFocusConfirm(true)
      } else if (mode === 'skill') {
        if (!focusConfirm) { const flat = skillGroups.flatMap((g: any) => g.skills.map((s: any) => ({ ...s, agentId: g.agentId, agentName: g.agentName }))); const s = flat[selectedIdx]; if (s) selectSkill(s, s.agentId, s.agentName) }
      } else if (mode === 'directory') {
        if (focusAdd) { setFocusAdd(false); setFocusConfirm(true) }
        else if (!focusConfirm) setFocusAdd(true)
      } else if (mode === 'reset_confirm') {
        if (!focusConfirm) setFocusConfirm(true)
      }
    },
    navEnter: () => {
      console.log('[SLASH] navEnter mode:', mode, 'selectedIdx:', selectedIdx, 'cmds:', filteredCommands.length)
      if (mode === 'main') {
        const cmd = filteredCommands[selectedIdx]
        if (props.longHorizonActive && cmd) { executeLhCommand(cmd.id); return }
        if (cmd?.id === 'reset') setMode('reset_confirm')
        else if (cmd) enterMode(cmd.id as Mode)
      } else if (mode === 'model') {
        if (focusConfirm) confirm()
        else { const m = modelFlatIndex[selectedIdx]; if (m) { setPendingModel(m); setFocusConfirm(true) } }
      } else if (mode === 'thinking') {
        if (focusConfirm) confirm()
        else { setPendingThinking(selectedIdx === 0 ? 'on' : 'off'); setFocusConfirm(true) }
      } else if (mode === 'longhorizon' || mode === 'lh_confirm') {
        if (focusConfirm) confirm()
        else setFocusConfirm(true)
      } else if (mode === 'skill') {
        if (focusConfirm) confirmSkill()
        else { const flat = skillGroups.flatMap((g: any) => g.skills.map((s: any) => ({ ...s, agentId: g.agentId, agentName: g.agentName }))); const s = flat[selectedIdx]; if (s) selectSkill(s, s.agentId, s.agentName) }
      } else if (mode === 'directory') {
        if (focusConfirm) confirm()
        else if (focusAdd) { pickDirectory() }
        else setFocusAdd(true)
      } else if (mode === 'reset_confirm') {
        if (focusConfirm) { props.onReset(); props.onClose() }
        else setFocusConfirm(true)
      } else if (mode === 'longhorizon') {
        if (focusConfirm) { props.onLongHorizon?.(!props.longHorizonActive); props.onClose() }
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
                  if (props.longHorizonActive) { executeLhCommand(cmd.id); return }
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
              if (props.longHorizonActive && cmd) { executeLhCommand(cmd.id); return }
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

      {/* Long Horizon action confirm */}
      {mode === 'lh_confirm' && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '12px' }}>{lhCmdLabel(pendingLhCmd)}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '4px 0 10px 0' }}>
            <HoverTextBtn
              label="Cancel"
              onClick={() => setMode('main')}
              textColor="var(--q-accent-danger)"
              hoverTextColor="var(--q-accent-danger)"
              hoverBg="rgba(255,255,255,0.06)"
            />
            <HoverTextBtn
              label="Confirm"
              highlighted={focusConfirm}
              onClick={() => { if (pendingLhCmd) doLhAction(pendingLhCmd) }}
              borderColor="var(--q-accent-longhorizon)"
              textColor="var(--q-accent-longhorizon)"
              hoverTextColor="var(--q-bg)"
              hoverBg="var(--q-accent-longhorizon)"
              fontWeight={600}
            />
          </div>
        </div>
      )}

      {/* Long Horizon mode — single confirm (Activate or Disable depending on state) */}
      {mode === 'longhorizon' && (
        <div style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', marginBottom: '4px' }}>
            {props.longHorizonActive ? 'Disable Long Horizon?' : 'Activate Long Horizon?'}
          </div>
          <div style={{ color: 'var(--q-text-secondary)', fontSize: '12px', fontFamily: 'var(--font-interface)', marginBottom: '8px', lineHeight: 1.5 }}>
            {props.longHorizonActive
              ? 'The support agent will stop guiding the session and the normal slash commands will be restored.'
              : 'Long Horizon makes the session work autonomously through a plan. The support agent reads the plan and handoff files, sends "continue" prompts as user bubbles, commits progress to git, and stops if it detects loops. When active, the normal slash commands are disabled — you can only use the Long Horizon commands (/request plan, /approve plan, /continue discussing, /pause, /resume).'}
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
              label={props.longHorizonActive ? 'Disable' : 'Activate'}
              highlighted={focusConfirm}
              onClick={() => { props.onLongHorizon?.(!props.longHorizonActive); props.onClose() }}
              borderColor="var(--q-accent-longhorizon)"
              textColor="var(--q-accent-longhorizon)"
              hoverTextColor="var(--q-bg)"
              hoverBg="var(--q-accent-longhorizon)"
              fontWeight={600}
            />
          </div>
        </div>
      )}

      {/* Skill mode — grouped by agent */}
      {mode === 'skill' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {skillsLoading && (
              <div style={{ padding: '16px', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>Loading skills…</div>
            )}
            {!skillsLoading && skillGroups.length === 0 && (
              <div style={{ padding: '16px', color: 'var(--q-text-tertiary)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>No skills available for the agents in this chat</div>
            )}
            {!skillsLoading && (() => {
              let runningIdx = 0;
              return skillGroups.map((group: any) => (
                <div key={group.agentId}>
                  <div style={{ padding: '8px 16px 4px 16px', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' }}>
                    {group.agentName}
                  </div>
                  {group.skills.map((skill: any) => {
                    const idx = runningIdx++;
                    return (
                      <MenuItem
                        key={group.agentId + '-' + skill.name}
                        label={skill.name}
                        isSelected={idx === selectedIdx}
                        isChecked={pendingSkill?.skillName === skill.name && pendingSkill?.agentId === group.agentId}
                        trailing={skill.description?.slice(0, 40)}
                        onHover={() => setSelectedIdx(idx)}
                        onTap={() => selectSkill(skill, group.agentId, group.agentName)}
                      />
                    );
                  })}
                </div>
              ));
            })()}
          </div>
          <NavBar
            focusConfirm={focusConfirm}
            onUp={() => { const flat = skillGroups.flatMap((g: any) => g.skills); setSelectedIdx(i => (i - 1 + flat.length) % flat.length); setFocusConfirm(false) }}
            onDown={() => { const flat = skillGroups.flatMap((g: any) => g.skills); setSelectedIdx(i => (i + 1) % flat.length); setFocusConfirm(false) }}
            onLeft={() => enterMode('main')}
            onRight={() => { const flat = skillGroups.flatMap((g: any) => g.skills.map((s: any) => ({ ...s, agentId: g.agentId, agentName: g.agentName }))); const s = flat[selectedIdx]; if (s) selectSkill(s, s.agentId, s.agentName) }}
            onConfirm={confirmSkill}
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
              onClick={pickDirectory}
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
            onRight={() => { if (focusAdd) { pickDirectory() } else if (!focusConfirm) setFocusAdd(true) }}
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

// ── Model/thinking/skill item: label left, trailing right ──
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
        <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-code)', marginLeft: '8px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
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