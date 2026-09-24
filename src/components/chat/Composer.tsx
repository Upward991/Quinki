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
import { Paperclip, ChevronUp, ChevronDown, Bot, X, Clock, Folder, FolderOpen, FileText } from '../icons'
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
  const [attachMenuView, setAttachMenuView] = useState<'main' | 'existing' | 'workdirs'>('main')
  const [workdirs, setWorkdirs] = useState<any[]>([])
  const handleShowWorkdirs = async () => {
    try {
      const call = (window as any).__sidecarCall
      const sk = props.sessionKey || ''
      if (call && sk) {
        const r = await call('listWorkingDirs', { sessionKey: sk })
        setWorkdirs(Array.isArray(r?.dirs) ? r.dirs : [])
        // Vecchia cartella pi-* con file: chiedi col modale (mai spostamenti muti).
        if (r?.legacyDir && r?.defaultPath) {
          setPendingWorkdir({ apply: '', from: r.legacyDir, to: r.defaultPath, files: r.legacyFiles || 1, sessionKey: sk })
        }
      }
    } catch {}
    setAttachMenuView('workdirs')
  }
  const handleOpenWorkdir = async (path: string) => {
    setAttachMenuOpen(false); setAttachMenuView('main')
    try { await invoke('open_working_dir_folder', { path }) } catch (e: any) { console.error('open_working_dir_folder:', e) }
  }
  const [pendingWorkdir, setPendingWorkdir] = useState<{ apply: string; from: string; to: string; files: number; sessionKey: string } | null>(null)
  useEffect(() => {
    const onPicked = async (ev: any) => {
      const d = ev?.detail || {}
      const sk = String(d.sessionKey || ''); const path = String(d.path || '')
      if (!sk) return
      const call = (window as any).__sidecarCall
      if (!call) return
      let files = 0, from = '', def = ''
      try { const r = await call('listWorkingDirs', { sessionKey: sk }); files = r?.currentFiles || 0; from = r?.current || ''; def = r?.defaultPath || '' } catch {}
      // path vuoto = directory TOLTA dalla chat -> si torna alla DEFAULT.
      const to = path || def
      if (!to) return
      if (files > 0 && from && from !== to) { setPendingWorkdir({ apply: path, from, to, files, sessionKey: sk }); return }
      try { await call('setWorkingDir', { sessionKey: sk, path }) } catch {}
    }
    window.addEventListener('quinki-workdir-picked', onPicked)
    return () => window.removeEventListener('quinki-workdir-picked', onPicked)
  }, [])

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

  // === DETTATURA (Parakeet v3, in locale sul Mac) ===
  // Tocco -> registro (tasto rosso) -> ritocco -> WAV 16k nel composer.
  // Desktop: comando Tauri -> helper swift. Web/telefono: shim -> POST /transcribe.
  const [recState, setRecState] = useState<'idle' | 'rec' | 'busy'>('idle')
  const [speaking, setSpeaking] = useState(false)   // VAD: verde mentre parli
  const vadTimerRef = useRef<any>(null)
  const acRef = useRef<any>(null)
  const lastVoiceRef = useRef(0)
  const recRef = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[] } | null>(null)
  const startingRef = useRef(false)
  // True quando l'utente ha chiesto lo stop: dopo, il primo chunk non accende piu' il rosso.
  const stoppedRef = useRef(false)
  const recSelRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })

  const startRec = async () => {
    // Finche' il microfono NON e' aperto (tasto ancora non rosso) un secondo
    // tocco viene ignorato: niente doppie registrazioni nascoste.
    if (startingRef.current || recRef.current) return
    startingRef.current = true
    stoppedRef.current = false
    try {
      // Se l'utente ha evidenziato del testo, la trascrizione LO SOSTITUIRA'.
      try {
        const ta: any = textareaRef.current
        recSelRef.current = ta ? { start: ta.selectionStart || 0, end: ta.selectionEnd || 0 } : { start: 0, end: 0 }
      } catch { recSelRef.current = { start: 0, end: 0 } }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // VAD leggero: livello RMS 10 volte al secondo -> verde quando parli.
      try {
        const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext
        const ac = new AC()
        const src = ac.createMediaStreamSource(stream)
        const an = ac.createAnalyser()
        an.fftSize = 512
        src.connect(an)
        acRef.current = ac
        const buf = new Uint8Array(an.fftSize)
        vadTimerRef.current = setInterval(() => {
          try {
            an.getByteTimeDomainData(buf)
            let sum = 0
            for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
            const rms = Math.sqrt(sum / buf.length)
            const now = Date.now()
            if (rms > 0.02) lastVoiceRef.current = now
            setSpeaking(now - lastVoiceRef.current < 300)
          } catch {}
        }, 100)
      } catch (e) { console.error('vad error:', e) }
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      let gotAudio = false
      // ROSSO = l'audio sta DAVVERO scorrendo: il tasto si accende solo quando
      // arriva il primo blocco GIA' REGISTRATO (MediaRecorder impiega 150-300ms
      // ad avviarsi davvero: accendere prima faceva perdere le prime parole).
      mr.ondataavailable = (e: any) => {
        if (e.data && e.data.size) {
          chunks.push(e.data)
          if (!gotAudio && !stoppedRef.current) { gotAudio = true; setRecState('rec') }
        }
      }
      mr.onstop = async () => {
        try { if (vadTimerRef.current) clearInterval(vadTimerRef.current) } catch {}
        vadTimerRef.current = null
        setSpeaking(false)
        try { acRef.current?.close() } catch {}
        acRef.current = null
        try { stream.getTracks().forEach(t => t.stop()) } catch {}
        try {
          const blob = new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' })
          const wav = await blobToWav16k(blob)
          const arr = Array.from(new Uint8Array(await wav.arrayBuffer()))
          const res: any = await invoke('transcribe_audio', { wav: arr })
          const clean = String(res || '').trim()
          if (clean) {
            const sel = recSelRef.current
            setText(prev => {
              const sIdx = Math.max(0, Math.min(sel.start, prev.length))
              const eIdx = Math.max(0, Math.min(sel.end, prev.length))
              if (eIdx > sIdx) return prev.slice(0, sIdx) + clean + prev.slice(eIdx)
              return prev + ((prev && !prev.endsWith(' ') && !prev.endsWith('\n')) ? ' ' : '') + clean
            })
            // Sul telefono NON apriamo la tastiera: il testo arriva e basta.
            if (!isPhoneWeb()) setTimeout(() => textareaRef.current?.focus(), 0)
          }
        } catch (e: any) {
          console.error('dictation error:', e)
        } finally {
          setRecState('idle')
          recRef.current = null
        }
      }
      mr.start(150)
      recRef.current = { mr, stream, chunks }
    } catch (e: any) {
      console.error('mic error:', e)
      try { if (vadTimerRef.current) clearInterval(vadTimerRef.current) } catch {}
      vadTimerRef.current = null
      setSpeaking(false)
      setRecState('idle')
    } finally {
      startingRef.current = false
    }
  }
  const stopRec = () => {
    stoppedRef.current = true
    try { recRef.current?.mr.stop() } catch {}
    setRecState('busy')
  }

  // === SHORTCUT DETTATURA (desktop): default "tap Alt destro" (premi e rilascia
  // il tasto destro senza altri tasti: cosi Alt+Tab non attiva nulla e il tasto
  // sinistro resta libero per la Quick Chat). Distingue i tasti doppi:
  // AltLeft/AltRight, ControlLeft/ControlRight, ShiftLeft/Right, MetaLeft/Right.
  // I combo (es. ControlLeft+D) partono al keydown. Settings -> Shortcuts.
  const recStateRef = useRef(recState)
  recStateRef.current = recState
  const startRef = useRef(startRec)
  startRef.current = startRec
  const stopRef = useRef(stopRec)
  stopRef.current = stopRec
  // Shortcut CONDIVISO (file ~/.quinki/dictation-shortcut.txt): cambiarlo in
  // una app vale anche per l'altra, e sopravvive a update/reinstalli.
  const dictScRef = useRef('AltRight')
  useEffect(() => {
    let alive = true
    const norm = (v: any) => (typeof v === 'string' && v && v !== 'Alt') ? v : 'AltRight'
    try {
      let legacy = ''
      try { legacy = localStorage.getItem('quinki-dictation-shortcut') || '' } catch {}
      invoke('dictation_shortcut_init', { legacy }).then((v: any) => { if (alive) dictScRef.current = norm(v) }).catch(() => {})
    } catch {}
    let timer: any = null
    if (!isPhoneWeb()) {
      timer = setInterval(() => {
        try { invoke('dictation_shortcut_get').then((v: any) => { const n = norm(v); if (n !== dictScRef.current) dictScRef.current = n }).catch(() => {}) } catch {}
      }, 3000)
    }
    return () => { alive = false; if (timer) clearInterval(timer) }
  }, [])
  useEffect(() => {
    const getSc = () => dictScRef.current || 'AltRight'
    const isModCode = (c: string) => c.startsWith('Alt') || c.startsWith('Control') || c.startsWith('Meta') || c.startsWith('Shift')
    const modGroup = (c: string) => c.startsWith('Alt') ? 'alt' : c.startsWith('Control') ? 'ctrl' : c.startsWith('Shift') ? 'shift' : 'meta'
    const held: Record<string, string> = { alt: '', ctrl: '', shift: '', meta: '' }
    let modDown = false
    let otherPressed = false
    const toggle = () => { if (recStateRef.current === 'busy') return; if (recStateRef.current === 'rec') stopRef.current(); else startRef.current() }
    const codeMatches = (sc: string, code: string) => {
      if (sc === 'Alt') return code === 'AltLeft' || code === 'AltRight'
      if (sc === 'Control') return code === 'ControlLeft' || code === 'ControlRight'
      if (sc === 'Shift') return code === 'ShiftLeft' || code === 'ShiftRight'
      if (sc === 'Meta') return code === 'MetaLeft' || code === 'MetaRight'
      return sc === code
    }
    const onDown = (ev: KeyboardEvent) => {
      const sc = getSc()
      if (isModCode(ev.code)) { held[modGroup(ev.code)] = ev.code; if (!modDown) { modDown = true; otherPressed = false } return }
      if (modDown) otherPressed = true
      if (sc.includes('+')) {
        const parts = sc.split('+'); const key = parts[parts.length - 1]
        const need = { meta: parts.includes('Meta'), ctrl: parts.includes('Control'), alt: parts.includes('Alt'), shift: parts.includes('Shift') }
        const sideOk =
          !parts.some(p => (p === 'AltLeft' || p === 'AltRight') && !(ev.altKey && held.alt === p)) &&
          !parts.some(p => (p === 'ControlLeft' || p === 'ControlRight') && !(ev.ctrlKey && held.ctrl === p)) &&
          !parts.some(p => (p === 'ShiftLeft' || p === 'ShiftRight') && !(ev.shiftKey && held.shift === p)) &&
          !parts.some(p => (p === 'MetaLeft' || p === 'MetaRight') && !(ev.metaKey && held.meta === p))
        if (ev.metaKey === need.meta && ev.ctrlKey === need.ctrl && ev.altKey === need.alt && ev.shiftKey === need.shift && sideOk) {
          const code = ev.code
          const ok = code === key || (key.length === 1 ? code === 'Key' + key || code === 'Digit' + key : false)
          if (ok) { ev.preventDefault(); toggle() }
        }
      }
    }
    const onUp = (ev: KeyboardEvent) => {
      const sc = getSc()
      if (!sc.includes('+') && isModCode(ev.code) && modDown && !otherPressed && codeMatches(sc, ev.code)) toggle()
      if (isModCode(ev.code)) { held[modGroup(ev.code)] = ''; modDown = false; otherPressed = false }
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])
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
  const handleCameraFile = async (f: File) => {
    const key = await resolveSessionKey()
    if (!key) return
    setCopyingFile(true)
    try {
      const r = await fetch('/upload?name=' + encodeURIComponent(f.name || ('photo-' + Date.now() + '.jpg')), { method: 'POST', body: f })
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

  // Fotocamera DI SISTEMA: input file nativo con capture -> apre l'app fotocamera del
  // telefono (flash/zoom/HDR nativi). Il rischio e' il reload della PWA al ritorno:
  // lascio una spia in localStorage e al prossimo avvio il log mi dice se la foto e'
  // arrivata o se e' stata persa dal reload.
  const handleSystemCamera = () => {
    setAttachMenuOpen(false)
    try {
      localStorage.setItem('quinki-camera-pending', String(Date.now()))
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = 'image/*'
      ;(inp as any).capture = 'environment'
      inp.style.display = 'none'
      document.body.appendChild(inp)
      const done = (f?: File | null) => {
        try { inp.remove() } catch {}
        try { localStorage.removeItem('quinki-camera-pending') } catch {}
        if (f) { reportCam('camera-system', 'file arrived: ' + String(f.name) + ' ' + String(f.size) + ' bytes'); handleCameraFile(f) }
        else { reportCam('camera-system', 'no file (cancelled or lost)') }
      }
      inp.onchange = () => done(inp.files && inp.files[0])
      try { (inp as any).oncancel = () => done(null) } catch {}
      inp.click()
    } catch (e: any) { reportCam('camera-system-err', String(e?.message || e)) }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem('quinki-camera-pending')
      if (raw) {
        const dt = Date.now() - Number(raw || 0)
        if (dt < 180000) reportCam('camera-system-return', 'reload detected after system camera, no file delivered (dt=' + dt + 'ms)')
        localStorage.removeItem('quinki-camera-pending')
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            { icon: <CameraIcon size={18} />, label: 'Take photo', onSelect: handleSystemCamera },
            { icon: <Clock size={18} />, label: 'Previously sent', onSelect: () => handleShowExisting() },
            ...(isPhoneWeb() ? [] : [{ icon: <Folder size={18} />, label: 'Open attachments folder', onSelect: () => { setAttachMenuOpen(false); handleOpenAttachmentsFolder() } }]),
            ...((!isPhoneWeb() && props.sessionKey) ? [{ icon: <Folder size={18} />, label: 'Open session files folder', onSelect: async () => { setAttachMenuOpen(false); try { await invoke('open_longhorizon_folder', { sessionKey: props.sessionKey }) } catch (e: any) { console.error('open_longhorizon_folder:', e) } } }] : []),
            ...((!isPhoneWeb() && props.sessionKey) ? [{ icon: <FolderOpen size={18} />, label: 'Working directories', onSelect: () => handleShowWorkdirs() }] : []),
          ]}
        />
      ) : attachMenuOpen && (
        <AttachMenu
          view={attachMenuView}
          existingFiles={existingAttachments}
          onPickFiles={handlePickFiles}
          onOpenFolder={handleOpenAttachmentsFolder}
          onShowExisting={handleShowExisting}
          onShowWorkdirs={handleShowWorkdirs}
          onOpenWorkdir={handleOpenWorkdir}
          workdirs={workdirs}
          onReAttach={handleReAttach}
          onBack={() => setAttachMenuView('main')}
          onClose={() => { setAttachMenuOpen(false); setAttachMenuView('main') }}
          onSessionFiles={async () => { setAttachMenuOpen(false); if (props.sessionKey) { try { await invoke('open_longhorizon_folder', { sessionKey: props.sessionKey }) } catch (e: any) { console.error('open_longhorizon_folder:', e) } } }}
        />
      )}

      {/* Move/Keep: cambio workdir quando la cartella attuale ha file */}
      {pendingWorkdir && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 400, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setPendingWorkdir(null)}>
          <div style={{ backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '20px 24px', maxWidth: '440px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }}>Move the chat files?</div>
            <div style={{ color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }}>
              This chat has {pendingWorkdir.files} file{pendingWorkdir.files === 1 ? '' : 's'} in its folder. Move them to the new working directory, or keep them in the old one?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={async () => { const d = pendingWorkdir; setPendingWorkdir(null); try { const call = (window as any).__sidecarCall; if (call) await call('setWorkingDir', { sessionKey: d.sessionKey, path: d.apply }) } catch {} }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Keep in the old folder
              </button>
              <button onClick={async () => { const d = pendingWorkdir; setPendingWorkdir(null); try { await invoke('move_workdir_contents', { from: d.from, to: d.to }); const call = (window as any).__sidecarCall; if (call) await call('setWorkingDir', { sessionKey: d.sessionKey, path: d.apply }) } catch {} }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }}
                style={{ padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }}>
                Move
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{
        backgroundColor: 'var(--q-bg-panel)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-floating)',
        padding: '8px',
        position: 'relative',
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
            padding: '8px', paddingRight: '46px', caretColor: 'var(--q-tab-accent)',
          }}
          rows={1}
        />

        {/* Dettatura: SEMPRE sopra il tasto invio, ancorato al bordo inferiore della
            box: se il testo alza la textbox lui non si muove. Stessa forma/dimensioni
            degli altri tasti (32x32, radius-md). Icona rossa mentre registra. */}
        <div style={{ position: 'absolute', right: '8px', bottom: '52px', zIndex: 3 }}>
          <MicBtn recState={recState} speaking={speaking} onClick={recState === 'busy' ? () => {} : (recState === 'rec' ? stopRec : startRec)} />
        </div>

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
function AttachMenu({ view, existingFiles, workdirs, onPickFiles, onOpenFolder, onShowExisting, onShowWorkdirs, onOpenWorkdir, onReAttach, onBack, onClose, onSessionFiles }: {
  view: 'main' | 'existing' | 'workdirs'
  existingFiles: any[]
  workdirs: any[]
  onPickFiles: () => void
  onOpenFolder: () => void
  onShowExisting: () => void
  onShowWorkdirs: () => void
  onOpenWorkdir: (path: string) => void
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
              {!isPhoneWeb() && <AttachOptionRow icon={<FolderOpen size={18} />} label="Working directories" onClick={onShowWorkdirs} />}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '16px 16px 12px 16px' }}>
              <AttachModalBtn label="Cancel" onClick={onClose} danger />
            </div>
          </>
        ) : view === 'workdirs' ? (
          <>
            <div style={{ color: 'var(--q-text)', fontSize: '16px', fontFamily: 'var(--font-interface)', padding: '14px 18px' }}>Working directories</div>
            <div style={{ maxHeight: '260px', overflowY: 'auto', padding: '0 16px 4px 16px' }}>
              {workdirs.length === 0 ? (
                <div style={{ padding: '20px', color: 'var(--q-text-tertiary)', fontSize: '13px', fontFamily: 'var(--font-interface)', textAlign: 'center' }}>No working directories yet.</div>
              ) : (
                workdirs.map((d: any, i: number) => (
                  <WorkdirRow key={i} dir={d} onClick={() => onOpenWorkdir(d.path)} />
                ))
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '8px', padding: '16px 16px 12px 16px' }}>
              <AttachModalBtn label="Cancel" onClick={onClose} danger />
              <AttachModalBtn label="Back" onClick={onBack} />
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

// ── Folder row in "Working directories" list (come le righe degli attachment) ──
function WorkdirRow({ dir, onClick }: { dir: any; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const name = String(dir?.path || '').split('/').filter(Boolean).pop() || dir?.path || ''
  return (
    <div onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', borderRadius: 'var(--radius-md)', backgroundColor: hovered ? 'var(--q-hover)' : 'transparent', transition: 'none' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--q-tab-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span style={{ color: dir?.current ? 'var(--q-tab-accent)' : 'var(--q-text)', fontSize: '13px', fontFamily: 'var(--font-interface)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: dir?.current ? 600 : 400 }}>{name}</span>
      <span style={{ color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-code)', flexShrink: 0, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dir?.path}</span>
    </div>
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
// Tasto dettatura: stessa forma/dimensioni di AttachBtn (32x32, hover var(--q-hover)).
// Mentre registra l'icona diventa rossa; mentre trascrive e' attenuato.
// Tasto dettatura: GRAFICAMENTE IDENTICO al tasto invio (32x32, radius 8px, pieno
// accent-darker, hover accent, colore di contrasto). Rosso mentre registra,
// attenuato mentre trascrive.
function MicBtn({ recState, speaking, onClick }: { recState: 'idle' | 'rec' | 'busy'; speaking?: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)
  const busy = recState === 'busy'
  const rec = recState === 'rec'
  return (
    <button onPointerDown={(e: any) => { try { e.preventDefault() } catch {} }} onClick={onClick}
      title={rec ? 'Stop and transcribe' : busy ? 'Transcribing…' : 'Dictate'}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{
        width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '8px',
        border: 'none', cursor: busy ? 'default' : 'pointer',
        backgroundColor: (rec && speaking) ? 'var(--q-accent-success)' : rec ? 'var(--q-accent-danger)' : busy ? 'var(--q-accent-warning)' : (hovered ? 'rgba(255,255,255,0.08)' : 'var(--q-hover)'),
        color: (rec && speaking) ? getContrastColor('--q-accent-success') : (rec || busy) ? getContrastColor('--q-accent-warning') : 'var(--q-text-tertiary)',
        flexShrink: 0, padding: '0',
        transition: 'none',
      }}>
      <MicIcon />
    </button>
  )
}

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


// ── Dettatura: decodifica l'audio registrato e lo converte in WAV 16k mono (PCM16).
// L'helper sul Mac vuole esattamente questo: nessun ffmpeg, nessun formato strano.
async function blobToWav16k(blob: Blob): Promise<Blob> {
  const ab = await blob.arrayBuffer()
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext
  const ctx = new AC()
  const audio: AudioBuffer = await new Promise((resolve, reject) => {
    try { ctx.decodeAudioData(ab, resolve, reject) } catch (e) { reject(e) }
  })
  const sr = 16000
  const len = Math.max(1, Math.round(audio.duration * sr))
  const ch0 = audio.getChannelData(0)
  const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const t = (i / sr) * audio.sampleRate
    const i0 = Math.floor(t)
    const i1 = Math.min(audio.length - 1, i0 + 1)
    const f = t - i0
    const a0 = ch0[i0] * (1 - f) + ch0[i1] * f
    const a1 = ch1 ? ch1[i0] * (1 - f) + ch1[i1] * f : a0
    out[i] = (a0 + a1) / 2
  }
  const buf = new ArrayBuffer(44 + len * 2)
  const dv = new DataView(buf)
  const ws = (o: number, str: string) => { for (let i = 0; i < str.length; i++) dv.setUint8(o + i, str.charCodeAt(i)) }
  ws(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true)
  ws(36, 'data'); dv.setUint32(40, len * 2, true)
  let o = 44
  for (let i = 0; i < len; i++) {
    const v = Math.max(-1, Math.min(1, out[i]))
    dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true)
    o += 2
  }
  try { ctx.close() } catch {}
  return new Blob([buf], { type: 'audio/wav' })
}

// ── Icona microfono ──
function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5 10.5a7 7 0 0 0 14 0" />
      <path d="M12 17.5V21" />
    </svg>
  )
}
