// OnboardingGate.tsx — B Rifinitura: onboarding guidato.
// - Prima apertura: niente. Al PRIMO clic su una tab → modale "Want a quick tour?"
// - YES → tutorial guidato (home → chat → settings → agents → calendar → market → expert → log)
// - NO → spiegazioni brevi alla prima visita di ogni tab
// - Nessun modale si chiude cliccando fuori: sempre conferma esplicita.
// - Tasto "Tutorial" nella Home (barra inferiore) → riprendi/rifai il tutorial.
import React from 'react'
import { useState, useEffect, useRef } from 'react'

const TUT_KEY = 'quinki-tutorial'
const STEP_KEY = 'quinki-tutorial-step'
const VISITED_KEY = 'quinki-visited-tabs'

const STEPS: { tab: string; title: string; body: string; tip?: string }[] = [
  { tab: 'home', title: 'Home', body: 'Your workspace. Sessions, folders and quick access to the Market.' },
  { tab: 'chat', title: 'Chat', body: 'Talk to your agents. Pick an agent, choose a model and send a message. You need a provider to run models, you will set it up in the next step.' },
  {
    tab: 'settings', title: 'Settings', body: 'This tab is where you configure everything: providers, models, themes and app settings.\n\nThe most important thing here is the provider: without one, you cannot use any model or chat.\n\nOpen each provider to sign in with your existing account: use the subscription you already have (ChatGPT, Claude, GitHub Copilot, Grok) or set up Ollama for free local models.',
    tip: 'Free or very cheap models can give poor results. If things do not work as expected, try a better model first.'
  },
  { tab: 'agents', title: 'Agents', body: 'Create and manage your agents and skills. Agents are your assistants, skills teach them how to do specific tasks.' },
  { tab: 'calendar', title: 'Agents Tasks', body: 'Schedule tasks and see your agents\u2019 activity over time.' },
  { tab: 'market', title: 'The Market', body: 'The Market is where you install and publish. Tabs, agents, skills, MCP servers and themes are packages. Browse the catalog, install what you need, and publish your own creations with your GitHub account.' },
  { tab: 'expert', title: 'App Expert', body: 'App Expert is a special agent that can modify, fix and improve Quinki itself. Use it as a tab, or install it as a separate app. In the App Expert session, the default agent is always App Expert.' },
  { tab: 'log', title: 'Log', body: 'Technical logs for debugging. You rarely need this.' },
]

const BRIEFS: Record<string, string> = {
  home: 'Your workspace. Sessions, folders and quick access to the Market.',
  chat: 'Talk to your agents. Pick an agent, choose a model and send a message.',
  agents: 'Create and manage your agents and skills.',
  calendar: 'Schedule tasks and see your agents\u2019 activity.',
  settings: 'Providers, models, themes and app settings.',
  log: 'Technical logs for debugging.',
  market: 'Install and publish packages: tabs, agents, skills, MCP and themes.',
  expert: 'The agent that develops Quinki. Default agent here is always App Expert.',
}

function loadTut(): string { try { return localStorage.getItem(TUT_KEY) || 'not-asked' } catch { return 'not-asked' } }
function saveTut(v: string) { try { localStorage.setItem(TUT_KEY, v) } catch {} }
function loadStep(): number { try { const n = parseInt(localStorage.getItem(STEP_KEY) || '0'); return isNaN(n) ? 0 : n } catch { return 0 } }
function saveStep(n: number) { try { localStorage.setItem(STEP_KEY, String(n)) } catch {} }
function loadVisited(): Set<string> { try { const r = JSON.parse(localStorage.getItem(VISITED_KEY) || '[]'); return new Set(Array.isArray(r) ? r : []) } catch { return new Set() } }
function saveVisited(s: Set<string>) { try { localStorage.setItem(VISITED_KEY, JSON.stringify([...s])) } catch {} }

// Persist on FILE (~/.quinki/tutorial.json) — il localStorage viene pulito a ogni installazione
function syncToDisk(call: any, tut: string, step: number, visited: Set<string>) {
  if (!call) return
  try { call('tutorialSet', { tut, step, visited: [...visited] }).catch(() => {}) } catch {}
}

