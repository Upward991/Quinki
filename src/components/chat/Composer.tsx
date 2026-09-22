// ============================================================
// Composer — Deep Cosmos redesign
// @agent mention, /slash commands, mode toggle, context counter,
// status pill, send button with pulse animation, file attachments
// ============================================================

import { useState, useRef, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getContrastColor } from '../../utils/contrast'
import { useLayout } from '../../platform/layout'
import type { Provider, Agent, ChatMode, ThinkingLevel } from '../../types'
import { Paperclip, ChevronUp, ChevronDown, Bot, X, Clock, Folder, FileText } from '../icons'
import { SlashMenu, type SlashMenuRef } from './SlashMenu'
import { BottomSheet, SheetRow } from './BottomSheet'

export interface Attachment {
  originalName: string
  path: string
  uuid: string
  size?: number
}

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
  onSend: (text: string, opts?: { skillNames?: { agentId: string; skillName: string; agentName?: string }[]; attachments?: Attachment[]; taskClips?: { id: string; label: string; text: string }[] }) => void
  onStop: () => void
  onSteer?: (text: string) => void
  longHorizon?: boolean
  longHorizonStatus?: string
  longHorizonPhase?: string
  longHorizonPlanProposed?: boolean
  onLongHorizon?: (activate: boolean) => void
  onRequestPlan?: (text: string) => void
  onApprovePlan?: () => void
  onContinueDiscussing?: () => void
  onPauseLongHorizon?: () => void
  onResumeLongHorizon?: () => void
  onModelChange: (model: string) => void
  onModeChange: (mode: ChatMode) => void
  onThinkingChange: (level: ThinkingLevel) => void
  welcomeMode?: boolean
  agents?: Agent[]
  onReset?: () => void
  onAgentToggle?: (id: string) => void
  chatAgentIds?: string[]
  sessionKey?: string
  onEnsureSession?: () => Promise<string | null>
  onHeightChange?: (h: number) => void
  onHeightChangeNow?: (h: number) => void
  attachSignal?: number
  onBackToMenu?: () => void
}

