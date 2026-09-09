// publish.ts — A4.4 Blocco 5: PUBBLICAZIONE su GitHub.
// Da un pacchetto locale (categoria + files) crea: scan sicurezza → branch + commit
// + PR al repo del market (quinki-market). L'autore = login GitHub del token.
// Il token è quello per-repo (o un PAT con scope repo).

export interface PublishOptions {
  token: string
  repo: string
  category: string   // tab | agent | skill | mcp | theme
  id: string
  name: string
  version: string
  author: string
  description: string
  icon: string
  color: string
  license: string    // license chosen by the author (default MIT) — see manifest
  files: Record<string, string>   // es. { 'SKILL.md': '...', 'config.json': '...' }
}

export interface ScanResult { safe: boolean; warnings: string[] }

// === Rilevamento SEGRETI (chiavi API/token accidentalmente inclusi nei file) ===
export function detectSecrets(files: Record<string, string>): string[] {
  const secrets: string[] = []
  const PATTERNS: { re: RegExp; name: string }[] = [
    { re: /ghp_[A-Za-z0-9]{36,}/, name: 'GitHub token (ghp_)' },
    { re: /gho_[A-Za-z0-9]{36,}/, name: 'GitHub OAuth token (gho_)' },
    { re: /sk-[A-Za-z0-9]{20,}/, name: 'OpenAI key (sk-)' },
    { re: /AKIA[0-9A-Z]{16}/, name: 'AWS access key' },
    { re: /AIza[0-9A-Za-z_-]{35}/, name: 'Google API key' },
    { re: /xox[baprs]-[0-9A-Za-z-]{10,}/, name: 'Slack token' },
    { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/, name: 'private key' },
  ]
  for (const [name, content] of Object.entries(files)) {
    const c = String(content || '')
    for (const p of PATTERNS) {
      if (p.re.test(c)) secrets.push(name + ': ' + p.name)
    }
  }
  return secrets
}

