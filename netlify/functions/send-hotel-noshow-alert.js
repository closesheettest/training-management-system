// Netlify Function: 10:30 AM hotel-no-show alert.
//
// Runs daily (via cron-job.org or similar). Finds every trainee whose
// needs_hotel=true who hasn't checked in by 10:30 AM today, then sends a
// summary SMS to HR (falls back to admin recipients, then to ADMIN_PHONE
// env var). Helps HR cancel unused hotel rooms quickly.
//
// Required env vars: SUPABASE_URL, SUPABASE_SECRET_KEY, GHL_PIT_TOKEN,
// GHL_LOCATION_ID, CRON_SECRET
//
// Auth: include ?secret=<CRON_SECRET> or an X-Cron-Secret header.
//
// Query params:
//   ?dry_run=1   — log who would be alerted without sending SMS or stamping DB
//   ?date=YYYY-MM-DD — override the "today" check (useful for testing)
//
// Response: {
//   target_date, absent_count, sent_count, recipient_count,
//   role_used, absentees: [...], dry_run?
// }

import { createClient } from '@supabase/supabase-js'
import { recipientsForEvent } from './_recipients.js'
import { notifyAll } from './_notify.js'

export const handler = async (event) => {
  // Auth
  const provided =
    event.headers['x-cron-secret'] ||
    event.headers['X-Cron-Secret'] ||
    event.queryStringParameters?.secret
  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return json(401, { error: 'Unauthorized' })
  }

  const missing = []
  for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'GHL_PIT_TOKEN', 'GHL_LOCATION_ID']) {
    if (!process.env[k]) missing.push(k)
  }
  if (missing.length) return json(500, { error: `Missing env vars: ${missing.join(', ')}` })

  const params = event.queryStringParameters || {}
  const dryRun = params.dry_run === '1' || params.dry_run === 'true'
  const today = params.date || computeFloridaToday()

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY)

  // Pull all needs_hotel trainees who are enrolled and registered. We'll filter
  // by "class active today" and "no attendance today" in code (simpler than
  // building a complex PostgREST query).
  const { data: trainees, error: trErr } = await supabase
    .from('trainees')
    .select(`
      id,
      first_name,
      last_name,
      hotel_alert_sent_at,
      classes(week_start_date, week_end_date, region, locations(name)),
      attendance(attendance_date, confirmed)
    `)
    .eq('needs_hotel', true)
    .eq('enrolled', true)
    .eq('registered', true)

  if (trErr) return json(500, { error: `Supabase: ${trErr.message}` })

  const absentees = (trainees || []).filter((t) => {
    const start = t.classes?.week_start_date
    const end = t.classes?.week_end_date
    if (!start || !end) return false
    if (today < start || today > end) return false
    const checkedIn = (t.attendance || []).some(
      (a) => a.attendance_date === today && a.confirmed,
    )
    return !checkedIn
  })

  if (absentees.length === 0) {
    return json(200, {
      target_date: today,
      absent_count: 0,
      sent_count: 0,
      message: 'No hotel-needing no-shows today.',
    })
  }

  const smsBody = buildMessage(absentees, today)
  const emailSubject = `Hotel no-show alert — ${absentees.length} trainee${absentees.length === 1 ? '' : 's'}`
  const emailBody = smsBody

  const { recipients, source: roleUsed } = await recipientsForEvent(
    supabase,
    'hotel_noshow_alert',
    { legacyRole: 'hr' },
  )

  if (recipients.length === 0) {
    return json(200, {
      target_date: today,
      absent_count: absentees.length,
      sent_count: 0,
      role_used: null,
      warning: 'No active recipients found in HR or Admin roles, and no ADMIN_PHONE env var. Add at least one in /notifications.',
      absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    })
  }

  if (dryRun) {
    return json(200, {
      target_date: today,
      absent_count: absentees.length,
      role_used: roleUsed,
      recipient_count: recipients.length,
      dry_run: true,
      preview_sms: smsBody,
      preview_email_subject: emailSubject,
      absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    })
  }

  const r = await notifyAll(recipients, {
    smsBody,
    emailSubject,
    emailBody,
    contactLabel: 'HR',
  })

  await supabase
    .from('trainees')
    .update({ hotel_alert_sent_at: new Date().toISOString() })
    .in('id', absentees.map((t) => t.id))

  return json(200, {
    target_date: today,
    absent_count: absentees.length,
    sent_count: r.sms_sent + r.email_sent,
    sms_sent: r.sms_sent,
    email_sent: r.email_sent,
    recipient_count: recipients.length,
    role_used: roleUsed,
    absentees: absentees.map((t) => `${t.first_name} ${t.last_name} (${t.classes?.region || 'Region'})`),
    ...(r.errors.length > 0 ? { send_errors: r.errors } : {}),
  })
}

function buildMessage(absentees, dateIso) {
  const dateLabel = new Date(dateIso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
  if (absentees.length === 1) {
    const t = absentees[0]
    const region = t.classes?.region || 'training'
    const loc = t.classes?.locations?.name
    const locStr = loc ? ` at ${loc}` : ''
    return `[Training] ${t.first_name} ${t.last_name} (${region}${locStr}) hasn't checked in by 10:30 AM on ${dateLabel}. They need a hotel — consider cancelling their room.`
  }
  const lines = absentees.map((t) => {
    const region = t.classes?.region || 'training'
    return `• ${t.first_name} ${t.last_name} (${region})`
  })
  return `[Training] ${absentees.length} hotel-needing trainees haven't checked in by 10:30 AM on ${dateLabel}:\n${lines.join('\n')}\nConsider cancelling their rooms.`
}

function computeFloridaToday() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(new Date())
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}
