// Late-start override for training days that begin at NOON instead of the
// normal ~10 AM sign-in (e.g. a weather delay or a schedule change).
//
// Set the env var LATE_START_DATES to a comma-separated list of ET dates in
// YYYY-MM-DD form, e.g. "2026-07-14" or "2026-07-14,2026-08-03". On a listed
// date, the no-show/dropout and hotel-no-show crons hold their alert gate to
// 12:30 PM ET — the same grace Day 1 always gets — so trainees arriving at
// noon aren't flagged as no-shows (which would unenroll them, delete their
// accounts, and cancel their hotel rooms). Detection resumes normally after
// 12:30 PM, so real no-shows are still caught.
//
// `_`-prefixed helper module — not a Netlify endpoint.
export function isLateStartDate(today) {
  return String(process.env.LATE_START_DATES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(today)
}
