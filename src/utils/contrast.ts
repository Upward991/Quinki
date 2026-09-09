/* Contrast: calcola se l'icona deve essere bianca o nera in base alla luminanza dell'accent */
export function getContrastColor(cssVar: string): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
    if (!raw) return '#1a1a1a'
    const el = document.createElement('div')
    el.style.color = raw
    el.style.display = 'none'
    document.body.appendChild(el)
    const computed = getComputedStyle(el).color
    document.body.removeChild(el)
    const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
    if (!m) return '#1a1a1a'
    const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3])
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance > 0.55 ? '#1a1a1a' : '#ffffff'
  } catch { return '#1a1a1a' }
}
