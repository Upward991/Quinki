// src/utils/history.ts — merge della history (getHistory) nella forma Message usata dal renderer.
// Estratto da useSidecarData (selectSession) per essere riusato (es. modale chat per creare task).

export function mergeHistoryMessages(history: any): any[] {
  const merged: any[] = []
  if (!history?.messages) return merged
  for (const m of history.messages) {
    if (m.role === 'delegation') {
      // Delegation from buildSessionContext — insert as block at current position
      const nb: any[] = []
      if (Array.isArray(m.content)) {
        for (const b of m.content) {
          if (b?.type === 'thinking') nb.push({ type: 'thinking', content: b.thinking || b.content || '' })
          else if (b?.type === 'toolCall') nb.push({ type: 'tool_call', name: b.text || b.name || 'tool', input: b.thinking || b.input || b.args || '' })
          else if (b?.type === 'toolResult') nb.push({ type: 'tool_result', name: b.text || b.name || 'tool', output: b.thinking || b.content || '', isError: !!b.isError })
          else if (b?.type === 'text') nb.push({ type: 'text', content: b.text || b.content || '' })
        }
      }
      const delBlock = { type: 'delegation', id: m.id, agentName: m.agentName || 'agent', agentModel: m.model || '', taskContent: m.delegatedMessage || '', response: typeof m.content === 'string' ? m.content : '', blocks: nb, thinkingLevel: m.thinkingLevel || '', streaming: false }
      let lastM = merged[merged.length - 1]
      if (!lastM || lastM.role !== 'assistant') { lastM = { id: 'delmsg-' + m.id, role: 'assistant', content: '', blocks: [], timestamp: m.timestamp || new Date().toISOString() }; merged.push(lastM) }
      lastM.blocks = [...(lastM.blocks || []), delBlock]
      continue
    }
    const base: any = {
      id: m.id || `msg-${Math.random()}`,
      role: m.role,
      content: m.content || '',
      timestamp: m.timestamp || new Date().toISOString(),
      thinking: m.reasoning || m.thinking,
      agentName: m.agentName, agentModel: m.model, thinkingLevel: m.thinkingLevel,
      tokensIn: m.tokensIn, tokensOut: m.tokensOut,
      isCompacted: m.isCompacted, isError: m.isError,
      errorType: m.errorType, errorContent: m.errorContent,
    }
    if (m.role === 'tool_call') {
      let last = merged[merged.length - 1]
      if (!last || last.role !== 'assistant') { last = { id: `tc-parent-${m.id}`, role: 'assistant', content: '', blocks: [], timestamp: base.timestamp }; merged.push(last) }
      const input = typeof m.toolArgs === 'string' ? m.toolArgs : JSON.stringify(m.toolArgs ?? '')
      last.toolCalls = [...(last.toolCalls || []), { name: m.toolName || 'tool', input }]
      last.blocks = [...(last.blocks || [])]
      if (m.reasoning) last.blocks.push({ type: 'thinking', content: m.reasoning })
      last.blocks.push({ type: 'tool_call', name: m.toolName || 'tool', input })
    } else if (m.role === 'tool_result') {
      let last = merged[merged.length - 1]
      if (!last || last.role !== 'assistant') { last = { id: `tr-parent-${m.id}`, role: 'assistant', content: '', blocks: [], timestamp: base.timestamp }; merged.push(last) }
      last.toolResults = [...(last.toolResults || []), { name: m.toolName || 'tool', output: String(m.content || ''), isError: !!m.isError }]
      last.blocks = [...(last.blocks || []), { type: 'tool_result', name: m.toolName || 'tool', output: String(m.content || ''), isError: !!m.isError }]
    } else if (m.isCompactionSummary || m.isCompactionWarning) {
      merged.push({ id: base.id, role: 'assistant', content: '', timestamp: base.timestamp, compaction: [{ content: m.content || '', isNoop: !!m.isCompactionWarning }] })
    } else {
      if (base.role === 'assistant') {
        if (base.thinking) {
          base.blocks = [...(base.blocks || []), { type: 'thinking', content: typeof base.thinking === 'string' ? base.thinking : (Array.isArray(base.thinking) ? base.thinking.map((x: any) => x?.content ?? x ?? '').join('') : String(base.thinking)) }]
        }
        if (base.content) {
          base.blocks = [...(base.blocks || []), { type: 'text', content: base.content }]
        }
      }
      merged.push(base)
    }
  }
  return merged
}
