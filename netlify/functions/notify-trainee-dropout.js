// Netlify Function: daily trainee-dropout notification + auto-unenroll.
//
// Cron-triggered at 14:30 UTC daily (10:30 AM ET during EDT). Training
// starts at 10 AM ET, so the cron runs 30 minutes after start — late
// enough that anyone showing has signed in, early enough that we can
// notify IT/HR and update counts the same morning.
//
// **DST note:** 14:30 UTC = 10:30 AM during EDT (Mar–Nov) and 9:30 AM
// during EST (Nov–Mar). When DST ends in November, change the cron
// schedule in netlify.toml to "30 15 * * *" so it fires at 10:30 ET.
//
// For every enrolled, provisioned trainee in a class that's currently
// active:
//   - If today has NO confirmed attendance for them AND
//     they haven't been dropout-notified yet
//   → they're flagged as a dropout.
//
// On flag, we do TWO things:
//   1. Auto-unenroll them: set enrolled=false, unenrolled_at=now,
//      unenrolled_reason='No-show on Day N'. This drops the /progress
//      "Registered" count in real-time (e.g. 12 → 9 when 3 no-show).
//   2. Notify IT and HR via SMS/email so accounts get cleaned up:
//        * 'trainee_dropout_delete_email' → IT (delete Google Workspace email)
//        * 'trainee_dropout_delete_apps'  → HR (remove from RepCard/JobNimbus/Sales Academy)
//
// Each trainee's dropout_notified_at is stamped so the same name won't
// appear in a future day's report.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET. Optional: RESEND_API_KEY, EMAIL_FROM.
//
// GET auth: ?secret=<CRON_SECRET> or X-Cron-Secret header.
// POST: { class_id, date? } — fires for one class immediately, no secret
//   required (admin UI is implicit auth). Used by the trainer's "Send
//   credentials" button so the no-show fan-out fires the same day they
//   close out the class.
// Query params: ?dry_run=1, ?date=YYYY-MM-DD (override today, for testing).

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

