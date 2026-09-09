// ghOAuth.ts — A4.4 Blocco 5: login GitHub via DEVICE FLOW.
// La app mostra un codice → l'utente lo inserisce su github.com/login/device
// → la app fa polling e riceve il token (con l'identità GitHub dell'utente).
const CLIENT_ID = 'Ov23liskJJuKGs1NAsON'
const TOKEN_KEY = 'quinki-github-oauth-token'

export interface DeviceFlowSession {
  device_code: string
  user_code: string
  verification_uri: string
  interval: number
}

type SidecarCall = (method: string, params?: any, timeout?: number) => Promise<any>

// FLUSSO CLASSICO: il SIDECAR apre il BROWSER (github.com/login/oauth/authorize),
// l'utente entra/crea l'account, GitHub reindirizza al callback locale del sidecar
// che scambia il code col token. Il frontend fa polling sullo stato.
export async function startOAuthFlow(call?: SidecarCall): Promise<boolean> {
  const c: any = call || (window as any).__sidecarCall
  if (!c) throw new Error('Sidecar not connected.')
  const r = await c('githubOAuthStart')
  if (!r?.ok) throw new Error('GitHub: ' + (r?.error || 'could not open the browser'))
  return true
}

// Polling: restituisce il token quando pronto, null se ancora in attesa.
export async function pollOAuth(call?: SidecarCall): Promise<string | null> {
  const c: any = call || (window as any).__sidecarCall
  if (!c) throw new Error('Sidecar not connected.')
  const st = await c('githubOAuthStatus')
  if (st?.token) return st.token
  if (st?.error) throw new Error('GitHub: ' + st.error)
  return null
}

// Token salvato su FILE (~/.quinki/github-auth.json) via sidecar:
// persiste tra gli avvii E tra le reinstallazioni (il localStorage del webview
// viene pulito dall'install script).
export async function getGithubToken(call?: SidecarCall): Promise<string> {
  const c: any = call || (window as any).__sidecarCall
  if (!c) return ''
  try { const r = await c('githubTokenGet'); return r?.token || '' } catch { return '' }
}
export async function setGithubToken(t: string, call?: SidecarCall) {
  const c: any = call || (window as any).__sidecarCall
  if (!c) return
  try { await c('githubTokenSet', { token: t }) } catch {}
}
export async function clearGithubToken(call?: SidecarCall) {
  const c: any = call || (window as any).__sidecarCall
  if (!c) return
  try { await c('githubTokenClear') } catch {}
}

export interface GithubIdentity { login: string; name: string; avatar_url: string; html_url: string }

// Identità GitHub dal token.
export async function getGithubIdentity(token: string): Promise<GithubIdentity> {
  const res = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + token } })
  if (!res.ok) throw new Error('GitHub user: HTTP ' + res.status)
  return await res.json()
}
