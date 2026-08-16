// The real two-week training schedule, as the trainee-facing confirm page shows
// it (src/pages/Confirm.jsx SCHEDULES — keep the two in step).
//
// This exists because the no-show automations were written for the old
// Mon–Fri, one-week, everyone-in-a-classroom shape and every assumption in them
// is now wrong:
//
//   • Week A's classroom stops WEDNESDAY. Thu–Sat they work the field from
//     home, so nobody checks in at the kiosk — but the crons policed those days
//     and read the silence as the entire cohort no-showing.
//   • Week B ends THURSDAY. Friday was policed the same way.
//   • The weekend between the two weeks sits inside the class window too.
//   • Start times are not 10 AM. Week A Monday starts at 2 PM; the old "Day 1
//     starts at noon" grace expired at 12:30, leaving a 90-minute window in
//     which everyone present-but-not-yet-due looked like a no-show.
//
// A no-show alert unenrolls the trainee, has IT delete their Google account and
// cancels their hotel room, so a false positive here is expensive and hard to
// walk back. Hence: no class day → no policing at all.
//
// `_`-prefixed helper module — not a Netlify endpoint.

import { isLateStartDate } from './_late-start.js'

// day-of-week (0 Sun … 6 Sat) → the hour ET that day's CLASSROOM starts.
// Absent = not a classroom day, so nothing is expected and nothing is policed.
const CLASS_START_ET = {
  A: { 1: 14, 2: 14, 3: 10 },          // Mon 2pm · Tue 2pm · Wed 10am, then field
  B: { 1: 11, 2: 10, 3: 13, 4: 10 },   // Mon 11am · Tue 10am · Wed 1pm · Thu 10am
}

const MS_DAY = 86_400_000
const dayIndex = (fromIso, toIso) =>
  Math.floor((new Date(`${toIso}T12:00:00Z`) - new Date(`${fromIso}T12:00:00Z`)) / MS_DAY)

// Which half of the cohort's two weeks is `today` in? null = outside both.
export function phaseForDate(weekStartDate, today) {
  if (!weekStartDate || !today) return null
  const n = dayIndex(weekStartDate, today)
  if (n < 0 || n > 13) return null
  return n <= 6 ? 'A' : 'B'
}

// The hour ET that classroom starts for this cohort on this date, or null when
// it isn't a classroom day (field days, the middle weekend, Week B Friday).
export function classStartHourET(weekStartDate, today) {
  const phase = phaseForDate(weekStartDate, today)
  if (!phase) return null
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const hour = CLASS_START_ET[phase][dow]
  return hour == null ? null : hour
}

export function isClassDay(weekStartDate, today) {
  return classStartHourET(weekStartDate, today) != null
}

// When may a no-show alert fire? Class start + 30 minutes' grace, so someone
// merely running late isn't unenrolled. null = don't alert at all today.
// A LATE_START_DATES entry still forces the noon+30 fallback.
export function alertHourET(weekStartDate, today) {
  const start = classStartHourET(weekStartDate, today)
  if (start == null) return null
  if (isLateStartDate(today)) return 12.5
  return start + 0.5
}
