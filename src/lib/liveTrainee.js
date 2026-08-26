// Is this person still in the class?
//
// Four separate ways someone stops being on a roster, and every filter that
// checked only three of them kept firing people who would not go away. Chad
// offboarded Bret Dethlefsen repeatedly and he kept reappearing: offboarding
// sets left_company_at, and no roster filter looked at it. 65 people who had
// left the company were still enrolled on class rosters (Neal, 2026-08-25).
//
// One predicate so the next filter cannot quietly omit one of them.
export function isLiveTrainee(t) {
  if (!t) return false
  return t.enrolled !== false
    && !t.declined_at
    && !t.dropped_out_at
    && !t.left_company_at
}

// The PostgREST equivalent, for queries that filter server-side.
export const LIVE_TRAINEE_FILTER =
  'enrolled=not.is.false&declined_at=is.null&dropped_out_at=is.null&left_company_at=is.null'
