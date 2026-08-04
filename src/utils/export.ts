import type { Message, ThinkingBlock, ToolCall, ToolResult, DelegationBlock, CompactionInfo } from '../types'

function fmtTime(ts: string): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDate(ts: string): string {
  const d = new Date(ts)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

function esc(s: string | undefined | null): string {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toggle(label: string, content: string): string {
  return `<details>\n<summary>${esc(label)}</summary>\n\n${content}\n\n</details>`
}

function codeBlock(lang: string, content: string): string {
  return '```' + lang + '\n' + (content || '') + '\n```'
}

function blockquote(header: string, content: string): string {
  const lines = (content || '').split('\n')
  const out = [`> **${esc(header)}**`, '>']
  for (const line of lines) out.push(line ? '> ' + line : '>')
  return out.join('\n')
}

function footer(m: Message): string {
  const parts = [fmtTime(m.timestamp)]
  if (m.agentName) parts.push(m.agentName)
  if (m.agentModel) parts.push(m.agentModel)
  if (m.thinkingLevel && m.thinkingLevel !== 'off') parts.push('thinking: ' + m.thinkingLevel)
  if (m.isError) parts.push('⚠️ ERROR')
  if (m.isCompacted) parts.push('📋 compacted')
  if (m.tokensIn) parts.push('in: ' + m.tokensIn)
  if (m.tokensOut) parts.push('out: ' + m.tokensOut)
  return `*${parts.join(' · ')}*`
}

// === Render delegation block (MD) ===
function renderDelegationMd(d: DelegationBlock): string[] {
  const out: string[] = []
  out.push(`> **${d.agentName || 'Agent'} responded**`)
  out.push('>')
  if (d.agentModel) out.push(`> Model: ${d.agentModel}`)
  if (d.mode) out.push(`> Mode: ${d.mode}`)
  if (d.thinkingLevel && d.thinkingLevel !== 'off') out.push(`> Thinking: ${d.thinkingLevel}`)
  out.push('>')
  if (d.taskContent) {
    out.push('> **Task:**')
    for (const line of d.taskContent.split('\n')) out.push(line ? '> ' + line : '>')
    out.push('>')
  }
  if (d.thinking?.length) {
    for (const t of d.thinking) {
      if (t.content) { out.push(toggle('Thinking', t.content)); out.push('>') }
    }
  }
  if (d.toolCalls?.length) {
    for (const tc of d.toolCalls) {
      out.push(toggle(`Tool call: ${tc.name}`, codeBlock('json', tc.input || ''))); out.push('>')
    }
  }
  if (d.toolResults?.length) {
    for (const tr of d.toolResults) {
      const lbl = tr.isError ? `Tool error: ${tr.name}` : `Tool result: ${tr.name}`
      out.push(toggle(lbl, codeBlock('', tr.output || ''))); out.push('>')
    }
  }
  if (d.response) {
    out.push('> **Response:**')
    for (const line of d.response.split('\n')) out.push(line ? '> ' + line : '>')
  }
  // Delegations: from delegations property (old) or blocks array (new)
  const allDelegations = [...(d.delegations || []), ...((d.blocks || []).filter((b: any) => b.type === 'delegation'))]
  if (allDelegations.length) {
    for (const sub of allDelegations) {
      out.push('>')
      out.push(...renderDelegationMd(sub))
    }
  }
  return out
}

// === Render compaction (MD) ===
function renderCompactionMd(c: CompactionInfo): string {
  if (c.isNoop) return toggle('Compaction (noop — no content to compact)', '')
  return toggle('Compaction Summary', c.content || '')
}

export function exportToMarkdown(messages: Message[], label: string): string {
  const sorted = [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const lines: string[] = []
  lines.push(`# ${label || 'Untitled'}`)
  lines.push('')
  lines.push(`*Exported: ${fmtDate(new Date().toISOString())}*`)
  lines.push('')
  lines.push('> Full export — includes all messages, thinking, tool calls, delegations, compaction and metadata.')
  lines.push('')

  for (const m of sorted) {
    if (m.role === 'user') {
      lines.push('---'); lines.push('')
      lines.push(blockquote(`User · ${fmtTime(m.timestamp)}`, m.content || ''))
      lines.push(''); continue
    }

    if (m.role === 'assistant') {
      lines.push('---'); lines.push('')
      const agentLabel = m.agentName ? `**${m.agentName}**` : '**Assistant**'
      const incomplete = m.isStreaming ? ' _(incomplete)_' : ''
      lines.push(`${agentLabel}${incomplete}`); lines.push('')

      // Content
      if (m.content) { lines.push(m.content); lines.push('') }

      // Thinking
      if (m.thinking?.length) {
        for (const t of m.thinking) {
          if (t.content) { lines.push(toggle('Thinking', t.content)); lines.push('') }
        }
      }

      // Tool calls
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          lines.push(toggle(`Tool call: ${tc.name}`, codeBlock('json', tc.input || '(no input)'))); lines.push('')
        }
      }

      // Tool results
      if (m.toolResults?.length) {
        for (const tr of m.toolResults) {
          const lbl = tr.isError ? `Tool error: ${tr.name}` : `Tool result: ${tr.name}`
          lines.push(toggle(lbl, codeBlock('', tr.output || '(no output)'))); lines.push('')
        }
      }

      // Delegations
      const msgDelegations = [...(m.delegations || []), ...((m.blocks || []).filter((b: any) => b.type === 'delegation'))]
      if (msgDelegations.length) {
        for (const d of msgDelegations) {
          lines.push('---'); lines.push('')
          lines.push(...renderDelegationMd(d))
          lines.push('')
        }
      }

      // Compaction
      if (m.compaction?.length) {
        for (const c of m.compaction) {
          lines.push(renderCompactionMd(c)); lines.push('')
        }
      }

      // Error content
      if (m.isError && m.errorContent) {
        lines.push(toggle('Error details', m.errorContent)); lines.push('')
      }

      lines.push(footer(m)); lines.push(''); continue
    }

    if (m.role === 'system') {
      lines.push('---'); lines.push('')
      if (m.isError) {
        lines.push('**⚠️ Error**'); lines.push('')
        lines.push(m.errorContent || m.content || ''); lines.push('')
      } else if (m.compaction?.length) {
        for (const c of m.compaction) {
          lines.push(renderCompactionMd(c)); lines.push('')
        }
      } else {
        lines.push('**System**'); lines.push('')
        lines.push(m.content || ''); lines.push('')
      }
      lines.push(''); continue
    }
  }

  return lines.join('\n')
}

// === Render delegation block (HTML) ===
function renderDelegationHtml(d: DelegationBlock): string {
  let html = '<div class="msg msg-delegation">'
  html += `<div class="role-label role-delegation">${esc(d.agentName || 'Agent')} responded</div>`
  html += '<div class="content">'
  if (d.agentModel) html += `<div class="delegation-meta">Model: ${esc(d.agentModel)} · Mode: ${esc(d.mode)}</div>`
  if (d.taskContent) html += `<div class="delegation-task"><strong>Task:</strong><br>${esc(d.taskContent)}</div>`
  if (d.thinking?.length) {
    for (const t of d.thinking) {
      if (t.content) html += `<details class="tool-call"><summary>Thinking</summary><div class="detail-content">${esc(t.content)}</div></details>`
    }
  }
  if (d.toolCalls?.length) {
    for (const tc of d.toolCalls) {
      html += `<details class="tool-call"><summary>Tool call: ${esc(tc.name)}</summary><div class="detail-content"><pre><code>${esc(tc.input)}</code></pre></div></details>`
    }
  }
  if (d.toolResults?.length) {
    for (const tr of d.toolResults) {
      const cls = tr.isError ? 'tool-error' : 'tool-result'
      html += `<details class="${cls}"><summary>${tr.isError ? 'Tool error' : 'Tool result'}: ${esc(tr.name)}</summary><div class="detail-content"><pre><code>${esc(tr.output)}</code></pre></div></details>`
    }
  }
  if (d.response) html += `<div class="delegation-response">${esc(d.response)}</div>`
  if (d.delegations?.length) {
    for (const sub of d.delegations) html += renderDelegationHtml(sub)
  }
  html += '</div></div>'
  return html
}

export function exportToHtml(messages: Message[], label: string): string {
  const sorted = [...messages].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  const dateStr = fmtDate(new Date().toISOString())

  const body = sorted.map(m => {
    if (m.role === 'user') {
      return `<div class="msg msg-user"><div class="role-label role-user">User · ${fmtTime(m.timestamp)}</div><div class="content">${esc(m.content)}</div></div>`
    }
    if (m.role === 'assistant') {
      let content = esc(m.content)
      if (m.thinking?.length) {
        for (const t of m.thinking) {
          if (t.content) content += `<details class="tool-call"><summary>Thinking</summary><div class="detail-content">${esc(t.content)}</div></details>`
        }
      }
      if (m.toolCalls?.length) {
        for (const tc of m.toolCalls) {
          content += `<details class="tool-call"><summary>Tool call: ${esc(tc.name)}</summary><div class="detail-content"><pre><code>${esc(tc.input)}</code></pre></div></details>`
        }
      }
      if (m.toolResults?.length) {
        for (const tr of m.toolResults) {
          const cls = tr.isError ? 'tool-error' : 'tool-result'
          content += `<details class="${cls}"><summary>${tr.isError ? 'Tool error' : 'Tool result'}: ${esc(tr.name)}</summary><div class="detail-content"><pre><code>${esc(tr.output)}</code></pre></div></details>`
        }
      }
      const htmlDelegations = [...(m.delegations || []), ...((m.blocks || []).filter((b: any) => b.type === 'delegation'))]
      if (htmlDelegations.length) {
        for (const d of htmlDelegations) content += renderDelegationHtml(d)
      }
      if (m.compaction?.length) {
        for (const c of m.compaction) {
          content += `<details class="msg-compaction"><summary>Compaction ${c.isNoop ? '(noop)' : 'Summary'}</summary><div class="detail-content">${esc(c.content)}</div></details>`
        }
      }
      if (m.isError && m.errorContent) {
        content += `<div class="error-content">${esc(m.errorContent)}</div>`
      }
      const footerParts = [fmtTime(m.timestamp)]
      if (m.agentName) footerParts.push(m.agentName)
      if (m.agentModel) footerParts.push(m.agentModel)
      if (m.thinkingLevel && m.thinkingLevel !== 'off') footerParts.push('thinking: ' + m.thinkingLevel)
      if (m.isError) footerParts.push('⚠️ ERROR')
      const footerHtml = `<div class="footer">${footerParts.map(p => `<span>${esc(p)}</span>`).join('<span class="sep">·</span>')}</div>`
      const incomplete = m.isStreaming ? ' <span class="incomplete">(incomplete)</span>' : ''
      return `<div class="msg msg-assistant"><div class="role-label role-agent">${esc(m.agentName || 'Assistant')}${incomplete}</div><div class="content">${content}</div>${footerHtml}</div>`
    }
    if (m.role === 'system') {
      if (m.isError) {
        return `<div class="msg msg-system"><div class="role-label role-system">⚠️ Error</div><div class="content">${esc(m.errorContent || m.content)}</div></div>`
      }
      if (m.compaction?.length) {
        const c = m.compaction[0]
        return `<div class="msg msg-compaction"><div class="role-label role-compaction">Compaction ${c.isNoop ? '(noop)' : 'Summary'}</div><div class="content">${esc(c.content)}</div></div>`
      }
      return `<div class="msg msg-system"><div class="role-label role-system">System</div><div class="content">${esc(m.content)}</div></div>`
    }
    return ''
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(label || 'Chat')}</title>
<style>
:root {
  --bg:#1a1a2e; --surface:#16213e; --text:#e0e0e0;
  --text-secondary:#a0a0a0; --text-tertiary:#707070;
  --accent-info:#4a9eff; --danger:#e74c3c; --delegation:#c46a7e;
  --code-bg:#1e1e3e; --border:#2a2a4a; --user-bg:#1a1a3e;
  --radius:12px; --mono:'SF Mono','Fira Code',Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { background:var(--bg); color:var(--text); font-family:var(--sans); font-size:14px; line-height:1.6; padding:20px; max-width:900px; margin:0 auto; }
.header { text-align:center; padding:20px 0 30px; border-bottom:1px solid var(--border); margin-bottom:20px; }
.header h1 { font-size:20px; font-weight:600; margin-bottom:4px; }
.header .date { color:var(--text-tertiary); font-size:12px; }
.msg { margin-bottom:16px; }
.msg-user { background:var(--user-bg); border-radius:var(--radius); padding:12px 16px; margin-left:40px; border:1px solid var(--border); }
.msg-assistant { background:var(--surface); border-radius:var(--radius); padding:12px 16px; border:1px solid var(--border); }
.msg-delegation { background:var(--surface); border-radius:var(--radius); padding:12px 16px; border-left:3px solid var(--delegation); border:1px solid var(--border); margin:8px 0; }
.msg-system { background:rgba(231,76,60,0.1); border-radius:var(--radius); padding:10px 14px; border:1px solid rgba(231,76,60,0.3); }
.msg-compaction { background:rgba(74,158,255,0.08); border-radius:var(--radius); padding:10px 14px; border:1px solid rgba(74,158,255,0.2); }
.role-label { font-size:12px; font-weight:600; color:var(--text-secondary); margin-bottom:6px; }
.role-user { color:var(--accent-info); }
.role-agent { color:var(--text); }
.role-delegation { color:var(--delegation); }
.role-system { color:var(--danger); }
.role-compaction { color:var(--accent-info); }
.content { margin:4px 0; white-space:pre-wrap; word-wrap:break-word; }
.content pre { background:var(--code-bg); border-radius:8px; padding:12px; overflow-x:auto; margin:8px 0; }
.content code { font-family:var(--mono); font-size:13px; }
.delegation-meta { font-size:12px; color:var(--text-tertiary); margin-bottom:4px; }
.delegation-task { background:rgba(255,255,255,0.03); padding:8px; border-radius:8px; margin:4px 0; font-size:13px; }
.delegation-response { margin-top:8px; }
.error-content { background:rgba(231,76,60,0.08); padding:8px; border-radius:8px; margin:4px 0; color:var(--danger); font-size:13px; }
.incomplete { color:var(--text-tertiary); font-style:italic; font-size:11px; }
details { margin:6px 0; border-radius:8px; background:rgba(255,255,255,0.03); overflow:hidden; }
details summary { cursor:pointer; padding:8px 12px; font-size:13px; color:var(--text-secondary); user-select:none; }
details[open] summary { border-bottom:1px solid var(--border); }
.detail-content { padding:8px 12px; }
.tool-call { border-left:2px solid var(--accent-info); }
.tool-result { border-left:2px solid var(--text-tertiary); }
.tool-error { border-left:2px solid var(--danger); }
.footer { margin-top:8px; font-size:11px; color:var(--text-tertiary); display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.footer .sep { color:var(--border); }
</style>
</head>
<body>
<div class="header"><h1>${esc(label || 'Chat')}</h1><div class="date">${dateStr}</div></div>
${body}
</body>
</html>`
}