import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { installScrollAnywhere } from './scrollAnywhere'
installScrollAnywhere()

// === TELEFONO (touch): niente hover ===
// Gli onMouseEnter/onMouseLeave inline di React restavano "appiccicati" dopo un
// tap (fondo hover visibile fino al tocco successivo). Su dispositivi senza
// hover fermiamo gli eventi mouse in fase di capture, prima che React li veda:
// sul computer (hover: hover) non cambia assolutamente nulla.
try {
  // NOTA: il WebView Android dichiara (hover: hover) anche senza mouse (bug
  // noto) -> uniamo la media query col touch reale, cosi' sui telefoni gli
  // hover non restano mai appiccicati. Sul desktop non cambia nulla.
  const touchDevice = (window.matchMedia && window.matchMedia('(hover: none)').matches) ||
    ('ontouchstart' in window) || ((navigator as any).maxTouchPoints || 0) > 0
  if (touchDevice) {
    // Regola utente: sul TELEFONO l'hover non esiste (non c'e' un mouse che
    // passa senza cliccare). Fermiamo gli eventi mouse/pointer in capture prima
    // che React li veda: cio' che accade al CLICK resta, l'hover no.
    const swallow = (e: Event) => { e.stopPropagation() }
    for (const t of ['mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'pointerenter', 'pointerleave', 'pointerover', 'pointerout']) {
      document.addEventListener(t, swallow, true)
    }
    // Classe sul <html>: le regole CSS :hover vengono spente SOLO qui (il
    // WebView Android mente su (hover:none), quindi le media query non bastano).
    try {
      const mark = () => {
        const narrow = window.innerWidth <= 600
        document.documentElement.classList.toggle('q-phone', !('__TAURI_INTERNALS__' in window) && narrow)
      }
      mark()
      window.addEventListener('resize', mark)
    } catch {}
  }
} catch {}

// === INSTRUMENTAZIONE TEST (04 set): ogni errore React/JS del frontend finisce al sidecar
// → ~/.quinki/frontend-errors.jsonl — verificabile da remoto durante i test end-to-end.
let _feWs: WebSocket | null = null
const _feQueue: any[] = []  // FIX: coda — il PRIMO errore non va più perso (WS non ancora aperto)
function _feFlush() {
  try {
    while (_feQueue.length > 0 && _feWs && _feWs.readyState === 1) {
      const m = _feQueue.shift()
      _feWs.send(JSON.stringify(m))
    }
  } catch {}
}
function _feConnect() {
  const _port = (window as any).__isExpertApp || new URLSearchParams(window.location.search).get('expert') === '1' ? 9183 : 9182
  try {
    _feWs = new WebSocket('ws://127.0.0.1:' + _port)
    _feWs.onopen = function() { _feFlush() }
  } catch { _feWs = null }
}
function reportFrontendError(kind: string, message: string, stack?: string) {
  try {
    if (!_feWs || (_feWs.readyState !== 1 && _feWs.readyState !== 0)) _feConnect()
    _feQueue.push({ id: 'fe-' + Date.now(), method: 'logFrontendError', params: { kind, message, stack: stack || '' } })
    _feFlush()
  } catch {}
  // WEB/TELEFONO: niente WS locale -> manda al sidecar via tunnel. Gli errori
  // del telefono finiscono in ~/.quinki/webapp-log.jsonl sul Mac.
  try {
    if (!(globalThis as any).__TAURI_INTERNALS__) {
      fetch('/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ kind, message, stack: stack || '', ua: navigator.userAgent }),
      }).catch(() => {})
    }
  } catch {}
}
;(window as any).__reportFrontendError = reportFrontendError

;(window as any).__quinkiOpenSession = (sk: string) => {
  try { window.dispatchEvent(new CustomEvent('quinki-switch-session', { detail: { sessionKey: sk } })) } catch {}
}

