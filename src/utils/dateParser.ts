// Date/time parser — port from Flutter date_parser.dart

const monthsIT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const monthsEN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthsAll = [...monthsIT, ...monthsEN]

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
      const realMonth = monthIdx % 12
      const d = new Date(year, realMonth, day)
      if (d.getFullYear() === year && d.getMonth() === realMonth && d.getDate() === day) return d.getTime()
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

export function parseTimeInput(input: string): { hours: number, minutes: number, seconds: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let m = trimmed.match(/^(\d{1,2})[:\s](\d{2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2], s = +m[3]
    if (h >= 0 && h < 24 && min >= 0 && min < 60 && s >= 0 && s < 60) return { hours: h, minutes: min, seconds: s }
  }
  m = trimmed.match(/^(\d{1,2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2]
    if (h >= 0 && h < 24 && min >= 0 && min < 60) return { hours: h, minutes: min, seconds: 0 }
  }
  m = trimmed.match(/^(\d{1,2})$/)
  if (m) {
    const h = +m[1]
    if (h >= 0 && h < 24) return { hours: h, minutes: 0, seconds: 0 }
  }
  return null
}

export function computeFilterRange(dateInput: string, timeInput: string, lastMsgTimestamp?: number): { start: number, end: number } | null {
  const dateTs = dateInput ? parseDateInput(dateInput) : null
  const timeObj = timeInput ? parseTimeInput(timeInput) : null

  if (dateTs != null && timeObj) {
    const d = new Date(dateTs)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), timeObj.hours, timeObj.minutes, timeObj.seconds, 0).getTime()
    return { start, end: start }
  } else if (dateTs != null) {
    const d = new Date(dateTs)
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()
    return { start, end }
  } else if (timeObj) {
    const ref = lastMsgTimestamp ? new Date(lastMsgTimestamp) : new Date()
    const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), timeObj.hours, timeObj.minutes, timeObj.seconds, 0).getTime()
    return { start, end: Number.MAX_SAFE_INTEGER }
  }
  return null
}

export function messageMatchesFilters(ts: number, dateInput: string, timeInput: string, lastMsgTimestamp?: number): boolean {
  const range = computeFilterRange(dateInput, timeInput, lastMsgTimestamp)
  if (!range) return true
  if (ts < range.start) return false
  if (range.end !== Number.MAX_SAFE_INTEGER && ts > range.end) return false
  return true
}