// QuinkiWordmark — il wordmark pixel "Quinki" IDENTICO al hero della CLI
// (stesso font 5x8, stessi mezzi-blocchi ▀▄█ — cli/tui/app.ts QPIX).
import React from 'react'

const QPIX: Record<string, string[]> = {
  "Q": ["01110", "10001", "10001", "10001", "10001", "01110", "00010", "00011"],
  "u": ["00000", "00000", "10001", "10001", "10001", "10011", "01101", "00000"],
  "i": ["00100", "00000", "01100", "00100", "00100", "00100", "01110", "00000"],
  "n": ["00000", "00000", "10110", "11001", "10001", "10001", "10001", "00000"],
  "k": ["10000", "10000", "10010", "10100", "11000", "10100", "10010", "00000"],
}

function glyphBounds(bm: string[]): [number, number] {
  let a = 99, b = -1
  for (let r = 0; r < 8; r++) for (let x = 0; x < 5; x++) if (bm[r]?.[x] === '1') { a = Math.min(a, x); b = Math.max(b, x) }
  if (b < 0) return [0, 0]
  return [a, b]
}

function pixWord(word: string): string[] {
  const rows: string[] = []
  for (let r = 0; r < 4; r++) {
    let out = ""
    for (let j = 0; j < word.length; j++) {
      const bm = QPIX[word[j]] || QPIX["i"]
      const [x0, x1] = glyphBounds(bm)
      for (let x = x0; x <= x1; x++) {
        const top = bm[r * 2]?.[x] === '1'
        const bot = bm[r * 2 + 1]?.[x] === '1'
        out += top && bot ? "\u2588" : top ? "\u2580" : bot ? "\u2584" : " "
      }
      if (j < word.length - 1) out += " "
    }
    rows.push(out)
  }
  return rows
}

export function QuinkiWordmark({ size = 15 }: { size?: number }) {
  const text = React.useMemo(() => pixWord("Quinki").join("\n"), [])
  return React.createElement('pre', {
    style: {
      margin: 0, padding: 0,
      // stack mono che garantisce i blocchi U+2580/2584/2588 su tutti i device
      fontFamily: 'Menlo, ui-monospace, "SF Mono", monospace',
      fontSize: size + 'px',
      lineHeight: 1,
      color: 'var(--q-accent-primary)',
      userSelect: 'none',
      whiteSpace: 'pre',
    }
  }, text)
}
