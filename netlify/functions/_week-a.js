// Who actually FINISHED Week A — i.e. who is really continuing into Week B.
//
// The first version of this gate asked "did they attend ANY day of Week A?".
// That was too loose: of the Aug-10 cohort, 7 people attended at least one day
// but 3 of them turned up on the Monday and were never seen again. Neal: "the
// others are dead to us, no need to track them." Counting them made a Week B of
// 4 read as 7, and the Friday confirmation text went to all 7.
//
// The rule is "were they still there at the END of Week A": attended the LAST
// day that cohort recorded any attendance for. That last day is derived from the
// data rather than assumed to be Friday, which matters because a Week A doesn't
// always record a Friday (8/14/2026 has no attendance rows at all) — so the
// yardstick self-calibrates to whatever the final real class day turned out to be.
//
// `_`-prefixed helper module — not a Netlify endpoint.

// The last date in [waStart, waEnd] that ANYONE in the cohort was marked present.
export function lastWeekADay(trainees, waStart, waEnd) {
  let last = null
  for (const t of trainees || []) {
    for (const a of t.attendance || []) {
      if (!a.confirmed) continue
      if (a.attendance_date < waStart || a.attendance_date > waEnd) continue
      if (!last || a.attendance_date > last) last = a.attendance_date
    }
  }
  return last
}

// Was this trainee present on that final day?
export function finishedWeekA(trainee, lastDay) {
  if (!lastDay) return false
  return (trainee.attendance || []).some((a) => a.confirmed && a.attendance_date === lastDay)
}
