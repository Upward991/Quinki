import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, ChevronRight, Copy, Info } from '../icons'
import type { Message } from '../../types'

interface MessageBubbleProps {
  message: Message
  onCopy?: (text: string) => void
}

export function MessageBubble({ message, onCopy }: MessageBubbleProps) {
  if (message.role === 'user') return <UserBubble message={message} onCopy={onCopy} />
  return <AssistantBubble message={message} onCopy={onCopy} />
}

// ── User bubble ──
function UserBubble({ message, onCopy }: MessageBubbleProps) {
  return (
    <div
      className="user-message-content w-full p-2.5 px-4 bg-bubble-user rounded-xl border-none q-msg-sent"
      style={{ boxShadow: '0 0 0 1px var(--q-border), inset 0 1px 0 rgba(255,255,255,0.02)' }}
    >
      <div
        className="text-bubble-user-text text-14 font-interface font-medium whitespace-pre-wrap break-words"
        style={{ lineHeight: 1.5, userSelect: 'text', WebkitUserSelect: 'text' }}
      >
        {message.content || ''}
      </div>
      <MessageFooter content={message.content || ''} timestamp={message.timestamp} onCopy={onCopy} />
    </div>
  )
}

// ── Assistant bubble ──
function AssistantBubble({ message, onCopy }: MessageBubbleProps) {
  return (
    <div
      className="assistant-content max-w-chat-max min-w-0 q-materialize"
      style={{ userSelect: 'text', WebkitUserSelect: 'text', animation: 'materialize 400ms cubic-bezier(0.16, 1, 0.3, 1)' }}
    >
      {message.thinking?.map((t: any, i: number) => (
        <ThinkingBlock key={`t-${i}`} content={t.content || ''} />
      ))}
      {message.toolCalls?.map((tc: any, i: number) => (
        <ToolBlock key={`tc-${i}`} label="Tool call" toolName={tc.name} body={tc.input || ''} isError={false} />
      ))}
      {message.toolResults?.map((tr: any, i: number) => (
        <ToolBlock key={`tr-${i}`} label={tr.isError ? 'Tool error' : 'Tool result'} toolName={tr.name} body={tr.output || ''} isError={tr.isError} />
      ))}
      {message.isError && message.errorContent && (
        <div>
          <div className="py-1">
            <div className="text-accent-danger text-14 font-interface font-medium whitespace-pre-wrap break-words" style={{ lineHeight: 1.5 }}>
              {message.errorContent}
            </div>
          </div>
          <MessageFooter content={message.errorContent || ''} timestamp={message.timestamp} agentName={message.agentName} agentModel={message.agentModel} thinkingLevel={message.thinkingLevel} onCopy={onCopy} />
        </div>
      )}
      {message.content && !message.isError && (
        <div>
          <div className="py-1">
            <MarkdownRenderer text={message.content || ''} isError={message.isError} />
          </div>
          <MessageFooter content={message.content || ''} timestamp={message.timestamp} agentName={message.agentName} agentModel={message.agentModel} thinkingLevel={message.thinkingLevel} onCopy={onCopy} />
        </div>
      )}
      {message.compaction?.map((c: any, i: number) => (
        <CompactionBlock key={`comp-${i}`} content={c.content || ''} isNoop={c.isNoop} />
      ))}
      {message.delegations?.map((d: any, i: number) => (
        <DelegationBlock key={`d-${i}`} delegation={d} timestamp={message.timestamp} />
      ))}
    </div>
  )
}