// Telefono web: layout mobile o puntatore coarse fuori da Tauri.
function isPhoneWeb(): boolean {
  try {
    if ((window as any).__TAURI_INTERNALS__) return false
    if (window.innerWidth <= 600) return true
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  } catch { return false }
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
  const [pendingTaskClips, setPendingTaskClips] = useState<{ id: string; label: string; text: string }[]>([])
  useEffect(() => {
    const onClip = (e: any) => {
      const d = e?.detail
      if (d && d.id && d.label) setPendingTaskClips(prev => prev.some(x => x.id === d.id) ? prev : [...prev, { id: d.id, label: d.label, text: d.text || '' }])
    }
    window.addEventListener('quinki-task-clip', onClip)
    return () => window.removeEventListener('quinki-task-clip', onClip)
  }, [])
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([])
  const [cameraOpen, setCameraOpen] = useState(false)

  // Persistenza dei chip allegati: se la pagina si ricarica (Android, ritorno
  // dalla fotocamera) i chip non si perdono e la foto resta allegata.
  useEffect(() => {
    try {
      const k = 'quinki-pending-att-' + (props.sessionKey || '__welcome__')
      if (pendingAttachments.length > 0) localStorage.setItem(k, JSON.stringify(pendingAttachments))
      else localStorage.removeItem(k)
    } catch {}
  }, [pendingAttachments, props.sessionKey])
  useEffect(() => {
    (async () => {
      try {
        const k = 'quinki-pending-att-' + (props.sessionKey || '__welcome__')
        const raw = localStorage.getItem(k)
        if (!raw) return
        const list = JSON.parse(raw)
        if (!Array.isArray(list) || list.length === 0) return
        const fixed: any[] = []
        for (const a of list) {
          try {
            if (a && a.path && String(a.path).indexOf('web-uploads') >= 0 && props.sessionKey) {
              const res: any = await invoke('copy_to_attachments', { srcPath: a.path, sessionKey: props.sessionKey })
              if (res) { fixed.push({ originalName: res.originalName, path: res.path, uuid: res.uuid, size: res.size }); continue }
            }
          } catch {}
          fixed.push(a)
        }
        if (fixed.length > 0) setPendingAttachments(prev => (prev.length > 0 ? prev : fixed))
      } catch {}
    })()
  }, [props.sessionKey])
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [attachMenuView, setAttachMenuView] = useState<'main' | 'existing'>('main')

  // === Mobile (visione telefono) ===
  // La graffetta esce dalla text box: l'allegato si apre dal menu in alto.
  const mob = useLayout().mode === 'mobile'
  const lastAttachSignal = useRef(props.attachSignal || 0)
  useEffect(() => {
    if (props.attachSignal && props.attachSignal !== lastAttachSignal.current) {
      lastAttachSignal.current = props.attachSignal
      setAttachMenuOpen(true)
      setAttachMenuView('main')
    }
  }, [props.attachSignal])
  const [sessionFilesOpen, setSessionFilesOpen] = useState(false)
  const [existingAttachments, setExistingAttachments] = useState<any[]>([])
  const [copyingFile, setCopyingFile] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const slashMenuRef = useRef<SlashMenuRef>(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 280) + 'px'
      props.onHeightChange?.(parseFloat(textareaRef.current.style.height) || 0)
      props.onHeightChangeNow?.(parseFloat(textareaRef.current.style.height) || 0)
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

  // FIX (22 set): un allegato da solo (senza testo) DEVE poter partire.
  const canSend = (text.trim().length > 0 || pendingAttachments.length > 0) && !props.isStreaming && !(props as any).isCompacting
  const canSteer = text.trim().length > 0 && props.isStreaming && !(props as any).isCompacting

  const handleSteer = () => {
    if (canSteer && props.onSteer) {
      props.onSteer(text.trim())
      setText('')
    }
  }

  const handleSend = () => {
    if (canSend) {
      props.onSend(text.trim(), {
        skillNames: pendingSkills.length > 0 ? pendingSkills.map(s => ({ agentId: s.agentId, skillName: s.skillName, agentName: s.agentName })) : undefined,
        attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
        taskClips: pendingTaskClips.length > 0 ? pendingTaskClips : undefined,
      })
      setText('')
      setSlashMenuOpen(false)
      setMentionOpen(false)
      setPendingSkill(null)
      setPendingSkills([])
      setPendingTaskClips([])
      setPendingAttachments([])
    }
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

  // === Attachment handling ===
  // FIX (22 set): in welcome/quick chat NIENTE sessione creata all'allegato (creava
  // una chat vuota in sidebar). Gli allegati vanno nella cartella draft __welcome__;
  // al primo invio il sidecar li sposta nella cartella della sessione vera (che nasce
  // al send, come per i messaggi di solo testo).
  const resolveSessionKey = async (): Promise<string> => {
    if (props.sessionKey) return props.sessionKey
    return '__welcome__'
  }

  const handlePickFiles = async () => {
    setAttachMenuOpen(false)
    const key = await resolveSessionKey()
    if (!key) { try { (window as any).__reportFrontendError?.('attach-no-session', 'handlePickFiles: resolveSessionKey ha restituito vuoto') } catch {}; return }
    try {
      const paths = await invoke('pick_files') as string[]
      if (!paths || paths.length === 0) return
      setCopyingFile(true)
      for (const p of paths) {
        const result = await invoke('copy_to_attachments', { srcPath: p, sessionKey: key }) as any
        if (result) {
          setPendingAttachments(prev => [...prev, {
            originalName: result.originalName,
            path: result.path,
            uuid: result.uuid,
            size: result.size,
          }])
        }
      }
    } catch (e: any) {
      if (e !== 'cancelled') console.error('pick_files error:', e)
    } finally {
      setCopyingFile(false)
    }
  }

  // FOTO dalla fotocamera del telefono (in-app, getUserMedia): l'input file nativo
  // apriva l'app fotocamera -> Android ricreava la PWA al ritorno (reload) e il file
  // andava perso. Cosi' resta tutto in pagina: scatto -> stesso upload dei file ->
  // copy_to_attachments -> chip. Zero reload, zero app esterne.
  const handleCameraPhoto = async (blob: Blob, name: string) => {
    setCameraOpen(false)
    const key = await resolveSessionKey()
    if (!key) return
    setCopyingFile(true)
    try {
      const r = await fetch('/upload?name=' + encodeURIComponent(name), { method: 'POST', body: blob })
      const j: any = await r.json().catch(() => null)
      if (j && j.ok && j.path) {
        const result = await invoke('copy_to_attachments', { srcPath: String(j.path), sessionKey: key }) as any
        if (result) {
          setPendingAttachments(prev => [...prev, {
            originalName: result.originalName,
            path: result.path,
            uuid: result.uuid,
            size: result.size,
          }])
        }
      } else {
        console.error('camera upload failed', j)
      }
    } catch (e: any) {
      console.error('camera upload error:', e)
    } finally {
      setCopyingFile(false)
    }
  }

  const handleOpenAttachmentsFolder = async () => {
    setAttachMenuOpen(false)
    const key = await resolveSessionKey()
    if (!key) return
    try {
      await invoke('open_attachments_folder', { sessionKey: key })
    } catch (e: any) {
      console.error('open_attachments_folder error:', e)
    }
  }

  const handleShowExisting = async () => {
    const key = await resolveSessionKey()
    if (!key) return
    setAttachMenuView('existing')
    try {
      const files = await invoke('list_attachments', { sessionKey: key }) as any[]
      setExistingAttachments(files || [])
    } catch (e: any) {
      console.error('list_attachments error:', e)
      setExistingAttachments([])
    }
  }

  const handleReAttach = (file: any) => {
    // Re-attach existing file — no copy needed, just create chip
    setPendingAttachments(prev => [...prev, {
      originalName: file.originalName,
      path: file.path,
      uuid: file.name.split('-')[0] || '',
      size: file.size,
    }])
    setAttachMenuOpen(false)
    setAttachMenuView('main')
  }

  // Expose methods for drag-drop from ChatArea
  useEffect(() => {
    // Path-based (from native file picker)
    (window as any).__quinkiAddAttachment = async (filePath: string) => {
      const key = await resolveSessionKey()
      if (!key) { try { (window as any).__reportFrontendError?.('attach-no-session', 'drop(path): resolveSessionKey ha restituito vuoto') } catch {}; return }
      setCopyingFile(true)
      try {
        const result = await invoke('copy_to_attachments', { srcPath: filePath, sessionKey: key }) as any
        if (result) {
          setPendingAttachments(prev => {
            if (prev.some(a => a.originalName === result.originalName && a.size === result.size)) return prev
            return [...prev, { originalName: result.originalName, path: result.path, uuid: result.uuid, size: result.size }]
          })
        }
      } catch (e: any) {
        console.error('drag-drop copy error:', e)
      } finally {
        setCopyingFile(false)
      }
    }
    // Content-based (from HTML5 drag-drop — no file path available in WKWebView)
    (window as any).__quinkiAddAttachmentFromContent = async (fileName: string, contentB64: string) => {
      const key = await resolveSessionKey()
      if (!key) { try { (window as any).__reportFrontendError?.('attach-no-session', 'drop(content): resolveSessionKey ha restituito vuoto') } catch {}; return }
      // Check for dup BEFORE copying
      let isDup = false
      setPendingAttachments(prev => { isDup = prev.some(a => a.originalName === fileName); return prev })
      if (isDup) return
      setCopyingFile(true)
      try {
        const result = await invoke('save_attachment_content', { fileName, contentB64, sessionKey: key }) as any
        if (result) {
          setPendingAttachments(prev => {
            if (prev.some(a => a.originalName === result.originalName)) return prev
            return [...prev, { originalName: result.originalName, path: result.path, uuid: result.uuid, size: result.size }]
          })
        }
      } catch (e: any) {
        console.error('drag-drop content error:', e)
      } finally {
        setCopyingFile(false)
      }
    }
  }, [props.sessionKey])

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
      console.log('[SLASH] key:', e.key, 'mode via ref:', !!slashMenuRef.current)
      if (e.key === 'ArrowUp') { e.preventDefault(); slashMenuRef.current?.navUp(); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); slashMenuRef.current?.navDown(); return }
      if (e.key === 'ArrowLeft') { e.preventDefault(); slashMenuRef.current?.navLeft(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); slashMenuRef.current?.navRight(); return }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); slashMenuRef.current?.navEnter(); return }
      if (e.key === 'Escape') { e.preventDefault(); setSlashMenuOpen(false); return }
    }
    e.key === 'Enter' && e.ctrlKey && (e.preventDefault(), handleSteer())
    // Sul telefono (= web + schermo piccolo) Invio va a capo: si invia SOLO col
    // tasto nella text box. Sul desktop Invio continua a inviare come sempre.
    e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !isPhoneWeb() && (e.preventDefault(), handleSend())
    // Esc: se sta generando → STOP (come il tasto stop). Altrimenti chiude i menu.
    // MAI cancellare il testo del composer: l'utente che preme Esc per fermare
    // la generazione non deve perdere quello che ha scritto (bug gravissimo).
    e.key === 'Escape' && (props.isStreaming ? (e.preventDefault(), props.onStop()) : (setSlashMenuOpen(false), setMentionOpen(false), setAttachMenuOpen(false)))
    // Tab: toggle Plan/Build (non inserire tab nel testo)
    // stopPropagation: il ChatArea ha UN handler globale Tab (29 ago) — senza stop,
    // l'evento sale e fa un SECONDO toggle (plan→build→plan = nessun cambio).
    if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); props.onModeChange(props.mode === 'plan' ? 'build' : 'plan') }
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
  // Mobile: solo la percentuale intera (la text box deve restare libera per le status pill)
  const counterText = props.contextWindow > 0
    ? (mob ? `${Math.floor(pct)}%` : `${fmt(total)}/${fmt(props.contextWindow)} (${Math.floor(pct)}% ± ${Math.ceil(pct * 0.05 + 1)}%)`)
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
          onLongHorizon={props.onLongHorizon}
          longHorizonActive={props.longHorizon}
          longHorizonStatus={props.longHorizonStatus}
          longHorizonPhase={props.longHorizonPhase}
          longHorizonPlanProposed={props.longHorizonPlanProposed}
          onRequestPlan={props.onRequestPlan ? () => props.onRequestPlan!() : undefined}
          onApprovePlan={props.onApprovePlan}
          onContinueDiscussing={props.onContinueDiscussing}
          onPauseLongHorizon={props.onPauseLongHorizon}
          onResumeLongHorizon={props.onResumeLongHorizon}
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
      {/* Attachment menu */}
      {mob ? (
        <BottomSheet
          open={attachMenuOpen}
          onClose={() => { setAttachMenuOpen(false); setAttachMenuView('main') }}
          onViewBack={() => setAttachMenuView('main')}
          onBack={() => { setAttachMenuOpen(false); setAttachMenuView('main'); props.onBackToMenu && props.onBackToMenu() }}
          view={attachMenuView === 'existing' ? (
            <div style={{ padding: '0 0 8px 0' }}>
              {existingAttachments.length === 0 ? (
                <div style={{ padding: '20px', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', textAlign: 'center' }}>No attachments in this chat yet.</div>
              ) : (
                existingAttachments.map((f: any, i: number) => (
                  <SheetRow key={i} icon={<FileText size={18} />} label={String(f.originalName || 'file')} onClick={() => handleReAttach(f)} />
                ))
              )}
            </div>
          ) : null}
          items={[
            { icon: <Paperclip size={18} />, label: 'Attach new file', onSelect: () => { setAttachMenuOpen(false); handlePickFiles() } },
            { icon: <CameraIcon size={18} />, label: 'Take photo', onSelect: () => { setAttachMenuOpen(false); setCameraOpen(true) } },
            { icon: <Clock size={18} />, label: 'Previously sent', onSelect: () => handleShowExisting() },
            ...(isPhoneWeb() ? [] : [{ icon: <Folder size={18} />, label: 'Open attachments folder', onSelect: () => { setAttachMenuOpen(false); handleOpenAttachmentsFolder() } }]),
            ...((!isPhoneWeb() && props.sessionKey) ? [{ icon: <Folder size={18} />, label: 'Open session files folder', onSelect: async () => { setAttachMenuOpen(false); try { await invoke('open_longhorizon_folder', { sessionKey: props.sessionKey }) } catch (e: any) { console.error('open_longhorizon_folder:', e) } } }] : []),
          ]}
        />
      ) : attachMenuOpen && (
        <AttachMenu
          view={attachMenuView}
          existingFiles={existingAttachments}
          onPickFiles={handlePickFiles}
          onOpenFolder={handleOpenAttachmentsFolder}
          onShowExisting={handleShowExisting}
          onReAttach={handleReAttach}
          onBack={() => setAttachMenuView('main')}
          onClose={() => { setAttachMenuOpen(false); setAttachMenuView('main') }}
          onSessionFiles={async () => { setAttachMenuOpen(false); if (props.sessionKey) { try { await invoke('open_longhorizon_folder', { sessionKey: props.sessionKey }) } catch (e: any) { console.error('open_longhorizon_folder:', e) } } }}
        />
      )}

      {cameraOpen && <CameraCaptureModal onClose={() => setCameraOpen(false)} onDone={handleCameraPhoto} />}

      <div style={{
        backgroundColor: 'var(--q-bg-panel)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-floating)',
        padding: '8px',
        display: 'flex',
        flexDirection: 'column',
        ...(props.longHorizon ? { border: '1px solid var(--q-accent-longhorizon)', boxShadow: '0 0 0 1px var(--q-accent-longhorizon), var(--shadow-floating)' } : {}),
      }}>
        {/* Skill + Attachment chips */}
        {(pendingSkills.length > 0 || pendingTaskClips.length > 0 || pendingAttachments.length > 0 || copyingFile) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '6px' }}>
            {pendingTaskClips.map((tc, i) => (
              <div key={`tc-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 8px 3px 10px', borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--q-border)',
                fontSize: '12px', fontFamily: 'var(--font-interface)',
                color: 'var(--q-text-secondary)',
              }}>
                <span style={{ color: 'var(--q-text)', fontWeight: 500 }}>Task: {tc.label}</span>
                <button onClick={() => setPendingTaskClips(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', color: 'var(--q-text-tertiary)', display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {pendingSkills.map((s, i) => (
              <div key={`sk-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 8px 3px 10px', borderRadius: 'var(--radius-sm)',
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
            {pendingAttachments.map((a, i) => (
              <div key={`att-${i}`} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 8px 3px 10px', borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--q-border)',
                fontSize: '12px', fontFamily: 'var(--font-interface)',
                color: 'var(--q-text-secondary)',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--q-tab-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span style={{ color: 'var(--q-text)', fontWeight: 500 }}>{a.originalName}</span>
                {a.size && <span style={{ color: 'var(--q-text-tertiary)', fontSize: '11px' }}>{fmt(a.size)}B</span>}
                <button onClick={() => setPendingAttachments(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', color: 'var(--q-text-tertiary)', display: 'flex' }}>
                  <X size={14} />
                </button>
              </div>
            ))}
            {copyingFile && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '3px 10px', borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(255,255,255,0.06)',
                border: '1px solid var(--q-border)',
                fontSize: '12px', fontFamily: 'var(--font-interface)',
                color: 'var(--q-text-tertiary)',
              }}>
                <span>Copying…</span>
              </div>
            )}
          </div>
        )}
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          autoFocus={props.welcomeMode && !mob ? true : undefined}
          value={text}
          onChange={e => {
            const val = e.target.value
            setText(val)
            // Slash menu detection — only open if text starts with / AND text is just the slash command (no other text before it)
            if (val.startsWith('/') && !val.includes(' ') && text === '') {
              console.log('[SLASH] menu open, filter:', val.slice(1))
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
            resize: 'none', outline: 'none', border: '1px solid transparent', WebkitAppearance: 'none',
            padding: '8px', caretColor: 'var(--q-tab-accent)',
          }}
          rows={1}
        />

        {/* Bottom bar */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: '32px', marginTop: '8px' }}>
          <SlashBtn color="var(--q-tab-accent)" onClick={() => { setSlashMenuOpen(true); setSlashFilter(''); if (!text.startsWith('/')) { /* don't clear text, just open menu */ } if (!isPhoneWeb()) { textareaRef.current?.focus() } }} />
          <div style={{ width: '4px', flexShrink: 0 }} />
          <ModeButton mode={props.mode} onChange={props.onModeChange} longHorizon={props.longHorizon} />
          
          <div style={{ width: '8px', flexShrink: 0 }} />
          <div style={{ height: '32px', display: 'flex', alignItems: 'center' }}>
            <span style={{ color: counterColor, fontSize: '12px', fontFamily: 'var(--font-code)', lineHeight: '1', whiteSpace: 'nowrap' }}>
              {counterText}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ height: '32px', display: 'flex', alignItems: 'center', marginRight: '8px' }}>
            {(props.isStreaming || (props as any).isCompacting || props.statusKind === 'retrying') && props.statusLabel ? (
              <StatusPill label={props.statusLabel} kind={props.statusKind || 'thinking'} />
            ) : null}
          </div>
          {!mob && (<>
          <AttachBtn onClick={() => { setAttachMenuOpen(true); setAttachMenuView('main') }} title="Attach file"><Paperclip size={20} /></AttachBtn>
          <div style={{ width: '8px', flexShrink: 0 }} />
          </>)}
          <StopBtn color="var(--q-accent-danger)" onClick={props.isStreaming ? props.onStop : () => {}} />
          <div style={{ width: '8px', flexShrink: 0 }} />
          {props.onSteer && (
            <SteerButton enabled={canSteer} onClick={handleSteer} />
          )}
          <div style={{ width: '8px', flexShrink: 0 }} />
          <SendButton enabled={canSend} onClick={handleSend} />
        </div>
      </div>
      {sessionFilesOpen && props.sessionKey && (
        <SessionFilesModal sessionKey={props.sessionKey} onClose={() => setSessionFilesOpen(false)} />
      )}
    </div>
  )
}

