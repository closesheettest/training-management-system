// Days a cohort's classroom simply does not happen — a week cut short, a
// holiday, a cancellation.
//
// Set NO_CLASS_DATES to a comma-separated list of ET dates:
//
//   "2026-09-16"                → no classroom that day, for anyone
//   "2026-09-16,2026-11-27"     → list as many as you need
//
// On a listed date `classStartHourET` reports no class, which switches OFF every
// automation that polices attendance: no no-show sweep, no auto-unenroll, no IT
// "delete their Google account" text, no hotel "cancel the room" nag.
//
// WHY THIS EXISTS RATHER THAN EDITING THE TIMETABLE (Neal, 2026-09-15). Week A
// finished a day early, so Wednesday's classroom did not happen. The timetable at
// /timetable is ONE row shared by every cohort — removing Wednesday there would
// have changed Week A for every future class, not just this one. This says
// "not on this date" without touching the standing schedule.
//
// Remove the date once it is past; a stale entry only matters if the same
// calendar date comes round for another cohort, which it cannot.
//
// `_`-prefixed helper module — not a Netlify endpoint.

export function isNoClassDate(today) {
  return String(process.env.NO_CLASS_DATES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .some((d) => d === today)
}
