// Late-start override for training days that don't begin at their usual hour
// (a weather delay, a schedule change, or a holiday week where every day slides
// onto the previous day's timetable).
//
// Set the env var LATE_START_DATES to a comma-separated list of ET dates:
//
//   "2026-07-14"                 → hold the alert gate to 12:30 PM (a noon start)
//   "2026-09-09=14"              → class starts 2 PM; hold the gate to 2:30 PM
//   "2026-07-14,2026-09-09=14"   → mix freely
//
// On a listed date the no-show/dropout and hotel-no-show crons hold their alert
// gate until class start + 30 minutes, so trainees arriving at the real hour
// aren't flagged as no-shows — which would unenroll them, delete their accounts
// and cancel their hotel rooms. Detection resumes after that, so genuine
// no-shows are still caught the same day.
//
// WHY THE HOUR IS SETTABLE (Neal, 2026-09-08). The original override pinned the
// gate to a hardcoded 12:30 PM because every late start we'd seen was a noon
// start. That silently breaks the case it most needs to handle: Labor Day week
// slid Week A's 2 PM day onto a Wednesday the timetable thinks starts at 10 AM.
// Listing the date the old way would still have opened the gate at 12:30 and
// marked a full room of people no-shows an hour and a half before they arrived.
// A bare date keeps meaning noon, so nothing already in the env var changes.
//
// `_`-prefixed helper module — not a Netlify endpoint.

function entries() {
  return String(process.env.LATE_START_DATES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isLateStartDate(today) {
  return entries().some((e) => e.split('=')[0].trim() === today)
}

// The hour class actually starts on a listed date, as a number in ET.
// Returns 12 for a bare date (the original noon behaviour), or null when the
// date isn't listed at all. Anything unparseable falls back to noon rather than
// throwing — a bad env value must never be the reason a cron unenrolls someone.
export function lateStartHourET(today) {
  const hit = entries().find((e) => e.split('=')[0].trim() === today)
  if (!hit) return null
  const raw = hit.split('=')[1]
  if (raw == null || raw.trim() === '') return 12
  const h = Number(raw.trim())
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 12
}