export const handler = async (event) => {
  const isPost = event.httpMethod === 'POST'

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
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'

  let targetClassId = null
  let postDate = null
  if (isPost) {
    try {
      const body = JSON.parse(event.body || '{}')
      targetClassId = body.class_id || null
      postDate = body.date || null
    } catch {
      return json(400, { error: 'Invalid JSON body' })
    }
    if (!targetClassId) return json(400, { error: 'class_id required for POST' })
  }

  const today = params.date || postDate || computeFloridaToday()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Pull every enrolled trainee with a company email and no dropout stamp.
  let query = supabase
    .from('trainees')
    .select(`
      id, first_name, last_name, company_email, class_id,
      classes!class_id(id, region, week_start_date, week_end_date, locations(name)),
      attendance(attendance_date, confirmed)
    `)
    .eq('enrolled', true)
    .not('company_email', 'is', null)
    .is('dropout_notified_at', null)
  if (targetClassId) query = query.eq('class_id', targetClassId)
  const { data: trainees, error: trErr } = await query
  if (trErr) return json(500, { error: `Supabase: ${trErr.message}` })

  const dropouts = (trainees || []).filter((t) => {
    const c = t.classes
    if (!c) return false
    if (today < c.week_start_date || today > c.week_end_date) return false
    const attendedToday = (t.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    return !attendedToday
  })

  // Compute "Day N" for each dropout so the unenrolled_reason reads
  // "No-show on Day 1" instead of just "No-show today." N = (today -
  // week_start_date) + 1.
  function dayNumberFor(t) {
    const start = t.classes?.week_start_date
    if (!start) return null
    const ms = new Date(today + 'T12:00:00Z').getTime() - new Date(start + 'T12:00:00Z').getTime()
    return Math.floor(ms / 86_400_000) + 1
  }

  if (dropouts.length === 0) {
    return json(200, {
      target_date: today,
      candidate_count: 0,
      message: 'No new dropouts today.',
    })
  }

  const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

  // Group dropouts by class so the summary message is clearer when multiple
  // classes have dropouts on the same day.
  const lines = dropouts.map((t) => {
    const region = t.classes?.region || 'training'
    const loc = t.classes?.locations?.name
    const locStr = loc ? ` · ${loc}` : ''
    return `• ${t.first_name} ${t.last_name} — ${t.company_email} (${region}${locStr})`
  })

  const itSms =
    dropouts.length === 1
      ? `[Training] Dropout on ${dateLabel}: ${lines[0].slice(2)}. Please delete the Google Workspace account.`
      : `[Training] ${dropouts.length} dropouts on ${dateLabel}. Please delete these Google Workspace accounts:\n${lines.join('\n')}`
  const itEmailSubject = `Delete ${dropouts.length} Google Workspace account${dropouts.length === 1 ? '' : 's'} — dropouts on ${dateLabel}`
  const itEmailBody =
    `The following provisioned trainee${dropouts.length === 1 ? '' : 's'} no-showed on ${dateLabel} and appear${dropouts.length === 1 ? 's' : ''} to have dropped out. Please delete their company email account${dropouts.length === 1 ? '' : 's'}:\n\n` +
    `${lines.join('\n')}\n\n` +
    `— Training System`

  const hrSms =
    dropouts.length === 1
      ? `[Training] Dropout on ${dateLabel}: ${lines[0].slice(2)}. Please remove from RepCard, JobNimbus, and Sales Academy.`
      : `[Training] ${dropouts.length} dropouts on ${dateLabel}. Please remove from RepCard, JobNimbus, and Sales Academy:\n${lines.join('\n')}`
  const hrEmailSubject = `Remove ${dropouts.length} dropout${dropouts.length === 1 ? '' : 's'} from apps — ${dateLabel}`
  const hrEmailBody =
    `The following provisioned trainee${dropouts.length === 1 ? '' : 's'} no-showed on ${dateLabel} and appear${dropouts.length === 1 ? 's' : ''} to have dropped out. Please remove their account${dropouts.length === 1 ? '' : 's'} from RepCard, JobNimbus, and Sales Academy:\n\n` +
    `${lines.join('\n')}\n\n` +
    `— Training System`

  // Look up recipients for each event.
  const itLookup = await recipientsForEvent(supabase, 'trainee_dropout_delete_email', { legacyRole: 'it' })
  const hrLookup = await recipientsForEvent(supabase, 'trainee_dropout_delete_apps', { legacyRole: 'hr' })

  if (dryRun) {
    return json(200, {
      target_date: today,
      candidate_count: dropouts.length,
      dropouts: dropouts.map((t) => `${t.first_name} ${t.last_name} (${t.company_email})`),
      dry_run: true,
      preview_it_sms: itSms,
      preview_hr_sms: hrSms,
      it_subscribers: itLookup.recipients.length,
      hr_subscribers: hrLookup.recipients.length,
    })
  }

  const itResult = await notifyAll(itLookup.recipients, {
    smsBody: itSms,
    emailSubject: itEmailSubject,
    emailBody: itEmailBody,
    contactLabel: 'IT',
  })
  const hrResult = await notifyAll(hrLookup.recipients, {
    smsBody: hrSms,
    emailSubject: hrEmailSubject,
    emailBody: hrEmailBody,
    contactLabel: 'HR',
  })

  // Stamp dropout_notified_at + flip enrolled=false on each dropout
  // regardless of send outcome — a partial failure is better than
  // re-spamming the same name tomorrow. The enrolled flip is what
  // makes the /progress count drop in real-time (12 → 9).
  //
  // We do this per-row instead of with a bulk .in() because each
  // trainee needs an unenrolled_reason that includes their own
  // training-day-number.
  const nowIso = new Date().toISOString()
  await Promise.all(
    dropouts.map((t) => {
      const dayN = dayNumberFor(t)
      const reason = dayN ? `No-show on Day ${dayN}` : 'No-show during active training week'
      return supabase
        .from('trainees')
        .update({
          dropout_notified_at: nowIso,
          enrolled: false,
          unenrolled_at: nowIso,
          unenrolled_reason: reason,
        })
        .eq('id', t.id)
    }),
  )

  return json(200, {
    target_date: today,
    candidate_count: dropouts.length,
    dropouts: dropouts.map((t) => `${t.first_name} ${t.last_name} (${t.company_email})`),
    it_notified: {
      ...itResult,
      source: itLookup.source,
      recipient_count: itLookup.recipients.length,
    },
    hr_notified: {
      ...hrResult,
      source: hrLookup.source,
      recipient_count: hrLookup.recipients.length,
    },
  })
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(new Date())
}

function json(status, body) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