// ── Session files modal (plan, handoff, progress, git) ──
function SessionFilesModal({ sessionKey, onClose }: { sessionKey: string; onClose: () => void }) {
  const [tab, setTab] = useState<'plan' | 'handoff' | 'progress' | 'git'>('plan')
  const [files, setFiles] = useState<any[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [commits, setCommits] = useState<any[]>([])
  const [diff, setDiff] = useState('')
  const [saved, setSaved] = useState(false)
  const load = async () => {
    const call = (window as any).__sidecarCall
    if (!call) return
    try {
      const r = await call('getSessionFiles', { sessionKey })
      setFiles(r?.files || [])
    } catch {}
    try {
      const g = await call('longHorizonGitLog', { sessionKey })
      setCommits(g?.commits || [])
    } catch {}
  }
  useEffect(() => { load() }, [sessionKey])
  const file = (name: string) => files.find((f: any) => f.name === name)
  const current = tab === 'plan' ? file('plan.md') : tab === 'handoff' ? file('handoff.md') : tab === 'progress' ? file('progress.json') : null
  const save = async () => {
    const call = (window as any).__sidecarCall
    if (!call || !editing) return
    try { await call('saveSessionFile', { sessionKey, name: editing, content }) } catch {}
    setSaved(true); setTimeout(() => setSaved(false), 1500)
    load()
  }
  const showDiff = async (hash: string) => {
    const call = (window as any).__sidecarCall
    if (!call) return
    try { const r = await call('longHorizonGitDiff', { sessionKey, commit: hash }); setDiff(r?.diff || '') } catch {}
  }
  const revert = async (hash?: string) => {
    const call = (window as any).__sidecarCall
    if (!call) return
    try { await call('longHorizonGitRevert', { sessionKey, commit: hash }); load() } catch {}
  }
  const tabBtn = (t: 'plan' | 'handoff' | 'progress' | 'git', label: string) => (
    <button onClick={() => { setTab(t); setEditing(null); setDiff('') }} style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer', backgroundColor: tab === t ? 'var(--q-tab-accent)' : 'transparent', color: tab === t ? 'var(--q-bg)' : 'var(--q-text-secondary)', fontSize: 13, fontWeight: tab === t ? 600 : 400, fontFamily: 'var(--font-interface)' }}>{label}</button>
  )
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e: any) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', width: '640px', maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--q-border)', flexShrink: 0 }}>
          <FileText size={16} style={{ color: 'var(--q-tab-accent)' }} />
          <span style={{ color: 'var(--q-text)', fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Session files</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', display: 'flex' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '8px 12px', display: 'flex', gap: 4, borderBottom: '1px solid var(--q-border)', flexShrink: 0 }}>
          {tabBtn('plan', 'Plan')}
          {tabBtn('handoff', 'Handoff')}
          {tabBtn('progress', 'Progress')}
          {tabBtn('git', 'Git')}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {tab === 'git' ? (
            <div>
              {commits.length === 0 && <div style={{ color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>No commits yet.</div>}
              {commits.map((cm: any) => (
                <div key={cm.hash} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--q-border-soft)' }}>
                  <span style={{ color: 'var(--q-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-code)' }}>{cm.hash}</span>
                  <span style={{ flex: 1, color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>{cm.msg}</span>
                  <button onClick={() => showDiff(cm.hash)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-text-secondary)', fontSize: 12, fontFamily: 'var(--font-interface)' }}>Diff</button>
                  <button onClick={() => revert(cm.hash)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--q-accent-danger)', fontSize: 12, fontFamily: 'var(--font-interface)' }}>Revert</button>
                </div>
              ))}
              {diff && (
                <div style={{ marginTop: 8, padding: '8px 12px', backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-sm)', fontSize: 12, fontFamily: 'var(--font-code)', color: 'var(--q-text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>{diff}</div>
              )}
            </div>
          ) : current ? (
            <div>
              <textarea value={editing === current.name ? content : String(current.content || '')}
                onChange={e => { setEditing(current.name); setContent(e.target.value) }}
                style={{ width: '100%', minHeight: 240, backgroundColor: 'var(--q-bg-elevated)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-sm)', color: 'var(--q-text)', fontSize: 13, fontFamily: 'var(--font-code)', padding: '8px 12px', resize: 'vertical', outline: 'none' }} />
              {tab !== 'progress' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                  {saved && <span style={{ color: 'var(--q-accent-success)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>Saved</span>}
                  <button onClick={save} onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }} onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}
                    style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', cursor: 'pointer', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-interface)' }}>Save</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--q-text-tertiary)', fontSize: 13, fontFamily: 'var(--font-interface)' }}>No file yet. Activate Long Horizon to create the plan.</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Attachment modal (centered — matches app modal style) ──
function AttachMenu({ view, existingFiles, onPickFiles, onOpenFolder, onShowExisting, onReAttach, onBack, onClose, onSessionFiles }: {
  view: 'main' | 'existing'
  existingFiles: any[]
  onPickFiles: () => void
  onOpenFolder: () => void
  onShowExisting: () => void
  onReAttach: (file: any) => void
  onBack: () => void
  onClose: () => void
  onSessionFiles?: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, backgroundColor: 'var(--q-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e: any) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ backgroundColor: 'var(--q-bg-elevated)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-modal)', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        {view === 'main' ? (
          <>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', padding: '14px 18px' }}>Attachments</div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', padding: '0 18px 14px 18px' }}>Choose an option:</div>
            <div style={{ display: 'flex', flexDirection: 'column', padding: '0 16px 4px 16px', gap: '2px' }}>
              <AttachOptionRow icon={<Paperclip size={18} />} label="Attach new file" onClick={onPickFiles} />
              <AttachOptionRow icon={<Clock size={18} />} label="Previously sent" onClick={onShowExisting} />
              {!isPhoneWeb() && <AttachOptionRow icon={<Folder size={18} />} label="Open attachments folder" onClick={onOpenFolder} />}
              {(onSessionFiles && !isPhoneWeb()) && <AttachOptionRow icon={<Folder size={18} />} label="Open session files folder" onClick={onSessionFiles} />}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '16px 16px 12px 16px' }}>
              <AttachModalBtn label="Cancel" onClick={onClose} danger />
            </div>
          </>
        ) : (
          <>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', padding: '14px 18px' }}>Previously sent</div>
            <div style={{ maxHeight: '260px', overflowY: 'auto', padding: '0 16px' }}>
              {existingFiles.length === 0 ? (
                <div style={{ padding: '20px', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', textAlign: 'center' }}>
                  No attachments in this chat yet.
                </div>
              ) : (
                existingFiles.map((f, i) => (
                  <AttachFileRow key={i} file={f} onClick={() => onReAttach(f)} />
                ))
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '16px 16px 12px 16px' }}>
              <AttachModalBtn label="Cancel" onClick={onClose} danger />
              <AttachModalBtn label="Back" onClick={onBack} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Option row (icon + label, like menu items) ──
function AttachOptionRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: 'var(--radius-md)', backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', transition: 'none' }}>
      <span style={{ color: 'var(--q-tab-accent)', display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)' }}>{label}</span>
    </div>
  )
}

// ── Modal button (matches HoverTextBtn from SlashMenu) ──
function AttachModalBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const active = hovered
  const borderColor = danger ? 'var(--q-border)' : 'var(--q-tab-accent)'
  const textColor = danger ? 'var(--q-accent-danger)' : 'var(--q-tab-accent)'
  const hoverTextColor = danger ? 'var(--q-accent-danger)' : 'var(--q-bg)'
  const hoverBg = danger ? 'rgba(255,255,255,0.06)' : 'var(--q-tab-accent)'
  const fontWeight = danger ? 400 : 600
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        border: `1px solid ${borderColor}`,
        backgroundColor: active ? hoverBg : 'transparent',
        color: active ? hoverTextColor : textColor,
        fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight,
        transition: 'none',
      }}>
      {label}
    </button>
  )
}

// ── File row in "Previously sent" list ──
function AttachFileRow({ file, onClick }: { file: any; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: 'var(--radius-md)', backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', transition: 'none' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--q-tab-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span style={{ color: 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.originalName}</span>
      {file.size != null && <span style={{ color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-code)' }}>{file.size > 1024 ? `${Math.floor(file.size / 1024)}KB` : `${file.size}B`}</span>}
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
    <button onPointerDown={(e: any) => { try { e.preventDefault() } catch {} }} onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
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
function ModeButton({ mode, onChange, longHorizon }: { mode: ChatMode; onChange: (m: ChatMode) => void; longHorizon?: boolean }) {
  const [hovered, setHovered] = useState(false)
  const isPlan = mode === 'plan'
  if (longHorizon) {
    // Long Horizon attivo: bloccato, non si può cambiare modalità
    return (
      <button title="Long Horizon active — use /LongHorizon to disable"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        style={{
          width: 'auto', padding: '0 10px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: hovered ? 'scale(1.02)' : 'scale(1)', borderRadius: 'var(--radius-md)',
          border: 'none', cursor: 'default',
          backgroundColor: hovered ? 'var(--q-hover)' : 'transparent',
          color: 'var(--q-accent-longhorizon)',
          fontWeight: 700, fontSize: '13px', fontFamily: 'var(--font-interface)', lineHeight: '1',
          flexShrink: 0,
          transition: 'none',
        }}>
        Long Horizon
      </button>
    )
  }
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
function SteerButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={onClick} disabled={!enabled} title="Steer (send directive while generating)"
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke={enabled ? getContrastColor('--q-tab-accent') : 'var(--q-text-tertiary)'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20V2" />
        <path d="M5 15l7-7 7 7" />
        <path d="M5 9l7-7 7 7" />
      </svg>
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
    retrying: 'var(--q-mode-build)',
    sending: 'var(--q-mode-plan-dim)',
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
// ── Icona fotocamera (stessa linea delle altre icone) ──
function CameraIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

// Diagnostico fotocamera: scrive nel log del Mac (frontend-errors.jsonl) cosi' vedo
// dal vero cosa risponde il telefono su torch/zoom.
function reportCam(kind: string, message: string) {
  try {
    const call = (globalThis as any).__sidecarCall
    if (call) { try { call('logFrontendError', { kind, message }) } catch {}; return }
  } catch {}
  try { (window as any).__reportFrontendError?.(kind, message) } catch {}
}

// ── Fotocamera in-app stile nativa: anteprima a tutto schermo, X in alto,
//    flash + cambio camera in alto a destra, pallino di scatto al centro in basso,
//    zoom con pinch a due dita. Niente app esterna = niente reload. ──
function CameraCaptureModal({ onClose, onDone }: { onClose: () => void; onDone: (blob: Blob, name: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [torchOn, setTorchOn] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [zoomLabel, setZoomLabel] = useState('')
  const zoomRef = useRef(1)
  const zoomCapsRef = useRef<{ min: number; max: number } | null>(null)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null)
  const torchProbedRef = useRef(false)
  const torchDeviceRef = useRef<string | null>(null)
  // iOS non espone il torch (Apple): li' il tasto flash non ha senso e non lo mostro
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)

  const startStream = async (mode: 'environment' | 'user', deviceId?: string | null) => {
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    }
    streamRef.current = stream
    const v = videoRef.current
    if (v) { v.srcObject = stream; v.play().catch(() => {}) }
    // zoom: se il telefono espone i limiti, il pinch diventa attivo
    zoomRef.current = 1
    setZoomLabel('')
    pinchRef.current = null
    pointersRef.current.clear()
    try {
      const track: any = stream.getVideoTracks()[0]
      const caps = track && track.getCapabilities ? track.getCapabilities() : {}
      zoomCapsRef.current = caps && caps.zoom ? { min: Number(caps.zoom.min) || 1, max: Number(caps.zoom.max) || 1 } : null
      try { reportCam('camera-caps', JSON.stringify({ ua: String(navigator.userAgent).slice(0, 100), torch: caps.torch ?? null, zoom: caps.zoom ? [caps.zoom.min, caps.zoom.max] : null, fillLightMode: caps.fillLightMode ?? null, imageCapture: typeof (window as any).ImageCapture !== 'undefined' })) } catch {}
    } catch { zoomCapsRef.current = null }
    setTorchOn(false)
  }

  useEffect(() => {
    startStream('environment').catch(() => setError('Camera not available. Allow camera access for this app and try again.'))
    return () => { try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const flip = async () => {
    const next: 'environment' | 'user' = facing === 'environment' ? 'user' : 'environment'
    setFacing(next)
    try { await startStream(next, next === 'environment' ? torchDeviceRef.current : null) } catch { setError('Camera not available. Allow camera access for this app and try again.') }
  }

  const applyTorch = async (on: boolean): Promise<boolean> => {
    const track: any = streamRef.current?.getVideoTracks()[0]
    if (!track) return false
    let advErr = ''
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] })
      reportCam('camera-torch', JSON.stringify({ on, route: 'advanced', ok: true }))
      return true
    } catch (e: any) { advErr = String(e?.name || e?.message || e) }
    let basicErr = ''
    try {
      await track.applyConstraints({ torch: on } as any)
      let applied = null
      try { applied = !!(track.getSettings && track.getSettings().torch) } catch {}
      reportCam('camera-torch', JSON.stringify({ on, route: 'basic', ok: true, applied, advErr }))
      return true
    } catch (e: any) { basicErr = String(e?.name || e?.message || e) }
    let icErr = ''
    try {
      const IC: any = (window as any).ImageCapture
      if (!IC) { icErr = 'ImageCapture missing' } else {
        const ic = new IC(track)
        await ic.setOptions({ fillLightMode: on ? 'torch' : 'off' })
        reportCam('camera-torch', JSON.stringify({ on, route: 'imagecapture', ok: true, advErr, basicErr }))
        return true
      }
    } catch (e: any) { icErr = String(e?.name || e?.message || e) }
    reportCam('camera-torch', JSON.stringify({ on, ok: false, advErr, basicErr, icErr }))
    return false
  }

  // Sonda: su molti Android ci sono piu' camere posteriori e SOLO UNA ha il flash
  // (Chrome puo' aprire quella sbagliata -> caps.torch null). Provo ogni camera e
  // uso quella col torch; se nessuna ce l'ha, il flash non e' controllabile dal browser.
  const probeTorchCamera = async (): Promise<string | null> => {
    const found: any[] = []
    // Android: una sola fotocamera apribile alla volta. Libero quella corrente
    // (altrimenti le altre danno NotReadableError) e aspetto il rilascio.
    try { streamRef.current?.getTracks().forEach(t => t.stop()) } catch {}
    try { const v = videoRef.current; if (v) v.srcObject = null } catch {}
    await new Promise((r) => setTimeout(r, 350))
    try {
      const devs = await navigator.mediaDevices.enumerateDevices()
      const cams = devs.filter(d => d.kind === 'videoinput')
      for (const d of cams) {
        let st: MediaStream | null = null
        try {
          st = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } }, audio: false })
          const tr: any = st.getVideoTracks()[0]
          const cp: any = tr && tr.getCapabilities ? tr.getCapabilities() : {}
          const has = !!(cp && cp.torch)
          found.push({ i: d.deviceId.slice(0, 6), label: String(d.label || '').slice(0, 22), torch: has })
          try { st.getTracks().forEach(t => t.stop()) } catch {}
          if (has) {
            reportCam('camera-probe', JSON.stringify({ cams: cams.length, found, picked: d.deviceId.slice(0, 6) }))
            return d.deviceId
          }
          await new Promise((r) => setTimeout(r, 250))
        } catch (e: any) {
          found.push({ i: d.deviceId.slice(0, 6), err: String(e?.name || e?.message || e).slice(0, 30) })
          try { st?.getTracks().forEach(t => t.stop()) } catch {}
        }
      }
    } catch (e: any) { reportCam('camera-probe', 'enumerate err ' + String(e?.message || e)); return null }
    reportCam('camera-probe', JSON.stringify({ cams: found.length, found, none: true }))
    return null
  }

  const toggleTorch = async () => {
    const on = !torchOn
    if (on && !torchProbedRef.current) {
      torchProbedRef.current = true
      const id = await probeTorchCamera()
      if (id) {
        torchDeviceRef.current = id
        try { await startStream(facing, id) } catch {}
      } else {
        // niente torch: riapro comunque la camera (la sonda l'aveva chiusa)
        try { await startStream(facing, torchDeviceRef.current) } catch {}
      }
    }
    const ok = await applyTorch(on)
    if (ok) setTorchOn(on)
  }

  const applyZoom = (z: number) => {
    try {
      const track: any = streamRef.current?.getVideoTracks()[0]
      track?.applyConstraints({ advanced: [{ zoom: z }] }).catch(() => {})
    } catch {}
  }

  const onPointerDown = (e: any) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values())
      pinchRef.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), zoom: zoomRef.current }
    }
  }

  const onPointerMove = (e: any) => {
    if (!pointersRef.current.has(e.pointerId)) return
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = pinchRef.current
    const caps = zoomCapsRef.current
    if (!p || !caps || pointersRef.current.size < 2 || p.dist <= 0) return
    const pts = Array.from(pointersRef.current.values())
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    let z = p.zoom * (dist / p.dist)
    z = Math.min(caps.max, Math.max(caps.min, z))
    zoomRef.current = z
    setZoomLabel(z > 1.02 ? 'x' + (Math.round(z * 10) / 10) : '')
    applyZoom(z)
  }

  const endPointer = (e: any) => {
    pointersRef.current.delete(e.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
  }

  const capture = async () => {
    const v = videoRef.current
    if (!v) return
    let blob: Blob | null = null
    // Flash ON: scatto con l'API nativa della fotocamera -> il LED spara sul fotogramma
    // (il constraint torch da solo su molti Android viene accettato ma ignorato).
    if (torchOn && facing === 'environment') {
      try {
        const track: any = streamRef.current?.getVideoTracks()[0]
        const IC: any = (window as any).ImageCapture
        if (track && IC) {
          const ic = new IC(track)
          blob = await ic.takePhoto({ fillLightMode: 'flash' })
        }
      } catch (e: any) { reportCam('camera-takeflash', String(e?.name || e?.message || e)) }
    }
    if (!blob) {
      if (!v.videoWidth) return
      try {
        const c = document.createElement('canvas')
        c.width = v.videoWidth
        c.height = v.videoHeight
        const ctx = c.getContext('2d')
        if (!ctx) return
        if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1) }
        ctx.drawImage(v, 0, 0, c.width, c.height)
        blob = await new Promise<Blob | null>((res) => { c.toBlob((b) => res(b), 'image/jpeg', 0.85) })
      } catch {}
    }
    if (blob) onDone(blob, 'photo-' + Date.now() + '.jpg')
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={endPointer}
      style={{ position: 'fixed', inset: 0, zIndex: 500, backgroundColor: '#000', touchAction: 'none' }}
    >
      {error ? (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', textAlign: 'center', maxWidth: '320px', lineHeight: 1.6 }}>{error}</div>
        </div>
      ) : (
        <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000', transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} />
      )}

      {/* Barra in alto: X a sinistra, flash + cambio camera a destra */}
      {!error && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          padding: '16px', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), rgba(0,0,0,0))',
        }}>
          <CameraRoundBtn onClick={onClose} label="Close">
            <CameraXIcon />
          </CameraRoundBtn>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {!isIOS && (
              <CameraRoundBtn onClick={toggleTorch} label="Flash" active={torchOn}>
                <CameraBoltIcon filled={torchOn} />
              </CameraRoundBtn>
            )}
            <CameraRoundBtn onClick={flip} label="Switch camera">
              <CameraFlipIcon />
            </CameraRoundBtn>
          </div>
        </div>
      )}

      {/* Indicatore zoom (compare solo quando ingrandisci col pinch) */}
      {!error && zoomLabel && (
        <div style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 128px)',
          padding: '4px 12px', borderRadius: '999px', backgroundColor: 'rgba(0,0,0,0.55)',
          color: '#fff', fontSize: '13px', fontFamily: 'var(--font-interface)', fontWeight: 600,
        }}>{zoomLabel}</div>
      )}

      {/* Pallino di scatto, centro in basso */}
      {!error && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            onPointerDown={(e: any) => { try { e.preventDefault() } catch {}; setPressed(true) }}
            onPointerUp={() => setPressed(false)}
            onPointerLeave={() => setPressed(false)}
            onClick={capture}
            aria-label="Capture"
            style={{ width: '78px', height: '78px', borderRadius: '999px', border: '4px solid #fff', backgroundColor: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span style={{ width: pressed ? '52px' : '62px', height: pressed ? '52px' : '62px', borderRadius: '999px', backgroundColor: '#fff', display: 'block' }} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Bottone tondo stile fotocamera (44px, sfondo scuro traslucido) ──
function CameraRoundBtn({ onClick, label, active, children }: { onClick: () => void; label: string; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      onPointerDown={(e: any) => { try { e.preventDefault() } catch {} }}
      onClick={onClick}
      style={{ width: '44px', height: '44px', borderRadius: '999px', border: 'none', backgroundColor: active ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.35)', color: active ? '#000' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, transition: 'none' }}
    >
      {children}
    </button>
  )
}

function CameraXIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function CameraBoltIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h7l-1 8 11-14h-7l1-8z" />
    </svg>
  )
}

function CameraFlipIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.5-4M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.5 4" />
      <path d="M21 3v5h-5" />
      <path d="M3 21v-5h5" />
    </svg>
  )
}
