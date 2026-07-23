// ============================================================
// Quinki — Mock Data
// ============================================================

import type { Message, Session, Agent, Provider, ThemePreset } from '../types'

const now = new Date()
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString()

// ──────────────────────────────────────────────────────────
// MESSAGES — same as Quinki Expert, with errors added
// ──────────────────────────────────────────────────────────
export const mockMessages: Message[] = [
  // 1. User message
  {
    id: '1',
    role: 'user',
    content: 'Can you check the files in the current directory and fix the error in main.ts?',
    timestamp: minsAgo(45),
    tokensIn: 18,
  },

  // 2. Assistant with ALL toggles — including errors
  {
    id: '2',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(44),
    isStreaming: false,
    thinking: [
      {
        level: 'xhigh',
        content: 'The user wants me to check the directory and fix an error in main.ts. Let me first list the files, then read main.ts to find the error.\n\nI should use the ls tool first to see what files exist, then read the file to identify the issue.',
      }
    ],
    toolCalls: [
      { name: 'ls', input: '.' },
    ],
    toolResults: [
      { name: 'ls', output: 'Error: Command failed — permission denied', isError: true },
      { name: 'read', output: 'main.ts (line 12):\nimport { init } from \'./init\'\n\ninit()  // Error: init is possibly undefined\n\n// Fix: add null check\nif (typeof init === \'function\') {\n  init()\n}', isError: false },
    ],
    compaction: [
      {
        content: 'Summary of conversation so far:\n- User asked to check files and fix error in main.ts\n- Attempted ls command but got permission denied error\n- Read main.ts and found the error: init() called without null check\n- Fix: add typeof check before calling init()\n\nKey context: working directory has permission restrictions.',
        isNoop: false,
      },
      {
        content: 'Compaction attempted but the conversation is too short to effectively summarize. The token savings would be minimal.\n\nCurrent tokens: 1,200 / 32,768 (3.7%)\nRecommended: continue without compaction until at least 50% context usage.',
        isNoop: true,
      },
    ],
    content: 'I found and fixed the error in main.ts. Here is the fix:\n\n```typescript\n// main.ts — fix\nimport { init } from \'./init\'\n\n// Fix: add null check before calling init\nif (typeof init === \'function\') {\n  init()\n}\n```\n\nThe error was caused by calling `init()` without checking if it exists. I\'ve added a null check to prevent the crash.',
    tokensIn: 18,
    tokensOut: 156,
  },

  // 3. Another user message
  {
    id: '3',
    role: 'user',
    content: 'Yes, delegate to Notion agent to create a documentation page with the fix details.',
    timestamp: minsAgo(40),
    tokensIn: 15,
  },

  // 4. Assistant with delegation
  {
    id: '4',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(39),
    delegations: [
      {
        agentName: 'Notion',
        agentModel: 'claude-3.5-sonnet',
        thinkingLevel: 'xhigh',
        mode: 'build',
        tools: ['read', 'write', 'edit', 'bash', 'grep', 'find', 'ls', 'skill'],
        systemPrompt: 'You are the Notion agent. You interact with Notion via the notion-api skill to create, read, and update pages.',
        taskContent: 'Create a documentation page in Notion with the fix details for main.ts. The error was: init() called without null check. The fix: add typeof check before calling init().',
        thinking: [
          {
            level: 'xhigh',
            content: 'I need to create a Notion page with the fix documentation. Let me first check if the notion-api skill is available, then create the page with the appropriate content structure.',
          }
        ],
        toolCalls: [
          { name: 'skill', input: 'notion-api list-pages' },
          { name: 'skill', input: 'notion-api create-page --title "Fix Documentation"' },
        ],
        toolResults: [
          { name: 'skill', output: 'Error: Notion API key not configured. Run /directory to set NOTION_API_KEY.', isError: true },
          { name: 'skill', output: 'Page created successfully. URL: https://notion.so/fix-docs-main-ts-1234', isError: false },
        ],
        compaction: [
          {
            content: 'Summary of delegation:\n- Task: create Notion docs page\n- First attempt failed (API key not configured)\n- Second attempt succeeded\n- Page created with fix details\n\nKey context: Notion API key needs to be configured for future use.',
            isNoop: false,
          },
          {
            content: 'Compaction attempted but delegation is too short to effectively summarize. Token savings would be minimal.',
            isNoop: true,
          },
        ],
        response: 'I\'ve created a new page in your Notion workspace called "Fix Documentation" with the following content:\n\n1. **Problem** — main.ts was calling `init()` without null check\n2. **Solution** — Added `typeof` check before calling `init()`\n3. **Code** —\n\n```typescript\nif (typeof init === \'function\') {\n  init()\n}\n```\n\nThe page is now live in your workspace.',
      }
    ],
    content: 'Delegation complete. The Notion agent has created a documentation page with the fix details.',
    tokensIn: 15,
    tokensOut: 89,
  },

  // 5. User asks something that triggers an API error
  {
    id: '5',
    role: 'user',
    content: 'Now summarize the entire codebase for me.',
    timestamp: minsAgo(35),
    tokensIn: 10,
  },

  // 6. Assistant — API/streaming error
  {
    id: '6',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(34),
    isStreaming: false,
    isError: true,
    errorType: 'api',
    errorContent: 'Error: Connection refused. The Ollama server is not running.\n\nPlease start the Ollama server with:\n  ollama serve\n\nThen retry your request.',
    tokensIn: 10,
    tokensOut: 0,
  },

  // 7. User retries
  {
    id: '7',
    role: 'user',
    content: 'Try again, it should be running now.',
    timestamp: minsAgo(30),
    tokensIn: 8,
  },

  // 8. Assistant — rate limit error
  {
    id: '8',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(29),
    isStreaming: false,
    isError: true,
    errorType: 'rate_limit',
    errorContent: 'Error: Rate limit exceeded (429).\n\nYou have sent too many requests in a short period. Please wait 30 seconds before retrying.',
    tokensIn: 8,
    tokensOut: 0,
  },

  // 9. User retries again
  {
    id: '9',
    role: 'user',
    content: 'Ok let me wait... try now.',
    timestamp: minsAgo(25),
    tokensIn: 6,
  },

  // 10. Assistant — context overflow error
  {
    id: '10',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(24),
    isStreaming: false,
    isError: true,
    errorType: 'context_overflow',
    errorContent: 'Error: Context window exceeded.\n\nThe conversation has grown beyond the model\'s context limit (32,768 tokens). Please compact the conversation or start a new chat.',
    tokensIn: 6,
    tokensOut: 0,
  },

  // 11. User retries after waiting
  {
    id: '11',
    role: 'user',
    content: 'Let me try a different approach. Can you search for memory leak patterns?',
    timestamp: minsAgo(20),
    tokensIn: 12,
  },

  // 12. Assistant — tool execution error
  {
    id: '12',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(19),
    isStreaming: false,
    isError: true,
    errorType: 'tool',
    errorContent: 'Error: Tool execution failed.\n\ngrep: Argument list too long. The search pattern returned too many results. Try narrowing your search with a more specific regex pattern.',
    tokensIn: 12,
    tokensOut: 0,
  },

  // 13. User asks to try a different tool
  {
    id: '13',
    role: 'user',
    content: 'Try using find instead with a smaller scope.',
    timestamp: minsAgo(15),
    tokensIn: 9,
  },

  // 14. Assistant — permission denied error
  {
    id: '14',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(14),
    isStreaming: false,
    isError: true,
    errorType: 'permission',
    errorContent: 'Error: Permission denied.\n\nCannot access /var/log/system.log. The current user does not have read permissions for this file. Try running with elevated privileges or choose a different file.',
    tokensIn: 9,
    tokensOut: 0,
  },

  // 15. User asks to compact
  {
    id: '15',
    role: 'user',
    content: 'Can you compact the conversation?',
    timestamp: minsAgo(10),
    tokensIn: 7,
  },

  // 16. Assistant — compaction + success
  {
    id: '16',
    role: 'assistant',
    agentName: 'Quinki Expert',
    agentModel: 'qwen3:32b',
    thinkingLevel: 'xhigh',
    timestamp: minsAgo(9),
    isStreaming: false,
    thinking: [
      {
        level: 'xhigh',
        content: 'The user wants to compact. I\'ll summarize the key points of the conversation so far.',
      }
    ],
    compaction: [
      {
        content: 'Conversation compacted:\n- Fixed init() null check error in main.ts\n- Created Notion documentation page\n- Encountered API connection error (Ollama not running)\n- Encountered rate limit (429)\n- Encountered context overflow (32K limit)\n- Encountered tool execution error (grep too many results)\n- Encountered permission denied error (system.log)\n\nKey files: main.ts\nKey agents: Quinki Expert, Notion',
        isNoop: false,
      },
    ],
    content: 'I\'ve compacted the conversation. The key points have been preserved:\n\n1. Fixed `init()` null check in main.ts\n2. Created Notion documentation page\n3. Resolved API and rate limit errors\n4. Handled context overflow, tool errors, and permission issues\n\nYou can continue the conversation now.',
    tokensIn: 7,
    tokensOut: 45,
  },
]

