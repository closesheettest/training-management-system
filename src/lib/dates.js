// Date utilities. All functions parse YYYY-MM-DD strings as LOCAL dates
// (not UTC) so a "May 4" stored in Supabase doesn't display as "May 3" in
// a US timezone.

export function parseLocalDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

export function formatDateLong(iso) {
  const d = parseLocalDate(iso)
  if (!d) return ''
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatDateShort(iso) {
  const d = parseLocalDate(iso)
  if (!d) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDateRange(startIso, endIso) {
  const start = parseLocalDate(startIso)
  const end = parseLocalDate(endIso)
  if (!start) return ''
  if (!end || start.getTime() === end.getTime()) return formatDateShort(startIso)

  const sameMonth =
    start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })} – ${end.getDate()}, ${end.getFullYear()}`
  }
  return `${formatDateShort(startIso)} – ${formatDateLong(endIso)}`
}

// "2026-05" key used for grouping by month
export function monthKey(iso) {
  if (!iso) return ''
  return iso.slice(0, 7)
}

export function formatMonth(key) {
  if (!key) return ''
  const [y, m] = key.split('-').map(Number)
  if (!y || !m) return key
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Group an array of items (with a `week_start_date` field) by their month key,
// preserving the original ordering of items.
export function groupByMonth(items, dateField = 'week_start_date') {
  const groups = new Map()
  for (const item of items) {
    const key = monthKey(item[dateField])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return [...groups.entries()]
}
