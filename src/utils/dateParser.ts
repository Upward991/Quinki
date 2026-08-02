// Date/time parser — English only
// Returns only the components that were specified

const monthsAll = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

export interface ParsedDate {
  day?: number
  month?: number  // 0-indexed
  year?: number
}

export function parseDateInput(input: string): ParsedDate | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  // gg/mm/aaaa or gg-mm-aaaa (full date)
  let m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m) {
    const day = +m[1], month = +m[2] - 1, year = +m[3]
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) return { day, month, year }
    return null
  }

  // gg/mm or gg-mm (day + month, no year)
  m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})$/)
  if (m) {
    const day = +m[1], month = +m[2] - 1
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) return { day, month }
    return null
  }

  // gg month [yyyy]
  m = trimmed.match(/^(\d{1,2})[\s\-]+(\w+)(?:[\s\-]+(\d{4}))?$/)
  if (m) {
    const day = +m[1]
    const monthIdx = monthsAll.indexOf(m[2])
    if (monthIdx !== -1 && day >= 1 && day <= 31) {
      return m[3] ? { day, month: monthIdx, year: +m[3] } : { day, month: monthIdx }
    }
  }

  // day only
  m = trimmed.match(/^(\d{1,2})$/)
  if (m) {
    const day = +m[1]
    if (day >= 1 && day <= 31) return { day }
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
  let m = trimmed.match(/^(\d{1,2})[:\s](\d{2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2], s = +m[3]
    if (h >= 0 && h < 24 && min >= 0 && min < 60 && s >= 0 && s < 60) return { hours: h, minutes: min, seconds: s, precision: 'second' }
  }
  m = trimmed.match(/^(\d{1,2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2]
    if (h >= 0 && h < 24 && min >= 0 && min < 60) return { hours: h, minutes: min, seconds: 0, precision: 'minute' }
  }
  m = trimmed.match(/^(\d{1,2})$/)
  if (m) {
    const h = +m[1]
    if (h >= 0 && h < 24) return { hours: h, minutes: 0, seconds: 0, precision: 'hour' }
  }
  return null
}

// Check if a message timestamp matches date + time filters
// Compares ONLY the specified components (day only → match any month/year with that day)
export function messageMatchesFilters(ts: number, dateInput: string, timeInput: string): boolean {
  const dateObj = dateInput.trim() ? parseDateInput(dateInput) : null
  const timeObj = timeInput.trim() ? parseTimeInput(timeInput) : null

  if (!dateObj && !timeObj) return true

  const d = new Date(ts)

  // Date filter: compare only specified components
  if (dateObj) {
    if (dateObj.day !== undefined && d.getDate() !== dateObj.day) return false
    if (dateObj.month !== undefined && d.getMonth() !== dateObj.month) return false
    if (dateObj.year !== undefined && d.getFullYear() !== dateObj.year) return false
  }

  // Time filter: compare time-of-day based on precision
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