// ============================================================
// Quinki FCM relay — Cloudflare Worker (free tier).
// La chiave di invio FCM vive SOLO qui (env.FCM_SA, un secret del Worker).
// Il prodotto (app Mac di ogni utente) NON contiene la chiave: manda al postino
// {target, title, body} e il postino invia. Chi volesse spammare dovrebbe
// CONOSCERE il token FCM del bersaglio, che non esce mai da telefono+Mac+postino:
// impossibile. In piu' rate-limit per IP come rete di sicurezza.
// ============================================================

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uStr = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64uStr(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }))
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(header + '.' + claims))
  const jwt = header + '.' + claims + '.' + b64u(sig)
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
  })
  const j = await r.json()
  return j.access_token || ''
}

// Rate limit best-effort in memoria (per isolate). KV opzionale in futuro.
const hits = new Map()
function rateLimited(ip) {
  const now = Date.now()
  const slot = hits.get(ip) || { t: now, n: 0 }
  if (now - slot.t > 60_000) { slot.t = now; slot.n = 0 }
  slot.n++
  hits.set(ip, slot)
  return slot.n > 120
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname === '/health') return new Response('ok')
    if (url.pathname !== '/send' || req.method !== 'POST') return new Response('not found', { status: 404 })
    const ip = req.headers.get('cf-connecting-ip') || 'unknown'
    if (rateLimited(ip)) return new Response('rate limited', { status: 429 })
    let body = {}
    try { body = await req.json() } catch {}
    const target = String(body.target || '')
    const title = String(body.title || 'Quinki').slice(0, 90)
    const text = String(body.body || '').slice(0, 220)
    const sessionKey = String(body.sessionKey || '').slice(0, 120)
    if (!target || target.length < 80) return new Response('bad target', { status: 400 })
    try {
      const sa = JSON.parse(env.FCM_SA)
      const at = await getAccessToken(sa)
      if (!at) return new Response('auth failed', { status: 502 })
      const r = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: target,
            notification: { title, body: text },
            data: { sessionKey },
            android: { priority: 'high', notification: { channel_id: 'quinki' } },
          },
        }),
      })
      const t = await r.text()
      return new Response(t, { status: r.status, headers: { 'Content-Type': 'application/json' } })
    } catch (e) {
      return new Response('relay error', { status: 500 })
    }
  },
}