// HELLO: al caricamento della pagina il telefono dice al Mac chi e' e in che
// layout sta girando (diagnosi remota: niente piu' indovinelli).
try {
  if (!(globalThis as any).__TAURI_INTERNALS__) {
    setTimeout(() => {
      try {
        fetch('/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            kind: 'hello',
            message: 'w=' + window.innerWidth + ' touch=' + (('ontouchstart' in window) || ((navigator as any).maxTouchPoints || 0) > 0) +
              ' override=' + (localStorage.getItem('quinki-layout') || 'auto') +
              ' qphone=' + document.documentElement.classList.contains('q-phone'),
            stack: '', ua: navigator.userAgent,
          }),
        }).catch(() => {})
      } catch {}
    }, 1200)
  }
} catch {}
;(window as any).onerror = (msg: any, src: any, line: any, col: any, err: any) => {
  reportFrontendError('onerror', String(msg) + ' @ ' + String(src) + ':' + line + ':' + col, err?.stack)
}
;(window as any).onunhandledrejection = (ev: any) => {
  reportFrontendError('unhandledrejection', String(ev?.reason?.message || ev?.reason || ''))
}

// Context menu: gestito da InputContextMenu.tsx (componente React)


class ErrorBoundary extends React.Component<{children: React.ReactNode}, {error: string | null}> {
  state: {error: string | null} = {error: null}
  componentDidCatch(error: Error, info: any) {
    // INSTRUMENTAZIONE TEST: stack COMPLETO + componentStack del crash → sidecar → file
    try { reportFrontendError('react-crash-stack', JSON.stringify({ msg: String(error?.message || error), stack: String(error?.stack || '').slice(0, 1500), componentStack: String(info?.componentStack || '').slice(0, 1500) })) } catch {}
  }
  static getDerivedStateFromError(error: Error) {
    console.error('ErrorBoundary caught:', error)
    try { reportFrontendError('react-crash', error.message, error.stack) } catch {}
    return {error: error.message + '\n' + (error.stack || '')}
  }
  render() {
    if (this.state.error) {
      return React.createElement('div', 
        {style: {padding:'20px',color:'red',fontFamily:'monospace',fontSize:'14px',whiteSpace:'pre-wrap',background:'white',minHeight:'100vh'}}, 
        'ERROR: ' + this.state.error
      )
    }
    return this.props.children
  }
}

// === CONTEXT MENU: custom per input, NATIVO per tutto il resto ===
// SU INPUT/TEXTAREA: blocca il nativo → mostra il menu custom Quinki
// FUORI: NON bloccare → i menu nativi dell'app (sidebar, tab, ecc.) funzionano
let _ctxEl: HTMLDivElement | null = null
let _savedStart = -1, _savedEnd = -1
const _hideCtx = () => { if (_ctxEl) { _ctxEl.remove(); _ctxEl = null } }
document.addEventListener('click', (e) => { if (_ctxEl && !_ctxEl.contains(e.target as Node)) _hideCtx() }, true)
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') _hideCtx() })
window.addEventListener('blur', _hideCtx)

document.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        const el = t as HTMLInputElement
        _savedStart = el.selectionStart ?? 0
        _savedEnd = el.selectionEnd ?? 0
    }
}, { capture: true })