// ──────────────────────────────────────────────────────────
// SESSIONS — with context levels for testing
// ──────────────────────────────────────────────────────────
export const mockSessions: Session[] = [
  // Chat at 0% context — outside folders
  { id: 's0a', title: 'New chat', type: 'chat', updatedAt: minsAgo(5), messageCount: 0 },

  // Folder with chat at 50% context
  { id: 'folder-1', title: 'Project Alpha', type: 'folder', updatedAt: minsAgo(60), isExpanded: true, messageCount: 0 },
  { id: 's50', title: 'Debug session (50% ctx)', type: 'chat', parentId: 'folder-1', lastMessage: 'Found the issue in the parser...', updatedAt: minsAgo(60), agents: ['Quinki Expert'], messageCount: 12 },

  // Subfolder inside folder-1 with chat at 80% context
  { id: 'folder-1-1', title: 'Critical bugs', type: 'folder', parentId: 'folder-1', updatedAt: minsAgo(120), isExpanded: false, messageCount: 0 },
  { id: 's80', title: 'Memory leak (80% ctx)', type: 'chat', parentId: 'folder-1-1', lastMessage: 'The leak is in the event handler...', updatedAt: minsAgo(120), agents: ['Quinki Expert', 'Orchestrator'], messageCount: 8, unread: true },

  // Chat at 0% context — outside all folders
  { id: 's0b', title: 'Quick question', type: 'chat', updatedAt: minsAgo(600), messageCount: 0 },
]

