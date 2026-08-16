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

// Fallback only. The live timetable is app_settings.training_timetable, edited at
// /timetable — one row, shared with the trainee-facing pages, so the hours a
// trainee is TOLD and the hours these crons WAIT FOR can no longer disagree.
// If the row can't be read we use these rather than policing on wrong hours.
const FALLBACK_START_ET = {
  A: { 1: 14, 2: 14, 3: 10 },          // Mon 2pm · Tue 2pm · Wed 10am, then field
  B: { 1: 11, 2: 10, 3: 13, 4: 10 },   // Mon 11am · Tue 10am · Wed 1pm · Thu 10am
}

let cached = null
// Turn the saved timetable into { A: {dow: startHour}, B: {...} }. Days with no
// classroom (Week A Thu–Sat, Week B Fri) simply have no entry, which is what
// makes them un-policed.
export async function loadStartHours(supabase) {
  if (cached) return cached
  try {
    const { data } = await supabase
      .from('app_settings').select('value').eq('key', 'training_timetable').maybeSingle()
    const tt = data?.value ? JSON.parse(data.value) : null
    if (!tt?.A?.days?.length) return FALLBACK_START_ET
    const out = { A: {}, B: {} }
    for (const phase of ['A', 'B']) {
      for (const d of tt[phase]?.days || []) {
        if (d.dow != null && d.start != null) out[phase][d.dow] = d.start
      }
    }
    if (!Object.keys(out.A).length) return FALLBACK_START_ET
    cached = out
    return out
  } catch {
    return FALLBACK_START_ET
  }
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
export function classStartHourET(weekStartDate, today, startHours = FALLBACK_START_ET) {
  const phase = phaseForDate(weekStartDate, today)
  if (!phase) return null
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  const hour = (startHours[phase] || {})[dow]
  return hour == null ? null : hour
}

export function isClassDay(weekStartDate, today, startHours = FALLBACK_START_ET) {
  return classStartHourET(weekStartDate, today, startHours) != null
}

// When may a no-show alert fire? Class start + 30 minutes' grace, so someone
// merely running late isn't unenrolled. null = don't alert at all today.
// A LATE_START_DATES entry still forces the noon+30 fallback.
export function alertHourET(weekStartDate, today, startHours = FALLBACK_START_ET) {
  const start = classStartHourET(weekStartDate, today, startHours)
  if (start == null) return null
  if (isLateStartDate(today)) return 12.5
  return start + 0.5
}
