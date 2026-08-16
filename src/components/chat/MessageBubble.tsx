// ============================================================
// MessageBubble — with markdown + syntax highlighting
// Order: thinking → tool calls → tool results → text(markdown) → compaction → delegation
// ============================================================

import React, { useState, useEffect, useRef, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import type { Message, DelegationBlock, ThinkingBlock, ToolCall, ToolResult, CompactionInfo } from '../../types'
import { Copy, Check, Info, ChevronRight } from '../icons'

// Highlight search matches in text
// Highlight the Nth occurrence of query in React children (string parts only)
function highlightChildren(children: React.ReactNode, query: string, activeOcc: number, occRef: React.MutableRefObject<number>): React.ReactNode {
  if (!query || !query.trim() || activeOcc < 0) return children
  const q = query.trim()
  const lowerQ = q.toLowerCase()
  const flat = React.Children.toArray(children)
  const result: React.ReactNode[] = []
  for (const child of flat) {
    if (typeof child === 'string') {
      const lower = child.toLowerCase()
      let idx = lower.indexOf(lowerQ)
      let lastIdx = 0
      const parts: React.ReactNode[] = []
      let key = 0
      while (idx !== -1) {
        if (idx > lastIdx) parts.push(child.substring(lastIdx, idx))
        if (occRef.current === activeOcc) {
          parts.push(React.createElement('mark', { key: 'hl_' + key++, style: { backgroundColor: 'var(--q-search-highlight-bg)', color: 'var(--q-search-highlight-text)', borderRadius: '2px', padding: '0 2px' } }, child.substring(idx, idx + q.length)))
        } else {
          parts.push(child.substring(idx, idx + q.length))
        }
        occRef.current++
        lastIdx = idx + q.length
        idx = lower.indexOf(lowerQ, lastIdx)
      }
      if (lastIdx < child.length) parts.push(child.substring(lastIdx))
      result.push(parts.length > 1 ? parts : (parts.length === 1 ? parts[0] : child))
    } else {
      result.push(child)
    }
  }
  return result.length === 1 ? result[0] : result
}


interface MessageBubbleProps {
  message: Message
  onCopy?: (text: string) => void
}

export const MessageBubble = memo(function MessageBubble({ message, onCopy, searchQuery, msgIndex, activeMatchMsgIdx, activeMatchOccurrence, isDateMatch }: MessageBubbleProps) {
  if (message.role === 'user') return <UserMessage message={message} onCopy={onCopy} searchQuery={searchQuery} activeOcc={msgIndex === activeMatchMsgIdx ? activeMatchOccurrence : -1} isDateMatch={isDateMatch} />
  if (message.role === 'system') return <SystemMessage message={message} />
  return <AssistantMessage message={message} onCopy={onCopy} searchQuery={searchQuery} activeOcc={msgIndex === activeMatchMsgIdx ? activeMatchOccurrence : -1} isDateMatch={isDateMatch} />
})

// ── System message (Long Horizon) ──
// Bubble speciale: colore UI, delimitata, etichettata "System message".
// È un messaggio di sistema hardcoded che entra nel contesto della conversazione.
function SystemMessage({ message }: { message: Message }) {
  const text = typeof message.content === 'string' ? message.content : ''
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
      <div style={{ maxWidth: 'min(560px, 100%)', width: '100%', borderRadius: 'var(--radius-lg)', border: '1px solid var(--q-accent-longhorizon)', backgroundColor: 'color-mix(in srgb, var(--q-accent-longhorizon) 8%, var(--q-bg-panel))', padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--q-accent-longhorizon)', fontFamily: 'var(--font-interface)' }}>System message</span>
          <span style={{ flex: 1, height: 1, backgroundColor: 'var(--q-border)' }} />
        </div>
        <div style={{ color: 'var(--q-text-secondary)', fontSize: 13, lineHeight: 1.6, fontFamily: 'var(--font-interface)', whiteSpace: 'pre-wrap' }}>{text}</div>
      </div>
    </div>
  )
}

// ── User message ──
function UserMessage({ message, onCopy, searchQuery, activeOcc, isDateMatch }: { message: Message; onCopy?: (t: string) => void; searchQuery?: string; activeOcc?: number; isDateMatch?: boolean }) {
  // Simple highlight: split text and wrap Nth occurrence
  const content = message.content || ''
  let rendered: React.ReactNode = content
  if (searchQuery && searchQuery.trim() && (activeOcc ?? -1) >= 0) {
    const q = searchQuery.trim()
    const lower = content.toLowerCase()
    const lowerQ = q.toLowerCase()
    const parts: React.ReactNode[] = []
    let idx = lower.indexOf(lowerQ)
    let lastIdx = 0
    let occNum = 0
    let key = 0
    while (idx !== -1) {
      if (idx > lastIdx) parts.push(content.substring(lastIdx, idx))
      if (occNum === activeOcc) {
        parts.push(React.createElement('mark', { key: 'hl' + key++, style: { backgroundColor: 'var(--q-search-highlight-bg)', color: 'var(--q-search-highlight-text)', borderRadius: '2px', padding: '0 2px' } }, content.substring(idx, idx + q.length)))
      } else {
        parts.push(content.substring(idx, idx + q.length))
      }
      occNum++
      lastIdx = idx + q.length
      idx = lower.indexOf(lowerQ, lastIdx)
    }
    if (lastIdx < content.length) parts.push(content.substring(lastIdx))
    if (parts.length > 0) rendered = parts
  }
  return (
    <div className="user-message-content" style={{ width: '100%', padding: '10px 16px', backgroundColor: 'var(--q-bubble-user)', borderRadius: '12px', boxShadow: isDateMatch ? 'none' : '0 0 0 1px var(--q-border), inset 0 1px 0 rgba(255,255,255,0.02)', border: isDateMatch ? '2px solid var(--q-search-highlight-bg)' : 'none', animation: 'msgSent 300ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
      {(message as any).taskClips && (message as any).taskClips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {(message as any).taskClips.map((tc: any, i: number) => (
            <div key={`tc-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px 3px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid var(--q-border)', fontSize: '12px', fontFamily: 'var(--font-interface)', color: 'var(--q-text-secondary)' }}>
              <span style={{ color: 'var(--q-text)', fontWeight: 500 }}>Task: {tc.label}</span>
            </div>
          ))}
        </div>
      )}
      {(message as any).skillNames && (message as any).skillNames.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {(message as any).skillNames.map((s: any, i: number) => (
            <div key={`sk-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px 3px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid var(--q-border)', fontSize: '12px', fontFamily: 'var(--font-interface)', color: 'var(--q-text-secondary)' }}>
              <span style={{ color: 'var(--q-text)', fontWeight: 500 }}>{s.skillName}</span>
              {s.agentName && <span style={{ color: 'var(--q-text-tertiary)', fontSize: '11px' }}>→ {s.agentName}</span>}
            </div>
          ))}
        </div>
      )}
      {(message as any).attachments && (message as any).attachments.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {(message as any).attachments.map((a: any, i: number) => (
            <div key={`att-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px 3px 10px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid var(--q-border)', fontSize: '12px', fontFamily: 'var(--font-interface)', color: 'var(--q-text-secondary)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--q-tab-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span style={{ color: 'var(--q-text)', fontWeight: 500 }}>{a.originalName}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ color: 'var(--q-bubble-user-text)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)', fontWeight: 500, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text' }}>
        {rendered}
      </div>
      <Footer content={message.content || ""} timestamp={message.timestamp} onCopy={onCopy} />
    </div>
  )
}


// ── Normalizza thinking: stringa (streaming) O array di blocchi (history) → sempre array ──
function normalizeThinking(t: any): { content: string }[] | undefined {
  if (!t) return undefined
  if (Array.isArray(t)) return t.map(x => ({ content: String(x?.content ?? x ?? '') }))
  return [{ content: String(t) }]
}

// ── SHARED: MessageBlocks — renders thinking, tool calls, tool results, compaction, delegation, text
// Used by BOTH AssistantMessage and DelegationBlockView
// If a new block type is added here, it automatically works in both chat and delegation
function MessageBlocks({ thinking, toolCalls, toolResults, compaction, delegations, content, isError, timestamp, searchQuery, activeOcc }: {
  thinking?: ThinkingBlock[]
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  compaction?: CompactionInfo[]
  delegations?: DelegationBlock[]
  content: string
  isError?: boolean
  timestamp: string
  searchQuery?: string
  activeOcc?: number
}) {
  return (
    <>
      {/* Thinking */}
      {normalizeThinking(thinking)?.map((t, i) => <ThinkingToggle key={`t-${i}`} content={t.content || ""} />)}

      {/* Tool calls */}
      {toolCalls?.map((tc, i) => <ToolToggle key={`tc-${i}`} label="Tool call" toolName={tc.name} body={tc.input} isError={false} />)}

      {/* Tool results (error + success) */}
      {toolResults?.map((tr, i) => <ToolToggle key={`tr-${i}`} label={tr.isError ? 'Tool error' : 'Tool result'} toolName={tr.name} body={tr.output} isError={tr.isError} />)}

      {/* Text content with markdown + code blocks */}
      <MarkdownContent text={content} isError={isError} searchQuery={searchQuery} activeOcc={activeOcc} />

      {/* Compaction toggles (blue + orange, in order) */}
      {compaction?.map((comp, i) => (
        <CompactionToggle key={`comp-${i}`} content={comp.content || ""} isNoop={comp.isNoop} />
      ))}

      {/* Delegation */}
      {delegations?.map((d, i) => <DelegationBlockView key={`d-${i}`} delegation={d} timestamp={timestamp} searchQuery={searchQuery} activeOcc={activeOcc} />)}
    </>
  )
}

// ── Renderer blocchi condiviso: usato da chat + delegation (future-proof — nuovi tipi funzionano in entrambe) ──
function renderBlocks(blocks: any[], opts: { isError?: boolean; isStreaming?: boolean; timestamp: string; agentName?: string; agentModel?: string; thinkingLevel?: string; onCopy?: (t: string) => void; searchQuery?: string; activeOcc?: number }) {
  const { isError, isStreaming, timestamp, agentName, agentModel, thinkingLevel, onCopy, searchQuery, activeOcc } = opts
  return blocks.map((b: any, i: number, arr: any[]) => {
    if (b.type === 'thinking') return <ThinkingToggle key={`b-${i}`} content={b.content || ""} streaming={isStreaming && i === arr.length - 1} />
    if (b.type === 'tool_call') return <ToolToggle key={`b-${i}`} label="Tool call" toolName={b.name} body={b.input || ''} isError={false} />
    if (b.type === 'tool_result') return <ToolToggle key={`b-${i}`} label={b.isError ? 'Tool error' : 'Tool result'} toolName={b.name} body={b.output || ''} isError={b.isError} />
    if (b.type === 'delegation') return <DelegationBlockView key={`b-${i}`} delegation={b} timestamp={timestamp} streaming={b.streaming} onCopy={onCopy} searchQuery={searchQuery} activeOcc={activeOcc} />
    if (b.type === 'text') {
      const isLastBlock = i === arr.length - 1
      const nextIsText = !isLastBlock && arr[i + 1]?.type === 'text'
      const showFooter = !nextIsText && (!isLastBlock || !isStreaming)
      return (
        <div key={`b-${i}`}>
          <div style={{ padding: '4px 0' }}>
            {/* isError NON viene passato: solo l'errorContent dedicato deve essere rosso.
                Il contenuto accumulato (text block) di un messaggio in errore resta colore normale.
                Prima, l'intero contenuto del messaggio diventava rosso (temporaneo) quando un errore
                interrompeva lo streaming. */}
            <MarkdownContent text={b.content || ''} isError={false} searchQuery={searchQuery} activeOcc={activeOcc} />
          </div>
          {showFooter && (
            <Footer
              content={b.content || ''}
              timestamp={timestamp}
              agentName={agentName}
              agentModel={agentModel}
              thinkingLevel={thinkingLevel}
              onCopy={onCopy}
            />
          )}
        </div>
      )
    }
    return null
  })
}

// ── Assistant message ──
function AssistantMessage({ message, onCopy, searchQuery, activeOcc, isDateMatch }: { message: Message; onCopy?: (t: string) => void; searchQuery?: string; activeOcc?: number; isDateMatch?: boolean }) {
  const isError = message.isError

  return (
    <div className="assistant-content" style={{ maxWidth: 'var(--spacing-chat-max)', minWidth: 0, animation: 'materialize 400ms cubic-bezier(0.16, 1, 0.3, 1)', userSelect: 'text', WebkitUserSelect: 'text', border: isDateMatch ? '2px solid var(--q-search-highlight-bg)' : 'none', borderRadius: isDateMatch ? 'var(--radius-md)' : '0', padding: isDateMatch ? '8px' : '0' }}>
      {/* Blocchi cronologici: toggles + testo nell'ORDINE reale. Footer dopo OGNI turno testo completato */}
      {(message as any).blocks?.length > 0
        ? renderBlocks((message as any).blocks, { isError, isStreaming: !!message.isStreaming, timestamp: message.timestamp, agentName: message.agentName, agentModel: message.agentModel, thinkingLevel: message.thinkingLevel, onCopy, searchQuery, activeOcc })
        : <>
            {normalizeThinking(message.thinking)?.map((t, i) => <ThinkingToggle key={`t-${i}`} content={t.content || ""} streaming={message.isStreaming} />)}
            {message.toolCalls?.map((tc, i) => <ToolToggle key={`tc-${i}`} label="Tool call" toolName={tc.name} body={tc.input} isError={false} />)}
            {message.toolResults?.map((tr, i) => <ToolToggle key={`tr-${i}`} label={tr.isError ? 'Tool error' : 'Tool result'} toolName={tr.name} body={tr.output} isError={tr.isError} />)}
          </>}

      {/* Error message — same as normal text but in red, no border/box */}
      {message.isError && message.errorContent && !message.isStreaming && (
        <div>
          <div style={{ padding: '4px 0' }}>
            <div style={{ color: 'var(--q-accent-danger)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)', fontWeight: 500, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {message.errorContent}
            </div>
          </div>
          <Footer
            content={message.errorContent}
            timestamp={message.timestamp}
            agentName={message.agentName}
            agentModel={message.agentModel}
            thinkingLevel={message.thinkingLevel}
            onCopy={onCopy}
          />
        </div>
      )}

      {/* Text legacy (senza blocks). Con blocks, il testo è dentro i blocchi. Footer SOLO a fine */}
      {!(message as any).blocks?.length && message.content && !message.isError && (
        <div>
          <div style={{ padding: '4px 0' }}>
            <MarkdownContent text={message.content} isError={isError} searchQuery={searchQuery} activeOcc={activeOcc} />
          </div>
          {!message.isStreaming && (
            <Footer
              content={message.content}
              timestamp={message.timestamp}
              agentName={message.agentName}
              agentModel={message.agentModel}
              thinkingLevel={message.thinkingLevel}
              onCopy={onCopy}
            />
          )}
        </div>
      )}

      {/* Compaction + delegation — AFTER blocks, NO footer */}
      {message.compaction?.map((comp, i) => (
        <CompactionToggle key={`comp-${i}`} content={comp.content || ""} isNoop={comp.isNoop} />
      ))}
      {message.delegations?.map((d, i) => <DelegationBlockView key={`d-${i}`} delegation={d} timestamp={message.timestamp} onCopy={onCopy} searchQuery={searchQuery} activeOcc={activeOcc} />)}
    </div>
  )
}

// ── Markdown content with code blocks (copy + syntax highlighting) ──
function MarkdownContent({ text, isError, searchQuery, activeOcc }: { text: string; isError?: boolean; searchQuery?: string; activeOcc?: number }) {
  const occRef = useRef(0)
  occRef.current = 0
  const isHighlighting = searchQuery && searchQuery.trim() && (activeOcc ?? -1) >= 0
  const hl = isHighlighting ? (children: React.ReactNode) => highlightChildren(children, searchQuery || '', activeOcc ?? -1, occRef) : (children: React.ReactNode) => children
  return (
    <div className="markdown-content" style={{ padding: '4px 0', userSelect: 'text', WebkitUserSelect: 'text' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // Code block (triple backtick)
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          // Inline code
          code: ({ children, className }) => {
            // If has className (inside pre/code block), render the code text with highlight
            if (className) {
              return <code className={className} style={{ fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: 1.6 }}>{children}</code>
            }
            // Inline code
            return <code style={{ backgroundColor: 'var(--q-bg-code)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-code)', fontSize: '13px', color: 'var(--q-text)' }}>{children}</code>
          },
          p: ({ children }) => <p style={{ color: isError ? 'var(--q-accent-danger)' : 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)', fontWeight: 500, margin: '0 0 12px 0' }}>{hl(children)}</p>,
          ul: ({ children }) => <ul style={{ color: 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, margin: '0 0 12px 0', paddingLeft: '22px', listStyle: 'disc outside' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ color: 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, margin: '0 0 12px 0', paddingLeft: '26px' }}>{children}</ol>,
          li: ({ children }) => <li style={{ marginBottom: '4px', color: 'var(--q-text)' }}>{hl(children)}</li>,
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '0 0 12px 0' }}>
              <table style={{ width: 'auto', borderCollapse: 'collapse', fontSize: '13px', fontFamily: 'var(--font-interface)', border: '1px solid var(--q-border)' }}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th style={{ color: 'var(--q-text)', fontWeight: 700, textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--q-border-strong)', boxShadow: 'inset -1px 0 0 var(--q-border)' }}>{children}</th>,
          td: ({ children }) => <td style={{ color: 'var(--q-text)', padding: '8px 12px', borderBottom: '1px solid var(--q-border)', boxShadow: 'inset -1px 0 0 var(--q-border)' }}>{children}</td>,
          strong: ({ children }) => <strong style={{ color: 'var(--q-text)', fontWeight: 700 }}>{hl(children)}</strong>,
          a: ({ children, href }) => <a href={href} style={{ color: 'var(--q-accent-info-bright)', textDecoration: 'none' }} target="_blank" rel="noreferrer">{hl(children)}</a>,
          h1: ({ children }) => <h1 style={{ color: 'var(--q-text)', fontSize: '18px', fontWeight: 700, margin: '8px 0 4px' }}>{hl(children)}</h1>,
          h2: ({ children }) => <h2 style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 700, margin: '8px 0 4px' }}>{hl(children)}</h2>,
          h3: ({ children }) => <h3 style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, margin: '6px 0 4px' }}>{hl(children)}</h3>,
          blockquote: ({ children }) => <blockquote style={{ borderLeft: '2px solid var(--q-border)', paddingLeft: '12px', margin: '4px 0', color: 'var(--q-text-secondary)' }}>{children}</blockquote>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// ── Code block with copy button + syntax highlighting ──
function CodeBlock({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  const [btnHovered, setBtnHovered] = useState(false)
  const handleCopy = () => {
    const text = extractText(children)
    try { navigator.clipboard.writeText(text) } catch {}
  }

  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', backgroundColor: 'var(--q-bg-code)', borderRadius: 'var(--radius-md)', margin: '8px 0', overflow: 'hidden' }}>
      {/* Copy button top right — visibile SOLO all'hover del code block, brighten su hover bottone */}
      <button
        onClick={handleCopy}
        title="Copy"
        onMouseEnter={() => setBtnHovered(true)}
        onMouseLeave={() => setBtnHovered(false)}
        style={{
          position: 'absolute', top: '6px', right: '6px', zIndex: 1,
          background: 'none', border: 'none', cursor: 'pointer',
          color: btnHovered ? 'var(--q-text)' : 'var(--q-text-tertiary)', padding: '4px',
          display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-sm)',
          opacity: hovered ? 1 : 0,
        }}>
        <Copy size={14} />
      </button>
      {/* Code content */}
      <pre style={{ padding: '12px', overflow: 'auto', margin: 0, backgroundColor: 'transparent !important' }}>
        <code style={{ fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: 1.6, backgroundColor: 'transparent !important' }}>
          {children}
        </code>
      </pre>
    </div>
  )
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props?.children)
  }
  return ''
}

// ── Generic toggle (thinking, tool, compaction — all same structure) ──
function GenericToggle({ label, content, baseColor, baseColorRgb, isItalic, boldLabel, streaming }: {
  label: string; content: string; baseColor: string; baseColorRgb: string; isItalic?: boolean; boldLabel?: string; streaming?: boolean
}) {
  const [collapsed, setCollapsed] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [copyHovered, setCopyHovered] = useState(false)

  // Streaming: toggle aperto mentre genera, si chiude automaticamente alla fine
  useEffect(() => {
    if (streaming === true) setCollapsed(false)
    else if (streaming === false) setCollapsed(true)
  }, [streaming])

  const color = collapsed ? (hovered ? `rgba(${baseColorRgb}, 0.70)` : `rgba(${baseColorRgb}, 0.50)`) : baseColor
  const bg = hovered ? `rgba(${baseColorRgb}, 0.04)` : 'transparent'
  const preview = collapsed ? content.split('\n')[0]?.substring(0, 80) : null

  return (
    <div style={{ marginTop: '12px', padding: '4px' }}>
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer', backgroundColor: bg, borderRadius: 'var(--radius-md)', padding: '8px', transform: hovered ? 'translateX(2px)' : 'translateX(0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ChevronRight size={14} style={{ color, flexShrink: 0, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'none' }} />
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color }}>{label}{boldLabel && <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', fontWeight: 600, color }}>{' '}{boldLabel}</span>}</span>
          {preview && <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color: 'var(--q-text-tertiary)', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{preview}</span>}
          {!preview && <span style={{ flex: 1 }} />}
          <button onClick={(e) => { e.stopPropagation(); try { navigator.clipboard.writeText(content) } catch {} }}
            onMouseEnter={() => setCopyHovered(true)} onMouseLeave={() => setCopyHovered(false)}
            style={{ opacity: hovered ? 1 : 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 'var(--radius-sm)', color: copyHovered ? color : `rgba(${baseColorRgb}, 0.60)` }}>
            <Copy size={14} />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="toggle-content" style={{ marginTop: '4px', padding: '8px 8px 8px 16px', borderLeft: `2px solid ${baseColor}`, fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: 1.6, color: baseColor, fontStyle: isItalic ? 'italic' : 'normal', borderRadius: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'text', WebkitUserSelect: 'text', animation: 'materialize 300ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {content}
        </div>
      )}
    </div>
  )
}

function ThinkingToggle({ content, streaming }: { content: string; streaming?: boolean }) {
  return <GenericToggle label="Thinking" content={content} baseColor="var(--q-thinking)" baseColorRgb="157, 139, 217" isItalic streaming={streaming} />
}

function ToolToggle({ label, toolName, body, isError }: { label: string; toolName: string; body: string; isError: boolean }) {
  const baseColor = isError ? 'var(--q-accent-danger)' : label === 'Tool call' ? 'var(--q-tool-call)' : 'var(--q-tool-result)'
  const baseColorRgb = isError ? '217, 107, 107' : label === 'Tool call' ? '210, 153, 34' : '107, 196, 109'
  return <GenericToggle label={label} boldLabel={toolName} content={body} baseColor={baseColor} baseColorRgb={baseColorRgb} />
}

function CompactionToggle({ content, isNoop }: { content: string; isNoop: boolean }) {
  const baseColor = isNoop ? 'var(--q-accent-orange)' : 'var(--q-accent-info)'
  const baseColorRgb = isNoop ? '217, 160, 102' : '122, 162, 247'
  return <GenericToggle label='Compaction' boldLabel={isNoop ? 'ineffective' : 'effective'} content={content} baseColor={baseColor} baseColorRgb={baseColorRgb} />
}

// ── Delegation block (full chat structure inside) ──
function DelegationBlockView({ delegation, timestamp, streaming, onCopy, searchQuery, activeOcc }: { delegation: any; timestamp: string; streaming?: boolean; onCopy?: (t: string) => void; searchQuery?: string; activeOcc?: number }) {
  const [collapsed, setCollapsed] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [copyHovered, setCopyHovered] = useState(false)
  useEffect(() => { if (streaming === true) setCollapsed(false); else if (streaming === false) setCollapsed(true) }, [streaming])

  const baseColor = 'var(--q-delegation)'
  const baseColorRgb = '201, 112, 132'
  const color = collapsed ? (hovered ? `rgba(${baseColorRgb}, 0.70)` : `rgba(${baseColorRgb}, 0.50)`) : baseColor
  const bg = hovered ? `rgba(${baseColorRgb}, 0.04)` : 'transparent'
  const previewText = delegation.response || (delegation.blocks || []).filter((b: any) => b.type === 'text').map((b: any) => b.content || '').join(' ') || ''
  const preview = collapsed ? previewText.split('\n')[0]?.substring(0, 80) : null

  return (
    <div style={{ marginTop: '12px', padding: '4px' }}>
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer', backgroundColor: bg, borderRadius: 'var(--radius-md)', padding: '8px', transform: hovered ? 'translateX(2px)' : 'translateX(0)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ChevronRight size={14} style={{ color, flexShrink: 0, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'none' }} />
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color }}>Delegated to</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', fontWeight: 600, color }}>{delegation.agentName}</span>
          {preview && <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color: 'var(--q-text-tertiary)', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{preview}</span>}
          {!preview && <span style={{ flex: 1 }} />}
          <button onClick={(e) => { e.stopPropagation(); try {
            // Copia TUTTO il contenuto: task + response + blocchi nested
            let fullText = (delegation.taskContent || '') + '\n'
            if (delegation.blocks?.length) {
              for (const b of delegation.blocks) {
                if (b.type === 'thinking') fullText += '\n[Thinking]\n' + (b.content || '')
                else if (b.type === 'tool_call') fullText += '\n[Tool call: ' + (b.name || '') + ']\n' + (b.input || '')
                else if (b.type === 'tool_result') fullText += '\n[Tool result: ' + (b.name || '') + ']\n' + (b.output || '')
                else if (b.type === 'text') fullText += '\n' + (b.content || '')
              }
            }
            if (delegation.response) fullText += '\n' + delegation.response
            navigator.clipboard.writeText(fullText)
          } catch {} }}
            onMouseEnter={() => setCopyHovered(true)} onMouseLeave={() => setCopyHovered(false)}
            style={{ opacity: hovered ? 1 : 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 'var(--radius-sm)', color: copyHovered ? color : `rgba(${baseColorRgb}, 0.60)` }}>
            <Copy size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="toggle-content" style={{ marginTop: '4px', padding: '8px 8px 8px 16px', borderLeft: `2px solid ${baseColor}`, userSelect: 'text', WebkitUserSelect: 'text', animation: 'materialize 300ms cubic-bezier(0.16, 1, 0.3, 1)' }}>
          {/* User message (task) */}
          <div style={{ width: '100%', marginBottom: '8px', padding: '10px 16px', backgroundColor: 'var(--q-bubble-user)', borderRadius: '12px', boxShadow: '0 0 0 1px var(--q-border), inset 0 1px 0 rgba(255,255,255,0.02)', border: 'none' }}>
            <div style={{ color: 'var(--q-bubble-user-text)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)' }}>{delegation.taskContent}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <button onClick={() => { try { navigator.clipboard.writeText(delegation.taskContent || '') } catch {} }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--q-text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--q-text-tertiary)' }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', display: 'flex', color: 'var(--q-text-tertiary)' }}>
                <Copy size={16} />
              </button>
              <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px' }}>{fmtTime(timestamp)}</span>
            </div>
          </div>

          {/* Blocchi nested della delega in ORDINE reale (thinking/tool/testo — stesso renderer della chat) */}
          {delegation.blocks?.length > 0
            ? renderBlocks(delegation.blocks, { isStreaming: !!streaming, timestamp, agentName: delegation.agentName, agentModel: delegation.agentModel, thinkingLevel: delegation.thinkingLevel, onCopy, searchQuery, activeOcc })
            : delegation.response && (
              <div style={{ padding: '4px 0' }}>
                <MarkdownContent text={delegation.response} searchQuery={searchQuery} activeOcc={activeOcc} />
              </div>
            )}

          {/* Footer delega: SOLO se non ci sono blocks (con blocks, il footer è dentro renderBlocks) */}
          {(!delegation.blocks || delegation.blocks.length === 0) && delegation.response && (
            <Footer
              content={delegation.response}
              timestamp={timestamp}
              agentName={delegation.agentName}
              agentModel={delegation.agentModel}
              thinkingLevel={delegation.thinkingLevel}
            />
          )}
        </div>
      )}
    </div>
  )
}


// ── SHARED Footer — used by user, assistant, AND delegation ──
function Footer({ content, timestamp, agentName, agentModel, thinkingLevel, onCopy }: {
  content: string; timestamp: string; agentName?: string; agentModel?: string; thinkingLevel?: string; onCopy?: (t: string) => void
}) {
  const [infoOpen, setInfoOpen] = useState(false)

  const infoParts: string[] = []
  if (agentName) infoParts.push(agentName)
  if (agentModel) infoParts.push(agentModel)
  if (thinkingLevel && thinkingLevel !== 'off') infoParts.push(`On (${thinkingLevel})`)
  else if (thinkingLevel === 'off') infoParts.push('Off')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', lineHeight: '1' }}>
      <button
        onClick={() => { try { navigator.clipboard.writeText(content) } catch {}; onCopy?.(content) }}
        title="Copy"
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--q-text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--q-text-tertiary)' }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', lineHeight: '1', color: 'var(--q-text-tertiary)', borderRadius: '6px' }}
      >
        <Copy size={16} />
      </button>
      <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: '16px', display: 'flex', alignItems: 'center' }}>
        {fmtTime(timestamp)}
      </span>
      {(agentName || agentModel || thinkingLevel) && (
        <button
          onClick={() => setInfoOpen(!infoOpen)}
          title="Info"
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--q-text)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--q-text-tertiary)' }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', lineHeight: '1', color: 'var(--q-text-tertiary)', borderRadius: '6px' }}
        >
          <Info size={16} />
        </button>
      )}
      {infoOpen && infoParts.length > 0 && (
        <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: '16px', display: 'flex', alignItems: 'center' }}>
          {infoParts.join(' · ')}
        </span>
      )}
    </div>
  )
}

// CopyBtn removed — unused

function fmtTime(timestamp: string): string {
  const d = new Date(timestamp)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return date + ', ' + time
}