// === 5.3 — SCAN SICUREZZA (analisi statica) ===
export function scanPackageSafety(files: Record<string, string>): ScanResult {
  const warnings: string[] = []
  const DANGEROUS: { re: RegExp; msg: string }[] = [
    { re: /\beval\s*\(/i, msg: 'uses eval()' },
    { re: /child_process/i, msg: 'references child_process' },
    { re: /\bexec\s*\(/i, msg: 'uses exec()' },
    { re: /require\(['"]https?:/i, msg: 'requires a remote URL' },
    { re: /process\.env/i, msg: 'reads environment variables' },
    { re: /fetch\(\s*['"]http/i, msg: 'makes network requests' },
    { re: /fs\.(writeFile|rm|unlink|rmSync|writeFileSync)/i, msg: 'writes/deletes files' },
    { re: /base64.*decode/i, msg: 'decodes base64 (possible obfuscation)' },
  ]
  for (const [name, content] of Object.entries(files)) {
    const c = String(content || '')
    for (const d of DANGEROUS) {
      if (d.re.test(c)) warnings.push(name + ': ' + d.msg)
    }
  }
  return { safe: warnings.length === 0, warnings }
}

// === GitHub API helper (rate limit 5000/h con token) ===
async function gh(token: string, method: string, url: string, body?: any): Promise<any> {
  const res = await fetch('https://api.github.com' + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Quinki',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error('GitHub ' + res.status + ': ' + t.slice(0, 250))
  }
  return res.json()
}

const CAT_KEY: Record<string, string> = { tab: 'tabs', agent: 'agents', skill: 'skills', mcp: 'mcp', theme: 'themes' }

// === 5.1 + 5.2 — PUBBLICA (fork + PR): chiunque può proporre senza permessi speciali ===
export interface PublishResult { prUrl: string; branch: string; prNumber: number; headSha: string }

// Stato dei check della PR (workflow auto-merge): none | pending | success | failure
export async function checkPrStatus(token: string, repo: string, headSha: string): Promise<{ status: string; conclusion: string }> {
  try {
    const d = await gh(token, 'GET', '/repos/' + repo + '/commits/' + headSha + '/check-runs')
    const runs = d?.check_runs || []
    if (runs.length === 0) return { status: 'none', conclusion: '' }
    const allDone = runs.every((r: any) => r.status === 'completed')
    if (!allDone) return { status: 'pending', conclusion: '' }
    // Solo failure/action_required/timed_out sono fallimenti VERI.
    // 'stale' (PR superseded), 'cancelled', 'neutral' NON sono errori di validazione:
    // evitano i falsi "failed" (es. dopo un merge, i check vecchi diventano stale).
    const failed = runs.filter((r: any) => {
      const c = r.conclusion
      return c === 'failure' || c === 'action_required' || c === 'timed_out'
    })
    if (failed.length > 0) return { status: 'failure', conclusion: failed[0].conclusion || 'failure' }
    return { status: 'success', conclusion: 'success' }
  } catch { return { status: 'none', conclusion: '' } }
}

export async function publishPackage(opts: PublishOptions): Promise<PublishResult> {
  const { token, repo, category, id } = opts
  if (!token) throw new Error('A GitHub token is required to publish.')
  const catKey = CAT_KEY[category] || category + 's'
  const branch = 'publish/' + category + '/' + id + '-' + Date.now().toString(36)

  // 0. identità dell'utente dal token
  const me = await gh(token, 'GET', '/user')
  const myLogin = me?.login
  if (!myLogin) throw new Error('Could not read your GitHub identity from the token.')

  // 1. FORK del repo sotto l'account dell'utente (crea o restituisce l'esistente)
  let forkFullName = ''
  try {
    const fork = await gh(token, 'POST', '/repos/' + repo + '/forks')
    forkFullName = fork?.full_name || (myLogin + '/' + repo.split('/')[1])
  } catch {
    forkFullName = myLogin + '/' + repo.split('/')[1]
  }

  // 2. base ref (main/master) del FORK
  let baseRef: any
  try { baseRef = await gh(token, 'GET', '/repos/' + forkFullName + '/git/ref/heads/main') }
  catch { baseRef = await gh(token, 'GET', '/repos/' + forkFullName + '/git/refs/heads/master') }
  const baseSha = baseRef?.object?.sha
  if (!baseSha) throw new Error('Could not find the base branch in the fork ' + forkFullName)

  // 3. base tree del FORK + catalog.json corrente
  // FIX 404: /git/trees vuole lo sha del TREE, non del COMMIT — lo risolviamo dal commit.
  // FIX 404 (2): repo VUOTO → il tree vuoto NON è fetchable (GitHub 404) → tree = {tree: []}
  const baseCommit = await gh(token, 'GET', '/repos/' + forkFullName + '/git/commits/' + baseSha)
  const baseTreeSha = baseCommit?.tree?.sha || ''
  let baseTree: any = { tree: [] }
  let hasBaseTree = false
  try {
    baseTree = await gh(token, 'GET', '/repos/' + forkFullName + '/git/trees/' + baseTreeSha + '?recursive=1')
    hasBaseTree = true
  } catch { baseTree = { tree: [] }; hasBaseTree = false }
  let catalog: any = { tabs: [], agents: [], skills: [], mcp: [], themes: [] }
  const catEntry = (baseTree?.tree || []).find((t: any) => t.path === 'catalog.json')
  if (catEntry?.sha) {
    const catBlob = await gh(token, 'GET', '/repos/' + forkFullName + '/git/blobs/' + catEntry.sha)
    try { catalog = JSON.parse(atob(catBlob.content)) } catch {}
  }

  // 4. manifest + files del pacchetto
  const manifest = {
    id, name: opts.name, version: opts.version, author: opts.author,
    description: opts.description, icon: opts.icon, color: opts.color,
    license: opts.license || 'MIT',
    category, installs: 0, rating: 0,
    downloadUrl: 'https://raw.githubusercontent.com/' + repo + '/main/packages/' + catKey + '/' + id + '/',
    source: repo,
  }
  const filesToAdd: Record<string, string> = {
    ['packages/' + catKey + '/' + id + '/manifest.json']: JSON.stringify(manifest, null, 2),
  }
  for (const [k, v] of Object.entries(opts.files)) {
    filesToAdd['packages/' + catKey + '/' + id + '/' + k] = v
  }
  if (!Array.isArray(catalog[catKey])) catalog[catKey] = []
  const existing = catalog[catKey].findIndex((x: any) => x.id === id)
  if (existing >= 0) catalog[catKey][existing] = manifest
  else catalog[catKey].push(manifest)
  filesToAdd['catalog.json'] = JSON.stringify(catalog, null, 2)

  // 5. blob per ogni file (sul FORK)
  const treeItems: any[] = []
  for (const [path, content] of Object.entries(filesToAdd)) {
    const blob = await gh(token, 'POST', '/repos/' + forkFullName + '/git/blobs', { content: String(content), encoding: 'utf-8' })
    treeItems.push({ path, sha: blob.sha, mode: '100644', type: 'blob' })
  }

  // 6. nuovo tree
  const tree = await gh(token, 'POST', '/repos/' + forkFullName + '/git/trees', hasBaseTree ? { base_tree: baseTreeSha, tree: treeItems } : { tree: treeItems })

  // 7. commit
  const commit = await gh(token, 'POST', '/repos/' + forkFullName + '/git/commits', {
    message: 'Publish ' + category + ' ' + id + ' v' + opts.version,
    tree: tree.sha, parents: [baseSha],
  })

  // 8. branch ref sul FORK
  try { await gh(token, 'POST', '/repos/' + forkFullName + '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha }) }
  catch (e: any) {
    await gh(token, 'PATCH', '/repos/' + forkFullName + '/git/refs/heads/' + branch, { sha: commit.sha, force: true })
  }

  // 9. PR dal fork al repo base (head = mioLogin:branch)
  const pr = await gh(token, 'POST', '/repos/' + repo + '/pulls', {
    title: 'Publish ' + opts.name + ' (' + category + ')',
    head: myLogin + ':' + branch, base: 'main',
    body: 'Auto-generated by Quinki.\n\nPackage: **' + opts.name + '** (' + category + ') v' + opts.version +
      '\nAuthor: ' + opts.author + '\n\n' + opts.description +
      '\n\n> Scan sicurezza: ' + (scanPackageSafety(opts.files).safe ? 'nessun pattern pericoloso rilevato' : 'VEDERE WARNING'),
  })
  return { prUrl: pr.html_url || ('https://github.com/' + repo + '/pull/' + pr.number), branch, prNumber: pr.number, headSha: pr.head.sha }
}


// === 5.4 — RIMUOVI dal market (PR che elimina il pacchetto) ===
export async function removePackage(opts: { token: string; repo: string; category: string; id: string; name: string }): Promise<{ prUrl: string; branch: string }> {
  const { token, repo, category, id } = opts
  if (!token) throw new Error('A GitHub token is required.')
  const me = await gh(token, 'GET', '/user')
  const myLogin = me?.login
  if (!myLogin) throw new Error('Could not read your GitHub identity from the token.')
  let forkFullName = ''
  try { const fork = await gh(token, 'POST', '/repos/' + repo + '/forks'); forkFullName = fork?.full_name || (myLogin + '/' + repo.split('/')[1]) }
  catch { forkFullName = myLogin + '/' + repo.split('/')[1] }
  let baseRef: any
  try { baseRef = await gh(token, 'GET', '/repos/' + forkFullName + '/git/ref/heads/main') }
  catch { baseRef = await gh(token, 'GET', '/repos/' + forkFullName + '/git/refs/heads/master') }
  const baseSha = baseRef?.object?.sha
  if (!baseSha) throw new Error('Could not find the base branch in ' + forkFullName)
  const baseTree = await gh(token, 'GET', '/repos/' + forkFullName + '/git/trees/' + baseSha + '?recursive=1')

  const prefix = 'packages/' + (CAT_KEY[category] || category + 's') + '/' + id + '/'
  const treeItems: any[] = []
  let catalog: any = { tabs: [], agents: [], skills: [], mcp: [], themes: [] }
  let catalogChanged = false
  for (const e of (baseTree?.tree || [])) {
    if (e.type !== 'blob') continue
    if (e.path.startsWith(prefix)) continue // elimina i file del pacchetto
    if (e.path === 'catalog.json') {
      const blob = await gh(token, 'GET', '/repos/' + forkFullName + '/git/blobs/' + e.sha)
      try { catalog = JSON.parse(atob(blob.content)) } catch {}
      continue
    }
    treeItems.push({ path: e.path, sha: e.sha, mode: e.mode || '100644', type: 'blob' })
  }
  const catKey = CAT_KEY[category] || category + 's'
  if (Array.isArray(catalog[catKey])) {
    const before = catalog[catKey].length
    catalog[catKey] = catalog[catKey].filter((x: any) => x.id !== id)
    if (catalog[catKey].length !== before) catalogChanged = true
  }
  if (catalogChanged) {
    const blob = await gh(token, 'POST', '/repos/' + forkFullName + '/git/blobs', { content: JSON.stringify(catalog, null, 2), encoding: 'utf-8' })
    treeItems.push({ path: 'catalog.json', sha: blob.sha, mode: '100644', type: 'blob' })
  }
  const branch = 'remove/' + category + '/' + id + '-' + Date.now().toString(36)
  const tree = await gh(token, 'POST', '/repos/' + forkFullName + '/git/trees', { tree: treeItems })
  const commit = await gh(token, 'POST', '/repos/' + forkFullName + '/git/commits', {
    message: 'Remove ' + category + ' ' + id, tree: tree.sha, parents: [baseSha],
  })
  try { await gh(token, 'POST', '/repos/' + forkFullName + '/git/refs', { ref: 'refs/heads/' + branch, sha: commit.sha }) }
  catch (e: any) { await gh(token, 'PATCH', '/repos/' + forkFullName + '/git/refs/heads/' + branch, { sha: commit.sha, force: true }) }
  const pr = await gh(token, 'POST', '/repos/' + repo + '/pulls', {
    title: 'Remove ' + opts.name + ' (' + category + ')',
    head: myLogin + ':' + branch, base: 'main',
    body: 'Auto-generated by Quinki: remove package ' + opts.name + ' (' + category + ').',
  })
  return { prUrl: pr.html_url || ('https://github.com/' + repo + '/pull/' + pr.number), branch }
}
