// ============================================================
// MessageBubble — with markdown + syntax highlighting
// Order: thinking → tool calls → tool results → text(markdown) → compaction → delegation
// ============================================================

import { useState, memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import type { Message, DelegationBlock, ThinkingBlock, ToolCall, ToolResult, CompactionInfo } from '../../types'
import { Copy, Check, Info } from '../icons'

interface MessageBubbleProps {
  message: Message
  onCopy?: (text: string) => void
}

export const MessageBubble = memo(function MessageBubble({ message, onCopy }: MessageBubbleProps) {
  if (message.role === 'user') return <UserMessage message={message} onCopy={onCopy} />
  return <AssistantMessage message={message} onCopy={onCopy} />
})

// ── User message ──
function UserMessage({ message, onCopy }: { message: Message; onCopy?: (t: string) => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div style={{ width: '100%', padding: '8px 16px', backgroundColor: 'var(--q-bubble-user)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
      <div style={{ color: 'var(--q-bubble-user-text)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)', fontWeight: 500, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {message.content}
      </div>
      <Footer content={message.content} timestamp={message.timestamp} onCopy={onCopy} />
    </div>
  )
}

// ── SHARED: MessageBlocks — renders thinking, tool calls, tool results, compaction, delegation, text
// Used by BOTH AssistantMessage and DelegationBlockView
// If a new block type is added here, it automatically works in both chat and delegation
function MessageBlocks({ thinking, toolCalls, toolResults, compaction, delegations, content, isError, timestamp }: {
  thinking?: ThinkingBlock[]
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  compaction?: CompactionInfo[]
  delegations?: DelegationBlock[]
  content: string
  isError?: boolean
  timestamp: string
}) {
  return (
    <>
      {/* Thinking */}
      {thinking?.map((t, i) => <ThinkingToggle key={`t-${i}`} content={t.content} />)}

      {/* Tool calls */}
      {toolCalls?.map((tc, i) => <ToolToggle key={`tc-${i}`} label="Tool call" toolName={tc.name} body={tc.input} isError={false} />)}

      {/* Tool results (error + success) */}
      {toolResults?.map((tr, i) => <ToolToggle key={`tr-${i}`} label={tr.isError ? 'Tool error' : 'Tool result'} toolName={tr.name} body={tr.output} isError={tr.isError} />)}

      {/* Text content with markdown + code blocks */}
      <MarkdownContent text={content} isError={isError} />

      {/* Compaction toggles (blue + orange, in order) */}
      {compaction?.map((comp, i) => (
        <CompactionToggle key={`comp-${i}`} content={comp.content} isNoop={comp.isNoop} />
      ))}

      {/* Delegation */}
      {delegations?.map((d, i) => <DelegationBlockView key={`d-${i}`} delegation={d} timestamp={timestamp} />)}
    </>
  )
}

// ── Assistant message ──
function AssistantMessage({ message, onCopy }: { message: Message; onCopy?: (t: string) => void }) {
  const isError = message.isError

  return (
    <div style={{ maxWidth: 'var(--spacing-chat-max)', minWidth: 0 }}>
      {/* Thinking, tool calls, tool results — NO footer after these */}
      {message.thinking?.map((t, i) => <ThinkingToggle key={`t-${i}`} content={t.content} />)}
      {message.toolCalls?.map((tc, i) => <ToolToggle key={`tc-${i}`} label="Tool call" toolName={tc.name} body={tc.input} isError={false} />)}
      {message.toolResults?.map((tr, i) => <ToolToggle key={`tr-${i}`} label={tr.isError ? 'Tool error' : 'Tool result'} toolName={tr.name} body={tr.output} isError={tr.isError} />)}

      {/* Error message — same as normal text but in red, no border/box */}
      {message.isError && message.errorContent && (
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

      {/* Text content + footer TOGETHER — footer only after text, never after toggles */}
      {message.content && !message.isError && (
        <div>
          <div style={{ padding: '4px 0' }}>
            <MarkdownContent text={message.content} isError={isError} />

          </div>
          <Footer
            content={message.content}
            timestamp={message.timestamp}
            agentName={message.agentName}
            agentModel={message.agentModel}
            thinkingLevel={message.thinkingLevel}
            onCopy={onCopy}
          />
        </div>
      )}

      {/* Compaction + delegation — AFTER text+footer, NO footer */}
      {message.compaction?.map((comp, i) => (
        <CompactionToggle key={`comp-${i}`} content={comp.content} isNoop={comp.isNoop} />
      ))}
      {message.delegations?.map((d, i) => <DelegationBlockView key={`d-${i}`} delegation={d} timestamp={message.timestamp} />)}
    </div>
  )
}

// ── Markdown content with code blocks (copy + syntax highlighting) ──
function MarkdownContent({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <div style={{ padding: '4px 0' }}>
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
          p: ({ children }) => <p style={{ color: isError ? 'var(--q-accent-danger)' : 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)', fontWeight: 500, margin: '4px 0' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ color: 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, paddingLeft: '20px', margin: '4px 0', listStyle: 'none' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ color: 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, paddingLeft: '20px', margin: '4px 0' }}>{children}</ol>,
          li: ({ children, ...props }) => {
            const ordered = (props as any).node?.parent?.tagName === 'ol'
            return (
              <li style={{ marginBottom: '2px', position: 'relative', paddingLeft: '4px' }}>
                {!ordered && <span style={{ color: 'var(--q-accent-primary)', position: 'absolute', left: '-14px' }}>•</span>}
                {children}
              </li>
            )
          },
          strong: ({ children }) => <strong style={{ color: 'var(--q-text)', fontWeight: 700 }}>{children}</strong>,
          a: ({ children, href }) => <a href={href} style={{ color: 'var(--q-accent-info-bright)', textDecoration: 'none' }} target="_blank" rel="noreferrer">{children}</a>,
          h1: ({ children }) => <h1 style={{ color: 'var(--q-text)', fontSize: '18px', fontWeight: 700, margin: '8px 0 4px' }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 700, margin: '8px 0 4px' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, margin: '6px 0 4px' }}>{children}</h3>,
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
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    const text = extractText(children)
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{ position: 'relative', backgroundColor: 'var(--q-bg-code)', borderRadius: 'var(--radius-md)', margin: '8px 0', overflow: 'hidden' }}>
      {/* Copy button top right */}
      <button
        onClick={handleCopy}
        title="Copy"
        style={{
          position: 'absolute', top: '6px', right: '6px', zIndex: 1,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--q-text-tertiary)', padding: '4px',
          display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-sm)',
          opacity: 0.6, transition: 'opacity 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.6' }}
      >
        {copied ? <Check size={14} style={{ color: 'var(--q-accent-success)' }} /> : <Copy size={14} />}
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
function GenericToggle({ label, content, baseColor, baseColorRgb, isItalic, boldLabel }: {
  label: string; content: string; baseColor: string; baseColorRgb: string; isItalic?: boolean; boldLabel?: string
}) {
  const [collapsed, setCollapsed] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [copyHovered, setCopyHovered] = useState(false)
  const [copied, setCopied] = useState(false)

  const color = collapsed ? (hovered ? `rgba(${baseColorRgb}, 0.55)` : `rgba(${baseColorRgb}, 0.40)`) : baseColor
  const opacity = collapsed ? (hovered ? 0.95 : 0.85) : 1.0
  const bg = hovered ? `rgba(${baseColorRgb}, 0.06)` : 'transparent'
  const preview = collapsed ? content.split('\n')[0]?.substring(0, 80) : null

  return (
    <div style={{ opacity, transition: 'opacity 150ms ease', marginTop: '4px' }}>
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer', backgroundColor: bg, borderRadius: 'var(--radius-md)', padding: '8px', transition: 'background-color 150ms ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color, lineHeight: 1 }}>{collapsed ? '▶' : '▼'}</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color }}>{label}{boldLabel && <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', fontWeight: 600, color }}>{' '}{boldLabel}</span>}</span>
          {preview && <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color: 'var(--q-text-tertiary)', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{preview}</span>}
          {!preview && <span style={{ flex: 1 }} />}
          <button onClick={(e) => { e.stopPropagation(); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            onMouseEnter={() => setCopyHovered(true)} onMouseLeave={() => setCopyHovered(false)}
            style={{ opacity: hovered ? 1 : 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 'var(--radius-sm)', backgroundColor: copyHovered ? 'rgba(255,255,255,0.06)' : 'transparent', color, transition: 'opacity 150ms ease' }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ marginTop: '4px', padding: '8px 8px 8px 16px', fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: 1.6, color: baseColor, fontStyle: isItalic ? 'italic' : 'normal', borderLeft: `2px solid ${baseColor}`, borderRadius: '0 var(--radius-sm) var(--radius-sm) 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {content}
        </div>
      )}
    </div>
  )
}

function ThinkingToggle({ content }: { content: string }) {
  return <GenericToggle label="Thinking" content={content} baseColor="var(--q-thinking)" baseColorRgb="168, 136, 192" isItalic />
}

function ToolToggle({ label, toolName, body, isError }: { label: string; toolName: string; body: string; isError: boolean }) {
  const baseColor = isError ? 'var(--q-accent-danger)' : label === 'Tool call' ? 'var(--q-tool-call)' : 'var(--q-tool-result)'
  const baseColorRgb = isError ? '217, 107, 107' : label === 'Tool call' ? '215, 190, 102' : '155, 191, 122'
  return <GenericToggle label={label} boldLabel={toolName} content={body} baseColor={baseColor} baseColorRgb={baseColorRgb} />
}

function CompactionToggle({ content, isNoop }: { content: string; isNoop: boolean }) {
  const baseColor = isNoop ? 'var(--q-accent-orange)' : 'var(--q-accent-info)'
  const baseColorRgb = isNoop ? '232, 151, 90' : '122, 138, 160'
  return <GenericToggle label='Compaction' boldLabel={isNoop ? 'ineffective' : 'effective'} content={content} baseColor={baseColor} baseColorRgb={baseColorRgb} />
}

// ── Delegation block (full chat structure inside) ──
function DelegationBlockView({ delegation, timestamp }: { delegation: DelegationBlock; timestamp: string }) {
  const [collapsed, setCollapsed] = useState(true)
    const [hovered, setHovered] = useState(false)
  const [copyHovered, setCopyHovered] = useState(false)
  const [copied, setCopied] = useState(false)

  const baseColor = 'var(--q-delegation)'
  const baseColorRgb = '196, 106, 126'
  const color = collapsed ? (hovered ? `rgba(${baseColorRgb}, 0.55)` : `rgba(${baseColorRgb}, 0.40)`) : baseColor
  const opacity = collapsed ? (hovered ? 0.95 : 0.85) : 1.0
  const bg = hovered ? `rgba(${baseColorRgb}, 0.06)` : 'transparent'
  const preview = collapsed ? delegation.response.split('\n')[0]?.substring(0, 80) : null

  return (
    <div style={{ opacity, transition: 'opacity 150ms ease', marginTop: '4px' }}>
      <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={() => setCollapsed(!collapsed)}
        style={{ cursor: 'pointer', backgroundColor: bg, borderRadius: 'var(--radius-md)', padding: '8px', transition: 'background-color 150ms ease' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '10px', color, lineHeight: 1 }}>{collapsed ? '▶' : '▼'}</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color }}>Delegated to</span>
          <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', fontWeight: 600, color }}>{delegation.agentName}</span>
          {preview && <span style={{ fontFamily: 'var(--font-code)', fontSize: '13px', color: 'var(--q-text-tertiary)', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{preview}</span>}
          {!preview && <span style={{ flex: 1 }} />}
          <button onClick={(e) => { e.stopPropagation(); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            onMouseEnter={() => setCopyHovered(true)} onMouseLeave={() => setCopyHovered(false)}
            style={{ opacity: hovered ? 1 : 0, background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: 'var(--radius-sm)', backgroundColor: copyHovered ? 'rgba(255,255,255,0.06)' : 'transparent', color, transition: 'opacity 150ms ease' }}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ marginTop: '4px', padding: '8px 8px 8px 16px', borderLeft: `2px solid ${baseColor}` }}>
          {/* User message (task) */}
          <div style={{ width: '100%', marginBottom: '8px', padding: '8px 16px', backgroundColor: 'var(--q-bubble-user)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-floating)' }}>
            <div style={{ color: 'var(--q-bubble-user-text)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)' }}>{delegation.taskContent}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <Copy size={16} style={{ color: 'var(--q-text-tertiary)' }} />
              <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px' }}>{fmtTime(timestamp)}</span>
            </div>
          </div>

          {/* ALL blocks via shared MessageBlocks — same as chat */}
          <MessageBlocks
            thinking={delegation.thinking}
            toolCalls={delegation.toolCalls}
            toolResults={delegation.toolResults}
            compaction={delegation.compaction}
            delegations={delegation.delegations}
            content={delegation.response}
            timestamp={timestamp}
          />

          <Footer
            content={delegation.response}
            timestamp={timestamp}
            agentName={delegation.agentName}
            agentModel={delegation.agentModel}
            thinkingLevel={delegation.thinkingLevel}
          />
        </div>
      )}
    </div>
  )
}


// ── SHARED Footer — used by user, assistant, AND delegation ──
function Footer({ content, timestamp, agentName, agentModel, thinkingLevel, onCopy }: {
  content: string; timestamp: string; agentName?: string; agentModel?: string; thinkingLevel?: string; onCopy?: (t: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  const infoParts: string[] = []
  if (agentName) infoParts.push(agentName)
  if (agentModel) infoParts.push(agentModel)
  if (thinkingLevel && thinkingLevel !== 'off') infoParts.push(`On (${thinkingLevel})`)
  else if (thinkingLevel === 'off') infoParts.push('Off')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', lineHeight: '1' }}>
      <button
        onClick={() => { onCopy?.(content); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        title="Copy"
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.borderRadius = '4px' }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', lineHeight: '1', color: 'var(--q-text-tertiary)', borderRadius: '4px', transition: 'background-color 0.15s ease' }}
      >
        {copied ? <Check size={16} style={{ color: 'var(--q-accent-success)' }} /> : <Copy size={16} />}
      </button>
      <span style={{ color: 'var(--q-text-tertiary)', fontSize: '12px', fontFamily: 'var(--font-interface)', lineHeight: '16px', display: 'flex', alignItems: 'center' }}>
        {fmtTime(timestamp)}
      </span>
      {(agentName || agentModel || thinkingLevel) && (
        <button
          onClick={() => setInfoOpen(!infoOpen)}
          title="Info"
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--q-hover)'; e.currentTarget.style.borderRadius = '4px' }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', lineHeight: '1', color: 'var(--q-text-tertiary)', borderRadius: '4px', transition: 'background-color 0.15s ease' }}
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

// ── Old CopyBtn (kept for compat) — 16px icon, no padding, aligns with text ──
function CopyBtn({ text, copied, setCopied, onCopy }: { text: string; copied: boolean; setCopied: (v: boolean) => void; onCopy?: (t: string) => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button onClick={() => { onCopy?.(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }} title="Copy"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: hovered ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {copied ? <Check size={16} style={{ color: 'var(--q-accent-success)' }} /> : <Copy size={16} />}
    </button>
  )
}

function fmtTime(timestamp: string): string {
  const d = new Date(timestamp)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return date + ', ' + time
}