// catalogPackages.ts — A4.3: contenuto dei pacchetti installabili dal Market
// per le categorie NON-tab (skill/agent/mcp/theme). L'app ha già i meccanismi
// nativi: il pacchetto viene scritto nel posto giusto (cartella skills/agents,
// registro MCP, cartella temi) e la UI nativa lo vede.
// In A4.4 questi stessi pacchetti arriveranno dal sito (stessa forma: manifest + files).

export interface PackageBundle {
  manifest: any
  files: Record<string, string>
}

// ── Skill: Web Research ──
const skillResearch: PackageBundle = {
  manifest: {
    id: 'skill-research', name: 'Web Research', version: '1.0.0', author: 'Quinki Labs',
    description: 'Deep research with citations', icon: '🔍', color: '#7aa2f7',
    category: 'skill', permissions: ['read', 'search'], entry: 'SKILL.md',
  },
  files: {
    'SKILL.md': `---
name: web-research
description: Deep research with citations. Guides the agent through multi-step web research: query planning, source gathering, cross-checking and a cited summary.
user-invocable: true
---

# Web Research

When asked to research a topic, follow this process:

1. **Plan queries** — break the topic into 3-5 sub-questions.
2. **Gather sources** — for each sub-question, search and open 2-3 credible sources.
3. **Cross-check** — note agreements and contradictions across sources.
4. **Summarize** — write the final answer with inline citations [1], [2] and a source list at the end.

## Rules
- Prefer primary sources (official docs, papers, original announcements).
- If sources conflict, say so explicitly.
- Never invent citations: only cite what you actually opened.
`,
  },
}

// ── Skill: Data Analysis ──
const skillData: PackageBundle = {
  manifest: {
    id: 'skill-data', name: 'Data Analysis', version: '0.9.0', author: 'Quinki Labs',
    description: 'Analyze data with code', icon: '📊', color: '#6bc46d',
    category: 'skill', permissions: ['read', 'bash', 'write'], entry: 'SKILL.md',
  },
  files: {
    'SKILL.md': `---
name: data-analysis
description: Guides the agent through cleaning, exploring and visualizing datasets with code in every step.
user-invocable: true
---

# Data Analysis

1. **Understand the data** — inspect the schema, types, missing values.
2. **Clean** — handle nulls, duplicates, inconsistent formats; document every decision.
3. **Explore** — distributions, correlations, outliers; use charts where useful.
4. **Conclude** — answer the original question with numbers, not just plots.

## Rules
- Run code for every claim about the data.
- Save cleaned data and scripts so the work is reproducible.
`,
  },
}

// ── Agent: Finance Agent ──
const agentFinance: PackageBundle = {
  manifest: {
    id: 'agent-finance', name: 'Finance Agent', version: '1.0.0', author: 'Quinki Labs',
    description: 'Budget and portfolio assistant', icon: '💰', color: '#6bc46d',
    category: 'agent', permissions: ['read', 'write'], entry: 'config.json',
  },
  files: {
    'config.json': JSON.stringify({
      id: 'agent-finance',
      name: 'Finance Agent',
      model: '',
      thinkingLevel: 'medium',
      mode: 'plan',
      tools: ['read', 'find', 'ls', 'bash_readonly', 'skill'],
      skills: [],
    }, null, 2),
    'PROMPT.md': `# Finance Agent

You are a personal finance assistant. You help with budgets, expenses and portfolio reviews.

## Behaviour
- Work in plan mode by default: read-only, propose before changing anything.
- Ask for the data you need (files, exports, spreadsheets) instead of guessing.
- When analysing numbers, show the math clearly and label assumptions.
- Suggest conservative, diversified recommendations. Never give guaranteed returns.
`,
  },
}

// ── Agent: Dev Agent ──
const agentDev: PackageBundle = {
  manifest: {
    id: 'agent-dev', name: 'Dev Agent', version: '1.1.0', author: 'Quinki Labs',
    description: 'Coding companion', icon: '💻', color: '#9d8bd9',
    category: 'agent', permissions: ['read', 'write', 'bash'], entry: 'config.json',
  },
  files: {
    'config.json': JSON.stringify({
      id: 'agent-dev',
      name: 'Dev Agent',
      model: '',
      thinkingLevel: 'high',
      mode: 'build',
      tools: ['read', 'grep', 'find', 'ls', 'write', 'edit', 'bash', 'skill'],
      skills: ['write-coding-standards-from-file'],
    }, null, 2),
    'PROMPT.md': `# Dev Agent

You are a coding companion. You write, review and fix code.

## Behaviour
- Read the relevant files before proposing changes.
- Follow the project's existing style and conventions.
- Explain changes concisely: what, why, and any tradeoffs.
- Run the tests or at least verify the code compiles before declaring done.
`,
  },
}

// ── MCP: GitHub ──
const mcpGithub: PackageBundle = {
  manifest: {
    id: 'mcp-github', name: 'GitHub MCP', version: '2.1.0', author: 'Quinki Labs',
    description: 'Repos, issues and PRs', icon: '🔗', color: '#9d8bd9',
    category: 'mcp', permissions: ['network'], entry: 'server.json',
  },
  files: {
    'source': 'https://api.githubcopilot.com/mcp/',
  },
}

// ── MCP: Notion ──
const mcpNotion: PackageBundle = {
  manifest: {
    id: 'mcp-notion', name: 'Notion MCP', version: '1.8.0', author: 'Quinki Labs',
    description: 'Pages, databases, search', icon: '📄', color: '#585860',
    category: 'mcp', permissions: ['network'], entry: 'server.json',
  },
  files: {
    'source': 'https://mcp.notion.com/mcp',
  },
}

// ── Theme: Midnight Blue ──
const themeMidnightBlue: PackageBundle = {
  manifest: {
    id: 'theme-midnight-blue', name: 'Midnight Blue', version: '1.0.0', author: 'Community',
    description: 'Deep blue dark theme', icon: '🎨', color: '#7aa2f7',
    category: 'theme', permissions: [], entry: 'theme.json',
  },
  files: {
    'theme.json': JSON.stringify({
      id: 'theme-midnight-blue', name: 'Midnight Blue',
      bg: '#07080f', bgPanel: '#0d1018', bgBubbleUser: '#1a2130', text: '#e8ecf5',
    }, null, 2),
  },
}

// ── Theme: Sunset ──
const themeSunset: PackageBundle = {
  manifest: {
    id: 'theme-sunset', name: 'Sunset', version: '0.9.0', author: 'Community',
    description: 'Warm orange dark theme', icon: '🌅', color: '#d9a066',
    category: 'theme', permissions: [], entry: 'theme.json',
  },
  files: {
    'theme.json': JSON.stringify({
      id: 'theme-sunset', name: 'Sunset',
      bg: '#0f0a08', bgPanel: '#171009', bgBubbleUser: '#2a1e14', text: '#f5ece4',
    }, null, 2),
  },
}

const packages: Record<string, PackageBundle> = {
  'skill-research': skillResearch,
  'skill-data': skillData,
  'agent-finance': agentFinance,
  'agent-dev': agentDev,
  'mcp-github': mcpGithub,
  'mcp-notion': mcpNotion,
  'theme-midnight-blue': themeMidnightBlue,
  'theme-sunset': themeSunset,
}

export function findPackageBundle(id: string): PackageBundle | undefined {
  return packages[id]
}
