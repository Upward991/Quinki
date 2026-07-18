// ============================================================
// Quinki — Type Definitions
// Data models extracted from Flutter app (models/agent.dart, models/message.dart)
// ============================================================

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageStatus = 'idle' | 'streaming' | 'thinking' | 'tool_call' | 'tool_result' | 'delegation' | 'error' | 'compacting' | 'done'

export interface ToolCall {
  name: string
  input: string
}

export interface ToolResult {
  name: string
  output: string
  isError: boolean
}

export interface ThinkingBlock {
  level: string  // 'on' | 'xhigh' | etc.
  content: string
}

export interface DelegationBlock {
  agentName: string
  agentModel: string
  mode: string  // 'plan' | 'build'
  tools: string[]
  systemPrompt: string
  taskContent: string  // user message inside delegation
  thinking?: ThinkingBlock[]
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  response: string  // agent text response
  thinkingLevel?: string
  compaction?: CompactionInfo[]
  delegations?: DelegationBlock[]
}

export interface CompactionInfo {
  content: string
  isNoop: boolean
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  agentName?: string
  agentModel?: string
  timestamp: string  // ISO string
  thinking?: ThinkingBlock[]
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  delegations?: DelegationBlock[]
  compaction?: CompactionInfo[]
  isError?: boolean
  errorType?: 'api' | 'rate_limit' | 'context_overflow' | 'tool' | 'permission' | 'generic'
  errorContent?: string
  isStreaming?: boolean
  thinkingLevel?: string  // 'off' | 'on' | 'xhigh'
  tokensIn?: number
  tokensOut?: number
  isCompacted?: boolean
}

export type SessionType = 'chat' | 'folder'

export interface Session {
  id: string
  title: string
  type: SessionType
  parentId?: string  // for sessions inside folders
  lastMessage?: string
  updatedAt: string  // ISO string
  unread?: boolean
  agents?: string[]  // agent names
  isExpanded?: boolean  // for folders
  messageCount?: number
}

export interface SkillInfo {
  name: string
  source: string  // 'pi.dev' | 'github' | 'local'
  installed: boolean
}

export interface ToolInfo {
  name: string
  enabled: boolean
}

export interface Agent {
  id: string
  name: string
  systemPrompt: string
  model: string
  thinking: string  // 'off' | 'on' | 'xhigh'
  skills: SkillInfo[]
  tools: ToolInfo[]
  files: string[]  // attached file paths
  isDeletable: boolean
  color?: string  // optional accent color
}

export interface ProviderModel {
  id: string
  name: string
  contextWindow?: number
}

export interface Provider {
  id: string
  name: string
  type: string  // 'ollama' | 'openrouter' | 'anthropic' | etc.
  apiKeyStatus: 'configured' | 'missing' | 'invalid'
  models: ProviderModel[]
  enabled: boolean
}

export type ViewTab = 'chat' | 'home' | 'agents' | 'settings'
export type ChatMode = 'plan' | 'build'
export type ThinkingLevel = 'off' | 'on' | 'xhigh'

export interface ThemePreset {
  id: string
  name: string
  bg: string
  bgPanel: string
  bgBubbleUser: string
  text: string
}