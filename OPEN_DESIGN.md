# Quinki — Open Design Brief

## What is this
Quinki is a desktop AI agent application. This is a pixel-perfect visual prototype
of the Flutter production app, rebuilt in React for design iteration.

## Live URL
https://quinki.vercel.app

## How to restyle
1. Open the live URL to see the current design
2. Read DESIGN.md for the design system (colors, fonts, spacing, components)
3. Make changes to the CSS variables in src/index.css — all colors are CSS variables
4. All components are in src/components/ — each tab is a separate file
5. The build outputs to dist/ — a single HTML + CSS + JS bundle

## Files structure
- `src/index.css` — all CSS variables (colors, spacing, radius, shadows)
- `src/components/home/HomeView.tsx` — Home tab
- `src/components/chat/ChatArea.tsx` — Chat tab (main container)
- `src/components/chat/ChatHeader.tsx` — Chat header with agent dropdown
- `src/components/chat/Composer.tsx` — Message composer with slash menu
- `src/components/chat/MessageBubble.tsx` — Message rendering with all toggle types
- `src/components/chat/SlashMenu.tsx` — Slash command menu
- `src/components/sidebar/Sidebar.tsx` — Chat sidebar with drag & drop
- `src/components/log/LogPanel.tsx` — Log tab
- `src/components/agents/AgentsPanel.tsx` — Agents tab
- `src/components/settings/SettingsPanel.tsx` — Settings tab
- `src/design/mock-data.ts` — All mock data (messages, agents, sessions, etc.)

## What to restyle
The goal is to make the design more premium and visually intuitive while keeping
the same structure. Focus on:
- Color palette refinement (more premium, better contrast)
- Typography hierarchy (clearer visual weight)
- Spacing rhythm (more breathable or more compact)
- Border radius (softer or sharper)
- Shadow depth (more or less depth)
- Micro-interactions (hover states, transitions)
