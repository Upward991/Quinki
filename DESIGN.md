# Quinki Design System

## Brand Identity
Quinki is a premium AI agent desktop application. Dark, sophisticated, minimal.
Think Linear meets VS Code meets a luxury terminal.

## Colors (CSS Variables)

### Background
- `--q-bg`: #121212 (main background, darkest)
- `--q-bg-panel`: #1F1F1F (floating panels, header, sidebar, composer)
- `--q-bg-elevated`: #1d1d1d (code blocks, inputs, elevated surfaces)
- `--q-bg-code`: #1d1d1d (code blocks in messages)

### Text
- `--q-text`: #EAEAEA (primary text)
- `--q-text-secondary`: #9c9c9c (secondary text, labels)
- `--q-text-tertiary`: #6e6e6e (tertiary text, hints, timestamps)

### Accents
- `--q-accent-danger`: #d96b6b (primary accent — Agents tab, destructive actions, send button)
- `--q-accent-secondary`: #c97c5f (secondary accent — Settings tab, save buttons)
- `--q-accent-info`: #7a8aa0 (info accent — context counter, search highlight)
- `--q-accent-info-bright`: #b5c7e0 (active session, insertion lines)
- `--q-accent-warning`: #d7be66 (warning, 50-80% context)
- `--q-accent-success`: #9bbf7a (success, tool results)
- `--q-accent-folder-open`: #fcc998 (folders open, new folder flash)
- `--q-accent-orange`: #e8975a (compaction ineffective, orange toggle)

### Bubble
- `--q-bubble-user`: #383838 (user message background)
- `--q-bubble-user-text`: #EAEAEA (user message text)

### Toggles
- `--q-thinking`: #a888c0 (thinking toggle, status pill)
- `--q-tool-call`: #d7be66 (tool call toggle)
- `--q-tool-result`: #9bbf7a (tool result toggle)
- `--q-delegation`: #c46a7e (delegation toggle)

### Status Pills
- `--q-status-thinking`: #a888c0
- `--q-status-writing`: #EAEAEA
- `--q-status-tool-call`: #d7be66
- `--q-status-tool-result`: #9bbf7a
- `--q-status-tool-error`: #d96b6b
- `--q-status-compacting`: #6ab0e0
- `--q-status-retrying`: #d7be66
- `--q-status-failed`: #d96b6b
- `--q-status-running`: #5ec4a8

### Borders
- `--q-border-soft`: rgba(234, 234, 234, 0.04)
- `--q-border`: rgba(234, 234, 234, 0.08)
- `--q-border-strong`: rgba(234, 234, 234, 0.12)
- `--q-hover`: rgba(234, 234, 234, 0.08)
- `--q-active`: rgba(234, 234, 234, 0.12)

## Typography
- **Interface font**: IBM Plex Sans (UI text, labels, buttons, messages)
- **Code font**: IBM Plex Mono (code blocks, timestamps, log entries, context counter)

### Sizes
- 16px: page titles, section titles
- 15px: section headers, agent names
- 14px: body text, agent names, labels
- 13px: sub-labels, file editor content
- 12px: timestamps, log tags, thinking levels, filter pills
- 11px: log paths, unsaved indicator

## Spacing
- 8px: primary spacing unit (padding, gaps between panels, section margins)
- 4px: secondary spacing (padding inside items, small gaps)
- 12px: indentation depth in sidebar (per level)
- 16px: content padding inside panels
- 24px: modal padding

## Border Radius
- `--radius-sm`: 4px (small chips, badges)
- `--radius-md`: 6px (buttons, inputs, dropdowns)
- `--radius-lg`: 8px (panels, headers, composer, sections)
- `--radius-xl`: 12px (modals, dialogs)

## Shadows
- `--shadow-floating`: subtle shadow for floating panels (header, sidebar, composer)
- `--shadow-modal`: stronger shadow for modals and dropdowns

## Layout
- Header: 48px min height, floating panel style (bgPanel + radiusLg + shadowFloating)
- Sidebar: 284px wide, floating panel
- Chat max width: 800px (centered)
- Composer: floating panel at bottom
- Modals: centered, bgElevated, radiusXl, shadowModal

## Components
- **IconBtn**: 32x32, icon 20px, hover bgHover, radius 6px
- **FilterPill**: 32px height, border outline, active = filled with level color
- **Toggle**: collapsed (▶/▼ + label + preview), expanded (border-left colored line + content)
- **Tag**: border + bgPanel, icon 14px + label 13px, optional X
- **Modal**: bgElevated + border + radiusXl + shadowModal, header bgPanel, footer border-top

## Interaction Patterns
- Right-click context menus everywhere
- Hover reveals copy/delete buttons
- Toggles expand/collapse with chevron
- Modals for all confirmations (Cancel + Confirm)
- Error modals with Copy button
- Search in all lists (dropdowns, picker modals, log, settings)
