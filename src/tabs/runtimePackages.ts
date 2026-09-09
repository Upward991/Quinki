// runtimePackages.ts — A4.3: pacchetti di tab SIMULATI per test.
// Ogni pacchetto ha il contratto del futuro marketplace (manifest + bundle).
// Il bundle è codice JS (stringa) che registra un pannello: riceve { React, Quinki }
// e restituisce una funzione componente. Il runtime lo valuta e lo monta.
// In A4.4 questi stessi pacchetti arriveranno scaricati dal sito (stessa forma).

export interface TabManifest {
  id: string
  name: string
  version: string
  author: string
  description: string
  icon: string          // emoji
  color: string
  permissions: string[] // es. ['notes:read', 'notes:write']
  entry: string         // 'bundle.js'
}

export interface TabPackage {
  manifest: TabManifest
  code: string
  server?: string // back-end opzionale (server.js) — caricato dal sidecar
}

// ── Knowledge: raccolta note con AI (la prima tab "vera") ──
// Il back-end (server.js) gira nel sidecar: salva le statistiche nella SUA cartella
// dati (~/.quinki/tabs/knowledge/data/) e le restituisce via RPC "knowledge:stats".
const knowledgeServer = `
module.exports = {
  rpc: {
    'knowledge:stats': async (params, ctx) => {
      const fs = require('fs');
      const path = require('path');
      const f = path.join(ctx.dataDir, 'stats.json');
      let stats = { asks: 0, saved: 0 };
      try { stats = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
      if (params && params.action === 'save') stats.saved = (stats.saved || 0) + 1;
      if (params && params.action === 'ask') stats.asks = (stats.asks || 0) + 1;
      fs.writeFileSync(f, JSON.stringify(stats));
      return stats;
    }
  }
}
`

const knowledgeTab = `
return function KnowledgeTab({ quinki }) {
  const [text, setText] = quinki.useState(quinki.notes.read())
  const [summary, setSummary] = quinki.useState('')
  const [stats, setStats] = quinki.useState(null)
  const save = () => { quinki.notes.write(text); quinki.ui.toast('Saved'); quinki.call('knowledge:stats', { action: 'save' }).then(setStats).catch(() => {}) }
  const ask = () => {
    quinki.agent.ask('Summarize this note in one line: ' + text).then((r) => setSummary(r || '')).catch(() => setSummary('(agent not available in simulation)'));
    quinki.call('knowledge:stats', { action: 'ask' }).then(setStats).catch(() => {})
  }
  return quinki.React.createElement('div', { style: { height: '100%', padding: '24px 32px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' } },
    quinki.React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' } },
      quinki.React.createElement('span', { style: { fontSize: '20px' } }, '📚'),
      quinki.React.createElement('span', { style: { color: 'var(--q-text)', fontSize: '17px', fontWeight: 700, fontFamily: 'var(--font-interface)' } }, 'Knowledge'),
      quinki.React.createElement('span', { style: { color: 'var(--q-text-tertiary)', fontSize: '11px', fontFamily: 'var(--font-interface)', marginLeft: 'auto' } }, 'installed tab · v' + quinki.manifest.version)
    ),
    quinki.React.createElement('textarea', {
      value: text,
      onChange: (e) => setText(e.target.value),
      placeholder: 'Your knowledge base…',
      style: { flex: 1, resize: 'none', backgroundColor: 'var(--q-bg-panel)', border: '1px solid var(--q-border)', borderRadius: 'var(--radius-md)', padding: '14px', color: 'var(--q-text)', fontSize: '14px', fontFamily: 'var(--font-interface)', outline: 'none' }
    }),
    quinki.React.createElement('div', { style: { display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' } },
      quinki.React.createElement('button', { onClick: save, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', background: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Save'),
      quinki.React.createElement('button', { onClick: ask, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', background: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Ask AI'),
      summary && quinki.React.createElement('span', { style: { color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)' } }, summary)
    ),
    stats && quinki.React.createElement('div', { style: { marginTop: '10px', color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)' } }, 'back-end: ' + stats.asks + ' asks · ' + stats.saved + ' saves')
  )
}
`

// ── Pomodoro (esempio di bundle reale) ──
const pomodoroTab = `
return function PomodoroTab({ quinki }) {
  const [secs, setSecs] = quinki.useState(25 * 60)
  const [run, setRun] = quinki.useState(false)
  quinki.useEffect(() => { if (!run) return; const t = setInterval(() => setSecs(s => s <= 0 ? 0 : s - 1), 1000); return () => clearInterval(t) }, [run])
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return quinki.React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', padding: '24px' } },
    quinki.React.createElement('div', { style: { fontSize: '64px', fontWeight: 700, fontFamily: 'var(--font-code)', color: 'var(--q-text)' } }, mm + ':' + ss),
    quinki.React.createElement('div', { style: { display: 'flex', gap: '8px' } },
      quinki.React.createElement('button', { onClick: () => setRun(!run), style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-tab-accent)', background: 'transparent', color: 'var(--q-tab-accent)', fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, run ? 'Pause' : 'Start'),
      quinki.React.createElement('button', { onClick: () => { setRun(false); setSecs(25 * 60) }, style: { padding: '7px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--q-border)', background: 'transparent', color: 'var(--q-text-secondary)', fontSize: '13px', fontFamily: 'var(--font-interface)', cursor: 'pointer' } }, 'Reset')
    )
  )
}
`

export const tabPackages: TabPackage[] = [
  {
    manifest: {
      id: 'knowledge', name: 'Knowledge', version: '1.0.0', author: 'Quinki',
      description: 'Your knowledge base, searchable with AI', icon: '📚', color: '#9d8bd9',
      permissions: ['notes:read', 'notes:write', 'agent:ask'], entry: 'bundle.js',
    },
    code: knowledgeTab,
    server: knowledgeServer,
  },
  {
    manifest: {
      id: 'pomodoro', name: 'Pomodoro', version: '1.3.0', author: 'Quinki',
      description: 'Focus timer (25 min)', icon: '🍅', color: '#d29922',
      permissions: [], entry: 'bundle.js',
    },
    code: pomodoroTab,
  },
]

export function findTabPackage(id: string): TabPackage | undefined {
  return tabPackages.find((p) => p.manifest.id === id)
}

export function manifestOfPackage(pkg: TabPackage): TabManifest {
  return pkg.manifest
}
