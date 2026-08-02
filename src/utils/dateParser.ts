// Date/time parser — English only
// Time = "from that time onwards" on the specified date (or today if no date)

const monthsAll = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

// Returns { day, month?, year? } — month is 0-indexed
export interface ParsedDate { day?: number; month?: number; year?: number }

export function parseDateInput(input: string): ParsedDate | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return null

  // gg/mm/aaaa or gg-mm-aaaa
  let m = trimmed.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/)
  if (m) {
    const day = +m[1], month = +m[2] - 1, year = +m[3]
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) return { day, month, year }
    return null
  }
  // gg/mm or gg-mm
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
    if (monthIdx !== -1 && day >= 1 && day <= 31) return m[3] ? { day, month: monthIdx, year: +m[3] } : { day, month: monthIdx }
  }
  // day only
  m = trimmed.match(/^(\d{1,2})$/)
  if (m) {
    const day = +m[1]
    if (day >= 1 && day <= 31) return { day }
  }
  return null
}

export interface ParsedTime { hours: number; minutes: number; seconds: number }

export function parseTimeInput(input: string): ParsedTime | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // hh:mm:ss or hh mm ss (spaces OR colons)
  let m = trimmed.match(/^(\d{1,2})[:\s](\d{2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2], s = +m[3]
    if (h >= 0 && h < 24 && min >= 0 && min < 60 && s >= 0 && s < 60) return { hours: h, minutes: min, seconds: s }
  }
  // hh:mm or hh mm
  m = trimmed.match(/^(\d{1,2})[:\s](\d{2})$/)
  if (m) {
    const h = +m[1], min = +m[2]
    if (h >= 0 && h < 24 && min >= 0 && min < 60) return { hours: h, minutes: min, seconds: 0 }
  }
  // hh only
  m = trimmed.match(/^(\d{1,2})$/)
  if (m) {
    const h = +m[1]
    if (h >= 0 && h < 24) return { hours: h, minutes: 0, seconds: 0 }
  }
  return null
}

// Compute filter range: from specified date+time to end of that day
// No date → today. No time → from 00:00:00.
export function messageMatchesFilters(ts: number, dateInput: string, timeInput: string): boolean {
  const dateObj = dateInput.trim() ? parseDateInput(dateInput) : null
  const timeObj = timeInput.trim() ? parseTimeInput(timeInput) : null
  if (!dateObj && !timeObj) return true

  // Determine the reference date
  const now = new Date()
  let year = now.getFullYear(), month = now.getMonth(), day = now.getDate()
  if (dateObj) {
    if (dateObj.day !== undefined) day = dateObj.day
    if (dateObj.month !== undefined) month = dateObj.month
    if (dateObj.year !== undefined) year = dateObj.year
  }

  // Start: date at specified time (or 00:00:00)
  const startHour = timeObj ? timeObj.hours : 0
  const startMin = timeObj ? timeObj.minutes : 0
  const startSec = timeObj ? timeObj.seconds : 0
  const start = new Date(year, month, day, startHour, startMin, startSec, 0).getTime()

  // End: end of that day (23:59:59.999)
  const end = new Date(year, month, day, 23, 59, 59, 999).getTime()

  return ts >= start && ts <= end
}