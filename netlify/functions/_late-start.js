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

// Does THIS day start at noon rather than ~10 AM?
//
// Both no-show crons used to ask only "is today the class's week_start_date?",
// i.e. Day 1 of Week A. That is wrong for the two-week cohorts: a cohort's
// WEEK B Monday is day 8 by that maths, so it missed the grace entirely — and
// every venue's schedule_template says Mondays run 12:00pm–4:00pm. On
// 2026-08-17 that would have flagged the whole Week B group as no-shows at
// 10:30 AM, 90 minutes before their class even started, which unenrolls them,
// deletes their accounts and cancels their hotel rooms.
//
// So: a MONDAY is a noon start (Week A Monday and Week B Monday both), Day 1 is
// a noon start whatever weekday it falls on (some cohorts start Tuesday), and
// LATE_START_DATES still forces it for one-off delays.
//
// This can only ever DELAY an alert to 12:30 PM ET, never cause one — so the
// worst case of a false positive here is that a genuine no-show is caught two
// hours later than it would have been.
export function isNoonStartDay(today, weekStartDate) {
  if (isLateStartDate(today)) return true
  if (weekStartDate && today === weekStartDate) return true      // Day 1 of Week A
  // Noon on the ISO date, so the weekday can't slip across a timezone boundary.
  return new Date(`${today}T12:00:00Z`).getUTCDay() === 1        // any Monday
}