// ──────────────────────────────────────────────────────────
// AGENTS
// ──────────────────────────────────────────────────────────
export const mockAgents: Agent[] = [
  {
    id: 'quinki-expert', name: 'Quinki Expert',
    systemPrompt: 'You are Quinki Expert, a helpful coding assistant. You have access to file system tools and can search the web. Always be precise and concise.',
    model: 'glm-4.5', thinking: 'xhigh', isDeletable: false,
    skills: [
      { name: 'quinki-expert', source: 'local', installed: true },
      { name: 'find-skills', source: 'pi.dev', installed: true },
      { name: 'ddg-search', source: 'pi.dev', installed: true },
      { name: 'ponytail', source: 'pi.dev', installed: true },
    ],
    tools: [
      { name: 'read', enabled: true }, { name: 'write', enabled: true },
      { name: 'edit', enabled: true }, { name: 'bash', enabled: true },
      { name: 'grep', enabled: true }, { name: 'find', enabled: true },
      { name: 'ls', enabled: true }, { name: 'skill', enabled: true },
    ],
    files: ['PROMPT.md', 'SKILL.md', 'NOTES.md', 'config.json'],
  },
  {
    id: 'agent-notion', name: 'Notion',
    systemPrompt: 'You are the Notion agent. You interact with Notion via the notion-api skill to create, read, and update pages.',
    model: 'claude-3.5-sonnet', thinking: 'off', isDeletable: true,
    skills: [{ name: 'notion-api', source: 'pi.dev', installed: true }, { name: 'find-skills', source: 'pi.dev', installed: true }],
    tools: [
      { name: 'read', enabled: true }, { name: 'write', enabled: true },
      { name: 'edit', enabled: true }, { name: 'bash', enabled: true },
      { name: 'grep', enabled: true }, { name: 'find', enabled: true },
      { name: 'ls', enabled: true }, { name: 'skill', enabled: true },
    ],
    files: ['NOTES.md'],
  },
  {
    id: 'orchestrator', name: 'Orchestrator',
    systemPrompt: 'You are the Orchestrator. You coordinate multi-agent tasks by delegating to the appropriate agent using delegate_to_agent.',
    model: 'glm-4.5', thinking: 'xhigh', isDeletable: false,
    skills: [{ name: 'find-skills', source: 'pi.dev', installed: true }], tools: [{ name: 'delegate_to_agent', enabled: true }], files: [],
  },
]

