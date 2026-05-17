// Mark no-shows from ended training classes as dropouts (enrolled=false).
//
// The rule: once a training class week ends (week_end_date < today), any
// trainee still enrolled who never submitted a final test is effectively a
// dropout. We flip their enrolled flag to false, stamp unenrolled_at, and
// label unenrolled_reason so HR can distinguish auto-flags from manual
// unenrollments. This keeps the "All enrolled" broadcast list clean — only
// active trainees + graduates remain.
//
// IMPORTANT: skips attendance_only classes (one-off company meetings). The
// bulk-imported sales reps live under an attendance_only meeting class
// and we don't want to auto-dropout-flag them just because they missed
// the kickoff meeting.
//
// Two modes:
//   GET (cron):  ?secret=<CRON_SECRET>[&dry_run=1]
//     → scans every past, non-attendance_only class and flags no-shows.
//
//   POST:        { class_id: 'uuid', dry_run?: bool }
//     → admin button on Class Detail page. Single class, no secret needed
//       (the admin page is implicit auth, same pattern as the rest of the
//       admin manual triggers).
//
// Returns: { flagged: N, by_class: [{class_id, region, week, flagged}], trainees: [...] }
//   In dry_run mode, returns the same shape but performs no writes.
//
// Required env: SUPABASE_URL, SUPABASE_SECRET_KEY, CRON_SECRET (GET only).

import { createClient } from '@supabase/supabase-js'

export const handler = async (event) => {
  const isPost = event.httpMethod === 'POST'

  // GET requires cron secret; POST is open (admin page).
  if (!isPost) {
    const provided =
      event.headers['x-cron-secret'] ||
      event.headers['X-Cron-Secret'] ||
      event.queryStringParameters?.secret
    if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
      return json(401, { error: 'Unauthorized' })
    }
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  let body = {}
  if (isPost) {
    try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid JSON' }) }
  }
  const dryRun =
    !!body.dry_run ||
    event.queryStringParameters?.dry_run === '1' ||
    event.queryStringParameters?.dry_run === 'true'
  const singleClassId = body.class_id || null

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC — close enough

  // Find candidate classes. POST mode locks to one class (and skips
  // attendance_only / future-date guards — if admin manually clicks the
  // button on a class, trust them). GET mode scans every past, non-
  // attendance-only class.
  let cq = supabase
    .from('classes')
    .select('id, region, week_start_date, week_end_date, attendance_only')
  if (singleClassId) {
    cq = cq.eq('id', singleClassId)
  } else {
    cq = cq.lt('week_end_date', today).eq('attendance_only', false)
  }
  const { data: classes, error: cErr } = await cq
  if (cErr) return json(500, { error: `Supabase classes: ${cErr.message}` })
  if (!classes || classes.length === 0) {
    return json(200, { flagged: 0, by_class: [], trainees: [], dry_run: dryRun, message: 'No eligible classes.' })
  }

  // For each class, find enrolled trainees with no submitted test attempt.
  // We do this per-class so the by_class breakdown is meaningful in the
  // response (admin needs to know which class produced which flags).
  const byClass = []
  const allFlaggedIds = []
  const flaggedTrainees = []

  for (const c of classes) {
    // All enrolled, non-declined trainees in the class
    const { data: trainees, error: tErr } = await supabase
      .from('trainees')
      .select('id, first_name, last_name, phone')
      .eq('class_id', c.id)
      .eq('enrolled', true)
      .is('declined_at', null)
    if (tErr) return json(500, { error: `Supabase trainees: ${tErr.message}` })
    if (!trainees || trainees.length === 0) continue

    // Which of them have a submitted test attempt?
    const traineeIds = trainees.map((t) => t.id)
    const { data: attempts, error: aErr } = await supabase
      .from('test_attempts')
      .select('trainee_id')
      .eq('class_id', c.id)
      .in('trainee_id', traineeIds)
      .not('submitted_at', 'is', null)
    if (aErr) return json(500, { error: `Supabase test_attempts: ${aErr.message}` })

    const submittedIds = new Set((attempts || []).map((a) => a.trainee_id))
    const noShows = trainees.filter((t) => !submittedIds.has(t.id))
    if (noShows.length === 0) continue

    byClass.push({
      class_id: c.id,
      region: c.region,
      week_start_date: c.week_start_date,
      week_end_date: c.week_end_date,
      flagged: noShows.length,
    })
    for (const t of noShows) {
      allFlaggedIds.push(t.id)
      flaggedTrainees.push({
        id: t.id,
        name: `${t.first_name} ${t.last_name}`,
        phone: t.phone,
        class_id: c.id,
        region: c.region,
        week_start_date: c.week_start_date,
      })
    }
  }

  if (allFlaggedIds.length === 0) {
    return json(200, { flagged: 0, by_class: [], trainees: [], dry_run: dryRun, message: 'No no-shows to flag.' })
  }

  if (dryRun) {
    return json(200, {
      flagged: allFlaggedIds.length,
      by_class: byClass,
      trainees: flaggedTrainees,
      dry_run: true,
      message: `Would flag ${allFlaggedIds.length} trainee(s) — dry run, no writes.`,
    })
  }

  // Real run: flip them all in one update.
  const { error: uErr } = await supabase
    .from('trainees')
    .update({
      enrolled: false,
      unenrolled_at: new Date().toISOString(),
      unenrolled_reason: 'Auto: class ended without final test submission',
    })
    .in('id', allFlaggedIds)
  if (uErr) return json(500, { error: `Supabase update: ${uErr.message}` })

  return json(200, {
    flagged: allFlaggedIds.length,
    by_class: byClass,
    trainees: flaggedTrainees,
    dry_run: false,
  })
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
