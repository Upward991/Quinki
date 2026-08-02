// Date/time parser — English only, time matches time-of-day (not range)

const monthsAll = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export function parseDateInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  // gg/mm/aaaa or gg-mm-aaaa
  let m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m) {
    const day = +m[1], month = +m[2], year = +m[3]
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d.getTime()
    return null
  }

  // gg/mm or gg-mm (no year → current year)
  m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})$/)
  if (m) {
    const day = +m[1], month = +m[2]
    const year = new Date().getFullYear()
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d.getTime()
    return null
  }

  // gg month [yyyy]
  m = trimmed.match(/^(\d{1,2})[\s\-]+(\w+)(?:[\s\-]+(\d{4}))?$/)
  if (m) {
    const day = +m[1]
    const monthIdx = monthsAll.indexOf(m[2])
    const year = m[3] ? +m[3] : new Date().getFullYear()
    if (monthIdx !== -1) {
      const d = new Date(year, monthIdx, day)
      if (d.getFullYear() === year && d.getMonth() === monthIdx && d.getDate() === day) return d.getTime()
    }
  }

  // day only → current month/year
  m = trimmed.match(/^(\d{1,2})$/)
  if (m) {
    const day = +m[1]
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), day)
    if (d.getMonth() === now.getMonth() && d.getDate() === day) return d.getTime()
    return null
  }

  return null
}

export type TimePrecision = 'hour' | 'minute' | 'second'
export interface ParsedTime {
  hours: number
  minutes: number
  seconds: number
  precision: TimePrecision
}

export function parseTimeInput(input: string): ParsedTime | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // hh:mm:ss
  let m = trimmed.match(/^(\d{1,2})[:\s](\d{2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2], s = +m[3]
    if (h >= 0 && h < 24 && min >= 0 && min < 60 && s >= 0 && s < 60) return { hours: h, minutes: min, seconds: s, precision: 'second' }
  }
  // hh:mm
  m = trimmed.match(/^(\d{1,2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2]
    if (h >= 0 && h < 24 && min >= 0 && min < 60) return { hours: h, minutes: min, seconds: 0, precision: 'minute' }
  }
  // hh only
  m = trimmed.match(/^(\d{1,2})$/)
  if (m) {
    const h = +m[1]
    if (h >= 0 && h < 24) return { hours: h, minutes: 0, seconds: 0, precision: 'hour' }
  }
  return null
}

// Check if a message timestamp matches date + time filters
export function messageMatchesFilters(ts: number, dateInput: string, timeInput: string): boolean {
  const dateTs = dateInput.trim() ? parseDateInput(dateInput) : null
  const timeObj = timeInput.trim() ? parseTimeInput(timeInput) : null

  if (!dateTs && !timeObj) return true // no filter → match all

  const d = new Date(ts)

  // Date filter: must match the exact day
  if (dateTs) {
    const dr = new Date(dateTs)
    if (d.getFullYear() !== dr.getFullYear() || d.getMonth() !== dr.getMonth() || d.getDate() !== dr.getDate()) return false
  }

  // Time filter: match time-of-day components based on precision
  if (timeObj) {
    if (d.getHours() !== timeObj.hours) return false
    if (timeObj.precision === 'minute' || timeObj.precision === 'second') {
      if (d.getMinutes() !== timeObj.minutes) return false
    }
    if (timeObj.precision === 'second') {
      if (d.getSeconds() !== timeObj.seconds) return false
    }
  }

  return true
}