export function OnboardingGate({ currentTab, onOpenExternal, onGoToTab }: {
  currentTab: string
  onOpenExternal: (url: string) => void
  onGoToTab: (tab: string) => void
}) {
  const [tut, setTut] = useState<string>(loadTut)

    // FIX (01 set): nella Quick Chat NON mostrare MAI il tutorial
    // (è una finestra per domande al volo, non il posto per un tour)
    const _isQuickChat = typeof window !== 'undefined' && (window as any).__isQuickChat
  const [step, setStepState] = useState<number>(() => loadStep())
  const rpcRef = useRef<null | ((method: string, params?: any) => Promise<any>)>(null)
  const [askTour, setAskTour] = useState(false)
  const [modal, setModal] = useState<null | { kind: 'step' | 'brief'; tab: string }>(null)
  const [tutBtnModal, setTutBtnModal] = useState(false)
  const prevTabRef = useRef(currentTab)
  const visitedRef = useRef<Set<string>>(loadVisited())

  const setStep = (n: number) => { setStepState(n); saveStep(n); syncToDisk(rpcRef.current, tutRef.current, n, visitedRef.current) }
  const tutRef = useRef(tut)
  tutRef.current = tut
  useEffect(() => { syncToDisk(rpcRef.current, tut, step, visitedRef.current) }, [tut, step])

  // Stili (dichiarati SUBITO per evitare TDZ nei blocchi che li usano al render)
  const overlay = { position: 'fixed' as const, inset: 0, zIndex: 500, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
  const box = { backgroundColor: 'var(--q-bg-panel)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)', border: '1px solid var(--q-border)', padding: '20px 24px', minWidth: '340px', maxWidth: '460px' }
  const titleS = { color: 'var(--q-text)', fontSize: '16px', fontWeight: 600, fontFamily: 'var(--font-interface)', marginBottom: '8px' }
  const bodyS = { color: 'var(--q-text-secondary)', fontSize: '14px', fontFamily: 'var(--font-interface)', lineHeight: 1.5, marginBottom: '16px' }
  const btnRow = { display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' as const }
  const hoverFill = (e: any) => { e.currentTarget.style.backgroundColor = 'var(--q-tab-accent)'; e.currentTarget.style.color = 'var(--q-bg)' }
  const hoverOut = (e: any) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--q-tab-accent)' }
  const accentBtn = { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', backgroundColor: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' }

  // Registra l'handler globale per il tasto "Tutorial" nella Home
  useEffect(() => {
    (window as any).__onboardingOpenTutorial = () => setTutBtnModal(true)
    return () => { try { delete (window as any).__onboardingOpenTutorial } catch {} }
  }, [])

  // All'avvio: carica lo stato dal FILE (persiste tra le installazioni)
  useEffect(() => {
    rpcRef.current = (window as any).__sidecarCall
    const rpc = rpcRef.current
    if (!rpc) return
    rpc('tutorialGet').then((r: any) => {
      if (r && r.tut) {
        setTut(r.tut)
        if (typeof r.step === 'number') setStepState(r.step)
      }
    }).catch(() => {})
  }, [])

  // Al cambio tab: gestisci tutorial / spiegazioni
  // SKIP = MAI più niente: né tutorial né spiegazioni brevi. Solo il tasto Tutorial le riporta.
  useEffect(() => {
    const prev = prevTabRef.current
    prevTabRef.current = currentTab
    if (prev === currentTab) return
    if (tut === 'not-asked' && !_isQuickChat) {
      setAskTour(true)
      return
    }
    if (tut === 'active') {
      const expected = STEPS[step]?.tab
      if (currentTab === expected) {
        setModal({ kind: 'step', tab: currentTab })
      }
      return
    }
    // skipped / done: niente spiegazioni, niente modali
  }, [currentTab, tut, step])

  const startTour = (fromZero: boolean) => {
    // Se siamo nella QUICK CHAT (webview separato), CHIUDILA e sposta il tutorial
    // nella finestra MAIN — il tour naviga le tab dell'app completa, non la mini finestra.
    // Se invece l'utente SKIPPA, la Quick Chat resta aperta e funziona normale.
    try { if ((window as any).__isQuickChat) {
      import('@tauri-apps/api/core').then(m => { m.invoke('close_window', { label: 'win-quick-chat' }).catch(() => {}) }).catch(() => {})
      import('@tauri-apps/api/core').then(m => { m.invoke('focus_window', { label: 'main' }).catch(() => {}) }).catch(() => {})
      return // il tutorial continua nella MAIN window
    } } catch {}
    setTut('active'); saveTut('active'); setTutBtnModal(false); setAskTour(false)
    const s = fromZero ? 0 : step
    setStep(s)
    const tab = STEPS[s]?.tab || 'home'
    // NAVIGAZIONE AUTOMATICA alla tab del passo corrente
    if (currentTab !== tab) onGoToTab(tab)
    else setModal({ kind: 'step', tab })
  }
  const skipTour = () => { setTut('skipped'); saveTut('skipped'); setTutBtnModal(false); setAskTour(false); setModal(null); onGoToTab('home') }
  const finishTour = () => { setTut('done'); saveTut('done'); setModal(null); setTutBtnModal(false); onGoToTab('home') }
  const nextStep = () => {
    const n = step + 1
    if (n >= STEPS.length) { finishTour(); return }
    setStep(n)
    setModal(null)
    // NAVIGA AUTOMATICAMENTE alla tab del prossimo passo + mostra il suo modale
    const nextTab = STEPS[n]?.tab
    if (nextTab) {
      onGoToTab(nextTab)
      setTimeout(() => setModal({ kind: 'step', tab: nextTab }), 300)
    }
  }
  const closeModal = () => setModal(null)

  const stepData = modal && modal.kind === 'step' ? STEPS.find((s) => s.tab === modal.tab) : null
  const briefText = modal && modal.kind === 'brief' ? BRIEFS[modal.tab] : ''

  // ── modale del tasto Tutorial (situazione dipendente) ──
  let tutBtnContent: { title: string; body: string; buttons: React.ReactNode[] } | null = null
  if (tutBtnModal) {
    if (tut === 'done') {
      tutBtnContent = { title: 'Tutorial', body: 'Want to redo the tour?', buttons: [
        React.createElement('button', { key: 'no', onClick: () => setTutBtnModal(false), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'No'),
        React.createElement('button', { key: 'y', onClick: () => startTour(true), onMouseEnter: (e: any) => hoverFill(e), onMouseLeave: (e: any) => hoverOut(e), style: accentBtn }, 'Yes, start over'),
      ] }
    } else if (tut === 'active') {
      const st = STEPS[step]?.title || 'first'
      tutBtnContent = { title: 'Tutorial', body: 'The tour is in progress. Continue from the ' + st + ' step?', buttons: [
        React.createElement('button', { key: 'r', onClick: () => startTour(true), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Restart from the beginning'),
        React.createElement('button', { key: 'c', onClick: () => { setTutBtnModal(false); startTour(false) }, onMouseEnter: (e: any) => hoverFill(e), onMouseLeave: (e: any) => hoverOut(e), style: accentBtn }, 'Continue')
      ] }
    } else if (tut === 'skipped' && step > 0) {
      const st = STEPS[Math.min(step, STEPS.length - 1)]?.title || 'first'
      tutBtnContent = { title: 'Tutorial', body: 'You interrupted the tour at the ' + st + ' step.', buttons: [
        React.createElement('button', { key: 'n', onClick: () => setTutBtnModal(false), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'No'),
        React.createElement('button', { key: 'r', onClick: () => startTour(true), onMouseEnter: hoverFill, onMouseLeave: hoverOut, style: accentBtn }, 'Start over'),
        React.createElement('button', { key: 'c', onClick: () => startTour(false), onMouseEnter: (e: any) => hoverFill(e), onMouseLeave: (e: any) => hoverOut(e), style: accentBtn }, 'Resume')
      ] }
    } else {
      tutBtnContent = { title: 'Tutorial', body: 'Want to do the guided tour? It takes a minute and shows you the key parts.', buttons: [
        React.createElement('button', { key: 'n', onClick: () => setTutBtnModal(false), onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'No'),
        React.createElement('button', { key: 'y', onClick: () => startTour(true), onMouseEnter: (e: any) => hoverFill(e), onMouseLeave: (e: any) => hoverOut(e), style: accentBtn }, 'Yes, show me')
      ] }
    }
  }

  return React.createElement(React.Fragment, null,
    // ── Modale A: "Want a quick tour?" ──
    askTour && React.createElement('div', { style: overlay },
      React.createElement('div', { style: box },
        React.createElement('div', { style: titleS }, 'Welcome to Quinki!'),
        React.createElement('div', { style: bodyS }, 'Want a quick tour of the app? It takes a minute and shows you the key parts: the chat, the provider setup, the Market and App Expert.\n\nYou can always restart or resume it later: click Tutorial in the bottom right of the Home tab.'),
        React.createElement('div', { style: btnRow },
          React.createElement('button', { onClick: () => { setAskTour(false); setTut('skipped'); saveTut('skipped') }, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'No thanks'),
          React.createElement('button', { onClick: () => { setAskTour(false); setTut('active'); saveTut('active'); setStep(0); onGoToTab('home'); setTimeout(() => setModal({ kind: 'step', tab: 'home' }), 300) }, onMouseEnter: hoverFill, onMouseLeave: hoverOut, style: accentBtn }, 'Yes, show me')
        )
      )
    ),
    // ── Modale B: passo del tutorial ──
    modal && modal.kind === 'step' && stepData && React.createElement('div', { style: overlay },
      React.createElement('div', { style: box },
        React.createElement('div', { style: titleS }, stepData.title),
        React.createElement('div', { style: bodyS }, stepData.body),

        stepData.tip && React.createElement('div', { style: { backgroundColor: 'rgba(210,153,34,0.08)', border: '1px solid rgba(210,153,34,0.35)', borderRadius: 'var(--radius-sm)', padding: '8px 10px', marginBottom: '12px' } },
          React.createElement('span', { style: { color: 'var(--q-accent-warning)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: 1.4 } }, stepData.tip)
        ),
        React.createElement('div', { style: btnRow },
          React.createElement('button', { onClick: skipTour, onMouseEnter: (e: any) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }, onMouseLeave: (e: any) => { e.currentTarget.style.backgroundColor = 'transparent' }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', backgroundColor: 'transparent', color: 'var(--q-accent-danger)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Skip tutorial'),
          React.createElement('button', { onClick: nextStep, onMouseEnter: hoverFill, onMouseLeave: hoverOut, style: accentBtn }, step >= STEPS.length - 1 ? 'Finish' : 'Continue')
        )
      )
    ),
    // ── Modale C: spiegazione breve ──
    modal && modal.kind === 'brief' && React.createElement('div', { style: overlay },
      React.createElement('div', { style: box },
        React.createElement('div', { style: titleS }, modal.tab === 'calendar' ? 'Agents Tasks' : modal.tab === 'market' ? 'The Market' : modal.tab === 'expert' ? 'App Expert' : modal.tab.charAt(0).toUpperCase() + modal.tab.slice(1)),
        React.createElement('div', { style: bodyS }, briefText),
        React.createElement('div', { style: btnRow },
          React.createElement('button', { onClick: closeModal, onMouseEnter: hoverFill, onMouseLeave: hoverOut, style: accentBtn }, 'Got it')
        )
      )
    ),
    // ── Modale tasto Tutorial ──
    tutBtnModal && tutBtnContent && React.createElement('div', { style: overlay },
      React.createElement('div', { style: box },
        React.createElement('div', { style: titleS }, tutBtnContent.title),
        React.createElement('div', { style: bodyS }, tutBtnContent.body),
        React.createElement('div', { style: btnRow }, tutBtnContent.buttons)
      )
    )
  )
}