// ──────────────────────────────────────────────────────────
// PROVIDERS
// ──────────────────────────────────────────────────────────
export const mockProviders: Provider[] = [
  {
    id: 'ollama', name: 'Ollama (Local)', type: 'ollama', apiKeyStatus: 'configured', enabled: true,
    models: [
      { id: 'qwen3:32b', name: 'Qwen 3 32B', contextWindow: 32768 },
      { id: 'qwen3:14b', name: 'Qwen 3 14B', contextWindow: 32768 },
      { id: 'qwen3:8b', name: 'Qwen 3 8B', contextWindow: 32768 },
      { id: 'llama3.3:70b', name: 'Llama 3.3 70B', contextWindow: 32768 },
      { id: 'deepseek-r1:32b', name: 'DeepSeek R1 32B', contextWindow: 32768 },
    ],
  },
  {
    id: 'openrouter', name: 'OpenRouter', type: 'openrouter', apiKeyStatus: 'configured', enabled: true,
    models: [
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1000000 },
    ],
  },
  {
    id: 'anthropic', name: 'Anthropic Direct', type: 'anthropic', apiKeyStatus: 'missing', enabled: false,
    models: [
      { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'claude-3.5-haiku', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
    ],
  },
]

// ──────────────────────────────────────────────────────────
// THEMES — 17 built-in presets
// ──────────────────────────────────────────────────────────
export const mockThemes: ThemePreset[] = [
  { id: 'comfort', name: 'Comfort', bg: '#08080B', bgPanel: '#0F0F13', bgBubbleUser: '#1A1A20', text: '#E8E8EC' },
  { id: 'midnight', name: 'Midnight', bg: '#060608', bgPanel: '#0C0C10', bgBubbleUser: '#16161A', text: '#E8E8EC' },
  { id: 'forest', name: 'Forest', bg: '#08080A', bgPanel: '#0E0E10', bgBubbleUser: '#18181A', text: '#E8E8EC' },
  { id: 'warm', name: 'Warm', bg: '#0A0A0A', bgPanel: '#101010', bgBubbleUser: '#1A1A1A', text: '#E8E8EC' },
  { id: 'eclipse', name: 'Eclipse', bg: '#040406', bgPanel: '#0A0A0C', bgBubbleUser: '#141416', text: '#E8E8EC' },
  { id: 'graphite', name: 'Graphite', bg: '#0C0C0E', bgPanel: '#121214', bgBubbleUser: '#1E1E20', text: '#E8E8EC' },
  { id: 'mist', name: 'Mist', bg: '#141416', bgPanel: '#1A1A1C', bgBubbleUser: '#262628', text: '#E8E8EC' },
] = [
  { id: 'comfort', name: 'Vision Comfort (Neutral)', bg: '#121212', bgPanel: '#1F1F1F', bgBubbleUser: '#383838', text: '#EAEAEA' },
  { id: 'midnight', name: 'Antracite Notturna', bg: '#161616', bgPanel: '#232323', bgBubbleUser: '#232323', text: '#e6e6e6' },
  { id: 'forest', name: 'Ossidiana Nera', bg: '#0a0a0a', bgPanel: '#1e1e1e', bgBubbleUser: '#141414', text: '#e6e6e6' },
  { id: 'warm', name: 'Amber Void Harmony', bg: '#0B0E1A', bgPanel: '#1A1F1A', bgBubbleUser: '#3A2A12', text: '#e6e6e6' },
  { id: 'eclipse', name: 'Arctic Plum Ocean', bg: '#070C18', bgPanel: '#241A2E', bgBubbleUser: '#0F3B3C', text: '#e6e6e6' },
  { id: 'graphite', name: 'Earth Neon Calm', bg: '#07140F', bgPanel: '#2A1B14', bgBubbleUser: '#3B3A1A', text: '#e6e6e6' },
  { id: 'mist', name: 'Nordic Calm', bg: '#0A0F1C', bgPanel: '#14222A', bgBubbleUser: '#2B4A66', text: '#e6e6e6' },
]