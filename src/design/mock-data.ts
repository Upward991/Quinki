// ============================================================
// Quinki — Mock Data
// ============================================================

import type { ThemePreset } from '../types'

// ──────────────────────────────────────────────────────────
// THEMES — 7 built-in presets
// ──────────────────────────────────────────────────────────
export const mockThemes: ThemePreset[] = [
  { id: 'comfort', name: 'Comfort', bg: '#08080B', bgPanel: '#0F0F13', bgBubbleUser: '#1A1A20', text: '#E8E8EC' },
  { id: 'midnight', name: 'Midnight', bg: '#060608', bgPanel: '#0C0C10', bgBubbleUser: '#16161A', text: '#E8E8EC' },
  { id: 'forest', name: 'Forest', bg: '#08080A', bgPanel: '#0E0E10', bgBubbleUser: '#18181A', text: '#E8E8EC' },
  { id: 'warm', name: 'Warm', bg: '#0A0A0A', bgPanel: '#101010', bgBubbleUser: '#1A1A1A', text: '#E8E8EC' },
  { id: 'eclipse', name: 'Eclipse', bg: '#040406', bgPanel: '#0A0A0C', bgBubbleUser: '#141416', text: '#E8E8EC' },
  { id: 'graphite', name: 'Graphite', bg: '#0C0C0E', bgPanel: '#121214', bgBubbleUser: '#1E1E20', text: '#E8E8EC' },
  { id: 'mist', name: 'Mist', bg: '#141416', bgPanel: '#1A1A1C', bgBubbleUser: '#262628', text: '#E8E8EC' },
]