// ── Markdown renderer ──
function MarkdownRenderer({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <div className="markdown-content py-1" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
          code: ({ children, className }: any) => className ? (
            <code className={className} style={{ fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: 1.6 }}>{children}</code>
          ) : (
            <code style={{ backgroundColor: 'var(--q-bg-code)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-code)', fontSize: '13px', color: 'var(--q-text)' }}>{children}</code>
          ),
          p: ({ children }: any) => <p style={{ color: isError ? 'var(--q-accent-danger)' : 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, fontFamily: 'var(--font-interface)', fontWeight: 500, margin: '4px 0' }}>{children}</p>,
          ul: ({ children }: any) => <ul style={{ color: 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, paddingLeft: '20px', margin: '4px 0', listStyle: 'none' }}>{children}</ul>,
          ol: ({ children }: any) => <ol style={{ color: 'var(--q-text)', fontSize: '14px', lineHeight: 1.5, paddingLeft: '20px', margin: '4px 0' }}>{children}</ol>,
          li: ({ children, ...rest }: any) => (
            <li style={{ marginBottom: '2px', position: 'relative', paddingLeft: '4px' }}>
              {rest.node?.parent?.tagName !== 'ol' && <span style={{ color: 'var(--q-accent-info)', position: 'absolute', left: '-14px' }}>•</span>}
              {children}
            </li>
          ),
          strong: ({ children }: any) => <strong style={{ color: 'var(--q-text)', fontWeight: 700 }}>{children}</strong>,
          a: ({ children, href }: any) => <a href={href} style={{ color: 'var(--q-accent-info-bright)', textDecoration: 'none' }} target="_blank" rel="noreferrer">{children}</a>,
          h1: ({ children }: any) => <h1 style={{ color: 'var(--q-text)', fontSize: '18px', fontWeight: 700, margin: '8px 0 4px' }}>{children}</h1>,
          h2: ({ children }: any) => <h2 style={{ color: 'var(--q-text)', fontSize: '16px', fontWeight: 700, margin: '8px 0 4px' }}>{children}</h2>,
          h3: ({ children }: any) => <h3 style={{ color: 'var(--q-text)', fontSize: '15px', fontWeight: 600, margin: '6px 0 4px' }}>{children}</h3>,
          blockquote: ({ children }: any) => <blockquote style={{ borderLeft: '2px solid var(--q-border)', paddingLeft: '12px', margin: '4px 0', color: 'var(--q-text-secondary)' }}>{children}</blockquote>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

// ── Code block with copy ──
function CodeBlock({ children }: { children: any }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative bg-bg-code rounded-lg my-2 overflow-hidden border border-border">
      <button
        onClick={() => { navigator.clipboard.writeText(extractText(children)); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        title="Copy"
        className="absolute top-1.5 right-1.5 z-1 bg-none border-none cursor-pointer p-1 flex items-center rounded-sm"
        style={{ color: 'var(--q-text-tertiary)', opacity: 0.6, transition: 'opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6' }}
      >
        {copied ? <Check size={14} className="text-accent-success" /> : <Copy size={14} />}
      </button>
      <pre className="p-4 overflow-auto m-0" style={{ backgroundColor: 'transparent !important' }}>
        <code style={{ fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: 1.6, backgroundColor: 'transparent !important' }}>{children}</code>
      </pre>
    </div>
  )
}

function extractText(children: any): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (children && typeof children === 'object' && 'props' in children) return extractText(children.props?.children)
  return ''
}

// ── Collapsible toggle block (thinking, tool, compaction) ──
function ToggleBlock({ label, content, baseColor, baseColorRgb, isItalic, boldLabel }: {
  label: string; content: string; baseColor: string; baseColorRgb: string; isItalic?: boolean; boldLabel?: string
}) {
  const [expanded, setExpanded] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [copyHover, setCopyHover] = useState(false)
  const [copied, setCopied] = useState(false)
  const color = expanded ? (hovered ? `rgba(${baseColorRgb}, 0.70)` : `rgba(${baseColorRgb}, 0.50)`) : baseColor
  const bg = hovered ? `rgba(${baseColorRgb}, 0.04)` : 'transparent'
  const preview = expanded ? content.split('\n')[0]?.substring(0, 80) : null

  return (
    <div className="mt-1">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer rounded-md p-2"
        style={{ backgroundColor: bg, transform: hovered ? 'translateX(2px)' : 'translateX(0)', transition: 'background-color 120ms ease, transform 120ms ease' }}
      >
        <div className="flex items-center gap-2">
          <ChevronRight size={14} className="shrink-0" style={{ color, transform: expanded ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
          <span className="font-code text-13" style={{ color }}>
            {label}
            {boldLabel && <span className="font-code text-13 font-semibold" style={{ color }}> {boldLabel}</span>}
          </span>
          {preview ? (
            <span className="font-code text-13 flex-1 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: 'var(--q-text-tertiary)', opacity: 0.6 }}>{preview}</span>
          ) : (
            <span className="flex-1" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            onMouseEnter={() => setCopyHover(true)}
            onMouseLeave={() => setCopyHover(false)}
            className="bg-none border-none cursor-pointer p-1 rounded-sm"
            style={{ opacity: hovered ? 1 : 0, backgroundColor: copyHover ? 'var(--q-hover)' : 'transparent', color, transition: 'opacity 120ms ease' }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      {!expanded && (
        <div
          className="toggle-content mt-1 p-2 pl-4 font-code text-13 whitespace-pre-wrap break-words"
          style={{ borderLeft: `2px solid ${baseColor}`, lineHeight: 1.6, color: baseColor, fontStyle: isItalic ? 'italic' : 'normal', userSelect: 'text', WebkitUserSelect: 'text', animation: 'materialize 300ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {content}
        </div>
      )}
    </div>
  )
}

function ThinkingBlock({ content }: { content: string }) {
  return <ToggleBlock label="Thinking" content={content} baseColor="var(--q-thinking)" baseColorRgb="157, 139, 217" isItalic />
}

function ToolBlock({ label, toolName, body, isError }: { label: string; toolName: string; body: string; isError: boolean }) {
  return (
    <ToggleBlock
      label={label}
      boldLabel={toolName}
      content={body}
      baseColor={isError ? 'var(--q-accent-danger)' : label === 'Tool call' ? 'var(--q-tool-call)' : 'var(--q-tool-result)'}
      baseColorRgb={isError ? '217, 107, 107' : label === 'Tool call' ? '210, 153, 34' : '107, 196, 109'}
    />
  )
}

function CompactionBlock({ content, isNoop }: { content: string; isNoop: boolean }) {
  return (
    <ToggleBlock
      label="Compaction"
      boldLabel={isNoop ? 'ineffective' : 'effective'}
      content={content}
      baseColor={isNoop ? 'var(--q-accent-orange)' : 'var(--q-accent-info)'}
      baseColorRgb={isNoop ? '217, 160, 102' : '122, 162, 247'}
    />
  )
}

// ── Delegation block ──
function DelegationBlock({ delegation, timestamp }: { delegation: any; timestamp: string }) {
  const [expanded, setExpanded] = useState(true)
  const [hovered, setHovered] = useState(false)
  const [copyHover, setCopyHover] = useState(false)
  const [copied, setCopied] = useState(false)
  const baseColor = 'var(--q-delegation)'
  const rgb = '201, 112, 132'
  const color = expanded ? (hovered ? `rgba(${rgb}, 0.70)` : `rgba(${rgb}, 0.50)`) : baseColor
  const bg = hovered ? `rgba(${rgb}, 0.04)` : 'transparent'
  const preview = expanded ? delegation.response?.split('\n')[0]?.substring(0, 80) : null

  return (
    <div className="mt-1">
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer rounded-md p-2"
        style={{ backgroundColor: bg, transform: hovered ? 'translateX(2px)' : 'translateX(0)', transition: 'background-color 120ms ease, transform 120ms ease' }}
      >
        <div className="flex items-center gap-2">
          <ChevronRight size={14} className="shrink-0" style={{ color, transform: expanded ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
          <span className="font-code text-13" style={{ color }}>Delegated to</span>
          <span className="font-code text-13 font-semibold" style={{ color }}>{delegation.agentName}</span>
          {preview ? (
            <span className="font-code text-13 flex-1 overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: 'var(--q-text-tertiary)', opacity: 0.6 }}>{preview}</span>
          ) : (
            <span className="flex-1" />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(delegation.response || ''); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
            onMouseEnter={() => setCopyHover(true)}
            onMouseLeave={() => setCopyHover(false)}
            className="bg-none border-none cursor-pointer p-1 rounded-sm"
            style={{ opacity: hovered ? 1 : 0, backgroundColor: copyHover ? 'var(--q-hover)' : 'transparent', color, transition: 'opacity 120ms ease' }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>
      {!expanded && (
        <div
          className="toggle-content mt-1 p-2 pl-4"
          style={{ borderLeft: `2px solid ${baseColor}`, userSelect: 'text', WebkitUserSelect: 'text', animation: 'materialize 300ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {/* Task content (user message in delegation) */}
          <div
            className="w-full mb-2 p-2.5 px-4 bg-bubble-user rounded-xl border-none"
            style={{ boxShadow: '0 0 0 1px var(--q-border), inset 0 1px 0 rgba(255,255,255,0.02)' }}
          >
            <div className="text-bubble-user-text text-14 font-interface" style={{ lineHeight: 1.5 }}>{delegation.taskContent}</div>
            <div className="flex items-center gap-2 mt-1">
              <Copy size={16} className="text-text-tertiary" />
              <span className="text-text-tertiary text-12">{formatDate(timestamp)}</span>
            </div>
          </div>
          {/* Delegation response (assistant content) */}
          {delegation.thinking?.map((t: any, i: number) => <ThinkingBlock key={`dt-${i}`} content={t.content || ''} />)}
          {delegation.toolCalls?.map((tc: any, i: number) => <ToolBlock key={`dtc-${i}`} label="Tool call" toolName={tc.name} body={tc.input || ''} isError={false} />)}
          {delegation.toolResults?.map((tr: any, i: number) => <ToolBlock key={`dtr-${i}`} label={tr.isError ? 'Tool error' : 'Tool result'} toolName={tr.name} body={tr.output || ''} isError={tr.isError} />)}
          <div className="py-1"><MarkdownRenderer text={delegation.response || ''} /></div>
          <MessageFooter content={delegation.response || ''} timestamp={timestamp} agentName={delegation.agentName} agentModel={delegation.agentModel} thinkingLevel={delegation.thinkingLevel} />
          {delegation.delegations?.map((d: any, i: number) => <DelegationBlock key={`dd-${i}`} delegation={d} timestamp={timestamp} />)}
        </div>
      )}
    </div>
  )
}

// ── Message footer (copy, timestamp, info) ──
function MessageFooter({ content, timestamp, agentName, agentModel, thinkingLevel, onCopy }: {
  content: string; timestamp: string; agentName?: string; agentModel?: string; thinkingLevel?: string; onCopy?: (text: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const [copyHover, setCopyHover] = useState(false)
  const [infoHover, setInfoHover] = useState(false)
  const [showInfo, setShowInfo] = useState(false)

  const meta: string[] = []
  if (agentName) meta.push(agentName)
  if (agentModel) meta.push(agentModel)
  if (thinkingLevel && thinkingLevel !== 'off') meta.push(`On (${thinkingLevel})`)
  else if (thinkingLevel === 'off') meta.push('Off')

  return (
    <div className="flex items-center gap-2 py-1" style={{ lineHeight: '1' }}>
      <button
        onClick={() => { onCopy?.(content || ''); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        title="Copy"
        onMouseEnter={() => setCopyHover(true)}
        onMouseLeave={() => setCopyHover(false)}
        className="bg-none border-none cursor-pointer p-1 flex items-center rounded-sm"
        style={{ color: copyHover ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', transition: 'color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        {copied ? <Check size={16} className="text-accent-success" /> : <Copy size={16} />}
      </button>
      <span className="text-text-tertiary text-12 font-interface flex items-center" style={{ lineHeight: '16px' }}>
        {formatDate(timestamp)}
      </span>
      {(agentName || agentModel || thinkingLevel) && (
        <button
          onClick={() => setShowInfo(!showInfo)}
          title="Info"
          onMouseEnter={() => setInfoHover(true)}
          onMouseLeave={() => setInfoHover(false)}
          className="bg-none border-none cursor-pointer p-1 flex items-center rounded-sm"
          style={{ color: infoHover ? 'var(--q-text-secondary)' : 'var(--q-text-tertiary)', transition: 'color 120ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <Info size={16} />
        </button>
      )}
      {showInfo && meta.length > 0 && (
        <span className="text-text-tertiary text-12 font-interface flex items-center" style={{ lineHeight: '16px' }}>
          {meta.join(' · ')}
        </span>
      )}
    </div>
  )
}

function formatDate(ts: string): string {
  const d = new Date(ts)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return date + ', ' + time
}