document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement
    const isInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    // SEMPRE preventDefault → il menu NATIVO WKWebView (Reload) NON appare MAI.
    // I menu dell'app (React onContextMenu, fase bubble) continuano a funzionare.
    e.preventDefault()
    
    if (!isInput) return // non-input: nativo bloccato, nessun custom menu
    // (i menu React dell'app su sidebar/tab/ecc. si aprono nel bubble phase)
    e.stopPropagation()
    _hideCtx()
    const el = t as HTMLInputElement
    if (_savedStart >= 0) setTimeout(() => { try { el.setSelectionRange(_savedStart, _savedEnd) } catch {} }, 0)
    const hasSel = (el.selectionStart ?? 0) !== (el.selectionEnd ?? 0)

    const menu = document.createElement('div')
    menu.style.cssText = 'position:fixed;z-index:99999;background:var(--q-bg-panel,#252528);border:1px solid var(--q-border,#4a4a50);border-radius:8px;padding:4px 0;box-shadow:0 4px 20px rgba(0,0,0,0.5);min-width:180px;font-family:var(--font-interface,-apple-system,sans-serif);font-size:13px;user-select:none'
    // Telefono (senza Tauri): le scorciatoie da tastiera non esistono -> mai mostrate.
    const _isPhone = ('ontouchstart' in window) || ((navigator as any).maxTouchPoints || 0) > 0
    const mkItem = (label: string, sc: string, fn: () => void, enabled: boolean) => {
        const d = document.createElement('div')
        d.innerHTML = `<span>${label}</span>` + (_isPhone ? '' : `<span style="color:var(--q-text-tertiary,#888);font-size:11px;margin-left:auto;padding-left:24px">${sc}</span>`)
        d.style.cssText = `display:flex;align-items:center;padding:6px 14px;cursor:${enabled ? 'pointer' : 'default'};color:${enabled ? 'var(--q-text,#e6e6e6)' : 'var(--q-text-tertiary,#666)'};white-space:nowrap`
        if (enabled) {
            d.onmouseenter = () => { d.style.background = 'rgba(255,255,255,0.06)' }
            d.onmouseleave = () => { d.style.background = 'transparent' }
            d.onclick = (ev) => { ev.stopPropagation(); _hideCtx(); el.focus(); fn() }
        }
        menu.appendChild(d)
    }
    mkItem('Cut', '⌘X', () => { document.execCommand('cut'); el.dispatchEvent(new Event('input', { bubbles: true })) }, hasSel)
    mkItem('Copy', '⌘C', () => { document.execCommand('copy') }, hasSel)
    mkItem('Paste', '⌘V', () => {
        const w = window as any
        const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0
        const insert = (text: string) => { el.focus(); el.setSelectionRange(start, end); document.execCommand('insertText', false, text) }
        try { w.__reportFrontendError?.('paste', 'menu-paste') } catch {}
        // 1) APP ANDROID: il WebView non ha l'API clipboard -> ponte nativo.
        try {
            const nat = w.QuinkiNative
            if (nat && typeof nat.getClipboard === 'function') {
                const t = String(nat.getClipboard() || '')
                try { w.__reportFrontendError?.('paste', 'branch=native len=' + t.length) } catch {}
                if (t) insert(t)
                return
            }
            try { w.__reportFrontendError?.('paste', 'branch=no-bridge') } catch {}
        } catch (e: any) {
            try { w.__reportFrontendError?.('paste', 'native-err ' + String(e?.message || e)) } catch {}
        }
        // 2) DESKTOP (Tauri)
        if (w.__TAURI_INTERNALS__ && w.__TAURI_INTERNALS__.invoke) {
            w.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|read_text').then((t: string) => insert(t)).catch(() => {})
            return
        }
        // 3) BROWSER/PWA
        try {
            navigator.clipboard.readText().then((t: string) => insert(t)).catch((e: any) => {
                try { w.__reportFrontendError?.('paste', 'clipboard-fail ' + String(e?.message || e)) } catch {}
            })
        } catch (e: any) {
            try { w.__reportFrontendError?.('paste', 'clipboard-throw ' + String(e?.message || e)) } catch {}
        }
    }, true)
    mkItem('Select All', '⌘A', () => { el.select() }, true)
    document.body.appendChild(menu)
    const mw = menu.offsetWidth, mh = menu.offsetHeight
    let x = e.clientX, y = e.clientY
    if (x + mw > innerWidth) x = innerWidth - mw - 4
    if (y + mh > innerHeight) y = innerHeight - mh - 4
    if (x < 0) x = 4; if (y < 0) y = 4
    menu.style.left = x + 'px'; menu.style.top = y + 'px'
    _ctxEl = menu
}, { capture: true })

// === PWA (web app): service worker per l'installazione come app vera su Android/desktop.
// Solo in modalita' web (mai nella app Tauri) e solo su contesti http/https.
try {
  const isTauri = !!(globalThis as any).__TAURI_INTERNALS__
  if (!isTauri && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
  }
} catch {}

console.log('About to render App')
createRoot(document.getElementById('root')!).render(
  React.createElement(ErrorBoundary, null, React.createElement(App))
)
